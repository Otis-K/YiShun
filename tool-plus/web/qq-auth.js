'use strict';

const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const { AuthStore } = require('./auth-store');

const AGREEMENT_VERSION = '2026-07-24';
const SESSION_COOKIE = 'yishun_session';
const OAUTH_COOKIE = 'yishun_qq_oauth';

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    try { cookies[name] = decodeURIComponent(part.slice(separator + 1).trim()); }
    catch (_) { cookies[name] = ''; }
  }
  return cookies;
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || '/'}`, 'HttpOnly', 'SameSite=Lax'];
  if (options.secure) parts.push('Secure');
  if (Number.isFinite(options.maxAge)) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  return parts.join('; ');
}

function sendJSON(response, status, value, headers = {}) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length,
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers,
  });
  response.end(body);
}

function redirect(response, location, cookies = []) {
  response.writeHead(302, {
    Location: location, 'Cache-Control': 'no-store',
    ...(cookies.length ? { 'Set-Cookie': cookies } : {}),
  });
  response.end();
}

function parseQQPayload(text) {
  const source = String(text || '').trim();
  if (!source) return {};
  try { return JSON.parse(source); } catch (_) {}
  const callback = /^callback\s*\(\s*([\s\S]+?)\s*\)\s*;?$/.exec(source);
  if (callback) {
    try { return JSON.parse(callback[1]); } catch (_) {}
  }
  return Object.fromEntries(new URLSearchParams(source));
}

function safeAvatarURL(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch (_) { return ''; }
}

function errorCode(error) {
  if (error && error.code === 'OAUTH_DENIED') return 'denied';
  if (error && error.code === 'OAUTH_STATE') return 'state';
  if (error && error.code === 'QQ_PROFILE') return 'profile';
  return 'qq';
}

function requestText(target, redirects = 0) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(target); }
    catch (_) { reject(new Error('QQ 服务地址无效。')); return; }
    const transport = url.protocol === 'https:' ? https : url.protocol === 'http:' ? http : null;
    if (!transport) { reject(new Error('QQ 服务地址协议无效。')); return; }
    const request = transport.get(url, { headers: { Accept: 'application/json, text/plain;q=0.8' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects < 2) {
        response.resume();
        resolve(requestText(new URL(response.headers.location, url).toString(), redirects + 1));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 1024 * 1024) request.destroy(new Error('QQ 服务响应过大。'));
        else chunks.push(chunk);
      });
      response.on('end', () => resolve({
        ok: response.statusCode >= 200 && response.statusCode < 300,
        status: response.statusCode,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.setTimeout(12000, () => request.destroy(new Error('QQ 登录服务响应超时。')));
    request.on('error', reject);
  });
}

function createQQAuth(options) {
  const appId = String(options.appId || '').trim();
  const appKey = String(options.appKey || '').trim();
  const publicOrigin = String(options.publicOrigin || '').trim().replace(/\/+$/, '');
  const redirectURI = String(options.redirectURI || (publicOrigin ? `${publicOrigin}/api/auth/qq/callback` : '')).trim();
  const authorizeURL = String(options.authorizeURL || 'https://graph.qq.com/oauth2.0/authorize');
  const tokenURL = String(options.tokenURL || 'https://graph.qq.com/oauth2.0/token');
  const openIdURL = String(options.openIdURL || 'https://graph.qq.com/oauth2.0/me');
  const userInfoURL = String(options.userInfoURL || 'https://graph.qq.com/user/get_user_info');
  let redirectURL;
  try { redirectURL = new URL(redirectURI); } catch (_) { redirectURL = null; }
  const loopbackRedirect = redirectURL && redirectURL.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(redirectURL.hostname);
  const configured = Boolean(appId && appKey && redirectURL && (redirectURL.protocol === 'https:' || loopbackRedirect));
  const secureCookie = options.secureCookie === true || /^https:\/\//i.test(publicOrigin) || redirectURL?.protocol === 'https:';
  const sessionLifetimeSeconds = Number(options.sessionLifetimeSeconds || 30 * 24 * 60 * 60);
  const store = new AuthStore(options.dataRoot, { sessionLifetimeMs: sessionLifetimeSeconds * 1000 });
  const pendingStates = new Map();

  function pruneStates() {
    const now = Date.now();
    for (const [state, pending] of pendingStates) if (pending.expiresAt <= now) pendingStates.delete(state);
  }

  async function qqRequest(endpoint, parameters) {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, String(value));
    url.searchParams.set('fmt', 'json');
    const response = await requestText(url.toString());
    const payload = parseQQPayload(response.text);
    if (!response.ok || payload.error || Number(payload.ret || 0) !== 0) {
      const error = new Error('QQ 登录服务返回错误。');
      error.code = 'QQ_PROFILE';
      throw error;
    }
    return payload;
  }

  async function exchangeCode(code) {
    const token = await qqRequest(tokenURL, {
      grant_type: 'authorization_code', client_id: appId, client_secret: appKey, code, redirect_uri: redirectURI,
    });
    const accessToken = String(token.access_token || '').trim();
    if (!accessToken) throw Object.assign(new Error('QQ 未返回访问令牌。'), { code: 'QQ_PROFILE' });
    const identity = await qqRequest(openIdURL, { access_token: accessToken, unionid: 1 });
    const openId = String(identity.openid || '').trim();
    if (!openId) throw Object.assign(new Error('QQ 未返回用户标识。'), { code: 'QQ_PROFILE' });
    const info = await qqRequest(userInfoURL, { oauth_consumer_key: appId, access_token: accessToken, openid: openId });
    return {
      openId,
      unionId: String(identity.unionid || '').trim(),
      nickname: String(info.nickname || '').trim() || 'QQ 用户',
      avatarUrl: safeAvatarURL(info.figureurl_qq_2 || info.figureurl_qq_1 || info.figureurl_2 || info.figureurl_1),
    };
  }

  async function handle(request, response, url) {
    if (request.method === 'GET' && url.pathname === '/api/auth/session') {
      const user = store.getUserBySession(parseCookies(request)[SESSION_COOKIE]);
      sendJSON(response, 200, { ok: true, authenticated: Boolean(user), user, providers: { qq: { configured } }, agreementVersion: AGREEMENT_VERSION });
      return true;
    }

    if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
      store.destroySession(parseCookies(request)[SESSION_COOKIE]);
      sendJSON(response, 200, { ok: true, authenticated: false }, {
        'Set-Cookie': cookie(SESSION_COOKIE, '', { secure: secureCookie, maxAge: 0 }),
      });
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/qq/start') {
      if (!configured) {
        sendJSON(response, 503, { ok: false, error: 'QQ 登录尚未配置，请联系管理员。', code: 'QQ_NOT_CONFIGURED' });
        return true;
      }
      if (url.searchParams.get('agreement') !== AGREEMENT_VERSION) {
        sendJSON(response, 400, { ok: false, error: '请先阅读并同意用户协议和隐私政策。', code: 'AGREEMENT_REQUIRED' });
        return true;
      }
      pruneStates();
      const state = crypto.randomBytes(24).toString('base64url');
      pendingStates.set(state, { agreementVersion: AGREEMENT_VERSION, expiresAt: Date.now() + 10 * 60 * 1000 });
      const target = new URL(authorizeURL);
      target.searchParams.set('response_type', 'code');
      target.searchParams.set('client_id', appId);
      target.searchParams.set('redirect_uri', redirectURI);
      target.searchParams.set('state', state);
      target.searchParams.set('scope', 'get_user_info');
      redirect(response, target.toString(), [cookie(OAUTH_COOKIE, state, { path: '/api/auth/qq/callback', secure: secureCookie, maxAge: 600 })]);
      return true;
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/qq/callback') {
      const clearOAuthCookie = cookie(OAUTH_COOKIE, '', { path: '/api/auth/qq/callback', secure: secureCookie, maxAge: 0 });
      try {
        if (url.searchParams.get('error')) throw Object.assign(new Error('用户取消 QQ 授权。'), { code: 'OAUTH_DENIED' });
        const code = String(url.searchParams.get('code') || '').trim();
        const state = String(url.searchParams.get('state') || '').trim();
        const cookieState = parseCookies(request)[OAUTH_COOKIE];
        const pending = pendingStates.get(state);
        pendingStates.delete(state);
        if (!code || !state || !cookieState || cookieState !== state || !pending || pending.expiresAt <= Date.now()) {
          throw Object.assign(new Error('QQ 登录状态校验失败。'), { code: 'OAUTH_STATE' });
        }
        const profile = await exchangeCode(code);
        const user = store.upsertQQUser(profile, pending.agreementVersion);
        const session = store.createSession(user.id);
        redirect(response, '/?auth=success', [
          clearOAuthCookie,
          cookie(SESSION_COOKIE, session.token, { secure: secureCookie, maxAge: sessionLifetimeSeconds }),
        ]);
      } catch (error) {
        redirect(response, `/?auth=error&reason=${encodeURIComponent(errorCode(error))}`, [clearOAuthCookie]);
      }
      return true;
    }

    return false;
  }

  return { handle, configured, agreementVersion: AGREEMENT_VERSION };
}

module.exports = { createQQAuth, AGREEMENT_VERSION };
