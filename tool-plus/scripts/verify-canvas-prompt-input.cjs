const assert = require('node:assert/strict');
const path = require('node:path');
const { _electron: electron } = require('G:/FlowCanvas-SDK/FlowCanvas-SDK/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const expected = 'she is walking through a neon city';
const rounds = Number(process.env.TOOLPLUS_PROMPT_INPUT_ROUNDS || 30);

async function openApplication() {
  const configured = process.env.TOOLPLUS_EXECUTABLE;
  if (configured) return electron.launch({ executablePath: configured, timeout: 30000 });
  const executablePath = require('electron');
  return electron.launch({ executablePath, args: [root], cwd: root, timeout: 30000 });
}

(async () => {
  let application;
  let applicationProcess;
  try {
    application = await openApplication();
    applicationProcess = application.process();
    const page = await application.firstWindow();
    page.setDefaultTimeout(20000);
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.sideItem', { hasText: '智能画布' }).click();
    await page.locator('#canvasOpenBtn').click();
    const frameHandle = await page.locator('#canvasFrame').elementHandle();
    const frame = await frameHandle.contentFrame();
    await frame.waitForFunction(() => Boolean(window.__toolPlusCanvasReady));

    for (let round = 0; round < rounds; round += 1) {
      const nodeId = await frame.evaluate(async () => {
        const api = window.__toolPlusCanvasSDK;
        api.reset();
        const node = api.addNode('image', { position: { x: 240, y: 100 } });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return node.id;
      });
      const shell = frame.locator(`.react-flow__node[data-id="${nodeId}"]`);
      const textarea = shell.locator('textarea[aria-label="图片生成描述"]');
      await textarea.waitFor({ state: 'visible' });
      await textarea.focus();
      await frame.evaluate(id => {
        const shellElement = document.querySelector(`.react-flow__node[data-id="${id}"]`);
        const input = shellElement?.querySelector('textarea[aria-label="图片生成描述"]');
        if (!shellElement || !input) throw new Error('image prompt input was not rendered');
        const trace = { blurCount: 0, hiddenCount: 0 };
        input.addEventListener('blur', () => { trace.blurCount += 1; });
        const observer = new MutationObserver(() => {
          if (getComputedStyle(shellElement).visibility === 'hidden') trace.hiddenCount += 1;
        });
        observer.observe(shellElement, { attributes: true, attributeFilter: ['style', 'class'] });
        window.__toolPlusPromptInputTrace = { trace, observer, input, shellElement };
      }, nodeId);

      await page.keyboard.type(expected, { delay: 0 });
      await frame.waitForTimeout(30);
      const result = await frame.evaluate(({ id, expectedValue }) => {
        const api = window.__toolPlusCanvasSDK;
        const state = window.__toolPlusPromptInputTrace;
        const node = api.getGraph().nodes.find(item => item.id === id);
        const graphPrompt = node?.data?.generationDrafts?.image?.prompt || '';
        const report = {
          value: state.input.value,
          graphPrompt,
          focused: document.activeElement === state.input,
          connected: state.input.isConnected,
          hiddenCount: state.trace.hiddenCount,
          blurCount: state.trace.blurCount,
          visibility: getComputedStyle(state.shellElement).visibility,
        };
        state.observer.disconnect();
        if (report.value !== expectedValue || report.graphPrompt !== expectedValue) return report;
        document.querySelector('[title="导出 JSON"]')?.focus();
        return report;
      }, { id: nodeId, expectedValue: expected });

      assert.equal(result.value, expected, `round ${round + 1}: prompt DOM value lost characters`);
      assert.equal(result.graphPrompt, expected, `round ${round + 1}: graph prompt lost characters`);
      assert.equal(result.focused, true, `round ${round + 1}: prompt lost focus while typing`);
      assert.equal(result.connected, true, `round ${round + 1}: prompt DOM was replaced`);
      assert.equal(result.hiddenCount, 0, `round ${round + 1}: React Flow hid the active node while typing`);
      assert.equal(result.blurCount, 0, `round ${round + 1}: prompt blurred while typing`);
      assert.equal(result.visibility, 'visible', `round ${round + 1}: node is not visible after typing`);

      await frame.waitForTimeout(30);
      const undo = await frame.evaluate(id => {
        const api = window.__toolPlusCanvasSDK;
        const before = api.getGraph().nodes.find(node => node.id === id)?.data?.generationDrafts?.image?.prompt || '';
        const undone = api.undo();
        const afterNode = api.getGraph().nodes.find(node => node.id === id);
        return {
          before,
          undone,
          nodeStillExists: Boolean(afterNode),
          after: afterNode?.data?.generationDrafts?.image?.prompt || '',
        };
      }, nodeId);
      assert.equal(undo.before, expected, `round ${round + 1}: blur did not commit the prompt`);
      assert.equal(undo.undone, true, `round ${round + 1}: prompt edit was not undoable`);
      assert.equal(undo.nodeStillExists, true, `round ${round + 1}: one undo removed the node instead of only the prompt edit`);
      assert.equal(undo.after, '', `round ${round + 1}: one undo did not restore the original prompt`);
    }

    console.log(JSON.stringify({ ok: true, rounds, promptLength: expected.length, focusLosses: 0, hiddenTransitions: 0 }));
  } finally {
    if (application) {
      await Promise.race([application.close().catch(() => {}), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    if (applicationProcess && !applicationProcess.killed) {
      try { applicationProcess.kill(); } catch (_) { /* already exited */ }
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
