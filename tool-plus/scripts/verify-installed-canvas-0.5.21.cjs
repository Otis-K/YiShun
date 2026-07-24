const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('G:/FlowCanvas-SDK/FlowCanvas-SDK/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

const executablePath = 'G:/tool-test/tool-plus/文档批量处理工具.exe';
const profile = path.join('G:/tool-plus-v2/tmp', `installed-smoke-${process.pid}-${Date.now()}`);

(async () => {
  let application;
  try {
    application = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 30000 });
    const window = await application.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    assert.match(await window.locator('.brandText small').textContent(), /0\.5\.21/);
    await window.locator('.sideItem', { hasText: '智能画布' }).click();
    await window.locator('#canvasOpenBtn').click();
    const frame = await (await window.locator('#canvasFrame').elementHandle()).contentFrame();
    await frame.waitForFunction(() => Boolean(window.__toolPlusCanvasReady));
    const result = await frame.evaluate(async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const source = api.addNode('image', { position: { x: 20, y: 20 } });
      api.sdk.engine.updateNodeData(source.id, {
        status: 'success', preview: 'data:image/png;base64,iVBORw0KGgo=', previewKind: 'image', mimeType: 'image/png', title: '已生成参考图'
      });
      const target = api.addNode('video', { position: { x: 720, y: 20 }, data: {
        preview: 'data:video/mp4;base64,AAAA', previewKind: 'video', mimeType: 'video/mp4'
      } });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const shell = document.querySelector(`.react-flow__node[data-id="${target.id}"]`);
      const firstFrame = [...shell.querySelectorAll('button')].find(button => button.textContent.trim() === '首帧');
      firstFrame.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const picker = document.querySelector('[role="listbox"][aria-label="选择画布素材"]');
      const beforeDismiss = Boolean(picker && picker.textContent.includes('已生成参考图') && picker.textContent.includes('上传本地素材'));
      document.querySelector('.react-flow__pane').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const bounds = shell.getBoundingClientRect();
      const video = shell.querySelector('video');
      return {
        width: Math.round(bounds.width), height: Math.round(bounds.height),
        videoDraggable: !video.classList.contains('nodrag'), beforeDismiss,
        dismissed: !document.querySelector('[role="listbox"][aria-label="选择画布素材"]')
      };
    });
    assert.deepEqual(result, { width: 640, height: 680, videoDraggable: true, beforeDismiss: true, dismissed: true });
    console.log(JSON.stringify({ ok: true, version: '0.5.21', installedCanvas: result }));
  } finally {
    if (application) await application.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
