const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { TaskManager } = require('../electron/task-manager');
const { WorkflowManager, RUN_TERMINAL } = require('../electron/workflow-manager');

const projectRoot = path.resolve(__dirname, '..');
const backendName = process.platform === 'win32' ? 'toolplus-backend.exe' : 'toolplus-backend';
const backendPath = process.env.TOOLPLUS_BACKEND_PATH
  ? path.resolve(process.env.TOOLPLUS_BACKEND_PATH)
  : path.join(projectRoot, 'bin', backendName);
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const acceptanceRoot = path.join(projectRoot, 'work', 'workflow-integration', runStamp);
const inputPath = path.join(acceptanceRoot, 'real-workflow-source.md');
const outputDir = path.join(acceptanceRoot, 'final-output');
const databasePath = path.join(acceptanceRoot, 'workflow-acceptance.db');
const reportPath = path.join(acceptanceRoot, 'acceptance-result.json');
const sourceText = [
  '# Real Workflow Acceptance',
  '',
  'Unique marker: TOOLPLUS_REAL_WORKFLOW_20260716',
  '',
  'This is **actual backend** content.',
  ''
].join('\n');

let taskManager = null;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function invokeBackend(args, payload, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(backendPath, args, {
      cwd: projectRoot,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ ...value, elapsedMs: Date.now() - startedAt });
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish(new Error(`backend timed out after ${timeoutMs} ms: ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (code !== 0) {
        finish(new Error(`backend exited with ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      let response;
      try {
        response = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
      } catch (error) {
        finish(new Error(`backend returned invalid JSON: ${stdout.trim() || stderr.trim() || error.message}`));
        return;
      }
      finish(null, { response, pid: child.pid, stderr: stderr.trim() });
    });
    child.stdin.on('error', error => finish(error));
    child.stdin.end(payload === undefined ? '' : JSON.stringify(payload));
  });
}

async function workflowCall(action, payload = {}) {
  const result = await invokeBackend(['workflow'], { action, dbPath: databasePath, ...payload });
  return result.response;
}

function requireOK(response, label) {
  assert.equal(response && response.ok, true, `${label}: ${response && response.error || 'unknown backend error'}`);
  return response.data;
}

function waitForTerminal(manager, runId, timeoutMs = 90_000) {
  const current = manager.snapshot(runId);
  if (current && RUN_TERMINAL.has(current.status)) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.off('update', onUpdate);
      reject(new Error(`workflow ${runId} did not reach a terminal state within ${timeoutMs} ms`));
    }, timeoutMs);
    const onUpdate = run => {
      if (!run || run.id !== runId || !RUN_TERMINAL.has(run.status)) return;
      clearTimeout(timer);
      manager.off('update', onUpdate);
      resolve(run);
    };
    manager.on('update', onUpdate);
    const afterSubscribe = manager.snapshot(runId);
    if (afterSubscribe && RUN_TERMINAL.has(afterSubscribe.status)) onUpdate(afterSubscribe);
  });
}

