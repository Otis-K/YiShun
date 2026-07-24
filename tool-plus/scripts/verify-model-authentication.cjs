const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  friendlyModelError,
  isModelAuthenticationError,
  normalizeAPIKey,
} = require('../electron/model-credentials');

assert.equal(normalizeAPIKey('Bearer profile-secret'), 'profile-secret');
assert.equal(normalizeAPIKey('  bearer   profile-secret  '), 'profile-secret');
assert.equal(normalizeAPIKey('profile-secret'), 'profile-secret');
assert.equal(normalizeAPIKey('Bearer'), '');

const rawUpstreamError = new Error('{"status":401,"error":{"message":"Invalid token","token":"raw-upstream-secret"}}');
assert.equal(isModelAuthenticationError(rawUpstreamError), true);
const friendly = friendlyModelError(rawUpstreamError, 'image');
assert.equal(friendly.code, 'MODEL_AUTHENTICATION_FAILED');
assert.match(friendly.message, /图片模型 API Key 无效或已失效/);
assert.doesNotMatch(friendly.message, /Invalid token|401|raw-upstream-secret|[{}]/i);

const unrelated = friendlyModelError(new Error('network unavailable'), 'image');
assert.equal(unrelated.message, 'network unavailable');

const root = path.resolve(__dirname, '..');
const electronMain = fs.readFileSync(path.join(root, 'electron', 'main.js'), 'utf8');
const webServer = fs.readFileSync(path.join(root, 'web', 'server.js'), 'utf8');
const doubleCommercial = fs.readFileSync(path.join(root, 'frontend', 'yishun-double-commercial.js'), 'utf8');
const yishunShell = fs.readFileSync(path.join(root, 'frontend', 'yishun.js'), 'utf8');

assert.match(electronMain, /const apiKey = normalizeAPIKey\(update\.apiKey\)/, 'Electron config save must normalize API keys');
assert.match(electronMain, /friendlyModelError\(error, capability\)/, 'Electron generation errors must use the friendly mapper');
assert.match(webServer, /const apiKey = normalizeAPIKey\(next\.apiKey\)/, 'Web config save must normalize API keys');
assert.match(webServer, /friendlyModelError\(error, capability\)/, 'Web generation errors must use the friendly mapper');
assert.match(yishunShell, /apiKey:normalizeAPIKey\(/, 'Web settings must normalize API keys before submitting');
assert.match(doubleCommercial, /if \(authenticationFailed\) \$\('#settingsBtn'\)\.click\(\)/, 'double-commercial authentication failures must open settings');
assert.match(doubleCommercial, /notify\(authenticationFailed \? invalidImageCredentialMessage/, 'double-commercial must replace raw authentication errors');
assert.doesNotMatch(
  doubleCommercial.match(/const invalidImageCredentialMessage = ([^;]+);/)?.[1] || '',
  /Invalid token|401|raw-upstream-secret|[{}]/i,
  'double-commercial friendly message contains raw upstream diagnostics',
);

console.log('PASS model-authentication bearer-prefix-normalization friendly-401-redaction config-save-and-double-commercial-static-contracts');
