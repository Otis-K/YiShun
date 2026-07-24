const fs = require('node:fs');
const path = require('node:path');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', async () => {
  const request = JSON.parse(input || '{}');
  process.stderr.write(`${JSON.stringify({ type: 'progress', status: 'running', progress: 0.35, message: '测试模型处理中' })}\n`);
  if (request.prompt === 'invalid-token-test') {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: '{"status":401,"error":{"message":"Invalid token","type":"invalid_request_error","token":"raw-upstream-secret"}}',
    }));
    return;
  }
  if (request.prompt === 'web integration test' && process.env.FLOWCANVAS_MODEL_API_KEY !== 'updated-secret') {
    process.stdout.write(JSON.stringify({ ok: false, error: `unexpected normalized key: ${process.env.FLOWCANVAS_MODEL_API_KEY || '<empty>'}` }));
    return;
  }
  if (request.prompt === 'slow-cancel-test') await new Promise(resolve => setTimeout(resolve, 10000));
  const extension = request.action === 'video.generate' ? '.mp4' : '.png';
  const target = path.join(request.outputDir, `fake-result${extension}`);
  fs.mkdirSync(request.outputDir, { recursive: true });
  fs.writeFileSync(target, Buffer.from(request.action === 'video.generate' ? 'fake-video-bytes' : 'fake-image-bytes'));
  process.stdout.write(JSON.stringify({
    ok: true,
    data: {
      provider: 'fake-web-verification', model: request.model, taskId: 'fake-task', status: 'completed',
      progress: 1, url: 'https://provider.example/result', contentType: request.action === 'video.generate' ? 'video/mp4' : 'image/png',
      bytes: fs.statSync(target).size, localPath: target,
      request: {
        localAssetNames: (request.localAssets || []).map(asset => asset.name),
        localAssetKinds: (request.localAssets || []).map(asset => asset.kind),
        imageReferenceOrder: request.imageReferenceOrder || [],
      },
    },
  }));
});
