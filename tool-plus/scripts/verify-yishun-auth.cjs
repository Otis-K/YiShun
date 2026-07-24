const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const appPort = 43000 + (process.pid % 1000);
const dataRoot = path.join(root, 'work', `yishun-auth-test-${process.pid}`);

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function call(port, method, route, options = {}) {
  return new Promise((resolve, reject) => {
    const encoded = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
    const headers = { ...(options.headers || {}) };
    if (encoded) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': encoded.length });
    const request = http.request({ hostname: '127.0.0.1', port, method, path: route, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const type = String(response.headers['content-type'] || '');
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: type.includes('application/json') && buffer.length ? JSON.parse(buffer.toString('utf8')) : buffer.toString('utf8'),
        });
      });
    });
    request.on('error', reject);
    if (encoded) request.end(encoded); else request.end();
  });
}

async function waitForServer(port) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    try {
      const result = await call(port, 'GET', '/api/health');
      if (result.status === 200) return result.body;
    } catch (_) {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Yishun auth test server did not start');
}

function cookieValue(headers, name) {
  const values = Array.isArray(headers['set-cookie']) ? headers['set-cookie'] : [headers['set-cookie']].filter(Boolean);
  const selected = values.find(value => value.startsWith(`${name}=`));
  return selected ? selected.split(';', 1)[0] : '';
}

(async () => {
  const fakeQQ = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/oauth2.0/token') {
      assert.equal(url.searchParams.get('client_id'), 'mock-app-id');
      assert.equal(url.searchParams.get('client_secret'), 'mock-app-key');
      assert.equal(url.searchParams.get('code'), 'approved-code');
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('access_token=mock-access-token&expires_in=7776000');
      return;
    }
    if (url.pathname === '/oauth2.0/me') {
      assert.equal(url.searchParams.get('access_token'), 'mock-access-token');
      response.writeHead(200, { 'Content-Type': 'text/plain' });
      response.end('callback( {"client_id":"mock-app-id","openid":"mock-open-id","unionid":"mock-union-id"} );');
      return;
    }
    if (url.pathname === '/user/get_user_info') {
      assert.equal(url.searchParams.get('openid'), 'mock-open-id');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ret: 0, nickname: '衣瞬测试用户', figureurl_qq_2: 'https://q.qlogo.cn/mock-avatar.png' }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  const fakePort = await listen(fakeQQ);
  Object.assign(process.env, {
    YISHUN_WEB_PORT: String(appPort),
    YISHUN_WEB_DATA_ROOT: dataRoot,
    QQ_CONNECT_APP_ID: 'mock-app-id',
    QQ_CONNECT_APP_KEY: 'mock-app-key',
    QQ_CONNECT_REDIRECT_URI: `http://127.0.0.1:${appPort}/api/auth/qq/callback`,
    YISHUN_PUBLIC_ORIGIN: `http://127.0.0.1:${appPort}`,
    QQ_CONNECT_AUTHORIZE_URL: `http://127.0.0.1:${fakePort}/oauth2.0/authorize`,
    QQ_CONNECT_TOKEN_URL: `http://127.0.0.1:${fakePort}/oauth2.0/token`,
    QQ_CONNECT_OPENID_URL: `http://127.0.0.1:${fakePort}/oauth2.0/me`,
    QQ_CONNECT_USERINFO_URL: `http://127.0.0.1:${fakePort}/user/get_user_info`,
  });
  const { server } = require('../web/server');

  try {
    const health = await waitForServer(appPort);
    assert.equal(health.auth.qqConfigured, true);

    const anonymous = await call(appPort, 'GET', '/api/auth/session');
    assert.deepEqual(anonymous.body, {
      ok: true, authenticated: false, user: null, providers: { qq: { configured: true } }, agreementVersion: '2026-07-24',
    });

    const agreementRequired = await call(appPort, 'GET', '/api/auth/qq/start');
    assert.equal(agreementRequired.status, 400);
    assert.equal(agreementRequired.body.code, 'AGREEMENT_REQUIRED');

    const firstStart = await call(appPort, 'GET', '/api/auth/qq/start?agreement=2026-07-24');
    assert.equal(firstStart.status, 302);
    const firstTarget = new URL(firstStart.headers.location);
    assert.equal(firstTarget.searchParams.get('client_id'), 'mock-app-id');
    assert.equal(firstTarget.searchParams.get('scope'), 'get_user_info');
    const firstStateCookie = cookieValue(firstStart.headers, 'yishun_qq_oauth');
    assert.ok(firstStateCookie);
    const mismatched = await call(appPort, 'GET', '/api/auth/qq/callback?code=approved-code&state=wrong-state', { headers: { Cookie: firstStateCookie } });
    assert.equal(mismatched.status, 302);
    assert.equal(mismatched.headers.location, '/?auth=error&reason=state');

    const start = await call(appPort, 'GET', '/api/auth/qq/start?agreement=2026-07-24');
    const authorizeTarget = new URL(start.headers.location);
    const state = authorizeTarget.searchParams.get('state');
    const oauthCookie = cookieValue(start.headers, 'yishun_qq_oauth');
    const callback = await call(appPort, 'GET', `/api/auth/qq/callback?code=approved-code&state=${encodeURIComponent(state)}`, { headers: { Cookie: oauthCookie } });
    assert.equal(callback.status, 302);
    assert.equal(callback.headers.location, '/?auth=success');
    const sessionCookie = cookieValue(callback.headers, 'yishun_session');
    assert.ok(sessionCookie);
    assert.match(callback.headers['set-cookie'].join('\n'), /HttpOnly/);
    assert.match(callback.headers['set-cookie'].join('\n'), /SameSite=Lax/);

    const authenticated = await call(appPort, 'GET', '/api/auth/session', { headers: { Cookie: sessionCookie } });
    assert.equal(authenticated.body.authenticated, true);
    assert.equal(authenticated.body.user.nickname, '衣瞬测试用户');
    assert.equal(authenticated.body.user.provider, 'qq');
    assert.equal(Object.hasOwn(authenticated.body.user, 'openId'), false);

    const stored = fs.readFileSync(path.join(dataRoot, 'auth', 'auth.json'), 'utf8');
    assert.doesNotMatch(stored, /mock-access-token|mock-app-key/);
    assert.doesNotMatch(stored, new RegExp(sessionCookie.split('=')[1]));
    assert.match(stored, /mock-open-id/);

    const logout = await call(appPort, 'POST', '/api/auth/logout', {
      headers: { Cookie: sessionCookie, Origin: `http://127.0.0.1:${appPort}` },
    });
    assert.equal(logout.status, 200);
    assert.match(String(logout.headers['set-cookie']), /Max-Age=0/);
    const afterLogout = await call(appPort, 'GET', '/api/auth/session', { headers: { Cookie: sessionCookie } });
    assert.equal(afterLogout.body.authenticated, false);

    const page = await call(appPort, 'GET', '/');
    assert.match(page.body, /id="loginDialog"/);
    assert.match(page.body, /yishun-auth\.js/);
    assert.equal((await call(appPort, 'GET', '/terms.html')).status, 200);
    assert.equal((await call(appPort, 'GET', '/privacy.html')).status, 200);

    console.log('PASS yishun-auth agreement-gate state-validation qq-code-exchange session-cookie token-redaction logout legal-pages');
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
    if (typeof fakeQQ.closeAllConnections === 'function') fakeQQ.closeAllConnections();
    await new Promise(resolve => fakeQQ.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
