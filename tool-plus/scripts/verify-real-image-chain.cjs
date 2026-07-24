const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('G:/FlowCanvas-SDK/FlowCanvas-SDK/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const referenceOnly = process.env.FLOWCANVAS_ACCEPTANCE_REFERENCE_ONLY === '1';
const referenceCount = Math.max(1, Math.min(14, Number(process.env.FLOWCANVAS_ACCEPTANCE_REFERENCE_COUNT || 1)));
const reportPath = path.join(root, 'work', referenceOnly ? 'real-image-reference-acceptance.json' : 'real-image-acceptance.json');
const referencePath = path.join(root, 'work', 'acceptance-first-frame.png');
const expectedModel = 'nano-banana-pro(特价版 1)';

function redact(value) {
  return String(value || '')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED_KEY]')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s"']+/gi, '[REDACTED_URL]');
}

function safeRequest(request) {
  const source = request && typeof request === 'object' ? request : {};
  return {
    size: String(source.size || ''),
    aspectRatio: String(source.aspectRatio || ''),
    referenceCount: Number(source.referenceCount || 0),
    uploadedAssets: (Array.isArray(source.uploadedAssets) ? source.uploadedAssets : []).map(asset => ({
      kind: String(asset?.kind || ''),
      role: String(asset?.role || ''),
      mimeType: String(asset?.mimeType || ''),
      size: Number(asset?.size || 0),
    })),
  };
}

function summarize(result, decoded) {
  if (!result?.data) return { ok: Boolean(result?.ok), error: redact(result?.error) };
  const localPath = String(result.data.localPath || '');
  const diskBytes = localPath && fs.existsSync(localPath) ? fs.statSync(localPath).size : 0;
  return {
    ok: Boolean(result.ok),
    error: redact(result.error),
    data: {
      provider: String(result.data.provider || ''),
      model: String(result.data.model || ''),
      taskId: String(result.data.taskId || ''),
      status: String(result.data.status || ''),
      progress: result.data.progress,
      contentType: String(result.data.contentType || ''),
      bytes: Number(result.data.bytes || 0),
      diskBytes,
      localPath,
      decoded: decoded || { empty: true, width: 0, height: 0 },
      request: safeRequest(result.data.request),
    },
  };
}

