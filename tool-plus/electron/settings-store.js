const fs = require('node:fs');
const path = require('node:path');

const LEGACY_REMOTE_PREFIX = ['mm', 'Agent'].join('');

function sanitizeSettings(raw, defaultWorkspaceRoot) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const settings = { ...source };
  const removedKeys = [];

  for (const key of Object.keys(settings)) {
    if (key.startsWith(LEGACY_REMOTE_PREFIX)) {
      removedKeys.push(key);
      delete settings[key];
    }
  }

  if (!settings.workspaceRoot || !path.isAbsolute(settings.workspaceRoot)) {
    settings.workspaceRoot = defaultWorkspaceRoot;
  }

  return { settings, removedKeys };
}

function writeSettingsAtomic(filePath, settings) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(settings, null, 2), 'utf8');
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      fs.rmSync(filePath, { force: true });
      fs.renameSync(temporaryPath, filePath);
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function loadSettingsFile(filePath, defaultWorkspaceRoot) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const result = sanitizeSettings(raw, defaultWorkspaceRoot);
    if (result.removedKeys.length > 0) writeSettingsAtomic(filePath, result.settings);
    return result.settings;
  } catch (_) {
    return { workspaceRoot: defaultWorkspaceRoot };
  }
}

function saveSettingsFile(filePath, settings, defaultWorkspaceRoot) {
  const sanitized = sanitizeSettings(settings, defaultWorkspaceRoot).settings;
  writeSettingsAtomic(filePath, sanitized);
  return sanitized;
}

module.exports = {
  loadSettingsFile,
  sanitizeSettings,
  saveSettingsFile,
  writeSettingsAtomic
};
