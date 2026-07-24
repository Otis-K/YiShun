const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { sourceManifest } = require('./acceptance-lib');

const root = path.join(__dirname, '..', '..');
const version = require(path.join(root, 'package.json')).version;
const acceptanceRoot = path.resolve(process.argv[2] || path.join(root, 'work', `acceptance-${version}`));
const backendRoot = path.join(acceptanceRoot, 'backend-devil');
const source = sourceManifest(root);
for (const dir of ['logs', 'metrics', 'outputs', 'samples']) fs.mkdirSync(path.join(backendRoot, dir), { recursive: true });

const environment = {
  capturedAt: new Date().toISOString(),
  version,
  platform: process.platform,
  release: os.release(),
  arch: os.arch(),
  cpu: os.cpus()[0] && os.cpus()[0].model,
  logicalCpuCount: os.cpus().length,
  totalMemoryBytes: os.totalmem(),
  freeMemoryBytes: os.freemem(),
  node: process.version,
  sourceFingerprint: source.sourceFingerprint,
  sourceFileCount: source.sourceFileCount,
  backendSha256: source.backendSha256,
  engineSha256: source.engineSha256,
  pythonBridgeSha256: source.pythonBridgeSha256,
  pdfPageNumbersHelperSha256: source.pdfPageNumbersHelperSha256
};
fs.writeFileSync(path.join(acceptanceRoot, 'environment.json'), `${JSON.stringify(environment, null, 2)}\n`);

run('manifest', process.execPath, [path.join(__dirname, 'generate-manifest.js'), path.join(backendRoot, 'manifest.json')]);
run('samples', process.execPath, [path.join(__dirname, 'generate-samples.js'), path.join(backendRoot, 'samples')]);
const checks = [
  run('source-regression', 'powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'verify.ps1')]),
  run('task-governance', process.execPath, [path.join(__dirname, 'task-manager.test.js')]),
  run('real-task-integration', process.execPath, [path.join(__dirname, 'real-task-integration.test.js')]),
  run('immersive-ui-contract', process.execPath, [path.join(root, 'scripts', 'verify-immersive-ui.js')]),
  run('category-workspace-ui', path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), [path.join(root, 'verify', 'category-workspace-ui.js')]),
  run('frontend-catalog', path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), [path.join(root, 'scripts', 'verify-frontend-catalog.js')], { ELECTRON_RUN_AS_NODE: '1' }),
  run('semantic-oracles-selftest', process.env.TOOLPLUS_PYTHON || 'python', ['-B', path.join(__dirname, 'semantic_oracles_test.py')]),
  run('report-identity-selftest', process.env.TOOLPLUS_PYTHON || 'python', ['-B', path.join(__dirname, 'report_identity_test.py')]),
  run('aggregate-selftest', process.execPath, [path.join(__dirname, 'aggregate-report.test.js')])
  ,run('packaged-artifact', process.execPath, [path.join(__dirname, 'verify-package.js')])
];

const uiCaptureRoot = path.join(acceptanceRoot, 'ui-prototype');
const uiScreenshotCount = walk(uiCaptureRoot).filter(file => file.toLowerCase().endsWith('.png')).length;
const uiManifestExists = fs.existsSync(path.join(uiCaptureRoot, 'CAPTURE_MANIFEST.json'));
checks.push({
  id: 'ui-prototype-evidence',
  passed: uiManifestExists && uiScreenshotCount >= 38,
  durationMs: 0,
  exitCode: uiManifestExists && uiScreenshotCount >= 38 ? 0 : 1,
  output: `${uiScreenshotCount} screenshots; manifest=${uiManifestExists}`
});

const manifest = JSON.parse(fs.readFileSync(path.join(backendRoot, 'manifest.json'), 'utf8'));
const metadataComplete = manifest.tools.length === 114 && manifest.tools.every(tool =>
  tool.maturity && tool.timeoutSeconds > 0 && tool.uiReferenceId && tool.cases.length === 6
);
checks.unshift({ id: 'catalog-metadata', passed: metadataComplete, durationMs: 0, exitCode: metadataComplete ? 0 : 1, output: `${manifest.tools.length} tools` });

