const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');
const port = 4194;

async function waitForLoginState(win) {
  await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const hint = document.querySelector('#loginHint')?.textContent || '';
      if (hint && !hint.includes('正在检查')) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > 10000) { clearInterval(timer); reject(new Error('Login state was not rendered')); }
    }, 50);
  })`);
}

async function capture(win, name) {
  const dialogOpen = await win.webContents.executeJavaScript(`document.querySelector('#loginDialog').open`);
  assert.equal(dialogOpen, true, `${name} must capture the open login dialog`);
  await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
  win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 160));
  const image = await win.webContents.capturePage();
  const bytes = image.toPNG();
  assert.ok(bytes.length > 10000, `${name} screenshot is unexpectedly small`);
  const output = path.join(root, 'work', name);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, bytes);
  return output;
}

async function main() {
  for (const key of ['QQ_CONNECT_APP_ID', 'QQ_CONNECT_APP_KEY', 'QQ_CONNECT_REDIRECT_URI', 'YISHUN_PUBLIC_ORIGIN']) delete process.env[key];
  Object.assign(process.env, {
    YISHUN_WEB_PORT: String(port),
    YISHUN_WEB_DATA_ROOT: path.join(root, 'work', `yishun-auth-ui-${process.pid}`),
    QQ_CONNECT_APP_ID: 'ui-app-id',
    QQ_CONNECT_APP_KEY: 'ui-app-key',
    QQ_CONNECT_REDIRECT_URI: `http://127.0.0.1:${port}/api/auth/qq/callback`,
    YISHUN_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  });
  const { server } = require('../web/server');
  await new Promise(resolve => server.listening ? resolve() : server.once('listening', resolve));

  const win = new BrowserWindow({
    width: 1180, height: 760, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, partition: `yishun-auth-ui-${Date.now()}` },
  });
  try {
    await win.loadURL(`http://127.0.0.1:${port}/`);
    await waitForLoginState(win);
    win.showInactive();
    await new Promise(resolve => setTimeout(resolve, 180));
    await win.webContents.executeJavaScript(`document.querySelector('#accountButton').click()`);
    const desktop = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('#loginDialog');
      const bounds = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        qqDisabled: document.querySelector('#qqLoginButton').disabled,
        agreementChecked: document.querySelector('#agreementCheckbox').checked,
        legalLinks: document.querySelectorAll('.agreementCheck a').length,
        hint: document.querySelector('#loginHint').textContent,
        brokenAvatarVisible: !document.querySelector('#accountAvatar').hidden,
      };
    })()`);
    assert.equal(desktop.open, true);
    assert.ok(desktop.width <= 440 && desktop.width >= 400);
    assert.ok(desktop.height < desktop.viewportHeight - 24);
    assert.equal(desktop.qqDisabled, true);
    assert.equal(desktop.agreementChecked, false);
    assert.equal(desktop.legalLinks, 2);
    assert.equal(desktop.brokenAvatarVisible, false);
    assert.match(desktop.hint, /跳转至 QQ/);
    const enabledAfterAgreement = await win.webContents.executeJavaScript(`(() => {
      const checkbox = document.querySelector('#agreementCheckbox');
      checkbox.click();
      return !document.querySelector('#qqLoginButton').disabled && checkbox.checked;
    })()`);
    assert.equal(enabledAfterAgreement, true);
    const desktopScreenshot = await capture(win, 'yishun-auth-login-desktop.png');

    win.setSize(390, 844);
    await new Promise(resolve => setTimeout(resolve, 180));
    const mobile = await win.webContents.executeJavaScript(`(() => {
      const bounds = document.querySelector('#loginDialog').getBoundingClientRect();
      return {
        width: Math.round(bounds.width), height: Math.round(bounds.height),
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        pageWidth: document.documentElement.scrollWidth,
      };
    })()`);
    assert.ok(mobile.width <= mobile.viewportWidth - 24);
    assert.ok(mobile.height <= mobile.viewportHeight - 24);
    assert.ok(mobile.pageWidth <= mobile.viewportWidth);
    const mobileScreenshot = await capture(win, 'yishun-auth-login-mobile.png');

    console.log(`PASS yishun-auth-ui modal agreement-gate responsive desktop=${desktopScreenshot} mobile=${mobileScreenshot}`);
  } finally {
    win.destroy();
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

app.whenReady().then(main).then(() => app.exit(0)).catch(error => {
  console.error(error);
  app.exit(1);
});
