const fs = require('node:fs');
const { app, safeStorage } = require('electron');

app.whenReady().then(() => {
  const capability = process.env.TOOLPLUS_CHECK_CAPABILITY === 'video' ? 'video' : 'image';
  const settingsPath = process.env.TOOLPLUS_CHECK_SETTINGS;
  const expected = process.env.TOOLPLUS_CHECK_EXPECTED || '';
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const encrypted = settings.canvasModels?.[capability]?.encryptedAPIKey || '';
  const actual = encrypted && safeStorage.isEncryptionAvailable()
    ? safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    : '';
  process.stdout.write(JSON.stringify({
    capability,
    configured: Boolean(encrypted),
    decryptable: Boolean(actual),
    matchesExpected: Boolean(expected) && actual === expected,
    baseURL: settings.canvasModels?.[capability]?.baseURL || '',
    model: settings.canvasModels?.[capability]?.model || '',
  }));
  app.quit();
}).catch(error => {
  process.stderr.write(String(error?.stack || error));
  app.exit(1);
});
