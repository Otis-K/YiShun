const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const port = 4192;

async function main() {
  const nodePath = execFileSync('where.exe', ['node'], { encoding: 'utf8' }).split(/\r?\n/).find(Boolean);
  Object.assign(process.env, {
    YISHUN_WEB_PORT: String(port),
    YISHUN_WEB_DATA_ROOT: path.join(root, 'work', 'yishun-web-ui-test'),
    YISHUN_BACKEND_PATH: nodePath,
    YISHUN_BACKEND_ARGS: 'scripts/fixtures/fake-flowcanvas-backend.cjs',
    FLOWCANVAS_IMAGE_MODEL_API_KEY: 'web-ui-secret',
  });
  const { server, tasks } = require('../web/server');
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));

  const win = new BrowserWindow({ width: 1500, height: 920, show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, partition: `yishun-web-ui-${Date.now()}` } });
  try {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (document.querySelector('#serviceStatus')?.textContent === 'Web 服务已连接') { clearInterval(timer); resolve(); }
        else if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error('Web connection state was not rendered')); }
      }, 50);
    })`);
    const shell = await win.webContents.executeJavaScript(`({
      toolplus: typeof window.toolplus,
      webApi: typeof window.yishunWebApi,
      status: document.querySelector('#serviceStatus').textContent,
      modelCards: document.querySelectorAll('.modelCard').length,
      brokenImages: [...document.images].filter(image => image.getAttribute('src') && (!image.complete || image.naturalWidth === 0)).length,
    })`);
    assert.deepEqual(shell, { toolplus: 'undefined', webApi: 'object', status: 'Web 服务已连接', modelCards: 8, brokenImages: 0 });

    await win.webContents.executeJavaScript(`document.querySelector('[data-nav="tryon"]').click()`);
    const tryonInputs = await win.webContents.executeJavaScript(`(async () => {
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='), char => char.charCodeAt(0));
      const select = (id, name) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], name, { type: 'image/png' }));
        const input = document.querySelector(id);
        input.files = transfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      select('#tryonPersonInput', 'person.png');
      select('#tryonGarmentInput', 'garment.png');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        hash: location.hash,
        visible: !document.querySelector('#tryonView').hidden,
        generateDisabled: document.querySelector('#tryonGenerateBtn').disabled,
        previews: document.querySelectorAll('.tryonUpload.has-file').length,
        state: window.yishunTryon.snapshot(),
      };
    })()`);
    assert.equal(tryonInputs.hash, '#tryon');
    assert.equal(tryonInputs.visible, true);
    assert.equal(tryonInputs.generateDisabled, false);
    assert.equal(tryonInputs.previews, 2);
    assert.deepEqual(tryonInputs.state, {
      person: 'person.png', garment: 'garment.png', garmentType: 'auto', ratio: '3:4', generating: false, resultUrl: null, savedPath: null,
    });

    const tryonGeneration = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#tryonGenerateBtn').click();
      const started = Date.now();
      while (!window.yishunTryon.snapshot().resultUrl && !document.querySelector('.tryonResultStatus').classList.contains('is-error') && Date.now() - started < 15000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const snapshot = window.yishunTryon.snapshot();
      return {
        ...snapshot,
        resultVisible: !document.querySelector('#tryonResult').hidden,
        saveDisabled: document.querySelector('#tryonSaveBtn').disabled,
        status: document.querySelector('#tryonStatusText').textContent,
      };
    })()`);
    assert.match(tryonGeneration.resultUrl, /^\/api\/files\/image\//);
    assert.equal(tryonGeneration.resultVisible, true);
    assert.equal(tryonGeneration.saveDisabled, false);
    assert.match(tryonGeneration.status, /试衣效果已生成/);
    const tryonTask = [...tasks.values()].find(task => task.action === 'image.generate');
    assert.deepEqual(tryonTask.result.data.request, {
      localAssetNames: ['person.png', 'garment.png'],
      localAssetKinds: ['image', 'image'],
      imageReferenceOrder: [{ source: 'local', index: 0 }, { source: 'local', index: 1 }],
    });

    const savedTryon = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#tryonSaveBtn').click();
      const started = Date.now();
      while (!window.yishunTryon.snapshot().savedPath && Date.now() - started < 5000) await new Promise(resolve => setTimeout(resolve, 25));
      return { savedPath: window.yishunTryon.snapshot().savedPath, notice: document.querySelector('#noticeBar').textContent };
    })()`);
    assert.equal(fs.readFileSync(savedTryon.savedPath, 'utf8'), 'fake-image-bytes', savedTryon.notice);
    assert.match(savedTryon.notice, /试衣结果已保存/);
    win.showInactive();
    await new Promise(resolve => setTimeout(resolve, 200));
    const tryonScreenshot = await win.webContents.capturePage();
    fs.writeFileSync(path.join(root, 'work', 'yishun-web-tryon-ui.png'), tryonScreenshot.toPNG());
    await win.webContents.executeJavaScript(`document.querySelector('#tryonBackBtn').click()`);

    await win.webContents.executeJavaScript(`document.querySelector('[data-nav="double-commercial"]').click()`);
    const doubleCommercialInputs = await win.webContents.executeJavaScript(`(async () => {
      const controller = window.yishunDoubleCommercial;
      const models = Array.from(window.YISHUN_MODELS || []);
      await controller.selectModel('modelA', models.find(model => model.gender === 'male').id);
      await controller.selectModel('modelB', models.find(model => model.gender === 'female').id);
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      canvas.getContext('2d').fillRect(96, 48, 320, 416);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'double-commercial-garment.png', { type: 'image/png' }));
      const input = document.querySelector('#doubleCommercialGarmentInput');
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        hash: location.hash,
        visible: !document.querySelector('#doubleCommercialView').hidden,
        generateDisabled: document.querySelector('#doubleCommercialGenerateBtn').disabled,
      };
    })()`);
    assert.deepEqual(doubleCommercialInputs, { hash: '#double-commercial', visible: true, generateDisabled: false });

    const doubleCommercialGeneration = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#doubleCommercialGenerateBtn').click();
      const started = Date.now();
      while (!window.yishunDoubleCommercial.snapshot().resultUrl && !document.querySelector('.dcResultStatus').classList.contains('is-error') && Date.now() - started < 15000) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return {
        ...window.yishunDoubleCommercial.snapshot(),
        resultVisible: !document.querySelector('#doubleCommercialResult').hidden,
        saveDisabled: document.querySelector('#doubleCommercialSaveBtn').disabled,
      };
    })()`);
    assert.match(doubleCommercialGeneration.resultUrl, /^http:\/\/127\.0\.0\.1:\d+\/api\/files\/image\//);
    assert.equal(doubleCommercialGeneration.resultVisible, true);
    assert.equal(doubleCommercialGeneration.saveDisabled, false);
    const doubleCommercialTask = [...tasks.values()].find(task => task.result?.data?.request?.localAssetNames?.length === 3);
    assert.deepEqual(doubleCommercialTask.result.data.request, {
      localAssetNames: ['陆屿.jpg', '林栀.jpg', 'double-commercial-garment.png'],
      localAssetKinds: ['image', 'image', 'image'],
      imageReferenceOrder: [
        { source: 'local', index: 0 },
        { source: 'local', index: 1 },
        { source: 'local', index: 2 },
      ],
    });

    const savedDoubleCommercial = await win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#doubleCommercialSaveBtn').click();
      const started = Date.now();
      while (!window.yishunDoubleCommercial.snapshot().savedPath && Date.now() - started < 5000) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return {
        savedPath: window.yishunDoubleCommercial.snapshot().savedPath,
        notice: document.querySelector('#noticeBar').textContent,
      };
    })()`);
    assert.equal(fs.readFileSync(savedDoubleCommercial.savedPath, 'utf8'), 'fake-image-bytes', savedDoubleCommercial.notice);
    assert.match(savedDoubleCommercial.notice, /双人商拍结果已保存/);
    await win.webContents.executeJavaScript(`document.querySelector('#doubleCommercialBackBtn').click()`);

    await win.webContents.executeJavaScript(`document.querySelector('[data-create]').click()`);
    await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const frame = document.querySelector('#canvasFrame');
        const connection = frame?.contentDocument?.querySelector('#canvas-connection')?.textContent || '';
        if (frame?.contentWindow?.__toolPlusCanvasReady && connection.includes('Web')) { clearInterval(timer); resolve(); }
        else if (Date.now() - started > 20000) { clearInterval(timer); reject(new Error('Web canvas did not become ready')); }
      }, 50);
    })`);
    const canvasMode = await win.webContents.executeJavaScript(`document.querySelector('#canvasFrame').contentDocument.querySelector('#canvas-connection').innerText`);
    assert.match(canvasMode, /衣瞬 Web 画布/);
    assert.match(canvasMode, /衣瞬 Web API/);
    const saveInitiallyDisabled = await win.webContents.executeJavaScript(`document.querySelector('#canvasFrame').contentDocument.querySelector('.fc-rail__save').disabled`);
    assert.equal(saveInitiallyDisabled, true);

    const generation = await win.webContents.executeJavaScript(`window.yishunWebApi.canvasImageGenerate({
      _requestId: 'web-ui-request', prompt: 'web ui verification', model: 'nano-banana-pro(特价版 1)', size: '1K', aspectRatio: '1:1'
    })`);
    assert.equal(generation.ok, true);
    assert.match(generation.data.url, /^\/api\/files\/image\//);
    const resultBytes = await win.webContents.executeJavaScript(`fetch(${JSON.stringify(generation.data.url)}).then(response => response.text())`);
    assert.equal(resultBytes, 'fake-image-bytes');
    const savedAsset = await win.webContents.executeJavaScript(`(async () => {
      const frame = document.querySelector('#canvasFrame').contentWindow;
      frame.__savedAssetBytes = 0;
      frame.__savePickerCalls = 0;
      Object.defineProperty(frame, 'showSaveFilePicker', {
        configurable: true,
        value: async () => {
          frame.__savePickerCalls += 1;
          return {
            createWritable: async () => new frame.WritableStream({
              async write(chunk) {
                if (chunk instanceof frame.Blob) {
                  frame.__savedAssetBytes += (await chunk.arrayBuffer()).byteLength;
                } else {
                  frame.__savedAssetBytes += chunk?.byteLength || chunk?.size || 0;
                }
              }
            })
          };
        }
      });
      const api = frame.__toolPlusCanvasSDK;
      const node = api.addNode('image', { data: {
        title: '验收图片', status: 'success', preview: ${JSON.stringify(generation.data.url)}, previewKind: 'image', mimeType: 'image/png', fileName: '验收图片.png'
      } });
      api.sdk.engine.setSelection({ nodeIds: [node.id], edgeIds: [] });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const button = frame.document.querySelector('.fc-rail__save');
      const before = { disabled: button.disabled, title: button.title };
      button.click();
      const started = Date.now();
      while (!frame.__savedAssetBytes && !frame.document.querySelector('.fc-toast') && Date.now() - started < 5000) {
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      return {
        ...before,
        bytes: frame.__savedAssetBytes,
        pickerCalls: frame.__savePickerCalls,
        toast: frame.document.querySelector('.fc-toast')?.textContent || ''
      };
    })()`);
    assert.equal(savedAsset.disabled, false);
    assert.match(savedAsset.title, /保存选中素材/);
    assert.equal(savedAsset.pickerCalls, 1, savedAsset.toast);
    assert.equal(savedAsset.bytes, Buffer.byteLength('fake-image-bytes'), savedAsset.toast);
    const persistedMode = await win.webContents.executeJavaScript(`document.querySelector('#canvasFrame').contentDocument.querySelector('#canvas-connection').innerText`);
    assert.match(persistedMode, /衣瞬 Web API/);
    assert.doesNotMatch(persistedMode, /本机 Go 后端/);

    win.showInactive();
    await new Promise(resolve => setTimeout(resolve, 250));
    const screenshot = await win.webContents.capturePage();
    const output = path.join(root, 'work', 'yishun-web-ui.png');
    fs.writeFileSync(output, screenshot.toPNG());
    console.log(`PASS yishun-web-ui browser-http-client tryon-save double-commercial-save canvas-web-mode generated-result screenshot=${output}`);
  } finally {
    win.destroy();
    await new Promise(resolve => server.close(resolve));
  }
}

app.whenReady().then(main).then(() => app.exit(0)).catch(error => {
  console.error(error);
  app.exit(1);
});
