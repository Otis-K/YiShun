const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { materializeCanvasAssets } = require('../electron/canvas-assets');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcanvas-assets-'));
try {
  const staged = materializeCanvasAssets([
    { name: '首帧.png', kind: 'image', role: 'firstFrame', mimeType: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71]) },
    { name: '参考音频.mp3', kind: 'audio', role: 'reference', mimeType: 'audio/mpeg', bytes: Uint8Array.from([73, 68, 51]) }
  ], root);
  assert.equal(staged.assets.length, 2);
  assert.deepEqual(staged.assets.map(item => [item.kind, item.role]), [['image', 'firstFrame'], ['audio', 'reference']]);
  assert.ok(staged.assets.every(item => path.isAbsolute(item.path) && fs.statSync(item.path).isFile()));
  const stagingRoot = path.dirname(staged.assets[0].path);
  staged.cleanup();
  assert.equal(fs.existsSync(stagingRoot), false);
  assert.throws(() => materializeCanvasAssets([{ kind: 'image', localPath: path.join(os.tmpdir(), 'outside.png') }], root), /画布资源目录/);
  process.stdout.write(JSON.stringify({ ok: true, assets: 2, cleanup: true, pathIsolation: true }));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
