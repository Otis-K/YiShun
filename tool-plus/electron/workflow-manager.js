const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TASK_TERMINAL = new Set(['succeeded', 'partial_failed', 'failed', 'cancelled', 'timed_out']);
const RUN_TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled', 'authorization_required']);

class WorkflowManager extends EventEmitter {
  constructor({ taskManager, workflowCall, catalog, userDataRoot }) {
    super();
    this.taskManager = taskManager;
    this.workflowCall = workflowCall;
    this.catalog = new Map(catalog.map(tool => [tool.key, tool]));
    this.userDataRoot = userDataRoot;
    this.runs = new Map();
    this.activeByWorkflow = new Map();
  }

  async start(payload) {
    const workflowId = String(payload && payload.workflowId || '');
    if (!workflowId) return { ok: false, error: '缺少任务流 ID。' };
    if (this.activeByWorkflow.has(workflowId)) return { ok: false, error: '同一任务流已有运行中的实例。' };
    const validation = await this.workflowCall('validate', { workflowId });
    if (!validation.ok) return validation;
    const errors = (validation.issues || []).filter(issue => issue.severity === 'error');
    if (errors.length) return { ok: false, error: errors[0].message, issues: validation.issues };
    const workflow = validation.data;
    const inputs = [...new Set((Array.isArray(payload.inputs) ? payload.inputs : []).map(value => path.resolve(String(value))))];
    const enabled = (workflow.steps || []).filter(step => step.enabled);
    if (!enabled.length) return { ok: false, error: '任务至少需要一条启用步骤。' };
    const firstTool = this.catalog.get(enabled[0].toolKey);
    if (firstTool && firstTool.inputKind !== 'none' && !inputs.length) return { ok: false, error: '请选择本次运行的输入记录。' };
    const finalOutputDir = path.resolve(String(payload.outputDir || ''));
    if (!path.isAbsolute(finalOutputDir)) return { ok: false, error: '最终输出目录必须是绝对路径。' };
    const inputCheck = await this.#validateInputs(inputs, firstTool);
    if (!inputCheck.ok) return inputCheck;
    try {
      await fs.promises.mkdir(finalOutputDir, { recursive: true });
      await fs.promises.access(finalOutputDir, fs.constants.W_OK);
    } catch (error) { return { ok: false, error: `输出目录不可写：${error.message}` }; }

    const id = crypto.randomUUID();
    const stagingDir = path.join(this.userDataRoot, 'workflow-runs', id);
    await fs.promises.mkdir(stagingDir, { recursive: true });
    const inputManifest = await this.#manifestForPaths(id, 'input', inputs);
    const now = new Date().toISOString();
    const record = {
      id, workflowId, workflowVersion: workflow.version, status: 'queued', inputManifest,
      finalOutputDir, snapshot: workflow, checkpointStepId: '', startedAt: now, endedAt: '',
      summary: { stagingDir, totalSteps: enabled.length, completedSteps: 0, currentStep: 0, stepResults: [], finalOutputs: [], logs: [] },
      cancelRequested: false, currentTaskId: '', task: null
    };
    const persisted = await this.workflowCall('run-create', { run: this.#persistable(record) });
    if (!persisted.ok) return persisted;
    this.runs.set(id, record);
    this.activeByWorkflow.set(workflowId, id);
    this.#emit(record, '任务已排队。');
    setImmediate(() => this.#execute(record, 0, inputManifest.items.map(item => item.path)));
    return { ok: true, run: this.snapshot(id) };
  }

  async cancel(runId) {
    const record = this.runs.get(runId);
    if (!record) return { ok: false, error: '运行不存在或已结束，请刷新历史记录。' };
    if (RUN_TERMINAL.has(record.status)) return { ok: true, run: this.snapshot(runId) };
    record.cancelRequested = true;
    this.#log(record, '收到取消请求，正在终止当前步骤进程树。');
    if (record.currentTaskId) await this.taskManager.cancel(record.currentTaskId);
    return { ok: true, run: this.snapshot(runId) };
  }

  async resume(runId, failedOnly = false) {
    if (this.runs.has(runId) && !RUN_TERMINAL.has(this.runs.get(runId).status)) return { ok: false, error: '该运行仍在执行。' };
    const response = await this.workflowCall('run-get', { runId });
    if (!response.ok) return response;
    const saved = response.data;
    if (!RUN_TERMINAL.has(saved.status)) return { ok: false, error: '该状态不能恢复。' };
    if (this.activeByWorkflow.has(saved.workflowId)) return { ok: false, error: '同一任务流已有运行中的实例。' };
    const workflow = saved.snapshot;
    const enabled = (workflow.steps || []).filter(step => step.enabled);
    let startIndex = 0;
    let paths = (saved.inputManifest.items || []).map(item => item.path);
    const stepResults = Array.isArray(saved.summary.stepResults) ? saved.summary.stepResults : [];
    if (saved.checkpointStepId) {
      const checkpointIndex = enabled.findIndex(step => step.id === saved.checkpointStepId);
      if (checkpointIndex >= 0) {
        startIndex = checkpointIndex + 1;
        const checkpoint = stepResults.find(item => item.stepId === saved.checkpointStepId);
        if (checkpoint && Array.isArray(checkpoint.outputs)) paths = checkpoint.outputs;
      }
    }
    if (failedOnly) {
      const failed = [...stepResults].reverse().find(item => Array.isArray(item.failedInputs) && item.failedInputs.length);
      if (failed) { startIndex = Math.max(0, failed.stepIndex - 1); paths = failed.failedInputs; }
    }
    const missing = paths.find(value => !fs.existsSync(value));
    if (missing) return { ok: false, error: `恢复所需产物已不存在：${missing}` };
    const record = { ...saved, cancelRequested: false, currentTaskId: '', task: null };
    record.status = 'queued'; record.endedAt = '';
    this.runs.set(runId, record); this.activeByWorkflow.set(record.workflowId, runId);
    this.#emit(record, failedOnly ? '正在仅重试失败项。' : '正在从检查点恢复。');
    setImmediate(() => this.#execute(record, startIndex, paths));
    return { ok: true, run: this.snapshot(runId) };
  }

  snapshot(id) {
    const run = this.runs.get(id);
    return run ? JSON.parse(JSON.stringify({ ...run, cancelRequested: undefined })) : null;
  }

  listActive() { return [...this.runs.values()].map(run => this.snapshot(run.id)); }

  async #execute(record, startIndex, currentPaths) {
    record.status = 'running';
    const steps = (record.snapshot.steps || []).filter(step => step.enabled);
    try {
      for (let index = startIndex; index < steps.length; index += 1) {
        if (record.cancelRequested) throw new CancelledError();
        const step = steps[index];
        const tool = this.catalog.get(step.toolKey);
        if (!tool) throw new Error(`第 ${index + 1} 步工具不存在：${step.toolKey}`);
        const stepDir = path.join(record.summary.stagingDir, `${String(index + 1).padStart(3, '0')}-${safeSegment(step.toolKey)}`);
        await fs.promises.mkdir(stepDir, { recursive: true });
        record.summary.currentStep = index + 1;
        this.#emit(record, `开始第 ${index + 1}/${steps.length} 步：${step.name}`);
        const task = this.taskManager.submit({
          tool: step.toolKey, inputs: currentPaths, outputDir: stepDir, options: step.options || {},
          workflowId: record.workflowId, runId: record.id, stepId: step.id, attempt: 1
        }, Number(tool.timeoutSeconds) || 300, tool.executionMode);
        record.currentTaskId = task.id;
        const finished = await this.#waitForTask(record, task.id);
        record.currentTaskId = '';
        if (record.cancelRequested || finished.state === 'cancelled') throw new CancelledError();
        const result = {
          stepId: step.id, stepIndex: index + 1, name: step.name, toolKey: step.toolKey,
          state: finished.state, elapsedMs: finished.elapsedMs, outputs: finished.outputs || [],
          failedInputs: finished.failedInputs || [], error: finished.error || ''
        };
        record.summary.stepResults = (record.summary.stepResults || []).filter(item => item.stepId !== step.id);
        record.summary.stepResults.push(result);
        if (finished.state !== 'succeeded') {
          if (/授权|会员|权益|许可/.test(`${finished.error} ${finished.phase}`)) throw new AuthorizationError(finished.error || finished.phase);
          if (record.snapshot.failurePolicy === 'skip-step' && currentPaths.length) { this.#log(record, `第 ${index + 1} 步失败，按策略跳过此步骤。`); continue; }
          if (finished.state === 'partial_failed' && record.snapshot.failurePolicy === 'skip-items' && finished.outputs.length) {
            currentPaths = finished.outputs;
            record.status = 'partial';
          } else { throw new Error(finished.error || finished.phase || `第 ${index + 1} 步失败`); }
        } else { currentPaths = finished.outputs || []; }
        if (!currentPaths.length) throw new Error(`第 ${index + 1} 步没有产生可传递产物。`);
        const manifest = await this.#manifestForPaths(record.id, step.id, currentPaths, result);
        await atomicWriteJSON(path.join(stepDir, 'artifact-manifest.json'), manifest);
        record.checkpointStepId = step.id;
        record.summary.completedSteps = index + 1;
        await this.#persist(record);
      }
      const committed = await this.#commitOutputs(currentPaths, record.finalOutputDir);
      record.summary.finalOutputs = committed;
      record.status = record.summary.stepResults.some(item => item.state !== 'succeeded') ? 'partial' : 'completed';
      record.endedAt = new Date().toISOString();
      this.#log(record, `任务完成，已提交 ${committed.length} 个最终产物。`);
    } catch (error) {
      record.endedAt = new Date().toISOString();
      if (error instanceof CancelledError) record.status = 'cancelled';
      else if (error instanceof AuthorizationError) record.status = 'authorization_required';
      else record.status = 'failed';
      record.summary.error = error.message;
      this.#log(record, error.message);
    } finally {
      record.currentTaskId = ''; record.task = null;
      this.activeByWorkflow.delete(record.workflowId);
      await this.#persist(record);
      this.#emit(record, terminalMessage(record.status));
    }
  }

  #waitForTask(record, taskId) {
    return new Promise(resolve => {
      const listener = task => {
        if (!task || task.id !== taskId) return;
        record.task = task;
        this.#emit(record);
        if (TASK_TERMINAL.has(task.state)) { this.taskManager.off('update', listener); resolve(task); }
      };
      this.taskManager.on('update', listener);
      const existing = this.taskManager.snapshot(taskId);
      if (existing && TASK_TERMINAL.has(existing.state)) { this.taskManager.off('update', listener); resolve(existing); }
    });
  }

  async #validateInputs(inputs, tool) {
    for (const input of inputs) {
      let stat;
      try { stat = await fs.promises.stat(input); } catch (_) { return { ok: false, error: `输入不存在或不可读：${input}` }; }
      if (tool && tool.inputKind === 'folders' && !stat.isDirectory()) return { ok: false, error: `此任务首步需要文件夹：${input}` };
      if (tool && tool.inputKind === 'files' && !stat.isFile()) return { ok: false, error: `此任务首步需要文件：${input}` };
      const accepted = Array.isArray(tool && tool.acceptedExtensions) ? tool.acceptedExtensions : [];
      const extension = path.extname(input).slice(1).toLowerCase();
      if (stat.isFile() && accepted.length && !accepted.includes('*') && !accepted.includes(extension)) return { ok: false, error: `首步不接受 .${extension || '(无扩展名)'} 文件。` };
    }
    return { ok: true };
  }

  async #manifestForPaths(runId, stepId, paths, result = null) {
    const items = [];
    for (const value of paths) {
      const stat = await fs.promises.stat(value);
      items.push({
        artifactId: crypto.randomUUID(), path: value, kind: stat.isDirectory() ? 'directory' : 'file',
        extension: stat.isDirectory() ? '' : path.extname(value).slice(1).toLowerCase(),
        mediaType: mediaTypeFor(value), sourceArtifactIds: [], size: stat.size, metadata: {}
      });
    }
    return { schemaVersion: 1, runId, stepId, createdAt: new Date().toISOString(), result, items };
  }

  async #commitOutputs(outputs, outputDir) {
    const committed = [];
    for (const source of outputs) {
      const stat = await fs.promises.stat(source);
      const target = await uniqueTarget(outputDir, path.basename(source));
      const partial = `${target}.partial-${crypto.randomUUID()}`;
      if (stat.isDirectory()) {
        await fs.promises.cp(source, partial, { recursive: true, errorOnExist: true });
        await fs.promises.rename(partial, target);
      } else {
        await fs.promises.copyFile(source, partial, fs.constants.COPYFILE_EXCL);
        const [sourceHash, copiedHash] = await Promise.all([sha256File(source), sha256File(partial)]);
        if (sourceHash !== copiedHash) { await fs.promises.unlink(partial).catch(() => {}); throw new Error(`最终提交校验失败：${path.basename(source)}`); }
        await fs.promises.rename(partial, target);
      }
      committed.push(target);
    }
    return committed;
  }

