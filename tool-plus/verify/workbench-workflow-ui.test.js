const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const outputDir = path.join(root, 'work', 'ui-acceptance');

async function waitFor(win, script, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(script);
    if (ok) return;
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error(`wait timed out: ${script}`);
}

async function capture(win, name) {
  fs.mkdirSync(outputDir, { recursive: true });
  win.webContents.invalidate();
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 600));
  win.webContents.invalidate();
  await new Promise(resolve => setTimeout(resolve, 120));
  const image = await win.webContents.capturePage();
  const target = path.join(outputDir, `${name}.png`);
  fs.writeFileSync(target, image.toPNG());
  return target;
}

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: 1320,
      height: 820,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        preload: path.join(__dirname, 'acceptance-preload.js')
      }
    });
    await win.webContents.session.clearCache();
    await win.loadFile(path.join(root, 'frontend', 'index.html'));
    await waitFor(win, 'document.querySelectorAll(".cardButton").length > 0');
    const navigationText = await win.webContents.executeJavaScript(
      '[...document.querySelectorAll(".sideItem")].map(item => item.textContent.trim()).join("|")'
    );
    assert.doesNotMatch(navigationText, /画布配置|服务地址|登录\s*Token/);
    await capture(win, '01-catalog');

    const windowCountBeforeCanvas = BrowserWindow.getAllWindows().length;
    const canvasEntry = await win.webContents.executeJavaScript(`
      (async () => {
        const canvasNav = [...document.querySelectorAll('.sideItem')]
          .find(item => item.textContent.includes('智能画布'));
        canvasNav.click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        document.querySelector('#canvasOpenBtn').click();
        return {
          canvasVisible: !document.querySelector('#canvasView').hidden,
          catalogHidden: document.querySelector('#catalogView').hidden,
          backText: document.querySelector('#canvasBackBtn').textContent.trim(),
          frameSource: document.querySelector('#canvasFrame').getAttribute('src'),
          frameLoadedFlag: document.querySelector('#canvasFrame').dataset.loaded
        };
      })()
    `);
    assert.equal(canvasEntry.canvasVisible, true);
    assert.equal(canvasEntry.catalogHidden, true);
    assert.match(canvasEntry.backText, /返回进入前页面/);
    assert.match(canvasEntry.frameSource, /canvas\.html$/);
    assert.equal(canvasEntry.frameLoadedFlag, 'true');
    await waitFor(win, 'document.querySelector("#canvasFrame")?.contentWindow?.__toolPlusCanvasReady === true', 20000);
    const embeddedCanvas = await win.webContents.executeJavaScript(`
      (() => {
        const frame = document.querySelector('#canvasFrame');
        const api = frame.contentWindow.__toolPlusCanvasSDK;
        const before = api.getGraph().nodes.length;
        api.addText('同窗口画布导航验收');
        return {
          ready: frame.contentWindow.__toolPlusCanvasReady,
          mounted: Boolean(frame.contentDocument.querySelector('[data-testid="flowcanvas-sdk"]')),
          before,
          after: api.getGraph().nodes.length
        };
      })()
    `);
    assert.equal(embeddedCanvas.ready, true);
    assert.equal(embeddedCanvas.mounted, true);
    assert.equal(embeddedCanvas.after, embeddedCanvas.before + 1);
    assert.equal(BrowserWindow.getAllWindows().length, windowCountBeforeCanvas, 'canvas navigation must not create another BrowserWindow');
    await capture(win, '02-canvas-same-window');

    const canvasReturn = await win.webContents.executeJavaScript(`
      (async () => {
        const frame = document.querySelector('#canvasFrame');
        document.querySelector('#canvasBackBtn').click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const returned = !document.querySelector('#catalogView').hidden && document.querySelector('#canvasView').hidden;
        document.querySelector('#canvasOpenBtn').click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const retainedNodes = frame.contentWindow.__toolPlusCanvasSDK.getGraph().nodes.length;
        document.querySelector('#canvasBackBtn').click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        const allTools = [...document.querySelectorAll('.sideItem')]
          .find(item => item.textContent.includes('全部工具'));
        allTools.click();
        await new Promise(resolve => requestAnimationFrame(resolve));
        return {
          returned,
          retainedNodes,
          catalogVisible: !document.querySelector('#catalogView').hidden,
          canvasHidden: document.querySelector('#canvasView').hidden
        };
      })()
    `);
    assert.equal(canvasReturn.returned, true, 'canvas back button must restore the entry catalog page');
    assert.equal(canvasReturn.retainedNodes, embeddedCanvas.after, 'same iframe and local graph must survive view switching');
    assert.equal(canvasReturn.catalogVisible, true);
    assert.equal(canvasReturn.canvasHidden, true);

    const workbenchState = await win.webContents.executeJavaScript(`
      (async () => {
        const search = document.querySelector('#searchInput');
        search.value = 'pdf-page-numbers';
        search.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(requestAnimationFrame);
        document.querySelector('.cardButton').click();
        await new Promise(requestAnimationFrame);
        const firstStep = document.querySelector('.wizardStep.active')?.dataset.step;
        document.querySelector('#runBtn').click();
        await new Promise(requestAnimationFrame);
        const blocked = !document.querySelector('#blockingModal').hidden;
        document.querySelector('#blockingModalOk').click();
        document.querySelector('#pickFilesTop').click();
        await new Promise(resolve => setTimeout(resolve, 120));
        const rows = document.querySelectorAll('.inputRecordTable .workspaceTableRow').length;
        document.querySelector('#runBtn').click();
        await new Promise(requestAnimationFrame);
        const afterInput = document.querySelector('.wizardStep.active')?.dataset.step;
        for (let index = 0; index < 4 && document.querySelector('.wizardStep.active')?.dataset.step !== 'result'; index += 1) {
          document.querySelector('#runBtn').click();
          await new Promise(requestAnimationFrame);
        }
        const afterOutput = document.querySelector('.wizardStep.active')?.dataset.step;
        document.querySelector('#runBtn').click();
        await new Promise(resolve => setTimeout(resolve, 120));
        return {
          title: document.querySelector('#dialogTitle').textContent,
          firstStep,
          blocked,
          rows,
          afterInput,
          afterOutput,
          resultText: document.querySelector('#taskResults').textContent,
          outputFields: document.querySelectorAll('#outputProfilePanel input, #outputProfilePanel select').length
        };
      })()
    `);
    assert.equal(workbenchState.firstStep, 'input');
    assert.equal(workbenchState.blocked, true);
    assert.ok(workbenchState.rows >= 2, 'input table should include header and sample row');
    assert.ok(['options', 'output'].includes(workbenchState.afterInput), 'wizard should advance after input');
    assert.equal(workbenchState.afterOutput, 'result');
    assert.match(workbenchState.resultText, /sample\.pdf/);
    await capture(win, '03-workbench-result');

    const workflowState = await win.webContents.executeJavaScript(`
      (async () => {
        document.querySelector('#saveAsWorkflowBtn').click();
        await new Promise(resolve => setTimeout(resolve, 180));
        const rows = document.querySelectorAll('#workflowRows tr').length;
        const detailVisible = !document.querySelector('#workflowDetail').hidden;
        const stepRows = document.querySelectorAll('.workflowStepRow').length;
        document.querySelector('#workflowPickInputsBtn').click();
        document.querySelector('#workflowPickOutputBtn').click();
        await new Promise(resolve => setTimeout(resolve, 120));
        document.querySelector('#workflowRunBtn').click();
        await new Promise(resolve => setTimeout(resolve, 120));
        return {
          rows,
          detailVisible,
          stepRows,
          runPanel: document.querySelector('#workflowRunPanel').textContent,
          issues: document.querySelector('#workflowIssues').textContent
        };
      })()
    `);
    assert.ok(workflowState.rows >= 1, 'workflow list should render');
    assert.equal(workflowState.detailVisible, true);
    assert.ok(workflowState.stepRows >= 1, 'saved workflow should include a step');
    assert.match(workflowState.runPanel, /completed|运行状态/);
    assert.match(workflowState.issues, /校验通过/);
    await capture(win, '04-workflow');

    console.log(`PASS workbench-workflow-ui screenshots=${outputDir}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
