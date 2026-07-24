const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const asar = require('@electron/asar');

const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'release', 'win-unpacked', 'resources', 'app.asar');
const expectedVersion = '0.5.30';
const sourcePackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const archivePath = (...segments) => path.join(...segments);

function readArchiveBuffer(file) {
  return asar.extractFile(archive, archivePath(...file.split('/')));
}

function readArchiveText(file) {
  return readArchiveBuffer(file).toString('utf8');
}

function requireMatch(value, pattern, label) {
  if (!pattern.test(value)) throw new Error(`packaged contract missing: ${label}`);
}

function requireId(html, id, label = id) {
  requireMatch(html, new RegExp(`id=["']${id}["']`), label);
}

function createForbiddenPatterns() {
  const compact = (...parts) => parts.join('');
  return [
    new RegExp(['mm', 'agent'].join('[-_ ]?'), 'i'),
    new RegExp(['agent', 'tmlab', 'com'].join('\\.'), 'i'),
    new RegExp(['', 'agent', 'api'].join('/'), 'i'),
    new RegExp(compact('open', 'Mm', 'Agent'), 'i'),
    new RegExp(['prepare', 'canvas', 'runtime'].join('[-_]'), 'i'),
    new RegExp(['upload', 'mm', 'agent'].join('[-_]'), 'i'),
    new RegExp(compact('remote', 'Runtime'), 'i'),
    new RegExp(compact('ensure', 'Remote', 'Runtime'), 'i')
  ];
}

function verifyCurrentPackageVersion() {
  if (sourcePackage.version !== expectedVersion) {
    throw new Error(`source package version is ${sourcePackage.version}; verifier targets ${expectedVersion}`);
  }
  if (!fs.existsSync(archive)) {
    throw new Error(`packaged application is missing for ${expectedVersion}: ${archive}`);
  }

  let packagedPackage;
  try {
    packagedPackage = JSON.parse(readArchiveText('package.json'));
  } catch (error) {
    throw new Error(`cannot read packaged package.json: ${error.message}`);
  }
  if (packagedPackage.version !== expectedVersion) {
    throw new Error(
      `packaged version mismatch: expected ${expectedVersion}, found ${packagedPackage.version || 'unknown'}`
    );
  }
}

