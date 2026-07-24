const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'frontend', 'yishun.html');
const scriptPath = path.join(root, 'frontend', 'yishun-double-commercial.js');
const stylePath = path.join(root, 'frontend', 'yishun-double-commercial.css');
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const generationCalls = [];
const registeredChannels = [];
let modelConfigGate = null;
let rejectNextGenerationWithAuthenticationError = false;

function registerHandler(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function verifySources() {
  assert.ok(fs.existsSync(htmlPath), 'frontend/yishun.html is missing');
  assert.ok(fs.existsSync(scriptPath), 'frontend/yishun-double-commercial.js is missing');
  assert.ok(fs.existsSync(stylePath), 'frontend/yishun-double-commercial.css is missing');

  const html = fs.readFileSync(htmlPath, 'utf8');
  const script = fs.readFileSync(scriptPath, 'utf8');
  assert.match(html, /data-nav=["']double-commercial["']/, 'sidebar entry is missing');
  assert.match(html, /id=["']doubleCommercialView["']/, 'double-commercial view is missing');
  assert.match(html, /yishun-double-commercial\.css/, 'double-commercial stylesheet is not loaded');
  assert.match(html, /yishun-double-commercial\.js/, 'double-commercial script is not loaded');
  assert.match(script, /canvasImageGenerate/, 'generation is not connected to the image API');
  assert.match(script, /imageReferenceOrder/, 'reference-image order is not declared');
  assert.match(script, /double-commercial/, 'workflow identifier is missing');
}

function verifyModelLibraryCrud() {
  const { ModelLibrary } = require('../electron/model-library');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolplus-double-commercial-'));
  const resolvedTempRoot = path.resolve(tempRoot);
  const resolvedSystemTemp = path.resolve(os.tmpdir());
  assert.equal(
    resolvedTempRoot.startsWith(`${resolvedSystemTemp}${path.sep}`),
    true,
    'temporary model-library root escaped the system temp directory',
  );

  try {
    const library = new ModelLibrary(resolvedTempRoot);
    const sourceBytes = fs.readFileSync(path.join(root, 'frontend', 'assets', 'yishun', 'model-01.jpg'));
    assert.deepEqual(library.list(), []);

    const created = library.create({
      name: 'Verification Model',
      gender: 'female',
      image: { name: 'verification-model.jpg', mimeType: 'image/jpeg', bytes: sourceBytes },
    });
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    assert.equal(created.name, 'Verification Model');
    assert.equal(created.gender, 'female');
    assert.equal(created.source, 'custom');
    assert.equal(created.size, sourceBytes.length);
    assert.deepEqual(library.list(), [created]);

    const read = library.read(created.id);
    assert.equal(read.id, created.id);
    assert.equal(read.image.name, 'verification-model.jpg');
    assert.equal(read.image.mimeType, 'image/jpeg');
    assert.equal(Buffer.from(read.image.bytes).equals(sourceBytes), true, 'persisted model bytes changed');

    const deleted = library.delete(created.id);
    assert.equal(deleted.id, created.id);
    assert.deepEqual(library.list(), []);
    assert.throws(() => library.read(created.id), error => error && error.statusCode === 404);
  } finally {
    fs.rmSync(resolvedTempRoot, { recursive: true, force: true });
  }
}

function installFakeApi() {
  registerHandler('model-library:list', async () => ({ ok: true, models: [] }));
  registerHandler('model-library:create', async () => ({ ok: false, error: 'not used by verification' }));
  registerHandler('model-library:delete', async () => ({ ok: true, deleted: null }));
  registerHandler('model-library:read', async () => ({ ok: false, error: 'not used by verification' }));
  registerHandler('canvas:model-config:get', async () => {
    if (modelConfigGate) await modelConfigGate;
    return {
      ok: true,
      profiles: {
        image: {
          configured: true,
          baseURL: 'https://example.invalid',
          model: 'double-commercial-verification-model',
        },
        video: { configured: false },
      },
    };
  });
  registerHandler('canvas:image-generate', async (_event, payload) => {
    generationCalls.push(payload);
    if (rejectNextGenerationWithAuthenticationError) {
      rejectNextGenerationWithAuthenticationError = false;
      return {
        ok: false,
        error: '{"status":401,"error":{"message":"Invalid token","type":"invalid_request_error","token":"raw-upstream-secret"}}',
      };
    }
    return {
      ok: true,
      data: {
        url: tinyPng,
        contentType: 'image/png',
        fileName: 'double-commercial-verification.png',
      },
    };
  });
  registerHandler('canvas:generation-cancel', async () => ({ ok: true, cancelled: true }));
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
  verifySources();
  verifyModelLibraryCrud();
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
      partition: `double-commercial-verification-${Date.now()}`,
    },
  });

  try {
    await win.loadFile(htmlPath);
    await waitFor(
      () => win.webContents.executeJavaScript("typeof window.yishunDoubleCommercial === 'object'"),
      'double-commercial controller did not initialize',
    );

    const shell = await win.webContents.executeJavaScript(`(() => {
      const values = selector => [...document.querySelectorAll(selector)].map(item => item.dataset.value);
      return {
        navEntries: document.querySelectorAll('[data-nav="double-commercial"]').length,
        viewInitiallyHidden: document.querySelector('#doubleCommercialView').hidden,
        relationships: values('#doubleCommercialRelationship button[data-value]'),
        modelSlots: [...document.querySelectorAll('[data-model-slot]')].map(item => item.dataset.modelSlot),
        ratios: values('#doubleCommercialRatio button[data-value]'),
        qualities: values('#doubleCommercialQuality button[data-value]'),
        modalTag: document.querySelector('#doubleCommercialModelModal')?.tagName || '',
        generateInitiallyDisabled: document.querySelector('#doubleCommercialGenerateBtn').disabled,
      };
    })()`);
    assert.equal(shell.navEntries, 1, 'expected exactly one sidebar entry');
    assert.equal(shell.viewInitiallyHidden, true, 'view should be hidden on the home route');
    assert.deepEqual(shell.relationships, ['couple', 'brothers', 'besties']);
    assert.deepEqual(shell.modelSlots, ['modelA', 'modelB']);
    assert.deepEqual(shell.ratios, ['auto', '3:4', '1:1', '9:16', '16:9']);
    assert.deepEqual(shell.qualities, ['2K', '4K']);
    assert.equal(shell.modalTag, 'DIALOG', 'model selector should use a dialog');
    assert.equal(shell.generateInitiallyDisabled, true, 'generation must start disabled');

    await win.webContents.executeJavaScript(`document.querySelector('[data-nav="double-commercial"]').click()`);
    await settle(win);
    const route = await win.webContents.executeJavaScript(`({
      hash: location.hash,
      visible: !document.querySelector('#doubleCommercialView').hidden,
      galleryHidden: document.querySelector('#galleryView').hidden,
      tryonHidden: document.querySelector('#tryonView').hidden,
      active: document.querySelector('[data-nav="double-commercial"]').classList.contains('active'),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })`);
    assert.deepEqual(
      { hash: route.hash, visible: route.visible, galleryHidden: route.galleryHidden, tryonHidden: route.tryonHidden, active: route.active },
      { hash: '#double-commercial', visible: true, galleryHidden: true, tryonHidden: true, active: true },
    );
    assert.ok(route.overflowX <= 1, `double-commercial horizontal overflow ${route.overflowX}`);

    await win.webContents.executeJavaScript(`document.querySelector('[data-model-slot="modelA"]').click()`);
    await settle(win);
    const modal = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('#doubleCommercialModelModal');
      return {
        open: dialog.open,
        officialModels: dialog.querySelectorAll('[data-model-id]').length,
        hasOfficialTab: Boolean(dialog.querySelector('[data-model-source="official"]')) || dialog.textContent.includes('\u5b98\u65b9\u6a21\u7279'),
        hasCustomTab: Boolean(dialog.querySelector('[data-model-source="custom"]')) || dialog.textContent.includes('\u6211\u7684\u4e13\u5c5e'),
      };
    })()`);
    assert.equal(modal.open, true, 'model selector did not open');
    assert.ok(modal.officialModels >= 2, `expected official model choices, found ${modal.officialModels}`);
    assert.equal(modal.hasOfficialTab, true, 'official-model tab is missing');
    assert.equal(modal.hasCustomTab, true, 'custom-model tab is missing');
    await win.webContents.executeJavaScript(`document.querySelector('#doubleCommercialModelModal').close()`);

    const configured = await win.webContents.executeJavaScript(`(async () => {
      const controller = window.yishunDoubleCommercial;
      if (typeof controller.selectModel !== 'function') throw new Error('selectModel verification hook is missing');
      const models = Array.from(window.YISHUN_MODELS || []);
      const male = models.find(model => model.gender === 'male');
      const female = models.find(model => model.gender === 'female');
      if (!male || !female) throw new Error('official male and female models are required');
      document.querySelector('#doubleCommercialRelationship button[data-value="couple"]').click();
      await controller.selectModel('modelA', male.id);
      await controller.selectModel('modelB', female.id);
      document.querySelector('#doubleCommercialRatio button[data-value="9:16"]').click();
      document.querySelector('#doubleCommercialQuality button[data-value="4K"]').click();

      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext('2d');
      context.fillStyle = '#f4f4f2';
      context.fillRect(0, 0, 512, 512);
      context.fillStyle = '#222222';
      context.fillRect(176, 80, 160, 352);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'garment.png', { type: 'image/png' }));
      const input = document.querySelector('#doubleCommercialGarmentInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        snapshot: controller.snapshot(),
        generateDisabled: document.querySelector('#doubleCommercialGenerateBtn').disabled,
      };
    })()`);
    assert.equal(configured.snapshot.relationship, 'couple');
    assert.equal(configured.snapshot.ratio, '9:16');
    assert.equal(configured.snapshot.quality, '4K');
    assert.ok(configured.snapshot.modelA, 'model A was not selected');
    assert.ok(configured.snapshot.modelB, 'model B was not selected');
    assert.equal(configured.snapshot.garment, 'garment.png');
    assert.equal(configured.generateDisabled, false, 'valid configuration should enable generation');

    let releaseModelConfig;
    modelConfigGate = new Promise(resolve => { releaseModelConfig = resolve; });
    await win.webContents.executeJavaScript(`document.querySelector('#doubleCommercialGenerateBtn').click()`);
    await waitFor(
      () => win.webContents.executeJavaScript("window.yishunDoubleCommercial.snapshot().generating"),
      'generation did not enter preparation state',
    );
    await win.webContents.executeJavaScript(`document.querySelector('#doubleCommercialGenerateBtn').click()`);
    await waitFor(
      () => win.webContents.executeJavaScript("!window.yishunDoubleCommercial.snapshot().generating"),
      'preparation-stage cancellation did not settle',
    );
    releaseModelConfig();
    modelConfigGate = null;
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(generationCalls.length, 0, 'cancelled preparation must not submit an image-generation request');

    await win.webContents.executeJavaScript(`document.querySelector('#doubleCommercialGenerateBtn').click()`);
    await waitFor(() => generationCalls.length === 1, 'fake image API was not called');
    await waitFor(
      () => win.webContents.executeJavaScript("Boolean(window.yishunDoubleCommercial.snapshot().resultUrl)"),
      'fake generation result was not rendered',
    );

    const payload = generationCalls[0];
    assert.equal(payload.model, 'double-commercial-verification-model');
    assert.equal(payload.size, '4K');
    assert.equal(payload.aspectRatio, '9:16');
    assert.deepEqual(payload.imageReferenceOrder, [
      { source: 'local', index: 0 },
      { source: 'local', index: 1 },
      { source: 'local', index: 2 },
    ]);
    assert.equal(payload.localAssets.length, 3, 'expected model A, model B, and garment assets');
    assert.equal(payload.localAssets[2].name, 'garment.png', 'garment must be the third local asset');
    assert.ok(payload.localAssets.every(asset => asset.kind === 'image'), 'all references must be images');
    assert.deepEqual(payload.parameters, {
      workflow: 'double-commercial',
      relationship: 'couple',
      requestedAspectRatio: '9:16',
    });

    const result = await win.webContents.executeJavaScript(`({
      snapshot: window.yishunDoubleCommercial.snapshot(),
      resultVisible: !document.querySelector('#doubleCommercialResult').hidden,
      saveDisabled: document.querySelector('#doubleCommercialSaveBtn').disabled,
    })`);
    assert.equal(result.snapshot.resultUrl, tinyPng);
    assert.equal(result.resultVisible, true);
    assert.equal(result.saveDisabled, false);

    await win.webContents.executeJavaScript(`(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const context = canvas.getContext('2d');
      context.fillStyle = '#dbe4ea';
      context.fillRect(0, 0, 512, 512);
      context.fillStyle = '#7f8f9b';
      context.fillRect(0, 340, 512, 172);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      await window.yishunDoubleCommercial.setFile('scene', new File([blob], 'scene.png', { type: 'image/png' }));
    })()`);
    await win.webContents.executeJavaScript(`document.querySelector('#doubleCommercialGenerateBtn').click()`);
    await waitFor(() => generationCalls.length === 2, 'scene generation did not call the image API');
    await waitFor(
      () => win.webContents.executeJavaScript("Boolean(window.yishunDoubleCommercial.snapshot().resultUrl)"),
      'scene generation result was not rendered',
    );
    const scenePayload = generationCalls[1];
    assert.deepEqual(scenePayload.imageReferenceOrder, [
      { source: 'local', index: 0 },
      { source: 'local', index: 1 },
      { source: 'local', index: 2 },
      { source: 'local', index: 3 },
    ]);
    assert.equal(scenePayload.localAssets[3].name, 'scene.png', 'scene must be the fourth local asset');

    rejectNextGenerationWithAuthenticationError = true;
    await win.webContents.executeJavaScript(`(() => {
      window.__doubleCommercialSettingsClicks = 0;
      document.querySelector('#settingsBtn').addEventListener('click', () => { window.__doubleCommercialSettingsClicks += 1; }, { once: true });
      document.querySelector('#doubleCommercialGenerateBtn').click();
    })()`);
    await waitFor(() => generationCalls.length === 3, 'authentication-failure generation did not call the image API');
    await waitFor(
      () => win.webContents.executeJavaScript("!window.yishunDoubleCommercial.snapshot().generating && document.querySelector('#settingsDialog').open"),
      'authentication failure did not open model settings',
    );
    const authenticationFailure = await win.webContents.executeJavaScript(`({
      settingsClicks: window.__doubleCommercialSettingsClicks,
      settingsOpen: document.querySelector('#settingsDialog').open,
      notice: document.querySelector('#noticeBar').textContent,
      noticeTone: document.querySelector('#noticeBar').dataset.tone,
      visibleText: document.body.innerText,
      status: document.querySelector('#doubleCommercialStatusText').textContent,
    })`);
    assert.equal(authenticationFailure.settingsClicks, 1, 'settings button should be clicked once');
    assert.equal(authenticationFailure.settingsOpen, true, 'settings dialog should be open');
    assert.equal(authenticationFailure.noticeTone, 'error');
    assert.match(authenticationFailure.notice, /图片模型 API Key 无效或已失效/);
    assert.equal(authenticationFailure.status, '生成失败');
    assert.doesNotMatch(authenticationFailure.notice, /Invalid token|401|raw-upstream-secret|[{}]/i);
    assert.doesNotMatch(authenticationFailure.visibleText, /Invalid token|raw-upstream-secret|invalid_request_error/i);

    console.log('PASS double-commercial sidebar view relationships ratios qualities model-dialog preparation-cancel generation refs=3+4 size=4K ratio=9:16 workflow=double-commercial auth-settings-friendly-error');
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
