'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ModelTaskQueue } = require('../electron/model-task-queue');
const { materializeCanvasAssets, isInsidePath } = require('../electron/canvas-assets');
const { ModelLibrary } = require('../electron/model-library');
const { friendlyModelError, normalizeAPIKey } = require('../electron/model-credentials');
const { createQQAuth } = require('./qq-auth');
const { loadLocalEnv } = require('./local-env');

const root = path.resolve(__dirname, '..');
const localEnvFiles = loadLocalEnv(root);
const frontendRoot = path.join(root, 'frontend');
const dataRoot = path.resolve(process.env.YISHUN_WEB_DATA_ROOT || path.join(root, 'work', 'yishun-web-data'));
const outputRoot = path.join(dataRoot, 'outputs');
const savedRoot = path.join(dataRoot, 'saved');
const canvasRoot = path.join(dataRoot, 'canvas-assets');
const backendPath = path.resolve(process.env.YISHUN_BACKEND_PATH || path.join(root, 'bin', 'flowcanvas-backend.exe'));
const backendArgs = String(process.env.YISHUN_BACKEND_ARGS || '').trim().split(/\s+/).filter(Boolean);
const host = process.env.YISHUN_WEB_HOST || '127.0.0.1';
const port = Number(process.env.YISHUN_WEB_PORT || 4174);
const maxBodyBytes = Number(process.env.YISHUN_WEB_MAX_BODY_BYTES || 700 * 1024 * 1024);
const queue = new ModelTaskQueue(5);
const tasks = new Map();
const controllers = new Map();
const modelLibrary = new ModelLibrary(path.join(dataRoot, 'model-library'));
const qqAuth = createQQAuth({
  dataRoot: path.join(dataRoot, 'auth'),
  appId: process.env.QQ_CONNECT_APP_ID,
  appKey: process.env.QQ_CONNECT_APP_KEY,
  redirectURI: process.env.QQ_CONNECT_REDIRECT_URI,
  publicOrigin: process.env.YISHUN_PUBLIC_ORIGIN,
  authorizeURL: process.env.QQ_CONNECT_AUTHORIZE_URL,
  tokenURL: process.env.QQ_CONNECT_TOKEN_URL,
  openIdURL: process.env.QQ_CONNECT_OPENID_URL,
  userInfoURL: process.env.QQ_CONNECT_USERINFO_URL,
  secureCookie: String(process.env.AUTH_COOKIE_SECURE || '').toLowerCase() === 'true',
});

fs.mkdirSync(outputRoot, { recursive: true });
fs.mkdirSync(savedRoot, { recursive: true });
fs.mkdirSync(canvasRoot, { recursive: true });

const profiles = {
  image: {
    baseURL: process.env.FLOWCANVAS_IMAGE_MODEL_BASE_URL || process.env.FLOWCANVAS_MODEL_BASE_URL || 'https://api.tmlab.store',
    model: process.env.FLOWCANVAS_IMAGE_MODEL_ID || 'nano-banana-pro(特价版 1)',
    apiKey: normalizeAPIKey(process.env.FLOWCANVAS_IMAGE_MODEL_API_KEY || process.env.FLOWCANVAS_BOOTSTRAP_IMAGE_API_KEY || process.env.FLOWCANVAS_MODEL_API_KEY || ''),
  },
  video: {
    baseURL: process.env.FLOWCANVAS_VIDEO_MODEL_BASE_URL || process.env.FLOWCANVAS_MODEL_BASE_URL || 'https://api.tmlab.store',
    model: process.env.FLOWCANVAS_VIDEO_MODEL_ID || 'seedance-2.0-pro(431)',
    apiKey: normalizeAPIKey(process.env.FLOWCANVAS_VIDEO_MODEL_API_KEY || process.env.FLOWCANVAS_BOOTSTRAP_VIDEO_API_KEY || process.env.FLOWCANVAS_MODEL_API_KEY || ''),
  },
};