  #log(record, message) {
    const entry = `${new Date().toISOString()} ${String(message).replace(/[\r\n]+/g, ' ')}`;
    record.summary.logs = [...(record.summary.logs || []), entry].slice(-500);
    const logPath = path.join(record.summary.stagingDir, 'run.log');
    fs.promises.appendFile(logPath, `${entry}\n`, 'utf8').catch(() => {});
  }

  #emit(record, message = '') { if (message) this.#log(record, message); this.emit('update', this.snapshot(record.id)); }
  #persistable(record) { return { id: record.id, workflowId: record.workflowId, workflowVersion: record.workflowVersion, status: record.status, inputManifest: record.inputManifest, finalOutputDir: record.finalOutputDir, snapshot: record.snapshot, checkpointStepId: record.checkpointStepId, summary: record.summary, startedAt: record.startedAt, endedAt: record.endedAt }; }
  async #persist(record) { await this.workflowCall('run-update', { run: this.#persistable(record) }); }
}

class CancelledError extends Error { constructor() { super('任务已取消，后续步骤未启动。'); } }
class AuthorizationError extends Error {}

function safeSegment(value) { return String(value).replace(/[^a-z0-9_-]+/gi, '-').slice(0, 80); }
function mediaTypeFor(value) { const extension = path.extname(value).toLowerCase(); return ({ '.html': 'text/html', '.txt': 'text/plain', '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' })[extension] || 'application/octet-stream'; }
function terminalMessage(status) { return ({ completed: '任务流已完成。', partial: '任务流部分完成，可重试失败项。', failed: '任务流执行失败。', cancelled: '任务流已取消。', authorization_required: '会员授权中断，检查点已保留。' })[status] || status; }
async function atomicWriteJSON(target, value) { const temporary = `${target}.partial`; await fs.promises.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); await fs.promises.rename(temporary, target); }
async function uniqueTarget(directory, name) { const parsed = path.parse(name); let index = 1; let candidate = path.join(directory, name); while (fs.existsSync(candidate)) { index += 1; candidate = path.join(directory, `${parsed.name}_${index}${parsed.ext}`); } return candidate; }
function sha256File(file) { return new Promise((resolve, reject) => { const hash = crypto.createHash('sha256'); const stream = fs.createReadStream(file); stream.on('error', reject); stream.on('data', chunk => hash.update(chunk)); stream.on('end', () => resolve(hash.digest('hex'))); }); }

module.exports = { WorkflowManager, RUN_TERMINAL };
