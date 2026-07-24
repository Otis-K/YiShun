import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const temporaryRoot = path.join(root, '.package-consumer');

const budgets = {
  'index.js': 1_500_000,
  'index.cjs': 1_500_000,
  'flowcanvas.iife.js': 2_000_000,
  'styles.css': 160_000,
};
const iifeGzipBudget = 600_000;

const log = message => process.stdout.write(`[package] ${message}\n`);
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function closeElectron(application) {
  if (!application) return;
  const child = application.process();
  const close = application.close().then(() => true, () => true);
  if (await Promise.race([close, delay(8_000).then(() => false)])) return;
  if (child.exitCode === null && !child.killed) child.kill();
  await Promise.race([
    close,
    new Promise(resolve => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', resolve);
    }),
    delay(3_000),
  ]);
}

function run(command, args, cwd = root) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command;
  const result = spawnSync(executable, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with exit code ${String(result.status)}.`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function verifyBuildArtifacts() {
  for (const [file, limit] of Object.entries(budgets)) {
    const target = path.join(dist, file);
    assert.ok(existsSync(target), `Missing build artifact: dist/${file}`);
    const bytes = readFileSync(target);
    assert.ok(bytes.byteLength <= limit, `${file} is ${bytes.byteLength} bytes; budget is ${limit}.`);
    log(`${file}: ${bytes.byteLength.toLocaleString()} / ${limit.toLocaleString()} bytes`);
  }

  const esm = readFileSync(path.join(dist, 'index.js'), 'utf8');
  const cjs = readFileSync(path.join(dist, 'index.cjs'), 'utf8');
  const iifeBytes = readFileSync(path.join(dist, 'flowcanvas.iife.js'));
  const iife = iifeBytes.toString('utf8');
  const iifeSyntax = iife
    .replace(/(["'`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g, '')
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, '');
  const gzipBytes = gzipSync(iifeBytes, { level: 9 }).byteLength;

  assert.match(esm, /from\s*["']react(?:\/[^"']*)?["']/, 'ESM must externalize React and its subpaths.');
  assert.match(cjs, /require\(["']react(?:\/[^"']*)?["']\)/, 'CJS must externalize React and its subpaths.');
  // A public object may legitimately expose a method named `.require()`; only
  // reject a free CommonJS loader call such as `require("react")`.
  assert.doesNotMatch(iife, /(?<![.\w$])require\s*\(\s*["']/, 'IIFE contains a CommonJS require call.');
  assert.doesNotMatch(iifeSyntax, /(?<![.}\w$])import\s*\(/, 'IIFE contains a dynamic ESM import.');
  assert.doesNotMatch(iifeSyntax, /(^|[;\n])\s*import\s+/m, 'IIFE contains a static ESM import.');
  assert.doesNotMatch(iifeSyntax, /\beval\s*\(/, 'IIFE contains eval().');
  assert.doesNotMatch(iife, /(?:unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|cdn\.skypack\.dev)/i,
    'IIFE contains a CDN dependency.');
  assert.ok(gzipBytes <= iifeGzipBudget,
    `flowcanvas.iife.js gzip size is ${gzipBytes} bytes; budget is ${iifeGzipBudget}.`);
  log(`flowcanvas.iife.js gzip: ${gzipBytes.toLocaleString()} / ${iifeGzipBudget.toLocaleString()} bytes`);
}

function packAndInstallConsumer() {
  rmSync(temporaryRoot, { recursive: true, force: true });
  const packDirectory = path.join(temporaryRoot, 'pack');
  const extractDirectory = path.join(temporaryRoot, 'extract');
  const consumerDirectory = path.join(temporaryRoot, 'consumer');
  mkdirSync(packDirectory, { recursive: true });
  mkdirSync(extractDirectory, { recursive: true });
  mkdirSync(consumerDirectory, { recursive: true });

  run('pnpm', ['pack', '--pack-destination', packDirectory]);
  const archiveName = readdirSync(packDirectory).find(file => file.endsWith('.tgz'));
  assert.ok(archiveName, 'pnpm pack did not produce a .tgz archive.');
  const archive = path.join(packDirectory, archiveName);
  run('tar', ['-xzf', archive, '-C', extractDirectory]);

  const packedPackage = path.join(extractDirectory, 'package');
  for (const file of [
    'dist/index.js',
    'dist/index.cjs',
    'dist/index.d.ts',
    'dist/index.d.cts',
    'dist/flowcanvas.iife.js',
    'dist/styles.css',
    'demo/standalone/index.html',
    'demo/standalone/electron-main.cjs',
    'demo/standalone/electron-preload.cjs',
    'LICENSE',
  ]) {
    assert.ok(existsSync(path.join(packedPackage, file)), `Packed package is missing ${file}.`);
  }

  const packedManifest = JSON.parse(readFileSync(path.join(packedPackage, 'package.json'), 'utf8'));
  assert.equal(packedManifest.exports['.'].import.default, './dist/index.js');
  assert.equal(packedManifest.exports['.'].import.types, './dist/index.d.ts');
  assert.equal(packedManifest.exports['.'].require.default, './dist/index.cjs');
  assert.equal(packedManifest.exports['.'].require.types, './dist/index.d.cts');
  assert.equal(packedManifest.exports['./flowcanvas.iife'], './dist/flowcanvas.iife.js');
  assert.equal(packedManifest.version, '0.2.0');
  assert.equal(packedManifest.license, 'MIT');
  assert.equal(packedManifest.optionalDependencies['@rolldown/binding-win32-x64-msvc'], '1.1.5');
  assert.equal(packedManifest.devDependencies?.['@rolldown/binding-win32-x64-msvc'], undefined);

  copyFileSync(archive, path.join(consumerDirectory, 'flowcanvas-sdk.tgz'));
  writeFileSync(path.join(consumerDirectory, 'package.json'), JSON.stringify({
    name: 'flowcanvas-package-acceptance',
    private: true,
    type: 'module',
  }, null, 2));
  writeFileSync(path.join(consumerDirectory, 'esm-consumer.mjs'), `
import { FlowCanvasSDK, createEmptyGraph } from '@flowcanvas/sdk';
if (typeof FlowCanvasSDK !== 'function') throw new Error('ESM FlowCanvasSDK export is missing.');
if (createEmptyGraph('esm').name !== 'esm') throw new Error('ESM graph API failed.');
const sdk = new FlowCanvasSDK({ includeBuiltinNodes: true });
const node = sdk.addNode('prompt', { x: 0, y: 0 }, { prompt: 'esm package acceptance' });
const result = await sdk.runNode(node.id);
if (result.status !== 'success') throw new Error('ESM runtime did not succeed.');
sdk.destroy();
console.log('ESM_CONSUMER_OK');
`.trimStart());
  writeFileSync(path.join(consumerDirectory, 'cjs-consumer.cjs'), `
const { FlowCanvasSDK, createEmptyGraph } = require('@flowcanvas/sdk');
if (typeof FlowCanvasSDK !== 'function') throw new Error('CJS FlowCanvasSDK export is missing.');
if (createEmptyGraph('cjs').name !== 'cjs') throw new Error('CJS graph API failed.');
const sdk = new FlowCanvasSDK({ includeBuiltinNodes: true });
const node = sdk.addNode('prompt', { x: 0, y: 0 }, { prompt: 'cjs package acceptance' });
sdk.runNode(node.id).then(result => {
  if (result.status !== 'success') throw new Error('CJS runtime did not succeed.');
  sdk.destroy();
  console.log('CJS_CONSUMER_OK');
}).catch(error => { console.error(error); process.exitCode = 1; });
`.trimStart());
  writeFileSync(path.join(consumerDirectory, 'typescript-consumer.ts'), `
import { FlowCanvasSDK, type FlowCanvasSDKOptions } from '@flowcanvas/sdk';
const options: FlowCanvasSDKOptions = { theme: 'dark' };
const sdk: FlowCanvasSDK = new FlowCanvasSDK(options);
void sdk.runNode('typed-node');
sdk.destroy();
`.trimStart());
  writeFileSync(path.join(consumerDirectory, 'typescript-nodenext-consumer.mts'), `
import { FlowCanvasSDK, RuntimeConfigurationRequiredError, type FlowCanvasSDKOptions } from '@flowcanvas/sdk';
const options: FlowCanvasSDKOptions = { theme: 'light' };
const sdk = new FlowCanvasSDK(options);
const error = new RuntimeConfigurationRequiredError('Configure host', ['host']);
if (error.code !== 'CONFIGURATION_REQUIRED') throw error;
sdk.destroy();
`.trimStart());
  writeFileSync(path.join(consumerDirectory, 'typescript-nodenext-consumer.cts'), `
import FlowCanvas = require('@flowcanvas/sdk');
const options: FlowCanvas.FlowCanvasSDKOptions = { theme: 'dark' };
const sdk: FlowCanvas.FlowCanvasSDK = new FlowCanvas.FlowCanvasSDK(options);
sdk.destroy();
`.trimStart());
  writeFileSync(path.join(consumerDirectory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noUncheckedSideEffectImports: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['typescript-consumer.ts'],
  }, null, 2));
  writeFileSync(path.join(consumerDirectory, 'tsconfig.nodenext.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['typescript-nodenext-consumer.mts', 'typescript-nodenext-consumer.cts'],
  }, null, 2));

  // Install the exact unpacked tarball into an isolated node_modules tree.
  // Peer/runtime dependencies are junctioned from the already locked root
  // install so this acceptance remains deterministic and network independent.
  const consumerModules = path.join(consumerDirectory, 'node_modules');
  const sdkInstall = path.join(consumerModules, '@flowcanvas', 'sdk');
  mkdirSync(path.dirname(sdkInstall), { recursive: true });
  cpSync(packedPackage, sdkInstall, { recursive: true });
  for (const dependency of [
    'react',
    'react-dom',
    '@xyflow/react',
    'lucide-react',
    '@types/react',
    '@types/react-dom',
  ]) {
    const segments = dependency.split('/');
    const source = path.join(root, 'node_modules', ...segments);
    const destination = path.join(consumerModules, ...segments);
    assert.ok(existsSync(source), `Locked root dependency is missing: ${dependency}`);
    mkdirSync(path.dirname(destination), { recursive: true });
    symlinkSync(source, destination, 'junction');
  }
  assert.match(run('node', ['esm-consumer.mjs'], consumerDirectory), /ESM_CONSUMER_OK/);
  assert.match(run('node', ['cjs-consumer.cjs'], consumerDirectory), /CJS_CONSUMER_OK/);
  run('node', [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumerDirectory);
  run('node', [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.nodenext.json'], consumerDirectory);
  log(`ESM, CJS, Bundler TypeScript and NodeNext TypeScript loaded from ${archiveName}`);

  return packedPackage;
}

async function verifyPackedIife(packedPackage) {
  const errors = [];
  let application;
  try {
    application = await electron.launch({
      args: [path.join(packedPackage, 'demo/standalone/electron-main.cjs')],
      timeout: 30_000,
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.waitForFunction(() => document.documentElement.dataset.flowcanvasReady !== undefined);
    const acceptance = await page.evaluate(() => ({
      ready: document.documentElement.dataset.flowcanvasReady,
      api: typeof window.FlowCanvas?.FlowCanvasSDK,
      result: window.flowCanvasAcceptance,
      nodeGlobals: {
        require: typeof window.require,
        process: typeof window.process,
      },
      host: window.electronHost,
    }));
    assert.equal(acceptance.ready, 'true');
    assert.equal(acceptance.api, 'function');
    assert.deepEqual(acceptance.result, {
      mounted: true,
      nodeCount: 1,
      runStatus: 'success',
      protocol: 'file:',
    });
    assert.deepEqual(acceptance.nodeGlobals, { require: 'undefined', process: 'undefined' });
    assert.deepEqual(acceptance.host, {
      runtime: 'electron',
      contextIsolated: true,
      sandboxed: true,
    });
    assert.deepEqual(errors, []);
    await page.evaluate(() => window.flowCanvasStandalone.destroy());
    assert.equal(await page.locator('#app').evaluate(element => element.childElementCount), 0);
    log('packed IIFE mounted, ran, and destroyed in sandboxed Electron file://');
  } finally {
    await closeElectron(application);
  }
}

try {
  verifyBuildArtifacts();
  const packedPackage = packAndInstallConsumer();
  await verifyPackedIife(packedPackage);
  rmSync(temporaryRoot, { recursive: true, force: true });
  log('all package consumers passed');
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.stderr.write(`[package] retained diagnostics at ${temporaryRoot}\n`);
  process.exitCode = 1;
}
