import {
  builtinNodeDefinitions,
  FlowCanvasSDK,
  normalizeGenerationDrafts,
  RuntimeConfigurationRequiredError,
  type NodeDefinition,
} from '../src';
import '../src/styles.css';
import './demo.css';
import { demoGraph } from './graph';

const configButton = document.querySelector<HTMLButtonElement>('#model-config-open')!;
const configDialog = document.querySelector<HTMLDialogElement>('#model-config-dialog')!;
const configForm = document.querySelector<HTMLFormElement>('#model-config-form')!;
const configClose = document.querySelector<HTMLButtonElement>('#model-config-close')!;
const configCancel = document.querySelector<HTMLButtonElement>('#model-config-cancel')!;
const configMessage = document.querySelector<HTMLParagraphElement>('#model-config-message')!;
const imageApiKeyInput = document.querySelector<HTMLInputElement>('#image-api-key')!;
const videoApiKeyInput = document.querySelector<HTMLInputElement>('#video-api-key')!;
const baseURLInput = document.querySelector<HTMLInputElement>('#model-base-url')!;

const setConfigurationState = (imageConfigured: boolean, videoConfigured: boolean, baseURL?: string) => {
  configButton.classList.toggle('is-configured', imageConfigured && videoConfigured);
  configButton.title = imageConfigured && videoConfigured
    ? '图片和视频模型已配置'
    : imageConfigured
      ? '图片模型已配置，视频模型尚未配置'
      : '模型尚未配置';
  if (baseURL) baseURLInput.value = baseURL;
};

const refreshConfiguration = async () => {
  try {
    const response = await fetch('/api/image/config');
    const config = await response.json() as { configured?: boolean; imageConfigured?: boolean; videoConfigured?: boolean; baseURL?: string };
    setConfigurationState(Boolean(config.imageConfigured ?? config.configured), Boolean(config.videoConfigured), config.baseURL);
  } catch {
    setConfigurationState(false, false);
  }
};

const openConfiguration = async () => {
  configMessage.textContent = '';
  imageApiKeyInput.value = '';
  videoApiKeyInput.value = '';
  await refreshConfiguration();
  configDialog.showModal();
  imageApiKeyInput.focus();
};

configButton.addEventListener('click', () => { void openConfiguration(); });
configClose.addEventListener('click', () => configDialog.close());
configCancel.addEventListener('click', () => configDialog.close());
configForm.addEventListener('submit', event => {
  event.preventDefault();
  configMessage.textContent = '';
  void (async () => {
    try {
      const response = await fetch('/api/image/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageApiKey: imageApiKeyInput.value,
          videoApiKey: videoApiKeyInput.value,
          baseURL: baseURLInput.value,
        }),
      });
      const result = await response.json() as { configured?: boolean; imageConfigured?: boolean; videoConfigured?: boolean; baseURL?: string; error?: string };
      if (!response.ok) throw new Error(result.error || '保存模型设置失败。');
      setConfigurationState(Boolean(result.imageConfigured ?? result.configured), Boolean(result.videoConfigured), result.baseURL);
      imageApiKeyInput.value = '';
      videoApiKeyInput.value = '';
      configDialog.close();
    } catch (error) {
      configMessage.textContent = error instanceof Error ? error.message : String(error);
    }
  })();
});

let sdk: FlowCanvasSDK;
const builtinImageDefinition = builtinNodeDefinitions.find(definition => definition.type === 'image');
if (!builtinImageDefinition) throw new Error('图片节点定义缺失。');

const publicMediaURL = (value: unknown): string => {
  if (typeof value === 'string') {
    const candidate = value.trim();
    return /^https?:\/\//i.test(candidate) && !/^https?:\/\/(127\.0\.0\.1|localhost)(?::|\/)/i.test(candidate) ? candidate : '';
  }
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const candidate of [record.resultUrl, record.remoteUrl, record.url, record.preview]) {
    const result = publicMediaURL(candidate);
    if (result) return result;
  }
  return '';
};

