const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { sourceManifest, writeJson } = require('./acceptance-lib');

const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolplus-aggregate-'));
const acceptance = path.join(fixtureRoot, 'work', 'acceptance-9.9.9');
const backendEvidence = path.join(acceptance, 'backend-devil');

try {
  makeFixture();
  const identity = sourceManifest(fixtureRoot);
  const record = {
    tool: 'fixture-tool',
    result: 'PASS',
    oracleComplete: true,
    execution: { peakRssBytes: 10 * 1024 * 1024 }
  };
  const common = {
    version: '9.9.9',
    sourceFingerprint: identity.sourceFingerprint,
    backendSha256: identity.backendSha256,
    engineSha256: identity.engineSha256,
    pythonBridgeSha256: identity.pythonBridgeSha256,
    pdfPageNumbersHelperSha256: identity.pdfPageNumbersHelperSha256
  };
  for (const [name, level] of [
    ['L0_REPORT.json', 'L0'], ['L1_REPORT.json', 'L1'], ['L2_REPORT.json', 'L2'],
    ['L3_TEXT_FINAL_REPORT.json', 'L3'], ['L4_REPORT.json', 'L4'], ['L5_REPORT.json', 'L5']
  ]) {
    const current = { ...record };
    if (level === 'L4') current.scenarios = ['malformed', 'read-only', 'disk-full', 'dependency-kill', 'cancel', 'concurrent-conflict', 'temp-failure'];
    if (level === 'L5') Object.assign(current, { durationHours: 24, taskCount: 500, residualProcesses: 0, residualLocks: 0, residualTempFiles: 0, baselineRssBytes: 500 * 1024 * 1024, memoryGrowthBytes: 10 * 1024 * 1024 });
    writeJson(path.join(backendEvidence, name), { ...common, level, records: [current] });
  }
  for (const name of ['L3_FILE_REPORT.json', 'L3_IMAGE_REPORT.json', 'L3_SVG_REPORT.json', 'L3_OFFICE_REPORT.json', 'L3_PDF_REPORT.json', 'L3_MEDIA_REPORT.json', 'L3_WEB_REPORT.json']) {
    writeJson(path.join(backendEvidence, name), { ...common, level: 'L3', records: [] });
  }
  writeUiEvidence(identity);
  let result = runAggregate();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  let report = JSON.parse(fs.readFileSync(path.join(backendEvidence, 'DEVIL_REPORT_V2.json'), 'utf8'));
  assert.equal(report.decision, 'ACCEPTED');
  assert.equal(report.summary.passedCases, 6);

  const l0 = JSON.parse(fs.readFileSync(path.join(backendEvidence, 'L0_REPORT.json'), 'utf8'));
  l0.records[0].execution.peakRssBytes = 101 * 1024 * 1024;
  writeJson(path.join(backendEvidence, 'L0_REPORT.json'), l0);
  result = runAggregate();
  assert.notEqual(result.status, 0);
  report = JSON.parse(fs.readFileSync(path.join(backendEvidence, 'DEVIL_REPORT_V2.json'), 'utf8'));
  assert.equal(report.decision, 'NOT_ACCEPTED');
  assert.match(report.cases.find(item => item.id === 'fixture-tool:L0').problems.join(' '), /peak RSS/);

  l0.records[0].execution.peakRssBytes = 10 * 1024 * 1024;
  writeJson(path.join(backendEvidence, 'L0_REPORT.json'), l0);
  writeJson(path.join(fixtureRoot, 'verify', 'devil', 'acceptance-waivers.json'), {
    schemaVersion: 1, approvedBy: 'fixture owner', approvedAt: '2026-07-14T00:00:00Z',
    waivedLevels: ['L4', 'L5'], waivedGates: ['usability'], reason: 'fixture waiver'
  });
  fs.rmSync(path.join(acceptance, 'usability'), { recursive: true, force: true });
  const waivedIdentity = sourceManifest(fixtureRoot);
  for (const name of fs.readdirSync(backendEvidence).filter(name => /^L[0-5].*_REPORT\.json$/.test(name))) {
    const evidence = JSON.parse(fs.readFileSync(path.join(backendEvidence, name), 'utf8'));
    evidence.sourceFingerprint = waivedIdentity.sourceFingerprint;
    evidence.backendSha256 = waivedIdentity.backendSha256;
    evidence.engineSha256 = waivedIdentity.engineSha256;
    evidence.pythonBridgeSha256 = waivedIdentity.pythonBridgeSha256;
    evidence.pdfPageNumbersHelperSha256 = waivedIdentity.pdfPageNumbersHelperSha256;
    writeJson(path.join(backendEvidence, name), evidence);
  }
  const installer = JSON.parse(fs.readFileSync(path.join(acceptance, 'installer', 'FINAL_INSTALL_REPORT.json'), 'utf8'));
  installer.sourceFingerprint = waivedIdentity.sourceFingerprint;
  writeJson(path.join(acceptance, 'installer', 'FINAL_INSTALL_REPORT.json'), installer);
  result = runAggregate();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  report = JSON.parse(fs.readFileSync(path.join(backendEvidence, 'DEVIL_REPORT_V2.json'), 'utf8'));
  assert.equal(report.summary.mandatoryCases, 4);
  assert.equal(report.summary.passedCases, 4);
  assert.equal(report.summary.waivedCases, 2);
  assert.equal(report.summary.usabilityGate, 'WAIVED');

  const uiManifestPath = path.join(acceptance, 'ui-prototype', 'FINAL_CAPTURE_MANIFEST.json');
  const uiManifest = JSON.parse(fs.readFileSync(uiManifestPath, 'utf8'));
  uiManifest.scaleIsOsSetting = false;
  uiManifest.competitorStateMatrixComplete = false;
  writeJson(uiManifestPath, uiManifest);
  result = runAggregate();
  assert.notEqual(result.status, 0);
  report = JSON.parse(fs.readFileSync(path.join(backendEvidence, 'DEVIL_REPORT_V2.json'), 'utf8'));
  assert(report.ui.problems.some(problem => problem.includes('Windows OS display scale')));
  assert(report.ui.problems.some(problem => problem.includes('competitor state matrix')));
  console.log('PASS aggregate-report strict mode, budget breach, and explicit WAIVED semantics');
} finally {
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
}

