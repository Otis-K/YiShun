const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'frontend', 'index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'frontend', 'renderer.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'frontend', 'styles.css'), 'utf8');
const canvasHtml = fs.readFileSync(path.join(root, 'frontend', 'canvas.html'), 'utf8');
const canvasAdapter = fs.readFileSync(path.join(root, 'frontend', 'canvas-sdk-adapter.js'), 'utf8');
const canvasHostCss = fs.readFileSync(path.join(root, 'frontend', 'canvas-sdk-host.css'), 'utf8');
const sdkScriptPath = path.join(root, 'frontend', 'vendor', 'flowcanvas', 'flowcanvas.iife.js');
const sdkStylesPath = path.join(root, 'frontend', 'vendor', 'flowcanvas', 'styles.css');
const combined = `${html}\n${renderer}\n${canvasHtml}\n${canvasAdapter}\n${canvasHostCss}`;

const forbidden = [
  ['dialog element', /<dialog\b/i],
  ['showModal', /\.showModal\s*\(/],
  ['alert', /\balert\s*\(/],
  ['confirm', /\bconfirm\s*\(/]
];
for (const [name, pattern] of forbidden) {
  if (pattern.test(combined)) throw new Error(`blocking popup remains: ${name}`);
}

const ids = [...combined.matchAll(/\bid=["'`]([^"'`]+)["'`]/g)].map(match => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
if (duplicates.length) throw new Error(`duplicate DOM ids: ${[...new Set(duplicates)].join(', ')}`);

const selectors = [...renderer.matchAll(/querySelector\(["'`]#([A-Za-z0-9_-]+)["'`]\)/g)].map(match => match[1]);
const missing = [...new Set(selectors.filter(id => !ids.includes(id)))];
if (missing.length) throw new Error(`missing DOM ids: ${missing.join(', ')}`);

for (const required of ['catalogView', 'toolView', 'fileSettingsView', 'canvasView', 'canvasBackBtn', 'canvasImmersiveBtn', 'canvasFrame', 'toolBackBtn', 'runBtn', 'noticeBar']) {
  if (!ids.includes(required)) throw new Error(`immersive UI contract missing: ${required}`);
}

for (const [name, pattern] of [
  ['same-window canvas switch', /showView\(canvasView\)/],
  ['canvas entry view memory', /canvasReturnView/],
  ['canvas return handler', /function\s+returnFromCanvas\s*\(/],
  ['canvas immersive state', /canvasImmersiveMode/],
  ['canvas immersive toggle', /function\s+setCanvasImmersive\s*\(/],
  ['canvas opens immersive by default', /canvasImmersive\s*=\s*true[\s\S]*?showView\(canvasView\)/],
  ['no canvas window API call', /toolApi\.openCanvas\(\)/]
]) {
  const matched = pattern.test(renderer);
  if (name === 'no canvas window API call' ? matched : !matched) throw new Error(`same-window canvas contract failed: ${name}`);
}

if (!/\.canvasImmersiveMode\s+\.workspace\s*\{[\s\S]*?grid-template-columns:\s*0\s+minmax\(0,\s*1fr\)/.test(html + styles + renderer)) {
  throw new Error('canvas immersive mode must let the canvas cover the outer all-tools sidebar');
}

for (const [name, filePath] of [['FlowCanvas SDK script', sdkScriptPath], ['FlowCanvas SDK styles', sdkStylesPath]]) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) throw new Error(`${name} is missing or empty`);
}
for (const contract of [
  ['FlowCanvas host', /id=["']flowcanvas-host["']/],
  ['FlowCanvas SDK script reference', /vendor\/flowcanvas\/flowcanvas\.iife\.js/],
  ['FlowCanvas SDK style reference', /vendor\/flowcanvas\/styles\.css/],
  ['Tool Plus canvas adapter reference', /canvas-sdk-adapter\.js/],
  ['SDK construction', /new\s+FlowCanvas\.FlowCanvasSDK\s*\(/],
  ['SDK integration API', /__toolPlusCanvasSDK/],
  ['local persistence', /localStorage/]
]) {
  if (!contract[1].test(`${canvasHtml}\n${canvasAdapter}`)) throw new Error(`local canvas contract missing: ${contract[0]}`);
}
if (fs.existsSync(path.join(root, 'frontend', 'canvas-renderer.js')) || fs.existsSync(path.join(root, 'frontend', 'canvas-styles.css'))) {
  throw new Error('legacy hand-written canvas assets must be removed');
}

console.log(`PASS immersive-ui ${ids.length} ids ${new Set(selectors).size} selector contracts FlowCanvas SDK local canvas no blocking popups`);