function assertImageResult(label, result, decoded, expected) {
  assert.equal(result?.ok, true, `${label}: ${redact(result?.error || 'request failed')}`);
  const data = result.data || {};
  assert.equal(data.provider, 'tmlab-tasks', `${label}: provider mismatch`);
  assert.equal(data.model, expectedModel, `${label}: model mismatch`);
  assert.ok(String(data.taskId || '').trim(), `${label}: missing task ID`);
  assert.equal(String(data.status || '').toLowerCase(), 'completed', `${label}: task not completed`);
  assert.match(String(data.contentType || ''), /^image\//, `${label}: non-image content type`);
  assert.ok(data.localPath && path.isAbsolute(data.localPath), `${label}: missing absolute result path`);
  assert.ok(fs.existsSync(data.localPath), `${label}: result file missing`);
  const diskBytes = fs.statSync(data.localPath).size;
  assert.ok(diskBytes > 0, `${label}: empty result file`);
  assert.equal(Number(data.bytes), diskBytes, `${label}: downloaded bytes differ from saved file`);
  assert.equal(decoded?.empty, false, `${label}: Electron could not decode result image`);
  assert.ok(decoded.width > 0 && decoded.height > 0, `${label}: invalid decoded dimensions`);
  const request = safeRequest(data.request);
  assert.equal(request.size, expected.size, `${label}: size was not preserved`);
  assert.equal(request.aspectRatio, expected.aspectRatio, `${label}: aspect ratio was not preserved`);
  assert.equal(request.referenceCount, expected.referenceCount, `${label}: reference count mismatch`);
  assert.equal(request.uploadedAssets.length, expected.uploadedAssets, `${label}: OSS upload evidence mismatch`);
  if (expected.uploadedAssets) {
    assert.ok(request.uploadedAssets.every(asset => asset.kind === 'image' && asset.size > 0), `${label}: uploaded asset evidence invalid`);
  }
}

(async () => {
  const startedAt = new Date().toISOString();
  let application;
  let applicationProcess;
  let textResult;
  let referenceResult;
  let publicConfig;
  let decoded = [];
  const failures = [];
  try {
    assert.ok(fs.existsSync(referencePath), 'local reference image is missing');
    application = await electron.launch({
      executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: ['.'],
      cwd: root,
      timeout: 30000,
    });
    applicationProcess = application.process();
    const window = await application.firstWindow();
    window.setDefaultTimeout(30000);
    await window.waitForLoadState('domcontentloaded');
    publicConfig = await window.evaluate(() => window.toolplus.canvasModelConfigGet());
    assert.equal(publicConfig?.profiles?.image?.configured, true, 'image model profile is not configured');
    assert.equal(publicConfig?.profiles?.image?.model, expectedModel, 'image model profile points to the wrong model');
    const publicJSON = JSON.stringify(publicConfig);
    assert.doesNotMatch(publicJSON, /"(?:apiKey|encryptedAPIKey)"\s*:/i, 'public model config leaked credential data');
    assert.doesNotMatch(publicJSON, /\bsk-[A-Za-z0-9_-]+\b/, 'public model config leaked a plaintext key');

    if (!referenceOnly) {
      textResult = await window.evaluate(async model => window.toolplus.canvasImageGenerate({
        prompt: '一只橘猫坐在蓝色窗边，柔和自然光，高清商业摄影，细节清晰',
        model,
        size: '2K',
        aspectRatio: '16:9',
        parameters: {},
      }), expectedModel);
    }

    const bytes = Array.from(fs.readFileSync(referencePath));
    referenceResult = await window.evaluate(async ({ input, model, referenceCount }) => window.toolplus.canvasImageGenerate({
      prompt: '参考画面构图，生成同风格的未来工作室概念图，保持蓝色科技视觉，高清细节',
      model,
      size: '1K',
      aspectRatio: '1:1',
      imageReferenceOrder: Array.from({ length: referenceCount }, (_, index) => ({ source: 'local', index })),
      localAssets: Array.from({ length: referenceCount }, (_, index) => ({
        name: `acceptance-reference-${index + 1}.png`, kind: 'image', role: 'reference', mimeType: 'image/png',
        bytes: Uint8Array.from(input).buffer,
      })),
      parameters: {},
    }), { input: bytes, model: expectedModel, referenceCount });

    const paths = [textResult?.data?.localPath || '', referenceResult?.data?.localPath || ''];
    decoded = await application.evaluate(({ nativeImage }, imagePaths) => imagePaths.map(imagePath => {
      if (!imagePath) return { empty: true, width: 0, height: 0 };
      const image = nativeImage.createFromPath(imagePath);
      const size = image.isEmpty() ? { width: 0, height: 0 } : image.getSize();
      return { empty: image.isEmpty(), width: size.width, height: size.height };
    }), paths);

    const cases = [
      ...(!referenceOnly ? [['textToImage', textResult, decoded[0], { size: '2K', aspectRatio: '16:9', referenceCount: 0, uploadedAssets: 0 }]] : []),
      ['referenceImage', referenceResult, decoded[1], { size: '1K', aspectRatio: '1:1', referenceCount, uploadedAssets: referenceCount }],
    ];
    for (const [label, result, image, expected] of cases) {
      try { assertImageResult(label, result, image, expected); } catch (error) { failures.push(redact(error.message)); }
    }
  } catch (error) {
    failures.push(redact(error.message || error));
  } finally {
    if (application) {
      await Promise.race([application.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (applicationProcess && !applicationProcess.killed) {
        try { applicationProcess.kill(); } catch (_) {}
      }
    }
  }

  const report = {
    test: 'FlowCanvas image node -> Electron image profile -> Go model layer -> OSS reference upload -> NanoBanana',
    startedAt,
    finishedAt: new Date().toISOString(),
    modelProfiles: {
      imageConfigured: Boolean(publicConfig?.profiles?.image?.configured),
      videoConfigured: Boolean(publicConfig?.profiles?.video?.configured),
      imageModel: String(publicConfig?.profiles?.image?.model || ''),
      publicConfigRedacted: !/"(?:apiKey|encryptedAPIKey)"\s*:/i.test(JSON.stringify(publicConfig || {})),
    },
    cases: {
      textToImage: referenceOnly ? { skipped: true } : { request: { size: '2K', aspectRatio: '16:9' }, result: summarize(textResult, decoded[0]) },
      referenceImage: { request: { size: '1K', aspectRatio: '1:1', localReferences: referenceCount }, result: summarize(referenceResult, decoded[1]) },
    },
    failures,
  };
  report.passed = failures.length === 0 && report.modelProfiles.imageConfigured && report.modelProfiles.publicConfigRedacted;
  const serialized = JSON.stringify(report, null, 2);
  assert.doesNotMatch(serialized, /\bsk-[A-Za-z0-9_-]+\b|\bBearer\s+[^\s"']+/i, 'acceptance report contains credentials');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, serialized, 'utf8');
  process.stdout.write(JSON.stringify({
    passed: report.passed,
    cases: { textToImage: !failures.some(item => item.startsWith('textToImage:')), referenceImage: !failures.some(item => item.startsWith('referenceImage:')) },
    failures,
    reportPath,
  }));
  process.exitCode = report.passed ? 0 : 2;
})().catch(error => {
  process.stderr.write(redact(error?.stack || error));
  process.exitCode = 1;
});
