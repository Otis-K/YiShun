(function bootstrapYishunModelManagement() {
  'use strict';

  const dialog = document.querySelector('#modelEditorDialog');
  const deleteDialog = document.querySelector('#modelDeleteDialog');
  if (!dialog || !deleteDialog) return;

  const api = window.toolplus || window.yishunWebApi || {};
  const maxImageBytes = 25 * 1024 * 1024;
  const minImageSide = 512;
  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  const imageCache = new Map();
  const state = {
    models: [],
    editingId: '',
    deletingId: '',
    file: null,
    filePreviewUrl: '',
    refreshPromise: null,
    noticeTimer: 0,
    saving: false,
    deleting: false,
  };

  const $ = selector => document.querySelector(selector);
  const form = $('#modelEditorForm');
  const deleteForm = $('#modelDeleteForm');
  const photoInput = $('#modelPhotoInput');
  const previewImage = $('#modelPhotoPreviewImage');
  const previewPlaceholder = $('#modelPhotoPlaceholder');
  const submitButton = $('#modelEditorSubmit');
  const submitLabel = submitButton.querySelector('span');
  const submitIcon = submitButton.querySelector('use');
  const deleteButton = $('#modelDeleteConfirm');
  const deleteLabel = deleteButton.querySelector('span');
  const metaInput = $('#modelMetaInput');

  function notify(message, tone = 'info') {
    if (typeof window.yishunToast === 'function') {
      window.yishunToast(message, tone);
      return;
    }
    const notice = $('#noticeBar');
    if (!notice) return;
    window.clearTimeout(state.noticeTimer);
    notice.textContent = message;
    notice.dataset.tone = tone;
    notice.hidden = false;
    state.noticeTimer = window.setTimeout(() => { notice.hidden = true; }, 3600);
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

  function imageAsset(record) {
    const image = record && record.image && typeof record.image === 'object' ? record.image : {};
    const bytes = toArrayBuffer(image.bytes) || decodeBase64(image.bytesBase64);
    if (!bytes || !bytes.byteLength) return null;
    return { bytes, mimeType: image.mimeType || record.mimeType || 'image/jpeg' };
  }

  function cacheSignature(record) {
    return [record.imageName || '', record.size || 0, record.updatedAt || record.createdAt || ''].join('|');
  }

  function normalizeRecord(record, image) {
    const gender = record.gender === 'male' ? 'male' : 'female';
    const style = record.style === 'editorial' ? 'editorial' : record.style === 'casual' ? 'casual' : 'custom';
    const region = String(record.region || '').trim();
    const ageGroup = String(record.ageGroup || '').trim();
    const tag = String(record.tag || '').trim() || '我的模特';
    const meta = String(record.meta || record.description || '').trim()
      || [region, ageGroup, gender === 'male' ? '男模' : '女模'].filter(Boolean).join(' · ')
      || '用户上传模特';
    return {
      ...record,
      id: String(record.id || ''),
      name: String(record.name || '').trim(),
      gender,
      style,
      region,
      ageGroup,
      tag,
      meta,
      source: 'custom',
      image: image || '',
    };
  }

  async function hydrateRecord(record) {
    const signature = cacheSignature(record);
    const cached = imageCache.get(record.id);
    if (cached && cached.signature === signature) return normalizeRecord(record, cached.url);
    const response = await api.modelLibraryRead(record.id);
    if (!response || response.ok === false) throw new Error(response && response.error || `无法读取模特“${record.name || ''}”。`);
    const detail = response.model || response;
    const asset = imageAsset(detail);
    if (!asset) throw new Error(`模特“${record.name || ''}”的照片无法读取。`);
    const url = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mimeType }));
    if (cached) URL.revokeObjectURL(cached.url);
    imageCache.set(record.id, { signature, url });
    return normalizeRecord({ ...record, ...detail }, url);
  }

  async function mapWithConcurrency(items, limit, mapper) {
    const result = new Array(items.length);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        result[index] = await mapper(items[index], index);
      }
    });
    await Promise.all(workers);
    return result;
  }

  function publish() {
    window.dispatchEvent(new CustomEvent('yishun:model-library-changed', {
      detail: { models: state.models.map(model => ({ ...model })) },
    }));
  }

  async function doRefresh() {
    if (typeof api.modelLibraryList !== 'function' || typeof api.modelLibraryRead !== 'function') {
      state.models = [];
      publish();
      return state.models;
    }
    const response = await api.modelLibraryList();
    if (!response || response.ok === false) throw new Error(response && response.error || '无法读取我的模特。');
    const records = Array.isArray(response.models) ? response.models : [];
    const currentIds = new Set(records.map(record => String(record.id || '')));
    for (const [id, cached] of imageCache) {
      if (currentIds.has(id)) continue;
      URL.revokeObjectURL(cached.url);
      imageCache.delete(id);
    }
    state.models = await mapWithConcurrency(records, 4, async record => {
      try { return await hydrateRecord(record); }
      catch (_) { return normalizeRecord(record, ''); }
    });
    publish();
    return state.models;
  }

  function refresh() {
    if (!state.refreshPromise) {
      state.refreshPromise = doRefresh().finally(() => { state.refreshPromise = null; });
    }
    return state.refreshPromise;
  }

  function releaseFilePreview() {
    if (state.filePreviewUrl) URL.revokeObjectURL(state.filePreviewUrl);
    state.filePreviewUrl = '';
  }

  function showPreview(url) {
    previewImage.hidden = !url;
    previewPlaceholder.hidden = Boolean(url);
    if (url) previewImage.src = url;
    else previewImage.removeAttribute('src');
  }

  function resetEditor() {
    form.reset();
    state.file = null;
    releaseFilePreview();
    photoInput.value = '';
    $('#modelPhotoSelectLabel').textContent = '选择照片';
    $('#modelMetaCount').textContent = '0';
    showPreview('');
  }

  function fillEditor(model) {
    $('#modelNameInput').value = model.name || '';
    $('#modelGenderInput').value = model.gender === 'male' ? 'male' : 'female';
    $('#modelStyleInput').value = model.style === 'editorial' ? 'editorial' : 'casual';
    $('#modelAgeInput').value = model.ageGroup === '成熟' ? '成熟' : '青年';
    $('#modelRegionInput').value = model.region || '';
    $('#modelTagInput').value = model.tag === '我的模特' ? '' : model.tag || '';
    metaInput.value = model.meta || '';
    $('#modelMetaCount').textContent = String(metaInput.value.length);
    showPreview(model.image || '');
  }

  function openCreate() {
    if (state.saving) return;
    if (typeof api.modelLibraryCreate !== 'function') {
      notify('请通过衣瞬 Web 服务或桌面客户端管理模特。', 'error');
      return;
    }
    resetEditor();
    state.editingId = '';
    $('#modelEditorTitle').textContent = '新增模特';
    submitLabel.textContent = '保存模特';
    submitIcon.setAttribute('href', '#i-user-plus');
    dialog.showModal();
    window.setTimeout(() => $('#modelNameInput').focus(), 0);
  }

  function openEdit(modelId) {
    if (state.saving) return;
    const model = state.models.find(item => item.id === String(modelId || ''));
    if (!model) {
      notify('该模特不存在或已被删除。', 'error');
      return;
    }
    resetEditor();
    state.editingId = model.id;
    $('#modelEditorTitle').textContent = '编辑模特';
    submitLabel.textContent = '保存修改';
    submitIcon.setAttribute('href', '#i-edit');
    fillEditor(model);
    dialog.showModal();
    window.setTimeout(() => $('#modelNameInput').focus(), 0);
  }

  function closeEditor(force = false) {
    if (state.saving && !force) return;
    if (dialog.open) dialog.close();
    state.editingId = '';
    resetEditor();
  }

  function requestDelete(modelId) {
    if (state.deleting) return;
    const model = state.models.find(item => item.id === String(modelId || ''));
    if (!model) {
      notify('该模特不存在或已被删除。', 'error');
      return;
    }
    state.deletingId = model.id;
    $('#modelDeleteName').textContent = model.name;
    deleteDialog.showModal();
    window.setTimeout(() => $('#modelDeleteCancel').focus(), 0);
  }

  function closeDelete(force = false) {
    if (state.deleting && !force) return;
    if (deleteDialog.open) deleteDialog.close();
    state.deletingId = '';
    $('#modelDeleteName').textContent = '';
  }

  function imageDimensions(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error('图片文件已损坏或无法读取。'));
      image.src = url;
    });
  }

  async function selectPhoto(file) {
    if (!file) return;
    const extensionAllowed = /\.(jpe?g|png|webp)$/i.test(file.name || '');
    if (!allowedTypes.has(file.type) && !extensionAllowed) throw new Error('模特照片仅支持 JPG、PNG 或 WebP 格式。');
    if (!file.size || file.size > maxImageBytes) throw new Error('模特照片大小必须在 25MB 以内。');
    const previewUrl = URL.createObjectURL(file);
    try {
      const dimensions = await imageDimensions(previewUrl);
      if (Math.min(dimensions.width, dimensions.height) < minImageSide) {
        throw new Error(`模特照片的宽和高均需不少于 ${minImageSide}px。`);
      }
    } catch (error) {
      URL.revokeObjectURL(previewUrl);
      throw error;
    }
    releaseFilePreview();
    state.filePreviewUrl = previewUrl;
    state.file = file;
    $('#modelPhotoSelectLabel').textContent = '更换照片';
    showPreview(previewUrl);
  }

  function editorPayload() {
    return {
      name: $('#modelNameInput').value.trim(),
      gender: $('#modelGenderInput').value,
      style: $('#modelStyleInput').value,
      ageGroup: $('#modelAgeInput').value,
      region: $('#modelRegionInput').value.trim(),
      tag: $('#modelTagInput').value.trim(),
      meta: metaInput.value.trim(),
    };
  }

  function setEditorBusy(busy) {
    form.querySelectorAll('input,select,textarea').forEach(control => { control.disabled = busy; });
    submitButton.disabled = busy;
    $('#modelEditorCancel').disabled = busy;
    $('#modelEditorClose').disabled = busy;
    submitLabel.textContent = busy ? '正在保存' : state.editingId ? '保存修改' : '保存模特';
  }

  async function saveEditor(event) {
    event.preventDefault();
    if (state.saving) return;
    if (!form.reportValidity()) return;
    if (!state.editingId && !state.file) {
      notify('请选择一张模特照片。', 'error');
      return;
    }
    const editingId = state.editingId;
    const editing = Boolean(editingId);
    const file = state.file;
    state.saving = true;
    setEditorBusy(true);
    try {
      const payload = editorPayload();
      if (file) {
        payload.image = {
          name: file.name,
          mimeType: file.type || 'image/jpeg',
          bytes: await file.arrayBuffer(),
        };
      }
      const response = editing
        ? await api.modelLibraryUpdate(editingId, payload)
        : await api.modelLibraryCreate(payload);
      if (!response || response.ok === false) throw new Error(response && response.error || `${editing ? '修改' : '新增'}模特失败。`);
    } catch (error) {
      notify(error.message || String(error), 'error');
      return;
    } finally {
      state.saving = false;
      setEditorBusy(false);
    }
    if (editing && file) {
      const cached = imageCache.get(editingId);
      if (cached) URL.revokeObjectURL(cached.url);
      imageCache.delete(editingId);
    }
    closeEditor(true);
    try { await refresh(); }
    catch (error) {
      notify(`模特已${editing ? '更新' : '新增'}，但列表刷新失败，请刷新页面后查看。`, 'error');
      return;
    }
    notify(editing ? '模特信息已更新。' : '模特已添加到“我的模特”。', 'success');
  }

  async function deleteModel(event) {
    event.preventDefault();
    if (state.deleting) return;
    const modelId = state.deletingId;
    if (!modelId || typeof api.modelLibraryDelete !== 'function') return;
    state.deleting = true;
    deleteButton.disabled = true;
    $('#modelDeleteCancel').disabled = true;
    $('#modelDeleteClose').disabled = true;
    deleteLabel.textContent = '正在删除';
    try {
      const response = await api.modelLibraryDelete(modelId);
      if (!response || response.ok === false) throw new Error(response && response.error || '删除模特失败。');
    } catch (error) {
      notify(error.message || String(error), 'error');
      return;
    } finally {
      state.deleting = false;
      deleteButton.disabled = false;
      $('#modelDeleteCancel').disabled = false;
      $('#modelDeleteClose').disabled = false;
      deleteLabel.textContent = '确认删除';
    }
    closeDelete(true);
    try { await refresh(); }
    catch (error) {
      notify('模特已删除，但列表刷新失败，请刷新页面后查看。', 'error');
      return;
    }
    notify('模特已删除。', 'success');
  }

  $('#addModelBtn').addEventListener('click', openCreate);
  $('#modelEditorClose').addEventListener('click', closeEditor);
  $('#modelEditorCancel').addEventListener('click', closeEditor);
  $('#modelDeleteClose').addEventListener('click', closeDelete);
  $('#modelDeleteCancel').addEventListener('click', closeDelete);
  form.addEventListener('submit', saveEditor);
  deleteForm.addEventListener('submit', deleteModel);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
  deleteDialog.addEventListener('cancel', event => { event.preventDefault(); closeDelete(); });
  photoInput.addEventListener('change', async event => {
    try { await selectPhoto(event.target.files && event.target.files[0]); }
    catch (error) {
      photoInput.value = '';
      notify(error.message || String(error), 'error');
    }
  });
  metaInput.addEventListener('input', () => { $('#modelMetaCount').textContent = String(metaInput.value.length); });
  window.addEventListener('beforeunload', () => {
    releaseFilePreview();
    for (const cached of imageCache.values()) URL.revokeObjectURL(cached.url);
    imageCache.clear();
  });

  window.yishunModelManagement = {
    refresh,
    openCreate,
    openEdit,
    requestDelete,
    snapshot: () => ({
      editingId: state.editingId,
      deletingId: state.deletingId,
      models: state.models.map(model => ({ ...model, image: model.image ? '[preview]' : '' })),
    }),
  };
})();
