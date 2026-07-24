(function bootstrapToolPlusFlowCanvas() {
  'use strict';

  const FlowCanvas = window.FlowCanvas;
  if (!FlowCanvas || typeof FlowCanvas.FlowCanvasSDK !== 'function') {
    throw new Error('FlowCanvas SDK 未加载，请检查本地 vendor 产物。');
  }

  const host = document.querySelector('#flowcanvas-host');
  const connection = document.querySelector('#canvas-connection');
  const toast = document.querySelector('#canvas-toast');
  const LOCAL_GRAPH_KEY = 'toolplus.flowcanvas.local.v2';
  const LEGACY_GRAPH_KEYS = ['toolplus.flowcanvas.graph.v1'];
  const LOCAL_NODE_TYPES = new Set([
    'prompt',
    'blank',
    'image',
    'video',
    'audio',
    'compose',
    'text_input',
    'json_input',
    'local_asset',
    'text_transform',
    'merge',
    'delay',
    'output'
  ]);
  const REMOVED_NODE_TYPE_MAP = Object.freeze(Object.assign(Object.create(null), {
    note: 'text_input',
    text: 'text_input',
    image_generation: 'image',
    video_generation: 'video',
    audio_generation: 'audio',
    agent: 'text_transform'
  }));

  let sdk;
  let toastTimer;
  let lastRun;
  let hostMode = 'local';
  const hostRequests = new Map();

  function id(prefix) {
    const suffix = window.crypto && typeof window.crypto.randomUUID === 'function'
      ? window.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${suffix}`;
  }

  function finite(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function plainClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function fileNameOnly(value) {
    return String(value || '').split(/[\\/]/).pop() || '';
  }

  function mediaKindFromMime(mimeType) {
    const value = String(mimeType || '');
    if (value.startsWith('image/')) return 'image';
    if (value.startsWith('video/')) return 'video';
    if (value.startsWith('audio/')) return 'audio';
    if (value.startsWith('text/')) return 'text';
    return 'file';
  }

  function createObjectUrl(file) {
    if (!file || !window.URL || typeof window.URL.createObjectURL !== 'function') return '';
    try {
      return window.URL.createObjectURL(file);
    } catch (_) {
      return '';
    }
  }

  function showToast(message, timeout = 4200) {
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = String(message || '');
    toast.hidden = false;
    toastTimer = window.setTimeout(() => { toast.hidden = true; }, timeout);
  }

  function requestHost(action, payload, signal, onProgress) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(new DOMException('Workflow execution was cancelled.', 'AbortError'));
        return;
      }
      const requestId = id('host');
      const timer = window.setTimeout(() => {
        hostRequests.delete(requestId);
        reject(new Error('图片后端响应超时。'));
      }, 16 * 60 * 1000);
      const onAbort = () => {
        window.clearTimeout(timer);
        hostRequests.delete(requestId);
        window.parent.postMessage({ type: 'toolplus:canvas-cancel', requestId }, '*');
        reject(new DOMException('Workflow execution was cancelled.', 'AbortError'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      hostRequests.set(requestId, {
        progress: typeof onProgress === 'function' ? onProgress : null,
        resolve(value) {
          window.clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        reject(error) {
          window.clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          reject(error);
        }
      });
      window.parent.postMessage({ type: 'toolplus:canvas-request', requestId, action, payload }, '*');
    });
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const message = event.data;
    if (message && message.type === 'yishun:host-mode') {
      hostMode = message.mode === 'web' ? 'web' : 'local';
      if (hostMode === 'web') updateLocalStatus('衣瞬 Web 画布', '画布保存在此浏览器 · 模型请求由衣瞬 Web API 安全代理', 'local');
      return;
    }
    if (message && message.type === 'toolplus:canvas-progress' && message.requestId) {
      const pending = hostRequests.get(message.requestId);
      if (pending && pending.progress) pending.progress(clamp(finite(message.progress, 0), 0, 1), String(message.message || '模型平台处理中'));
      return;
    }
    if (!message || message.type !== 'toolplus:canvas-response' || !message.requestId) return;
    const pending = hostRequests.get(message.requestId);
    if (!pending) return;
    hostRequests.delete(message.requestId);
    if (message.result && message.result.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.result && message.result.error || '图片后端调用失败。'));
  });

  function updateLocalStatus(title, detail, kind = 'local') {
    if (!connection) return;
    if (hostMode === 'web' && kind !== 'error') {
      if (title === '本地画布') title = '衣瞬 Web 画布';
      detail = title === '正在保存'
        ? '正在保存到此浏览器'
        : '画布保存在此浏览器 · 模型请求由衣瞬 Web API 安全代理';
    }
    connection.className = `canvasConnection is-${kind}`;
    const strong = connection.querySelector('strong');
    const small = connection.querySelector('small');
    if (strong) strong.textContent = title;
    if (small) small.textContent = detail;
  }

  function createEmptyGraph(name = 'Tool Plus 本地工作流') {
    return {
      schemaVersion: 1,
      id: 'toolplus-local',
      name,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      metadata: {
        host: 'tool-plus',
        persistence: 'local-only',
        networkAccess: false
      }
    };
  }

  function sanitizeNodeData(input, warnings, nodeId) {
    const source = input && typeof input === 'object' && !Array.isArray(input)
      ? plainClone(input)
      : {};
    const removedKeys = [
      'localPath', 'local_path', 'absolutePath', 'path', 'url', 'fileId', 'file_id',
      'accessToken', 'token', 'gatewayUrl', 'sessionId', 'canvasId'
    ];
    for (const key of removedKeys) {
      if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
      if ((key === 'localPath' || key === 'local_path' || key === 'absolutePath' || key === 'path') && !source.fileName) {
        source.fileName = fileNameOnly(source[key]);
      }
      delete source[key];
      if (warnings) warnings.push(`节点 ${nodeId || ''} 的旧外部字段 ${key} 已移除`.trim());
    }
    source.title = String(source.title || '本地节点');
    if (source.description !== undefined) source.description = String(source.description);
    if (source.prompt !== undefined) source.prompt = String(source.prompt);
    source.status = ['idle', 'queued', 'running', 'success', 'error', 'cancelled'].includes(source.status)
      ? source.status
      : 'idle';
    source.retryCount = clamp(Math.trunc(finite(source.retryCount, 0)), 0, 3);
    source.cache = Boolean(source.cache);
    if (source.generationDrafts && source.generationDrafts.image
      && typeof source.generationDrafts.image === 'object') {
      if (!String(source.generationDrafts.image.model || '').trim()) source.generationDrafts.image.model = 'nano-banana-pro(特价版 1)';
      source.generationDrafts.image.count = 1;
    }
    if (source.generationDrafts && source.generationDrafts.video
      && typeof source.generationDrafts.video === 'object') {
      if (!String(source.generationDrafts.video.model || '').trim()) source.generationDrafts.video.model = 'seedance-2.0-pro(431)';
    }
    return source;
  }

  function mapLegacyType(type, data, warnings, nodeId) {
    const original = String(type || 'text_input');
    const legacyGeneratedArtifact = original === 'local_asset'
      && ['image', 'video', 'audio'].includes(String(data.migratedOriginalType || ''))
      && (/^task[_-]/i.test(String(data.fileName || data.title || ''))
        || Boolean(String(data.prompt || '').trim() && data.preview));
    const restoredGenerationType = original === 'local_asset'
      && ['image', 'video', 'audio'].includes(String(data.migratedOriginalType || ''))
      && (data.previewOrigin === 'generated' || data.generatedAt || data.providerTaskId || legacyGeneratedArtifact)
      ? String(data.migratedOriginalType)
      : '';
    const generationIdentity = Boolean(
      data.generationMode || data.generationDrafts || data.previewOrigin === 'generated'
      || data.generatedAt || data.providerTaskId
    );
    const localAsset = ['image', 'video', 'audio'].includes(original)
      && !generationIdentity
      && Boolean(data.fileName || data.mimeType || Number(data.size) > 0);
    const mapped = restoredGenerationType || (localAsset
      ? 'local_asset'
      : Object.prototype.hasOwnProperty.call(REMOVED_NODE_TYPE_MAP, original)
      ? REMOVED_NODE_TYPE_MAP[original]
      : original);
    if (mapped !== original) {
      data.migratedOriginalType = original;
      if (original === 'agent') {
        data.description = '旧联网节点已迁移为本地模板变换；不会请求任何生成服务。';
        if (!String(data.prompt || '').includes('{{input}}')) {
          data.prompt = String(data.prompt || '{{input}}');
        }
      } else if (['image_generation', 'video_generation', 'audio_generation'].includes(original)) {
        data.description = '旧生成节点已迁移为新版纯本地生成参数节点；不会请求任何在线服务。';
      } else if (restoredGenerationType) {
        data.description = '已恢复误迁移的生成节点；生成参数与结果继续保留。';
      } else if (localAsset) {
        data.description = '旧素材节点已迁移为仅保存安全元数据的本地素材节点。';
      }
      warnings.push(`节点 ${nodeId || ''}：${original} 已迁移为 ${mapped}`.trim());
    }
    return mapped;
  }

  function normalizeLocalAssetData(data) {
    const kind = mediaKindFromMime(data.mimeType || '') !== 'file'
      ? mediaKindFromMime(data.mimeType || '')
      : ['image', 'video', 'audio'].includes(data.previewKind) ? data.previewKind : 'file';
    // Old documents sometimes persisted a generation panel on a material
    // node. That made an image asset look like a completed generation node
    // while its real definition still exposed a JSON output.
    for (const key of [
      'generationMode', 'generationDrafts', 'providerTaskId', 'provider',
      'generatedAt', 'runMessage', 'runError'
    ]) delete data[key];
    data.title = String(data.fileName || `${kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '本地'}素材`);
    data.description = `本地${kind === 'image' ? '图片' : kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文件'}素材，可连接到生成节点的兼容输入端口。`;
    data.status = 'idle';
    data.progress = 0;
    data.cache = false;
  }

  function normalizeNode(rawNode, index, warnings) {
    const raw = rawNode && typeof rawNode === 'object' ? rawNode : {};
    const rawData = raw.data && typeof raw.data === 'object' && !Array.isArray(raw.data)
      ? plainClone(raw.data)
      : {};
    if (raw.text !== undefined && rawData.prompt === undefined) rawData.prompt = String(raw.text);
    if (raw.prompt !== undefined && rawData.prompt === undefined) rawData.prompt = String(raw.prompt);
    if (raw.title !== undefined && rawData.title === undefined) rawData.title = String(raw.title);
    if (raw.description !== undefined && rawData.description === undefined) rawData.description = String(raw.description);
    for (const key of ['localPath', 'local_path', 'absolutePath', 'path', 'url', 'fileId', 'file_id']) {
      if (raw[key] !== undefined && rawData[key] === undefined) rawData[key] = raw[key];
    }
    const nodeId = String(raw.id || `legacy-node-${index + 1}`);
    const data = sanitizeNodeData(rawData, warnings, nodeId);
    const type = mapLegacyType(raw.type, data, warnings, nodeId);
    if (type === 'local_asset') normalizeLocalAssetData(data);
    if (!LOCAL_NODE_TYPES.has(type)) warnings.push(`保留了未注册的本地扩展节点类型：${type}`);
    const position = raw.position && typeof raw.position === 'object' ? raw.position : raw;
    const normalized = {
      id: nodeId,
      type,
      position: {
        x: finite(position.x, 0),
        y: finite(position.y, 0)
      },
      data,
      width: Math.max(120, finite(raw.w ?? raw.width, 280)),
      height: Math.max(72, finite(raw.h ?? raw.height, 180))
    };
    if (raw.parentId || raw.parent_id) normalized.parentId = String(raw.parentId || raw.parent_id);
    if (raw.locked === true) normalized.locked = true;
    return normalized;
  }

  function normalizeEdges(rawEdges, nodes, warnings) {
    const nodeIds = new Set(nodes.map(node => node.id));
    const edgeIds = new Set();
    const edges = [];
    for (const [index, rawEdge] of (Array.isArray(rawEdges) ? rawEdges : []).entries()) {
      const edge = rawEdge && typeof rawEdge === 'object' ? rawEdge : {};
      const source = String(edge.source || edge.source_id || '');
      const target = String(edge.target || edge.target_id || '');
      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target) || source === target) {
        warnings.push(`已跳过无效连线 #${index + 1}`);
        continue;
      }
      let edgeId = String(edge.id || `legacy-edge-${index + 1}`);
      if (edgeIds.has(edgeId)) edgeId = `${edgeId}-${index + 1}`;
      edgeIds.add(edgeId);
      edges.push({
        id: edgeId,
        source,
        sourcePort: String(edge.sourcePort || edge.source_port || 'output'),
        target,
        targetPort: String(edge.targetPort || edge.target_port || 'input'),
        ...(edge.label ? { label: String(edge.label) } : {}),
        data: edge.data && typeof edge.data === 'object' && !Array.isArray(edge.data)
          ? plainClone(edge.data)
          : {}
      });
    }
    return edges;
  }

  function normalizeGraph(input, fallbackName) {
    const source = input && typeof input === 'object' ? input : {};
    const warnings = [];
    const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
    const nodes = rawNodes.map((node, index) => normalizeNode(node, index, warnings));
    const seen = new Set();
    nodes.forEach((node, index) => {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        return;
      }
      const previous = node.id;
      node.id = `${previous}-${index + 1}`;
      seen.add(node.id);
      warnings.push(`重复节点 ID ${previous} 已重命名`);
    });
    const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {};
    const metadata = source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
      ? plainClone(source.metadata)
      : {};
    for (const key of ['gatewayUrl', 'sessionId', 'canvasId', 'accessToken', 'token', 'remoteReady']) delete metadata[key];
    metadata.host = 'tool-plus';
    metadata.persistence = 'local-only';
    metadata.networkAccess = false;
    return {
      graph: {
        schemaVersion: 1,
        id: String(source.id || source.canvas_id || 'toolplus-local'),
        name: String(source.name || source.title || fallbackName || 'Tool Plus 本地工作流'),
        nodes,
        edges: normalizeEdges(source.edges, nodes, warnings),
        viewport: {
          x: finite(viewport.x, 0),
          y: finite(viewport.y, 0),
          zoom: clamp(finite(viewport.zoom ?? viewport.scale, 1), 0.1, 4)
        },
        metadata
      },
      warnings
    };
  }

  function legacyToGraph(input, detailName) {
    const normalized = normalizeGraph(input, detailName);
    normalized.graph.metadata.migratedFrom = 'toolplus_canvas.v1';
    normalized.graph.metadata.migrationWarnings = normalized.warnings;
    return normalized;
  }

  function graphToLegacy(graph) {
    const normalized = normalizeGraph(graph).graph;
    return {
      schema_version: 'toolplus_canvas.v1',
      canvas_id: normalized.id,
      title: normalized.name,
      viewport: {
        x: normalized.viewport.x,
        y: normalized.viewport.y,
        scale: normalized.viewport.zoom
      },
      nodes: normalized.nodes.map(node => ({
        id: node.id,
        type: node.type,
        title: String(node.data.title || node.type),
        x: node.position.x,
        y: node.position.y,
        w: node.width || 280,
        h: node.height || 180,
        text: String(node.data.prompt || ''),
        status: String(node.data.status || 'idle'),
        retryCount: clamp(Math.trunc(finite(node.data.retryCount, 0)), 0, 3),
        data: sanitizeNodeData(node.data),
        ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(node.locked ? { locked: true } : {})
      })),
      edges: normalized.edges.map(edge => ({
        id: edge.id,
        source: edge.source,
        sourcePort: edge.sourcePort,
        target: edge.target,
        targetPort: edge.targetPort,
        label: edge.label || '',
        data: edge.data || {}
      })),
      metadata: plainClone(normalized.metadata),
      updated_at: new Date().toISOString()
    };
  }

  function writeLocalGraph(graph) {
    const cleanGraph = normalizeGraph(graph).graph;
    window.localStorage.setItem(LOCAL_GRAPH_KEY, JSON.stringify(cleanGraph));
    return cleanGraph;
  }

  function readLocalGraph() {
    const candidates = [LOCAL_GRAPH_KEY, ...LEGACY_GRAPH_KEYS];
    for (const key of candidates) {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const normalized = parsed && parsed.schema_version === 'toolplus_canvas.v1'
          ? legacyToGraph(parsed)
          : normalizeGraph(parsed);
        writeLocalGraph(normalized.graph);
        if (key !== LOCAL_GRAPH_KEY) window.localStorage.removeItem(key);
        if (normalized.warnings.length) {
          window.setTimeout(() => showToast(`旧画布已安全迁移：${normalized.warnings.slice(0, 3).join('；')}`, 7000), 0);
        }
        return normalized.graph;
      } catch (error) {
        window.localStorage.removeItem(key);
        window.setTimeout(() => showToast(`已忽略无效的本地画布数据：${error.message}`, 6500), 0);
      }
    }
    return createEmptyGraph();
  }

  function toText(value) {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return '';
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function baseData(title, description, prompt = '') {
    return { title, description, prompt, status: 'idle', retryCount: 0, cache: false };
  }

  function abortableDelay(ms, signal, emitProgress) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException('Workflow execution was cancelled.', 'AbortError'));
        return;
      }
      const started = performance.now();
      let progressTimer;
      const cleanup = () => {
        window.clearTimeout(doneTimer);
        window.clearInterval(progressTimer);
        signal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(new DOMException('Workflow execution was cancelled.', 'AbortError'));
      };
      const doneTimer = window.setTimeout(() => {
        cleanup();
        emitProgress(1, '本地等待完成');
        resolve();
      }, ms);
      if (ms > 100) {
        progressTimer = window.setInterval(() => {
          emitProgress(Math.min(0.95, (performance.now() - started) / ms), '本地等待中');
        }, Math.min(250, Math.max(50, ms / 10)));
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  const builtinImageDefinition = Array.isArray(FlowCanvas.builtinNodeDefinitions)
    ? FlowCanvas.builtinNodeDefinitions.find(definition => definition.type === 'image')
    : null;

  const imageDefinition = builtinImageDefinition ? {
    ...builtinImageDefinition,
    execute: async ({ node, inputs, signal, emitProgress, forceRefresh }) => {
      const drafts = node.data && node.data.generationDrafts && typeof node.data.generationDrafts === 'object'
        ? node.data.generationDrafts
        : {};
      const draft = drafts.image && typeof drafts.image === 'object' ? drafts.image : {};
      const promptInput = typeof inputs.prompt === 'string' ? inputs.prompt : '';
      const ownPrompt = String(promptInput || draft.prompt || node.data.prompt || '').trim();
      const existingPreview = String(node.data.preview || '').trim();
      if (!forceRefresh && node.data.status === 'success' && existingPreview) {
        emitProgress(1, '复用已完成的上游图片');
        return { image: { kind: 'image', url: existingPreview, preview: existingPreview, localPath: node.data.localPath || '', prompt: ownPrompt, model: node.data.model || draft.model || '' } };
      }
      if (!ownPrompt) throw new Error('图片生成提示词不能为空。');
      const quality = String(draft.quality || node.data.quality || '标准画质 · 2K');
      const sizeMatch = quality.match(/\b(1K|2K|4K)\b/i);
      const inputReferences = Array.isArray(inputs.reference)
        ? inputs.reference
        : inputs.reference ? [inputs.reference] : [];
      const candidates = [...(Array.isArray(draft.references) ? draft.references : []), ...inputReferences];
      const upstreamPrompts = [...new Set(inputReferences.map(value => value && typeof value === 'object' ? String(value.prompt || '').trim() : '').filter(Boolean))];
      const prompt = [ownPrompt, upstreamPrompts.length ? `参考图语义：${upstreamPrompts.join('；')}` : ''].filter(Boolean).join('\n\n');
      const prepared = [];
      const seenReferences = new Set();
      for (const value of candidates) {
        const key = typeof value === 'object' && value
          ? String(value.id || value.resultUrl || value.remoteUrl || value.url || value.localPath || '')
          : String(value || '');
        if (key && seenReferences.has(key)) continue;
        if (key) seenReferences.add(key);
        const item = await prepareVideoReference(value, 'reference');
        if (!item) continue;
        const kind = item.remote ? item.remote.type : item.local.kind;
        if (kind !== 'image') throw new Error('图片生成参考素材仅支持图片。');
        prepared.push(item);
      }
      if (prepared.length > 14) throw new Error('Nano Banana Pro 最多支持 14 张参考图片。');
      const payload = {
        prompt,
        model: String(draft.model || node.data.model || 'nano-banana-pro(特价版 1)'),
        size: sizeMatch ? sizeMatch[1].toUpperCase() : '',
        aspectRatio: String(draft.ratio || node.data.ratio || 'auto'),
        images: prepared.filter(item => item.remote).map(item => item.remote.url),
        localAssets: prepared.filter(item => item.local).map(item => item.local),
        imageReferenceOrder: (() => {
          let remoteIndex = 0;
          let localIndex = 0;
          return prepared.map(item => item.remote
            ? { source: 'remote', index: remoteIndex++ }
            : { source: 'local', index: localIndex++ });
        })(),
        parameters: node.data.parameters && typeof node.data.parameters === 'object' ? node.data.parameters : {}
      };
      emitProgress(0.05, '提交图片生成任务');
      const result = await requestHost('image.generate', payload, signal, emitProgress);
      const data = result.data || {};
      if (!data.url) throw new Error('图片平台未返回结果地址。');
      emitProgress(0.95, '保存生成图片');
      sdk.engine.updateNodeData(node.id, {
        preview: data.url,
        previewKind: 'image',
        mimeType: data.contentType || 'image/png',
        fileName: fileNameOnly(data.localPath) || 'generated-image.png',
        providerTaskId: data.taskId || '',
        provider: data.provider || '',
        model: data.model || payload.model,
        generatedAt: new Date().toISOString(),
        previewOrigin: 'generated',
        localPath: data.localPath || '',
        upstreamPrompts,
        effectivePrompt: prompt
      });
      emitProgress(1, '图片生成完成');
      return {
        image: {
          kind: 'image',
          url: data.resultUrl || data.remoteUrl || data.url,
          preview: data.url,
          remoteUrl: data.resultUrl || data.remoteUrl || '',
          localPath: data.localPath,
          taskId: data.taskId,
          model: data.model || payload.model,
          prompt: ownPrompt,
          effectivePrompt: prompt
        }
      };
    }
  } : null;

  const builtinVideoDefinition = Array.isArray(FlowCanvas.builtinNodeDefinitions)
    ? FlowCanvas.builtinNodeDefinitions.find(definition => definition.type === 'video')
    : null;

  function mediaURL(value) {
    if (typeof value === 'string') return /^https?:\/\//i.test(value.trim()) ? value.trim() : '';
    if (!value || typeof value !== 'object') return '';
    for (const candidate of [value.resultUrl, value.remoteUrl, value.url, value.preview]) {
      if (typeof candidate === 'string' && /^https?:\/\//i.test(candidate.trim())) return candidate.trim();
    }
    return '';
  }

  function mediaType(value) {
    if (!value || typeof value !== 'object') return 'image';
    if (['image', 'video', 'audio'].includes(value.kind)) return value.kind;
    return mediaKindFromMime(value.mimeType || '');
  }

  function mediaSource(value) {
    if (!value || typeof value !== 'object') return '';
    for (const candidate of [value.url, value.preview]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    }
    return '';
  }

  function inputValues(value) {
    if (Array.isArray(value)) return value.flatMap(item => inputValues(item));
    return value ? [value] : [];
  }

  async function prepareVideoReference(value, role) {
    const remoteURL = mediaURL(value);
    const kind = mediaType(value);
    // A video/audio edge may land on the compact "首帧 / 参考素材" handle.
    // It remains a reference of its real media kind; only images can become
    // Seedance first/last frames.
    const effectiveRole = (role === 'firstFrame' || role === 'lastFrame') && kind !== 'image' ? 'reference' : role;
    if (remoteURL) return { remote: { url: remoteURL, type: kind, role: effectiveRole } };
    if (!value || typeof value !== 'object') return null;
    const localPath = typeof value.localPath === 'string' ? value.localPath.trim() : '';
    if (localPath) {
      return { local: { localPath, kind, role: effectiveRole, name: fileNameOnly(value.fileName || localPath), mimeType: String(value.mimeType || '') } };
    }
    const source = mediaSource(value);
    if (!source || (!source.startsWith('blob:') && !source.startsWith('data:'))) return null;
    const response = await window.fetch(source);
    if (!response.ok) throw new Error(`读取本地素材失败（${response.status}）。`);
    const blob = await response.blob();
    if (!blob.size) throw new Error('本地素材内容为空。');
    return { local: {
      bytes: await blob.arrayBuffer(), kind, role: effectiveRole,
      name: fileNameOnly(value.name || value.fileName || `${role}-${Date.now()}`),
      mimeType: String(value.mimeType || blob.type || '')
    } };
  }

  const videoDefinition = builtinVideoDefinition ? {
    ...builtinVideoDefinition,
    execute: async ({ node, inputs, signal, emitProgress, forceRefresh }) => {
      const drafts = node.data && node.data.generationDrafts && typeof node.data.generationDrafts === 'object'
        ? node.data.generationDrafts : {};
      const draft = drafts.video && typeof drafts.video === 'object' ? drafts.video : {};
      const inputPrompt = typeof inputs.prompt === 'string'
        ? inputs.prompt
        : inputs.prompt && typeof inputs.prompt === 'object' && typeof inputs.prompt.text === 'string' ? inputs.prompt.text : '';
      const ownPrompt = String(inputPrompt || draft.prompt || node.data.prompt || '').trim();
      const existingPreview = String(node.data.preview || '').trim();
      if (!forceRefresh && node.data.status === 'success' && existingPreview) {
        emitProgress(1, '复用已完成的上游视频');
        return { video: { kind: 'video', url: existingPreview, preview: existingPreview, localPath: node.data.localPath || '', prompt: ownPrompt, model: node.data.model || draft.model || '' } };
      }
      if (!ownPrompt) throw new Error('视频生成提示词不能为空。');
      const prompt = ownPrompt;
      const connectedPrimary = inputValues(inputs.image);
      const connectedLast = inputValues(inputs.lastFrame);
      let firstFrame = draft.firstFrame || null;
      let lastFrame = draft.lastFrame || null;
      const connectedReferences = [];
      for (const value of connectedPrimary) {
        if (mediaType(value) === 'image' && !firstFrame) firstFrame = value;
        else if (mediaType(value) === 'image' && !lastFrame) lastFrame = value;
        else connectedReferences.push(value);
      }
      for (const value of connectedLast) {
        if (mediaType(value) === 'image' && !lastFrame) lastFrame = value;
        else connectedReferences.push(value);
      }
      const candidates = [
        { value: firstFrame, role: 'firstFrame' },
        { value: lastFrame, role: 'lastFrame' },
        ...connectedReferences.map(value => ({ value, role: 'reference' })),
        ...(Array.isArray(draft.references) ? draft.references.map(value => ({ value, role: 'reference' })) : [])
      ].filter(item => item.value);
      const seen = new Set();
      const prepared = [];
      for (const candidate of candidates) {
        const key = typeof candidate.value === 'object' && candidate.value
          ? String(candidate.value.id || candidate.value.url || candidate.value.localPath || '')
          : String(candidate.value || '');
        if (key && seen.has(`${candidate.role}:${key}`)) continue;
        if (key) seen.add(`${candidate.role}:${key}`);
        const item = await prepareVideoReference(candidate.value, candidate.role);
        if (item) prepared.push(item);
      }
      const allKinds = prepared.map(item => item.remote ? item.remote.type : item.local.kind);
      // The UI deliberately has no separate generation-mode selector. The
      // request mode is derived from the actual materials so stale saved data
      // can never contradict what the user selected on the canvas.
      let modeType = 'text2video';
      if (allKinds.includes('video')) {
        modeType = 'mixed2video';
      } else if (prepared.some(item => (item.remote || item.local).role === 'firstFrame' || (item.remote || item.local).role === 'lastFrame')) {
        modeType = 'image2video';
      } else if (prepared.length) {
        modeType = allKinds.every(kind => kind === 'image' || kind === 'audio') && allKinds.includes('image') ? 'image2video' : 'mixed2video';
      }
      const publicReferences = prepared.filter(item => item.remote).map(item => item.remote);
      const localAssets = prepared.filter(item => item.local).map(item => item.local);
      const model = String(draft.model || node.data.model || 'seedance-2.0-pro(431)');
      const isPro431 = model === 'seedance-2.0-pro(431)';
      const initialHasFirst = prepared.some(item => (item.remote || item.local).role === 'firstFrame');
      const initialHasLast = prepared.some(item => (item.remote || item.local).role === 'lastFrame');
      // The real Pro(431) upstream rejects a lone first_image. A single image
      // is therefore a reference image; only a first+last pair is frame mode.
      if (isPro431 && initialHasFirst && !initialHasLast) {
        prepared.forEach(item => {
          const material = item.remote || item.local;
          if (material.role === 'firstFrame') material.role = 'reference';
        });
      }
      const imageCount = prepared.filter(item => (item.remote ? item.remote.type : item.local.kind) === 'image').length;
      const audioCount = prepared.filter(item => (item.remote ? item.remote.type : item.local.kind) === 'audio').length;
      const videoCount = prepared.filter(item => (item.remote ? item.remote.type : item.local.kind) === 'video').length;
      const hasFrames = prepared.some(item => (item.remote || item.local).role === 'firstFrame' || (item.remote || item.local).role === 'lastFrame');
      const hasFirst = prepared.some(item => (item.remote || item.local).role === 'firstFrame');
      const hasLast = prepared.some(item => (item.remote || item.local).role === 'lastFrame');
      if (isPro431) {
        if (hasLast && !hasFirst) throw new Error('Seedance Pro(431) 使用尾帧时必须同时提供首帧。');
        if (hasFrames && prepared.some(item => (item.remote || item.local).role === 'reference')) throw new Error('Seedance Pro(431) 首尾帧模式不能同时使用参考素材。');
        if (!hasFrames && imageCount > 4) throw new Error('Seedance Pro(431) 最多支持 4 张参考图片。');
        if (videoCount > 3) throw new Error('Seedance Pro(431) 最多支持 3 个参考视频。');
        if (audioCount > 1) throw new Error('Seedance Pro(431) 最多支持 1 段参考音频。');
      } else {
        if (modeType === 'image2video' && imageCount > 9) throw new Error('Seedance image2video 最多支持 9 张图片（包含首帧和尾帧）。');
        if (modeType === 'image2video' && audioCount > 3) throw new Error('Seedance image2video 最多支持 3 条参考音频。');
        if (modeType === 'mixed2video' && prepared.length > 15) throw new Error('Seedance mixed2video 最多支持 15 项混合素材。');
      }
      const payload = {
        prompt,
        model,
        modeType,
        ratio: String(draft.ratio || node.data.ratio || '16:9'),
        resolution: isPro431 ? '720p' : String(draft.resolution || node.data.resolution || '480p').toLowerCase(),
        duration: Number(draft.duration || node.data.duration || 5),
        enableSound: isPro431 ? 'off' : String(draft.enableSound || node.data.enableSound || 'off'),
        imageUrls: !isPro431 && modeType === 'image2video' ? publicReferences.filter(item => item.type === 'image').map(item => item.url) : [],
        audioUrls: !isPro431 && modeType === 'image2video' ? publicReferences.filter(item => item.type === 'audio').map(item => item.url) : [],
		mixedList: !isPro431 && modeType === 'mixed2video' ? publicReferences.map(item => ({ url: item.url, type: item.type })) : [],
		firstImage: isPro431 && hasFirst && hasLast ? publicReferences.find(item => item.role === 'firstFrame')?.url || '' : '',
		lastImage: isPro431 ? publicReferences.find(item => item.role === 'lastFrame')?.url || '' : '',
		referenceImages: isPro431 ? publicReferences.filter(item => item.type === 'image' && (item.role === 'reference' || (item.role === 'firstFrame' && !hasLast))).map(item => item.url) : [],
		referenceVideos: isPro431 ? publicReferences.filter(item => item.role === 'reference' && item.type === 'video').map(item => item.url) : [],
		referenceAudios: isPro431 ? publicReferences.filter(item => item.role === 'reference' && item.type === 'audio').map(item => item.url) : [],
		localAssets,
        parameters: {}
      };
		if (!isPro431 && modeType === 'image2video' && payload.imageUrls.length === 0 && !localAssets.some(item => item.kind === 'image')) throw new Error('image2video 模式至少需要一张图片（首帧或尾帧）。');
		if (!isPro431 && modeType === 'mixed2video' && payload.mixedList.length === 0 && localAssets.length === 0) throw new Error('mixed2video 模式至少需要一项混合素材。');
      emitProgress(.03, '进入视频生成队列');
      const result = await requestHost('video.generate', payload, signal, emitProgress);
      const data = result.data || {};
      if (!data.url) throw new Error('视频平台未返回结果地址。');
      sdk.engine.updateNodeData(node.id, {
        preview: data.url,
        previewKind: 'video',
        mimeType: data.contentType || 'video/mp4',
        fileName: fileNameOnly(data.localPath) || 'generated-video.mp4',
        providerTaskId: data.taskId || '', provider: data.provider || '',
        model: data.model || payload.model, generatedAt: new Date().toISOString(), localPath: data.localPath || '',
        previewOrigin: 'generated'
      });
      emitProgress(1, '视频生成完成');
      return { video: { kind: 'video', url: data.resultUrl || data.remoteUrl || data.url, preview: data.url, resultUrl: data.resultUrl || '', remoteUrl: data.remoteUrl || '', localPath: data.localPath, taskId: data.taskId, model: data.model || payload.model, prompt: ownPrompt } };
    }
  } : null;

  const NODE_DEFINITIONS = [
    ...(imageDefinition ? [imageDefinition] : []),
    ...(videoDefinition ? [videoDefinition] : []),
    {
      type: 'text_input',
      title: '文本输入',
      category: '输入',
      description: '提供真实的本地文本数据。',
      icon: 'text',
      color: '#8d7cff',
      inputs: [],
      outputs: [{ id: 'output', label: '文本', dataType: 'text', multiple: true }],
      createData: () => baseData('文本输入', '本地文本源', '请输入文本'),
      execute: ({ node, emitProgress }) => {
        emitProgress(1, '文本已读取');
        return { output: String(node.data.prompt || '') };
      }
    },
    {
      type: 'json_input',
      title: 'JSON 输入',
      category: '输入',
      description: '解析本地输入的 JSON，不访问网络。',
      icon: 'text',
      color: '#58b8d8',
      inputs: [],
      outputs: [{ id: 'output', label: 'JSON', dataType: 'json', multiple: true }],
      createData: () => baseData('JSON 输入', '本地 JSON 数据源', '{}'),
      validate: node => {
        try {
          JSON.parse(String(node.data.prompt || ''));
          return [];
        } catch (error) {
          return [{
            code: 'NODE_CONFIGURATION_INVALID',
            severity: 'error',
            nodeId: node.id,
            message: `JSON 无效：${error.message}`
          }];
        }
      },
      execute: ({ node, emitProgress }) => {
        const output = JSON.parse(String(node.data.prompt || ''));
        emitProgress(1, 'JSON 已解析');
        return { output };
      }
    },
    {
      type: 'local_asset',
      title: '本地素材',
      category: '输入',
      description: '本地图片、视频或音频素材，可连接到生成节点的兼容输入端口。',
      icon: 'image',
      color: '#dc7ab6',
      inputs: [],
      outputs: [{ id: 'output', label: '素材', dataType: 'any', multiple: true }],
      createData: () => ({
        ...baseData('本地素材', '仅包含安全的本地素材元数据'),
        fileName: '',
        mimeType: '',
        size: 0,
        lastModified: 0
      }),
      execute: ({ node, emitProgress }) => {
        const kind = mediaKindFromMime(node.data.mimeType || '') !== 'file'
          ? mediaKindFromMime(node.data.mimeType || '')
          : String(node.data.previewKind || node.data.mediaType || 'file');
        emitProgress(1, '本地素材已读取');
        return {
          output: {
            kind,
            url: String(node.data.preview || ''),
            preview: String(node.data.preview || ''),
            name: String(node.data.fileName || node.data.title || ''),
            fileName: String(node.data.fileName || node.data.title || ''),
            mimeType: String(node.data.mimeType || ''),
            size: Math.max(0, finite(node.data.size, 0)),
            lastModified: Math.max(0, finite(node.data.lastModified, 0)),
            prompt: String(node.data.prompt || '')
          }
        };
      }
    },
    {
      type: 'text_transform',
      title: '文本模板变换',
      category: '处理',
      description: '用内容中的 {{input}} 替换上游文本；内容为空时原样传递。',
      icon: 'text',
      color: '#54d6a0',
      inputs: [{ id: 'input', label: '输入', dataType: 'any', required: true }],
      outputs: [{ id: 'output', label: '文本', dataType: 'text', multiple: true }],
      createData: () => baseData('文本模板变换', '使用 {{input}} 引用上游数据', '{{input}}'),
      execute: ({ node, inputs, emitProgress }) => {
        const input = toText(inputs.input);
        const template = String(node.data.prompt || '');
        const output = template ? template.split('{{input}}').join(input) : input;
        emitProgress(1, '模板变换完成');
        return { output };
      }
    },
    {
      type: 'merge',
      title: '合并输入',
      category: '处理',
      description: '按内容中填写的分隔符合并多个上游值。',
      icon: 'text',
      color: '#f0a45d',
      inputs: [{ id: 'input', label: '多个输入', dataType: 'any', required: true, multiple: true }],
      outputs: [{ id: 'output', label: '合并文本', dataType: 'text', multiple: true }],
      createData: () => baseData('合并输入', '内容字段是合并分隔符', '\n'),
      execute: ({ node, inputs, emitProgress }) => {
        const values = Array.isArray(inputs.input) ? inputs.input : [inputs.input];
        const output = values.map(toText).join(String(node.data.prompt ?? '\n'));
        emitProgress(1, `已合并 ${values.length} 项`);
        return { output };
      }
    },
    {
      type: 'delay',
      title: '本地等待',
      category: '控制',
      description: '按内容中的毫秒数等待，可真实取消；范围 0–30000。',
      icon: 'text',
      color: '#f6b85f',
      inputs: [{ id: 'input', label: '输入', dataType: 'any', required: true }],
      outputs: [{ id: 'output', label: '输出', dataType: 'any', multiple: true }],
      createData: () => baseData('本地等待', '可取消的本地延迟，内容为毫秒数', '500'),
      validate: node => {
        const ms = Number(node.data.prompt);
        return Number.isFinite(ms) && ms >= 0 && ms <= 30000
          ? []
          : [{
              code: 'NODE_CONFIGURATION_INVALID',
              severity: 'error',
              nodeId: node.id,
              message: '等待时间必须是 0–30000 毫秒。'
            }];
      },
      async execute({ node, inputs, signal, emitProgress }) {
        const ms = clamp(Number(node.data.prompt), 0, 30000);
        emitProgress(0, '开始本地等待');
        await abortableDelay(ms, signal, emitProgress);
        return { output: inputs.input };
      }
    },
    {
      type: 'output',
      title: '工作流输出',
      category: '输出',
      description: '接收并展示本地 DAG 的最终数据。',
      icon: 'text',
      color: '#7f9cff',
      inputs: [{ id: 'input', label: '输入', dataType: 'any', required: true }],
      outputs: [{ id: 'output', label: '输出', dataType: 'any', multiple: true }],
      createData: () => baseData('工作流输出', '最终结果节点'),
      execute: ({ inputs, emitProgress }) => {
        emitProgress(1, '输出已就绪');
        return { output: inputs.input };
      }
    }
  ];

  const services = {
    assets: {
      accept: 'image/*,video/*,audio/*,text/plain,application/json',
      async pickFiles(request) {
        if (request.signal.aborted) return [];
        return Array.from(request.files || []).map(file => ({
          type: 'local_asset',
          data: {
            ...baseData(file.name, '安全的本地素材元数据'),
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            mediaType: mediaKindFromMime(file.type || 'application/octet-stream'),
            previewKind: mediaKindFromMime(file.type || 'application/octet-stream'),
            preview: ['image', 'video', 'audio'].includes(mediaKindFromMime(file.type || 'application/octet-stream'))
              ? createObjectUrl(file)
              : '',
            size: Number.isFinite(file.size) ? file.size : 0,
            lastModified: Number.isFinite(file.lastModified) ? file.lastModified : 0
          }
        }));
      }
    }
  };

  async function persistGraph(graph) {
    writeLocalGraph(graph);
    updateLocalStatus('本地已保存', '画布存储在此电脑 · 模型请求由本机 Go 后端代理');
  }

  const initialGraph = readLocalGraph();
  sdk = new FlowCanvas.FlowCanvasSDK({
    container: host,
    graph: initialGraph,
    nodeTypes: NODE_DEFINITIONS,
    includeBuiltinNodes: true,
    runtime: new FlowCanvas.LocalWorkflowRuntime({ maxCacheEntries: 256, maxRetries: 3 }),
    theme: 'dark',
    autosave: persistGraph,
    autosaveDelay: 450,
    services,
    onAutosaveStatus(status) {
      if (status.state === 'saving') updateLocalStatus('正在保存', '本地浏览器存储');
      if (status.state === 'error') updateLocalStatus('本地保存失败', String(status.error || '存储空间不可用'), 'error');
    }
  });

  const integrationApi = {
    sdk,
    storageKey: LOCAL_GRAPH_KEY,
    nodeTypes: ['blank', 'prompt', 'image', 'video', 'audio', 'compose', ...NODE_DEFINITIONS.map(definition => definition.type).filter(type => type !== 'image' && type !== 'video')],
    getGraph: () => sdk.getGraph(),
    getLastRun: () => lastRun,
    exportLegacy: () => graphToLegacy(sdk.getGraph()),
    importLegacy(input) {
      const migrated = legacyToGraph(input);
      sdk.import(migrated.graph);
      if (migrated.warnings.length) showToast(migrated.warnings.join('；'), 7000);
      return migrated.warnings;
    },
    importGraph(input) {
      const normalized = normalizeGraph(typeof input === 'string' ? JSON.parse(input) : input);
      sdk.import(normalized.graph);
      return normalized.warnings;
    },
    addNode(type, options = {}) {
      const position = options.position || { x: finite(options.x, 160), y: finite(options.y, 120) };
      const definition = NODE_DEFINITIONS.find(item => item.type === type);
      if (!LOCAL_NODE_TYPES.has(type)) throw new Error(`未知的本地节点类型：${type}`);
      if (!definition) {
        const data = options.data || options.title !== undefined || options.prompt !== undefined
          || options.text !== undefined || options.description !== undefined
          ? sanitizeNodeData({
              ...(options.data || {}),
              ...(options.title !== undefined ? { title: options.title } : {}),
              ...(options.prompt !== undefined || options.text !== undefined
                ? { prompt: options.prompt ?? options.text }
                : {}),
              ...(options.description !== undefined ? { description: options.description } : {})
            })
          : undefined;
        return sdk.addNode(type, position, data);
      }
      const defaults = definition.createData();
      const data = sanitizeNodeData({
        ...defaults,
        ...(options.data || {}),
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.prompt !== undefined || options.text !== undefined
          ? { prompt: options.prompt ?? options.text }
          : {}),
        ...(options.description !== undefined ? { description: options.description } : {})
      });
      return sdk.addNode(type, position, data);
    },
    addText(text = '新建文本节点') {
      return this.addNode('text_input', { text });
    },
    save() {
      writeLocalGraph(sdk.getGraph());
      return sdk.flushAutosave();
    },
    async run(options) {
      lastRun = await sdk.run(options);
      return lastRun;
    },
    cancel: () => sdk.cancel(),
    undo: () => sdk.undo(),
    redo: () => sdk.redo(),
    reset() {
      sdk.import(createEmptyGraph());
      writeLocalGraph(sdk.getGraph());
    },
    destroy() {
      writeLocalGraph(sdk.getGraph());
      sdk.destroy();
    },
    conversions: { legacyToGraph, graphToLegacy, normalizeGraph }
  };

  window.__toolPlusCanvasSDK = integrationApi;
  window.__toolPlusNativeCanvas = {
    addText: text => integrationApi.addText(text),
    addNote: text => integrationApi.addText(text || '新建便签'),
    addNode: (type, options) => integrationApi.addNode(type, options),
    getDoc: () => integrationApi.exportLegacy(),
    save: integrationApi.save,
    mode: 'local-backend-proxy'
  };

  window.addEventListener('beforeunload', () => {
    try { writeLocalGraph(sdk.getGraph()); } catch (_) {}
    try { sdk.destroy(); } catch (_) {}
  }, { once: true });

  updateLocalStatus('本地画布', '编辑与保存均在此电脑 · 图片模型由本机 Go 后端安全调用');
  window.__toolPlusCanvasReady = true;
  window.__toolPlusNativeCanvasReady = true;
})();
