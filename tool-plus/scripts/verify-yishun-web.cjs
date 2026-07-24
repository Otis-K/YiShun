const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const port = 4191;
const testDataRoot = path.join(root, 'work', 'yishun-web-test');

function call(method, route, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({ hostname: '127.0.0.1', port, method, path: route, headers: encoded ? { 'Content-Type': 'application/json', 'Content-Length': encoded.length, Origin: `http://127.0.0.1:${port}` } : {} }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const type = String(response.headers['content-type'] || '');
        resolve({ status: response.statusCode, headers: response.headers, body: type.includes('application/json') ? JSON.parse(buffer.toString('utf8')) : buffer });
      });
    });
    request.on('error', reject);
    if (encoded) request.end(encoded); else request.end();
  });
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try { const result = await call('GET', '/api/health'); if (result.status === 200) return result.body; } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Yishun Web test server did not start');
}

async function waitForTask(id, terminal = ['completed', 'failed', 'cancelled']) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    const response = await call('GET', `/api/tasks/${id}`);
    if (terminal.includes(response.body.task.state)) return response.body.task;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Task ${id} did not finish`);
}

(async () => {
  const child = spawn(process.execPath, ['web/server.js'], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      YISHUN_WEB_PORT: String(port),
      YISHUN_WEB_DATA_ROOT: testDataRoot,
      YISHUN_BACKEND_PATH: process.execPath,
      YISHUN_BACKEND_ARGS: 'scripts/fixtures/fake-flowcanvas-backend.cjs',
      FLOWCANVAS_IMAGE_MODEL_API_KEY: 'verification-secret-image',
      FLOWCANVAS_VIDEO_MODEL_API_KEY: 'verification-secret-video',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const health = await waitForServer();
    assert.equal(health.backendReady, true);
    assert.equal(health.profiles.image.configured, true);
    assert.doesNotMatch(JSON.stringify(health), /verification-secret/);

    const page = await call('GET', '/');
    assert.equal(page.status, 200);
    assert.match(page.body.toString('utf8'), /yishun-web-api\.js/);

    const config = await call('PUT', '/api/model-config', { profiles: { image: { baseURL: 'https://api.tmlab.store', model: 'nano-banana-pro(特价版 1)', apiKey: 'Bearer   updated-secret' } } });
    assert.equal(config.status, 200);
    assert.equal(config.body.profiles.image.configured, true);
    assert.doesNotMatch(JSON.stringify(config.body), /Bearer|updated-secret/i);

    const created = await call('POST', '/api/tasks', { action: 'image.generate', payload: { prompt: 'web integration test', model: 'nano-banana-pro(特价版 1)', size: '1K', aspectRatio: '1:1' } });
    assert.equal(created.status, 202);
    const completed = await waitForTask(created.body.task.id);
    assert.equal(completed.state, 'completed', completed.error);
    assert.equal(completed.result.ok, true);
    assert.match(completed.result.data.url, /^\/api\/files\/image\//);
    assert.equal(Object.hasOwn(completed.result.data, 'localPath'), false);

    const resultFile = await call('GET', completed.result.data.url);
    assert.equal(resultFile.status, 200);
    assert.equal(resultFile.body.toString(), 'fake-image-bytes');

    const invalidToken = await call('POST', '/api/tasks', { action: 'image.generate', payload: { prompt: 'invalid-token-test', model: 'nano-banana-pro(特价版 1)', size: '1K', aspectRatio: '1:1' } });
    assert.equal(invalidToken.status, 202);
    const invalidTokenTask = await waitForTask(invalidToken.body.task.id);
    assert.equal(invalidTokenTask.state, 'failed');
    assert.match(invalidTokenTask.error, /图片模型 API Key 无效或已失效/);
    assert.doesNotMatch(invalidTokenTask.error, /Invalid token|401|raw-upstream-secret|[{}]/i);

    const saved = await call('POST', '/api/files/save', { sourceUrl: completed.result.data.url, suggestedName: 'yishun-tryon-test.png' });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.saved.bytes, Buffer.byteLength('fake-image-bytes'));
    assert.equal(path.dirname(saved.body.saved.path), path.join(testDataRoot, 'saved', 'image'));
    assert.equal(fs.readFileSync(saved.body.saved.path, 'utf8'), 'fake-image-bytes');

    const invalidSave = await call('POST', '/api/files/save', { sourceUrl: '/api/files/image/..%2Foutside.png', suggestedName: 'outside.png' });
    assert.equal(invalidSave.status, 403);

    const slow = await call('POST', '/api/tasks', { action: 'image.generate', payload: { prompt: 'slow-cancel-test', model: 'nano-banana-pro(特价版 1)' } });
    await new Promise(resolve => setTimeout(resolve, 180));
    const cancelled = await call('DELETE', `/api/tasks/${slow.body.task.id}`);
    assert.equal(cancelled.status, 200);
    const cancelledTask = await waitForTask(slow.body.task.id);
    assert.equal(cancelledTask.state, 'cancelled');

    const crossSite = await new Promise((resolve, reject) => {
      const request = http.request({ hostname: '127.0.0.1', port, method: 'PUT', path: '/api/model-config', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
      request.on('error', reject); request.end('{}');
    });
    assert.equal(crossSite, 403);

    console.log('PASS yishun-web static-shell bearer-prefix-normalization auth-error-localization model-config-secret-redaction async-image-task web-result-url server-side-save cancellation same-origin-guard');
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
