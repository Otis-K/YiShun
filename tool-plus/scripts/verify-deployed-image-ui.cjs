const assert = require('node:assert/strict');
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
    assert.match(version, /0\.5\.10/, `deployed version mismatch: ${version}`);

    const profile = await window.evaluate(() => window.toolplus.canvasModelConfigGet());
    assert.equal(profile.profiles.image.configured, true, 'deployed image profile is not configured');
    assert.equal(profile.profiles.image.model, 'nano-banana-pro(特价版 1)');
    assert.doesNotMatch(JSON.stringify(profile), /"(?:apiKey|encryptedAPIKey)"\s*:|\bsk-[A-Za-z0-9_-]+\b/);
    for (const id of ['canvasModelApiKey', 'canvasVideoModelApiKey', 'canvasImageModel', 'canvasVideoModel']) {
      assert.equal(await window.locator(`#${id}`).count(), 1, `missing deployed model manager field ${id}`);
    }

    await window.locator('.sideItem', { hasText: '智能画布' }).click();
    await window.locator('#canvasOpenBtn').click();
    const frameElement = await window.locator('#canvasFrame').elementHandle();
    const frame = await frameElement.contentFrame();
    await frame.waitForFunction(() => Boolean(window.__toolPlusCanvasReady));
    const result = await frame.evaluate(() => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const node = api.addNode('image', { position: { x: 240, y: 100 } });
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const shell = document.querySelector(`.react-flow__node[data-id="${node.id}"]`);
        const select = label => shell.querySelector(`select[aria-label="${label}"]`);
        const values = label => Array.from(select(label)?.options || []).map(option => option.value);
        resolve({
          model: shell.querySelector('button[aria-label="图片生成模型"]')?.textContent || '',
          ratio: select('图片比例')?.value || '',
          ratios: values('图片比例'),
          quality: select('图片画质')?.value || '',
          qualities: values('图片画质'),
          count: select('图片数量')?.value || '',
          hasUpload: shell.textContent.includes('上传'),
          hasReferenceSelect: shell.textContent.includes('选择'),
        });
      })));
    });
    assert.match(result.model, /Nano Banana Pro/);
    assert.deepEqual(result.ratios, ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9']);
    assert.deepEqual(result.qualities, ['标准画质 · 1K', '标准画质 · 2K', '高清画质 · 4K']);
    assert.equal(result.ratio, '16:9');
    assert.equal(result.quality, '标准画质 · 2K');
    assert.equal(result.count, '1张');
    assert.equal(result.hasUpload, true);
    assert.equal(result.hasReferenceSelect, true);
    console.log(JSON.stringify({ ok: true, version, imageProfileConfigured: true, result }));
  } finally {
    if (application) {
      await Promise.race([application.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (applicationProcess && !applicationProcess.killed) {
        try { applicationProcess.kill(); } catch (_) {}
      }
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