async function main() {
  const suiteStartedAt = Date.now();
  assert.ok(fs.existsSync(backendPath), `actual backend executable is missing: ${backendPath}`);
  assert.ok(fs.statSync(backendPath).isFile(), `backend path is not a file: ${backendPath}`);

  // Keep this acceptance deterministic and local even if the launching shell has service variables.
  delete process.env.TOOLPLUS_ENTITLEMENT_URL;
  delete process.env.TOOLPLUS_ACCOUNT_TOKEN;
  delete process.env.TOOLPLUS_PERMIT_HMAC_SECRET;

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(inputPath, sourceText, 'utf8');
  const originalInputHash = sha256File(inputPath);

  const catalogResult = await invokeBackend(['catalog']);
  const catalogResponse = catalogResult.response;
  assert.equal(catalogResponse.ok, true, catalogResponse.error || 'catalog request failed');
  const catalog = catalogResponse.tools || [];
  const markdownTool = catalog.find(tool => tool.key === 'markdown-to-html');
  const htmlTool = catalog.find(tool => tool.key === 'html-to-txt');
  assert.ok(markdownTool && markdownTool.workflowCapable, 'markdown-to-html is not workflow capable');
  assert.ok(htmlTool && htmlTool.workflowCapable, 'html-to-txt is not workflow capable');

  const workflow = requireOK(await workflowCall('create', {
    workflow: {
      name: '真实两步本地任务流验收',
      description: 'markdown-to-html -> html-to-txt',
      failurePolicy: 'stop-on-error',
      outputPolicy: { mode: 'new-directory' },
      conflictPolicy: 'auto-number',
      notification: 'app',
      concurrency: 0
    }
  }), 'create workflow');

  const firstStep = requireOK(await workflowCall('step-create', {
    step: {
      workflowId: workflow.id,
      name: 'Markdown 转 HTML',
      enabled: true,
      toolKey: 'markdown-to-html',
      options: {},
      inputBinding: { source: 'run-input' }
    }
  }), 'create first step');
  const secondStep = requireOK(await workflowCall('step-create', {
    step: {
      workflowId: workflow.id,
      name: 'HTML 转 TXT',
      enabled: true,
      toolKey: 'html-to-txt',
      options: {},
      inputBinding: { source: 'previous-step' }
    }
  }), 'create second step');

  const validation = await workflowCall('validate', { workflowId: workflow.id });
  const validatedWorkflow = requireOK(validation, 'validate workflow');
  assert.deepEqual(validation.issues || [], [], 'workflow validation returned issues');
  assert.deepEqual(validatedWorkflow.steps.map(step => step.toolKey), ['markdown-to-html', 'html-to-txt']);

  taskManager = new TaskManager({
    command: backendPath,
    cwd: projectRoot,
    maxConcurrent: 1
  });
  const taskObservations = new Map();
  taskManager.on('update', task => {
    if (!task) return;
    taskObservations.set(task.id, {
      id: task.id,
      tool: task.payload && task.payload.tool,
      state: task.state,
      pid: task.pid,
      outputs: task.outputs || [],
      elapsedMs: task.elapsedMs
    });
  });

  const manager = new WorkflowManager({
    taskManager,
    workflowCall,
    catalog,
    userDataRoot: acceptanceRoot
  });
  const workflowStates = [];
  manager.on('update', run => {
    if (run && workflowStates.at(-1) !== run.status) workflowStates.push(run.status);
  });

  const executionStartedAt = Date.now();
  const started = await manager.start({
    workflowId: workflow.id,
    inputs: [inputPath],
    outputDir
  });
  assert.equal(started.ok, true, started.error || 'workflow start failed');
  const completed = await waitForTerminal(manager, started.run.id);
  const executionElapsedMs = Date.now() - executionStartedAt;

  assert.equal(completed.status, 'completed', completed.summary && completed.summary.error || 'workflow did not complete');
  assert.equal(completed.summary.completedSteps, 2);
  assert.equal(completed.summary.stepResults.length, 2);
  assert.deepEqual(completed.summary.stepResults.map(step => step.toolKey), ['markdown-to-html', 'html-to-txt']);
  assert.deepEqual(completed.summary.stepResults.map(step => step.state), ['succeeded', 'succeeded']);
  assert.equal(completed.checkpointStepId, secondStep.id);
  assert.equal(completed.summary.finalOutputs.length, 1);

  const firstOutputs = completed.summary.stepResults[0].outputs;
  const secondOutputs = completed.summary.stepResults[1].outputs;
  assert.equal(firstOutputs.length, 1);
  assert.equal(secondOutputs.length, 1);
  assert.equal(path.extname(firstOutputs[0]).toLowerCase(), '.html');
  assert.equal(path.extname(secondOutputs[0]).toLowerCase(), '.txt');
  assert.ok(fs.existsSync(firstOutputs[0]), 'real first-step HTML output is missing');
  assert.ok(fs.existsSync(secondOutputs[0]), 'real second-step TXT output is missing');
  assert.ok(fs.existsSync(completed.summary.finalOutputs[0]), 'committed final output is missing');

  const htmlText = fs.readFileSync(firstOutputs[0], 'utf8');
  const stagedTxtText = fs.readFileSync(secondOutputs[0], 'utf8');
  const finalTxtText = fs.readFileSync(completed.summary.finalOutputs[0], 'utf8');
  assert.match(htmlText, /<h1[^>]*>\s*Real Workflow Acceptance\s*<\/h1>/i);
  assert.match(htmlText, /TOOLPLUS_REAL_WORKFLOW_20260716/);
  assert.match(finalTxtText, /Real Workflow Acceptance/);
  assert.match(finalTxtText, /TOOLPLUS_REAL_WORKFLOW_20260716/);
  assert.match(finalTxtText, /actual backend/);
  assert.doesNotMatch(finalTxtText, /<[^>]+>/);
  assert.equal(finalTxtText, stagedTxtText, 'final commit differs from the second-step artifact');
  assert.equal(sha256File(inputPath), originalInputHash, 'source input was modified');

  const firstManifest = path.join(completed.summary.stagingDir, '001-markdown-to-html', 'artifact-manifest.json');
  const secondManifest = path.join(completed.summary.stagingDir, '002-html-to-txt', 'artifact-manifest.json');
  assert.ok(fs.existsSync(firstManifest), 'first-step artifact manifest is missing');
  assert.ok(fs.existsSync(secondManifest), 'second-step artifact manifest is missing');
  assert.equal(JSON.parse(fs.readFileSync(firstManifest, 'utf8')).items[0].extension, 'html');
  assert.equal(JSON.parse(fs.readFileSync(secondManifest, 'utf8')).items[0].extension, 'txt');

  const observedTasks = [...taskObservations.values()];
  assert.equal(observedTasks.length, 2, `expected two real backend tasks, got ${observedTasks.length}`);
  assert.deepEqual(observedTasks.map(task => task.tool), ['markdown-to-html', 'html-to-txt']);
  assert.ok(observedTasks.every(task => task.state === 'succeeded'), 'one or more backend tasks did not succeed');
  assert.ok(observedTasks.every(task => Number.isInteger(task.pid) && task.pid > 0), 'backend child PID was not observed');

  // Each call below starts a new backend process, forcing SQLite to be reopened from disk.
  const persistedWorkflow = requireOK(await workflowCall('get', { workflowId: workflow.id }), 'reopen and get workflow');
  assert.equal(persistedWorkflow.steps.length, 2);
  assert.deepEqual(persistedWorkflow.steps.map(step => step.id), [firstStep.id, secondStep.id]);
  const persistedRun = requireOK(await workflowCall('run-get', { runId: completed.id }), 'reopen and get run');
  assert.equal(persistedRun.status, 'completed');
  assert.equal(persistedRun.workflowId, workflow.id);
  assert.equal(persistedRun.summary.completedSteps, 2);
  assert.equal(persistedRun.summary.finalOutputs[0], completed.summary.finalOutputs[0]);
  const listedRuns = requireOK(await workflowCall('run-list', { workflowId: workflow.id }), 'reopen and list runs');
  assert.ok(listedRuns.some(run => run.id === completed.id && run.status === 'completed'), 'persisted run is absent from run-list');

  assert.ok(fs.existsSync(databasePath), 'SQLite database was not created');
  const databaseHeader = fs.readFileSync(databasePath).subarray(0, 16).toString('binary');
  assert.equal(databaseHeader, 'SQLite format 3\u0000');

  const report = {
    ok: true,
    backendPath,
    backendSha256: sha256File(backendPath),
    backendBytes: fs.statSync(backendPath).size,
    catalogToolCount: catalog.length,
    workflowId: workflow.id,
    workflowVersion: persistedWorkflow.version,
    runId: completed.id,
    status: persistedRun.status,
    workflowStates,
    steps: persistedRun.summary.stepResults.map(step => ({
      toolKey: step.toolKey,
      state: step.state,
      elapsedMs: step.elapsedMs,
      outputCount: step.outputs.length
    })),
    backendTasks: observedTasks.map(task => ({ tool: task.tool, state: task.state, pid: task.pid, elapsedMs: task.elapsedMs })),
    finalOutput: completed.summary.finalOutputs[0],
    finalOutputSha256: sha256File(completed.summary.finalOutputs[0]),
    databasePath,
    databaseBytes: fs.statSync(databasePath).size,
    executionElapsedMs,
    totalElapsedMs: Date.now() - suiteStartedAt,
    acceptanceRoot
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
  console.log('PASS real backend + TaskManager + WorkflowManager + SQLite two-step workflow integration');
}

main()
  .catch(error => {
    console.error(`FAIL real workflow integration: ${error.stack || error.message}`);
    console.error(`Acceptance artifacts: ${acceptanceRoot}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (taskManager) await taskManager.shutdown();
    const exitCode = process.exitCode || 0;
    await Promise.all([
      new Promise(resolve => process.stdout.write('', resolve)),
      new Promise(resolve => process.stderr.write('', resolve))
    ]);
    process.exit(exitCode);
  });
