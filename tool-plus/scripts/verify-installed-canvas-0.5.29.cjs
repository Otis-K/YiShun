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
    assert.match(await window.locator('.brandText small').textContent(), /0\.5\.29/);
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
      const legacyVideo = api.addNode('video', { position: { x: 20, y: 760 } });
      api.sdk.engine.updateNodeData(legacyVideo.id, {
        status: 'success', preview: 'data:image/png;base64,iVBORw0KGgo=', previewKind: 'image', mimeType: 'image/png', title: '不应出现的伪视频'
      });
      const videoSource = api.addNode('video', { position: { x: 760, y: 760 } });
      api.sdk.engine.updateNodeData(videoSource.id, {
        status: 'success', preview: 'data:video/mp4;base64,AAAA', previewKind: 'video', mimeType: 'video/mp4', title: '真实视频素材'
      });
      const target = api.addNode('video', { position: { x: 720, y: 20 }, data: {
        preview: 'data:video/mp4;base64,AAAA', previewKind: 'video', mimeType: 'video/mp4'
      } });
      api.sdk.engine.addEdge({ source: source.id, sourcePort: 'image', target: target.id, targetPort: 'image' });
      api.sdk.import(api.sdk.export());
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const shell = document.querySelector(`.react-flow__node[data-id="${target.id}"]`);
      const firstFrame = [...shell.querySelectorAll('button')].find(button => button.textContent.trim() === '首帧');
      firstFrame.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const framePicker = document.querySelector('[role="listbox"][aria-label="选择画布素材"]');
      const frameInitiallyUnselected = framePicker.querySelector('[role="option"]')?.getAttribute('aria-selected') === 'false';
      framePicker.querySelector('button[aria-label="使用素材 已生成参考图"]').click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      firstFrame.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const centralPreview = Boolean(document.querySelector('[role="dialog"][aria-label="素材预览"]'));
      document.querySelector('button[aria-label="关闭素材预览"]').click();
      const selectMaterial = shell.querySelector('button[title="选择画布素材或上传图片、视频和音频"]');
      selectMaterial.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const picker = document.querySelector('[role="listbox"][aria-label="选择画布素材"]');
      const imageTab = [...picker.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.trim() === '图片');
      const videoTab = [...picker.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.trim() === '视频');
      const imageTabValid = Boolean(imageTab?.getAttribute('aria-selected') === 'true' && picker.textContent.includes('已生成参考图') && !picker.textContent.includes('真实视频素材'));
      const materialColumns = getComputedStyle(picker.querySelector('.fc-generation-reference-popover__grid')).gridTemplateColumns.split(' ').filter(Boolean).length;
      const downloadClicks = [];
      const nativeAnchorClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { downloadClicks.push({ download: this.download, href: this.href }); };
      picker.querySelector('button[aria-label="导出素材 已生成参考图"]').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      HTMLAnchorElement.prototype.click = nativeAnchorClick;
      videoTab.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const videoTabValid = Boolean(videoTab.getAttribute('aria-selected') === 'true' && picker.textContent.includes('真实视频素材') && !picker.textContent.includes('不应出现的伪视频'));
      picker.querySelector('button[aria-label="预览素材 真实视频素材"]').click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      const videoLibraryPreview = Boolean(document.querySelector('[role="dialog"][aria-label="素材预览"] video'));
      document.querySelector('button[aria-label="关闭素材预览"]').click();
      document.querySelector('.react-flow__pane').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise(resolve => requestAnimationFrame(resolve));
      const bounds = shell.getBoundingClientRect();
      const video = shell.querySelector('video');
      const firstParameter = shell.querySelector('.fc-generation-parameters__left > *').getBoundingClientRect();
      const submitGroup = shell.querySelector('.fc-generation-submit-group').getBoundingClientRect();
      const inputPanel = shell.querySelector('.fc-generation-input').getBoundingClientRect();
      const submitButton = shell.querySelector('.fc-generation-submit').getBoundingClientRect();
      const controlsSafe = submitButton.right <= inputPanel.right - 12 && submitButton.bottom <= inputPanel.bottom - 12;
      return {
        width: Math.round(bounds.width), height: Math.round(bounds.height),
        videoDraggable: !video.classList.contains('nodrag'), frameInitiallyUnselected, generationModeAbsent: !shell.querySelector('[aria-label="生成模式"]'), controlsAligned: Math.abs(firstParameter.top - submitGroup.top) <= 1, controlsSafe, imageTabValid, videoTabValid, exportWorked: downloadClicks.some(item => item.download.includes('已生成参考图')), centralPreview, videoLibraryPreview, materialColumns,
        inputHandles: shell.querySelectorAll('.fc-port--input').length,
        outputHandles: shell.querySelectorAll('.fc-port--output').length,
        dismissed: !document.querySelector('[role="listbox"][aria-label="选择画布素材"]')
      };
    });
    assert.deepEqual(result, { width: 720, height: 648, videoDraggable: true, frameInitiallyUnselected: true, generationModeAbsent: true, controlsAligned: true, controlsSafe: true, imageTabValid: true, videoTabValid: true, exportWorked: true, centralPreview: true, videoLibraryPreview: true, materialColumns: 4, inputHandles: 1, outputHandles: 1, dismissed: true });
    console.log(JSON.stringify({ ok: true, version: '0.5.29', installedCanvas: result }));
  } finally {
    if (application) await application.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
