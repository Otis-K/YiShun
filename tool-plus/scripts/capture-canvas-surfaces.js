const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setPath('userData', path.join(__dirname, '..', 'work', 'capture-profile'));
app.commandLine.appendSwitch('disable-gpu');

async function save(win, name) {
  await win.webContents.executeJavaScript('new Promise(requestAnimationFrame)');
  await new Promise(resolve => setTimeout(resolve, 180));
  const image = await win.webContents.capturePage();
  const outputDir = path.join(__dirname, '..', 'work', 'canvas-screens');
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, name);
  fs.writeFileSync(output, image.toPNG());
  return output;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    backgroundColor: '#f4f6fb',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  await win.webContents.executeJavaScript('activeCategory = canvasCategory; renderCanvasModule()');
  win.showInactive();
  const entry = await save(win, '00-canvas-entry.png');
  await win.webContents.executeJavaScript('activeCategory = canvasConfigCategory; renderSidebar(); renderCanvasConfigModule()');
  const config = await save(win, '00-canvas-config.png');
  await win.webContents.executeJavaScript('activeCategory = fileSettingsCategory; renderSidebar(); openFileSettingsView()');
  const settings = await save(win, '00-file-settings.png');
  await win.webContents.executeJavaScript(`
    paramDefs['pdf-metadata'] = [
      { name: 'action', label: '处理方式', type: 'select', choices: ['设置元数据', '清除元数据'] },
      { name: 'title', label: '标题' },
      { name: 'author', label: '作者' },
      { name: 'subject', label: '主题' }
    ];
    openToolView({ key: 'pdf-metadata', title: 'PDF 元数据修改', description: '设置或清除 PDF 标题、作者、主题和关键词。' });
  `);
  const tool = await save(win, '00-tool-immersive.png');
  const state = await win.webContents.executeJavaScript(`({
    dialogs: document.querySelectorAll('dialog').length,
    toolVisible: !document.querySelector('#toolView').hidden,
    settingsVisible: !document.querySelector('#fileSettingsView').hidden
  })`);
  if (state.dialogs !== 0 || !state.toolVisible || state.settingsVisible) throw new Error(`immersive state invalid: ${JSON.stringify(state)}`);
  console.log(`PASS immersive surfaces ${entry} ${config} ${settings} ${tool}`);
  win.destroy();
  app.quit();
}).catch(error => {
  console.error(error);
  app.quit();
  process.exit(1);
});
