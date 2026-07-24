const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TaskManager } = require('../../electron/task-manager');
const { WorkflowManager, RUN_TERMINAL } = require('../../electron/workflow-manager');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolplus-workflow-manager-'));
const fixture = path.join(__dirname, 'fixtures', 'fake-workflow-backend.js');
const taskManager = new TaskManager({ command: process.execPath, commandArgs: [fixture], cwd: root, maxConcurrent: 1 });
const workflow = {
  id: 'workflow-1', name: 'Markdown 发布', version: 3, failurePolicy: 'stop',
  steps: [
    { id: 'step-1', name: 'Markdown 转 HTML', enabled: true, toolKey: 'markdown-to-html', options: {} },
    { id: 'step-2', name: 'HTML 转 TXT', enabled: true, toolKey: 'html-to-txt', options: {} }
  ]
};
const catalog = [
  { key: 'markdown-to-html', inputKind: 'files', acceptedExtensions: ['md'], outputContract: { extensions: ['html'] }, executionMode: 'per-input', timeoutSeconds: 10 },
  { key: 'html-to-txt', inputKind: 'files', acceptedExtensions: ['html'], outputContract: { extensions: ['txt'] }, executionMode: 'per-input', timeoutSeconds: 10 }
];
const savedRuns = new Map();
async function workflowCall(action, payload) {
  if (action === 'validate') return { ok: true, data: workflow, issues: [] };
  if (action === 'run-create' || action === 'run-update') { savedRuns.set(payload.run.id, JSON.parse(JSON.stringify(payload.run))); return { ok: true, data: payload.run }; }
  if (action === 'run-get') return { ok: true, data: savedRuns.get(payload.runId) };
  return { ok: false, error: `unexpected action ${action}` };
}
const manager = new WorkflowManager({ taskManager, workflowCall, catalog, userDataRoot: root });

function waitForTerminal(id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${id}`)), timeoutMs);
    const listener = run => {
      if (run.id === id && RUN_TERMINAL.has(run.status)) { clearTimeout(timer); manager.off('update', listener); resolve(run); }
    };
    manager.on('update', listener);
  });
}

(async () => {
  const input = path.join(root, 'sample.md');
  const output = path.join(root, 'final-output');
  fs.writeFileSync(input, '# hello workflow', 'utf8');
  const started = await manager.start({ workflowId: workflow.id, inputs: [input], outputDir: output });
  assert.equal(started.ok, true);
  const completed = await waitForTerminal(started.run.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.summary.completedSteps, 2);
  assert.equal(completed.summary.stepResults.length, 2);
  assert.equal(completed.summary.finalOutputs.length, 1);
  assert.equal(fs.readFileSync(completed.summary.finalOutputs[0], 'utf8'), '# hello workflow');
  assert.equal(fs.readFileSync(input, 'utf8'), '# hello workflow');
  assert.ok(completed.checkpointStepId === 'step-2');
  assert.ok(fs.existsSync(path.join(completed.summary.stagingDir, '002-html-to-txt', 'artifact-manifest.json')));

  const rejected = await manager.start({ workflowId: workflow.id, inputs: [path.join(root, 'wrong.pdf')], outputDir: output });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /不存在|不接受/);
  console.log('PASS workflow manager manifest pipeline checkpoint final commit and validation');
})().catch(error => { console.error(error); process.exitCode = 1; });
