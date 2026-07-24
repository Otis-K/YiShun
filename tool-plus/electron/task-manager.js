const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const TERMINAL_STATES = new Set(['succeeded', 'partial_failed', 'failed', 'cancelled', 'timed_out']);

class TaskManager extends EventEmitter {
  constructor({ command, commandArgs = [], cwd, maxConcurrent = 2, killGraceMs = 1800 }) {
    super();
    this.command = command;
    this.commandArgs = commandArgs;
    this.cwd = cwd;
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || 2);
    this.killGraceMs = killGraceMs;
    this.tasks = new Map();
    this.queue = [];
    this.running = new Map();
  }

  submit(payload, timeoutSeconds = 300, executionMode = 'atomic') {
    const now = new Date().toISOString();
    const totalItems = Math.max(1, Array.isArray(payload.inputs) ? payload.inputs.length : 0);
    const task = {
      id: crypto.randomUUID(),
      state: 'queued',
      phase: '等待执行',
      payload,
      createdAt: now,
      startedAt: null,
      finishedAt: null,
      elapsedMs: 0,
      timeoutSeconds: Math.max(1, Number(timeoutSeconds) || 300),
      outputs: [],
      error: '',
      exitCode: null,
      pid: null,
      cancelRequestedAt: null,
      cancellationLatencyMs: null,
      completedItems: 0,
      totalItems,
      percent: null,
      currentItem: null,
      speed: null,
      etaMs: null,
      progressAvailable: false,
      executionMode: executionMode === 'per-input' ? 'per-input' : 'atomic',
      itemResults: [],
      failedInputs: []
    };
    this.tasks.set(task.id, task);
    this.queue.push(task.id);
    this.#emit(task);
    this.#drain();
    return this.snapshot(task.id);
  }

  snapshot(id) {
    const task = this.tasks.get(id);
    return task ? JSON.parse(JSON.stringify(task)) : null;
  }

  list() {
    return [...this.tasks.values()].map(task => this.snapshot(task.id));
  }

  async cancel(id) {
    const task = this.tasks.get(id);
    if (!task) return { ok: false, error: '任务不存在或已被清理。' };
    if (TERMINAL_STATES.has(task.state)) return { ok: true, task: this.snapshot(id) };
    task.cancelRequestedAt = new Date().toISOString();
    if (task.state === 'queued') {
      this.queue = this.queue.filter(taskId => taskId !== id);
      this.#finish(task, 'cancelled', '已取消，任务尚未启动。');
      this.#drain();
      return { ok: true, task: this.snapshot(id) };
    }
    task.phase = '正在取消并清理子进程';
    this.#emit(task);
    const runtime = this.running.get(id);
    if (runtime) await killProcessTree(runtime.child, this.killGraceMs);
    return { ok: true, task: this.snapshot(id) };
  }

  async shutdown() {
    await Promise.all([...this.running.keys()].map(id => this.cancel(id)));
  }

  #drain() {
    while (this.running.size < this.maxConcurrent && this.queue.length) {
      const id = this.queue.shift();
      const task = this.tasks.get(id);
      if (task && task.state === 'queued') this.#start(task);
    }
  }

  async #start(task) {
    task.state = 'running';
    task.phase = '后端处理中';
    task.startedAt = new Date().toISOString();
    const inputs = Array.isArray(task.payload.inputs) ? task.payload.inputs : [];
    const itemPayloads = task.executionMode === 'per-input' && inputs.length > 1
      ? inputs.map(input => ({ ...task.payload, inputs: [input] }))
      : [task.payload];
    task.progressAvailable = itemPayloads.length > 1;
    if (task.progressAvailable) task.percent = 0;
    const runtime = { child: null, ticker: null, timeout: null, timedOut: false };
    const ticker = setInterval(() => {
      task.elapsedMs = Date.now() - Date.parse(task.startedAt);
      if (task.progressAvailable && task.completedItems > 0) {
        const itemsPerSecond = task.completedItems / Math.max(task.elapsedMs / 1000, 0.001);
        task.speed = `${itemsPerSecond.toFixed(itemsPerSecond < 10 ? 2 : 1)} 项/秒`;
        task.etaMs = Math.round((task.totalItems - task.completedItems) / itemsPerSecond * 1000);
      }
      this.#emit(task);
    }, 500);
    const timeout = setTimeout(async () => {
      if (task.state !== 'running') return;
      runtime.timedOut = true;
      task.phase = '超过分类超时，正在终止';
      this.#emit(task);
      await killProcessTree(runtime.child, this.killGraceMs);
    }, task.timeoutSeconds * 1000);
    runtime.ticker = ticker;
    runtime.timeout = timeout;
    this.running.set(task.id, runtime);
    this.#emit(task);

    try {
      for (const [index, payload] of itemPayloads.entries()) {
        if (task.cancelRequestedAt || runtime.timedOut) break;
        const itemStartedAt = Date.now();
        task.currentItem = itemPayloads.length > 1 && payload.inputs ? payload.inputs[0] : null;
        task.phase = itemPayloads.length > 1 ? `正在处理第 ${index + 1}/${itemPayloads.length} 项` : '后端处理中';
        this.#emit(task);
        const result = await this.#runBackend(runtime, payload);
        task.exitCode = result.code;
        if (task.cancelRequestedAt || runtime.timedOut) break;
        let response = null;
        try { response = JSON.parse(result.stdout); } catch (_) {}
        if (response && response.ok) {
          const outputs = Array.isArray(response.outputs) ? response.outputs : [];
          task.outputs.push(...outputs);
          task.itemResults.push({ input: task.currentItem, state: 'succeeded', outputs, elapsedMs: Date.now() - itemStartedAt });
        } else {
          const reason = normalizeError(response && response.error || result.stderr.trim() || `后端退出码 ${result.code}`);
          const failedInputs = itemPayloads.length === 1 && inputs.length ? inputs : [task.currentItem];
          task.failedInputs.push(...failedInputs.filter(Boolean));
          task.itemResults.push({ input: task.currentItem, state: 'failed', outputs: [], error: reason, elapsedMs: Date.now() - itemStartedAt });
        }
        task.completedItems = index + 1;
        if (task.progressAvailable) task.percent = Math.round(task.completedItems / task.totalItems * 1000) / 10;
        this.#emit(task);
      }
    } finally {
      clearInterval(ticker);
      clearTimeout(timeout);
      this.running.delete(task.id);
      task.elapsedMs = task.startedAt ? Date.now() - Date.parse(task.startedAt) : 0;
      if (task.cancelRequestedAt) {
        task.cancellationLatencyMs = Date.now() - Date.parse(task.cancelRequestedAt);
        this.#finish(task, 'cancelled', '任务已取消，处理进程树已终止。');
      } else if (runtime.timedOut) {
        this.#finish(task, 'timed_out', `任务超过 ${task.timeoutSeconds} 秒分类超时。`);
      } else {
        const failedCount = task.itemResults.filter(item => item.state === 'failed').length;
        const succeededCount = task.itemResults.filter(item => item.state === 'succeeded').length;
        if (failedCount && succeededCount) {
          task.currentItem = null;
          this.#finish(task, 'partial_failed', `${failedCount} 项失败，${succeededCount} 项成功。`);
        } else if (failedCount) {
          const firstFailure = task.itemResults.find(item => item.state === 'failed');
          this.#finish(task, 'failed', firstFailure && firstFailure.error || '处理失败。');
        } else {
          task.completedItems = task.totalItems;
          task.percent = 100;
          task.currentItem = null;
          task.progressAvailable = true;
          task.etaMs = 0;
          this.#finish(task, 'succeeded', '执行完成');
        }
      }
      this.#drain();
    }
  }

  #runBackend(runtime, payload) {
    return new Promise(resolve => {
      let child;
      try {
        child = spawn(this.command, [...this.commandArgs, 'run'], {
          cwd: this.cwd,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
      } catch (error) {
        resolve({ code: -1, stdout: '', stderr: error.message });
        return;
      }
      runtime.child = child;
      const task = [...this.tasks.values()].find(candidate => this.running.get(candidate.id) === runtime);
      if (task) task.pid = child.pid || null;
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { stderr += chunk.toString(); });
      child.on('error', error => { stderr += `\n${error.message}`; });
      child.stdin.on('error', error => { stderr += `\n${error.message}`; });
      child.on('close', code => {
        runtime.child = null;
        resolve({ code, stdout, stderr });
      });
      child.stdin.end(JSON.stringify(payload));
    });
  }

  #finish(task, state, message) {
    task.state = state;
    task.phase = message;
    task.error = state === 'failed' || state === 'partial_failed' || state === 'timed_out' ? message : '';
    task.finishedAt = new Date().toISOString();
    this.#emit(task);
  }

  #emit(task) {
    this.emit('update', this.snapshot(task.id));
  }
}

