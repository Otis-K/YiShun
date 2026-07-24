const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outputRoot = path.join(root, 'work', 'acceptance-0.5.0', 'ui-prototype');
const samples = path.join(root, 'work', 'verify', 'samples');
const representatives = [
  ['text', 'markdown-to-txt', path.join(samples, 'note.md')],
  ['image', 'image-effects', path.join(samples, 'image.png')],
  ['pdf', 'pdf-page-numbers', path.join(samples, 'sample.pdf')],
  ['office', 'docx-to-txt', path.join(samples, 'doc.docx')],
  ['media', 'video-trim', path.join(samples, 'real-video.mp4')],
  ['file', 'rename-prefix-suffix', path.join(samples, 'rename.txt')]
];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    show: true,
    backgroundColor: '#f4f6fb',
    webPreferences: {
      preload: path.join(__dirname, 'acceptance-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.webContents.on('console-message', (_event, details) => console.error(`renderer: ${details.message || details}`));
  await win.loadFile(path.join(root, 'frontend', 'index.html'));
  await wait(700);
  for (const state of ['empty', 'configured', 'running', 'success', 'partial-failure', 'failure', 'cancelled']) {
    fs.mkdirSync(path.join(outputRoot, state), { recursive: true });
  }

  for (const [category, key, sample] of representatives) {
    await openTool(win, key);
    await capture(win, path.join(outputRoot, 'empty', `${category}-${key}-empty-1200x760.png`));
    const stat = fs.statSync(sample);
    const item = { path: sample, name: path.basename(sample), extension: path.extname(sample).toLowerCase(), size: stat.size, modifiedAt: stat.mtime.toISOString() };
    await win.webContents.executeJavaScript(`selectedFiles=${JSON.stringify([sample])}; inspectedInputs=${JSON.stringify([item])}; document.querySelector('#pickedFiles').textContent='已选择 1 个真实样本'; renderInputPreview();`);
    await wait(100);
    await capture(win, path.join(outputRoot, 'configured', `${category}-${key}-configured-1200x760.png`));

    for (const state of ['running', 'success', 'partial-failure', 'failure', 'cancelled']) {
      const task = taskForState(state, key, category);
      await win.webContents.executeJavaScript(`activeTaskId='capture-${category}'; updateTaskUI(${JSON.stringify(task)});`);
      await wait(80);
      await capture(win, path.join(outputRoot, state, `${category}-${key}-${state}-1200x760.png`));
    }
  }

  await openTool(win, 'markdown-to-txt');
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    win.setSize(width, height);
    await wait(150);
    await capture(win, path.join(outputRoot, 'empty', `text-markdown-to-txt-empty-${width}x${height}.png`));
  }
  fs.writeFileSync(path.join(outputRoot, 'CAPTURE_MANIFEST.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseline: '1200x760 at Chromium zoom 100%',
    responsiveChecks: ['1366x768 at Chromium zoom 100%', '1920x1080 at Chromium zoom 100%'],
    warning: 'running/success/partial-failure/failure/cancelled are deterministic interactive prototype states; backend execution evidence is stored under backend-devil and is not inferred from these screenshots',
    representatives
  }, null, 2)}\n`);
  console.log(`PASS acceptance-ui-capture ${representatives.length} categories ${representatives.length * 7 + 2} screenshots`);
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  app.exit(1);
});

async function openTool(win, key) {
  const result = await win.webContents.executeJavaScript(`(() => {
    showCatalogView();
    const search = document.querySelector('#searchInput');
    search.value=${JSON.stringify(key)};
    search.dispatchEvent(new Event('input',{bubbles:true}));
    const card = document.querySelector('.cardButton');
    if (!card) return { ok:false, count:document.querySelector('#countText').textContent, status:document.querySelector('#status').textContent };
    card.click();
    return { ok:true };
  })()`);
  if (!result.ok) throw new Error(`cannot open ${key}: ${JSON.stringify(result)}`);
  await wait(100);
}

async function capture(win, output) {
  win.webContents.invalidate();
  await wait(120);
  const [width, height] = win.getContentSize();
  const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(output, image.toPNG());
}

function taskForState(state, key, category) {
  const common = { id: `capture-${category}`, payload: { tool: key }, timeoutSeconds: category === 'media' ? 7200 : 300, outputs: [], error: '', cancellationLatencyMs: null, completedItems: 0, totalItems: 3, percent: null, progressAvailable: false, currentItem: null, itemResults: [], failedInputs: [] };
  if (state === 'running') return { ...common, state, phase: '正在处理第 2/3 项（交互原型）', elapsedMs: 4200, completedItems: 1, percent: 33.3, progressAvailable: true, currentItem: `G:\\samples\\${category}-02.dat`, speed: '0.24 项/秒', etaMs: 8400 };
  if (state === 'success') return { ...common, state: 'succeeded', phase: '执行完成（交互原型）', elapsedMs: 6830, completedItems: 3, percent: 100, progressAvailable: true, outputs: [`G:\\tool-user-file\\${key}\\output\\真实样本_结果`] };
  if (state === 'partial-failure') return { ...common, state: 'partial_failed', phase: '1 项失败，2 项成功（交互原型）', elapsedMs: 5730, completedItems: 3, percent: 100, progressAvailable: true, outputs: [`G:\\tool-user-file\\${key}\\output\\成功结果-01`, `G:\\tool-user-file\\${key}\\output\\成功结果-03`], failedInputs: [`G:\\samples\\${category}-02.dat`], itemResults: [
    { input: `G:\\samples\\${category}-01.dat`, state: 'succeeded', outputs: [] },
    { input: `G:\\samples\\${category}-02.dat`, state: 'failed', error: '输入损坏，无法解码。', outputs: [] },
    { input: `G:\\samples\\${category}-03.dat`, state: 'succeeded', outputs: [] }
  ] };
  if (state === 'failure') return { ...common, state: 'failed', phase: '输入格式与工具不兼容，请选择可解码文件后重试。', error: '输入格式与工具不兼容，请选择可解码文件后重试。', elapsedMs: 630 };
  return { ...common, state: 'cancelled', phase: '任务已取消，处理进程树已终止。', elapsedMs: 1520, cancellationLatencyMs: 186 };
}

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
