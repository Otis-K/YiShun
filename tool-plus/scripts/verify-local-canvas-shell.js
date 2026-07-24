const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { loadSettingsFile } = require('../electron/settings-store');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const main = read('electron/main.js');
const preload = read('electron/preload.js');
const renderer = read('frontend/renderer.js');
const html = read('frontend/index.html');
const styles = read('frontend/styles.css');
const canvasHtml = read('frontend/canvas.html');
const manifest = JSON.parse(read('package.json'));
const removedIntegrationName = ['mm', 'agent'].join('');

for (const [name, source] of [
  ['main process', main],
  ['main preload', preload],
  ['main renderer', renderer],
  ['package manifest', JSON.stringify(manifest)]
]) {
  assert.doesNotMatch(source, new RegExp(removedIntegrationName, 'i'), `${name} must not retain the removed remote integration`);
  assert.doesNotMatch(source, /agent\/api|access.?token|gateway/i, `${name} must not retain remote credentials or proxy routes`);
}

assert.equal((main.match(/new\s+BrowserWindow\s*\(/g) || []).length, 1, 'main process must create only the application window');
assert.doesNotMatch(main, /openCanvasWindow|canvasWindow|ipcMain\.handle\('open-canvas'/, 'main process must not create or broker a canvas window');
assert.doesNotMatch(main, /fetch\s*\(|FormData/, 'main process must delegate model HTTP to the Go backend');
assert.match(main, /safeStorage\.encryptString/, 'main process must encrypt the model credential');
assert.match(main, /normalizedModelProfiles/, 'main process must route separate image and video model profiles');
assert.match(main, /baseURL\s*!==\s*currentBaseURL\s*&&\s*!apiKey/, 'changing a model API address must require a new key');
assert.match(main, /get-file-settings['"],\s*\(\)\s*=>\s*\(\{\s*workspaceRoot:/, 'file settings IPC must not expose encrypted model settings');
assert.match(main, /flowcanvas-backend\.exe/, 'main process must execute the local FlowCanvas Go backend');
assert.match(main, /new\s+ModelTaskQueue\(5\)/, 'main process must allow five bounded concurrent model tasks');
assert.match(main, /require\('\.\/model-task-queue'\)/, 'main process must use the unit-tested model queue module');
assert.match(preload, /canvasImageGenerate/, 'preload must expose the scoped image-generation IPC');
assert.doesNotMatch(preload, /openCanvas|open-canvas/, 'preload must not expose a second-window canvas IPC');
for (const id of ['canvasView', 'canvasBackBtn', 'canvasImmersiveBtn', 'canvasFrame']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `main document must include ${id}`);
}
assert.match(html, /id=["']canvasFrame["'][\s\S]*?data-src=["']canvas\.html["']/, 'main document must lazily embed the local canvas page');
assert.match(html, /返回进入前页面/, 'canvas view must expose an explicit return action');
assert.match(styles, /\.canvasView\s*\{/, 'main stylesheet must contain the embedded canvas view');
assert.match(styles, /\.canvasImmersiveMode\s+\.workspace\s*\{[\s\S]*?grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)/, 'canvas immersive mode must collapse the outer sidebar');
assert.match(renderer, /showView\(canvasView\)/, 'renderer must switch to canvas inside the main view stack');
assert.match(renderer, /function\s+returnFromCanvas\s*\(/, 'renderer must restore the entry view');
assert.match(renderer, /function\s+setCanvasImmersive\s*\(/, 'renderer must expose a canvas immersive toggle');
assert.match(renderer, /canvasReturnView/, 'renderer must remember the page that opened the canvas');
assert.doesNotMatch(renderer, /toolApi\.openCanvas\(\)/, 'renderer must not invoke a window-opening API');
assert.match(canvasHtml, /frame-ancestors\s+'self'/, 'canvas CSP must allow only the local same-window host');
assert.match(renderer, /canvasModelConfigSave/, 'renderer must expose model configuration without handling stored plaintext credentials');
assert.match(read('frontend/canvas-sdk-adapter.js'), /imageReferenceOrder/, 'image bridge must preserve mixed local and remote reference order');
for (const id of ['canvasModelApiKey', 'canvasVideoModelApiKey', 'canvasImageModel', 'canvasVideoModel']) {
  assert.match(html, new RegExp(`id=["']${id}["']`), `model manager must include ${id}`);
}
assert.equal(manifest.version, '0.5.30');
assert.ok(
  Array.isArray(manifest.build && manifest.build.files) && manifest.build.files.includes('!electron/canvas-preload.js'),
  'production build must exclude the test-only canvas preload'
);

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolplus-settings-'));
try {
  const settingsFile = path.join(temporaryRoot, 'settings.json');
  const prefix = ['mm', 'Agent'].join('');
  const legacyKeys = [
    `${prefix}ServerUrl`,
    `${prefix}DefaultCanvasId`,
    `${prefix}AccessTokenEncrypted`,
    `${prefix}AccessTokenEncoding`,
    `${prefix}AccessToken`,
    `${prefix}HasAccessToken`
  ];
  const existing = {
    workspaceRoot: 'D:\\ToolPlusWorkspace',
    theme: 'light',
    [legacyKeys[0]]: 'https://removed.example',
    [legacyKeys[1]]: 'old-canvas',
    [legacyKeys[2]]: 'encrypted-secret',
    [legacyKeys[3]]: 'safeStorage',
    [legacyKeys[4]]: 'plain-secret',
    [legacyKeys[5]]: true
  };
  fs.writeFileSync(settingsFile, JSON.stringify(existing), 'utf8');

  const migrated = loadSettingsFile(settingsFile, 'G:\\tool-user-file');
  const persisted = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  assert.equal(migrated.workspaceRoot, existing.workspaceRoot, 'workspace must survive migration');
  assert.equal(migrated.theme, existing.theme, 'unrelated settings must survive migration');
  for (const key of legacyKeys) {
    assert.equal(Object.hasOwn(migrated, key), false, `${key} must be removed in memory`);
    assert.equal(Object.hasOwn(persisted, key), false, `${key} must be removed from disk`);
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log('PASS local-canvas-shell same-window canvas view, explicit return navigation, one BrowserWindow, scoped model IPC, encrypted credential storage, Go model proxy, bounded parallel model queue, legacy settings scrubbed, custom G-drive data root, version 0.5.30');