async function killProcessTree(child, graceMs) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_) {}
        resolve();
      }, graceMs);
      killer.on('close', () => { clearTimeout(timer); resolve(); });
      killer.on('error', () => { clearTimeout(timer); resolve(); });
    });
    return;
  }
  try { child.kill('SIGTERM'); } catch (_) {}
  await new Promise(resolve => setTimeout(resolve, Math.min(graceMs, 500)));
  if (child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
}

function normalizeError(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '处理失败，请检查输入文件与输出目录后重试。';
  if (/permission|access.*denied|拒绝访问/i.test(text)) return `没有读写权限：${text}`;
  if (/no space|disk full|磁盘空间/i.test(text)) return `磁盘空间不足：${text}`;
  if (/not found|cannot find|找不到/i.test(text)) return `缺少文件或运行依赖：${text}`;
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

function validateTaskPayload(payload, tool) {
  const inputs = Array.isArray(payload.inputs) ? payload.inputs : [];
  const limits = tool.limits && typeof tool.limits === 'object' ? tool.limits : {};
  const minInputs = Number(limits.minInputs);
  const maxInputs = Number(limits.maxInputs);
  if (Number.isFinite(minInputs) && inputs.length < minInputs) {
    return { ok: false, error: `此工具至少需要 ${minInputs} 个输入，当前为 ${inputs.length} 个。` };
  }
  if (Number.isFinite(maxInputs) && inputs.length > maxInputs) {
    return { ok: false, error: `输入数量 ${inputs.length} 超过此工具上限 ${maxInputs}，请拆分批次。` };
  }
  if (!path.isAbsolute(payload.outputDir)) return { ok: false, error: '输出目录必须是绝对路径。' };
  const normalizedOutput = path.resolve(payload.outputDir).toLowerCase();
  const metadataByPath = new Map((Array.isArray(payload.inputMetadata) ? payload.inputMetadata : []).map(item => [
    typeof item.path === 'string' ? path.resolve(item.path).toLowerCase() : '', item
  ]));
  const seen = new Set();
  for (const inputPath of inputs) {
    if (typeof inputPath !== 'string' || !path.isAbsolute(inputPath)) return { ok: false, error: '所有输入都必须是有效的绝对路径。' };
    const normalizedInput = path.resolve(inputPath).toLowerCase();
    if (seen.has(normalizedInput)) return { ok: false, error: `发现重复输入：${path.basename(inputPath)}。` };
    seen.add(normalizedInput);
    let stat;
    try { stat = fs.statSync(inputPath); } catch (_) { return { ok: false, error: `输入不存在或无法读取：${inputPath}` }; }
    const maxInputBytes = Number(limits.maxInputBytes);
    if (stat.isFile() && Number.isFinite(maxInputBytes) && stat.size > maxInputBytes) {
      return { ok: false, error: `${path.basename(inputPath)} 为 ${stat.size} 字节，超过此工具单文件上限 ${maxInputBytes} 字节。` };
    }
    const metadata = metadataByPath.get(normalizedInput);
    const maxPixels = Number(limits.maxPixelsPerImage);
    const maxWidth = Number(limits.maxWidth);
    const maxHeight = Number(limits.maxHeight);
    const width = Number(metadata && metadata.dimensions && metadata.dimensions.width);
    const height = Number(metadata && metadata.dimensions && metadata.dimensions.height);
    if (Number.isFinite(maxPixels) && Number.isFinite(width) && Number.isFinite(height) && width * height > maxPixels) {
      return { ok: false, error: `${path.basename(inputPath)} 为 ${width}×${height}，超过此工具像素上限 ${maxPixels}。` };
    }
    if ((Number.isFinite(maxWidth) && width > maxWidth) || (Number.isFinite(maxHeight) && height > maxHeight)) {
      return { ok: false, error: `${path.basename(inputPath)} 为 ${width}×${height}，超过此工具尺寸上限 ${maxWidth || '不限'}×${maxHeight || '不限'}。` };
    }
    const officeCount = Number(metadata && metadata.office && metadata.office.count);
    const officeMediaCount = Number(metadata && metadata.office && metadata.office.mediaCount);
    const officeMaxMediaBytes = Number(metadata && metadata.office && metadata.office.maxMediaBytes);
    const mediaDuration = Number(metadata && metadata.media && metadata.media.durationSeconds);
    const mediaWidth = Number(metadata && metadata.media && metadata.media.width);
    const mediaHeight = Number(metadata && metadata.media && metadata.media.height);
    const maxMediaDuration = Number(limits.maxDurationSeconds);
    const maxSheets = Number(limits.maxSheets);
    const maxSlides = Number(limits.maxSlides);
    const maxEmbeddedMedia = Number(limits.maxEmbeddedMedia);
    const maxEmbeddedMediaBytes = Number(limits.maxEmbeddedMediaBytes);
    if (Number.isFinite(maxSheets) && Number.isFinite(officeCount) && officeCount > maxSheets) {
      return { ok: false, error: `${path.basename(inputPath)} 含 ${officeCount} 个工作表，超过上限 ${maxSheets}。` };
    }
    if (Number.isFinite(maxSlides) && Number.isFinite(officeCount) && officeCount > maxSlides) {
      return { ok: false, error: `${path.basename(inputPath)} 含 ${officeCount} 张幻灯片，超过上限 ${maxSlides}。` };
    }
    if (Number.isFinite(maxEmbeddedMedia) && Number.isFinite(officeMediaCount) && officeMediaCount > maxEmbeddedMedia) {
      return { ok: false, error: `${path.basename(inputPath)} 含 ${officeMediaCount} 个嵌入媒体，超过上限 ${maxEmbeddedMedia}。` };
    }
    if (Number.isFinite(maxEmbeddedMediaBytes) && Number.isFinite(officeMaxMediaBytes) && officeMaxMediaBytes > maxEmbeddedMediaBytes) {
      return { ok: false, error: `${path.basename(inputPath)} 的单个嵌入媒体为 ${officeMaxMediaBytes} 字节，超过上限 ${maxEmbeddedMediaBytes} 字节。` };
    }
    if (Number.isFinite(maxMediaDuration) && Number.isFinite(mediaDuration) && mediaDuration > maxMediaDuration) {
      return { ok: false, error: `${path.basename(inputPath)} 时长为 ${mediaDuration.toFixed(2)} 秒，超过上限 ${maxMediaDuration} 秒。` };
    }
    if ((Number.isFinite(maxWidth) && Number.isFinite(mediaWidth) && mediaWidth > maxWidth) ||
        (Number.isFinite(maxHeight) && Number.isFinite(mediaHeight) && mediaHeight > maxHeight)) {
      return { ok: false, error: `${path.basename(inputPath)} 画面为 ${mediaWidth}×${mediaHeight}，超过此工具尺寸上限 ${maxWidth || '不限'}×${maxHeight || '不限'}。` };
    }
    if (stat.isDirectory() && (normalizedOutput === normalizedInput || normalizedOutput.startsWith(`${normalizedInput}${path.sep}`))) {
      return { ok: false, error: '输出目录不能等于输入文件夹或位于其内部，请选择独立目录。' };
    }
  }
  return { ok: true };
}

module.exports = { TaskManager, TERMINAL_STATES, normalizeError, validateTaskPayload };