function makeFixture() {
  for (const relative of ['backend', 'electron', 'frontend', 'python_bridge', 'python_pdf_helper', 'scripts', 'verify', 'docs', 'bin', 'build']) fs.mkdirSync(path.join(fixtureRoot, relative), { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  fs.writeFileSync(path.join(fixtureRoot, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(fixtureRoot, 'go.mod'), 'module fixture\n');
  fs.writeFileSync(path.join(fixtureRoot, 'go.sum'), '');
  fs.writeFileSync(path.join(fixtureRoot, 'bin', 'toolplus-backend.exe'), 'backend');
  fs.writeFileSync(path.join(fixtureRoot, 'bin', 'toolplus-engine.exe'), 'engine');
  fs.writeFileSync(path.join(fixtureRoot, 'bin', 'python-bridge.exe'), 'bridge');
  fs.writeFileSync(path.join(fixtureRoot, 'bin', 'pdf-page-numbers-helper.exe'), 'pdf-helper');
  writeJson(path.join(fixtureRoot, 'backend', 'tool_catalog.json'), [{
    key: 'fixture-tool', category: '文本工具', maturity: 'stable',
    performanceBudget: { peakRssMB: 100 }
  }]);
  writeJson(path.join(backendEvidence, 'manifest.json'), { productVersion: '9.9.9', tools: [] });
}

function writeUiEvidence(identity) {
  for (const relative of ['ui-research/original', 'ui-research/annotated', 'ui-prototype/comparison']) {
    const directory = path.join(acceptance, relative);
    fs.mkdirSync(directory, { recursive: true });
    for (let index = 0; index < 36; index += 1) fs.writeFileSync(path.join(directory, `${index}.png`), 'png');
  }
  writeJson(path.join(acceptance, 'ui-prototype', 'FINAL_CAPTURE_MANIFEST.json'), {
    realBackendEvidence: true,
    viewports: ['1200x760', '1366x768', '1920x1080'],
    windowsScalePercent: [100, 125],
    scaleIsOsSetting: true,
    competitorStateMatrixComplete: true
  });
  writeJson(path.join(acceptance, 'usability', 'sessions.json'), {
    sessions: Array.from({ length: 5 }, (_, index) => ({ id: index + 1, humanAttestation: true, completed: true }))
  });
  writeJson(path.join(acceptance, 'installer', 'FINAL_INSTALL_REPORT.json'), {
    version: '9.9.9', sourceFingerprint: identity.sourceFingerprint, installerSha256: 'fixture',
    cleanVmInstall: true, offlineRun: true, upgrade: true, uninstall: true,
    residualCheck: true, lowSpecPhysicalMachine: true
  });
}

function runAggregate() {
  return spawnSync(process.execPath, [path.join(__dirname, 'aggregate-report.js'), acceptance], {
    env: { ...process.env, TOOLPLUS_ROOT: fixtureRoot }, encoding: 'utf8'
  });
}
