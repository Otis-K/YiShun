const fs = require('node:fs');
const path = require('node:path');
const { readJson, sourceManifest, writeJson } = require('./acceptance-lib');

const root = path.resolve(process.env.TOOLPLUS_ROOT || path.resolve(__dirname, '..', '..'));
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const acceptanceRoot = path.resolve(process.argv[2] || path.join(root, 'work', `acceptance-${version}`));
const backendRoot = path.join(acceptanceRoot, 'backend-devil');
const current = sourceManifest(root);
const catalog = readJson(path.join(root, 'backend', 'tool_catalog.json'));
const manifestPath = path.join(backendRoot, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
const waiverFile = path.join(root, 'verify', 'devil', 'acceptance-waivers.json');
const waiver = fs.existsSync(waiverFile) ? readJson(waiverFile) : { waivedLevels: [], waivedGates: [] };
const waivedLevels = new Set(waiver.waivedLevels || []);
const waivedGates = new Set(waiver.waivedGates || []);
for (const level of waivedLevels) {
  if (!['L4', 'L5'].includes(level)) throw new Error(`unsupported waived level: ${level}`);
}
for (const gate of waivedGates) {
  if (gate !== 'usability') throw new Error(`unsupported waived gate: ${gate}`);
}

const requiredL3Reports = [
  'L3_TEXT_FINAL_REPORT.json',
  'L3_FILE_REPORT.json',
  'L3_IMAGE_REPORT.json',
  'L3_SVG_REPORT.json',
  'L3_OFFICE_REPORT.json',
  'L3_PDF_REPORT.json',
  'L3_MEDIA_REPORT.json',
  'L3_WEB_REPORT.json'
];

const levelSources = {
  L0: ['L0_REPORT.json'],
  L1: ['L1_REPORT.json'],
  L2: ['L2_REPORT.json'],
  L3: requiredL3Reports,
  L4: ['L4_REPORT.json'],
  L5: ['L5_REPORT.json']
};

const toolMap = new Map(catalog.map(tool => [tool.key, tool]));
const caseResults = [];
const reportProblems = [];
for (const [level, names] of Object.entries(levelSources)) {
  if (waivedLevels.has(level)) {
    for (const tool of catalog) caseResults.push({
      id: `${tool.key}:${level}`, tool: tool.key, category: tool.category, level,
      status: 'waived', problems: [], waiverReason: waiver.reason || 'approved scope waiver'
    });
    continue;
  }
  const records = new Map();
  for (const name of names) {
    const file = path.join(backendRoot, name);
    if (!fs.existsSync(file)) {
      reportProblems.push(`${level}: missing ${name}`);
      continue;
    }
    const report = readJson(file);
    const identityProblems = validateReportIdentity(report, current, version);
    reportProblems.push(...identityProblems.map(problem => `${name}: ${problem}`));
    for (const record of report.records || []) {
      if (records.has(record.tool)) reportProblems.push(`${level}: duplicate tool evidence ${record.tool}`);
      records.set(record.tool, { ...record, evidenceReport: name, identityProblems });
    }
  }
  for (const tool of catalog) {
    const record = records.get(tool.key);
    caseResults.push(evaluateCase(tool, level, record));
  }
}

const ui = evaluateUi(acceptanceRoot);
const usability = waivedGates.has('usability')
  ? { passed: false, satisfied: true, waived: true, sessions: 0, successRate: 0, problems: [], waiverReason: waiver.reason }
  : evaluateUsability(acceptanceRoot);
const installer = evaluateInstaller(acceptanceRoot, current, version);
const passedCases = caseResults.filter(item => item.status === 'passed').length;
const failedCases = caseResults.filter(item => item.status === 'failed').length;
const notRunCases = caseResults.filter(item => item.status === 'not-run').length;
const waivedCases = caseResults.filter(item => item.status === 'waived').length;
const activeLevels = Object.keys(levelSources).filter(level => !waivedLevels.has(level));
const mandatoryCases = catalog.length * activeLevels.length;
const releaseGate = passedCases === mandatoryCases && reportProblems.length === 0 && ui.passed && usability.satisfied && installer.passed;

const result = {
  schemaVersion: 2,
  version,
  generatedAt: new Date().toISOString(),
  source: current,
  waivers: waiver,
  summary: {
    tools: catalog.length,
    mandatoryCases,
    passedCases,
    failedCases,
    notRunCases,
    waivedCases,
    reportProblems: reportProblems.length,
    uiGate: ui.passed ? 'PASS' : 'FAIL',
    usabilityGate: usability.waived ? 'WAIVED' : (usability.passed ? 'PASS' : 'FAIL'),
    installerGate: installer.passed ? 'PASS' : 'FAIL',
    releaseGate: releaseGate ? 'PASS' : 'FAIL'
  },
  reportProblems,
  ui,
  usability,
  installer,
  cases: caseResults,
  decision: releaseGate ? 'ACCEPTED' : 'NOT_ACCEPTED'
};

writeJson(path.join(backendRoot, 'DEVIL_REPORT_V2.json'), result);
fs.writeFileSync(path.join(backendRoot, 'DEVIL_REPORT_V2.html'), renderHtml(result), 'utf8');
fs.writeFileSync(path.join(acceptanceRoot, 'FINAL_ACCEPTANCE_V2.md'), renderMarkdown(result), 'utf8');
console.log(`${result.decision} cases=${passedCases}/${result.summary.mandatoryCases} failed=${failedCases} notRun=${notRunCases} reportProblems=${reportProblems.length}`);
process.exitCode = releaseGate ? 0 : 1;

function validateReportIdentity(report, expected, expectedVersion) {
  const problems = [];
  if (report.version !== expectedVersion) problems.push(`version ${report.version || 'missing'} != ${expectedVersion}`);
  if (report.sourceFingerprint !== expected.sourceFingerprint) problems.push('source fingerprint missing or stale');
  if (report.backendSha256 !== expected.backendSha256) problems.push('backend hash missing or stale');
  if (report.engineSha256 !== expected.engineSha256) problems.push('engine hash missing or stale');
  if (report.pythonBridgeSha256 !== expected.pythonBridgeSha256) problems.push('Python bridge hash missing or stale');
  if (report.pdfPageNumbersHelperSha256 !== expected.pdfPageNumbersHelperSha256) problems.push('PDF page-number helper hash missing or stale');
  return problems;
}

function evaluateCase(tool, level, record) {
  const base = { id: `${tool.key}:${level}`, tool: tool.key, category: tool.category, level };
  if (!record) return { ...base, status: 'not-run', problems: ['missing record'] };
  const problems = [...(record.identityProblems || [])];
  if (record.result !== 'PASS') problems.push(record.error || 'record result is not PASS');
  if (record.oracleComplete !== true) problems.push('semantic oracle is not complete');
  const peak = peakRss(record);
  const budgetBytes = Number(tool.performanceBudget && tool.performanceBudget.peakRssMB) * 1024 * 1024;
  if (Number.isFinite(budgetBytes) && peak > budgetBytes) problems.push(`peak RSS ${peak} exceeds ${budgetBytes}`);
  if (level === 'L4') {
    const required = ['malformed', 'read-only', 'disk-full', 'dependency-kill', 'cancel', 'concurrent-conflict', 'temp-failure'];
    const scenarios = new Set(record.scenarios || (record.subcases || []).map(item => item.scenario || item.name));
    for (const scenario of required) if (!scenarios.has(scenario)) problems.push(`missing L4 scenario ${scenario}`);
  }
  if (level === 'L5') {
    if (Number(record.durationHours) < 24) problems.push('soak duration below 24 hours');
    if (Number(record.taskCount) < 500) problems.push('soak task count below 500');
    if (record.residualProcesses !== 0 || record.residualLocks !== 0 || record.residualTempFiles !== 0) problems.push('L5 residuals detected');
    if (Number(record.memoryGrowthBytes) > Math.min(100 * 1024 * 1024, Number(record.baselineRssBytes || 0) * 0.05)) problems.push('L5 memory growth exceeds gate');
  }
  return { ...base, status: problems.length ? 'failed' : 'passed', evidenceReport: record.evidenceReport, problems, peakRssBytes: peak };
}

function peakRss(record) {
  const values = [record.execution && record.execution.peakRssBytes, record.metrics && record.metrics.peakRssBytes];
  for (const execution of record.executions || []) values.push(execution.execution && execution.execution.peakRssBytes);
  for (const subcase of record.subcases || []) values.push(subcase.execution && subcase.execution.peakRssBytes);
  return Math.max(0, ...values.filter(Number.isFinite));
}

function evaluateUi(base) {
  const research = path.join(base, 'ui-research');
  const prototype = path.join(base, 'ui-prototype');
  const original = countPng(path.join(research, 'original'));
  const annotated = countPng(path.join(research, 'annotated'));
  const comparisons = countPng(path.join(prototype, 'comparison'));
  const manifestFile = path.join(prototype, 'FINAL_CAPTURE_MANIFEST.json');
  const manifest = fs.existsSync(manifestFile) ? readJson(manifestFile) : null;
  const problems = [];
  if (original < 36) problems.push(`competitor originals ${original}/36`);
  if (annotated < 36) problems.push(`competitor annotations ${annotated}/36`);
  if (comparisons < 36) problems.push(`comparison screenshots ${comparisons}/36`);
  if (!manifest || manifest.realBackendEvidence !== true) problems.push('final UI manifest missing real backend evidence');
  if (!manifest || !['1200x760', '1366x768', '1920x1080'].every(size => (manifest.viewports || []).includes(size))) problems.push('viewport matrix incomplete');
  if (!manifest || ![100, 125].every(dpi => (manifest.windowsScalePercent || []).includes(dpi))) problems.push('Windows scale matrix incomplete');
  if (!manifest || manifest.scaleIsOsSetting !== true) problems.push('125% evidence was not captured with the Windows OS display scale setting');
  if (!manifest || manifest.competitorStateMatrixComplete !== true) problems.push('competitor state matrix is incomplete or not state-matched');
  return { passed: problems.length === 0, original, annotated, comparisons, problems };
}

function evaluateUsability(base) {
  const file = path.join(base, 'usability', 'sessions.json');
  if (!fs.existsSync(file)) return { passed: false, sessions: 0, successRate: 0, problems: ['five human sessions missing'] };
  const evidence = readJson(file);
  const sessions = Array.isArray(evidence.sessions) ? evidence.sessions : [];
  const completed = sessions.filter(item => item.humanAttestation === true && item.completed === true).length;
  const rate = sessions.length ? completed / sessions.length : 0;
  const problems = [];
  if (sessions.length < 5) problems.push(`human sessions ${sessions.length}/5`);
  if (rate < 0.9) problems.push(`success rate ${(rate * 100).toFixed(1)}% < 90%`);
  return { passed: problems.length === 0, satisfied: problems.length === 0, sessions: sessions.length, successRate: rate, problems };
}

function evaluateInstaller(base, expected, expectedVersion) {
  const file = path.join(base, 'installer', 'FINAL_INSTALL_REPORT.json');
  if (!fs.existsSync(file)) return { passed: false, problems: ['final installer report missing'] };
  const evidence = readJson(file);
  const problems = [];
  if (evidence.version !== expectedVersion) problems.push('installer version mismatch');
  if (evidence.sourceFingerprint !== expected.sourceFingerprint) problems.push('installer source fingerprint mismatch');
  for (const flag of ['cleanVmInstall', 'offlineRun', 'upgrade', 'uninstall', 'residualCheck', 'lowSpecPhysicalMachine']) {
    if (evidence[flag] !== true) problems.push(`${flag} not passed`);
  }
  if (!evidence.installerSha256) problems.push('installer SHA-256 missing');
  return { passed: problems.length === 0, ...evidence, problems };
}

function countPng(directory) {
  if (!fs.existsSync(directory)) return 0;
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((count, entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return count + countPng(full);
    return count + (entry.name.toLowerCase().endsWith('.png') ? 1 : 0);
  }, 0);
}

function renderMarkdown(report) {
  return `# Tool Plus ${report.version} 最终魔鬼验收\n\n` +
    `结论：**${report.decision} / 发布门禁 ${report.summary.releaseGate}**\n\n` +
    `- 当前源码指纹：\`${report.source.sourceFingerprint}\`\n` +
    `- 用例：${report.summary.passedCases}/${report.summary.mandatoryCases} PASS，${report.summary.failedCases} FAIL，${report.summary.notRunCases} NOT-RUN\n` +
    `- UI：${report.summary.uiGate}\n- 真人可用性：${report.summary.usabilityGate}\n- 安装：${report.summary.installerGate}\n` +
    `- 豁免用例：${report.summary.waivedCases}（不计为 PASS）\n` +
    `- 报告一致性问题：${report.summary.reportProblems}\n`;
}

function renderHtml(report) {
  const rows = report.cases.map(item => `<tr><td>${escape(item.id)}</td><td>${item.status}</td><td>${escape(item.problems.join('; ') || item.waiverReason || '')}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Tool Plus Devil Acceptance</title><style>body{font:14px system-ui;margin:32px;color:#1f2a24}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd6d0;padding:7px;text-align:left}.failed,.not-run{color:#a13c33}</style><h1>Tool Plus ${escape(report.version)} 魔鬼验收</h1><p><strong>${report.decision}</strong></p><p>PASS ${report.summary.passedCases}/${report.summary.mandatoryCases}</p><table><thead><tr><th>用例</th><th>状态</th><th>问题</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function escape(value) {
  return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
