const assert = require('node:assert/strict');
const { ModelTaskQueue } = require('../electron/model-task-queue');

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

(async () => {
  const queue = new ModelTaskQueue(5);
  let active = 0;
  let peak = 0;
  const gates = Array.from({ length: 6 }, deferred);
  const started = [];
  const jobs = gates.map((gate, index) => queue.submit(async () => {
    started.push(index);
    active += 1;
    peak = Math.max(peak, active);
    await gate.promise;
    active -= 1;
    return index;
  }));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3, 4], 'only five jobs may start before a slot is released');
  assert.equal(peak, 5, 'five independent jobs must actually overlap');
  gates[1].resolve();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2, 3, 4, 5], 'the sixth job must start as soon as one slot is free');
  gates[0].resolve(); gates[2].resolve(); gates[3].resolve(); gates[4].resolve(); gates[5].resolve();
  assert.deepEqual(await Promise.all(jobs), [0, 1, 2, 3, 4, 5]);

  const serial = new ModelTaskQueue(1);
  const hold = deferred();
  const first = serial.submit(() => hold.promise);
  const controller = new AbortController();
  const cancelled = serial.submit(() => Promise.resolve('should-not-run'), controller.signal);
  controller.abort();
  await assert.rejects(cancelled, error => error && error.name === 'AbortError');
  hold.resolve('done');
  assert.equal(await first, 'done');
  console.log('PASS model-task-queue peak=5 sixth-queued pending-cancel-isolated');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
