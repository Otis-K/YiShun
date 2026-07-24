(function bootstrapDoubleCommercial() {
  'use strict';

  const view = document.querySelector('#doubleCommercialView');
  if (!view) return;

  const api = window.toolplus || window.yishunWebApi || {};
  const hostMode = window.toolplus ? 'electron' : window.yishunWebApi ? 'web' : 'static';
  const officialModels = Array.from(window.YISHUN_MODELS || []);
  const maxImageBytes = 25 * 1024 * 1024;
  const minImageSide = 512;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const invalidImageCredentialMessage = '图片模型 API Key 无效或已失效，请在右上角“设置”中重新填写有效 Key。';
  const relationshipLabels = { couple: '情侣', brothers: '兄弟', besties: '闺蜜' };
  const relationshipRequirements = {
    couple: { modelA: 'male', modelB: 'female', hint: '选择一位男模与一位女模' },
    brothers: { modelA: 'male', modelB: 'male', hint: '选择两位不同的男模' },
    besties: { modelA: 'female', modelB: 'female', hint: '选择两位不同的女模' },
  };
  const ratioValues = { '3:4': 3 / 4, '1:1': 1, '9:16': 9 / 16, '16:9': 16 / 9 };
  const ownedUrls = new Set();
  let pickerPreviewObserver = null;
  const $ = selector => document.querySelector(selector);
  const state = {
    relationship: 'couple',
    modelA: null,
    modelB: null,
    garment: null,
    scene: null,
    ratio: 'auto',
    quality: '2K',
    requestId: '',
    generating: false,
    result: null,
    noticeTimer: 0,
    customModels: [],
    referenceModels: [],
    favorites: readFavorites(),
    createFile: null,
    picker: { slot: 'modelA', tab: 'official', pending: null, query: '', region: 'all', ageGroup: 'all' },
  };

  const generateButton = $('#doubleCommercialGenerateBtn');
  const generateLabel = generateButton.querySelector('span');
  const saveButton = $('#doubleCommercialSaveBtn');
  const loading = $('#doubleCommercialLoading');
  const emptyResult = $('#doubleCommercialEmptyResult');
  const resultFigure = $('#doubleCommercialResult');
  const resultImage = $('#doubleCommercialResultImage');
  const resultCaption = $('#doubleCommercialResultCaption');
  const status = $('.dcResultStatus');
  const statusText = $('#doubleCommercialStatusText');
  const progressText = $('#doubleCommercialProgressText');
  const progressBar = $('#doubleCommercialProgressBar');
  const progressValue = $('#doubleCommercialProgressValue');
  const modal = $('#doubleCommercialModelModal');
  const modelGrid = $('#doubleCommercialModelGrid');
  const modelEmpty = $('#doubleCommercialModelEmpty');
  const notice = $('#noticeBar');

  function notify(message, tone = 'info') {
    window.clearTimeout(state.noticeTimer);
    notice.textContent = message;
    notice.dataset.tone = tone;
    notice.hidden = false;
    state.noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 3600);
  }

  function isModelAuthenticationError(error) {
    const message = String(error && error.message || error || '');
    return message.includes('API Key 无效或已失效')
      || /\b(?:http\s*)?401\b/i.test(message)
      || /\binvalid\s+(?:api\s*)?(?:key|token)\b/i.test(message)
      || /\bunauthori[sz]ed\b/i.test(message);
  }

  function readFavorites() {
    try {
      const value = JSON.parse(localStorage.getItem('yishun.doubleCommercial.favorites') || '[]');
      return new Set(Array.isArray(value) ? value.map(String).slice(0, 200) : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveFavorites() {
    try { localStorage.setItem('yishun.doubleCommercial.favorites', JSON.stringify(Array.from(state.favorites))); }
    catch (_) {}
  }

  function createSvg(id) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#${id}`);
    svg.setAttribute('aria-hidden', 'true');
    svg.appendChild(use);
    return svg;
  }

  function formatBytes(bytes) {
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function safeImageUrl(value) {
    const source = typeof value === 'string' ? value.trim() : '';
    if (!source) return '';
    if (/^data:image\/(?:jpeg|png|webp);base64,/i.test(source)) return source;
    try {
      const url = new URL(source, location.href);
      return ['http:', 'https:', 'file:', 'blob:'].includes(url.protocol) ? url.href : '';
    } catch (_) {
      return '';
    }
  }

  function rememberObjectUrl(blob) {
    const url = URL.createObjectURL(blob);
    ownedUrls.add(url);
    return url;
  }

  function revokeObjectUrl(url) {
    if (!url || !ownedUrls.has(url)) return;
    URL.revokeObjectURL(url);
    ownedUrls.delete(url);
  }

  function toArrayBuffer(value) {
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
    if (Array.isArray(value)) return Uint8Array.from(value).buffer;
    if (value && Array.isArray(value.data)) return Uint8Array.from(value.data).buffer;
    return null;
  }

  function decodeBase64(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return bytes.buffer;
    } catch (_) {
      return null;
    }
  }

  function imageDimensions(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('图片文件已损坏或无法读取。'));
      image.src = url;
    });
  }

  async function validateImage(file, label = '图片') {
    if (!file) throw new Error(`请选择${label}。`);
    const extensionAllowed = /\.(jpe?g|png|webp)$/i.test(file.name || '');
    if (!allowedTypes.has(file.type) && !extensionAllowed) throw new Error(`${label}仅支持 JPG、PNG 或 WebP 格式。`);
    if (!file.size || file.size > maxImageBytes) throw new Error(`${label}大小必须在 25MB 以内。`);
    const url = rememberObjectUrl(file);
    try {
      const dimensions = await imageDimensions(url);
      if (Math.min(dimensions.width, dimensions.height) < minImageSide) {
        throw new Error(`${label}的宽和高均需不少于 ${minImageSide}px。`);
      }
      return { file, url, ...dimensions };
    } catch (error) {
      revokeObjectUrl(url);
      throw error;
    }
  }

  function setStatus(message, tone = '') {
    statusText.textContent = message;
    status.classList.toggle('is-ready', tone === 'ready');
    status.classList.toggle('is-running', tone === 'running');
    status.classList.toggle('is-error', tone === 'error');
  }

  function completeConfiguration() {
    return Boolean(state.modelA && state.modelB && state.garment);
  }

  function updateGenerateButton(updateStatus = true) {
    const canGenerate = completeConfiguration() && typeof api.canvasImageGenerate === 'function';
    generateButton.disabled = state.generating ? false : !canGenerate;
    generateButton.classList.toggle('is-cancel', state.generating);
    generateLabel.textContent = state.generating ? '取消生成' : '立即生成双人商拍图';
    if (state.generating || !updateStatus) return;
    if (completeConfiguration()) setStatus(state.result ? '双人商拍图已生成' : '素材已就绪', 'ready');
    else if (state.garment || state.modelA || state.modelB) setStatus('还需要补全必填素材');
    else setStatus('等待配置素材');
  }

  function clearResult() {
    state.result = null;
    resultImage.removeAttribute('src');
    resultFigure.hidden = true;
    emptyResult.hidden = false;
    saveButton.disabled = true;
  }

  function modelPreview(model) {
    return safeImageUrl(model && (model.previewUrl || model.imageUrl || (typeof model.image === 'string' ? model.image : model.image && model.image.url)));
  }

  function updateUpload(role) {
    const value = state[role];
    const prefix = role === 'garment' ? 'Garment' : 'Scene';
    const wrapper = $(`[data-dc-upload="${role}"]`);
    const preview = $(`#doubleCommercial${prefix}Preview`);
    const meta = $(`#doubleCommercial${prefix}Meta`);
    const thumb = $(`#doubleCommercial${prefix}Thumb`);
    const placeholder = $(`#doubleCommercial${prefix}Placeholder`);
    const empty = wrapper.querySelector('.dcUploadEmpty');
    const remove = wrapper.querySelector('[data-dc-remove-upload]');
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

  async function setFile(role, file) {
    if (!['garment', 'scene'].includes(role)) throw new Error('不支持的图片槽位。');
    if (state.generating) {
      notify('请先取消当前生成任务，再替换图片。', 'error');
      return false;
    }
    try {
      const next = await validateImage(file, role === 'garment' ? '服装样件' : '场景参考图');
      if (state[role]) revokeObjectUrl(state[role].url);
      state[role] = next;
      clearResult();
      updateUpload(role);
      updateGenerateButton();
      return true;
    } catch (error) {
      notify(error.message || String(error), 'error');
      return false;
    }
  }

  function removeFile(role) {
    if (state.generating) {
      notify('请先取消当前生成任务，再移除图片。', 'error');
      return;
    }
    if (state[role]) revokeObjectUrl(state[role].url);
    state[role] = null;
    const input = role === 'garment' ? $('#doubleCommercialGarmentInput') : $('#doubleCommercialSceneInput');
    input.value = '';
    clearResult();
    updateUpload(role);
    updateGenerateButton();
  }

  function bindUpload(role) {
    const wrapper = $(`[data-dc-upload="${role}"]`);
    const input = role === 'garment' ? $('#doubleCommercialGarmentInput') : $('#doubleCommercialSceneInput');
    wrapper.querySelector('[data-dc-select-upload]').addEventListener('click', () => input.click());
    wrapper.querySelector('[data-dc-remove-upload]').addEventListener('click', event => {
      event.stopPropagation();
      removeFile(role);
    });
    input.addEventListener('change', () => {
      void setFile(role, input.files && input.files[0]);
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
      if (!state.generating) void setFile(role, event.dataTransfer && event.dataTransfer.files[0]);
    });
  }

  function requiredGender(slot) {
    return relationshipRequirements[state.relationship][slot];
  }

  function genderLabel(gender) {
    return gender === 'male' ? '男模' : '女模';
  }

  function sourceLabel(source) {
    if (source === 'custom') return '我的专属';
    if (source === 'reference') return '临时参考';
    return '官方模特';
  }

  function modelIdentity(model) {
    return String(model && (model.fingerprint || model.id) || '');
  }

  function updateModelSlot(slot) {
    const model = state[slot];
    const suffix = slot === 'modelA' ? 'A' : 'B';
    const wrapper = $(`[data-dc-model-wrapper="${slot}"]`);
    const image = $(`#doubleCommercialModel${suffix}Image`);
    const thumb = $(`#doubleCommercialModel${suffix}Thumb`);
    const placeholder = $(`#doubleCommercialModel${suffix}Placeholder`);
    const empty = wrapper.querySelector('.dcModelEmpty');
    const selected = $(`#doubleCommercialModel${suffix}Selected`);
    const remove = wrapper.querySelector('[data-remove-model]');
    const preview = modelPreview(model);
    wrapper.classList.toggle('has-model', Boolean(model));
    empty.hidden = Boolean(model);
    selected.hidden = !model;
    remove.hidden = !model;
    image.hidden = !model;
    thumb.hidden = !model;
    placeholder.hidden = Boolean(model);
    if (model) {
      image.alt = `${model.name}，${genderLabel(model.gender)}`;
      thumb.alt = `${model.name}参考图`;
      selected.querySelector('strong').textContent = model.name;
      selected.querySelector('small').textContent = sourceLabel(model.source);
      if (preview) {
        image.src = preview;
        thumb.src = preview;
      } else {
        image.removeAttribute('src');
        thumb.removeAttribute('src');
        void ensureModelPreview(model).then(url => {
          if (state[slot] !== model || !url) return;
          image.src = url;
          thumb.src = url;
        });
      }
    } else {
      image.removeAttribute('src');
      thumb.removeAttribute('src');
      selected.querySelector('strong').textContent = '';
      selected.querySelector('small').textContent = '';
    }
  }

  function updateRelationshipLabels() {
    const requirements = relationshipRequirements[state.relationship];
    $('#doubleCommercialModelHint').textContent = requirements.hint;
    $('#doubleCommercialModelALabel').textContent = `${genderLabel(requirements.modelA)}特 A`;
    $('#doubleCommercialModelBLabel').textContent = `${genderLabel(requirements.modelB)}特 B`;
  }

  function assignModel(slot, model, quiet = false) {
    if (!['modelA', 'modelB'].includes(slot) || !model) return false;
    if (model.gender !== requiredGender(slot)) {
      if (!quiet) notify(`当前槽位需要选择${genderLabel(requiredGender(slot))}。`, 'error');
      return false;
    }
    const otherSlot = slot === 'modelA' ? 'modelB' : 'modelA';
    if (state[otherSlot] && modelIdentity(state[otherSlot]) === modelIdentity(model)) {
      if (!quiet) notify('两位模特不能选择同一个人。', 'error');
      return false;
    }
    state[slot] = model;
    updateModelSlot(slot);
    clearResult();
    updateGenerateButton();
    return true;
  }

  function removeModel(slot) {
    if (state.generating) {
      notify('请先取消当前生成任务，再移除模特。', 'error');
      return;
    }
    state[slot] = null;
    updateModelSlot(slot);
    clearResult();
    updateGenerateButton();
  }

  function normalizeCustomModel(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const imageValue = source.image;
    return {
      ...source,
      id: String(source.id || ''),
      name: String(source.name || '未命名模特').slice(0, 60),
      gender: source.gender === 'male' ? 'male' : 'female',
      source: 'custom',
      style: String(source.style || 'custom'),
      tag: String(source.tag || '我的专属'),
      meta: String(source.meta || '专属模特'),
      region: String(source.region || ''),
      ageGroup: String(source.ageGroup || ''),
      imageUrl: safeImageUrl(source.imageUrl || (typeof imageValue === 'string' ? imageValue : imageValue && imageValue.url)),
      asset: imageValue && typeof imageValue === 'object' ? imageValue : source.asset,
    };
  }

  function customModelSignature(model) {
    return [model && model.imageName || '', model && model.size || 0, model && (model.updatedAt || model.createdAt) || ''].join('|');
  }

  async function loadCustomModels() {
    if (typeof api.modelLibraryList !== 'function') {
      state.customModels = [];
      return;
    }
    try {
      const response = await api.modelLibraryList();
      if (!response || response.ok === false) throw new Error(response && response.error || '无法读取专属模特。');
      const previous = new Map(state.customModels.map(model => [String(model.id), model]));
      state.customModels = (Array.isArray(response.models) ? response.models : []).map(raw => {
        const model = normalizeCustomModel(raw);
        const cached = previous.get(String(model.id));
        if (cached && customModelSignature(cached) === customModelSignature(model)) {
          if (!model.imageUrl) model.previewUrl = cached.previewUrl;
          if (!model.asset) model.asset = cached.asset;
        } else if (cached) {
          revokeObjectUrl(cached.previewUrl);
        }
        return model;
      }).filter(model => model.id);
    } catch (error) {
      state.customModels = [];
      notify(error.message || String(error), 'error');
    }
  }

  function imageRecordAsset(record) {
    const value = record && typeof record === 'object' ? record : {};
    const bytes = toArrayBuffer(value.bytes) || decodeBase64(value.bytesBase64);
    if (!bytes) return null;
    return {
      name: String(value.name || 'model.jpg'),
      mimeType: allowedTypes.has(value.mimeType) ? value.mimeType : 'image/jpeg',
      bytes,
    };
  }

  async function ensureModelPreview(model) {
    const current = modelPreview(model);
    if (current) return current;
    const embedded = imageRecordAsset(model.asset || model.image);
    if (embedded) {
      model.asset = embedded;
      model.previewUrl = rememberObjectUrl(new Blob([embedded.bytes], { type: embedded.mimeType }));
      return model.previewUrl;
    }
    if (model._previewResolved) return '';
    model._previewResolved = true;
    if (model.source !== 'custom' || typeof api.modelLibraryRead !== 'function') return '';
    try {
      const response = await api.modelLibraryRead(model.id);
      if (!response || response.ok === false) throw new Error(response && response.error || '无法读取模特图片。');
      const detail = response.model || response;
      const direct = safeImageUrl(detail.imageUrl || (typeof detail.image === 'string' ? detail.image : detail.image && detail.image.url));
      if (direct) {
        model.imageUrl = direct;
        return direct;
      }
      const asset = imageRecordAsset(detail.image || detail);
      if (!asset) throw new Error('模特图片数据无效。');
      model.asset = asset;
      model.previewUrl = rememberObjectUrl(new Blob([asset.bytes], { type: asset.mimeType }));
      return model.previewUrl;
    } catch (_) {
      return '';
    }
  }

  function modelsForPicker() {
    let models;
    if (state.picker.tab === 'custom') models = state.customModels;
    else if (state.picker.tab === 'reference') models = state.referenceModels;
    else if (state.picker.tab === 'favorites') models = [...officialModels, ...state.customModels].filter(model => state.favorites.has(String(model.id)));
    else models = officialModels;
    const gender = requiredGender(state.picker.slot);
    const query = state.picker.query.trim().toLowerCase();
    return models.filter(model => {
      if (model.gender !== gender) return false;
      if (state.picker.region !== 'all' && model.region !== state.picker.region) return false;
      if (state.picker.ageGroup !== 'all' && model.ageGroup !== state.picker.ageGroup) return false;
      if (!query) return true;
      return `${model.name} ${model.id} ${model.tag || ''} ${model.meta || ''}`.toLowerCase().includes(query);
    });
  }

  function pickerModelCard(model) {
    const card = document.createElement('article');
    card.className = 'dcPickerCard';
    card.dataset.modelId = String(model.id);
    card.classList.toggle('is-selected', Boolean(state.picker.pending && String(state.picker.pending.id) === String(model.id)));

    const select = document.createElement('button');
    select.type = 'button';
    select.className = 'dcPickerSelect';
    select.setAttribute('aria-label', `选择${model.name}`);
    const visual = document.createElement('span');
    visual.className = 'dcPickerVisual';
    const preview = modelPreview(model);
    const image = document.createElement('img');
    image.alt = `${model.name}，${genderLabel(model.gender)}`;
    image.loading = 'lazy';
    const imagePlaceholder = document.createElement('span');
    imagePlaceholder.className = 'dcPickerImagePlaceholder';
    imagePlaceholder.textContent = preview ? '' : '读取图片中';
    if (preview) image.src = preview;
    else image.hidden = true;
    visual.append(image, imagePlaceholder);
    const source = document.createElement('span');
    source.className = 'dcPickerSource';
    source.textContent = sourceLabel(model.source);
    visual.appendChild(source);
    const info = document.createElement('span');
    info.className = 'dcPickerInfo';
    const name = document.createElement('strong');
    name.textContent = model.name;
    const meta = document.createElement('small');
    meta.textContent = `${model.region || '未设置地区'} · ${genderLabel(model.gender)} · ${model.tag || '商业拍摄'}`;
    info.append(name, meta);
    select.append(visual, info);
    select.addEventListener('click', () => {
      const otherSlot = state.picker.slot === 'modelA' ? 'modelB' : 'modelA';
      if (state[otherSlot] && modelIdentity(state[otherSlot]) === modelIdentity(model)) {
        notify('两位模特不能选择同一个人。', 'error');
        return;
      }
      state.picker.pending = model;
      $('#doubleCommercialPendingModel').textContent = model.name;
      $('#doubleCommercialModelConfirm').disabled = false;
      modelGrid.querySelectorAll('.dcPickerCard').forEach(item => item.classList.toggle('is-selected', item === card));
    });
    card.appendChild(select);

    const check = document.createElement('span');
    check.className = 'dcPickerCheck';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    card.appendChild(check);

    if (model.source !== 'reference') {
      const favorite = document.createElement('button');
      favorite.type = 'button';
      favorite.className = 'dcPickerFavorite';
      favorite.classList.toggle('active', state.favorites.has(String(model.id)));
      favorite.title = state.favorites.has(String(model.id)) ? '取消收藏' : '收藏模特';
      favorite.setAttribute('aria-label', favorite.title);
      favorite.appendChild(createSvg('i-star'));
      favorite.addEventListener('click', () => {
        const id = String(model.id);
        if (state.favorites.has(id)) state.favorites.delete(id);
        else state.favorites.add(id);
        saveFavorites();
        renderPicker();
      });
      card.appendChild(favorite);
    }

    if (model.source === 'custom') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'dcPickerDelete';
      remove.title = '删除专属模特';
      remove.setAttribute('aria-label', `删除${model.name}`);
      remove.appendChild(createSvg('i-trash'));
      remove.addEventListener('click', () => { void deleteCustomModel(model); });
      card.appendChild(remove);
    }

    if (!preview) {
      card.loadPreview = () => {
        if (card.dataset.previewLoading === 'true') return;
        card.dataset.previewLoading = 'true';
        void ensureModelPreview(model).then(url => {
        if (!url || !card.isConnected) {
          imagePlaceholder.textContent = '暂无预览';
          return;
        }
        image.src = url;
        image.hidden = false;
        imagePlaceholder.textContent = '';
        });
      };
    }
    return card;
  }

  function renderPicker() {
    const visible = modelsForPicker();
    if (pickerPreviewObserver) pickerPreviewObserver.disconnect();
    pickerPreviewObserver = null;
    const cards = visible.map(pickerModelCard);
    modelGrid.replaceChildren(...cards);
    const pendingCards = cards.filter(card => typeof card.loadPreview === 'function');
    if ('IntersectionObserver' in window) {
      pickerPreviewObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          pickerPreviewObserver.unobserve(entry.target);
          entry.target.loadPreview();
        });
      }, { root: modelGrid, rootMargin: '180px 0px' });
      pendingCards.forEach(card => pickerPreviewObserver.observe(card));
    } else {
      pendingCards.slice(0, 12).forEach(card => card.loadPreview());
    }
    modelGrid.hidden = visible.length === 0;
    modelEmpty.hidden = visible.length > 0;
    $('#doubleCommercialAddModelBtn').hidden = state.picker.tab !== 'custom';
    $('#doubleCommercialReferenceBtn').hidden = state.picker.tab !== 'reference';
  }

  async function openModelPicker(slot) {
    if (state.generating) {
      notify('请先取消当前生成任务，再更换模特。', 'error');
      return;
    }
    state.picker.slot = slot;
    state.picker.tab = 'official';
    state.picker.pending = state[slot];
    state.picker.query = '';
    state.picker.region = 'all';
    state.picker.ageGroup = 'all';
    $('#doubleCommercialModelSearch').value = '';
    $('#doubleCommercialRegionFilter').value = 'all';
    $('#doubleCommercialAgeFilter').value = 'all';
    $('#doubleCommercialModalTitle').textContent = `选择${genderLabel(requiredGender(slot))}特 ${slot === 'modelA' ? 'A' : 'B'}`;
    $('#doubleCommercialPendingModel').textContent = state.picker.pending ? state.picker.pending.name : '未选择';
    $('#doubleCommercialModelConfirm').disabled = !state.picker.pending;
    $('#doubleCommercialModelTabs').querySelectorAll('button').forEach(button => button.classList.toggle('active', button.dataset.modelTab === 'official'));
    closeCreatePanel();
    renderPicker();
    if (!modal.open && typeof modal.showModal === 'function') modal.showModal();
    else modal.setAttribute('open', '');
    await loadCustomModels();
    if (modal.open) renderPicker();
  }

  function closeModelPicker() {
    if (modal.open && typeof modal.close === 'function') modal.close();
    else modal.removeAttribute('open');
  }

  async function selectModel(slot, modelId) {
    let model = [...officialModels, ...state.customModels, ...state.referenceModels].find(item => String(item.id) === String(modelId));
    if (!model && typeof api.modelLibraryList === 'function') {
      await loadCustomModels();
      model = state.customModels.find(item => String(item.id) === String(modelId));
    }
    if (!model) return false;
    return assignModel(slot, model);
  }

  function showCreatePanel() {
    const panel = $('#doubleCommercialCreatePanel');
    panel.hidden = false;
    $('#doubleCommercialCreateGender').value = requiredGender(state.picker.slot);
    requestAnimationFrame(() => $('#doubleCommercialCreateName').focus());
  }

  function closeCreatePanel() {
    const panel = $('#doubleCommercialCreatePanel');
    panel.hidden = true;
    $('#doubleCommercialCreateName').value = '';
    $('#doubleCommercialCreateFile').value = '';
    $('#doubleCommercialCreateFileName').textContent = '请选择正面清晰照片';
    $('#doubleCommercialCreatePreview').hidden = true;
    $('#doubleCommercialCreatePreview').removeAttribute('src');
    $('#doubleCommercialCreatePlaceholder').hidden = false;
    if (state.createFile) revokeObjectUrl(state.createFile.url);
    state.createFile = null;
  }

  async function setCreateFile(file) {
    try {
      const next = await validateImage(file, '模特照片');
      if (state.createFile) revokeObjectUrl(state.createFile.url);
      state.createFile = next;
      $('#doubleCommercialCreatePreview').src = next.url;
      $('#doubleCommercialCreatePreview').hidden = false;
      $('#doubleCommercialCreatePlaceholder').hidden = true;
      $('#doubleCommercialCreateFileName').textContent = `${file.name} · ${formatBytes(file.size)}`;
    } catch (error) {
      $('#doubleCommercialCreateFile').value = '';
      notify(error.message || String(error), 'error');
    }
  }

  async function createCustomModel() {
    if (typeof api.modelLibraryCreate !== 'function') {
      notify('当前运行方式不支持保存专属模特。', 'error');
      return;
    }
    const name = $('#doubleCommercialCreateName').value.trim();
    const gender = $('#doubleCommercialCreateGender').value === 'male' ? 'male' : 'female';
    if (!name) {
      notify('请输入模特名称。', 'error');
      $('#doubleCommercialCreateName').focus();
      return;
    }
    if (!state.createFile) {
      notify('请上传模特照片。', 'error');
      return;
    }
    const submit = $('#doubleCommercialCreateSubmit');
    submit.disabled = true;
    try {
      const response = await api.modelLibraryCreate({
        name,
        gender,
        image: {
          name: state.createFile.file.name,
          mimeType: state.createFile.file.type || 'image/jpeg',
          bytes: await state.createFile.file.arrayBuffer(),
        },
      });
      if (!response || response.ok === false) throw new Error(response && response.error || '保存模特失败。');
      closeCreatePanel();
      await loadCustomModels();
      if (window.yishunModelManagement) void window.yishunModelManagement.refresh().catch(() => notify('模特已保存，但首页模特列表刷新失败。', 'error'));
      renderPicker();
      notify('专属模特已保存。', 'success');
    } catch (error) {
      notify(error.message || String(error), 'error');
    } finally {
      submit.disabled = false;
    }
  }

  async function deleteCustomModel(model) {
    if (typeof api.modelLibraryDelete !== 'function') {
      notify('当前运行方式不支持删除专属模特。', 'error');
      return;
    }
    if (!window.confirm(`确定删除专属模特“${model.name}”吗？`)) return;
    try {
      const response = await api.modelLibraryDelete(model.id);
      if (!response || response.ok === false) throw new Error(response && response.error || '删除模特失败。');
      for (const slot of ['modelA', 'modelB']) {
        if (state[slot] && String(state[slot].id) === String(model.id)) removeModel(slot);
      }
      state.favorites.delete(String(model.id));
      saveFavorites();
      revokeObjectUrl(model.previewUrl);
      if (state.picker.pending && String(state.picker.pending.id) === String(model.id)) state.picker.pending = null;
      await loadCustomModels();
      if (window.yishunModelManagement) void window.yishunModelManagement.refresh().catch(() => notify('模特已删除，但首页模特列表刷新失败。', 'error'));
      $('#doubleCommercialPendingModel').textContent = state.picker.pending ? state.picker.pending.name : '未选择';
      $('#doubleCommercialModelConfirm').disabled = !state.picker.pending;
      renderPicker();
      notify('专属模特已删除。', 'success');
    } catch (error) {
      notify(error.message || String(error), 'error');
    }
  }

  async function addReferenceModel(file) {
    try {
      const image = await validateImage(file, '模特参考图');
      const id = `reference-${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      const fingerprint = `reference:${file.name}:${file.size}:${file.lastModified || 0}`;
      const otherSlot = state.picker.slot === 'modelA' ? 'modelB' : 'modelA';
      if (state[otherSlot] && modelIdentity(state[otherSlot]) === fingerprint) {
        revokeObjectUrl(image.url);
        throw new Error('两位模特不能使用同一张参考图。');
      }
      const name = String(file.name || '临时参考模特').replace(/\.[^.]+$/, '').slice(0, 40) || '临时参考模特';
      const model = {
        id,
        fingerprint,
        name,
        gender: requiredGender(state.picker.slot),
        source: 'reference',
        tag: '临时参考',
        meta: '本次任务使用',
        region: '',
        ageGroup: '',
        previewUrl: image.url,
        file,
        width: image.width,
        height: image.height,
      };
      state.referenceModels.push(model);
      state.picker.pending = model;
      $('#doubleCommercialPendingModel').textContent = model.name;
      $('#doubleCommercialModelConfirm').disabled = false;
      renderPicker();
      notify('参考模特已添加，仅用于当前任务。', 'success');
    } catch (error) {
      notify(error.message || String(error), 'error');
    }
  }

  function setProgress(value, message) {
    const normalized = Math.max(0, Math.min(1, Number(value) || 0));
    const percentage = Math.round(normalized * 100);
    progressBar.style.width = `${percentage}%`;
    progressValue.textContent = `${percentage}%`;
    progressText.textContent = message || '模型正在生成双人商拍图';
  }

  function createRequestId() {
    const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `double-commercial-${id}`;
  }

  function resolvedAspectRatio() {
    if (state.ratio !== 'auto') return state.ratio;
    if (!state.scene || !state.scene.width || !state.scene.height) return '3:4';
    const sourceRatio = state.scene.width / state.scene.height;
    return Object.entries(ratioValues).sort((left, right) => Math.abs(Math.log(left[1] / sourceRatio)) - Math.abs(Math.log(right[1] / sourceRatio)))[0][0];
  }

  function generationPrompt() {
    const relationship = relationshipLabels[state.relationship];
    const sceneInstruction = state.scene
      ? '第4张参考图是场景与构图参考图，请沿用其空间氛围、镜头角度和光线，但不要复制其中的人物。'
      : '使用干净、真实的专业电商摄影棚背景和商业布光。';
    return `第1张参考图是模特A，第2张参考图是模特B，第3张参考图是服装样件。生成一张两位模特共同出镜的${relationship}主题专业商业服装摄影图。严格保持两位模特各自的面部、发型、体型和身份特征，不交换、不融合面孔；两位模特都自然穿着第3张图中的同一款服装，准确保留服装版型、颜色、面料、纹理、图案和品牌标识。根据${relationship}关系安排自然、有商业表现力的互动姿态，两人主体完整且无遮挡穿帮。${sceneInstruction}只出现两位模特，不增加第三人，不生成重复肢体、异常手部、变形五官、文字、水印或额外服装。画面清晰，人体结构、服装褶皱、贴合、遮挡和光影真实。`;
  }

  async function configuredImageProfile() {
    if (typeof api.canvasModelConfigGet !== 'function') throw new Error('当前运行方式未连接图片生成服务。');
    const response = await api.canvasModelConfigGet();
    if (!response || response.ok === false) throw new Error(response && response.error || '无法读取图片模型设置。');
    const profile = response.profiles && response.profiles.image || response.image || response;
    if (!profile.configured) {
      $('#settingsBtn').click();
      throw new Error('请先在设置中配置图片模型 API Key。');
    }
    return profile;
  }

  async function fetchImageAsset(url, fallbackName) {
    const safeUrl = safeImageUrl(url);
    if (!safeUrl) throw new Error('模特图片地址无效。');
    const response = await fetch(safeUrl);
    if (!response.ok) throw new Error(`读取模特图片失败（HTTP ${response.status}）。`);
    const blob = await response.blob();
    if (!blob.size || blob.size > maxImageBytes) throw new Error('模特图片大小无效。');
    const mimeType = allowedTypes.has(blob.type) ? blob.type : 'image/jpeg';
    return { name: fallbackName, mimeType, bytes: await blob.arrayBuffer() };
  }

  async function modelAsset(model, index) {
    if (model.file && typeof model.file.arrayBuffer === 'function') {
      return { name: model.file.name || `model-${index}.jpg`, mimeType: model.file.type || 'image/jpeg', bytes: await model.file.arrayBuffer() };
    }
    const embedded = imageRecordAsset(model.asset || model.image);
    if (embedded) return embedded;
    if (model.source === 'custom' && typeof api.modelLibraryRead === 'function') {
      const response = await api.modelLibraryRead(model.id);
      if (!response || response.ok === false) throw new Error(response && response.error || `无法读取模特“${model.name}”。`);
      const detail = response.model || response;
      const asset = imageRecordAsset(detail.image || detail);
      if (asset) {
        model.asset = asset;
        return asset;
      }
      const url = detail.imageUrl || (typeof detail.image === 'string' ? detail.image : detail.image && detail.image.url) || model.imageUrl;
      return fetchImageAsset(url, `${model.name || `model-${index}`}.jpg`);
    }
    return fetchImageAsset(modelPreview(model), `${model.name || `model-${index}`}.jpg`);
  }

  async function cancelGeneration() {
    const activeRequest = state.requestId;
    if (!activeRequest) return;
    state.requestId = '';
    generateButton.disabled = true;
    generateLabel.textContent = '正在取消';
    setStatus('正在取消生成', 'running');
    try {
      if (typeof api.canvasGenerationCancel === 'function') await api.canvasGenerationCancel(activeRequest);
    }
    catch (error) { notify(error.message || String(error), 'error'); }
    finally {
      if (state.requestId) return;
      state.generating = false;
      loading.hidden = true;
      setProgress(0, '正在准备生成');
      updateGenerateButton(false);
      setStatus('生成已取消');
    }
  }

  async function generate() {
    if (state.generating) {
      await cancelGeneration();
      return;
    }
    if (!completeConfiguration()) {
      notify('请先上传服装样件并选择两位模特。', 'error');
      return;
    }
    if (typeof api.canvasImageGenerate !== 'function') {
      notify('请通过衣瞬 Web 服务或桌面客户端使用双人商拍。', 'error');
      return;
    }

    const activeRequest = createRequestId();
    state.requestId = activeRequest;
    state.generating = true;
    loading.hidden = false;
    setProgress(0.02, '正在读取模特与服装素材');
    setStatus('正在生成双人商拍图', 'running');
    updateGenerateButton();

    try {
      const profile = await configuredImageProfile();
      const assets = await Promise.all([
        modelAsset(state.modelA, 1),
        modelAsset(state.modelB, 2),
        state.garment.file.arrayBuffer().then(bytes => ({ name: state.garment.file.name, mimeType: state.garment.file.type || 'image/jpeg', bytes })),
        state.scene ? state.scene.file.arrayBuffer().then(bytes => ({ name: state.scene.file.name, mimeType: state.scene.file.type || 'image/jpeg', bytes })) : null,
      ]);
      if (state.requestId !== activeRequest) return;
      setProgress(0.08, '正在上传双模特与服装素材');
      const localAssets = assets.filter(Boolean).map(asset => ({ ...asset, kind: 'image', role: 'reference' }));
      const imageReferenceOrder = localAssets.map((_, index) => ({ source: 'local', index }));
      const aspectRatio = resolvedAspectRatio();
      const response = await api.canvasImageGenerate({
        _requestId: activeRequest,
        prompt: generationPrompt(),
        model: profile.model,
        size: state.quality,
        aspectRatio,
        images: [],
        imageReferenceOrder,
        localAssets,
        parameters: {
          workflow: 'double-commercial',
          relationship: state.relationship,
          requestedAspectRatio: state.ratio,
        },
      });
      if (state.requestId !== activeRequest) return;
      if (!response || response.ok === false) {
        if (response && response.cancelled) throw new DOMException('生成任务已取消。', 'AbortError');
        throw new Error(response && response.error || '双人商拍图生成失败。');
      }
      const data = response.data || response;
      const sourceUrl = data.url || data.resultUrl || data.remoteUrl;
      const source = safeImageUrl(sourceUrl);
      if (!source) throw new Error('模型没有返回可预览的结果文件。');
      state.result = { ...data, sourceUrl, url: source };
      resultImage.src = source;
      resultCaption.textContent = `${relationshipLabels[state.relationship]}双人商拍 · ${aspectRatio} · ${state.quality}`;
      emptyResult.hidden = true;
      resultFigure.hidden = false;
      saveButton.disabled = false;
      setProgress(1, '双人商拍图生成完成');
      setStatus('双人商拍图已生成', 'ready');
      notify('双人商拍图已生成。', 'success');
    } catch (error) {
      if (state.requestId !== activeRequest) return;
      const cancelled = error && (error.name === 'AbortError' || /取消/.test(error.message || ''));
      const authenticationFailed = isModelAuthenticationError(error);
      setStatus(cancelled ? '生成已取消' : '生成失败', cancelled ? '' : 'error');
      if (!cancelled) {
        if (authenticationFailed) $('#settingsBtn').click();
        notify(authenticationFailed ? invalidImageCredentialMessage : error.message || String(error), 'error');
      }
    } finally {
      if (state.requestId === activeRequest) {
        state.requestId = '';
        state.generating = false;
        loading.hidden = true;
        updateGenerateButton(false);
      }
    }
  }

  function resultFileName(result) {
    const mime = String(result.contentType || 'image/png').toLowerCase();
    const extension = mime.includes('webp') ? 'webp' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : 'png';
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
    return `衣瞬_双人商拍_${timestamp}.${extension}`;
  }

  async function saveResult() {
    if (!state.result) return;
    saveButton.disabled = true;
    try {
      const name = resultFileName(state.result);
      if (hostMode === 'electron' && state.result.localPath && typeof api.revealResult === 'function') {
        const response = await api.revealResult(state.result.localPath);
        if (response && response.ok === false) throw new Error(response.error || '无法打开结果文件位置。');
        notify('已打开双人商拍结果所在文件夹。', 'success');
        return;
      }
      if (hostMode === 'web' && typeof api.canvasGeneratedFileSave === 'function') {
        const response = await api.canvasGeneratedFileSave({ sourceUrl: state.result.sourceUrl || state.result.url, suggestedName: name });
        const saved = response && response.saved;
        if (!saved || !saved.path) throw new Error('服务端没有返回保存路径。');
        state.result.savedPath = saved.path;
        notify(`双人商拍结果已保存到：${saved.path}`, 'success');
        return;
      }
      const anchor = document.createElement('a');
      anchor.href = state.result.url;
      anchor.download = name;
      anchor.hidden = true;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      notify('双人商拍结果已开始下载。', 'success');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) notify(error.message || String(error), 'error');
    } finally {
      saveButton.disabled = false;
    }
  }

  async function reset() {
    if (state.generating && state.requestId && typeof api.canvasGenerationCancel === 'function') {
      const activeRequest = state.requestId;
      state.requestId = '';
      try { await api.canvasGenerationCancel(activeRequest); } catch (_) {}
    }
    state.generating = false;
    if (state.garment) revokeObjectUrl(state.garment.url);
    if (state.scene) revokeObjectUrl(state.scene.url);
    state.garment = null;
    state.scene = null;
    state.modelA = null;
    state.modelB = null;
    state.referenceModels.forEach(model => revokeObjectUrl(model.previewUrl));
    state.referenceModels = [];
    state.relationship = 'couple';
    state.ratio = 'auto';
    state.quality = '2K';
    $('#doubleCommercialGarmentInput').value = '';
    $('#doubleCommercialSceneInput').value = '';
    document.querySelectorAll('#doubleCommercialRelationship button').forEach(button => button.classList.toggle('active', button.dataset.value === state.relationship));
    document.querySelectorAll('#doubleCommercialRatio button').forEach(button => button.classList.toggle('active', button.dataset.value === state.ratio));
    document.querySelectorAll('#doubleCommercialQuality button').forEach(button => button.classList.toggle('active', button.dataset.value === state.quality));
    updateRelationshipLabels();
    updateUpload('garment');
    updateUpload('scene');
    updateModelSlot('modelA');
    updateModelSlot('modelB');
    clearResult();
    loading.hidden = true;
    setProgress(0, '正在准备生成');
    updateGenerateButton();
  }

  bindUpload('garment');
  bindUpload('scene');

  $('#doubleCommercialRelationship').addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button || state.generating || !relationshipRequirements[button.dataset.value]) return;
    state.relationship = button.dataset.value;
    document.querySelectorAll('#doubleCommercialRelationship button').forEach(item => item.classList.toggle('active', item === button));
    for (const slot of ['modelA', 'modelB']) {
      if (state[slot] && state[slot].gender !== requiredGender(slot)) state[slot] = null;
      updateModelSlot(slot);
    }
    updateRelationshipLabels();
    clearResult();
    updateGenerateButton();
  });

  $('#doubleCommercialRatio').addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button || state.generating) return;
    state.ratio = button.dataset.value;
    document.querySelectorAll('#doubleCommercialRatio button').forEach(item => item.classList.toggle('active', item === button));
    clearResult();
    updateGenerateButton();
  });

  $('#doubleCommercialQuality').addEventListener('click', event => {
    const button = event.target.closest('button[data-value]');
    if (!button || state.generating) return;
    state.quality = button.dataset.value;
    document.querySelectorAll('#doubleCommercialQuality button').forEach(item => item.classList.toggle('active', item === button));
    clearResult();
    updateGenerateButton();
  });

  document.querySelectorAll('[data-model-slot]').forEach(button => button.addEventListener('click', () => { void openModelPicker(button.dataset.modelSlot); }));
  document.querySelectorAll('[data-remove-model]').forEach(button => button.addEventListener('click', () => removeModel(button.dataset.removeModel)));
  $('#doubleCommercialModelTabs').addEventListener('click', event => {
    const button = event.target.closest('button[data-model-tab]');
    if (!button) return;
    state.picker.tab = button.dataset.modelTab;
    state.picker.pending = null;
    $('#doubleCommercialPendingModel').textContent = '未选择';
    $('#doubleCommercialModelConfirm').disabled = true;
    document.querySelectorAll('#doubleCommercialModelTabs button').forEach(item => item.classList.toggle('active', item === button));
    closeCreatePanel();
    renderPicker();
  });
  $('#doubleCommercialModelSearch').addEventListener('input', event => { state.picker.query = event.target.value; renderPicker(); });
  $('#doubleCommercialRegionFilter').addEventListener('change', event => { state.picker.region = event.target.value; renderPicker(); });
  $('#doubleCommercialAgeFilter').addEventListener('change', event => { state.picker.ageGroup = event.target.value; renderPicker(); });
  $('#doubleCommercialAddModelBtn').addEventListener('click', showCreatePanel);
  $('#doubleCommercialCreateCancel').addEventListener('click', closeCreatePanel);
  $('#doubleCommercialCreateFile').addEventListener('change', event => { void setCreateFile(event.target.files && event.target.files[0]); });
  $('#doubleCommercialCreateSubmit').addEventListener('click', () => { void createCustomModel(); });
  $('#doubleCommercialReferenceBtn').addEventListener('click', () => $('#doubleCommercialReferenceInput').click());
  $('#doubleCommercialReferenceInput').addEventListener('change', event => {
    void addReferenceModel(event.target.files && event.target.files[0]);
    event.target.value = '';
  });
  $('#doubleCommercialModelConfirm').addEventListener('click', () => {
    if (state.picker.pending && assignModel(state.picker.slot, state.picker.pending)) closeModelPicker();
  });
  $('#doubleCommercialModelClose').addEventListener('click', closeModelPicker);
  $('#doubleCommercialModelCancel').addEventListener('click', closeModelPicker);
  modal.addEventListener('cancel', event => { event.preventDefault(); closeModelPicker(); });
  generateButton.addEventListener('click', () => { void generate(); });
  $('#doubleCommercialResetBtn').addEventListener('click', () => { void reset(); });
  saveButton.addEventListener('click', () => { void saveResult(); });
  resultImage.addEventListener('error', () => { resultCaption.textContent = '结果已生成，但浏览器无法显示预览，可直接保存文件'; });

  if (typeof api.onCanvasGenerationProgress === 'function') {
    api.onCanvasGenerationProgress(progress => {
      if (!state.generating || progress.requestId !== state.requestId) return;
      setProgress(progress.progress, progress.message);
    });
  }

  async function syncExternalModelLibrary() {
    const selectedCustomIds = new Map(['modelA', 'modelB'].map(slot => [slot, state[slot] && state[slot].source === 'custom' ? String(state[slot].id) : '']));
    const pendingId = state.picker.pending && state.picker.pending.source === 'custom' ? String(state.picker.pending.id) : '';
    await loadCustomModels();
    const current = new Map(state.customModels.map(model => [String(model.id), model]));
    let changed = false;
    for (const [slot, modelId] of selectedCustomIds) {
      if (!modelId) continue;
      const updated = current.get(modelId);
      state[slot] = updated && updated.gender === requiredGender(slot) ? updated : null;
      updateModelSlot(slot);
      changed = true;
    }
    if (pendingId) {
      const pending = current.get(pendingId);
      state.picker.pending = pending && pending.gender === requiredGender(state.picker.slot) ? pending : null;
    }
    const validIds = new Set([...officialModels, ...state.customModels].map(model => String(model.id)));
    let favoritesChanged = false;
    for (const id of state.favorites) {
      if (validIds.has(id)) continue;
      state.favorites.delete(id);
      favoritesChanged = true;
    }
    if (favoritesChanged) saveFavorites();
    if (changed) clearResult();
    updateGenerateButton();
    $('#doubleCommercialPendingModel').textContent = state.picker.pending ? state.picker.pending.name : '未选择';
    $('#doubleCommercialModelConfirm').disabled = !state.picker.pending;
    if (modal.open) renderPicker();
  }

  window.addEventListener('yishun:model-library-changed', () => { void syncExternalModelLibrary(); });

  window.addEventListener('beforeunload', () => {
    ownedUrls.forEach(url => URL.revokeObjectURL(url));
    ownedUrls.clear();
  });

  window.yishunDoubleCommercial = {
    open() { requestAnimationFrame(() => generateButton.focus()); },
    reset,
    setFile,
    selectModel,
    snapshot() {
      const compactModel = model => model ? { id: model.id, name: model.name, gender: model.gender, source: model.source } : null;
      return {
        relationship: state.relationship,
        modelA: compactModel(state.modelA),
        modelB: compactModel(state.modelB),
        garment: state.garment && state.garment.file.name,
        scene: state.scene && state.scene.file.name,
        ratio: state.ratio,
        resolvedAspectRatio: resolvedAspectRatio(),
        quality: state.quality,
        generating: state.generating,
        resultUrl: state.result && state.result.url,
        savedPath: state.result && state.result.savedPath || null,
      };
    },
  };

  updateRelationshipLabels();
  updateUpload('garment');
  updateUpload('scene');
  updateModelSlot('modelA');
  updateModelSlot('modelB');
  updateGenerateButton();
})();
