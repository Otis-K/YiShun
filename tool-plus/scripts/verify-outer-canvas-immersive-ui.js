const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.resolve(__dirname, '..');

async function main() {
  const win = new BrowserWindow({
    width: 1500,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await win.loadFile(path.join(root, 'frontend', 'index.html'));
    await win.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 800))');
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const canvasNav = [...document.querySelectorAll('.sideItem')]
          .find(button => button.textContent.includes('智能画布'));
        if (!canvasNav) throw new Error('智能画布 side item not found');
        canvasNav.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const open = document.querySelector('#canvasOpenBtn');
        if (!open) throw new Error('canvasOpenBtn not found');
        open.click();
        await new Promise(resolve => setTimeout(resolve, 260));
        const immersive = {
          bodyClass: document.body.classList.contains('canvasImmersiveMode'),
          workspaceClass: document.querySelector('.workspace').className,
          workspaceGrid: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns,
          sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width,
          mainLeft: document.querySelector('.mainPanel').getBoundingClientRect().left,
          buttonText: document.querySelector('#canvasImmersiveBtn').textContent.trim(),
          pressed: document.querySelector('#canvasImmersiveBtn').getAttribute('aria-pressed'),
        };
        document.querySelector('#canvasImmersiveBtn').click();
        await new Promise(resolve => setTimeout(resolve, 260));
        const restored = {
          bodyClass: document.body.classList.contains('canvasImmersiveMode'),
          workspaceClass: document.querySelector('.workspace').className,
          workspaceGrid: getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns,
          sidebarWidth: document.querySelector('.sidebar').getBoundingClientRect().width,
          mainLeft: document.querySelector('.mainPanel').getBoundingClientRect().left,
          buttonText: document.querySelector('#canvasImmersiveBtn').textContent.trim(),
          pressed: document.querySelector('#canvasImmersiveBtn').getAttribute('aria-pressed'),
        };
        return { immersive, restored };
      })()
    `);

    assert.equal(result.immersive.bodyClass, true);
    assert.equal(result.immersive.pressed, 'true');
    assert.ok(result.immersive.sidebarWidth <= 1, `immersive sidebar width ${result.immersive.sidebarWidth}`);
    assert.ok(result.immersive.mainLeft <= 1, `immersive main left ${result.immersive.mainLeft}`);
    assert.equal(result.restored.bodyClass, false);
    assert.equal(result.restored.pressed, 'false');
    assert.ok(result.restored.sidebarWidth >= 180, `restored sidebar width ${result.restored.sidebarWidth}`);

    console.log([
      'PASS outer-canvas-immersive-sidebar-toggle',
      `hiddenWidth=${result.immersive.sidebarWidth}`,
      `restoredWidth=${result.restored.sidebarWidth}`,
      `button=${result.immersive.buttonText}->${result.restored.buttonText}`,
    ].join(' '));
  } finally {
    win.destroy();
  }
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch(error => {
    console.error(error);
    app.exit(1);
  });