function verifyPackagedApplication() {
  const packagedFiles = asar.listPackage(archive).map(file => file.replace(/^[\\/]/, '').replace(/\\/g, '/'));
  const requiredFiles = [
    'THIRD_PARTY_NOTICES.md',
    'frontend/index.html',
    'frontend/styles.css',
    'frontend/renderer.js',
    'frontend/canvas.html',
    'frontend/canvas-sdk-adapter.js',
    'frontend/canvas-sdk-host.css',
    'frontend/vendor/flowcanvas/flowcanvas.iife.js',
    'frontend/vendor/flowcanvas/styles.css',
    'electron/main.js',
    'electron/preload.js',
    'electron/settings-store.js',
    'electron/task-manager.js',
    'electron/workflow-manager.js'
  ];
  for (const file of requiredFiles) {
    if (!packagedFiles.includes(file)) throw new Error(`packaged required file missing: ${file}`);
  }
  if (packagedFiles.includes('electron/canvas-preload.js')) {
    throw new Error('packaged application contains the test-only canvas preload');
  }

  const html = readArchiveText('frontend/index.html');
  const styles = readArchiveText('frontend/styles.css');
  const renderer = readArchiveText('frontend/renderer.js');
  const canvasHtml = readArchiveText('frontend/canvas.html');
  const canvasAdapter = readArchiveText('frontend/canvas-sdk-adapter.js');
  const canvasHostCss = readArchiveText('frontend/canvas-sdk-host.css');
  const main = readArchiveText('electron/main.js');
  const preload = readArchiveText('electron/preload.js');
  const workflowManager = readArchiveText('electron/workflow-manager.js');
  const sdkScript = readArchiveBuffer('frontend/vendor/flowcanvas/flowcanvas.iife.js');
  const sdkStyles = readArchiveBuffer('frontend/vendor/flowcanvas/styles.css');

  const sourceIdentityFiles = [
    'THIRD_PARTY_NOTICES.md',
    'frontend/index.html',
    'frontend/styles.css',
    'frontend/renderer.js',
    'frontend/canvas.html',
    'frontend/canvas-sdk-adapter.js',
    'frontend/canvas-sdk-host.css',
    'frontend/vendor/flowcanvas/flowcanvas.iife.js',
    'frontend/vendor/flowcanvas/styles.css',
    'electron/main.js',
    'electron/preload.js',
    'electron/settings-store.js',
    'electron/task-manager.js',
    'electron/workflow-manager.js'
  ];
  for (const file of sourceIdentityFiles) {
    const source = fs.readFileSync(path.join(root, ...file.split('/')));
    const packaged = readArchiveBuffer(file);
    if (sha256(source) !== sha256(packaged)) {
      throw new Error(`packaged source identity mismatch: ${file}`);
    }
  }

  const popupSurface = `${html}\n${renderer}\n${canvasHtml}\n${canvasAdapter}`;
  if (/<dialog\b/i.test(html)) throw new Error('packaged blue UI still contains native dialog elements');
  if (/\b(?:alert|confirm)\s*\(|\.showModal\s*\(/.test(popupSurface)) {
    throw new Error('packaged blue UI still contains blocking browser popup calls');
  }

  // Blue homepage: real catalog shell, not the removed green-layout selectors.
  for (const [id, label] of [
    ['catalogView', 'blue homepage catalog'],
    ['sidebar', 'blue homepage navigation'],
    ['cards', 'blue homepage cards'],
    ['jumpSelect', 'blue homepage quick jump'],
    ['searchInput', 'blue homepage search'],
    ['pager', 'blue homepage pagination']
  ]) requireId(html, id, label);
  requireMatch(html, /class=["'][^"']*workspace[^"']*["']/, 'blue homepage workspace shell');
  requireMatch(styles, /--brand:\s*#2024aa\b/i, 'blue brand palette');
  requireMatch(styles, /\.topbar\s*\{[\s\S]*?background:\s*var\(--brand\)/, 'blue top rail');
  requireMatch(renderer, /function\s+renderCards\s*\(/, 'blue homepage card renderer');

  for (const id of ['canvasView', 'canvasBackBtn', 'canvasImmersiveBtn', 'canvasFrame']) requireId(html, id, `same-window canvas ${id}`);
  requireMatch(html, /返回进入前页面/, 'same-window canvas return action');
  requireMatch(renderer, /showView\(canvasView\)/, 'same-window canvas view switch');
  requireMatch(renderer, /function\s+returnFromCanvas\s*\(/, 'same-window canvas return handler');
  requireMatch(renderer, /function\s+setCanvasImmersive\s*\(/, 'canvas immersive toggle handler');
  requireMatch(renderer, /canvasImmersive\s*=\s*true[\s\S]*?showView\(canvasView\)/, 'canvas opens with outer sidebar hidden');
  requireMatch(styles, /\.canvasImmersiveMode\s+\.workspace\s*\{[\s\S]*?grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)/, 'canvas immersive covers all-tools sidebar');
  if ((main.match(/new\s+BrowserWindow\s*\(/g) || []).length !== 1) {
    throw new Error('packaged main process creates a second BrowserWindow for canvas');
  }
  if (/openCanvasWindow|canvasWindow|ipcMain\.handle\(["']open-canvas/.test(main) || /openCanvas|open-canvas/.test(preload)) {
    throw new Error('packaged application retains the removed canvas-window IPC path');
  }
  for (const id of ['canvasModelApiKey', 'canvasVideoModelApiKey', 'canvasImageModel', 'canvasVideoModel']) {
    requireId(html, id, `model profile manager ${id}`);
  }
  requireMatch(main, /normalizedModelProfiles/, 'separate image and video model profiles');
  requireMatch(main, /baseURL\s*!==\s*currentBaseURL\s*&&\s*!apiKey/, 'model endpoint change requires a new key');
  requireMatch(main, /canvas:image-generate/, 'scoped image generation IPC');
  requireMatch(canvasAdapter, /imageReferenceOrder/, 'ordered local and remote image references');

  // Tool-specific workbench and its real four-step wizard.
  requireId(html, 'toolView', 'workbench view');
  requireMatch(html, /class=["'][^"']*workbenchView[^"']*["']/, 'workbench layout class');
  for (const id of [
    'workbenchInputStep',
    'workbenchOptionsStep',
    'workbenchOutputStep',
    'workbenchResultStep',
    'saveAsWorkflowBtn',
    'runBtn'
  ]) requireId(html, id, `workbench ${id}`);
  requireMatch(html, /class=["'][^"']*workbenchStepper[^"']*["']/, 'workbench four-step header');
  requireMatch(styles, /\.blueBackButton\s*\{[\s\S]*?background:\s*var\(--brand\)/, 'workbench blue navigation');
  requireMatch(renderer, /function\s+setWorkbenchStep\s*\(/, 'workbench state transition');
  requireMatch(renderer, /function\s+validateWorkbenchStep\s*\(/, 'workbench step validation');

  // Workflow list/detail UI and renderer wiring use the blue project's actual IDs.
  for (const id of ['workflowView', 'workflowRows', 'workflowStepRows', 'workflowDetail', 'workflowRunPanel']) {
    requireId(html, id, `workflow ${id}`);
  }
  requireMatch(renderer, /function\s+renderWorkflowRows\s*\([\s\S]*?#workflowRows/, 'workflowRows renderer');
  requireMatch(renderer, /function\s+renderWorkflowSteps\s*\([\s\S]*?#workflowStepRows/, 'workflowStepRows renderer');
  requireMatch(renderer, /showView\(workflowView\)/, 'workflowView navigation');
  requireMatch(renderer, /workflowRunStart\s*\(/, 'workflow run action');
  requireMatch(renderer, /#saveAsWorkflowBtn/, 'workbench-to-workflow action');

  // Main-process workflow engine, persistence, cancellation, resume and artifact handoff.
  requireMatch(main, /require\(["']\.\/workflow-manager["']\)/, 'workflow manager import');
  for (const channel of [
    'workflow:run/start',
    'workflow:run/cancel',
    'workflow:run/resume',
    'workflow:run/retry'
  ]) requireMatch(main, new RegExp(channel.replace('/', '\\/')), `workflow IPC ${channel}`);
  for (const bridgeMethod of ['workflowRunStart', 'workflowRunCancel', 'workflowRunResume', 'workflowRunRetry']) {
    requireMatch(preload, new RegExp(`${bridgeMethod}\\s*:`), `workflow preload bridge ${bridgeMethod}`);
  }
  for (const [label, pattern] of [
    ['WorkflowManager class', /class\s+WorkflowManager\s+extends\s+EventEmitter/],
    ['workflow start', /async\s+start\s*\(/],
    ['workflow cancel', /async\s+cancel\s*\(/],
    ['workflow resume', /async\s+resume\s*\(/],
    ['active run exclusion', /activeByWorkflow/],
    ['checkpoint persistence', /checkpointStepId/],
    ['artifact manifest', /artifact-manifest\.json/],
    ['atomic final copy', /COPYFILE_EXCL/],
    ['copy hash verification', /sourceHash\s*!==\s*copiedHash/],
    ['atomic JSON persistence', /function\s+atomicWriteJSON/],
    ['workflow export', /module\.exports\s*=\s*\{\s*WorkflowManager/]
  ]) requireMatch(workflowManager, pattern, label);

  // FlowCanvas is packaged locally, network-blocked, and uses the real local runtime.
  for (const [label, pattern] of [
    ['FlowCanvas host', /id=["']flowcanvas-host["']/],
    ['FlowCanvas SDK script', /vendor\/flowcanvas\/flowcanvas\.iife\.js/],
    ['FlowCanvas SDK styles', /vendor\/flowcanvas\/styles\.css/],
    ['Tool Plus canvas adapter', /canvas-sdk-adapter\.js/]
  ]) requireMatch(canvasHtml, pattern, label);
  for (const [label, pattern] of [
    ['SDK construction', /new\s+FlowCanvas\.FlowCanvasSDK\s*\(/],
    ['local workflow runtime', /new\s+FlowCanvas\.LocalWorkflowRuntime\s*\(/],
    ['SDK integration API', /__toolPlusCanvasSDK/],
    ['local persistence', /localStorage/],
    ['local media kind detection', /mediaKindFromMime/],
    ['safe preview object URL', /createObjectUrl/]
  ]) requireMatch(canvasAdapter, pattern, label);
  requireMatch(canvasHostCss, /#flowcanvas-host/, 'FlowCanvas host sizing');
  if (!sdkScript.length || !sdkStyles.length) throw new Error('packaged FlowCanvas SDK assets are empty');
  const sdkScriptText = sdkScript.toString('utf8');
  const sdkStylesText = sdkStyles.toString('utf8');
  requireMatch(sdkScriptText, /删除选中/, 'FlowCanvas visible delete-selected control');
  requireMatch(sdkScriptText, /移除素材/, 'FlowCanvas media chip remove control');
  requireMatch(sdkScriptText, /添加空白节点/, 'FlowCanvas blank node rail control');
  requireMatch(sdkScriptText, /targetNodeId/, 'FlowCanvas asset import target-node embedding');
  requireMatch(sdkScriptText, /embeddedMedia/, 'FlowCanvas embedded media data model');
  requireMatch(sdkScriptText, /播放.*视频预览|fc-video-preview__toggle/, 'FlowCanvas custom video preview control');
  requireMatch(sdkScriptText, /视频播放进度/, 'FlowCanvas video preview progress control');
  requireMatch(sdkScriptText, /ConnectionMode|connectionMode/, 'FlowCanvas interactive connection mode');
  requireMatch(sdkScriptText, /极致推理|高一致性图生视频/, 'FlowCanvas descriptive model menu');
  requireMatch(sdkStylesText, /fc-canvas-delete/, 'FlowCanvas delete selected styling');
  requireMatch(sdkStylesText, /fc-generation-remove-media/, 'FlowCanvas media remove styling');
  requireMatch(sdkStylesText, /fc-video-preview/, 'FlowCanvas custom video preview styling');
  requireMatch(sdkStylesText, /fc-video-preview__controls/, 'FlowCanvas video preview transport styling');
  requireMatch(sdkStylesText, /fc-model-select__menu/, 'FlowCanvas themed model menu styling');
  requireMatch(sdkStylesText, /fc-node--media-video/, 'FlowCanvas large uploaded video node styling');
  requireMatch(sdkStylesText, /fc-node__blank-preview/, 'FlowCanvas blank node embedded-media placeholder styling');
  requireMatch(sdkStylesText, /fc-node__media-stack/, 'FlowCanvas multi embedded-media stack styling');
  requireMatch(canvasAdapter, /['"]blank['"]/, 'Tool Plus exposes FlowCanvas blank node type');
  requireMatch(canvasHtml, /connect-src\s+blob:\s+data:/, 'FlowCanvas CSP local-only connection policy');
  if (/ipcRenderer|XMLHttpRequest|WebSocket|EventSource|https?:\/\//.test(canvasAdapter)) {
    throw new Error('packaged local FlowCanvas adapter exposes IPC or a remote network client');
  }
  requireMatch(canvasAdapter, /source\.startsWith\(['"]blob:['"]\).*source\.startsWith\(['"]data:['"]\)/s, 'FlowCanvas local media source allowlist');
  requireMatch(canvasAdapter, /window\.fetch\(source\)/, 'FlowCanvas local Blob/Data reader');

  // Patterns are assembled at runtime so the verifier does not itself restore removed literals.
  const forbiddenPatterns = createForbiddenPatterns();
  for (const file of packagedFiles) {
    if (forbiddenPatterns.some(pattern => pattern.test(file))) {
      throw new Error(`packaged removed remote-service filename remains: ${file}`);
    }
    if (!/\.(?:c?js|mjs|html|css|json|md|txt)$/i.test(file)) continue;
    const content = readArchiveText(file);
    if (forbiddenPatterns.some(pattern => pattern.test(content))) {
      throw new Error(`packaged removed remote-service content remains: ${file}`);
    }
  }

  console.log([
    'PASS packaged-immersive-ui',
    `version=${expectedVersion}`,
    `files=${packagedFiles.length}`,
    'blue-homepage',
    'blue-workbench',
    'workflowView-workflowRows-workflowStepRows',
    `source-identity-hash-match=${sourceIdentityFiles.length}`,
    'csp-connect-local-only',
    'local-only',
    'zero-removed-remote-service',
    'no-blocking-popups'
  ].join(' '));
}

verifyCurrentPackageVersion();
verifyPackagedApplication();