const report = {
  schemaVersion: 1,
  version,
  generatedAt: new Date().toISOString(),
  sourceFingerprint: environment.sourceFingerprint,
  summary: {
    executedChecks: checks.length,
    passedChecks: checks.filter(check => check.passed).length,
    failedChecks: checks.filter(check => !check.passed).length,
    manifestCases: manifest.tools.reduce((sum, tool) => sum + tool.cases.length, 0),
    passedManifestCases: 0,
    releaseGate: 'FAIL'
  },
  checks,
  unexecutedMandatoryGates: [
    '114 tools L0-L3 structured-oracle execution',
    'six-category competitor original and annotated screenshots',
    'clean Windows VM install, upgrade and uninstall',
    '100% and 125% DPI screenshot matrix'
  ],
  waivedGates: [
    'L4 destructive testing — project owner approved waiver',
    'L5 soak/start-exit testing — project owner approved waiver',
    'five first-time human usability sessions — project owner approved waiver'
  ],
  decision: 'NOT_ACCEPTED'
};
fs.writeFileSync(path.join(backendRoot, 'DEVIL_REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(backendRoot, 'DEVIL_REPORT.html'), renderHtml(report), 'utf8');
fs.writeFileSync(path.join(acceptanceRoot, 'FINAL_ACCEPTANCE.md'), renderFinalAcceptance(report), 'utf8');
console.log(`${report.summary.failedChecks ? 'FAIL' : 'PASS'} acceptance-evidence ${checks.filter(item => item.passed).length}/${checks.length}; release gate remains FAIL because mandatory cases are not-run`);
process.exitCode = report.summary.failedChecks ? 1 : 0;

function run(id, command, args, extraEnv = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...extraEnv }, encoding: 'utf8', timeout: 120000 });
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
  fs.writeFileSync(path.join(backendRoot, 'logs', `${id}.log`), `${output}\n`, 'utf8');
  return { id, passed: result.status === 0, durationMs: Date.now() - started, exitCode: result.status, signal: result.signal, output };
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function renderHtml(report) {
  const rows = report.checks.map(check => `<tr><td>${escapeHtml(check.id)}</td><td>${check.passed ? 'PASS' : 'FAIL'}</td><td>${check.durationMs}</td><td><pre>${escapeHtml(check.output)}</pre></td></tr>`).join('');
  const pending = report.unexecutedMandatoryGates.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Tool Plus Devil Report</title><style>body{font:14px system-ui;margin:32px;color:#18342a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd9d2;padding:8px;text-align:left;vertical-align:top}pre{white-space:pre-wrap;margin:0}.fail{color:#a33}</style><h1>Tool Plus ${escapeHtml(report.version)} 魔鬼验收证据</h1><p class="fail"><strong>发布门禁：FAIL / NOT_ACCEPTED</strong></p><table><thead><tr><th>检查</th><th>结果</th><th>耗时 ms</th><th>证据</th></tr></thead><tbody>${rows}</tbody></table><h2>尚未执行的强制门禁</h2><ul>${pending}</ul>`;
}

function renderFinalAcceptance(report) {
  const checks = report.checks.map(check => `- ${check.passed ? '[x]' : '[ ]'} ${check.id}: ${check.passed ? 'PASS' : 'FAIL'} (${check.durationMs} ms)`).join('\n');
  const pending = report.unexecutedMandatoryGates.map(item => `- [ ] ${item}`).join('\n');
  return `# Tool Plus ${report.version} 最终验收\n\n结论：**NOT ACCEPTED / 发布门禁 FAIL**。\n\n本文件只汇总本次实际执行证据。未运行的强制项保持未通过，不能由历史报告或原型截图替代。\n\n## 已执行\n\n${checks}\n\n## 未执行的强制门禁\n\n${pending}\n\n## 证据入口\n\n- 环境与源码指纹：environment.json\n- 魔鬼矩阵：backend-devil/manifest.json\n- JSON/HTML 报告：backend-devil/DEVIL_REPORT.json、backend-devil/DEVIL_REPORT.html\n- 六类本项目原型：ui-prototype/\n- 竞品来源与决策：ui-research/sources.md、ui-research/decision-ledger.md\n`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
