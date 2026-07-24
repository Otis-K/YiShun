(function createYishunWebApi() {
  'use strict';

  if (window.toolplus || location.protocol === 'file:') return;

  const progressListeners = new Set();
  const activeTasks = new Map();

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      });
    } catch (_) {
      throw new Error('衣瞬 Web 服务未连接，请使用 npm run web 启动完整服务。');
    }
    const type = response.headers.get('content-type') || '';
    const result = type.includes('application/json') ? await response.json() : { ok: false, error: await response.text() };
    if (!response.ok || result.ok === false) throw new Error(result.error || `Web API 请求失败（${response.status}）`);
    return result;
  }

  function bytesToBase64(value) {
    let bytes;
    if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
    else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    else return '';
    const chunkSize = 0x8000;
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  function serializeModel(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    const serialized = { ...source };
    const image = source.image && typeof source.image === 'object' ? source.image : null;
    if (image && (image.bytes instanceof ArrayBuffer || ArrayBuffer.isView(image.bytes))) {
      serialized.image = { ...image, bytes: undefined, bytesBase64: bytesToBase64(image.bytes) };
    } else {
      delete serialized.image;
    }
    return serialized;
  }

  function serializePayload(payload) {
    const source = payload && typeof payload === 'object' ? payload : {};
    return {
      ...source,
      localAssets: (Array.isArray(source.localAssets) ? source.localAssets : []).map(asset => ({
        name: String(asset && asset.name || ''),
        kind: String(asset && asset.kind || ''),
        role: String(asset && asset.role || 'reference'),
        mimeType: String(asset && asset.mimeType || ''),
        bytesBase64: bytesToBase64(asset && asset.bytes),
      })),
    };
  }

  function generatedFilePath(value) {
    const source = String(value || '').trim();
    let url;
    try { url = new URL(source, location.href); }
    catch (_) { throw new Error('生成结果地址无效。'); }
    if (url.origin !== location.origin || !/^\/api\/files\/(image|video)\/[^/]+$/.test(url.pathname)) {
      throw new Error('只能保存当前衣瞬服务生成的结果文件。');
    }
    return url.pathname;
  }

  function emitProgress(requestId, task) {
    const event = {
      requestId,
      status: String(task.status || 'running'),
      progress: Math.max(0, Math.min(1, Number(task.progress) || 0)),
      message: String(task.message || '模型平台处理中'),
    };
    progressListeners.forEach(listener => {
      try { listener(event); } catch (_) {}
    });
  }

  async function generate(action, payload) {
    const requestId = String(payload && payload._requestId || `web-${Date.now()}`);
    const created = await request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ action, payload: serializePayload(payload) }),
    });
    const taskId = created.task.id;
    activeTasks.set(requestId, taskId);
    try {
      for (;;) {
        const snapshot = await request(`/api/tasks/${encodeURIComponent(taskId)}`);
        emitProgress(requestId, snapshot.task);
        if (snapshot.task.state === 'completed') return snapshot.task.result;
        if (snapshot.task.state === 'failed') return { ok: false, error: snapshot.task.error || '生成失败。' };
        if (snapshot.task.state === 'cancelled') return { ok: false, cancelled: true, error: '生成任务已取消。' };
        await new Promise(resolve => setTimeout(resolve, 850));
      }
    } finally {
      activeTasks.delete(requestId);
    }
  }

  window.yishunWebApi = {
    authSession: () => request('/api/auth/session'),
    authLogout: () => request('/api/auth/logout', { method: 'POST' }),
    canvasModelConfigGet: () => request('/api/model-config'),
    canvasModelConfigSave: payload => request('/api/model-config', { method: 'PUT', body: JSON.stringify(payload || {}) }),
    modelLibraryList: () => request('/api/model-library'),
    modelLibraryCreate: payload => request('/api/model-library', { method: 'POST', body: JSON.stringify(serializeModel(payload)) }),
    modelLibraryUpdate: (modelId, payload) => request(`/api/model-library/${encodeURIComponent(String(modelId || ''))}`, { method: 'PUT', body: JSON.stringify(serializeModel(payload)) }),
    modelLibraryDelete: modelId => request(`/api/model-library/${encodeURIComponent(String(modelId || ''))}`, { method: 'DELETE' }),
    async modelLibraryRead(modelId) {
      const result = await request(`/api/model-library/${encodeURIComponent(String(modelId || ''))}`);
      const image = result.model && result.model.image || {};
      return { ...result, model: { ...result.model, image: { ...image, bytesBase64: undefined, bytes: base64ToBytes(image.bytesBase64) } } };
    },
    canvasImageGenerate: payload => generate('image.generate', payload),
    canvasVideoGenerate: payload => generate('video.generate', payload),
    canvasGeneratedFileSave(payload) {
      const source = payload && typeof payload === 'object' ? payload : {};
      return request('/api/files/save', {
        method: 'POST',
        body: JSON.stringify({ ...source, sourceUrl: generatedFilePath(source.sourceUrl) }),
      });
    },
    async canvasGenerationCancel(requestId) {
      const taskId = activeTasks.get(String(requestId || ''));
      if (!taskId) return { ok: true, cancelled: false };
      return request(`/api/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
    },
    onCanvasGenerationProgress(listener) {
      if (typeof listener !== 'function') return () => {};
      progressListeners.add(listener);
      return () => progressListeners.delete(listener);
    },
  };
})();
