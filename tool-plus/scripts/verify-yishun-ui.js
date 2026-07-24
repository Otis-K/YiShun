const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'work', 'yishun-ui-verification');
const registeredChannels = [];

function registerHandler(channel, handler) {
  ipcMain.handle(channel, handler);
  registeredChannels.push(channel);
}

function installEmptyModelLibrary() {
  registerHandler('model-library:list', async () => ({ ok: true, models: [] }));
  registerHandler('model-library:create', async () => ({ ok: false, error: 'not used by yishun-ui verification' }));
  registerHandler('model-library:update', async () => ({ ok: false, error: 'not used by yishun-ui verification' }));
  registerHandler('model-library:delete', async () => ({ ok: false, error: 'not used by yishun-ui verification' }));
  registerHandler('model-library:read', async () => ({ ok: false, error: 'not used by yishun-ui verification' }));
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  installEmptyModelLibrary();
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(root, 'electron', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await win.loadFile(path.join(root, 'frontend', 'yishun.html'));
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 900))');
    const home = await win.webContents.executeJavaScript(`({
      title: document.title,
      cards: document.querySelectorAll('.modelCard').length,
      features: document.querySelectorAll('.featureCard').length,
      tryonEntries: document.querySelectorAll('[data-nav="tryon"]').length,
      brokenImages: [...document.images].filter(image => image.getAttribute('src') && (!image.complete || image.naturalWidth === 0)).map(image => image.src),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width,
    })`);
    assert.equal(home.title, '衣瞬 - AI 服装视觉创作');
    assert.equal(home.cards, 8);
    assert.equal(home.features, 3);
    assert.equal(home.tryonEntries, 1);
    assert.deepEqual(home.brokenImages, []);
    assert.ok(home.overflowX <= 1, `home horizontal overflow ${home.overflowX}`);
    assert.ok(home.sidebarWidth >= 200, `home sidebar width ${home.sidebarWidth}`);
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, 'home-1600x1000.png'), image.toPNG()));

    const filtered = await win.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-filter="male"]').click();
      return { cards: document.querySelectorAll('.modelCard').length, count: document.querySelector('#modelCount').textContent };
    })()`);
    assert.equal(filtered.cards, 3);
    assert.equal(filtered.count, '3');

    await win.webContents.executeJavaScript(`document.querySelector('[data-nav="tryon"]').click()`);
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const tryon = await win.webContents.executeJavaScript(`({
      visible: !document.querySelector('#tryonView').hidden,
      galleryHidden: document.querySelector('#galleryView').hidden,
      canvasHidden: document.querySelector('#canvasView').hidden,
      activeNav: document.querySelector('.sideItem.active span').textContent,
      uploadSlots: document.querySelectorAll('.tryonUpload').length,
      generateDisabled: document.querySelector('#tryonGenerateBtn').disabled,
      columns: getComputedStyle(document.querySelector('.tryonWorkspace')).gridTemplateColumns.split(' ').length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })`);
    assert.deepEqual(tryon, {
      visible: true,
      galleryHidden: true,
      canvasHidden: true,
      activeNav: 'AI 试衣',
      uploadSlots: 2,
      generateDisabled: true,
      columns: 2,
      overflowX: 0,
    });
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, 'tryon-1600x1000.png'), image.toPNG()));
    await win.webContents.executeJavaScript(`document.querySelector('#tryonBackBtn').click()`);

    await win.webContents.executeJavaScript(`document.querySelector('[data-create]').click()`);
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const frame = document.querySelector('#canvasFrame');
        if (frame?.contentWindow?.__toolPlusCanvasReady) {
          clearInterval(timer);
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        } else if (Date.now() - started > 20000) {
          clearInterval(timer);
          reject(new Error('Embedded FlowCanvas did not become ready'));
        }
      }, 50);
    })`);
    const canvas = await win.webContents.executeJavaScript(`({
      visible: !document.querySelector('#canvasView').hidden,
      loaded: document.querySelector('#canvasFrame').dataset.loaded,
      immersive: document.body.classList.contains('canvasImmersiveMode'),
      frameWidth: document.querySelector('#canvasFrame').getBoundingClientRect().width,
      frameHeight: document.querySelector('#canvasFrame').getBoundingClientRect().height,
      sdkRendered: Boolean(document.querySelector('#canvasFrame').contentDocument.querySelector('[data-testid="flowcanvas-sdk"]')),
      railEntries: document.querySelector('#canvasFrame').contentDocument.querySelectorAll('.fc-rail button').length,
    })`);
    assert.equal(canvas.visible, true);
    assert.equal(canvas.loaded, 'true');
    assert.equal(canvas.immersive, true);
    assert.equal(canvas.sdkRendered, true);
    assert.ok(canvas.railEntries >= 5, `canvas rail entries ${canvas.railEntries}`);
    assert.ok(canvas.frameWidth > 1200 && canvas.frameHeight > 700, `canvas size ${canvas.frameWidth}x${canvas.frameHeight}`);
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, 'canvas-1600x1000.png'), image.toPNG()));

    await win.webContents.executeJavaScript(`document.querySelector('#canvasBackBtn').click()`);
    const returned = await win.webContents.executeJavaScript(`({ gallery: !document.querySelector('#galleryView').hidden, canvas: document.querySelector('#canvasView').hidden })`);
    assert.deepEqual(returned, { gallery: true, canvas: true });

    win.setSize(1080, 760);
    await new Promise(resolve => setTimeout(resolve, 350));
    const compact = await win.webContents.executeJavaScript(`({
      columns: getComputedStyle(document.querySelector('#modelGrid')).gridTemplateColumns.split(' ').length,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })`);
    assert.equal(compact.columns, 2);
    assert.ok(compact.overflowX <= 1, `compact horizontal overflow ${compact.overflowX}`);
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, 'home-1080x760.png'), image.toPNG()));

    await win.webContents.executeJavaScript(`document.querySelector('[data-nav="tryon"]').click()`);
    await new Promise(resolve => setTimeout(resolve, 250));
    const compactTryon = await win.webContents.executeJavaScript(`({
      columns: getComputedStyle(document.querySelector('.tryonWorkspace')).gridTemplateColumns.split(' ').length,
      controlsWidth: Math.round(document.querySelector('.tryonControls').getBoundingClientRect().width),
      stageWidth: Math.round(document.querySelector('.tryonStage').getBoundingClientRect().width),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })`);
    assert.equal(compactTryon.columns, 2);
    assert.ok(compactTryon.controlsWidth >= 320, `compact tryon controls ${compactTryon.controlsWidth}`);
    assert.ok(compactTryon.stageWidth >= 500, `compact tryon stage ${compactTryon.stageWidth}`);
    assert.ok(compactTryon.overflowX <= 1, `compact tryon horizontal overflow ${compactTryon.overflowX}`);
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, 'tryon-1080x760.png'), image.toPNG()));

    win.setSize(390, 844);
    await new Promise(resolve => setTimeout(resolve, 300));
    const mobileTryon = await win.webContents.executeJavaScript(`({
      columns: getComputedStyle(document.querySelector('.tryonWorkspace')).gridTemplateColumns.split(' ').length,
      sidebarWidth: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
      uploadWidth: Math.round(document.querySelector('.tryonUpload').getBoundingClientRect().width),
      stageWidth: Math.round(document.querySelector('.tryonStage').getBoundingClientRect().width),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    })`);
    assert.equal(mobileTryon.columns, 1);
    assert.equal(mobileTryon.sidebarWidth, 0);
    assert.ok(mobileTryon.uploadWidth >= 140, `mobile tryon upload ${mobileTryon.uploadWidth}`);
    assert.ok(mobileTryon.stageWidth >= 360, `mobile tryon stage ${mobileTryon.stageWidth}`);
    assert.ok(mobileTryon.overflowX <= 1, `mobile tryon horizontal overflow ${mobileTryon.overflowX}`);
    await win.webContents.capturePage().then(image => fs.writeFileSync(path.join(output, 'tryon-390x844.png'), image.toPNG()));

    console.log(`PASS yishun-ui home=${home.cards} models features=${home.features} tryon=two-image-responsive canvas=${Math.round(canvas.frameWidth)}x${Math.round(canvas.frameHeight)} compactColumns=${compact.columns}`);
  } finally {
    win.destroy();
    for (const channel of registeredChannels) ipcMain.removeHandler(channel);
  }
}

app.whenReady().then(main).then(() => app.exit(0)).catch(error => {
  console.error(error);
  app.exit(1);
});
