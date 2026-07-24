const { _electron: electron } = require('G:/FlowCanvas-SDK/FlowCanvas-SDK/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

(async () => {
  let application;
  let applicationProcess;
  try {
    const executablePath = process.env.TOOLPLUS_DEPLOYED_EXE || 'G:/tool-test/tool-plus/文档批量处理工具.exe';
    application = await electron.launch({ executablePath, timeout: 30000 });
    applicationProcess = application.process();
    const window = await application.firstWindow();
    window.setDefaultTimeout(15000);
    await window.waitForLoadState('domcontentloaded');
    const version = await window.locator('.brandText small').textContent();
    await window.locator('.sideItem', { hasText: '智能画布' }).click();
    await window.locator('#canvasOpenBtn').click();
    const frameElement = await window.locator('#canvasFrame').elementHandle();
    const frame = await frameElement.contentFrame();
    await frame.waitForFunction(() => Boolean(window.__toolPlusCanvasReady));
    const result = await frame.evaluate(() => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const node = api.addNode('video', { position: { x: 240, y: 100 } });
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const shell = document.querySelector('.react-flow__node[data-id="' + node.id + '"]');
        const value = label => shell.querySelector('select[aria-label="' + label + '"]')?.value || '';
        resolve({
          model: shell.querySelector('button[aria-label="视频生成模型"]')?.textContent || '',
          modeType: value('生成模式'), ratio: value('视频比例'), resolution: value('视频分辨率'),
          duration: value('视频时长'), sound: value('生成声音'), hasFirstFrame: shell.textContent.includes('首帧'), hasLastFrame: shell.textContent.includes('尾帧')
        });
      })));
    });
    if (!version.includes('0.5.10')) throw new Error(`deployed version mismatch: ${version}`);
    if (!result.model.includes('Seedance 2.0 Fast') || result.modeType !== 'text2video' || result.ratio !== '16:9'
      || result.resolution !== '480p' || result.duration !== '5秒' || result.sound !== 'off'
      || !result.hasFirstFrame || !result.hasLastFrame) throw new Error(`deployed video UI mismatch: ${JSON.stringify(result)}`);
    console.log(JSON.stringify({ ok: true, version, result }));
  } finally {
    if (application) {
      await Promise.race([application.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (applicationProcess && !applicationProcess.killed) {
        try { applicationProcess.kill(); } catch (_) {}
      }
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
