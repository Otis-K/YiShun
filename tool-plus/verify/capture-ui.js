const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  await win.loadFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  await new Promise(resolve => setTimeout(resolve, 1500));
  const image = await win.webContents.capturePage();
  const output = path.join(__dirname, '..', 'work', 'ui-0.4.0.png');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, image.toPNG());
  await win.webContents.executeJavaScript(`
    document.querySelector('#searchInput').value = 'pdf-page-numbers';
    document.querySelector('#searchInput').dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await new Promise(resolve => setTimeout(resolve, 300));
  await win.webContents.executeJavaScript(`document.querySelector('.cardButton').click()`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const dialogImage = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, '..', 'work', 'ui-0.4.0-pdf-page-numbers.png'), dialogImage.toPNG());
  await win.webContents.executeJavaScript(`document.querySelector('#toolDialog').close()`);
  const uiReport = await win.webContents.executeJavaScript(`(async () => {
    const keys = ${JSON.stringify([
      'classify-advanced', 'image-modern-convert', 'image-effects',
      'docx-extract-images', 'docx-remove-images', 'docx-replace-images',
      'xlsx-extract-images', 'xlsx-remove-images', 'xlsx-replace-images',
      'pptx-extract-images', 'pptx-remove-images', 'pptx-replace-images',
      'pdf-compress', 'pdf-extract-images', 'pdf-page-numbers', 'pdf-metadata',
      'video-to-aac-audio', 'video-to-ogg-audio', 'video-to-opus-audio', 'video-trim',
      'video-merge', 'video-resize', 'video-frame-rate', 'video-bitrate',
      'media-volume', 'audio-merge', 'audio-to-mp4-cover'
    ])};
    const checked = [];
    for (const key of keys) {
      const search = document.querySelector('#searchInput');
      search.value = key;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      const card = document.querySelector('.cardButton');
      if (!card) { checked.push({ key, ok: false, error: 'card missing' }); continue; }
      card.click();
      const blanks = [...document.querySelectorAll('#paramBox select')].filter(item => !item.value).length;
      checked.push({ key, ok: blanks === 0, title: document.querySelector('#dialogTitle').textContent, params: document.querySelectorAll('#paramBox .param').length, blankSelects: blanks });
      document.querySelector('#toolDialog').close();
    }
    return { totalText: document.body.innerText.match(/共\s+\d+\s+项功能/)?.[0] || '', checked };
  })()`);
  fs.writeFileSync(path.join(__dirname, '..', 'work', 'ui-0.4.0-report.json'), JSON.stringify(uiReport, null, 2));
  app.quit();
});
