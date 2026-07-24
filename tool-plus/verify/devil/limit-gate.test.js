const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { validateTaskPayload } = require('../../electron/task-manager');

const root = path.resolve(__dirname, '..', '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tool_catalog.json'), 'utf8'));
const acceptance = path.join(root, 'work', 'acceptance-0.5.0', 'backend-devil');
const sample = path.join(root, 'work', 'verify', 'samples', 'plain.txt');
const oversizedSample = path.join(acceptance, 'gate-oversized-input.bin');
const outputDir = path.join(acceptance, 'outputs', 'L3-gates');
fs.mkdirSync(outputDir, { recursive: true });
fs.closeSync(fs.openSync(oversizedSample, 'w'));
fs.truncateSync(oversizedSample, 1073741825);

const records = [];
for (const tool of catalog) {
  const limits = tool.limits || {};
  const checks = [];
  const maxInputs = Number(limits.maxInputs);
  if (Number.isFinite(maxInputs)) {
    const inputs = Array.from({ length: maxInputs + 1 }, (_, index) => `${sample}.${index}`);
    const result = validateTaskPayload({ inputs, outputDir }, tool);
    assert.equal(result.ok, false, `${tool.key}: maxInputs not rejected`);
    assert.match(result.error, /上限/);
    checks.push({ type: 'maxInputs+1', declared: maxInputs, submitted: maxInputs + 1, result: 'PASS', error: result.error });
  }
  const minInputs = Number(limits.minInputs);
  if (Number.isFinite(minInputs)) {
    const result = validateTaskPayload({ inputs: [sample].slice(0, Math.max(0, minInputs - 1)), outputDir }, tool);
    assert.equal(result.ok, false, `${tool.key}: minInputs not rejected`);
    checks.push({ type: 'minInputs-1', declared: minInputs, result: 'PASS', error: result.error });
  }
  const maxInputBytes = Number(limits.maxInputBytes);
  if (Number.isFinite(maxInputBytes)) {
    assert.ok(fs.statSync(oversizedSample).size > maxInputBytes, `${tool.key}: oversized fixture is not above limit`);
    const requiredCount = Number.isFinite(minInputs) ? Math.max(1, minInputs) : 1;
    const byteInputs = [oversizedSample, ...Array.from({ length: requiredCount - 1 }, (_, index) => `${sample}.${index}`)];
    const result = validateTaskPayload({ inputs: byteInputs, outputDir }, tool);
    assert.equal(result.ok, false, `${tool.key}: maxInputBytes not rejected`);
    assert.match(result.error, /单文件上限/);
    checks.push({ type: 'maxInputBytes+1-or-more', declared: maxInputBytes, submitted: fs.statSync(oversizedSample).size, result: 'PASS', error: result.error });
  }
  const maxPixels = Number(limits.maxPixelsPerImage);
  if (Number.isFinite(maxPixels)) {
    const width = Math.floor(Math.sqrt(maxPixels)) + 1;
    const height = Math.floor(maxPixels / width) + 1;
    const result = validateTaskPayload({ inputs: [sample], inputMetadata: [{ path: sample, dimensions: { width, height } }], outputDir }, tool);
    assert.equal(result.ok, false, `${tool.key}: maxPixels not rejected`);
    checks.push({ type: 'maxPixels+1', declared: maxPixels, submitted: width * height, result: 'PASS', error: result.error });
  }
  const maxDurationSeconds = Number(limits.maxDurationSeconds);
  if (Number.isFinite(maxDurationSeconds)) {
    const result = validateTaskPayload({ inputs: [sample], inputMetadata: [{ path: sample, media: { durationSeconds: maxDurationSeconds + 1 } }], outputDir }, tool);
    assert.equal(result.ok, false, `${tool.key}: maxDurationSeconds not rejected`);
    checks.push({ type: 'maxDurationSeconds+1', declared: maxDurationSeconds, submitted: maxDurationSeconds + 1, result: 'PASS', error: result.error });
  }
  const maxWidth = Number(limits.maxWidth);
  const maxHeight = Number(limits.maxHeight);
  if ((tool.category === '视频工具' || tool.category === '音频工具') && (Number.isFinite(maxWidth) || Number.isFinite(maxHeight))) {
    const width = Number.isFinite(maxWidth) ? maxWidth + 1 : 1;
    const height = Number.isFinite(maxHeight) ? maxHeight + 1 : 1;
    const result = validateTaskPayload({ inputs: [sample], inputMetadata: [{ path: sample, media: { width, height, durationSeconds: 1 } }], outputDir }, tool);
    assert.equal(result.ok, false, `${tool.key}: media dimensions not rejected`);
    checks.push({ type: 'media-dimensions+1', declared: `${maxWidth || '*'}x${maxHeight || '*'}`, submitted: `${width}x${height}`, result: 'PASS', error: result.error });
  }
  for (const [limitName, metadataName, label] of [
    ['maxSheets', 'count', 'maxSheets+1'],
    ['maxSlides', 'count', 'maxSlides+1'],
    ['maxEmbeddedMedia', 'mediaCount', 'maxEmbeddedMedia+1']
    ,['maxEmbeddedMediaBytes', 'maxMediaBytes', 'maxEmbeddedMediaBytes+1']
  ]) {
    const declared = Number(limits[limitName]);
    if (!Number.isFinite(declared)) continue;
    const office = { count: 1, mediaCount: 0, [metadataName]: declared + 1 };
    const requiredCount = Number.isFinite(minInputs) ? Math.max(1, minInputs) : 1;
    const officeInputs = [sample, ...Array.from({ length: requiredCount - 1 }, (_, index) => `${sample}.office-${index}`)];
    const result = validateTaskPayload({ inputs: officeInputs, inputMetadata: [{ path: sample, office }], outputDir }, tool);
    assert.equal(result.ok, false, `${tool.key}: ${limitName} not rejected`);
    checks.push({ type: label, declared, submitted: declared + 1, result: 'PASS', error: result.error });
  }
  records.push({
    caseId: `${tool.key}:L3-limit-gate`, tool: tool.key, level: 'L3',
    result: checks.length ? 'PASS' : 'FAIL', checks,
    actualExtremeExecution: 'PENDING'
  });
}

const report = {
  level: 'L3-input-gates', generatedAt: new Date().toISOString(), total: records.length,
  passed: records.filter(item => item.result === 'PASS').length,
  failed: records.filter(item => item.result !== 'PASS').length,
  note: 'This report proves declared input-stage rejection only. It does not claim the actual L3 extreme workload passed.',
  records
};
fs.writeFileSync(path.join(acceptance, 'L3_GATE_REPORT.json'), JSON.stringify(report, null, 2));
console.log(`L3 GATE SUMMARY ${report.passed}/${report.total} tools have enforceable declared limits`);
if (report.failed) {
  console.log('Tools without an enforceable declared gate:', records.filter(item => item.result === 'FAIL').map(item => item.tool).join(', '));
  process.exitCode = 1;
}
fs.unlinkSync(oversizedSample);
