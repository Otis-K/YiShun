'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const STORE_VERSION = 1;

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function safeString(value, maximumLength = 200) {
  return String(value || '').trim().normalize('NFC').slice(0, maximumLength);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    provider: 'qq',
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

class AuthStore {
  constructor(root, options = {}) {
    if (!root || !path.isAbsolute(root)) throw new TypeError('Auth store root must be an absolute path.');
    this.root = path.resolve(root);
    this.storePath = path.join(this.root, 'auth.json');
    this.sessionLifetimeMs = Number(options.sessionLifetimeMs || 30 * 24 * 60 * 60 * 1000);
    fs.mkdirSync(this.root, { recursive: true });
  }

  _load() {
    if (!fs.existsSync(this.storePath)) return { version: STORE_VERSION, users: [], sessions: [] };
    let stored;
    try { stored = JSON.parse(fs.readFileSync(this.storePath, 'utf8')); }
    catch (_) { throw Object.assign(new Error('登录数据文件已损坏。'), { statusCode: 500 }); }
    if (!stored || stored.version !== STORE_VERSION || !Array.isArray(stored.users) || !Array.isArray(stored.sessions)) {
      throw Object.assign(new Error('登录数据文件格式无效。'), { statusCode: 500 });
    }
    const now = Date.now();
    return {
      version: STORE_VERSION,
      users: stored.users.filter(user => user && typeof user === 'object'),
      sessions: stored.sessions.filter(session => session && typeof session === 'object' && Date.parse(session.expiresAt) > now),
    };
  }

  _save(data) {
    fs.mkdirSync(this.root, { recursive: true });
    const temporaryPath = path.join(this.root, `.auth-${process.pid}-${crypto.randomUUID()}.tmp`);
    const contents = `${JSON.stringify(data, null, 2)}\n`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporaryPath, 'wx');
      fs.writeFileSync(descriptor, contents, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      try { fs.renameSync(temporaryPath, this.storePath); }
      catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
        fs.rmSync(this.storePath, { force: true });
        fs.renameSync(temporaryPath, this.storePath);
      }
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch (_) {}
      }
      try { fs.rmSync(temporaryPath, { force: true }); } catch (_) {}
      throw error;
    }
  }

  upsertQQUser(profile, agreementVersion) {
    const openId = safeString(profile && profile.openId, 160);
    if (!openId) throw Object.assign(new Error('QQ 用户标识无效。'), { statusCode: 502 });
    const data = this._load();
    const now = new Date().toISOString();
    let user = data.users.find(candidate => candidate.provider === 'qq' && candidate.openId === openId);
    if (!user) {
      user = {
        id: crypto.randomUUID(), provider: 'qq', openId, unionId: '', nickname: '', avatarUrl: '',
        agreementVersion: '', agreementAcceptedAt: '', createdAt: now, lastLoginAt: now,
      };
      data.users.push(user);
    }
    user.unionId = safeString(profile.unionId, 160) || user.unionId;
    user.nickname = safeString(profile.nickname, 80) || 'QQ 用户';
    user.avatarUrl = safeString(profile.avatarUrl, 1000);
    user.agreementVersion = safeString(agreementVersion, 40);
    user.agreementAcceptedAt = now;
    user.lastLoginAt = now;
    this._save(data);
    return publicUser(user);
  }

  createSession(userId) {
    const data = this._load();
    const user = data.users.find(candidate => candidate.id === userId);
    if (!user) throw Object.assign(new Error('登录用户不存在。'), { statusCode: 500 });
    const token = crypto.randomBytes(32).toString('base64url');
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + this.sessionLifetimeMs).toISOString();
    data.sessions.push({ tokenHash: hashToken(token), userId, createdAt, expiresAt });
    this._save(data);
    return { token, expiresAt, user: publicUser(user) };
  }

  getUserBySession(token) {
    if (!token) return null;
    const data = this._load();
    const tokenHash = hashToken(token);
    const session = data.sessions.find(candidate => candidate.tokenHash === tokenHash);
    if (!session) return null;
    return publicUser(data.users.find(candidate => candidate.id === session.userId));
  }

  destroySession(token) {
    if (!token) return false;
    const data = this._load();
    const tokenHash = hashToken(token);
    const before = data.sessions.length;
    data.sessions = data.sessions.filter(candidate => candidate.tokenHash !== tokenHash);
    if (data.sessions.length !== before) this._save(data);
    return data.sessions.length !== before;
  }
}

module.exports = { AuthStore };
