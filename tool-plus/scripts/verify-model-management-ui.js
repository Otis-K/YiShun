'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'frontend', 'yishun.html');
const managementScriptPath = path.join(root, 'frontend', 'yishun-model-management.js');
const managementStylePath = path.join(root, 'frontend', 'yishun-model-management.css');
const screenshotRoot = path.join(root, 'work', 'model-management-ui-verification');
const registeredChannels = [];
const records = [];
const images = new Map();
const createCalls = [];
const updateCalls = [];
const deleteCalls = [];
let listCalls = 0;

function registerHandler(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function clonePublicRecord(record) {
  return {
    id: record.id,
    name: record.name,
    gender: record.gender,
    source: 'custom',
    style: record.style || '',
    tag: record.tag || '',
    region: record.region || '',
    ageGroup: record.ageGroup || '',
    meta: record.meta || '',
    description: record.meta || '',
    imageName: record.imageName,
    mimeType: record.mimeType,
    size: record.size,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || '',
  };
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value && Array.isArray(value.data)) return Buffer.from(value.data);
  return Buffer.alloc(0);
}

function installFakeApi() {
  registerHandler('model-library:list', async () => {
    listCalls += 1;
    return { ok: true, models: records.map(clonePublicRecord) };
  });
  registerHandler('model-library:read', async (_event, modelId) => {
    const record = records.find(item => item.id === String(modelId || ''));
    if (!record) return { ok: false, error: '用户模特不存在。' };
    const bytes = images.get(record.id) || Buffer.alloc(0);
    return {
      ok: true,
      model: {
        ...clonePublicRecord(record),
        image: {
          name: record.imageName,
          mimeType: record.mimeType,
          size: bytes.length,
          bytes: Uint8Array.from(bytes),
        },
      },
    };
  });
  registerHandler('model-library:create', async (_event, payload = {}) => {
    createCalls.push(payload);
    const bytes = toBuffer(payload.image && payload.image.bytes);
    if (!bytes.length) return { ok: false, error: '请选择模特图片。' };
    const record = {
      id: '11111111-1111-4111-8111-111111111111',
      name: String(payload.name || '').trim(),
      gender: payload.gender === 'male' ? 'male' : 'female',
      style: payload.style === 'editorial' ? 'editorial' : 'casual',
      tag: String(payload.tag || '').trim(),
      region: String(payload.region || '').trim(),
      ageGroup: String(payload.ageGroup || '').trim(),
      meta: String(payload.meta || payload.description || '').trim(),
      imageName: String(payload.image.name || 'model.png'),
      mimeType: String(payload.image.mimeType || 'image/png'),
      size: bytes.length,
      createdAt: '2026-07-23T08:00:00.000Z',
      updatedAt: '',
    };
    records.push(record);
    images.set(record.id, bytes);
    return { ok: true, model: clonePublicRecord(record) };
  });
  registerHandler('model-library:update', async (_event, modelId, payload = {}) => {
    updateCalls.push({ modelId, payload });
    const record = records.find(item => item.id === String(modelId || ''));
    if (!record) return { ok: false, error: '用户模特不存在。' };
    for (const key of ['name', 'gender', 'style', 'tag', 'region', 'ageGroup']) {
      if (Object.hasOwn(payload, key)) record[key] = String(payload[key] || '').trim();
    }
    if (Object.hasOwn(payload, 'meta') || Object.hasOwn(payload, 'description')) {
      record.meta = String(Object.hasOwn(payload, 'meta') ? payload.meta : payload.description || '').trim();
    }
    if (payload.image && typeof payload.image === 'object') {
      const bytes = toBuffer(payload.image.bytes);
      if (!bytes.length) return { ok: false, error: '模特图片内容无效。' };
      record.imageName = String(payload.image.name || record.imageName);
      record.mimeType = String(payload.image.mimeType || record.mimeType);
      record.size = bytes.length;
      images.set(record.id, bytes);
    }
    record.updatedAt = '2026-07-23T08:01:00.000Z';
    return { ok: true, model: clonePublicRecord(record) };
  });
  registerHandler('model-library:delete', async (_event, modelId) => {
    deleteCalls.push(String(modelId || ''));
    const index = records.findIndex(item => item.id === String(modelId || ''));
    if (index < 0) return { ok: false, error: '用户模特不存在。' };
    const [record] = records.splice(index, 1);
    images.delete(record.id);
    return { ok: true, deleted: clonePublicRecord(record) };
  });
  registerHandler('canvas:model-config:get', async () => ({
    ok: true,
    profiles: {
      image: { configured: false, baseURL: 'https://api.tmlab.store', model: 'verification-image-model' },
      video: { configured: false, baseURL: 'https://api.tmlab.store', model: 'verification-video-model' },
    },
  }));
  registerHandler('canvas:generation-cancel', async () => ({ ok: true, cancelled: false }));
}