for (const key of [
  'FLOWCANVAS_IMAGE_MODEL_API_KEY', 'FLOWCANVAS_VIDEO_MODEL_API_KEY', 'FLOWCANVAS_MODEL_API_KEY',
  'FLOWCANVAS_BOOTSTRAP_IMAGE_API_KEY', 'FLOWCANVAS_BOOTSTRAP_VIDEO_API_KEY',
]) delete process.env[key];
for (const key of ['QQ_CONNECT_APP_KEY']) delete process.env[key];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function sendJSON(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function publicProfiles() {
  const profile = value => ({ configured: Boolean(value.apiKey), baseURL: value.baseURL, model: value.model });
  return { ok: true, profiles: { image: profile(profiles.image), video: profile(profiles.video) } };
}

function validateOrigin(request) {
  const origin = String(request.headers.origin || '');
  if (!origin) return true;
  try { return new URL(origin).host === String(request.headers.host || ''); } catch (_) { return false; }
}

function readJSON(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > maxBodyBytes) {
        reject(Object.assign(new Error('请求体超过 Web 服务限制。'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (_) { reject(Object.assign(new Error('请求 JSON 无效。'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function decodeAssets(rawAssets) {
  return (Array.isArray(rawAssets) ? rawAssets : []).slice(0, 15).map(item => {
    const value = item && typeof item === 'object' ? item : {};
    const encoded = String(value.bytesBase64 || '');
    return {
      name: String(value.name || ''), kind: String(value.kind || ''), role: String(value.role || 'reference'),
      mimeType: String(value.mimeType || ''), bytes: encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0),
    };
  });
}

function taskSnapshot(task) {
  return {
    id: task.id, action: task.action, state: task.state, status: task.status, progress: task.progress,
    message: task.message, error: task.error, result: task.result, createdAt: task.createdAt, updatedAt: task.updatedAt,
  };
}

function updateTask(task, patch) {
  Object.assign(task, patch, { updatedAt: new Date().toISOString() });
}

function parseProgress(task, buffer) {
  const lines = buffer.split(/\r?\n/);
  const remaining = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event && event.type === 'progress') updateTask(task, {
        status: String(event.status || 'running'), progress: Math.max(0, Math.min(1, Number(event.progress) || 0)),
        message: String(event.message || '模型平台处理中'),
      });
    } catch (_) {}
  }
  return remaining;
}

function resultWebURL(localPath, capability) {
  const base = path.join(outputRoot, capability);
  if (!path.isAbsolute(localPath) || !isInsidePath(localPath, base)) throw new Error('模型后端返回了不受信任的结果路径。');
  return `/api/files/${capability}/${encodeURIComponent(path.basename(localPath))}`;
}

function runBackend(task, rawPayload, signal) {
  return new Promise((resolve, reject) => {
    const capability = task.action === 'video.generate' ? 'video' : 'image';
    const profile = profiles[capability];
    const apiKey = normalizeAPIKey(profile.apiKey);
    if (!apiKey) {
      reject(new Error(`请先在设置中配置${capability === 'video' ? '视频' : '图片'}模型 API Key。`));
      return;
    }
    if (!fs.existsSync(backendPath)) {
      reject(new Error('FlowCanvas Go 后端尚未构建，请运行 npm run build:web-backend。'));
      return;
    }
    const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
    const requestedModel = String(payload.model || '').trim();
    if (requestedModel && requestedModel !== profile.model) {
      reject(new Error(`节点模型与${capability === 'video' ? '视频' : '图片'}模型设置不一致。`));
      return;
    }
    let staged;
    try { staged = materializeCanvasAssets(decodeAssets(payload.localAssets), canvasRoot); }
    catch (error) { reject(error); return; }
    const outputDir = path.join(outputRoot, capability);
    fs.mkdirSync(outputDir, { recursive: true });
    const input = {
      action: task.action, prompt: String(payload.prompt || ''), model: profile.model,
      size: String(payload.size || ''), aspectRatio: String(payload.aspectRatio || ''),
      images: Array.isArray(payload.images) ? payload.images : [],
      imageReferenceOrder: Array.isArray(payload.imageReferenceOrder) ? payload.imageReferenceOrder : [],
      parameters: payload.parameters && typeof payload.parameters === 'object' ? payload.parameters : {},
      modeType: String(payload.modeType || ''), ratio: String(payload.ratio || ''), resolution: String(payload.resolution || ''),
      duration: Number(payload.duration || 0), enableSound: String(payload.enableSound || ''),
      imageUrls: Array.isArray(payload.imageUrls) ? payload.imageUrls : [], audioUrls: Array.isArray(payload.audioUrls) ? payload.audioUrls : [],
      mixedList: Array.isArray(payload.mixedList) ? payload.mixedList : [], localAssets: staged.assets, outputDir,
    };
    const child = spawn(backendPath, backendArgs, {
      cwd: root, windowsHide: true, shell: false,
      env: { ...process.env, FLOWCANVAS_MODEL_API_KEY: apiKey, FLOWCANVAS_MODEL_BASE_URL: profile.baseURL },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    task.child = child;
    let stdout = '';
    let stderr = '';
    let progressBuffer = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abort);
      staged.cleanup();
      task.child = null;
      if (error) reject(friendlyModelError(error, capability)); else resolve(value);
    };
    const abort = () => {
      child.kill();
      const error = new Error('生成任务已取消。');
      error.name = 'AbortError';
      finish(error);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error('模型生成等待超时（30 分钟）。')); }, 30 * 60 * 1000);
    if (signal) signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-4 * 1024 * 1024); });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-1024 * 1024);
      progressBuffer = parseProgress(task, progressBuffer + text);
    });
    child.on('error', finish);
    child.on('close', code => {
      if (settled) return;
      let result;
      try { result = JSON.parse(stdout); }
      catch (_) { finish(new Error(stderr || stdout || `模型后端异常退出（${code}）。`)); return; }
      if (!result.ok) { finish(new Error(result.error || stderr || '生成失败。')); return; }
      if (result.data && result.data.localPath) {
        result.data.resultUrl = result.data.url || '';
        result.data.remoteUrl = result.data.remoteUrl || result.data.resultUrl;
        result.data.url = resultWebURL(result.data.localPath, capability);
        delete result.data.localPath;
      }
      finish(null, result);
    });
    try { child.stdin.end(JSON.stringify(input)); }
    catch (error) { finish(error); }
  });
}

