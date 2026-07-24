const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_G_DATA_ROOT, migratePersistentData } = require('../electron/data-root');

const projectRoot = path.resolve(__dirname, '..');
const workRoot = path.join(projectRoot, 'work', 'data-root-verification');
const sourceRoot = path.join(workRoot, 'source');
const targetRoot = path.join(workRoot, 'target');

fs.rmSync(workRoot, { recursive: true, force: true });
fs.mkdirSync(path.join(sourceRoot, 'Local Storage', 'leveldb'), { recursive: true });
fs.mkdirSync(path.join(sourceRoot, 'canvas-assets'), { recursive: true });
fs.mkdirSync(path.join(sourceRoot, 'Cache'), { recursive: true });
fs.writeFileSync(path.join(sourceRoot, 'Local Storage', 'leveldb', '000003.log'), 'canvas-graph');
fs.writeFileSync(path.join(sourceRoot, 'canvas-assets', 'result.png'), 'generated-image');
fs.writeFileSync(path.join(sourceRoot, 'settings.json'), '{"theme":"dark"}');
fs.writeFileSync(path.join(sourceRoot, 'tool-plus.db'), 'sqlite-data');
fs.writeFileSync(path.join(sourceRoot, 'Cache', 'disposable.bin'), 'must-not-migrate');

const result = migratePersistentData(sourceRoot, targetRoot);
assert.deepEqual(result.copied.sort(), ['Local Storage', 'canvas-assets', 'settings.json', 'tool-plus.db'].sort());
assert.equal(fs.readFileSync(path.join(targetRoot, 'Local Storage', 'leveldb', '000003.log'), 'utf8'), 'canvas-graph');
assert.equal(fs.readFileSync(path.join(targetRoot, 'canvas-assets', 'result.png'), 'utf8'), 'generated-image');
assert.equal(fs.existsSync(path.join(targetRoot, 'Cache')), false, 'cache must not be migrated');
assert.equal(fs.existsSync(path.join(targetRoot, '.toolplus-data-root')), true);
assert.equal(DEFAULT_G_DATA_ROOT, 'G:\\tool-plus-data');

const mainSource = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(projectRoot, 'electron', 'preload.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'renderer.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(projectRoot, 'frontend', 'index.html'), 'utf8');
assert.match(mainSource, /app\.setPath\('userData', dataRootInitialization\.dataRoot\)/);
assert.match(mainSource, /ipcMain\.handle\('storage:get'/);
assert.match(mainSource, /ipcMain\.handle\('storage:select'/);
assert.match(mainSource, /ipcMain\.handle\('storage:save'/);
assert.match(preloadSource, /storageGet/);
assert.match(preloadSource, /storageSelect/);
assert.match(preloadSource, /storageSave/);
assert.match(rendererSource, /storageSave/);
assert.match(htmlSource, /id="dataRootPath"/);
assert.match(htmlSource, /id="pickDataRoot"/);

console.log('Data-root verification passed.');
console.log(`Verified migration target: ${targetRoot}`);