function verifySources() {
  assert.ok(fs.existsSync(htmlPath), 'frontend/yishun.html is missing');
  assert.ok(fs.existsSync(managementScriptPath), 'frontend/yishun-model-management.js is missing');
  assert.ok(fs.existsSync(managementStylePath), 'frontend/yishun-model-management.css is missing');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const shell = fs.readFileSync(path.join(root, 'frontend', 'yishun.js'), 'utf8');
  const script = fs.readFileSync(managementScriptPath, 'utf8');
  assert.match(html, /id=["']addModelBtn["']/, 'add-model button is missing');
  assert.match(html, /id=["']modelEditorDialog["']/, 'model editor dialog is missing');
  assert.match(html, /id=["']modelDeleteDialog["']/, 'delete confirmation dialog is missing');
  assert.match(html, /yishun-model-management\.css/, 'model-management stylesheet is not loaded');
  assert.match(html, /yishun-model-management\.js/, 'model-management script is not loaded');
  assert.match(shell, /data-model-edit/, 'custom-model edit card action is missing');
  assert.match(shell, /data-model-delete/, 'custom-model delete card action is missing');
  assert.match(script, /modelLibraryCreate/, 'create action is not connected to the model library');
  assert.match(script, /modelLibraryUpdate/, 'update action is not connected to the model library');
  assert.match(script, /modelLibraryDelete/, 'delete action is not connected to the model library');
}

async function waitFor(predicate, message, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function main() {
  fs.mkdirSync(screenshotRoot, { recursive: true });
  verifySources();
  installFakeApi();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: `model-management-verification-${Date.now()}`,
    },
  });

  try {
    await win.loadFile(htmlPath, { hash: 'models' });
    await waitFor(
      () => win.webContents.executeJavaScript("typeof window.yishunModelManagement === 'object'"),
      'model-management controller did not initialize',
    );
    await waitFor(() => listCalls > 0, 'initial custom-model list was not requested');
    await settle(win);

    const shell = await win.webContents.executeJavaScript(`(() => {
      const add = document.querySelector('#addModelBtn');
      const row = add.closest('.modelToolRow');
      const filter = row.querySelector('.filterTabs');
      const addRect = add.getBoundingClientRect();
      const filterRect = filter.getBoundingClientRect();
      return {
        officialCards: document.querySelectorAll('.modelCard:not(.is-custom)').length,
        customCards: document.querySelectorAll('.modelCard.is-custom').length,
        officialManageActions: document.querySelectorAll('.modelCard:not(.is-custom) [data-model-edit], .modelCard:not(.is-custom) [data-model-delete]').length,
        addVisible: getComputedStyle(add).display !== 'none' && addRect.width > 0 && addRect.height > 0,
        addAfterFilter: filter.nextElementSibling === add,
        addAlignedWithFilter: Math.abs(addRect.top - filterRect.top) <= 1 && Math.abs(addRect.height - filterRect.height) <= 1,
        addText: add.textContent.trim(),
        searchPlaceholder: document.querySelector('#modelSearch').placeholder,
        filters: [...document.querySelectorAll('.filterTabs [data-filter]')].map(item => item.dataset.filter),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    })()`);
    assert.equal(shell.officialCards, 8);
    assert.equal(shell.customCards, 0);
    assert.equal(shell.officialManageActions, 0, 'official models must not expose CRUD actions');
    assert.equal(shell.addVisible, true, 'add-model button is not visible');
    assert.equal(shell.addAfterFilter, true, 'add-model button must follow the filter controls');
    assert.equal(shell.addAlignedWithFilter, true, 'add-model button is not aligned with the filter controls');
    assert.equal(shell.addText, '新增模特');
    assert.equal(shell.searchPlaceholder, '搜索模特或风格');
    assert.ok(shell.filters.includes('custom'), 'custom-model filter is missing');
    assert.ok(shell.overflowX <= 1, `model-management page horizontal overflow ${shell.overflowX}`);

    await win.webContents.executeJavaScript(`document.querySelector('#addModelBtn').click()`);
    await settle(win);
    const createDialog = await win.webContents.executeJavaScript(`({
      open: document.querySelector('#modelEditorDialog').open,
      title: document.querySelector('#modelEditorTitle').textContent,
      submit: document.querySelector('#modelEditorSubmit span').textContent,
      accepts: document.querySelector('#modelPhotoInput').accept,
      nameRequired: document.querySelector('#modelNameInput').required,
    })`);
    assert.deepEqual(createDialog, {
      open: true,
      title: '新增模特',
      submit: '保存模特',
      accepts: 'image/jpeg,image/png,image/webp',
      nameRequired: true,
    });

    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#modelNameInput').value = '缺少照片';
      document.querySelector('#modelEditorForm').requestSubmit();
    })()`);
    await waitFor(
      () => win.webContents.executeJavaScript("!document.querySelector('#noticeBar').hidden && document.querySelector('#noticeBar').textContent.includes('请选择一张模特照片')"),
      'create form did not reject a missing photo',
    );
    assert.equal(createCalls.length, 0, 'missing-photo form reached the create API');

    await win.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 800;
      const context = canvas.getContext('2d');
      context.fillStyle = '#e8edf2';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#ff5a63';
      context.fillRect(180, 100, 280, 560);
      context.fillStyle = '#202126';
      context.fillRect(245, 145, 150, 170);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'acceptance-custom-model.png', { type: 'image/png' }));
      const input = document.querySelector('#modelPhotoInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(
      () => win.webContents.executeJavaScript("!document.querySelector('#modelPhotoPreviewImage').hidden && document.querySelector('#modelPhotoSelectLabel').textContent === '更换照片'"),
      'uploaded model photo was not previewed',
    );

    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#modelNameInput').value = '验收专属模特';
      document.querySelector('#modelGenderInput').value = 'female';
      document.querySelector('#modelStyleInput').value = 'editorial';
      document.querySelector('#modelAgeInput').value = '青年';
      document.querySelector('#modelRegionInput').value = '亚洲';
      document.querySelector('#modelTagInput').value = '都市大片';
      const meta = document.querySelector('#modelMetaInput');
      meta.value = '冷感 · 棚拍 · 女装';
      meta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#modelEditorForm').requestSubmit();
    })()`);
    await waitFor(() => createCalls.length === 1, 'create API was not called');
    await waitFor(
      () => win.webContents.executeJavaScript("!document.querySelector('#modelEditorDialog').open && window.yishunModelManagement.snapshot().models.length === 1"),
      'created model did not refresh into the model library',
    );
    await waitFor(
      () => win.webContents.executeJavaScript("Boolean(document.querySelector('.modelCard.is-custom img')?.complete && document.querySelector('.modelCard.is-custom img')?.naturalWidth)"),
      'created model image did not render',
    );

    const createPayload = createCalls[0];
    assert.equal(createPayload.name, '验收专属模特');
    assert.equal(createPayload.gender, 'female');
    assert.equal(createPayload.style, 'editorial');
    assert.equal(createPayload.ageGroup, '青年');
    assert.equal(createPayload.region, '亚洲');
    assert.equal(createPayload.tag, '都市大片');
    assert.equal(createPayload.meta, '冷感 · 棚拍 · 女装');
    assert.equal(createPayload.image.name, 'acceptance-custom-model.png');
    assert.equal(createPayload.image.mimeType, 'image/png');
    const createdBytes = toBuffer(createPayload.image.bytes);
    assert.ok(createdBytes.length > 100, 'uploaded photo bytes are missing');
    assert.equal(createdBytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), true, 'uploaded photo is not PNG data');

    const modelId = records[0].id;
    const createdCard = await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.modelCard.is-custom');
      return {
        id: card.dataset.modelId,
        name: card.querySelector('h3').textContent,
        meta: card.querySelector('.modelInfo p').textContent,
        tag: card.querySelector('.modelBadge').textContent,
        code: card.querySelector('.modelCode').textContent,
        editId: card.querySelector('[data-model-edit]').dataset.modelEdit,
        deleteId: card.querySelector('[data-model-delete]').dataset.modelDelete,
        totalCards: document.querySelectorAll('.modelCard').length,
      };
    })()`);
    assert.deepEqual(createdCard, {
      id: modelId,
      name: '验收专属模特',
      meta: '冷感 · 棚拍 · 女装',
      tag: '都市大片',
      code: 'MY',
      editId: modelId,
      deleteId: modelId,
      totalCards: 9,
    });
    await settle(win);
    assert.equal(
      await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('#modelEditorDialog')).display"),
      'none',
      'closed model editor remained visible before the desktop screenshot',
    );
    fs.writeFileSync(path.join(screenshotRoot, 'desktop-model-library.png'), (await win.webContents.capturePage()).toPNG());

    const searched = await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#modelSearch');
      input.value = '验收专属';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        cards: document.querySelectorAll('.modelCard').length,
        name: document.querySelector('.modelCard h3')?.textContent || '',
        empty: document.querySelector('#modelEmpty').hidden,
      };
    })()`);
    assert.deepEqual(searched, { cards: 1, name: '验收专属模特', empty: true });

    const selectedForDoubleCommercial = await win.webContents.executeJavaScript(`window.yishunDoubleCommercial.selectModel('modelB', ${JSON.stringify(modelId)})`);
    assert.equal(selectedForDoubleCommercial, true, 'custom model could not be selected by double-commercial');
    assert.equal(
      await win.webContents.executeJavaScript(`window.yishunDoubleCommercial.snapshot().modelB?.id`),
      modelId,
      'double-commercial did not retain the selected custom model',
    );

    await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#modelSearch');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-model-edit]').click();
    })()`);
    await settle(win);
    const editDialog = await win.webContents.executeJavaScript(`({
      open: document.querySelector('#modelEditorDialog').open,
      title: document.querySelector('#modelEditorTitle').textContent,
      submit: document.querySelector('#modelEditorSubmit span').textContent,
      name: document.querySelector('#modelNameInput').value,
      gender: document.querySelector('#modelGenderInput').value,
      style: document.querySelector('#modelStyleInput').value,
      ageGroup: document.querySelector('#modelAgeInput').value,
      region: document.querySelector('#modelRegionInput').value,
      tag: document.querySelector('#modelTagInput').value,
      meta: document.querySelector('#modelMetaInput').value,
      previewVisible: !document.querySelector('#modelPhotoPreviewImage').hidden,
    })`);
    assert.deepEqual(editDialog, {
      open: true,
      title: '编辑模特',
      submit: '保存修改',
      name: '验收专属模特',
      gender: 'female',
      style: 'editorial',
      ageGroup: '青年',
      region: '亚洲',
      tag: '都市大片',
      meta: '冷感 · 棚拍 · 女装',
      previewVisible: true,
    });

    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('#modelNameInput').value = '验收专属模特（已编辑）';
      document.querySelector('#modelGenderInput').value = 'male';
      document.querySelector('#modelStyleInput').value = 'casual';
      document.querySelector('#modelAgeInput').value = '成熟';
      document.querySelector('#modelRegionInput').value = '欧美';
      document.querySelector('#modelTagInput').value = '检索标记';
      const meta = document.querySelector('#modelMetaInput');
      meta.value = '自然 · 商务 · 男装';
      meta.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#modelEditorForm').requestSubmit();
    })()`);
    await waitFor(() => updateCalls.length === 1, 'Electron model-library:update channel was not called');
    await waitFor(
      () => win.webContents.executeJavaScript("!document.querySelector('#modelEditorDialog').open && document.querySelector('.modelCard.is-custom h3')?.textContent.includes('已编辑')"),
      'edited model did not refresh in the list',
    );
    await waitFor(
      () => win.webContents.executeJavaScript("window.yishunDoubleCommercial.snapshot().modelB === null"),
      'double-commercial kept a custom model after its gender no longer matched the slot',
    );

    assert.equal(updateCalls[0].modelId, modelId);
    assert.equal(updateCalls[0].payload.name, '验收专属模特（已编辑）');
    assert.equal(updateCalls[0].payload.gender, 'male');
    assert.equal(updateCalls[0].payload.style, 'casual');
    assert.equal(updateCalls[0].payload.ageGroup, '成熟');
    assert.equal(updateCalls[0].payload.region, '欧美');
    assert.equal(updateCalls[0].payload.tag, '检索标记');
    assert.equal(updateCalls[0].payload.meta, '自然 · 商务 · 男装');
    assert.equal(Object.hasOwn(updateCalls[0].payload, 'image'), false, 'metadata-only edit unexpectedly replaced the photo');

    const updatedSearch = await win.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('#modelSearch');
      input.value = '检索标记';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        cards: document.querySelectorAll('.modelCard').length,
        name: document.querySelector('.modelCard h3')?.textContent || '',
        meta: document.querySelector('.modelCard .modelInfo p')?.textContent || '',
      };
    })()`);
    assert.deepEqual(updatedSearch, { cards: 1, name: '验收专属模特（已编辑）', meta: '自然 · 商务 · 男装' });

    win.setSize(390, 844);
    await settle(win);
    const mobileLayout = await win.webContents.executeJavaScript(`(() => {
      const search = document.querySelector('#modelSearch');
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-filter="custom"]').click();
      const add = document.querySelector('#addModelBtn');
      const addRect = add.getBoundingClientRect();
      const cardRect = document.querySelector('.modelCard.is-custom').getBoundingClientRect();
      const manage = getComputedStyle(document.querySelector('.modelManageActions'));
      return {
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        addVisible: addRect.width > 0 && addRect.height > 0,
        addLabel: add.getAttribute('aria-label'),
        cardInsideViewport: cardRect.left >= 0 && cardRect.right <= innerWidth + 1,
        manageVisible: manage.opacity === '1' && manage.transform === 'none',
      };
    })()`);
    assert.ok(mobileLayout.overflowX <= 1, `mobile model-management horizontal overflow ${mobileLayout.overflowX}`);
    assert.equal(mobileLayout.addVisible, true);
    assert.equal(mobileLayout.addLabel, '新增模特');
    assert.equal(mobileLayout.cardInsideViewport, true);
    assert.equal(mobileLayout.manageVisible, true);

    await win.webContents.executeJavaScript(`document.querySelector('[data-model-edit]').click()`);
    await settle(win);
    const mobileDialog = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('#modelEditorDialog');
      const rect = dialog.getBoundingClientRect();
      const fields = getComputedStyle(document.querySelector('.modelFieldGrid'));
      const previewImage = document.querySelector('#modelPhotoPreviewImage');
      const previewPlaceholder = document.querySelector('#modelPhotoPlaceholder');
      return {
        open: dialog.open,
        insideViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
        fieldColumns: fields.gridTemplateColumns.split(' ').filter(Boolean).length,
        previewDisplay: getComputedStyle(previewImage).display,
        placeholderDisplay: getComputedStyle(previewPlaceholder).display,
      };
    })()`);
    assert.deepEqual(mobileDialog, {
      open: true,
      insideViewport: true,
      fieldColumns: 1,
      previewDisplay: 'block',
      placeholderDisplay: 'none',
    });
    fs.writeFileSync(path.join(screenshotRoot, 'mobile-model-editor.png'), (await win.webContents.capturePage()).toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('#modelEditorCancel').click()`);
    win.setSize(1440, 900);
    await settle(win);

    await win.webContents.executeJavaScript(`document.querySelector('[data-model-delete]').click()`);
    await settle(win);
    const deleteConfirmation = await win.webContents.executeJavaScript(`({
      open: document.querySelector('#modelDeleteDialog').open,
      name: document.querySelector('#modelDeleteName').textContent,
      warning: document.querySelector('.modelDeleteBody p').textContent,
      cancelText: document.querySelector('#modelDeleteCancel').textContent.trim(),
      confirmText: document.querySelector('#modelDeleteConfirm span').textContent,
    })`);
    assert.deepEqual(deleteConfirmation, {
      open: true,
      name: '验收专属模特（已编辑）',
      warning: '删除后，该模特照片和信息将从本机模特库中移除，且无法恢复。',
      cancelText: '取消',
      confirmText: '确认删除',
    });

    await win.webContents.executeJavaScript(`document.querySelector('#modelDeleteCancel').click()`);
    await settle(win);
    assert.equal(deleteCalls.length, 0, 'cancelled deletion reached the API');
    assert.equal(
      await win.webContents.executeJavaScript("!document.querySelector('#modelDeleteDialog').open && Boolean(document.querySelector('.modelCard.is-custom'))"),
      true,
      'cancelled deletion removed the custom model',
    );

    await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-model-delete]').click();
      document.querySelector('#modelDeleteConfirm').click();
    })()`);
    await waitFor(() => deleteCalls.length === 1, 'delete API was not called after confirmation');
    await waitFor(
      () => win.webContents.executeJavaScript("!document.querySelector('#modelDeleteDialog').open && window.yishunModelManagement.snapshot().models.length === 0"),
      'confirmed deletion did not refresh the model library',
    );
    assert.equal(deleteCalls[0], modelId);

    const afterDelete = await win.webContents.executeJavaScript(`(() => {
      const search = document.querySelector('#modelSearch');
      search.value = '';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-filter="custom"]').click();
      return {
        customCards: document.querySelectorAll('.modelCard.is-custom').length,
        gridHidden: document.querySelector('#modelGrid').hidden,
        emptyHidden: document.querySelector('#modelEmpty').hidden,
        emptyText: document.querySelector('#modelEmpty').textContent,
      };
    })()`);
    assert.equal(afterDelete.customCards, 0);
    assert.equal(afterDelete.gridHidden, true);
    assert.equal(afterDelete.emptyHidden, false);
    assert.match(afterDelete.emptyText, /还没有我的模特/);

    console.log(`PASS model-management UI add-button photo-required upload create list search edit double-commercial-sync mobile-layout Electron-update-payload delete-cancel delete-confirm screenshots=${screenshotRoot}`);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

app.whenReady().then(main).then(() => {
  for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  app.exit(0);
}).catch(error => {
  console.error(error);
  for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  app.exit(1);
});
