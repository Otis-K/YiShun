const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'frontend', 'yishun.html');
const output = path.join(root, 'work', 'double-commercial-ui-verification');
const resultImage = fs.readFileSync(path.join(root, 'frontend', 'assets', 'yishun', 'model-02.jpg'));
const resultDataUrl = `data:image/jpeg;base64,${resultImage.toString('base64')}`;
const registeredChannels = [];

function registerHandler(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function installFakeApi() {
  registerHandler('model-library:list', async () => ({ ok: true, models: [] }));
  registerHandler('model-library:create', async () => ({ ok: false, error: 'not used by visual verification' }));
  registerHandler('model-library:delete', async () => ({ ok: true, deleted: null }));
  registerHandler('model-library:read', async () => ({ ok: false, error: 'not used by visual verification' }));
  registerHandler('canvas:model-config:get', async () => ({
    ok: true,
    profiles: {
      image: { configured: true, baseURL: 'https://example.invalid', model: 'visual-verification-model' },
      video: { configured: false },
    },
  }));
  registerHandler('canvas:image-generate', async () => ({
    ok: true,
    data: { url: resultDataUrl, contentType: 'image/jpeg', fileName: 'double-commercial-result.jpg' },
  }));
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
  await win.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
}

async function setViewport(win, width, height) {
  win.setContentSize(width, height);
  await settle(win);
  const viewport = await win.webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })');
  assert.ok(
    Math.abs(viewport.width - width) <= 1 && Math.abs(viewport.height - height) <= 1,
    `unexpected viewport ${viewport.width}x${viewport.height}`,
  );
}

async function assertLayout(win, label, dialog = false) {
  const metrics = await win.webContents.executeJavaScript(`(() => {
    const target = ${dialog ? "document.querySelector('#doubleCommercialModelModal')" : "document.querySelector('#doubleCommercialView')"};
    const rect = target.getBoundingClientRect();
    const visibleImages = [...target.querySelectorAll('img')].filter(image => {
      const box = image.getBoundingClientRect();
      return !image.hidden && box.width > 0 && box.height > 0;
    });
    return {
      open: target.open === undefined ? true : target.open,
      display: getComputedStyle(target).display,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      targetOverflowX: target.scrollWidth - target.clientWidth,
      width: rect.width,
      height: rect.height,
      left: rect.left,
      right: rect.right,
      viewportWidth: innerWidth,
      brokenImages: visibleImages.filter(image => !image.complete || image.naturalWidth === 0).map(image => image.alt || image.src),
    };
  })()`);
  assert.equal(metrics.open, true, `${label} dialog is not open`);
  assert.notEqual(metrics.display, 'none', `${label} target is not displayed`);
  assert.ok(metrics.width > 100 && metrics.height > 100, `${label} target has no visible area`);
  assert.ok(metrics.pageOverflowX <= 1, `${label} page horizontal overflow ${metrics.pageOverflowX}`);
  assert.ok(metrics.targetOverflowX <= 1, `${label} target horizontal overflow ${metrics.targetOverflowX}`);
  assert.ok(metrics.left >= -1 && metrics.right <= metrics.viewportWidth + 1, `${label} escaped viewport`);
  assert.deepEqual(metrics.brokenImages, [], `${label} has broken visible images`);
}

async function assertWorkspaceFlow(win, label, expectStacked) {
  const metrics = await win.webContents.executeJavaScript(`(() => {
    const workspace = document.querySelector('.dcWorkspace');
    const controls = document.querySelector('.dcControls').getBoundingClientRect();
    const stage = document.querySelector('.dcStage').getBoundingClientRect();
    return {
      display: getComputedStyle(workspace).display,
      controlsBottom: controls.bottom,
      stageTop: stage.top,
      controlsLeft: controls.left,
      stageLeft: stage.left,
    };
  })()`);
  assert.equal(metrics.display, expectStacked ? 'block' : 'grid', `${label} unexpected workspace mode`);
  if (expectStacked) {
    assert.ok(metrics.stageTop >= metrics.controlsBottom - 1, `${label} controls overlap result stage`);
    assert.ok(Math.abs(metrics.stageLeft - metrics.controlsLeft) <= 1, `${label} stacked columns are misaligned`);
  }
}

async function assertMobileHomeEntry(win) {
  const metrics = await win.webContents.executeJavaScript(`(() => {
    const entry = document.querySelector('.sideItem[data-nav="double-commercial"]');
    const rect = entry.getBoundingClientRect();
    const entryStyle = getComputedStyle(entry);
    const nav = entry.parentElement;
    const sidebar = entry.closest('.sidebar');
    const navRect = nav.getBoundingClientRect();
    const sidebarRect = sidebar.getBoundingClientRect();
    return {
      display: entryStyle.display,
      position: entryStyle.position,
      computedWidth: entryStyle.width,
      computedHeight: entryStyle.height,
      width: rect.width,
      left: rect.left,
      right: rect.right,
      navDisplay: getComputedStyle(nav).display,
      navWidth: navRect.width,
      sidebarDisplay: getComputedStyle(sidebar).display,
      sidebarPosition: getComputedStyle(sidebar).position,
      sidebarWidth: sidebarRect.width,
      viewportWidth: innerWidth,
    };
  })()`);
  assert.notEqual(metrics.display, 'none', 'mobile double-commercial entry is hidden');
  assert.ok(metrics.width > 0, `mobile double-commercial entry has no width: ${JSON.stringify(metrics)}`);
  assert.ok(metrics.left >= 0 && metrics.right <= metrics.viewportWidth, 'mobile entry escaped viewport');
}