function startTask(action, payload) {
  if (!['image.generate', 'video.generate'].includes(action)) throw Object.assign(new Error('不支持的生成动作。'), { statusCode: 400 });
  const id = crypto.randomUUID();
  const task = {
    id, action, state: 'queued', status: 'queued', progress: 0, message: '等待可用的生成通道', error: '', result: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), child: null,
  };
  const controller = new AbortController();
  tasks.set(id, task);
  controllers.set(id, controller);
  queue.submit(async () => {
    updateTask(task, { state: 'running', status: 'starting', progress: 0.01, message: '正在启动模型任务' });
    try {
      const result = await runBackend(task, payload, controller.signal);
      updateTask(task, { state: 'completed', status: 'completed', progress: 1, message: '生成完成', result });
    } catch (error) {
      const cancelled = error && error.name === 'AbortError';
      updateTask(task, { state: cancelled ? 'cancelled' : 'failed', status: cancelled ? 'cancelled' : 'failed', error: error.message || String(error), message: cancelled ? '任务已取消' : '生成失败' });
    } finally {
      controllers.delete(id);
    }
  }, controller.signal).catch(error => {
    const cancelled = error && error.name === 'AbortError';
    updateTask(task, { state: cancelled ? 'cancelled' : 'failed', status: cancelled ? 'cancelled' : 'failed', error: error.message || String(error) });
    controllers.delete(id);
  });
  return task;
}

