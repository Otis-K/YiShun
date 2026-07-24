const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');

const REGISTRY_KEY = 'HKCU\\Software\\ToolPlus';
const DATA_ROOT_VALUE = 'DataRoot';
const PREVIOUS_ROOT_VALUE = 'PreviousDataRoot';
const DEFAULT_G_DATA_ROOT = 'G:\\tool-plus-data';
const PERSISTENT_ENTRIES = [
  'Local Storage', 'Session Storage', 'blob_storage', 'canvas-assets', 'workflow-runs',
  'model-library', 'settings.json', 'flowcanvas-oss.json', 'tool-plus.db', 'tool-plus.db-shm', 'tool-plus.db-wal',
];

function queryRegistry(name) {
  const result = spawnSync('reg.exe', ['QUERY', REGISTRY_KEY, '/v', name], { windowsHide: true });
  if (result.status !== 0) return '';
  let output = '';
  try {
    output = new TextDecoder('utf-8', { fatal: true }).decode(result.stdout);
  } catch (_) {
    output = new TextDecoder('gb18030').decode(result.stdout);
  }
  const line = output.split(/\r?\n/).find(value => value.includes(` ${name} `));
  const match = line && line.match(/REG_(?:EXPAND_)?SZ\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function writeRegistry(name, value) {
  const result = spawnSync('reg.exe', ['ADD', REGISTRY_KEY, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], {
    encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`无法保存数据目录配置：${String(result.stderr || result.stdout || '').trim()}`);
}

function deleteRegistryValue(name) {
  spawnSync('reg.exe', ['DELETE', REGISTRY_KEY, '/v', name, '/f'], { encoding: 'utf8', windowsHide: true });
}

function absoluteDirectory(value) {
  const candidate = String(value || '').trim();
  if (!candidate || !path.isAbsolute(candidate)) throw new Error('数据目录必须是绝对路径。');
  return path.resolve(candidate);
}

function defaultDataRoot() {
  return fs.existsSync('G:\\') ? DEFAULT_G_DATA_ROOT : path.join(process.env.APPDATA || process.cwd(), 'tool-plus');
}

function ensureWritableDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.toolplus-write-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(probe, 'ok');
  fs.unlinkSync(probe);
}

function migratePersistentData(sourceRoot, targetRoot) {
  const source = path.resolve(String(sourceRoot || ''));
  const target = absoluteDirectory(targetRoot);
  if (!sourceRoot || source.toLowerCase() === target.toLowerCase() || !fs.existsSync(source)) {
    ensureWritableDirectory(target);
    return { copied: [] };
  }
  ensureWritableDirectory(target);
  const copied = [];
  for (const name of PERSISTENT_ENTRIES) {
    const sourcePath = path.join(source, name);
    if (!fs.existsSync(sourcePath)) continue;
    const targetPath = path.join(target, name);
    fs.cpSync(sourcePath, targetPath, { recursive: true, force: true, errorOnExist: false });
    copied.push(name);
  }
  fs.writeFileSync(path.join(target, '.toolplus-data-root'), JSON.stringify({ migratedFrom: source, migratedAt: new Date().toISOString() }, null, 2));
  return { copied };
}

function initializeDataRoot() {
  const configured = queryRegistry(DATA_ROOT_VALUE);
  const target = absoluteDirectory(configured || defaultDataRoot());
  const legacyRoot = path.join(process.env.APPDATA || '', 'tool-plus');
  const previous = queryRegistry(PREVIOUS_ROOT_VALUE) || (!configured && legacyRoot.toLowerCase() !== target.toLowerCase() ? legacyRoot : '');
  const migration = migratePersistentData(previous, target);
  writeRegistry(DATA_ROOT_VALUE, target);
  deleteRegistryValue(PREVIOUS_ROOT_VALUE);
  return { dataRoot: target, migratedFrom: previous, copied: migration.copied };
}

function scheduleDataRoot(nextRoot, currentRoot) {
  const target = absoluteDirectory(nextRoot);
  const current = absoluteDirectory(currentRoot);
  ensureWritableDirectory(target);
  if (target.toLowerCase() === current.toLowerCase()) return { dataRoot: current, restartRequired: false };
  writeRegistry(PREVIOUS_ROOT_VALUE, current);
  writeRegistry(DATA_ROOT_VALUE, target);
  return { dataRoot: target, restartRequired: true };
}

module.exports = {
  DEFAULT_G_DATA_ROOT,
  PERSISTENT_ENTRIES,
  initializeDataRoot,
  migratePersistentData,
  scheduleDataRoot,
};
