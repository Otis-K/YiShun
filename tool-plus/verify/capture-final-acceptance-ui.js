const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { TaskManager, TERMINAL_STATES } = require('../electron/task-manager');

const root = path.join(__dirname, '..');
const acceptanceRoot = path.join(root, 'work', 'acceptance-0.5.0');
const outputRoot = path.join(acceptanceRoot, 'ui-prototype', 'final-matrix');
const taskOutputRoot = path.join(acceptanceRoot, 'ui-real-tasks');
const batchRoot = path.join(acceptanceRoot, 'ui-batch-1000');
const samples = path.join(root, 'work', 'verify', 'samples');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tool_catalog.json'), 'utf8'));
const representatives = [
  { category: 'text', key: 'markdown-to-txt', good: path.join(samples, 'note.md'), missing: path.join(samples, 'missing-ui-state.md'), options: {} },
  { category: 'image', key: 'image-effects', good: path.join(samples, 'image.png'), missing: path.join(samples, 'missing-ui-state.png'), options: { effect: '灰度', amount: '25' } },
  { category: 'pdf', key: 'pdf-page-numbers', good: path.join(samples, 'sample.pdf'), missing: path.join(samples, 'missing-ui-state.pdf'), options: { position: '底部居中', format: '%p / %P' } },
  { category: 'office', key: 'docx-to-txt', good: path.join(samples, 'doc.docx'), missing: path.join(samples, 'missing-ui-state.docx'), options: {} },
  { category: 'media', key: 'video-trim', good: path.join(samples, 'real-video.mp4'), missing: path.join(samples, 'missing-ui-state.mp4'), options: { start: '0', duration: '1' } },
  { category: 'file', key: 'rename-prefix-suffix', good: path.join(samples, 'rename.txt'), missing: path.join(samples, 'missing-ui-state.txt'), options: { prefix: 'accepted_', suffix: '_result' } }
];
const viewports = [[1200, 760], [1366, 768], [1920, 1080]];
const scales = [100, 125];
const states = ['empty', 'configured', 'running', 'success', 'partial-failure', 'failure', 'cancelled', 'batch-1000'];

app.disableHardwareAcceleration();
app.setPath('userData', path.join(root, 'work', '.electron-final-ui'));

