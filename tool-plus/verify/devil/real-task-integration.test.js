const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { TaskManager } = require('../../electron/task-manager');

const root = path.join(__dirname, '..', '..');
const outputRoot = path.join(root, 'work', 'acceptance-0.5.0', 'backend-devil', 'outputs', 'real-task');
fs.mkdirSync(outputRoot, { recursive: true });
const manager = new TaskManager({ command: path.join(root, 'bin', 'toolplus-backend.exe'), cwd: root, maxConcurrent: 2 });

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

async function terminal(id, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const task = manager.snapshot(id);
    if (task && ['succeeded', 'failed', 'cancelled', 'timed_out'].includes(task.state)) return task;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`task ${id} did not finish`);
}

(async () => {
  const input = path.join(root, 'work', 'verify', 'samples', 'note.md');
  const before = sha256(input);
  const success = manager.submit({ tool: 'markdown-to-txt', inputs: [input], outputDir: outputRoot, options: {} }, 30);
  const completed = await terminal(success.id);
  assert.equal(completed.state, 'succeeded', completed.error);
  assert.ok(completed.outputs.length > 0);
  assert.ok(fs.existsSync(completed.outputs[0]));
  assert.equal(sha256(input), before, 'source hash changed');
  const converted = fs.readFileSync(completed.outputs[0], 'utf8');
  assert.match(converted, /Title/);
  assert.match(converted, /Hello/);
  assert.match(converted, /World/);

  const malformed = path.join(root, 'work', 'acceptance-0.5.0', 'backend-devil', 'samples', 'malformed', 'fake.pdf');
  const malformedBefore = sha256(malformed);
  const failure = manager.submit({ tool: 'pdf-to-txt', inputs: [malformed], outputDir: outputRoot, options: {} }, 30);
  const rejected = await terminal(failure.id);
  assert.equal(rejected.state, 'failed', 'malformed PDF was reported as success');
  assert.equal(sha256(malformed), malformedBefore, 'malformed source changed');
  assert.equal(manager.running.size, 0);
  console.log(`PASS real-task integration output=${completed.outputs[0]} malformed=${rejected.state}`);
  process.exit(0);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
