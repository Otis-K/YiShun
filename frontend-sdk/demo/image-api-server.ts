import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';

export const DEFAULT_IMAGE_BASE_URL = 'https://api.tmlab.store';
export const DEFAULT_IMAGE_MODEL = 'nano-banana-pro(特价版 1)';

const allowedSizes = new Set(['1K', '2K', '4K']);
const allowedRatios = new Set(['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']);
const terminalSuccess = new Set(['completed', 'succeeded', 'success']);
const terminalFailure = new Set(['failed', 'error', 'cancelled']);

interface RuntimeConfig {
  apiKey: string;
  baseURL: string;
}

interface PluginRuntimeConfig {
  imageApiKey: string;
  videoApiKey: string;
  baseURL: string;
}

export interface ImageGenerationInput {
  prompt: string;
  model?: string;
  size?: string;
  aspectRatio?: string;
  images?: string[];
}

interface TaskResponse {
  id?: string;
  task_id?: string;
  status?: string;
  progress?: number;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
  failure_reason?: string;
  message?: string;
  error?: { message?: string; code?: string };
  result_url?: string;
  remote_url?: string;
  video_url?: string;
  url?: string;
  result?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

export interface GeneratedImage {
  taskId: string;
  status: string;
  resultURL: string;
  contentType: string;
  content: Uint8Array;
}

export interface VideoGenerationInput {
  prompt: string;
  model?: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  firstImage?: string;
  lastImage?: string;
  referenceImages?: string[];
}

export interface GeneratedVideo {
  taskId: string;
  status: string;
  resultURL: string;
  contentType: string;
  content: Uint8Array;
}

export class VideoModelUnavailableError extends Error {
  readonly code = 'VIDEO_MODEL_UNAVAILABLE' as const;

  constructor(readonly model: string, readonly availableModels: string[]) {
    super(`当前视频 API Key 所属分组未开通 ${model}。请在 TMLab 后台为令牌绑定包含该模型的渠道，或更换有视频权限的 API Key。`);
    this.name = 'VideoModelUnavailableError';
  }
}

export class ImageProviderTaskError extends Error {
  constructor(
    readonly taskId: string,
    message: string,
    readonly task: TaskResponse,
  ) {
    super(message);
    this.name = 'ImageProviderTaskError';
  }
}

const delay = (milliseconds: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal.aborted) {
    reject(signal.reason);
    return;
  }
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

const normalizedBaseURL = (value: string): string => {
  const parsed = new URL(value || DEFAULT_IMAGE_BASE_URL);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('模型接口地址必须使用 HTTP 或 HTTPS。');
  return parsed.toString().replace(/\/$/, '');
};

const nestedFailureReason = (value: unknown, visited = new Set<object>()): string => {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object' || visited.has(value)) return '';
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const reason = nestedFailureReason(item, visited);
      if (reason) return reason;
    }
    return '';
  }
  const record = value as Record<string, unknown>;
  for (const key of ['failure_reason', 'message', 'detail', 'reason', 'error_message']) {
    const reason = nestedFailureReason(record[key], visited);
    if (reason) return reason;
  }
  for (const item of Object.values(record)) {
    const reason = nestedFailureReason(item, visited);
    if (reason) return reason;
  }
  return '';
};

export const failureReason = (task: TaskResponse): string => (
  nestedFailureReason(task.error)
  || String(task.failure_reason || '').trim()
  || String(task.message || '').trim()
  || nestedFailureReason(task.data)
  || nestedFailureReason(task.metadata)
  || '模型平台没有提供失败原因，请检查账户额度、内容审核和模型通道状态。'
);

const taskResultURL = (task: TaskResponse): string => {
  const value = task.metadata?.url;
  return typeof value === 'string' ? value.trim() : '';
};

const nestedMediaURL = (value: unknown, visited = new Set<object>()): string => {
  if (typeof value === 'string') return /^https?:\/\//i.test(value.trim()) ? value.trim() : '';
  if (!value || typeof value !== 'object' || visited.has(value)) return '';
  visited.add(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = nestedMediaURL(item, visited);
      if (result) return result;
    }
    return '';
  }
  const record = value as Record<string, unknown>;
  for (const key of ['result_url', 'video_url', 'url', 'download_url', 'file_url', 'remote_url']) {
    const result = nestedMediaURL(record[key], visited);
    if (result) return result;
  }
  for (const item of Object.values(record)) {
    const result = nestedMediaURL(item, visited);
    if (result) return result;
  }
  return '';
};

