const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const root = path.join(__dirname, '..');
const expectedKinds = {
  'ui-text': 'text',
  'ui-image': 'image',
  'ui-pdf': 'pdf',
  'ui-office': 'office',
  'ui-media': 'media',
  'ui-file': 'file'
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'acceptance-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  await win.loadFile(path.join(root, 'frontend', 'index.html'));
  await wait(300);
  const result = await win.webContents.executeJavaScript(`(() => {
    const expected = ${JSON.stringify(expectedKinds)};
    const failures = [];
    for (const tool of tools) {
      openToolView(tool);
      const actual = document.querySelector('#categoryWorkspace').dataset.category;
      const wanted = expected[tool.uiReferenceId];
      if (actual !== wanted) failures.push(tool.key + ': expected ' + wanted + ', got ' + actual);
      if (!document.querySelector('#categoryWorkspace').children.length) failures.push(tool.key + ': empty workspace');
      const run = document.querySelector('#runBtn').getBoundingClientRect();
      if (run.right > innerWidth || run.bottom > innerHeight || run.width < 80) failures.push(tool.key + ': run action unreachable');
    }
    const workspace = document.querySelector('.toolFormWorkspace');
    if (workspace.scrollWidth > workspace.clientWidth + 1) failures.push('tool workspace has horizontal overflow');
    openToolView(tools[0]);
    activeTaskId = 'ui-overlap-check';
    updateTaskUI({ id: activeTaskId, state: 'partial_failed', phase: '1 项失败，2 项成功', elapsedMs: 1000, timeoutSeconds: 300, completedItems: 3, totalItems: 3, percent: 100, progressAvailable: true, outputs: ['C:\\out\\one'], failedInputs: ['C:\\in\\bad'], itemResults: [{ input: 'C:\\in\\one', state: 'succeeded' }, { input: 'C:\\in\\bad', state: 'failed', error: 'fixture' }, { input: 'C:\\in\\three', state: 'succeeded' }] });
    const notice = document.querySelector('#noticeBar').getBoundingClientRect();
    const action = document.querySelector('#runBtn').getBoundingClientRect();
    const overlaps = notice.left < action.right && notice.right > action.left && notice.top < action.bottom && notice.bottom > action.top;
    if (overlaps) failures.push('error notice overlaps retry action');
    return { count: tools.length, failures };
  })()`);
  if (result.count !== 114 || result.failures.length) {
    throw new Error(`category workspace gate failed: ${JSON.stringify(result)}`);
  }
  console.log(`PASS category-workspace-ui ${result.count}/114 tools mapped and reachable at 1200x760`);
  app.quit();
}).catch(error => {
  console.error(error && error.stack || error);
  app.exit(1);
});

function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
