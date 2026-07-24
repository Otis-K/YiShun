(function bootstrapYishunAuth() {
  'use strict';

  const AGREEMENT_VERSION = '2026-07-24';
  let user = null;
  let qqConfigured = false;

  const $ = selector => document.querySelector(selector);
  const notify = (message, tone = 'info') => {
    if (typeof window.yishunToast === 'function') window.yishunToast(message, tone);
  };

  function setHint(message, tone = '') {
    const hint = $('#loginHint');
    hint.textContent = message;
    hint.dataset.tone = tone;
  }

  function updateLoginButton() {
    const checkbox = $('#agreementCheckbox');
    $('#qqLoginButton').disabled = !qqConfigured || !checkbox.checked;
  }

  function renderAccount() {
    const avatar = $('#accountAvatar');
    const initial = $('#accountInitial');
    const button = $('#accountButton');
    if (user) {
      button.setAttribute('aria-label', `${user.nickname || 'QQ 用户'}，查看账户`);
      button.setAttribute('aria-haspopup', 'menu');
      initial.textContent = String(user.nickname || 'Q').slice(0, 1);
      if (user.avatarUrl) {
        avatar.src = user.avatarUrl;
        avatar.hidden = false;
        initial.hidden = true;
        $('#accountMenuAvatar').src = user.avatarUrl;
      } else {
        avatar.hidden = true;
        initial.hidden = false;
        $('#accountMenuAvatar').removeAttribute('src');
      }
      $('#accountNickname').textContent = user.nickname || 'QQ 用户';
    } else {
      button.setAttribute('aria-label', '登录衣瞬账户');
      button.setAttribute('aria-haspopup', 'dialog');
      avatar.hidden = true;
      avatar.removeAttribute('src');
      initial.hidden = false;
      initial.textContent = '衣';
      $('#accountMenu').hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
  }

  function openLogin() {
    const dialog = $('#loginDialog');
    $('#accountMenu').hidden = true;
    $('#accountButton').setAttribute('aria-expanded', 'false');
    if (!dialog.open) dialog.showModal();
  }

  function toggleAccountMenu() {
    if (!user) { openLogin(); return; }
    const menu = $('#accountMenu');
    menu.hidden = !menu.hidden;
    $('#accountButton').setAttribute('aria-expanded', String(!menu.hidden));
  }

  async function loadSession() {
    const api = window.yishunWebApi;
    if (!api || typeof api.authSession !== 'function') {
      qqConfigured = false;
      setHint('QQ 登录仅支持已启动的衣瞬 Web 服务。', 'error');
      updateLoginButton();
      return;
    }
    try {
      const result = await api.authSession();
      user = result.authenticated ? result.user : null;
      qqConfigured = Boolean(result.providers && result.providers.qq && result.providers.qq.configured);
      setHint(qqConfigured ? '将跳转至 QQ 完成安全授权。' : 'QQ 登录尚未配置，请联系管理员。', qqConfigured ? '' : 'error');
      renderAccount();
      updateLoginButton();
    } catch (error) {
      qqConfigured = false;
      setHint(error.message || '无法读取登录状态。', 'error');
      updateLoginButton();
    }
  }

  async function logout() {
    const api = window.yishunWebApi;
    if (!api || typeof api.authLogout !== 'function') return;
    $('#logoutButton').disabled = true;
    try {
      await api.authLogout();
      user = null;
      renderAccount();
      notify('已退出登录。', 'success');
    } catch (error) {
      notify(error.message || '退出登录失败。', 'error');
    } finally {
      $('#logoutButton').disabled = false;
    }
  }

  function handleAuthResult() {
    const url = new URL(location.href);
    const status = url.searchParams.get('auth');
    if (!status) return;
    const reason = url.searchParams.get('reason');
    if (status === 'success') notify('QQ 登录成功。', 'success');
    if (status === 'error') {
      const messages = { denied: '您已取消 QQ 授权。', state: '登录请求已失效，请重新尝试。', profile: 'QQ 用户资料读取失败，请稍后重试。' };
      notify(messages[reason] || 'QQ 登录失败，请稍后重试。', 'error');
    }
    url.searchParams.delete('auth');
    url.searchParams.delete('reason');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function init() {
    const dialog = $('#loginDialog');
    $('#accountButton').addEventListener('click', event => { event.stopPropagation(); toggleAccountMenu(); });
    $('#loginCloseButton').addEventListener('click', () => dialog.close());
    $('#agreementCheckbox').addEventListener('change', updateLoginButton);
    $('#qqLoginButton').addEventListener('click', () => {
      if (!qqConfigured || !$('#agreementCheckbox').checked) return;
      location.assign(`/api/auth/qq/start?agreement=${encodeURIComponent(AGREEMENT_VERSION)}`);
    });
    $('#logoutButton').addEventListener('click', logout);
    $('#accountAvatar').addEventListener('error', () => { $('#accountAvatar').hidden = true; $('#accountInitial').hidden = false; });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    document.addEventListener('click', event => {
      const menu = $('#accountMenu');
      if (!menu.hidden && !event.target.closest('.accountArea')) {
        menu.hidden = true;
        $('#accountButton').setAttribute('aria-expanded', 'false');
      }
    });
    handleAuthResult();
    loadSession();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