const providerRequest = async (
  config: RuntimeConfig,
  endpoint: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> => {
  const idempotencyKey = randomUUID();
  let lastError: Error | undefined;
  // Generation POSTs can be billable. Submit exactly once; only read-only
  // polling and downloads may retry transient transport failures.
  const maximumAttempts = String(init.method || 'GET').toUpperCase() === 'POST' ? 1 : 3;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${config.apiKey}`);
      headers.set('Accept', 'application/json');
      if (init.body) {
        headers.set('Content-Type', 'application/json');
        headers.set('Idempotency-Key', idempotencyKey);
      }
      const response = await fetch(`${config.baseURL}${endpoint}`, { ...init, headers, signal });
      if (response.ok) return response;
      const text = (await response.text()).slice(0, 2048);
      let providerCode = '';
      let providerMessage = '';
      try {
        const parsed = JSON.parse(text) as { error?: { code?: unknown; message?: unknown } };
        providerCode = String(parsed.error?.code || '');
        providerMessage = String(parsed.error?.message || '');
      } catch { /* Preserve non-JSON provider diagnostics below. */ }
      lastError = providerCode === 'model_not_found'
        ? new Error(`视频模型通道不可用：${providerMessage || '当前 API Key 所属分组没有配置该模型。'}`)
        : new Error(`模型接口返回 HTTP ${response.status}${providerMessage ? `：${providerMessage}` : text ? `：${text}` : ''}`);
      if (providerCode === 'model_not_found') throw lastError;
      if (response.status !== 429 && response.status < 500) throw lastError;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt === maximumAttempts - 1) break;
    }
    await delay((attempt + 1) * 500, signal);
  }
  throw lastError ?? new Error('模型接口请求失败。');
};

const providerJSON = async (
  config: RuntimeConfig,
  endpoint: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<TaskResponse> => {
  const response = await providerRequest(config, endpoint, init, signal);
  return await response.json() as TaskResponse;
};

export async function listTmlabModels(configInput: RuntimeConfig, signal: AbortSignal): Promise<string[]> {
  const config = { apiKey: configInput.apiKey.trim(), baseURL: normalizedBaseURL(configInput.baseURL) };
  if (!config.apiKey) throw new Error('请先配置模型 API Key。');
  const response = await providerRequest(config, '/v1/models', { method: 'GET' }, signal);
  const body = await response.json() as { data?: Array<{ id?: unknown }> };
  return Array.isArray(body.data)
    ? body.data.map(item => String(item.id || '').trim()).filter(Boolean)
    : [];
}

export async function generateTmlabImage(
  configInput: RuntimeConfig & { pollIntervalMs?: number },
  input: ImageGenerationInput,
  signal: AbortSignal,
): Promise<GeneratedImage> {
  const config = { apiKey: configInput.apiKey.trim(), baseURL: normalizedBaseURL(configInput.baseURL) };
  if (!config.apiKey) throw new Error('请先配置图片模型 API Key。');
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw new Error('图片生成提示词不能为空。');
  if (prompt.length > 20_000) throw new Error('图片生成提示词过长。');
  const model = String(input.model || DEFAULT_IMAGE_MODEL).trim();
  if (model !== DEFAULT_IMAGE_MODEL) throw new Error(`当前接口不支持模型：${model}`);
  const size = String(input.size || '2K').toUpperCase();
  if (!allowedSizes.has(size)) throw new Error(`不支持的图片尺寸：${size}`);
  const aspectRatio = String(input.aspectRatio || '16:9');
  if (!allowedRatios.has(aspectRatio)) throw new Error(`不支持的图片比例：${aspectRatio}`);
  const images = Array.isArray(input.images)
    ? input.images.filter(value => /^https?:\/\//i.test(value)).slice(0, 14)
    : [];

  const created = await providerJSON(config, '/v1/tasks', {
    method: 'POST',
    body: JSON.stringify({
      model,
      prompt,
      size,
      metadata: { aspectRatio },
      ...(images.length ? { images } : {}),
    }),
  }, signal);
  const taskId = String(created.task_id || created.id || '').trim();
  if (!taskId) throw new Error('模型平台没有返回任务 ID。');

  const pollInterval = Math.max(250, configInput.pollIntervalMs ?? 5_000);
  let completed: TaskResponse | undefined;
  while (!completed) {
    const current = await providerJSON(config, `/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' }, signal);
    const status = String(current.status || '').toLowerCase();
    if (terminalSuccess.has(status)) completed = current;
    else if (terminalFailure.has(status)) {
      throw new ImageProviderTaskError(taskId, `图片生成失败（任务 ${taskId}）：${failureReason(current)}`, current);
    }
    else await delay(pollInterval, signal);
  }

  const resultURL = taskResultURL(completed);
  if (!resultURL) throw new Error('图片生成完成，但模型平台没有返回图片地址。');

  let contentResponse: Response;
  try {
    contentResponse = await providerRequest(config, `/v1/tasks/${encodeURIComponent(taskId)}/content`, { method: 'GET' }, signal);
  } catch {
    const absoluteResultURL = new URL(resultURL, `${config.baseURL}/`).toString();
    contentResponse = await fetch(absoluteResultURL, { signal });
    if (!contentResponse.ok) throw new Error(`下载生成图片失败：HTTP ${contentResponse.status}`);
  }
  const content = new Uint8Array(await contentResponse.arrayBuffer());
  if (!content.length) throw new Error('模型平台返回了空图片。');
  const contentType = (contentResponse.headers.get('content-type') || 'image/png').split(';')[0].trim();
  if (!contentType.startsWith('image/')) throw new Error(`模型平台返回的内容不是图片：${contentType}`);
  return { taskId, status: 'completed', resultURL, contentType, content };
}

