const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('G:/FlowCanvas-SDK/FlowCanvas-SDK/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');
const { friendlyModelError, normalizeAPIKey } = require('../electron/model-credentials');

const root = path.resolve(__dirname, '..');
const profile = path.join(root, 'work', `model-profile-verification-${process.pid}-${Date.now()}`);
fs.mkdirSync(profile, { recursive: true });

(async () => {
  let application;
  try {
    assert.equal(normalizeAPIKey('Bearer profile-secret'), 'profile-secret');
    assert.equal(normalizeAPIKey('  bearer   profile-secret  '), 'profile-secret');
    assert.equal(normalizeAPIKey('profile-secret'), 'profile-secret');
    const friendlyAuthenticationError = friendlyModelError(
      new Error('{"status":401,"error":{"message":"Invalid token","token":"upstream-secret"}}'),
      'image',
    );
    assert.equal(friendlyAuthenticationError.code, 'MODEL_AUTHENTICATION_FAILED');
    assert.match(friendlyAuthenticationError.message, /图片模型 API Key 无效或已失效/);
    assert.doesNotMatch(friendlyAuthenticationError.message, /Invalid token|401|upstream-secret|[{}]/i);

    application = await electron.launch({
      executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: ['.', `--user-data-dir=${profile}`],
      cwd: root,
      env: {
        ...process.env,
        FLOWCANVAS_BOOTSTRAP_IMAGE_API_KEY: 'image-profile-test-secret',
        FLOWCANVAS_BOOTSTRAP_VIDEO_API_KEY: 'video-profile-test-secret',
      },
      timeout: 30000,
    });
    const actualProfile = await application.evaluate(({ app }) => app.getPath('userData'));
    assert.equal(path.resolve(actualProfile), path.resolve(profile));
    const window = await application.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    const publicConfig = await window.evaluate(() => window.toolplus.canvasModelConfigGet());
    assert.equal(publicConfig.profiles.image.configured, true);
    assert.equal(publicConfig.profiles.video.configured, true);
    assert.equal(publicConfig.profiles.image.model, 'nano-banana-pro(特价版 1)');
    assert.equal(publicConfig.profiles.video.model, 'seedance-2.0-pro(431)');
    assert.doesNotMatch(JSON.stringify(publicConfig), /encryptedAPIKey|profile-test-secret/);
    const fileSettings = await window.evaluate(() => window.toolplus.getFileSettings());
    assert.deepEqual(Object.keys(fileSettings).sort(), ['workspaceRoot']);

    const settingsPath = path.join(profile, 'settings.json');
    const before = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(before.canvasModels.image.encryptedAPIKey);
    assert.ok(before.canvasModels.video.encryptedAPIKey);
    assert.notEqual(before.canvasModels.image.encryptedAPIKey, before.canvasModels.video.encryptedAPIKey);
    assert.doesNotMatch(JSON.stringify(before), /image-profile-test-secret|video-profile-test-secret/);

    const redirected = await window.evaluate(() => window.toolplus.canvasModelConfigSave({ profiles: {
      image: { baseURL: 'https://example.invalid', model: 'nano-banana-pro(特价版 1)', apiKey: '' },
    } }));
    assert.equal(redirected.ok, false);
    assert.match(redirected.error, /必须重新输入 API Key/);

    const bearerSaved = await window.evaluate(() => window.toolplus.canvasModelConfigSave({ profiles: {
      image: { baseURL: 'https://api.tmlab.store', model: 'nano-banana-pro(特价版 1)', apiKey: 'Bearer   prefixed-profile-secret' },
    } }));
    assert.equal(bearerSaved.profiles.image.configured, true);
    const afterBearerSave = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const decryptedBearerSave = await application.evaluate(
      ({ safeStorage }, encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')),
      afterBearerSave.canvasModels.image.encryptedAPIKey,
    );
    assert.equal(decryptedBearerSave, 'prefixed-profile-secret');
    assert.doesNotMatch(JSON.stringify(afterBearerSave), /Bearer|prefixed-profile-secret/i);

    const saved = await window.evaluate(() => window.toolplus.canvasModelConfigSave({ profiles: {
      image: { baseURL: 'https://api.tmlab.store', model: 'nano-banana-pro(特价版 1)', apiKey: '' },
      video: { baseURL: 'https://api.tmlab.store', model: 'seedance-2.0-pro(431)', apiKey: '' },
    } }));
    assert.equal(saved.profiles.image.configured, true);
    assert.equal(saved.profiles.video.configured, true);
    const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal(after.canvasModels.image.encryptedAPIKey, afterBearerSave.canvasModels.image.encryptedAPIKey);
    assert.equal(after.canvasModels.video.encryptedAPIKey, before.canvasModels.video.encryptedAPIKey);
    assert.equal(after.canvasModel, undefined);
    process.stdout.write(JSON.stringify({ ok: true, profiles: ['image', 'video'], encryptedAtRest: true, bearerPrefixNormalized: true, authenticationErrorLocalized: true, emptyKeyPreserved: true, baseUrlChangeRequiresKey: true, publicConfigRedacted: true }));
  } finally {
    if (application) await application.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  process.stderr.write(String(error?.stack || error));
  process.exitCode = 1;
});