async function capture(win, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(output, name), image.toPNG());
}

async function showForTopLayerCapture(win) {
  if (!win.isVisible()) win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 180));
  await settle(win);
}

async function configureTask(win) {
  await win.webContents.executeJavaScript(`(async () => {
    const controller = window.yishunDoubleCommercial;
    const models = Array.from(window.YISHUN_MODELS || []);
    const male = models.find(model => model.gender === 'male');
    const female = models.find(model => model.gender === 'female');
    if (!male || !female) throw new Error('official male and female models are required');
    await controller.selectModel('modelA', male.id);
    await controller.selectModel('modelB', female.id);
    document.querySelector('#doubleCommercialRatio button[data-value="3:4"]').click();
    document.querySelector('#doubleCommercialQuality button[data-value="4K"]').click();

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f4f4f2';
    context.fillRect(0, 0, 512, 512);
    context.fillStyle = '#d6d8dd';
    context.fillRect(158, 58, 196, 396);
    context.fillStyle = '#ff5a63';
    context.fillRect(158, 58, 196, 28);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'garment-sample.png', { type: 'image/png' }));
    const input = document.querySelector('#doubleCommercialGarmentInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(
    () => win.webContents.executeJavaScript("!document.querySelector('#doubleCommercialGenerateBtn').disabled"),
    'configured task did not enable generation',
  );
  await settle(win);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  installFakeApi();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    backgroundColor: '#f4f5f7',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: `double-commercial-ui-${Date.now()}`,
    },
  });

  try {
    await win.loadFile(htmlPath, { hash: 'double-commercial' });
    await waitFor(
      () => win.webContents.executeJavaScript("typeof window.yishunDoubleCommercial === 'object'"),
      'double-commercial controller did not initialize',
    );
    await settle(win);

    for (const viewport of [
      { width: 1440, height: 900, name: 'empty-1440x900.png' },
      { width: 1080, height: 760, name: 'empty-1080x760.png' },
      { width: 900, height: 760, name: 'empty-900x760.png' },
      { width: 390, height: 844, name: 'empty-390x844.png' },
    ]) {
      await setViewport(win, viewport.width, viewport.height);
      await win.webContents.executeJavaScript("document.querySelector('#doubleCommercialView').scrollTo(0, 0)");
      await assertLayout(win, viewport.name);
      await assertWorkspaceFlow(win, viewport.name, viewport.width <= 1200);
      await capture(win, viewport.name);
    }

    await win.webContents.executeJavaScript("document.querySelector('#doubleCommercialBackBtn').click()");
    await waitFor(
      () => win.webContents.executeJavaScript("!document.querySelector('#galleryView').hidden"),
      'mobile home did not open',
    );
    await assertMobileHomeEntry(win);
    await capture(win, 'home-entry-390x844.png');
    await win.webContents.executeJavaScript("document.querySelector('.sideItem[data-nav=\"double-commercial\"]').click()");
    await waitFor(
      () => win.webContents.executeJavaScript("!document.querySelector('#doubleCommercialView').hidden"),
      'mobile double-commercial entry did not navigate',
    );

    await setViewport(win, 1440, 900);
    await win.webContents.executeJavaScript("document.querySelector('[data-model-slot=\"modelA\"]').click()");
    await waitFor(
      () => win.webContents.executeJavaScript("document.querySelector('#doubleCommercialModelModal').open"),
      'model dialog did not open',
    );
    await showForTopLayerCapture(win);
    await assertLayout(win, 'model-dialog-1440x900', true);
    await capture(win, 'model-dialog-1440x900.png');
    await win.webContents.executeJavaScript("document.querySelector('#doubleCommercialModelModal').close()");

    await configureTask(win);
    await assertLayout(win, 'configured-1440x900');
    await capture(win, 'configured-1440x900.png');

    await win.webContents.executeJavaScript("document.querySelector('#doubleCommercialGenerateBtn').click()");
    await waitFor(
      () => win.webContents.executeJavaScript("Boolean(window.yishunDoubleCommercial.snapshot().resultUrl)"),
      'result did not render',
    );
    await settle(win);
    await assertLayout(win, 'result-1440x900');
    await capture(win, 'result-1440x900.png');

    await setViewport(win, 390, 844);
    await win.webContents.executeJavaScript("document.querySelector('[data-model-slot=\"modelB\"]').click()");
    await waitFor(
      () => win.webContents.executeJavaScript("document.querySelector('#doubleCommercialModelModal').open"),
      'mobile model dialog did not open',
    );
    await showForTopLayerCapture(win);
    await assertLayout(win, 'model-dialog-390x844', true);
    await capture(win, 'model-dialog-390x844.png');

    console.log(`PASS double-commercial visual layout screenshots=${output}`);
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