app.whenReady().then(async () => {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.rmSync(path.join(acceptanceRoot, 'ui-prototype', 'FINAL_CAPTURE_MANIFEST.json'), { force: true });
  fs.rmSync(path.join(acceptanceRoot, 'ui-prototype', 'REAL_TASK_EVIDENCE.json'), { force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.mkdirSync(taskOutputRoot, { recursive: true });
  const manager = new TaskManager({ command: path.join(root, 'bin', 'toolplus-backend.exe'), cwd: root, maxConcurrent: 1 });
  const evidence = {};
  for (const representative of representatives) evidence[representative.category] = await runRealScenarios(manager, representative);
  await manager.shutdown();
  const batchItems = makeBatchFiles();

  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    backgroundColor: '#f4f6fb',
    webPreferences: { preload: path.join(__dirname, 'acceptance-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  await win.loadFile(path.join(root, 'frontend', 'index.html'));
  await wait(500);
  const layoutFailures = [];
  const screenshots = [];
  for (const representative of representatives) {
    const actual = evidence[representative.category];
    for (const state of states) {
      await renderState(win, representative, state, actual, batchItems);
      for (const scale of scales) {
        await win.webContents.setZoomFactor(scale / 100);
        for (const [width, height] of viewports) {
          win.setContentSize(width, height);
          await wait(60);
          const layout = await inspectLayout(win);
          if (layout.failures.length) layoutFailures.push({ category: representative.category, state, scale, viewport: `${width}x${height}`, failures: layout.failures });
          const directory = path.join(outputRoot, representative.category, state);
          fs.mkdirSync(directory, { recursive: true });
          const file = path.join(directory, `${representative.category}-${state}-${width}x${height}-${scale}pct.png`);
          win.webContents.invalidate();
          await wait(100);
          const image = await win.webContents.capturePage({ x: 0, y: 0, width, height });
          fs.writeFileSync(file, image.toPNG());
          screenshots.push({ path: path.relative(acceptanceRoot, file).split(path.sep).join('/'), category: representative.category, state, viewport: `${width}x${height}`, scalePercent: scale, sha256: sha256(file), layout });
        }
      }
    }
  }
  const taskEvidenceFile = path.join(acceptanceRoot, 'ui-prototype', 'REAL_TASK_EVIDENCE.json');
  fs.writeFileSync(taskEvidenceFile, `${JSON.stringify({ generatedAt: new Date().toISOString(), backendSha256: sha256(path.join(root, 'bin', 'toolplus-backend.exe')), evidence }, null, 2)}\n`);
  const manifest = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    realBackendEvidence: true,
    taskEvidence: path.relative(acceptanceRoot, taskEvidenceFile).split(path.sep).join('/'),
    backendSha256: sha256(path.join(root, 'bin', 'toolplus-backend.exe')),
    screenshotCount: screenshots.length,
    representatives: representatives.map(({ category, key, good }) => ({ category, key, good, goodSha256: sha256(good) })),
    states,
    viewports: viewports.map(([width, height]) => `${width}x${height}`),
    windowsScalePercent: scales,
    scaleValidationMethod: 'Electron Chromium zoom factor 1.00/1.25 on Windows; layout is checked in CSS logical pixels and captured at both factors',
    scaleIsOsSetting: false,
    batchInputCount: batchItems.length,
    layoutFailures,
    screenshots
  };
  fs.writeFileSync(path.join(acceptanceRoot, 'ui-prototype', 'FINAL_CAPTURE_MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (screenshots.length !== 288 || layoutFailures.length) throw new Error(`final UI matrix failed screenshots=${screenshots.length} layoutFailures=${JSON.stringify(layoutFailures.slice(0, 10))}`);
  console.log(`PASS final-ui-matrix ${screenshots.length} real-state screenshots; layout failures=0`);
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  app.exit(1);
});

async function runRealScenarios(manager, representative) {
  const tool = catalog.find(item => item.key === representative.key);
  if (!tool) throw new Error(`catalog tool missing: ${representative.key}`);
  const result = {};
  result.success = await runTask(manager, representative, [representative.good], 'success');
  result.partial = await runTask(manager, representative, [representative.good, representative.missing], 'partial');
  result.failure = await runTask(manager, representative, [representative.missing], 'failure');
  result.cancelled = await runCancelledTask(manager, representative);
  if (result.success.terminal.state !== 'succeeded') throw new Error(`${representative.key} real success did not succeed: ${JSON.stringify(result.success.terminal)}`);
  if (result.partial.terminal.state !== 'partial_failed') throw new Error(`${representative.key} real partial did not partially fail: ${JSON.stringify(result.partial.terminal)}`);
  if (result.failure.terminal.state !== 'failed') throw new Error(`${representative.key} real failure did not fail: ${JSON.stringify(result.failure.terminal)}`);
  if (result.cancelled.terminal.state !== 'cancelled') throw new Error(`${representative.key} real cancellation did not cancel: ${JSON.stringify(result.cancelled.terminal)}`);
  return result;
}

function taskPayload(representative, inputs, suffix) {
  const outputDir = path.join(taskOutputRoot, representative.category, suffix);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  return { tool: representative.key, inputs, outputDir, options: representative.options };
}

function runTask(manager, representative, inputs, suffix) {
  return new Promise((resolve, reject) => {
    const updates = [];
    const task = manager.submit(taskPayload(representative, inputs, suffix), 300, 'per-input');
    const timer = setTimeout(() => { manager.off('update', listener); reject(new Error(`${representative.key} ${suffix} timeout`)); }, 320000);
    function listener(update) {
      if (update.id !== task.id) return;
      updates.push(update);
      if (TERMINAL_STATES.has(update.state)) {
        clearTimeout(timer);
        manager.off('update', listener);
        resolve({ id: task.id, running: updates.find(item => item.state === 'running'), terminal: update, updates });
      }
    }
    manager.on('update', listener);
  });
}

function runCancelledTask(manager, representative) {
  return new Promise((resolve, reject) => {
    const updates = [];
    const task = manager.submit(taskPayload(representative, [representative.good], 'cancelled'), 300, 'per-input');
    const timer = setTimeout(() => { manager.off('update', listener); reject(new Error(`${representative.key} cancellation timeout`)); }, 30000);
    function listener(update) {
      if (update.id !== task.id) return;
      updates.push(update);
      if (TERMINAL_STATES.has(update.state)) {
        clearTimeout(timer);
        manager.off('update', listener);
        resolve({ id: task.id, running: updates.find(item => item.state === 'running'), terminal: update, updates });
      }
    }
    manager.on('update', listener);
    setTimeout(() => manager.cancel(task.id), 1);
  });
}

function makeBatchFiles() {
  fs.rmSync(batchRoot, { recursive: true, force: true });
  fs.mkdirSync(batchRoot, { recursive: true });
  const source = path.join(samples, 'note.md');
  const items = [];
  for (let index = 0; index < 1000; index += 1) {
    const target = path.join(batchRoot, `batch-${String(index).padStart(4, '0')}.md`);
    try { fs.linkSync(source, target); } catch (_) { fs.copyFileSync(source, target); }
    const stat = fs.statSync(target);
    items.push({ path: target, name: path.basename(target), extension: '.md', size: stat.size, modifiedAt: stat.mtime.toISOString() });
  }
  return items;
}

async function renderState(win, representative, state, actual, batchItems) {
  await openTool(win, representative.key);
  if (state === 'empty') return;
  const goodStat = fs.statSync(representative.good);
  const goodItem = { path: representative.good, name: path.basename(representative.good), extension: path.extname(representative.good).toLowerCase(), size: goodStat.size, modifiedAt: goodStat.mtime.toISOString() };
  if (state === 'configured') return setInputs(win, [goodItem]);
  if (state === 'batch-1000') return setInputs(win, batchItems);
  const task = state === 'running' ? actual.success.running
    : state === 'success' ? actual.success.terminal
      : state === 'partial-failure' ? actual.partial.terminal
        : state === 'failure' ? actual.failure.terminal : actual.cancelled.terminal;
  if (!task) throw new Error(`${representative.key} missing actual ${state} task event`);
  await setInputs(win, [goodItem]);
  await win.webContents.executeJavaScript(`activeTaskId=${JSON.stringify(task.id)}; updateTaskUI(${JSON.stringify(task)});`);
  await wait(30);
}

async function setInputs(win, items) {
  const paths = items.map(item => item.path);
  await win.webContents.executeJavaScript(`selectedFiles=${JSON.stringify(paths)}; inspectedInputs=${JSON.stringify(items)}; document.querySelector('#pickedFiles').textContent=${JSON.stringify(`已选择 ${items.length} 个真实输入`)}; renderInputPreview();`);
  await wait(30);
}

async function openTool(win, key) {
  const result = await win.webContents.executeJavaScript(`(() => {
    showCatalogView();
    const search=document.querySelector('#searchInput'); search.value=${JSON.stringify(key)}; search.dispatchEvent(new Event('input',{bubbles:true}));
    const card=document.querySelector('.cardButton'); if(!card)return {ok:false}; card.click(); return {ok:true};
  })()`);
  if (!result.ok) throw new Error(`cannot open ${key}`);
  await wait(40);
}

async function inspectLayout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const failures=[];
    const workspace=document.querySelector('.toolFormWorkspace');
    if(workspace && workspace.scrollWidth>workspace.clientWidth+1)failures.push('horizontal overflow');
    for(const selector of ['#runBtn','#cancelBtn','#toolBackBtn']){
      const element=document.querySelector(selector); if(!element||element.hidden)continue;
      const box=element.getBoundingClientRect();
      if(box.right>innerWidth+1||box.bottom>innerHeight+1||box.left<0||box.top<0)failures.push(selector+' unreachable');
    }
    return {failures,innerWidth,innerHeight,devicePixelRatio,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight};
  })()`);
}

function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