const resolveGeneratedImageURL = async (value: unknown, signal: AbortSignal): Promise<string> => {
  const direct = publicMediaURL(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const taskId = String(record.taskId || record.providerTaskId || '').trim();
  if (!taskId) return '';
  const response = await fetch(`/api/image/tasks/${encodeURIComponent(taskId)}`, { signal });
  const result = await response.json() as { ok?: boolean; error?: string; data?: { resultUrl?: string } };
  if (!response.ok || !result.ok) throw new Error(result.error || '读取图片任务结果失败。');
  return publicMediaURL(result.data?.resultUrl);
};

const inputValues = (value: unknown): unknown[] => (
  Array.isArray(value) ? value.flatMap(inputValues) : value ? [value] : []
);

const realImageDefinition: NodeDefinition = {
  ...builtinImageDefinition,
  execute: async ({ node, inputs, signal, emitProgress, forceRefresh }) => {
    const drafts = normalizeGenerationDrafts(node.data.generationDrafts, node.data, 'image');
    const promptInput = typeof inputs.prompt === 'string' ? inputs.prompt : '';
    const prompt = String(promptInput || drafts.image.prompt || node.data.prompt || '').trim();
    if (!prompt) throw new Error('图片生成提示词不能为空。');
    if (!forceRefresh && node.data.status === 'success') {
      const existingURL = await resolveGeneratedImageURL({
        resultUrl: node.data.resultUrl,
        preview: node.data.preview,
        providerTaskId: node.data.providerTaskId,
      }, signal);
      if (existingURL) {
        emitProgress(1, '复用已生成图片');
        return {
          image: {
            kind: 'image', url: existingURL, remoteUrl: existingURL,
            preview: String(node.data.preview || existingURL),
            taskId: String(node.data.providerTaskId || ''), model: String(node.data.model || ''), prompt,
          },
        };
      }
    }
    const size = drafts.image.quality.match(/\b(1K|2K|4K)\b/i)?.[1].toUpperCase() || '2K';
    const images = drafts.image.references
      .map(reference => typeof reference === 'string' ? reference : reference.url || '')
      .filter(reference => /^https?:\/\//i.test(reference));

    emitProgress(.05, '正在提交图片生成任务');
    const response = await fetch('/api/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model: 'nano-banana-pro(特价版 1)',
        size,
        aspectRatio: drafts.image.ratio,
        images,
      }),
      signal,
    });
    const result = await response.json() as {
      ok?: boolean;
      code?: string;
      error?: string;
      data?: { url?: string; resultUrl?: string; taskId?: string; contentType?: string; model?: string; provider?: string };
    };
    if (response.status === 428 || result.code === 'CONFIG_REQUIRED') {
      throw new RuntimeConfigurationRequiredError(result.error || '请先配置图片模型 API Key。', ['image-api-key']);
    }
    if (!response.ok || !result.ok || !result.data?.url) throw new Error(result.error || '图片生成失败。');

    emitProgress(.95, '正在保存生成图片');
    sdk.engine.updateNodeData(node.id, {
      preview: result.data.url,
      previewKind: 'image',
      mimeType: result.data.contentType || 'image/png',
      fileName: `${result.data.taskId || 'generated-image'}.png`,
      providerTaskId: result.data.taskId || '',
      provider: result.data.provider || 'tmlab-tasks',
      model: result.data.model || 'nano-banana-pro(特价版 1)',
      generatedAt: new Date().toISOString(),
      previewOrigin: 'generated',
      effectivePrompt: prompt,
      resultUrl: result.data.resultUrl || '',
    });
    emitProgress(1, '图片生成完成');
    return {
      image: {
        kind: 'image',
        url: result.data.resultUrl || result.data.url,
        preview: result.data.url,
        taskId: result.data.taskId,
        model: result.data.model,
        prompt,
      },
    };
  },
};

const builtinVideoDefinition = builtinNodeDefinitions.find(definition => definition.type === 'video');
if (!builtinVideoDefinition) throw new Error('视频节点定义缺失。');