function sendFile(request, response, filePath, cache = true) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) { sendJSON(response, 404, { ok: false, error: '文件不存在。' }); return; }
  const stat = fs.statSync(filePath);
  const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = String(request.headers.range || '');
  const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': cache ? 'public, max-age=3600' : 'no-store' };
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start > end || start >= stat.size) { response.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); response.end(); return; }
    response.writeHead(206, { ...headers, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${stat.size}` });
    fs.createReadStream(filePath, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(filePath).pipe(response);
}

function safeSavedFileName(suggestedName, sourceName) {
  const sourceExtension = path.extname(sourceName).toLowerCase();
  const requested = path.basename(String(suggestedName || '').trim());
  const requestedExtension = path.extname(requested);
  let stem = path.basename(requested, requestedExtension)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  if (!stem) stem = `yishun-result-${Date.now()}`;
  return `${stem.slice(0, 120)}${sourceExtension}`;
}

async function saveGeneratedFile(sourceUrl, suggestedName) {
  const sourceMatch = /^\/api\/files\/(image|video)\/([^/?#]+)$/.exec(String(sourceUrl || ''));
  if (!sourceMatch) throw Object.assign(new Error('只能保存衣瞬生成的结果文件。'), { statusCode: 400 });
  const capability = sourceMatch[1];
  let sourceName;
  try { sourceName = decodeURIComponent(sourceMatch[2]); }
  catch (_) { throw Object.assign(new Error('生成结果文件名无效。'), { statusCode: 400 }); }
  const sourceDirectory = path.join(outputRoot, capability);
  const sourcePath = path.resolve(sourceDirectory, sourceName);
  if (!isInsidePath(sourcePath, sourceDirectory)) throw Object.assign(new Error('生成结果文件路径无效。'), { statusCode: 403 });
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) throw Object.assign(new Error('生成结果文件不存在。'), { statusCode: 404 });

  const directory = path.join(savedRoot, capability);
  fs.mkdirSync(directory, { recursive: true });
  const fileName = safeSavedFileName(suggestedName, sourceName);
  const extension = path.extname(fileName);
  const stem = path.basename(fileName, extension);
  for (let index = 0; index < 1000; index += 1) {
    const candidateName = index ? `${stem}-${index + 1}${extension}` : fileName;
    const target = path.join(directory, candidateName);
    try {
      await fs.promises.copyFile(sourcePath, target, fs.constants.COPYFILE_EXCL);
      return { path: target, fileName: candidateName, bytes: fs.statSync(target).size };
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
  }
  throw Object.assign(new Error('保存目录中同名文件过多，请稍后重试。'), { statusCode: 409 });
}

async function handleAPI(request, response, url) {
  if (request.method !== 'GET' && !validateOrigin(request)) { sendJSON(response, 403, { ok: false, error: '拒绝跨站请求。' }); return; }
  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJSON(response, 200, { ok: true, service: 'yishun-web', backendReady: fs.existsSync(backendPath), profiles: publicProfiles().profiles, auth: { qqConfigured: qqAuth.configured } }); return;
  }
  if (await qqAuth.handle(request, response, url)) return;
  if (request.method === 'GET' && url.pathname === '/api/model-config') { sendJSON(response, 200, publicProfiles()); return; }
  if (request.method === 'PUT' && url.pathname === '/api/model-config') {
    const body = await readJSON(request);
    const requested = body.profiles && typeof body.profiles === 'object' ? body.profiles : {};
    for (const capability of ['image', 'video']) {
      const next = requested[capability];
      if (!next || typeof next !== 'object') continue;
      const baseURL = String(next.baseURL || profiles[capability].baseURL).trim().replace(/\/+$/, '');
      const model = String(next.model || profiles[capability].model).trim();
      let parsed;
      try { parsed = new URL(baseURL); } catch (_) { throw Object.assign(new Error('模型 API 地址无效。'), { statusCode: 400 }); }
      if (parsed.protocol !== 'https:' && !/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(baseURL)) throw Object.assign(new Error('模型 API 必须使用 HTTPS。'), { statusCode: 400 });
      if (!model) throw Object.assign(new Error('模型名称不能为空。'), { statusCode: 400 });
      profiles[capability].baseURL = baseURL;
      profiles[capability].model = model;
      const apiKey = normalizeAPIKey(next.apiKey);
      if (apiKey) profiles[capability].apiKey = apiKey;
    }
    sendJSON(response, 200, publicProfiles()); return;
  }
  if (request.method === 'GET' && url.pathname === '/api/model-library') {
    sendJSON(response, 200, { ok: true, models: modelLibrary.list() }); return;
  }
  if (request.method === 'POST' && url.pathname === '/api/model-library') {
    const body = await readJSON(request);
    sendJSON(response, 201, { ok: true, model: modelLibrary.create(body) }); return;
  }
  const modelLibraryMatch = /^\/api\/model-library\/([0-9a-f-]+)$/i.exec(url.pathname);
  if (modelLibraryMatch) {
    if (request.method === 'GET') {
      const model = modelLibrary.read(modelLibraryMatch[1]);
      sendJSON(response, 200, {
        ok: true,
        model: { ...model, image: { ...model.image, bytes: undefined, bytesBase64: model.image.bytes.toString('base64') } },
      });
      return;
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      const body = await readJSON(request);
      sendJSON(response, 200, { ok: true, model: modelLibrary.update(modelLibraryMatch[1], body) }); return;
    }
    if (request.method === 'DELETE') {
      sendJSON(response, 200, { ok: true, deleted: modelLibrary.delete(modelLibraryMatch[1]) }); return;
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/files/save') {
    const body = await readJSON(request);
    const saved = await saveGeneratedFile(body.sourceUrl, body.suggestedName);
    sendJSON(response, 201, { ok: true, saved }); return;
  }
  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const body = await readJSON(request);
    const task = startTask(String(body.action || ''), body.payload || {});
    sendJSON(response, 202, { ok: true, task: taskSnapshot(task) }); return;
  }
  const taskMatch = /^\/api\/tasks\/([A-Za-z0-9-]+)$/.exec(url.pathname);
  if (taskMatch) {
    const task = tasks.get(taskMatch[1]);
    if (!task) { sendJSON(response, 404, { ok: false, error: '任务不存在或已过期。' }); return; }
    if (request.method === 'GET') { sendJSON(response, 200, { ok: true, task: taskSnapshot(task) }); return; }
    if (request.method === 'DELETE') {
      const controller = controllers.get(task.id);
      if (controller) controller.abort();
      sendJSON(response, 200, { ok: true, cancelled: Boolean(controller) }); return;
    }
  }
  const fileMatch = /^\/api\/files\/(image|video)\/([^/]+)$/.exec(url.pathname);
  if (request.method === 'GET' && fileMatch) {
    const directory = path.join(outputRoot, fileMatch[1]);
    const target = path.resolve(directory, decodeURIComponent(fileMatch[2]));
    if (!isInsidePath(target, directory)) { sendJSON(response, 403, { ok: false, error: '文件路径无效。' }); return; }
    sendFile(request, response, target, false); return;
  }
  sendJSON(response, 404, { ok: false, error: 'Web API 路径不存在。' });
}

function handleStatic(request, response, url) {
  const relative = url.pathname === '/' ? 'yishun.html' : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(frontendRoot, relative);
  if (!isInsidePath(target, frontendRoot)) { sendJSON(response, 403, { ok: false, error: '路径无效。' }); return; }
  const extension = path.extname(target).toLowerCase();
  sendFile(request, response, target, !['.html', '.js', '.css'].includes(extension));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || `${host}:${port}`}`);
    if (url.pathname.startsWith('/api/')) await handleAPI(request, response, url);
    else if (request.method === 'GET' || request.method === 'HEAD') handleStatic(request, response, url);
    else sendJSON(response, 405, { ok: false, error: '请求方法不受支持。' });
  } catch (error) {
    if (!response.headersSent) sendJSON(response, error.statusCode || 500, { ok: false, error: error.message || '服务器内部错误。' });
    else response.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`Yishun Web: http://${host}:${port}/`);
  if (localEnvFiles.length) console.log(`Local environment: ${localEnvFiles.join(', ')}`);
  console.log(`FlowCanvas backend: ${fs.existsSync(backendPath) ? 'ready' : 'missing'} (${backendPath})`);
  console.log('API keys are kept in server memory only.');
});

function shutdown() {
  for (const controller of controllers.values()) controller.abort();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = { server, profiles, tasks, modelLibrary };