export async function resolveTmlabTask(configInput: RuntimeConfig, taskId: string, signal: AbortSignal): Promise<TaskResponse> {
  const config = { apiKey: configInput.apiKey.trim(), baseURL: normalizedBaseURL(configInput.baseURL) };
  if (!config.apiKey) throw new Error('请先配置模型 API Key。');
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(taskId)) throw new Error('任务 ID 无效。');
  return providerJSON(config, `/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' }, signal);
}

export async function generateTmlabVideo(
  configInput: RuntimeConfig & { pollIntervalMs?: number },
  input: VideoGenerationInput,
  signal: AbortSignal,
): Promise<GeneratedVideo> {
  const config = { apiKey: configInput.apiKey.trim(), baseURL: normalizedBaseURL(configInput.baseURL) };
  if (!config.apiKey) throw new Error('请先配置视频模型 API Key。');
  const prompt = String(input.prompt || '').trim();
  if (!prompt) throw new Error('视频生成提示词不能为空。');
  if ([...prompt].length > 5_000) throw new Error('视频生成提示词不能超过 5000 个字符。');
  const model = String(input.model || 'seedance-2.0-pro(431)').trim();
  if (model !== 'seedance-2.0-pro(431)') throw new Error(`当前视频接口不支持模型：${model}`);
  const availableModels = await listTmlabModels(config, signal);
  if (!availableModels.includes(model)) throw new VideoModelUnavailableError(model, availableModels);
  const ratio = String(input.ratio || '16:9');
  if (!['16:9', '9:16', '1:1'].includes(ratio)) throw new Error(`Seedance Pro(431) 不支持比例：${ratio}`);
  const resolution = String(input.resolution || '720p').toLowerCase();
  if (resolution !== '720p') throw new Error('Seedance Pro(431) 仅支持 720p。');
  const duration = Number(input.duration || 5);
  if (!Number.isInteger(duration) || duration < 4 || duration > 15) throw new Error('视频时长必须为 4 到 15 秒。');
  const firstImage = String(input.firstImage || '').trim();
  const lastImage = String(input.lastImage || '').trim();
  if (Boolean(firstImage) !== Boolean(lastImage)) throw new Error('首尾帧模式必须同时提供首帧和尾帧。');
  const referenceImages = Array.isArray(input.referenceImages)
    ? [...new Set(input.referenceImages.map(String).filter(value => /^https?:\/\//i.test(value)))].slice(0, 4)
    : [];
  if (firstImage && referenceImages.length) throw new Error('首尾帧模式不能同时使用参考图片。');

  const payload = {
    model,
    prompt,
    duration,
    ratio,
    resolution,
    ...(firstImage ? { first_image: firstImage, last_image: lastImage } : {}),
    ...(referenceImages.length ? { referenceImages } : {}),
  };
  const created = await providerJSON(config, '/v1/tasks', { method: 'POST', body: JSON.stringify(payload) }, signal);
  const taskId = String(created.task_id || created.id || '').trim();
  if (!taskId) throw new Error('视频模型平台没有返回任务 ID。');

  const pollInterval = Math.max(250, configInput.pollIntervalMs ?? 30_000);
  let completed: TaskResponse | undefined;
  while (!completed) {
    const current = await providerJSON(config, `/v1/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' }, signal);
    const status = String(current.status || '').trim().toLowerCase();
    if (terminalSuccess.has(status)) completed = current;
    else if (terminalFailure.has(status) || status === 'failure') {
      throw new ImageProviderTaskError(taskId, `视频生成失败（任务 ${taskId}）：${failureReason(current)}`, current);
    } else await delay(pollInterval, signal);
  }

  const resultURL = nestedMediaURL(completed.result_url)
    || nestedMediaURL(completed.url)
    || nestedMediaURL(completed.video_url)
    || nestedMediaURL(completed.metadata)
    || nestedMediaURL(completed.data)
    || nestedMediaURL(completed.result)
    || nestedMediaURL(completed.output)
    || nestedMediaURL(completed.remote_url);
  let contentResponse: Response | undefined;
  if (resultURL) {
    const response = await fetch(resultURL, { signal });
    if (response.ok) contentResponse = response;
  }
  if (!contentResponse) {
    contentResponse = await providerRequest(config, `/v1/tasks/${encodeURIComponent(taskId)}/content`, { method: 'GET' }, signal);
  }
  const content = new Uint8Array(await contentResponse.arrayBuffer());
  if (!content.length) throw new Error('视频模型平台返回了空文件。');
  const contentType = (contentResponse.headers.get('content-type') || 'video/mp4').split(';')[0].trim();
  if (!contentType.startsWith('video/')) throw new Error(`模型平台返回的内容不是视频：${contentType}`);
  return {
    taskId,
    status: 'completed',
    resultURL: resultURL || `${config.baseURL}/v1/tasks/${encodeURIComponent(taskId)}/content`,
    contentType,
    content,
  };
}

