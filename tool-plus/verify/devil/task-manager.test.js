const assert = require('node:assert/strict');
const path = require('node:path');
const { TaskManager, validateTaskPayload } = require('../../electron/task-manager');

const manager = new TaskManager({
  command: process.execPath,
  commandArgs: [path.join(__dirname, 'fixtures', 'fake-backend.js')],
  cwd: path.join(__dirname, '..', '..'),
  maxConcurrent: 1,
  killGraceMs: 500
});

async function waitFor(id, state, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = manager.snapshot(id);
    if (task && task.state === state) return task;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timeout waiting for ${id} => ${state}`);
}

(async () => {
  console.log('TEST task-manager: input boundary validation');
  const fixture = path.join(__dirname, 'fixtures', 'fake-backend.js');
  const tool = { limits: { maxInputs: 1, maxInputBytes: 1024 * 1024 } };
  assert.equal(validateTaskPayload({ inputs: [fixture], outputDir: path.join(__dirname, 'outputs') }, tool).ok, true);
  assert.match(validateTaskPayload({ inputs: [fixture], outputDir: path.join(__dirname, 'outputs') }, { limits: { minInputs: 2 } }).error, /至少需要 2/);
  assert.match(validateTaskPayload({ inputs: [fixture], inputMetadata: [{ path: fixture, dimensions: { width: 100, height: 100 } }], outputDir: path.join(__dirname, 'outputs') }, { limits: { maxPixelsPerImage: 9999 } }).error, /像素上限/);
  assert.match(validateTaskPayload({ inputs: [fixture, fixture], outputDir: path.join(__dirname, 'outputs') }, tool).error, /上限/);
  assert.match(validateTaskPayload({ inputs: [path.join(__dirname, 'missing')], outputDir: path.join(__dirname, 'outputs') }, tool).error, /不存在/);
  assert.match(validateTaskPayload({ inputs: [path.join(__dirname, 'fixtures')], outputDir: path.join(__dirname, 'fixtures', 'nested') }, tool).error, /不能等于|内部/);
  console.log('TEST task-manager: success');
  const success = manager.submit({ inputs: ['one', 'two'], outputDir: 'C:\\tmp', options: { delayMs: '30' } }, 2);
  assert.equal(success.totalItems, 2);
  assert.equal(success.progressAvailable, false);
  assert.equal(success.percent, null);
  const completed = await waitFor(success.id, 'succeeded');
  assert.equal(completed.outputs.length, 1);
  assert.equal(completed.completedItems, 2);
  assert.equal(completed.percent, 100);
  assert.equal(completed.progressAvailable, true);

  console.log('TEST task-manager: per-input partial failure and truthful progress');
  const partial = manager.submit({
    inputs: ['C:\\samples\\good.txt', 'C:\\samples\\bad.txt', 'C:\\samples\\last.txt'],
    outputDir: 'C:\\tmp',
    options: { delayMs: '30', failInput: 'bad.txt' }
  }, 2, 'per-input');
  assert.equal(partial.progressAvailable, true);
  assert.equal(partial.percent, 0);
  const partialResult = await waitFor(partial.id, 'partial_failed');
  assert.equal(partialResult.completedItems, 3);
  assert.equal(partialResult.percent, 100);
  assert.deepEqual(partialResult.failedInputs, ['C:\\samples\\bad.txt']);
  assert.equal(partialResult.outputs.length, 2);
  assert.equal(partialResult.itemResults.filter(item => item.state === 'failed').length, 1);

  console.log('TEST task-manager: failure');
  const failure = manager.submit({ outputDir: 'C:\\tmp', options: { fail: 'true' } }, 2);
  assert.match((await waitFor(failure.id, 'failed')).error, /fixture failure/);

  console.log('TEST task-manager: running cancellation');
  const running = manager.submit({ outputDir: 'C:\\tmp', options: { delayMs: '5000' } }, 10);
  await waitFor(running.id, 'running');
  await manager.cancel(running.id);
  const cancelled = await waitFor(running.id, 'cancelled');
  assert.ok(cancelled.cancellationLatencyMs < 2000, `cancel latency ${cancelled.cancellationLatencyMs}ms`);

  console.log('TEST task-manager: queued cancellation');
  const blocker = manager.submit({ outputDir: 'C:\\tmp', options: { delayMs: '300' } }, 2);
  const queued = manager.submit({ outputDir: 'C:\\tmp', options: { delayMs: '20' } }, 2);
  assert.equal(manager.snapshot(queued.id).state, 'queued');
  await manager.cancel(queued.id);
  assert.equal(manager.snapshot(queued.id).state, 'cancelled');
  await waitFor(blocker.id, 'succeeded');
  assert.equal(manager.running.size, 0);
  assert.equal(manager.queue.length, 0);

  console.log('TEST task-manager: 1000 rapid submissions stay bounded');
  const burst = Array.from({ length: 1000 }, () => manager.submit({ outputDir: 'C:\\tmp', options: { delayMs: '5000' } }, 10));
  assert.equal(manager.running.size, 1);
  assert.equal(manager.queue.length, 999);
  await Promise.all(burst.map(task => manager.cancel(task.id)));
  await waitFor(burst[0].id, 'cancelled');
  assert.equal(manager.running.size, 0);
  assert.equal(manager.queue.length, 0);

  console.log('PASS task-manager success failure queue cancel process-tree latency');
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
