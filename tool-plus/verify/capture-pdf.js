const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

app.whenReady().then(async () => {
  const input = process.env.PDF_INPUT;
  const output = process.env.PDF_OUTPUT;
  if (!input || !output) throw new Error('PDF_INPUT and PDF_OUTPUT are required');
  const win = new BrowserWindow({ width: 1000, height: 1400, show: false });
  await win.loadURL(pathToFileURL(path.resolve(input)).href);
  await new Promise(resolve => setTimeout(resolve, 2500));
  if (process.env.PDF_SCROLL_END === '1') {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'END' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'END' });
    await new Promise(resolve => setTimeout(resolve, 800));
  }
  const image = await win.webContents.capturePage();
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(path.resolve(output), image.toPNG());
  app.quit();
});
