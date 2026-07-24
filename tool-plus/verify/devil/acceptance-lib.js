const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_ROOTS = ['backend', 'electron', 'frontend', 'python_bridge', 'python_pdf_helper', 'scripts', 'verify', 'docs'];
const SOURCE_FILES = [
  'package.json', 'package-lock.json', 'go.mod', 'go.sum',
  'python-bridge.spec', 'build/installer.nsh', 'THIRD_PARTY_NOTICES.md'
];
const IGNORED_NAMES = new Set(['__pycache__', 'node_modules', '.git']);

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest('hex');
}

function sourceFiles(root) {
  const files = [];
  for (const relative of SOURCE_ROOTS) walk(path.join(root, relative), files);
  for (const relative of SOURCE_FILES) {
    const file = path.join(root, relative);
    if (fs.existsSync(file)) files.push(file);
  }
  return files
    .filter(file => !file.endsWith('.pyc'))
    .sort((a, b) => {
      const left = normalize(path.relative(root, a));
      const right = normalize(path.relative(root, b));
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

function sourceFingerprint(root) {
  const hash = crypto.createHash('sha256');
  const files = sourceFiles(root);
  for (const file of files) {
    hash.update(normalize(path.relative(root, file)));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return { fingerprint: hash.digest('hex'), fileCount: files.length };
}

function sourceManifest(root) {
  const source = sourceFingerprint(root);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root: path.resolve(root),
    sourceFingerprint: source.fingerprint,
    sourceFileCount: source.fileCount,
    backendSha256: optionalHash(path.join(root, 'bin', 'toolplus-backend.exe')),
    engineSha256: optionalHash(path.join(root, 'bin', 'toolplus-engine.exe')),
    pythonBridgeSha256: optionalHash(path.join(root, 'bin', 'python-bridge.exe')),
    pdfPageNumbersHelperSha256: optionalHash(path.join(root, 'bin', 'pdf-page-numbers-helper.exe')),
    packageVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
  };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function optionalHash(file) {
  return fs.existsSync(file) ? sha256File(file) : null;
}

function walk(directory, files) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_NAMES.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else files.push(full);
  }
}

function normalize(value) {
  return value.split(path.sep).join('/');
}

module.exports = {
  readJson,
  sha256File,
  sourceFiles,
  sourceFingerprint,
  sourceManifest,
  writeJson
};