const extensionFor = (contentType: string): string => {
  if (contentType === 'image/jpeg') return '.jpg';
  if (contentType === 'image/webp') return '.webp';
  if (contentType === 'image/gif') return '.gif';
  return '.png';
};

const readJSON = async (request: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error('请求内容过大。');
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求必须是 JSON 对象。');
  return value as Record<string, unknown>;
};

const sendJSON = (response: ServerResponse, status: number, value: unknown): void => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
};

export function imageGenerationPlugin(projectRoot: string): Plugin {
  const generatedRoot = path.join(projectRoot, '.flowcanvas-generated');
  const runtime: PluginRuntimeConfig = {
    imageApiKey: String(process.env.TMLAB_IMAGE_API_KEY || process.env.TMLAB_API_KEY || process.env.FLOWCANVAS_MODEL_API_KEY || ''),
    videoApiKey: String(process.env.TMLAB_VIDEO_API_KEY || process.env.TMLAB_API_KEY || process.env.FLOWCANVAS_MODEL_API_KEY || ''),
    baseURL: normalizedBaseURL(String(process.env.FLOWCANVAS_MODEL_BASE_URL || DEFAULT_IMAGE_BASE_URL)),
  };
  let lastFailure: { time: string; taskId: string; error: string; status: string; details: TaskResponse } | undefined;
  let lastVideoFailure: { time: string; taskId: string; error: string; status: string; details: TaskResponse } | undefined;

  return {
    name: 'flowcanvas-image-generation-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        try {
          if (request.method === 'GET' && url.pathname === '/api/image/config') {
            sendJSON(response, 200, {
              configured: Boolean(runtime.imageApiKey),
              imageConfigured: Boolean(runtime.imageApiKey),
              videoConfigured: Boolean(runtime.videoApiKey),
              baseURL: runtime.baseURL,
              model: DEFAULT_IMAGE_MODEL,
              videoModel: 'seedance-2.0-pro(431)',
            });
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/image/config') {
            const body = await readJSON(request);
            const sharedKey = String(body.apiKey || '').trim();
            const imageApiKey = String(body.imageApiKey || sharedKey).trim();
            const videoApiKey = String(body.videoApiKey || sharedKey).trim();
            if (!imageApiKey && !videoApiKey) throw new Error('至少填写一个 API Key。');
            if (imageApiKey) runtime.imageApiKey = imageApiKey;
            if (videoApiKey) runtime.videoApiKey = videoApiKey;
            runtime.baseURL = normalizedBaseURL(String(body.baseURL || DEFAULT_IMAGE_BASE_URL));
            sendJSON(response, 200, {
              configured: Boolean(runtime.imageApiKey),
              imageConfigured: Boolean(runtime.imageApiKey),
              videoConfigured: Boolean(runtime.videoApiKey),
              baseURL: runtime.baseURL,
              model: DEFAULT_IMAGE_MODEL,
              videoModel: 'seedance-2.0-pro(431)',
            });
            return;
          }
          if (request.method === 'DELETE' && url.pathname === '/api/image/config') {
            runtime.imageApiKey = '';
            runtime.videoApiKey = '';
            sendJSON(response, 200, { configured: false, imageConfigured: false, videoConfigured: false, baseURL: runtime.baseURL, model: DEFAULT_IMAGE_MODEL });
            return;
          }
          if (request.method === 'GET' && url.pathname === '/api/image/diagnostics') {
            sendJSON(response, 200, {
              imageConfigured: Boolean(runtime.imageApiKey),
              videoConfigured: Boolean(runtime.videoApiKey),
              lastFailure: lastFailure ?? null,
              lastVideoFailure: lastVideoFailure ?? null,
            });
            return;
          }
          if (request.method === 'GET' && url.pathname.startsWith('/api/image/tasks/')) {
            if (!runtime.imageApiKey) {
              sendJSON(response, 428, { ok: false, code: 'CONFIG_REQUIRED', error: '请先配置图片模型 API Key。' });
              return;
            }
            const taskId = decodeURIComponent(url.pathname.slice('/api/image/tasks/'.length));
            const task = await resolveTmlabTask({ apiKey: runtime.imageApiKey, baseURL: runtime.baseURL }, taskId, AbortSignal.timeout(30_000));
            sendJSON(response, 200, {
              ok: true,
              data: {
                taskId,
                status: String(task.status || ''),
                resultUrl: taskResultURL(task),
              },
            });
            return;
          }
          if (request.method === 'GET' && url.pathname.startsWith('/api/image/assets/')) {
            const fileName = path.basename(decodeURIComponent(url.pathname.slice('/api/image/assets/'.length)));
            if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
              sendJSON(response, 400, { ok: false, error: '图片文件名无效。' });
              return;
            }
            const content = await readFile(path.join(generatedRoot, fileName));
            response.statusCode = 200;
            response.setHeader('Content-Type', fileName.endsWith('.jpg') ? 'image/jpeg' : fileName.endsWith('.webp') ? 'image/webp' : 'image/png');
            response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
            response.end(content);
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/image/generate') {
            if (!runtime.imageApiKey) {
              sendJSON(response, 428, { ok: false, code: 'CONFIG_REQUIRED', error: '请先配置图片模型 API Key。' });
              return;
            }
            const body = await readJSON(request);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(new Error('图片生成等待超时。')), 30 * 60 * 1000);
            response.once('close', () => {
              if (!response.writableEnded) controller.abort(new Error('浏览器已取消图片生成。'));
            });
            try {
              let result: GeneratedImage;
              try {
                result = await generateTmlabImage({ apiKey: runtime.imageApiKey, baseURL: runtime.baseURL }, {
                  prompt: String(body.prompt || ''),
                  model: String(body.model || DEFAULT_IMAGE_MODEL),
                  size: String(body.size || '2K'),
                  aspectRatio: String(body.aspectRatio || '16:9'),
                  images: Array.isArray(body.images) ? body.images.map(String) : [],
                }, controller.signal);
                lastFailure = undefined;
              } catch (error) {
                if (error instanceof ImageProviderTaskError) {
                  lastFailure = {
                    time: new Date().toISOString(),
                    taskId: error.taskId,
                    error: error.message,
                    status: String(error.task.status || 'failed'),
                    details: error.task,
                  };
                }
                throw error;
              }
              await mkdir(generatedRoot, { recursive: true });
              const safeTaskId = result.taskId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || randomUUID();
              const fileName = `${safeTaskId}-${Date.now()}${extensionFor(result.contentType)}`;
              const temporaryPath = path.join(generatedRoot, `${fileName}.tmp`);
              await writeFile(temporaryPath, result.content);
              await rename(temporaryPath, path.join(generatedRoot, fileName));
              sendJSON(response, 200, {
                ok: true,
                data: {
                  url: `/api/image/assets/${encodeURIComponent(fileName)}`,
                  resultUrl: result.resultURL,
                  taskId: result.taskId,
                  status: result.status,
                  contentType: result.contentType,
                  model: DEFAULT_IMAGE_MODEL,
                  provider: 'tmlab-tasks',
                },
              });
            } finally {
              clearTimeout(timeout);
            }
            return;
          }
          if (request.method === 'GET' && url.pathname.startsWith('/api/video/assets/')) {
            const fileName = path.basename(decodeURIComponent(url.pathname.slice('/api/video/assets/'.length)));
            if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
              sendJSON(response, 400, { ok: false, error: '视频文件名无效。' });
              return;
            }
            const content = await readFile(path.join(generatedRoot, fileName));
            response.statusCode = 200;
            response.setHeader('Content-Type', 'video/mp4');
            response.setHeader('Accept-Ranges', 'bytes');
            response.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
            response.end(content);
            return;
          }
          if (request.method === 'GET' && url.pathname === '/api/video/availability') {
            if (!runtime.videoApiKey) {
              sendJSON(response, 428, { ok: false, code: 'CONFIG_REQUIRED', error: '请先配置视频模型 API Key。' });
              return;
            }
            const models = await listTmlabModels({ apiKey: runtime.videoApiKey, baseURL: runtime.baseURL }, AbortSignal.timeout(30_000));
            const model = 'seedance-2.0-pro(431)';
            sendJSON(response, 200, {
              ok: true,
              available: models.includes(model),
              model,
              availableVideoModels: models.filter(value => /seedance|video|sora|veo/i.test(value)),
            });
            return;
          }
          if (request.method === 'POST' && url.pathname === '/api/video/generate') {
            if (!runtime.videoApiKey) {
              sendJSON(response, 428, { ok: false, code: 'CONFIG_REQUIRED', error: '请先配置视频模型 API Key。' });
              return;
            }
            const body = await readJSON(request);
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(new Error('视频生成等待超时。')), 30 * 60 * 1000);
            response.once('close', () => {
              if (!response.writableEnded) controller.abort(new Error('浏览器已取消视频生成。'));
            });
            try {
              let result: GeneratedVideo;
              try {
                result = await generateTmlabVideo({ apiKey: runtime.videoApiKey, baseURL: runtime.baseURL }, {
                  prompt: String(body.prompt || ''),
                  model: String(body.model || 'seedance-2.0-pro(431)'),
                  ratio: String(body.ratio || '16:9'),
                  resolution: String(body.resolution || '720p'),
                  duration: Number(body.duration || 5),
                  firstImage: String(body.firstImage || ''),
                  lastImage: String(body.lastImage || ''),
                  referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages.map(String) : [],
                }, controller.signal);
                lastVideoFailure = undefined;
              } catch (error) {
                if (error instanceof ImageProviderTaskError) {
                  lastVideoFailure = {
                    time: new Date().toISOString(), taskId: error.taskId, error: error.message,
                    status: String(error.task.status || 'failed'), details: error.task,
                  };
                }
                throw error;
              }
              await mkdir(generatedRoot, { recursive: true });
              const safeTaskId = result.taskId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || randomUUID();
              const fileName = `${safeTaskId}-${Date.now()}.mp4`;
              const temporaryPath = path.join(generatedRoot, `${fileName}.tmp`);
              await writeFile(temporaryPath, result.content);
              await rename(temporaryPath, path.join(generatedRoot, fileName));
              sendJSON(response, 200, {
                ok: true,
                data: {
                  url: `/api/video/assets/${encodeURIComponent(fileName)}`,
                  resultUrl: result.resultURL,
                  taskId: result.taskId,
                  status: result.status,
                  contentType: result.contentType,
                  model: 'seedance-2.0-pro(431)',
                  provider: 'tmlab-tasks',
                },
              });
            } finally {
              clearTimeout(timeout);
            }
            return;
          }
          next();
        } catch (error) {
          const unavailable = error instanceof VideoModelUnavailableError;
          sendJSON(response, unavailable ? 409 : 500, {
            ok: false,
            ...(unavailable ? { code: error.code, model: error.model, availableVideoModels: error.availableModels } : {}),
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    },
  };
}