const realVideoDefinition: NodeDefinition = {
  ...builtinVideoDefinition,
  execute: async ({ node, inputs, signal, emitProgress, forceRefresh }) => {
    const drafts = normalizeGenerationDrafts(node.data.generationDrafts, node.data, 'video');
    const inputPrompt = typeof inputs.prompt === 'string'
      ? inputs.prompt
      : inputs.prompt && typeof inputs.prompt === 'object' && 'text' in inputs.prompt
        ? String((inputs.prompt as { text?: unknown }).text || '')
        : '';
    const prompt = String(inputPrompt || drafts.video.prompt || node.data.prompt || '').trim();
    if (!prompt) throw new Error('视频生成提示词不能为空。');
    if (!forceRefresh && node.data.status === 'success' && node.data.preview) {
      const existingURL = publicMediaURL(node.data.resultUrl) || String(node.data.preview);
      emitProgress(1, '复用已生成视频');
      return { video: { kind: 'video', url: existingURL, preview: String(node.data.preview), taskId: node.data.providerTaskId, prompt } };
    }

    const connectedImages = inputValues(inputs.image);
    const firstFrameValue = drafts.video.firstFrame || undefined;
    const lastFrameValue = drafts.video.lastFrame || undefined;
    const firstImage = firstFrameValue ? await resolveGeneratedImageURL(firstFrameValue, signal) : '';
    const lastImage = lastFrameValue ? await resolveGeneratedImageURL(lastFrameValue, signal) : '';
    const referenceCandidates = [
      ...connectedImages,
      ...drafts.video.references,
      ...(!firstImage && firstFrameValue ? [firstFrameValue] : []),
    ];
    const referenceImages: string[] = [];
    for (const candidate of referenceCandidates) {
      const remoteURL = await resolveGeneratedImageURL(candidate, signal);
      if (remoteURL && !referenceImages.includes(remoteURL)) referenceImages.push(remoteURL);
    }
    if (!firstImage && !lastImage && referenceImages.length > 4) throw new Error('Seedance Pro(431) 最多支持 4 张参考图片。');
    if ((firstImage || lastImage) && !(firstImage && lastImage)) {
      if (firstImage && !lastImage && !referenceImages.includes(firstImage)) referenceImages.unshift(firstImage);
    }

    emitProgress(.03, '正在提交视频生成任务');
    const response = await fetch('/api/video/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        model: 'seedance-2.0-pro(431)',
        ratio: drafts.video.ratio,
        resolution: '720p',
        duration: drafts.video.duration,
        firstImage: firstImage && lastImage ? firstImage : '',
        lastImage: firstImage && lastImage ? lastImage : '',
        referenceImages: firstImage && lastImage ? [] : referenceImages.slice(0, 4),
      }),
      signal,
    });
    const result = await response.json() as {
      ok?: boolean;
      code?: string;
      error?: string;
      data?: { url?: string; resultUrl?: string; taskId?: string; contentType?: string; model?: string; provider?: string };
    };
    if (response.status === 428 || result.code === 'CONFIG_REQUIRED') {
      throw new RuntimeConfigurationRequiredError(result.error || '请先配置视频模型 API Key。', ['video-api-key']);
    }
    if (!response.ok || !result.ok || !result.data?.url) throw new Error(result.error || '视频生成失败。');

    emitProgress(.97, '正在保存生成视频');
    sdk.engine.updateNodeData(node.id, {
      preview: result.data.url,
      previewKind: 'video',
      mimeType: result.data.contentType || 'video/mp4',
      fileName: `${result.data.taskId || 'generated-video'}.mp4`,
      providerTaskId: result.data.taskId || '',
      provider: result.data.provider || 'tmlab-tasks',
      model: result.data.model || 'seedance-2.0-pro(431)',
      generatedAt: new Date().toISOString(),
      previewOrigin: 'generated',
      resultUrl: result.data.resultUrl || '',
      effectivePrompt: prompt,
    });
    emitProgress(1, '视频生成完成');
    return {
      video: {
        kind: 'video', url: result.data.resultUrl || result.data.url, remoteUrl: result.data.resultUrl,
        preview: result.data.url, taskId: result.data.taskId, model: result.data.model, prompt,
      },
    };
  },
};

sdk = new FlowCanvasSDK({
  container: '#root',
  graph: demoGraph,
  includeBuiltinNodes: true,
  nodeTypes: [realImageDefinition, realVideoDefinition],
  theme: new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark',
  autosave: graph => localStorage.setItem('flowcanvas-demo', JSON.stringify(graph)),
  services: {
    configuration: { onRequired: () => openConfiguration() },
  },
});

Object.assign(window, { flowCanvas: sdk });
void refreshConfiguration();
