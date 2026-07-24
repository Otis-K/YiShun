const fs = require('node:fs');
const { app, safeStorage } = require('electron');
const { writeSettingsAtomic } = require('../electron/settings-store');

app.whenReady().then(() => {
  const capability = process.env.TOOLPLUS_SET_CAPABILITY === 'video' ? 'video' : 'image';
  const settingsPath = process.env.TOOLPLUS_SET_SETTINGS;
  const apiKey = process.env.TOOLPLUS_SET_API_KEY || '';
  if (!settingsPath || !apiKey) throw new Error('settings path and API key are required');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('safe storage is unavailable');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  if (!settings.canvasModels?.[capability]) throw new Error(`missing ${capability} model profile`);
  settings.canvasModels[capability].encryptedAPIKey = safeStorage.encryptString(apiKey).toString('base64');
  writeSettingsAtomic(settingsPath, settings);
  process.stdout.write(JSON.stringify({ capability, saved: true }));
  app.quit();
}).catch(error => {
  process.stderr.write(String(error?.stack || error));
  app.exit(1);
});
