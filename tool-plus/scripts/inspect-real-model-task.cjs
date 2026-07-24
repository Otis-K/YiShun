const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

async function run() {
  const settingsPath = process.env.FLOWCANVAS_SETTINGS_PATH;
  const taskId = String(process.env.FLOWCANVAS_TASK_ID || '').trim();
  if (!settingsPath || !/^task_[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('inspection input is invalid');
  app.setPath('userData', path.dirname(settingsPath));
  await app.whenReady();
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const videoProfile = settings.canvasModels?.video || settings.canvasModel || {};
  const apiKey = safeStorage.decryptString(Buffer.from(videoProfile.encryptedAPIKey, 'base64'));
  const baseURL = String(videoProfile.baseURL || 'https://api.tmlab.store').replace(/\/+$/, '');
  const response = await fetch(`${baseURL}/v1/tasks/${taskId}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body = await response.json();
  const diagnostic = Object.fromEntries(Object.entries(body).filter(([key, value]) =>
    !/url|token|key|authorization/i.test(key) && (value == null || ['string', 'number', 'boolean'].includes(typeof value))
  ));
  const safe = {
    ok: response.ok,
    httpStatus: response.status,
    taskId: body.task_id || body.id || taskId,
    status: body.status,
    progress: body.progress,
    failureReason: body.failure_reason || body.error?.message || '',
    errorCode: body.error?.code || '',
    diagnostic
  };
  process.stdout.write(JSON.stringify(safe));
}

run().then(() => app.quit()).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  app.exit(1);
});
