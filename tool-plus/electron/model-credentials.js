'use strict';

function normalizeAPIKey(value) {
  return String(value || '').trim().replace(/^Bearer(?:\s+|$)/i, '').trim();
}

function errorMessage(value) {
  if (value instanceof Error) return String(value.message || '');
  if (value && typeof value === 'object' && typeof value.error === 'string') return value.error;
  return String(value || '');
}

function isModelAuthenticationError(value) {
  const message = errorMessage(value);
  return /\b(?:http\s*)?401\b/i.test(message)
    || /\binvalid\s+(?:api[\s_-]*)?(?:key|token)\b/i.test(message)
    || /\bunauthori[sz]ed\b/i.test(message)
    || /\bauthentication\s+(?:failed|required)\b/i.test(message)
    || /(?:API\s*Key|密钥|令牌).*(?:无效|失效|过期)/i.test(message);
}

function modelAuthenticationMessage(capability = 'image') {
  const label = capability === 'video' ? '视频' : '图片';
  return `${label}模型 API Key 无效或已失效，请在右上角“设置”中重新填写有效 Key。`;
}

function friendlyModelError(error, capability = 'image') {
  if (error && error.name === 'AbortError') return error;
  if (!isModelAuthenticationError(error)) {
    if (error instanceof Error) return error;
    const label = capability === 'video' ? '视频' : '图片';
    return new Error(errorMessage(error) || `${label}生成失败。`);
  }
  const friendly = new Error(modelAuthenticationMessage(capability));
  friendly.name = 'ModelAuthenticationError';
  friendly.code = 'MODEL_AUTHENTICATION_FAILED';
  return friendly;
}

module.exports = {
  friendlyModelError,
  isModelAuthenticationError,
  modelAuthenticationMessage,
  normalizeAPIKey,
};
