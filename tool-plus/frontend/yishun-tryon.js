(function bootstrapYishunTryon() {
  'use strict';

  const api = window.toolplus || window.yishunWebApi;
  const hostMode = window.toolplus ? 'electron' : window.yishunWebApi ? 'web' : 'static';
  const $ = selector => document.querySelector(selector);
  const maxImageBytes = 25 * 1024 * 1024;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const garmentLabels = { auto: '服装', top: '上装', bottom: '下装', dress: '连衣裙', outfit: '套装' };
  const state = {
    person: null,
    garment: null,
    garmentType: 'auto',
    ratio: '3:4',
    requestId: '',
    generating: false,
    result: null,
    noticeTimer: 0,
  };

  const view = $('#tryonView');
  if (!view) return;

  const generateButton = $('#tryonGenerateBtn');
  const generateLabel = generateButton.querySelector('span');
  const saveButton = $('#tryonSaveBtn');
  const loading = $('#tryonLoading');
  const emptyResult = $('#tryonEmptyResult');
  const resultFigure = $('#tryonResult');
  const resultImage = $('#tryonResultImage');
  const resultCaption = $('#tryonResultCaption');
  const status = $('.tryonResultStatus');
  const statusText = $('#tryonStatusText');
  const progressText = $('#tryonProgressText');
  const progressBar = $('#tryonProgressBar');
  const progressValue = $('#tryonProgressValue');
  const notice = $('#noticeBar');

  function notify(message, tone = 'info') {
    window.clearTimeout(state.noticeTimer);
    notice.textContent = message;
    notice.dataset.tone = tone;
    notice.hidden = false;
    state.noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 3600);
  }

  function setStatus(message, tone = '') {
    statusText.textContent = message;
    status.classList.toggle('is-ready', tone === 'ready');
    status.classList.toggle('is-running', tone === 'running');
    status.classList.toggle('is-error', tone === 'error');
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function updateGenerateButton(updateStatus = true) {
    generateButton.disabled = state.generating ? false : !(state.person && state.garment && api);
    generateButton.classList.toggle('is-cancel', state.generating);
    generateLabel.textContent = state.generating ? '取消生成' : '开始生成';
    if (state.generating || !updateStatus) return;
    if (state.person && state.garment) setStatus(state.result ? '试衣效果已生成' : '素材已就绪', 'ready');
    else setStatus(state.person || state.garment ? '还需要另一张参考图' : '等待上传素材');
  }

  function clearResult() {
    state.result = null;
    resultImage.removeAttribute('src');
    resultFigure.hidden = true;
    emptyResult.hidden = false;
    saveButton.disabled = true;
  }

  function updateUpload(role) {
    const value = state[role];
    const wrapper = $(`[data-upload="${role}"]`);
    const preview = role === 'person' ? $('#tryonPersonPreview') : $('#tryonGarmentPreview');
    const thumb = role === 'person' ? $('#tryonPersonThumb') : $('#tryonGarmentThumb');
    const placeholder = role === 'person' ? $('#tryonPersonPlaceholder') : $('#tryonGarmentPlaceholder');
    const meta = role === 'person' ? $('#tryonPersonMeta') : $('#tryonGarmentMeta');
    const empty = wrapper.querySelector('.tryonUploadEmpty');
    const remove = wrapper.querySelector('[data-remove-upload]');
    wrapper.classList.toggle('has-file', Boolean(value));
    preview.hidden = !value;
    thumb.hidden = !value;
    placeholder.hidden = Boolean(value);
    meta.hidden = !value;
    empty.hidden = Boolean(value);
    remove.hidden = !value;
    if (value) {
      preview.src = value.url;
      thumb.src = value.url;
      meta.textContent = `${value.file.name} · ${formatBytes(value.file.size)}`;
    } else {
      preview.removeAttribute('src');
      thumb.removeAttribute('src');
      meta.textContent = '';
    }
  }

  function setFile(role, file) {
    if (!file) return;
    if (state.generating) {
      notify('请先取消当前生成任务，再替换参考图片。', 'error');
      return;
    }
    const extensionAllowed = /\.(jpe?g|png|webp)$/i.test(file.name || '');
    if (!allowedTypes.has(file.type) && !extensionAllowed) {
      notify('请选择 JPG、PNG 或 WebP 图片。', 'error');
      return;
    }
    if (!file.size || file.size > maxImageBytes) {
      notify('单张图片大小必须在 25MB 以内。', 'error');
      return;
    }
    if (state[role]) URL.revokeObjectURL(state[role].url);
    state[role] = { file, url: URL.createObjectURL(file) };
    clearResult();
    updateUpload(role);
    updateGenerateButton();
  }

  function removeFile(role) {
    if (state.generating) {
      notify('请先取消当前生成任务，再移除参考图片。', 'error');
      return;
    }
    if (state[role]) URL.revokeObjectURL(state[role].url);
    state[role] = null;
    const input = role === 'person' ? $('#tryonPersonInput') : $('#tryonGarmentInput');
    input.value = '';
    clearResult();
    updateUpload(role);
    updateGenerateButton();
  }

  function bindUpload(role) {
    const wrapper = $(`[data-upload="${role}"]`);
    const input = role === 'person' ? $('#tryonPersonInput') : $('#tryonGarmentInput');
    wrapper.querySelector('[data-select-upload]').addEventListener('click', () => input.click());
    wrapper.querySelector('[data-remove-upload]').addEventListener('click', event => {
      event.stopPropagation();
      removeFile(role);
    });
    input.addEventListener('change', () => {
      setFile(role, input.files && input.files[0]);
      input.value = '';
    });
    for (const eventName of ['dragenter', 'dragover']) {
      wrapper.addEventListener(eventName, event => {
        event.preventDefault();
        if (!state.generating) wrapper.classList.add('is-dragging');
      });
    }
    for (const eventName of ['dragleave', 'drop']) {
      wrapper.addEventListener(eventName, event => {
        event.preventDefault();
        wrapper.classList.remove('is-dragging');
      });
    }
    wrapper.addEventListener('drop', event => {
      if (!state.generating) setFile(role, event.dataTransfer && event.dataTransfer.files[0]);
    });
  }

  function setProgress(value, message) {
    const normalized = Math.max(0, Math.min(1, Number(value) || 0));
    const percentage = Math.round(normalized * 100);
    progressBar.style.width = `${percentage}%`;
    progressValue.textContent = `${percentage}%`;
    progressText.textContent = message || '模型正在生成试衣效果';
  }

  function requestId() {
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `tryon-${id}`;
  }

  function tryonPrompt() {
    const garment = garmentLabels[state.garmentType] || garmentLabels.auto;
    return `第1张参考图是人物图，第2张参考图是${garment}图片。以第1张图的人物为唯一模特，保持人物脸部、发型、体型、姿势、手部和背景不变；将第2张图中的${garment}自然、真实地穿在人物身上，严格保留服装的版型、颜色、面料、纹理、图案和标识。人体结构、服装遮挡、褶皱、贴合和光影必须自然，不添加额外服装、文字或配饰。输出清晰完整的专业电商试衣效果图。`;
  }

  async function configuredImageProfile() {
    const response = await api.canvasModelConfigGet();
    if (!response || response.ok === false) throw new Error(response && response.error || '无法读取图片模型设置。');
    const profile = response.profiles && response.profiles.image || response.image || response;
    if (!profile.configured) {
      $('#settingsBtn').click();
      throw new Error('请先在设置中配置图片模型 API Key。');
    }
    return profile;
  }

  async function cancelGeneration() {
    const activeRequest = state.requestId;
    if (!activeRequest) return;
    generateButton.disabled = true;
    generateLabel.textContent = '正在取消';
    setStatus('正在取消生成', 'running');
    try { await api.canvasGenerationCancel(activeRequest); }
    catch (error) { notify(error.message || String(error), 'error'); }
  }

  async function generate() {
    if (state.generating) {
      await cancelGeneration();
      return;
    }
    if (!state.person || !state.garment) {
      notify('请先上传人物图和服装图。', 'error');
      return;
    }
    if (!api) {
      notify('请通过衣瞬 Web 服务或桌面客户端使用 AI 试衣。', 'error');
      return;
    }

    const activeRequest = requestId();
    state.requestId = activeRequest;
    state.generating = true;
    loading.hidden = false;
    setProgress(0.02, '正在读取参考图片');
    setStatus('正在生成试衣效果', 'running');
    updateGenerateButton();

    try {
      const profile = await configuredImageProfile();
      const [personBytes, garmentBytes] = await Promise.all([
        state.person.file.arrayBuffer(),
        state.garment.file.arrayBuffer(),
      ]);
      if (state.requestId !== activeRequest) return;
      setProgress(0.08, '正在上传人物与服装素材');
      const response = await api.canvasImageGenerate({
        _requestId: activeRequest,
        prompt: tryonPrompt(),
        model: profile.model,
        size: '2K',
        aspectRatio: state.ratio,
        images: [],
        imageReferenceOrder: [
          { source: 'local', index: 0 },
          { source: 'local', index: 1 },
        ],
        localAssets: [
          { name: state.person.file.name, kind: 'image', role: 'reference', mimeType: state.person.file.type || 'image/jpeg', bytes: personBytes },
          { name: state.garment.file.name, kind: 'image', role: 'reference', mimeType: state.garment.file.type || 'image/jpeg', bytes: garmentBytes },
        ],
        parameters: { workflow: 'virtual-try-on', garmentType: state.garmentType },
      });
      if (state.requestId !== activeRequest) return;
      if (!response || response.ok === false) {
        if (response && response.cancelled) throw new DOMException('生成任务已取消。', 'AbortError');
        throw new Error(response && response.error || 'AI 试衣生成失败。');
      }
      const data = response.data || response;
      const source = data.url || data.resultUrl || data.remoteUrl;
      if (!source) throw new Error('模型没有返回可预览的结果文件。');
      state.result = { ...data, url: source };
      resultImage.src = source;
      resultCaption.textContent = `${garmentLabels[state.garmentType] || '服装'}试衣效果 · ${state.ratio}`;
      emptyResult.hidden = true;
      resultFigure.hidden = false;
      saveButton.disabled = false;
      setProgress(1, '试衣效果生成完成');
      setStatus('试衣效果已生成', 'ready');
      notify('AI 试衣效果已生成。', 'success');
    } catch (error) {
      if (state.requestId !== activeRequest) return;
      const cancelled = error && (error.name === 'AbortError' || /取消/.test(error.message || ''));
      setStatus(cancelled ? '生成已取消' : '生成失败', cancelled ? '' : 'error');
      if (!cancelled) notify(error.message || String(error), 'error');
    } finally {
      if (state.requestId === activeRequest) {
        state.requestId = '';
        state.generating = false;
        loading.hidden = true;
        updateGenerateButton(false);
      }
    }
  }

  async function reset() {
    if (state.generating && state.requestId) {
      const activeRequest = state.requestId;
      state.requestId = '';
      try { await api.canvasGenerationCancel(activeRequest); } catch (_) {}
    }
    state.generating = false;
    removeFile('person');
    removeFile('garment');
    state.garmentType = 'auto';
    state.ratio = '3:4';
    document.querySelectorAll('#tryonGarmentType button').forEach(button => button.classList.toggle('active', button.dataset.value === state.garmentType));
    document.querySelectorAll('#tryonRatio button').forEach(button => button.classList.toggle('active', button.dataset.value === state.ratio));
    loading.hidden = true;
    setProgress(0, '正在准备生成');
    updateGenerateButton();
  }

  function resultFileName(result) {
    const mime = String(result.contentType || 'image/png').toLowerCase();
    const extension = mime.includes('webp') ? 'webp' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    return `衣瞬_AI试衣_${timestamp}.${extension}`;
  }

  async function saveResult() {
    if (!state.result) return;
    saveButton.disabled = true;
    try {
      const name = resultFileName(state.result);
      if (hostMode === 'electron' && state.result.localPath && typeof api.revealResult === 'function') {
        const response = await api.revealResult(state.result.localPath);
        if (response && response.ok === false) throw new Error(response.error || '无法打开结果文件位置。');
        notify('已打开试衣结果所在文件夹。', 'success');
        return;
      }
      if (hostMode === 'web' && typeof api.canvasGeneratedFileSave === 'function') {
        const response = await api.canvasGeneratedFileSave({ sourceUrl: state.result.url, suggestedName: name });
        const saved = response && response.saved;
        if (!saved || !saved.path) throw new Error('服务端没有返回保存路径。');
        state.result.savedPath = saved.path;
        notify(`试衣结果已保存到：${saved.path}`, 'success');
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = state.result.url;
      anchor.download = name;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notify('试衣结果已开始下载。', 'success');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(error.message || String(error), 'error');
    } finally {
      saveButton.disabled = false;
    }
  }

  bindUpload('person');
  bindUpload('garment');
  $('#tryonGarmentType').addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button || state.generating) return;
    if (state.garmentType === button.dataset.value) return;
    state.garmentType = button.dataset.value;
    document.querySelectorAll('#tryonGarmentType button').forEach(item => item.classList.toggle('active', item === button));
    clearResult();
    updateGenerateButton();
  });
  $('#tryonRatio').addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button || state.generating) return;
    if (state.ratio === button.dataset.value) return;
    state.ratio = button.dataset.value;
    document.querySelectorAll('#tryonRatio button').forEach(item => item.classList.toggle('active', item === button));
    clearResult();
    updateGenerateButton();
  });
  generateButton.addEventListener('click', () => { void generate(); });
  $('#tryonResetBtn').addEventListener('click', () => { void reset(); });
  saveButton.addEventListener('click', () => { void saveResult(); });
  resultImage.addEventListener('error', () => {
    resultCaption.textContent = '结果已生成，但浏览器无法显示预览，可直接保存文件';
  });
  api && api.onCanvasGenerationProgress && api.onCanvasGenerationProgress(progress => {
    if (!state.generating || progress.requestId !== state.requestId) return;
    setProgress(progress.progress, progress.message);
  });
  window.addEventListener('beforeunload', () => {
    if (state.person) URL.revokeObjectURL(state.person.url);
    if (state.garment) URL.revokeObjectURL(state.garment.url);
  });

  window.yishunTryon = {
    open() { requestAnimationFrame(() => generateButton.focus()); },
    reset,
    snapshot() {
      return {
        person: state.person && state.person.file.name,
        garment: state.garment && state.garment.file.name,
        garmentType: state.garmentType,
        ratio: state.ratio,
        generating: state.generating,
        resultUrl: state.result && state.result.url,
        savedPath: state.result && state.result.savedPath || null,
      };
    },
  };
  updateGenerateButton();
})();
