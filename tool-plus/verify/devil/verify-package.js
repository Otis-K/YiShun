const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const asar = require('@electron/asar');

const root = path.join(__dirname, '..', '..');
const unpacked = path.join(root, 'release', 'win-unpacked');
const resources = path.join(unpacked, 'resources');
const archive = path.join(resources, 'app.asar');
const installer = path.join(root, 'release', '文档批量处理工具 Setup 0.5.0.exe');
const packagedBinaries = [
  'toolplus-backend.exe', 'toolplus-engine.exe', 'python-bridge.exe', 'pdf-page-numbers-helper.exe'
];
for (const required of [archive, installer, ...packagedBinaries.map(name => path.join(resources, 'bin', name))]) {
  if (!fs.existsSync(required)) throw new Error(`missing packaged resource: ${required}`);
}
for (const name of packagedBinaries) {
  const source = path.join(root, 'bin', name);
  const packaged = path.join(resources, 'bin', name);
  if (sha256(source) !== sha256(packaged)) throw new Error(`stale packaged binary: ${name}`);
}

const files = asar.listPackage(archive).map(file => file.split(path.win32.sep).join('/'));
for (const required of ['/electron/task-manager.js', '/frontend/index.html', '/frontend/renderer.js']) {
  if (!files.includes(required)) throw new Error(`app.asar missing ${required}`);
}
const forbidden = files.filter(file => /(^|\/)(work|stress|acceptance-|devil-samples)(\/|$)/i.test(file));
if (forbidden.length) throw new Error(`test artifacts leaked into app.asar: ${forbidden.join(', ')}`);

const backend = path.join(resources, 'bin', 'toolplus-backend.exe');
const catalogRun = spawnSync(backend, ['catalog'], { cwd: resources, encoding: 'utf8', timeout: 30000 });
if (catalogRun.status !== 0) throw new Error(catalogRun.stderr || 'packaged catalog failed');
const catalog = JSON.parse(catalogRun.stdout);
if (!catalog.ok || catalog.tools.length !== 114) throw new Error(`packaged catalog count ${catalog.tools && catalog.tools.length}`);
if (!catalog.tools.every(tool => tool.maturity && tool.timeoutSeconds > 0 && tool.acceptanceCaseIds.length === 6)) throw new Error('packaged metadata incomplete');

const outputDir = path.join(root, 'work', 'acceptance-0.5.0', 'installer', 'clean-install', 'packaged-backend-output');
fs.mkdirSync(outputDir, { recursive: true });
const input = path.join(root, 'work', 'verify', 'samples', 'note.md');
const run = spawnSync(backend, ['run'], {
  cwd: resources,
  input: JSON.stringify({ tool: 'markdown-to-txt', inputs: [input], outputDir, options: {} }),
  encoding: 'utf8',
  timeout: 30000
});
const response = JSON.parse(run.stdout || '{}');
if (!response.ok || !response.outputs.length || !fs.existsSync(response.outputs[0])) throw new Error(response.error || 'packaged task failed');
if (!/Title[\s\S]*Hello[\s\S]*World/.test(fs.readFileSync(response.outputs[0], 'utf8'))) throw new Error('packaged task oracle failed');

const pdfOutputDir = path.join(root, 'work', 'acceptance-0.5.0', 'installer', 'clean-install', 'packaged-pdf-output');
fs.mkdirSync(pdfOutputDir, { recursive: true });
const pdfRun = spawnSync(backend, ['run'], {
  cwd: resources,
  input: JSON.stringify({
    tool: 'pdf-page-numbers', inputs: [path.join(root, 'work', 'verify', 'samples', 'sample.pdf')],
    outputDir: pdfOutputDir,
    options: { format: '第 %p 页 / 共 %P 页', position: '底部居中', fontSize: '10', start: '1' }
  }),
  encoding: 'utf8',
  timeout: 60000
});
const pdfResponse = JSON.parse(pdfRun.stdout || '{}');
if (pdfRun.status !== 0 || !pdfResponse.ok || !pdfResponse.outputs.length || !fs.existsSync(pdfResponse.outputs[0])) {
  throw new Error(pdfResponse.error || pdfRun.stderr || 'packaged PDF page-number task failed');
}
const localValidatorPython = path.join(root, '.tools', 'pdf-helper-venv', 'Scripts', 'python.exe');
const validatorPython = process.env.TOOLPLUS_PYTHON || (fs.existsSync(localValidatorPython) ? localValidatorPython : 'python');
const helperRegression = spawnSync(
  validatorPython,
  [path.join(root, 'python_pdf_helper', 'regression_test.py'), '--helper', path.join(resources, 'bin', 'pdf-page-numbers-helper.exe')],
  { cwd: root, encoding: 'utf8', timeout: 120000 }
);
if (helperRegression.status !== 0) throw new Error(helperRegression.stdout + helperRegression.stderr || 'packaged PDF helper regression failed');

const info = {
  generatedAt: new Date().toISOString(),
  installer,
  bytes: fs.statSync(installer).size,
  sha256: sha256(installer),
  asarFiles: files.length,
  catalogTools: catalog.tools.length,
  packagedOutput: response.outputs[0],
  packagedPdfOutput: pdfResponse.outputs[0],
  packagedBinarySha256: Object.fromEntries(packagedBinaries.map(name => [name, sha256(path.join(resources, 'bin', name))])),
  cleanVmInstallExecuted: false
};
const evidence = path.join(root, 'work', 'acceptance-0.5.0', 'installer', 'build.json');
fs.writeFileSync(evidence, `${JSON.stringify(info, null, 2)}\n`);
console.log(`PASS package installer=${info.bytes} sha256=${info.sha256} catalog=${info.catalogTools} tasks=markdown-to-txt,pdf-page-numbers`);

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
