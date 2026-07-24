'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const sourceJpeg = fs.readFileSync(path.join(root, 'frontend', 'assets', 'yishun', 'model-01.jpg'));
const replacementPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function assertInsideSystemTemp(candidate) {
  const resolved = path.resolve(candidate);
  const systemTemp = path.resolve(os.tmpdir());
  assert.equal(
    resolved.startsWith(`${systemTemp}${path.sep}`),
    true,
    `temporary path escaped the system temp directory: ${resolved}`,
  );
  return resolved;
}

function verifySourceContracts() {
  const preload = fs.readFileSync(path.join(root, 'electron', 'preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
  const webApi = fs.readFileSync(path.join(root, 'frontend', 'yishun-web-api.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'web', 'server.js'), 'utf8');

  assert.match(
    preload,
    /modelLibraryUpdate\s*:\s*\(modelId,\s*payload\)\s*=>\s*ipcRenderer\.invoke\(['"]model-library:update['"],\s*modelId,\s*payload\)/,
    'Electron preload must expose modelLibraryUpdate(modelId, payload)',
  );
  assert.match(
    main,
    /ipcMain\.handle\(['"]model-library:update['"][\s\S]*?modelLibrary\.update\(modelId,\s*payload\s*\|\|\s*\{\}\)/,
    'Electron main process must route model-library:update to ModelLibrary.update',
  );
  assert.match(
    webApi,
    /modelLibraryUpdate\s*:\s*\(modelId,\s*payload\)[\s\S]*?method\s*:\s*['"]PUT['"]/,
    'Web bridge must expose modelLibraryUpdate over PUT',
  );
  assert.match(
    server,
    /request\.method\s*===\s*['"]PUT['"]\s*\|\|\s*request\.method\s*===\s*['"]PATCH['"][\s\S]*?modelLibrary\.update\(modelLibraryMatch\[1\],\s*body\)/,
    'Web server must route PUT/PATCH model updates to ModelLibrary.update',
  );
}

function verifyModelLibraryCrud() {
  const { ModelLibrary } = require('../electron/model-library');
  const tempRoot = assertInsideSystemTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'toolplus-model-management-library-')));

  try {
    const library = new ModelLibrary(tempRoot);
    assert.deepEqual(library.list(), []);

    const created = library.create({
      name: '验收模特',
      gender: 'female',
      style: 'editorial',
      tag: '高级时装',
      region: '亚洲',
      ageGroup: '青年',
      description: '冷感 · 棚拍 · 女装',
      image: { name: 'acceptance-model.jpg', mimeType: 'image/jpeg', bytes: sourceJpeg },
    });
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    assert.equal(created.source, 'custom');
    assert.equal(created.name, '验收模特');
    assert.equal(created.gender, 'female');
    assert.equal(created.style, 'editorial');
    assert.equal(created.tag, '高级时装');
    assert.equal(created.region, '亚洲');
    assert.equal(created.ageGroup, '青年');
    assert.equal(created.meta, '冷感 · 棚拍 · 女装');
    assert.equal(created.description, created.meta);
    assert.equal(created.imageName, 'acceptance-model.jpg');
    assert.equal(created.size, sourceJpeg.length);
    assert.equal(created.updatedAt, created.createdAt);
    assert.deepEqual(library.list(), [created]);

    const original = library.read(created.id);
    assert.equal(original.image.mimeType, 'image/jpeg');
    assert.equal(Buffer.from(original.image.bytes).equals(sourceJpeg), true, 'created image bytes changed');

    const metadataUpdated = library.update(created.id, {
      name: '验收模特 A',
      gender: 'male',
      style: 'casual',
      tag: '松弛日常',
      region: '欧美',
      ageGroup: '成熟',
      meta: '自然 · 休闲 · 男装',
    });
    assert.deepEqual(
      {
        id: metadataUpdated.id,
        createdAt: metadataUpdated.createdAt,
        name: metadataUpdated.name,
        gender: metadataUpdated.gender,
        style: metadataUpdated.style,
        tag: metadataUpdated.tag,
        region: metadataUpdated.region,
        ageGroup: metadataUpdated.ageGroup,
        meta: metadataUpdated.meta,
        imageName: metadataUpdated.imageName,
        mimeType: metadataUpdated.mimeType,
        size: metadataUpdated.size,
      },
      {
        id: created.id,
        createdAt: created.createdAt,
        name: '验收模特 A',
        gender: 'male',
        style: 'casual',
        tag: '松弛日常',
        region: '欧美',
        ageGroup: '成熟',
        meta: '自然 · 休闲 · 男装',
        imageName: created.imageName,
        mimeType: created.mimeType,
        size: created.size,
      },
      'metadata-only update must preserve identity and image metadata',
    );
    assert.equal(
      Buffer.from(library.read(created.id).image.bytes).equals(sourceJpeg),
      true,
      'metadata-only update replaced the image',
    );
    assert.ok(Date.parse(metadataUpdated.updatedAt) >= Date.parse(created.updatedAt), 'metadata update did not refresh updatedAt');

    const imageUpdated = library.update(created.id, {
      image: { name: 'acceptance-model-updated.png', mimeType: 'image/png', bytes: replacementPng },
    });
    assert.equal(imageUpdated.id, created.id);
    assert.equal(imageUpdated.name, metadataUpdated.name);
    assert.equal(imageUpdated.imageName, 'acceptance-model-updated.png');
    assert.equal(imageUpdated.mimeType, 'image/png');
    assert.equal(imageUpdated.size, replacementPng.length);
    assert.ok(Date.parse(imageUpdated.updatedAt) >= Date.parse(metadataUpdated.updatedAt), 'image update did not refresh updatedAt');
    const afterImageUpdate = library.read(created.id);
    assert.equal(Buffer.from(afterImageUpdate.image.bytes).equals(replacementPng), true, 'replacement image bytes changed');
    assert.equal(fs.readdirSync(path.join(tempRoot, 'images')).length, 1, 'replaced image file was not cleaned up');

    assert.throws(() => library.update(created.id, {}), error => error && error.statusCode === 400);
    assert.throws(() => library.update('00000000-0000-4000-8000-000000000000', { name: 'missing' }), error => error && error.statusCode === 404);

    const deleted = library.delete(created.id);
    assert.equal(deleted.id, created.id);
    assert.deepEqual(library.list(), []);
    assert.deepEqual(fs.readdirSync(path.join(tempRoot, 'images')), []);
    assert.throws(() => library.read(created.id), error => error && error.statusCode === 404);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function verifyWebBridgeSerialization() {
  const source = fs.readFileSync(path.join(root, 'frontend', 'yishun-web-api.js'), 'utf8');
  const calls = [];
  const context = {
    window: {},
    location: { href: 'http://127.0.0.1:4174/', origin: 'http://127.0.0.1:4174' },
    URL,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    setTimeout,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    fetch: async (route, options = {}) => {
      calls.push({ route, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ ok: true, model: { id: 'bridge-model' } }),
      };
    },
  };
  vm.runInNewContext(source, context, { filename: 'frontend/yishun-web-api.js' });
  assert.equal(typeof context.window.yishunWebApi.modelLibraryUpdate, 'function');

  await context.window.yishunWebApi.modelLibraryUpdate('bridge-model', { name: '仅更新资料', description: '保留原图' });
  assert.equal(calls[0].route, '/api/model-library/bridge-model');
  assert.equal(calls[0].options.method, 'PUT');
  const metadataBody = JSON.parse(calls[0].options.body);
  assert.deepEqual(metadataBody, { name: '仅更新资料', description: '保留原图' }, 'metadata update must not synthesize an empty image');

  await context.window.yishunWebApi.modelLibraryUpdate('bridge-model', {
    image: { name: 'bridge.png', mimeType: 'image/png', bytes: Uint8Array.from(replacementPng) },
  });
  const imageBody = JSON.parse(calls[1].options.body);
  assert.equal(imageBody.image.name, 'bridge.png');
  assert.equal(imageBody.image.mimeType, 'image/png');
  assert.equal(imageBody.image.bytesBase64, replacementPng.toString('base64'));
  assert.equal(Object.hasOwn(imageBody.image, 'bytes'), false, 'raw image bytes leaked into Web JSON');
}

function call(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const headers = encoded
      ? { 'Content-Type': 'application/json', 'Content-Length': encoded.length, Origin: `http://127.0.0.1:${port}` }
      : {};
    const request = http.request({ hostname: '127.0.0.1', port, method, path: route, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const type = String(response.headers['content-type'] || '');
        resolve({
          status: response.statusCode,
          body: type.includes('application/json') ? JSON.parse(bytes.toString('utf8')) : bytes,
        });
      });
    });
    request.on('error', reject);
    if (encoded) request.end(encoded);
    else request.end();
  });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForServer(port) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    try {
      const response = await call(port, 'GET', '/api/health');
      if (response.status === 200) return;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('model-management Web verification server did not start');
}

async function waitForExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

async function verifyWebCrud() {
  const port = await reservePort();
  const tempRoot = assertInsideSystemTemp(fs.mkdtempSync(path.join(os.tmpdir(), 'toolplus-model-management-web-')));
  const child = spawn(process.execPath, ['web/server.js'], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      YISHUN_WEB_HOST: '127.0.0.1',
      YISHUN_WEB_PORT: String(port),
      YISHUN_WEB_DATA_ROOT: tempRoot,
      YISHUN_BACKEND_PATH: process.execPath,
      YISHUN_BACKEND_ARGS: 'scripts/fixtures/fake-flowcanvas-backend.cjs',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitForServer(port);
    const initial = await call(port, 'GET', '/api/model-library');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.body.models, []);

    const created = await call(port, 'POST', '/api/model-library', {
      name: 'Web 验收模特',
      gender: 'female',
      style: 'editorial',
      tag: 'Web 新增',
      region: '亚洲',
      ageGroup: '青年',
      description: 'Web CRUD 初始资料',
      image: { name: 'web-model.jpg', mimeType: 'image/jpeg', bytesBase64: sourceJpeg.toString('base64') },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.model.name, 'Web 验收模特');
    assert.equal(created.body.model.source, 'custom');
    assert.equal(created.body.model.updatedAt, created.body.model.createdAt);
    const modelId = created.body.model.id;

    const listed = await call(port, 'GET', '/api/model-library');
    assert.equal(listed.status, 200);
    assert.equal(listed.body.models.length, 1);
    assert.equal(listed.body.models[0].id, modelId);
    assert.equal(Object.hasOwn(listed.body.models[0], 'image'), false, 'list endpoint must not return image bytes');

    const read = await call(port, 'GET', `/api/model-library/${modelId}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.model.image.bytesBase64, sourceJpeg.toString('base64'));

    const metadataUpdated = await call(port, 'PUT', `/api/model-library/${modelId}`, {
      name: 'Web 验收模特（已编辑）',
      gender: 'male',
      style: 'casual',
      description: 'Web CRUD 编辑后资料',
    });
    assert.equal(metadataUpdated.status, 200, JSON.stringify(metadataUpdated.body));
    assert.equal(metadataUpdated.body.model.id, modelId);
    assert.equal(metadataUpdated.body.model.name, 'Web 验收模特（已编辑）');
    assert.equal(metadataUpdated.body.model.gender, 'male');
    assert.equal(metadataUpdated.body.model.style, 'casual');
    assert.equal(metadataUpdated.body.model.imageName, created.body.model.imageName);
    assert.ok(Date.parse(metadataUpdated.body.model.updatedAt) >= Date.parse(created.body.model.updatedAt));

    const imageUpdated = await call(port, 'PATCH', `/api/model-library/${modelId}`, {
      tag: 'Web 已换图',
      image: { name: 'web-model-updated.png', mimeType: 'image/png', bytesBase64: replacementPng.toString('base64') },
    });
    assert.equal(imageUpdated.status, 200, JSON.stringify(imageUpdated.body));
    assert.equal(imageUpdated.body.model.id, modelId);
    assert.equal(imageUpdated.body.model.tag, 'Web 已换图');
    assert.equal(imageUpdated.body.model.imageName, 'web-model-updated.png');
    assert.equal(imageUpdated.body.model.mimeType, 'image/png');
    assert.ok(Date.parse(imageUpdated.body.model.updatedAt) >= Date.parse(metadataUpdated.body.model.updatedAt));

    const readUpdated = await call(port, 'GET', `/api/model-library/${modelId}`);
    assert.equal(readUpdated.status, 200);
    assert.equal(readUpdated.body.model.image.bytesBase64, replacementPng.toString('base64'));

    const removed = await call(port, 'DELETE', `/api/model-library/${modelId}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.deleted.id, modelId);
    const afterDelete = await call(port, 'GET', '/api/model-library');
    assert.deepEqual(afterDelete.body.models, []);
    const missing = await call(port, 'GET', `/api/model-library/${modelId}`);
    assert.equal(missing.status, 404);
  } catch (error) {
    if (stderr) error.message += `\nWeb server stderr:\n${stderr}`;
    throw error;
  } finally {
    child.kill();
    await waitForExit(child);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

(async () => {
  verifySourceContracts();
  verifyModelLibraryCrud();
  await verifyWebBridgeSerialization();
  await verifyWebCrud();
  console.log('PASS model-management CRUD storage create/read/update/image-replace/delete Web PUT+PATCH bridge-serialization Electron update-contract');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
