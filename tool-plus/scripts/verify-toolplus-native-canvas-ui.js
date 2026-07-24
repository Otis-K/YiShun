const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');

const root = path.resolve(__dirname, '..');
const workRoot = path.join(root, 'work');
const profileDir = path.join(workRoot, `canvas-local-verification-profile-${process.pid}-${Date.now()}`);
if (!profileDir.startsWith(`${workRoot}${path.sep}`)) throw new Error('Unsafe verification profile path.');
fs.mkdirSync(workRoot, { recursive: true });
fs.rmSync(profileDir, { recursive: true, force: true });
app.setPath('userData', profileDir);

const networkRequests = [];

function verifyStaticIsolation() {
  const adapter = fs.readFileSync(path.join(root, 'frontend', 'canvas-sdk-adapter.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'frontend', 'canvas.html'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'electron', 'canvas-preload.js'), 'utf8');
  const combined = `${adapter}\n${html}\n${preload}`;
  const removedServicePattern = new RegExp(['mm', 'agent'].join('-'), 'i');

  assert.doesNotMatch(combined, removedServicePattern, 'local canvas renderer must not mention the removed remote service');
  assert.equal((adapter.match(/\bfetch\s*\(/g) || []).length, 1, 'renderer may only use one local material read');
  assert.match(adapter, /source\.startsWith\('blob:'\)[\s\S]{0,160}source\.startsWith\('data:'\)[\s\S]{0,240}window\.fetch\(source\)/, 'renderer fetch must be restricted to blob/data material URLs');
  assert.doesNotMatch(combined, /\bEventSource\b|\bXMLHttpRequest\b|\bWebSocket\b/, 'local canvas renderer must not contain network clients');
  assert.doesNotMatch(preload, /ipcRenderer|webUtils|invoke\s*\(/, 'local canvas preload must expose no IPC or filesystem bridge');
  assert.match(html, /connect-src 'self' blob: data:/, 'CSP must allow only same-origin and local blob/data reads');
  assert.match(html, /script-src 'self'/, 'CSP must allow only packaged scripts');
  assert.match(html, /object-src 'none'/, 'CSP must block plugin objects');
  assert.match(adapter, /new FlowCanvas\.LocalWorkflowRuntime/, 'canvas must use the SDK local runtime');
  assert.doesNotMatch(adapter, /remoteRuntime|configuration\s*:/, 'remote runtime and configuration service must be absent');
}

function createCanvasWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#090b13',
    webPreferences: {
      preload: path.join(root, 'electron', 'canvas-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  return win;
}

async function waitForReady(win) {
  await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const started = Date.now();
      const timer = setInterval(() => {
        if (window.__toolPlusCanvasReady) {
          clearInterval(timer);
          resolve(true);
        } else if (Date.now() - started > 20000) {
          clearInterval(timer);
          reject(new Error('FlowCanvas local adapter did not become ready'));
        }
      }, 40);
    })
  `);
}

async function openCanvas() {
  const win = createCanvasWindow();
  await win.loadFile(path.join(root, 'frontend', 'canvas.html'));
  await waitForReady(win);
  return win;
}

async function capture(win, name) {
  win.showInactive();
  await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await new Promise(resolve => setTimeout(resolve, 180));
  const image = await win.webContents.capturePage();
  const outputDir = path.join(workRoot, 'canvas-screens');
  fs.mkdirSync(outputDir, { recursive: true });
  const output = path.join(outputDir, `${name}.png`);
  fs.writeFileSync(output, image.toPNG());
  return output;
}

async function verifyBootAndIsolation(win) {
  const boot = await win.webContents.executeJavaScript(`
    (() => ({
      hasSdkGlobal: typeof window.FlowCanvas?.FlowCanvasSDK === 'function',
      hasLocalRuntime: typeof window.FlowCanvas?.LocalWorkflowRuntime === 'function',
      hasAdapter: Boolean(window.__toolPlusCanvasSDK),
      rendered: Boolean(document.querySelector('[data-testid="flowcanvas-sdk"]')),
      bridgeKeys: Object.keys(window.toolplusCanvas || {}).sort(),
      nodeTypes: window.__toolPlusCanvasSDK.nodeTypes,
      generationEntries: [...document.querySelectorAll('.fc-rail button')].map(button => ({
        text: button.textContent.trim(),
        title: button.title,
        disabled: button.disabled
      })),
      nodeRequire: typeof window.require,
      nodeProcess: typeof window.process,
      popupDenied: window.open('https://example.invalid/') === null,
      scripts: [...document.scripts].map(script => ({ src: script.src, inline: Boolean(script.textContent.trim()) })),
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content || '',
      status: document.querySelector('#canvas-connection')?.innerText || ''
    }))()
  `);
  assert.equal(boot.hasSdkGlobal, true, 'packaged IIFE should expose FlowCanvasSDK');
  assert.equal(boot.hasLocalRuntime, true, 'packaged IIFE should expose LocalWorkflowRuntime');
  assert.equal(boot.hasAdapter, true, 'Tool Plus local adapter should be available');
  assert.equal(boot.rendered, true, 'FlowCanvas UI should mount in a sandboxed Electron renderer');
  assert.deepEqual(boot.bridgeKeys, [], 'canvas preload bridge must be empty');
  assert.deepEqual(boot.nodeTypes, [
    'blank', 'prompt', 'image', 'video', 'audio', 'compose',
    'text_input', 'json_input', 'local_asset', 'text_transform', 'merge', 'delay', 'output'
  ]);
  assert.deepEqual(
    boot.generationEntries.filter(item => item.title.startsWith('添加')).map(item => item.text),
    ['空白', '文本', '图片', '视频', '音频']
  );
  assert.equal(boot.generationEntries[0]?.title, '收起节点抽屉', 'generation rail should expose a drawer collapse button');
  assert.ok(boot.generationEntries.filter(item => item.title.startsWith('添加')).every(item => !item.disabled), 'all generation entries must be usable');
  assert.equal(boot.nodeRequire, 'undefined', 'Node require must not leak into the renderer main world');
  assert.equal(boot.nodeProcess, 'undefined', 'Node process must not leak into the renderer main world');
  assert.equal(boot.popupDenied, true, 'canvas window must deny popups');
  assert.ok(boot.scripts.every(script => script.src.startsWith('file:') && !script.inline), 'all scripts must be packaged local files');
  assert.match(boot.csp, /connect-src 'self' blob: data:/);
  assert.match(boot.status, /本地画布/);
  assert.match(boot.status, /本机 Go 后端安全调用/);
}

async function verifyGenerationSurface(win) {
  const surface = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const text = api.addNode('prompt', { position: { x: 100, y: 60 } });
      const image = api.addNode('image', { position: { x: 660, y: 60 } });
      const video = api.addNode('video', { position: { x: 100, y: 360 } });
      const audio = api.addNode('audio', { position: { x: 660, y: 360 } });
      api.sdk.addEdge({ source: text.id, sourcePort: 'text', target: image.id, targetPort: 'prompt' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const generationNodes = [...document.querySelectorAll('.fc-node--generation')];
      const before = {
        graphNodes: api.getGraph().nodes.map(node => ({ id: node.id, type: node.type, mode: node.data.generationMode })),
        graphEdges: api.getGraph().edges.map(edge => ({ source: edge.source, sourcePort: edge.sourcePort, target: edge.target, targetPort: edge.targetPort })),
        renderedNodes: generationNodes.length,
        renderedModes: generationNodes.map(node => node.querySelector('.fc-generation-node')?.getAttribute('data-generation-mode')),
        tabCounts: generationNodes.map(node => node.querySelectorAll('[role="tab"]').length),
        edgeCount: document.querySelectorAll('.react-flow__edge').length,
        hasLineGrid: Boolean(document.querySelector('.react-flow__background-pattern.lines')),
        dragZones: generationNodes.map(node => node.querySelectorAll('.fc-node__drag-zone').length),
        portSizes: [...document.querySelectorAll('.fc-port')].map(port => {
          const style = getComputedStyle(port);
          return { width: Number.parseFloat(style.width), height: Number.parseFloat(style.height), pointerEvents: style.pointerEvents };
        })
      };

      const railBefore = [...document.querySelectorAll('.fc-rail button')].map(button => ({ text: button.textContent.trim(), title: button.title }));
      document.querySelector('[title="收起节点抽屉"]')?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const railCollapsed = {
        className: document.querySelector('.fc-rail')?.className || '',
        addHidden: !document.querySelector('[title="添加文本节点"]'),
        expandVisible: Boolean(document.querySelector('[title="展开节点抽屉"]'))
      };
      document.querySelector('[title="展开节点抽屉"]')?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const railExpandedAgain = Boolean(document.querySelector('[title="添加文本节点"]'));

      document.querySelector('[title="切换主题"]')?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const lightMode = {
        theme: document.querySelector('[data-testid="flowcanvas-sdk"]')?.getAttribute('data-theme'),
        previewBackground: getComputedStyle(document.querySelector('.fc-generation-node__preview')).backgroundImage,
        composerBackground: getComputedStyle(document.querySelector('.fc-generation-composer')).backgroundColor,
        inputBackground: getComputedStyle(document.querySelector('.fc-generation-input')).backgroundColor
      };
      document.querySelector('[title="切换主题"]')?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const audioNode = document.querySelector('[data-node-type="audio"]');
      const videoTab = audioNode
        ? [...audioNode.querySelectorAll('[role="tab"]')].find(tab => tab.textContent.trim() === '视频生成')
        : undefined;
      videoTab?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const switched = api.getGraph().nodes.find(node => node.id === audio.id);

      return {
        before,
        switched: switched ? { id: switched.id, type: switched.type, mode: switched.data.generationMode, title: switched.data.title, status: switched.data.status } : null,
        finalNodeCount: api.getGraph().nodes.length,
        finalEdgeCount: api.getGraph().edges.length,
        hasComposer: Boolean(document.querySelector('.fc-generation-composer textarea')),
        railBefore,
        railCollapsed,
        railExpandedAgain,
        lightMode
      };
    })()
  `);

  assert.deepEqual(surface.railBefore.filter(item => item.title.startsWith('添加')).map(item => item.text), ['空白', '文本', '图片', '视频', '音频']);
  assert.equal(surface.before.graphNodes.length, 4, 'the local host must create all four generation node types');
  assert.deepEqual(surface.before.graphNodes.map(node => node.type).sort(), ['audio', 'image', 'prompt', 'video']);
  assert.deepEqual(surface.before.renderedModes.sort(), ['audio', 'image', 'text', 'video']);
  assert.ok(surface.before.tabCounts.every(count => count === 4), 'every generation node must expose the four mode tabs');
  assert.equal(surface.before.renderedNodes, 4, 'all generation nodes should render with their local composer');
  assert.equal(surface.before.hasLineGrid, true, 'canvas background must render as grid lines instead of dot-only background');
  assert.ok(surface.before.dragZones.every(count => count >= 2), 'generation nodes need large drag zones on title and preview');
  assert.ok(surface.before.portSizes.length >= 4, 'generation nodes should expose connectable ports');
  assert.ok(surface.before.portSizes.every(size => size.width >= 16 && size.height >= 16 && size.pointerEvents !== 'none'), 'ports must be large and pointer-connectable');
  assert.equal(surface.before.graphEdges.length, 1, 'a real SDK edge should be created between generation nodes');
  assert.deepEqual(surface.before.graphEdges[0], {
    source: surface.before.graphNodes.find(node => node.type === 'prompt').id,
    sourcePort: 'text',
    target: surface.before.graphNodes.find(node => node.type === 'image').id,
    targetPort: 'prompt'
  });
  assert.equal(surface.finalNodeCount, 4, 'mode switching should update the existing node instead of adding a node');
  assert.deepEqual(surface.switched, { id: surface.switched.id, type: 'video', mode: 'video', title: '视频生成', status: 'idle' }, 'mode switching must synchronize type, title and stale status');
  assert.equal(surface.finalEdgeCount, 1, 'mode switching should not drop unrelated edges');
  assert.deepEqual(surface.switched, {
    id: surface.before.graphNodes.find(node => node.type === 'audio').id,
    type: 'video',
    mode: 'video',
    title: '视频生成',
    status: 'idle'
  });
  assert.equal(surface.hasComposer, true, 'generation nodes must own their input composer');
  assert.match(surface.railCollapsed.className, /is-collapsed/, 'left generation menu should collapse like a drawer');
  assert.equal(surface.railCollapsed.addHidden, true, 'collapsed generation drawer should hide node-entry buttons');
  assert.equal(surface.railCollapsed.expandVisible, true, 'collapsed generation drawer should keep an expand handle');
  assert.equal(surface.railExpandedAgain, true, 'generation drawer should expand back to full entries');
  assert.equal(surface.lightMode.theme, 'light', 'theme button should enter light mode');
  assert.notEqual(surface.lightMode.composerBackground, 'rgb(17, 18, 20)', 'light composer must not keep the dark background');
  assert.notEqual(surface.lightMode.inputBackground, 'rgb(25, 26, 28)', 'light input panel must not keep the dark background');
}

async function verifyLegacyMigration(win) {
  const migrated = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      const result = api.conversions.legacyToGraph({
        schema_version: 'toolplus_canvas.v1',
        canvas_id: 'old-canvas',
        title: '旧画布迁移',
        viewport: { x: 12, y: 34, scale: 0.8 },
        nodes: [
          { id: 'source', type: 'note', x: 20, y: 30, text: '本地文本' },
          {
            id: 'removed-generator',
            type: 'image_generation',
            x: 340,
            y: 30,
            text: '旧提示',
            localPath: 'G:/private/reference.png',
            data: {
              title: '旧生成节点',
              accessToken: 'must-not-survive',
              sessionId: 'must-not-survive',
              customLocalOption: 'keep-me'
            }
          },
          {
            id: 'previously-mis-migrated', type: 'local_asset', x: 680, y: 30,
            data: {
              migratedOriginalType: 'image', title: 'task_old.png', fileName: 'task_old.png',
              prompt: '旧版生成提示词', preview: 'data:image/png;base64,AAAA', previewKind: 'image'
            }
          }
        ],
        edges: [{ id: 'edge-1', source: 'source', target: 'removed-generator' }]
      });
      const serialized = JSON.stringify(result.graph);
      const prototypeWarnings = api.importLegacy({
        schema_version: 'toolplus_canvas.v1',
        title: '原型形状类型回归',
        nodes: [{
          id: 'prototype-type-node',
          type: '__proto__',
          x: 10,
          y: 20,
          text: 'unknown type must remain data'
        }],
        edges: []
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        graph: result.graph,
        warnings: result.warnings,
        serialized,
        exported: api.conversions.graphToLegacy(result.graph),
        prototypeType: api.getGraph().nodes[0]?.type,
        prototypeNodeCount: api.getGraph().nodes.length,
        prototypeWarnings,
        rendererResponsive: Boolean(document.querySelector('[data-testid="flowcanvas-sdk"]'))
      };
    })()
  `);
  assert.equal(migrated.graph.nodes[0].type, 'text_input');
  assert.equal(migrated.graph.nodes[1].type, 'image', 'legacy generation nodes should become the new local generation nodes');
  assert.equal(migrated.graph.nodes[1].data.fileName, 'reference.png', 'migration may retain only the display filename');
  assert.equal(migrated.graph.nodes[1].data.customLocalOption, 'keep-me', 'unrelated local extension data should survive');
  assert.equal(migrated.graph.nodes[2].type, 'image', 'previously mis-migrated generated assets must be restored as complete generation nodes');
  assert.equal(migrated.graph.nodes[2].data.prompt, '旧版生成提示词');
  assert.equal(migrated.graph.edges.length, 1);
  assert.deepEqual(migrated.graph.viewport, { x: 12, y: 34, zoom: 0.8 });
  assert.ok(migrated.warnings.some(item => item.includes('已迁移')));
  assert.doesNotMatch(migrated.serialized, /G:\/private|must-not-survive/, 'paths and old credentials must be redacted');
  assert.doesNotMatch(JSON.stringify(migrated.exported), /G:\/private|must-not-survive/);
  assert.equal(migrated.prototypeType, '__proto__', 'prototype-shaped node types must remain inert host data');
  assert.equal(migrated.prototypeNodeCount, 1);
  assert.equal(migrated.rendererResponsive, true, 'unknown prototype-shaped type must mount through the SDK fallback renderer');
  assert.ok(migrated.prototypeWarnings.some(item => item.includes('未注册')));
}

async function verifyAssetMetadata(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      const service = api.sdk.getServices().assets;
      const file = new File(['abc'], 'notes.txt', { type: 'text/plain', lastModified: 12345 });
      const imageFile = new File(['image'], 'poster.png', { type: 'image/png', lastModified: 222 });
      const videoFile = new File(['video'], 'clip.mp4', { type: 'video/mp4', lastModified: 333 });
      const textDrafts = await service.pickFiles({
        source: 'drop',
        files: [file],
        accept: service.accept,
        graph: api.getGraph(),
        position: { x: 10, y: 10 },
        signal: new AbortController().signal
      });
      const mediaDrafts = await service.pickFiles({
        source: 'drop',
        files: [imageFile, videoFile],
        accept: service.accept,
        graph: api.getGraph(),
        position: { x: 120, y: 120 },
        signal: new AbortController().signal
      });
      api.reset();
      mediaDrafts.forEach((draft, index) => {
        api.addNode(draft.type, {
          position: { x: 120 + index * 340, y: 120 },
          data: draft.data
        });
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const assetNodes = Array.from(document.querySelectorAll('[data-node-type="local_asset"]'));
      const imageNode = assetNodes.find(node => node.querySelector('img.fc-node__preview'));
      const videoNode = assetNodes.find(node => node.querySelector('.fc-video-preview video'));
      const imagePreview = imageNode?.querySelector('img.fc-node__preview');
      const videoShell = videoNode?.querySelector('.fc-video-preview.fc-node__preview');
      const videoPreview = videoShell?.querySelector('video');
      const videoToggle = videoShell?.querySelector('.fc-video-preview__toggle[aria-label="播放视频预览"]');
      const imageRect = imagePreview?.getBoundingClientRect();
      const videoRect = videoShell?.getBoundingClientRect();
      const assetIds = api.getGraph().nodes.map(node => node.id);
      api.sdk.engine.setSelection({ nodeIds: [assetIds[0]], edgeIds: [] });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const deleteButton = document.querySelector('[aria-label="删除选中"]');
      const deleteButtonReady = Boolean(deleteButton && !deleteButton.disabled);
      deleteButton?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        textAsset: textDrafts[0],
        imageAsset: mediaDrafts[0],
        videoAsset: mediaDrafts[1],
        imageRendered: Boolean(imagePreview && imageNode?.classList.contains('fc-node--media-image') && imagePreview.getAttribute('src')),
        videoRendered: Boolean(videoPreview && !videoPreview.controls && videoToggle && videoPreview.getAttribute('src')),
        videoImageLikePreview: Boolean(
          videoNode?.classList.contains('fc-node--media-video') &&
          imageRect && videoRect &&
          videoRect.width >= 360 &&
          videoRect.height >= 180 &&
          videoRect.width >= imageRect.width * 0.85 &&
          videoRect.height >= imageRect.height * 0.85
        ),
        nodeCountBeforeDelete: assetIds.length,
        deleteButtonReady,
        nodeCountAfterDelete: api.getGraph().nodes.length,
        remainingAssetTitles: api.getGraph().nodes.map(node => node.data.title)
      };
    })()
  `);
  const asset = result.textAsset;
  assert.equal(asset.type, 'local_asset');
  assert.equal(asset.data.fileName, 'notes.txt');
  assert.equal(asset.data.mimeType, 'text/plain');
  assert.equal(asset.data.mediaType, 'text');
  assert.equal(asset.data.size, 3);
  assert.equal(asset.data.lastModified, 12345);
  assert.equal('localPath' in asset.data, false);
  assert.equal('path' in asset.data, false);
  assert.equal(result.imageAsset.data.mediaType, 'image');
  assert.equal(result.imageAsset.data.previewKind, 'image');
  assert.match(result.imageAsset.data.preview, /^blob:/, 'image asset should receive a safe object-url preview');
  assert.equal(result.videoAsset.data.mediaType, 'video');
  assert.equal(result.videoAsset.data.previewKind, 'video');
  assert.match(result.videoAsset.data.preview, /^blob:/, 'video asset should receive a safe object-url preview');
  assert.equal(result.imageRendered, true, 'image uploads must render as an img inside the node');
  assert.equal(result.videoRendered, true, 'video uploads must render as a cover-style video with a custom play button');
  assert.equal(result.videoImageLikePreview, true, 'video uploads must use the same large preview treatment as image uploads');
  assert.equal(result.nodeCountBeforeDelete, 2, 'media drafts should add two real local asset nodes');
  assert.equal(result.deleteButtonReady, true, 'selected media asset nodes must expose an enabled visible delete button');
  assert.equal(result.nodeCountAfterDelete, 1, 'visible delete button should remove the selected media asset node');
  assert.deepEqual(result.remainingAssetTitles, ['clip.mp4'], 'delete should leave the unselected media asset node intact');
}

async function verifyBlankEmbeddedMedia(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const media = {
        id: 'embedded-video',
        name: 'embedded-clip.mp4',
        kind: 'video',
        mimeType: 'video/mp4',
        url: 'blob:embedded-clip',
        size: 5,
        lastModified: 777
      };
      const blank = api.addNode('blank', {
        position: { x: 220, y: 160 },
        data: {
          title: '空白节点',
          description: '已嵌入本地素材',
          embeddedMedia: [media],
          preview: media.url,
          previewKind: 'video',
          mediaType: 'video',
          mimeType: media.mimeType,
          fileName: media.name
        }
      });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      api.sdk.engine.setSelection({ nodeIds: [blank.id], edgeIds: [] });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const nodeShell = document.querySelector('.react-flow__node[data-id="' + blank.id + '"]');
      const blankShell = document.querySelector('.react-flow__node[data-id="' + blank.id + '"] [data-node-type="blank"]');
      const video = blankShell?.querySelector('.fc-video-preview video');
      const play = blankShell?.querySelector('.fc-video-preview__toggle[aria-label="播放视频预览"]');
      const progress = blankShell?.querySelector('input[aria-label="视频播放进度"]');
      return {
        nodeTypes: api.nodeTypes,
        nodeCount: api.getGraph().nodes.length,
        blankType: blank.type,
        embeddedCount: api.getGraph().nodes[0]?.data.embeddedMedia?.length || 0,
        previewKind: api.getGraph().nodes[0]?.data.previewKind,
        shellWidth: nodeShell?.style.width || '',
        shellHeight: nodeShell?.style.height || '',
        videoInsideBlank: Boolean(video && video.getAttribute('src') === media.url && !video.controls),
        playButton: Boolean(play),
        progressBar: Boolean(progress),
        resizeControls: nodeShell?.querySelectorAll('.react-flow__resize-control').length || 0,
        modelMenu: Boolean(document.querySelector('.fc-model-select__menu')),
        localAssetCount: document.querySelectorAll('[data-node-type="local_asset"]').length,
        blankRailButton: Boolean(document.querySelector('button[title="添加空白节点"]'))
      };
    })()
  `);
  assert.ok(result.nodeTypes.includes('blank'), 'Tool Plus canvas API should expose the blank node type');
  assert.equal(result.blankRailButton, true, 'left rail must expose the blank node button');
  assert.equal(result.nodeCount, 1, 'embedded media should stay inside one blank node');
  assert.equal(result.blankType, 'blank');
  assert.equal(result.embeddedCount, 1);
  assert.equal(result.previewKind, 'video');
  assert.equal(result.shellWidth, '420px', 'blank node should use the fixed media-node width');
  assert.equal(result.shellHeight, '290px', 'blank node should use the fixed media-node height');
  assert.equal(result.videoInsideBlank, true, 'blank node must render embedded video inside the node');
  assert.equal(result.playButton, true, 'embedded video should use the custom play overlay');
  assert.equal(result.progressBar, true, 'embedded video should expose a custom progress bar');
  assert.equal(result.resizeControls, 0, 'nodes should not expose resize handles');
  assert.equal(result.modelMenu, false, 'a standalone blank node must not render a generation model menu');
  assert.equal(result.localAssetCount, 0, 'embedded media must not create a separate local_asset node');
}

async function verifyExternalNodeDrops(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const blank = api.addNode('blank', { position: { x: 120, y: 100 } });
      const video = api.addNode('video', { position: { x: 680, y: 100 } });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const dropFile = async (nodeId, file) => {
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const shell = document.querySelector('.react-flow__node[data-id="' + nodeId + '"]');
        shell.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 180, clientY: 160 }));
        shell.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 180, clientY: 160 }));
        const started = Date.now();
        while (Date.now() - started < 3000) {
          await new Promise(resolve => setTimeout(resolve, 30));
          const node = api.getGraph().nodes.find(item => item.id === nodeId);
          if (node?.data.embeddedMedia?.length) return node;
        }
        throw new Error('external node drop was not committed');
      };
      const converted = await dropFile(blank.id, new File(['image'], 'external-poster.png', { type: 'image/png', lastModified: 991 }));
      const videoAfterDrop = await dropFile(video.id, new File(['video'], 'external-reference.mp4', { type: 'video/mp4', lastModified: 992 }));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.querySelector('.react-flow__node[data-id="' + video.id + '"] button[title="选择画布素材或上传图片、视频和音频"]')?.click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        convertedType: converted.type,
        convertedMode: converted.data.generationMode,
        convertedReferences: converted.data.generationDrafts?.image?.references?.length || 0,
        videoType: videoAfterDrop.type,
        videoReferences: videoAfterDrop.data.generationDrafts?.video?.references?.length || 0,
        libraryText: document.querySelector('[role="listbox"][aria-label="选择画布素材"]')?.textContent || '',
        uploadInside: (() => {
          const panel = document.querySelector('[role="listbox"][aria-label="选择画布素材"]');
          const upload = panel?.querySelector('.fc-generation-reference-popover__upload');
          if (!panel || !upload) return false;
          const outer = panel.getBoundingClientRect();
          const inner = upload.getBoundingClientRect();
          return inner.left >= outer.left && inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;
        })(),
      };
    })()
  `);
  assert.equal(result.convertedType, 'image', 'dropping an image on a blank node must convert it to an image node');
  assert.equal(result.convertedMode, 'image');
  assert.equal(result.convertedReferences, 1, 'converted image node must retain the dropped local material');
  assert.equal(result.videoType, 'video');
  assert.equal(result.videoReferences, 1, 'video nodes must accept external video materials');
  assert.match(result.libraryText, /external-poster\.png/, 'uploaded local images must be reusable from the canvas material library');
  assert.equal(result.uploadInside, true, 'local upload footer must remain inside the material panel');
}

async function verifyLocalDag(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.sdk.import({
        schemaVersion: 1,
        id: 'local-dag',
        name: '真实本地 DAG',
        nodes: [
          {
            id: 'source', type: 'text_input', position: { x: 20, y: 80 },
            data: { title: '文本', description: 'source', prompt: 'world', status: 'idle', retryCount: 0, cache: false }
          },
          {
            id: 'transform', type: 'text_transform', position: { x: 360, y: 80 },
            data: { title: '模板', description: 'transform', prompt: 'HELLO {{input}}', status: 'idle', retryCount: 0, cache: false }
          },
          {
            id: 'result', type: 'output', position: { x: 700, y: 80 },
            data: { title: '输出', description: 'output', prompt: '', status: 'idle', retryCount: 0, cache: false }
          }
        ],
        edges: [
          { id: 'a', source: 'source', sourcePort: 'output', target: 'transform', targetPort: 'input', data: {} },
          { id: 'b', source: 'transform', sourcePort: 'output', target: 'result', targetPort: 'input', data: {} }
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
        metadata: { test: true }
      });
      const validation = api.sdk.validate();
      const run = await api.run({ useCache: false, stopOnError: true });
      await api.save();
      return {
        validation,
        status: run.status,
        source: run.outputs.source.output,
        transformed: run.outputs.transform.output,
        output: run.outputs.result.output,
        nodeStatuses: Object.values(run.nodeStates).map(state => state.status),
        saved: JSON.parse(localStorage.getItem(api.storageKey)),
        exported: JSON.parse(api.sdk.export()),
        lastRunStatus: api.getLastRun().status
      };
    })()
  `);
  assert.equal(result.validation.valid, true, JSON.stringify(result.validation.issues));
  assert.equal(result.status, 'success');
  assert.equal(result.source, 'world');
  assert.equal(result.transformed, 'HELLO world');
  assert.equal(result.output, 'HELLO world');
  assert.ok(result.nodeStatuses.every(status => status === 'success'));
  assert.equal(result.saved.nodes.length, 3);
  assert.equal(result.exported.edges.length, 2);
  assert.equal(result.lastRunStatus, 'success');
}

async function verifyImageHostBridge(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const image = api.addNode('image', { position: { x: 220, y: 120 } });
      const current = api.getGraph().nodes.find(node => node.id === image.id);
      const drafts = structuredClone(current.data.generationDrafts);
      drafts.image.prompt = '一只坐在蓝色窗边的橘猫，商业摄影';
      drafts.image.model = 'nano-banana-pro(特价版 1)';
      drafts.image.ratio = '3:2';
      drafts.image.quality = '高清画质 · 4K';
      const localReferenceURL = URL.createObjectURL(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }));
      drafts.image.references = [
        { id: 'local-reference', name: 'local.png', kind: 'image', mimeType: 'image/png', url: localReferenceURL },
        { id: 'remote-reference', name: 'remote.png', kind: 'image', url: 'https://example.com/reference.png' }
      ];
      api.sdk.engine.updateNodeData(image.id, {
        generationDrafts: drafts, prompt: drafts.image.prompt, model: drafts.image.model,
        preview: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xb9WAAAAAElFTkSuQmCC', previewKind: 'image'
      });
      let requestPayload = null;
      const responder = event => {
        const message = event.data;
        if (!message || message.type !== 'toolplus:canvas-request' || message.action !== 'image.generate') return;
        requestPayload = message.payload;
        window.postMessage({
          type: 'toolplus:canvas-response',
          requestId: message.requestId,
          result: { ok: true, data: {
            provider: 'tmlab-tasks', model: drafts.image.model, taskId: 'task-integration',
            status: 'completed', progress: 100,
            url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xb9WAAAAAElFTkSuQmCC',
            contentType: 'image/png', localPath: 'G:\\\\generated\\\\task-integration.png'
          } }
        }, '*');
      };
      window.addEventListener('message', responder);
      const run = await api.run({ useCache: false, stopOnError: true });
      window.removeEventListener('message', responder);
      URL.revokeObjectURL(localReferenceURL);
      const saved = api.getGraph().nodes.find(node => node.id === image.id);
      return {
        status: run.status,
        payload: requestPayload,
        previewKind: saved.data.previewKind,
        providerTaskId: saved.data.providerTaskId,
        fileName: saved.data.fileName
      };
    })()
  `);
  assert.equal(result.status, 'success', 'image node must complete through the host request bridge');
  assert.equal(result.payload.model, 'nano-banana-pro(特价版 1)');
  assert.equal(result.payload.size, '4K');
  assert.equal(result.payload.aspectRatio, '3:2');
  assert.deepEqual(result.payload.images, ['https://example.com/reference.png']);
  assert.deepEqual(result.payload.localAssets.map(item => [item.kind, item.role, item.name]), [['image', 'reference', 'local.png']]);
  assert.deepEqual(result.payload.imageReferenceOrder, [{ source: 'local', index: 0 }, { source: 'remote', index: 0 }]);
  assert.ok(result.payload.localAssets[0].bytes.byteLength > 0, 'local image reference must cross the bridge');
  assert.equal(result.previewKind, 'image');
  assert.equal(result.providerTaskId, 'task-integration');
  assert.equal(result.fileName, 'task-integration.png');
}

async function verifyParallelImageGeneration(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const first = api.addNode('image', { position: { x: 80, y: 80 } });
      const second = api.addNode('image', { position: { x: 720, y: 80 } });
      for (const [node, prompt] of [[first, '并行任务 A'], [second, '并行任务 B']]) {
        const current = api.getGraph().nodes.find(item => item.id === node.id);
        const drafts = structuredClone(current.data.generationDrafts);
        drafts.image.prompt = prompt;
        api.sdk.engine.updateNodeData(node.id, { generationDrafts: drafts, prompt });
      }
      const requests = [];
      const responder = event => {
        const message = event.data;
        if (!message || message.type !== 'toolplus:canvas-request' || message.action !== 'image.generate') return;
        requests.push(message);
      };
      window.addEventListener('message', responder);
      const started = performance.now();
      const pending = [
        api.sdk.engine.runNode(first.id, { useCache: false }),
        api.sdk.engine.runNode(second.id, { useCache: false })
      ];
      while (requests.length < 2 && performance.now() - started < 4000) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const waitingCount = document.querySelectorAll('.fc-generation-node__waiting').length;
      const waitingLabels = [...document.querySelectorAll('.fc-generation-node__waiting span')].map(element => element.textContent.trim());
      for (const [index, request] of requests.entries()) {
        window.postMessage({ type: 'toolplus:canvas-response', requestId: request.requestId, result: { ok: true, data: {
          provider: 'tmlab-tasks', model: 'nano-banana-pro(特价版 1)', taskId: 'parallel-' + index,
          status: 'completed', progress: 100,
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xb9WAAAAAElFTkSuQmCC',
          contentType: 'image/png', localPath: 'G:\\\\generated\\\\parallel-' + index + '.png'
        } } }, '*');
      }
      const runs = await Promise.all(pending);
      window.removeEventListener('message', responder);
      return {
        requestsBeforeResponse: requests.length,
        uniqueRequestIds: new Set(requests.map(request => request.requestId)).size,
        waitingCount,
        waitingLabels,
        statuses: runs.map(run => run.status),
        taskIds: [first.id, second.id].map(id => api.getGraph().nodes.find(node => node.id === id).data.providerTaskId)
      };
    })()
  `);
  assert.equal(result.requestsBeforeResponse, 2, 'two independent image nodes must reach the host before either response completes');
  assert.equal(result.uniqueRequestIds, 2, 'parallel requests must keep isolated request ids');
  assert.equal(result.waitingCount, 2, 'each running node must render its own waiting overlay');
  assert.ok(result.waitingLabels.every(label => /等待中|生成中/.test(label)), 'parallel node overlays must expose waiting or running state');
  assert.deepEqual(result.statuses, ['success', 'success']);
  assert.deepEqual(result.taskIds, ['parallel-0', 'parallel-1']);
}

async function verifyGeneratedNodeRestartPersistence(win) {
  const nodeId = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const created = api.addNode('image', { position: { x: 180, y: 90 } });
      const current = api.getGraph().nodes.find(node => node.id === created.id);
      const drafts = structuredClone(current.data.generationDrafts);
      drafts.image.prompt = '重启后仍保留完整图片生成节点';
      drafts.image.model = 'nano-banana-pro(特价版 1)';
      drafts.image.ratio = '16:9';
      drafts.image.quality = '标准画质 · 2K';
      api.sdk.engine.updateNodeData(created.id, {
        generationMode: 'image', generationDrafts: drafts, prompt: drafts.image.prompt,
        model: drafts.image.model, status: 'success', progress: 1,
        preview: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xb9WAAAAAElFTkSuQmCC',
        previewKind: 'image', mimeType: 'image/png', fileName: 'task_restart.png',
        providerTaskId: 'task_restart', provider: 'tmlab-tasks', generatedAt: new Date().toISOString(), previewOrigin: 'generated'
      });
      await api.save();
      return created.id;
    })()
  `);
  win.destroy();
  const reopened = await openCanvas();
  const restored = await reopened.webContents.executeJavaScript(`
    (() => {
      const node = window.__toolPlusCanvasSDK.getGraph().nodes.find(item => item.id === ${JSON.stringify(nodeId)});
      const shell = document.querySelector('.react-flow__node[data-id="${nodeId}"]');
      return {
        type: node?.type, mode: node?.data?.generationMode, taskId: node?.data?.providerTaskId,
        prompt: node?.data?.generationDrafts?.image?.prompt,
        composer: Boolean(shell?.querySelector('.fc-generation-composer')),
        imageTabActive: shell?.querySelector('[role="tab"][aria-label="图片生成"]')?.getAttribute('aria-selected')
      };
    })()
  `);
  assert.deepEqual(restored, {
    type: 'image', mode: 'image', taskId: 'task_restart', prompt: '重启后仍保留完整图片生成节点', composer: true, imageTabActive: 'true'
  }, 'generated image must reopen as a complete generation node instead of a material-only card');
  return reopened;
}

async function verifyMultiImageReferenceDagAndRerun(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const makeAsset = (name, byte) => api.addNode('local_asset', {
        position: { x: 80, y: 80 + byte * 180 },
        data: {
          title: name, fileName: name, mimeType: 'image/png', mediaType: 'image', previewKind: 'image', prompt: name + ' 的视觉语义',
          preview: URL.createObjectURL(new Blob([new Uint8Array([137,80,78,71,byte])], { type: 'image/png' }))
        }
      });
      const first = makeAsset('reference-a.png', 1);
      const second = makeAsset('reference-b.png', 2);
      const target = api.addNode('image', { position: { x: 620, y: 180 } });
      const current = api.getGraph().nodes.find(node => node.id === target.id);
      const drafts = structuredClone(current.data.generationDrafts);
      drafts.image.prompt = '融合两张参考图生成电影海报';
      api.sdk.engine.updateNodeData(target.id, { generationDrafts: drafts, prompt: drafts.image.prompt });
      api.sdk.addEdge({ source: first.id, sourcePort: 'output', target: target.id, targetPort: 'reference' });
      api.sdk.addEdge({ source: second.id, sourcePort: 'output', target: target.id, targetPort: 'reference' });
      let requestCount = 0;
      const payloads = [];
      const responder = event => {
        const message = event.data;
        if (!message || message.type !== 'toolplus:canvas-request' || message.action !== 'image.generate') return;
        requestCount += 1;
        payloads.push(message.payload);
        window.postMessage({ type: 'toolplus:canvas-response', requestId: message.requestId, result: { ok: true, data: {
          provider: 'tmlab-tasks', model: drafts.image.model, taskId: 'multi-' + requestCount,
          status: 'completed', progress: 100,
          url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xb9WAAAAAElFTkSuQmCC',
          contentType: 'image/png', localPath: 'G:\\\\generated\\\\multi-' + requestCount + '.png'
        } } }, '*');
      };
      window.addEventListener('message', responder);
      const firstRun = await api.sdk.engine.runNode(target.id, { useCache: false });
      const secondRun = await api.sdk.engine.runNode(target.id, { useCache: false });
      window.removeEventListener('message', responder);
      const definition = api.sdk.engine.registry.get('local_asset');
      return {
        firstStatus: firstRun.status,
        secondStatus: secondRun.status,
        requestCount,
        edgeCount: api.getGraph().edges.length,
        localAssetOutputType: definition.outputs[0].dataType,
        localAssetGenerationMode: api.getGraph().nodes.find(node => node.id === first.id).data.generationMode || '',
        referenceCounts: payloads.map(payload => payload.localAssets.length + payload.images.length),
        referenceNames: payloads[0].localAssets.map(item => item.name),
        effectivePrompt: payloads[0].prompt,
        finalTaskId: api.getGraph().nodes.find(node => node.id === target.id).data.providerTaskId
      };
    })()
  `);
  assert.equal(result.firstStatus, 'success');
  assert.equal(result.secondStatus, 'success');
  assert.equal(result.requestCount, 2, 'explicit regenerate must issue a fresh host request instead of reusing cache');
  assert.equal(result.edgeCount, 2, 'each upstream image must create its own edge to the shared reference port');
  assert.equal(result.localAssetOutputType, 'any', 'local image assets must not expose a JSON-only output');
  assert.equal(result.localAssetGenerationMode, '', 'material nodes must not masquerade as generation nodes');
  assert.deepEqual(result.referenceCounts, [2, 2], 'both connected image outputs must reach every backend request');
  assert.deepEqual(result.referenceNames.sort(), ['reference-a.png', 'reference-b.png']);
  assert.match(result.effectivePrompt, /reference-a\.png 的视觉语义/);
  assert.match(result.effectivePrompt, /reference-b\.png 的视觉语义/);
  assert.equal(result.finalTaskId, 'multi-2');
}

async function verifyVideoHostBridge(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const video = api.addNode('video', { position: { x: 220, y: 120 } });
      const current = api.getGraph().nodes.find(node => node.id === video.id);
      const drafts = structuredClone(current.data.generationDrafts);
      Object.assign(drafts.video, {
        prompt: '镜头缓慢向人物推进', model: 'seedance-2.0-fast', modeType: 'image2video',
        ratio: '9:16', resolution: '720p', duration: 15, enableSound: 'on',
        firstFrame: { id: 'first', name: 'first.png', kind: 'image', url: 'https://example.com/first.png' },
        lastFrame: { id: 'last', name: 'last.png', kind: 'image', url: 'https://example.com/last.png' }
      });
      api.sdk.engine.updateNodeData(video.id, {
        generationDrafts: drafts, prompt: drafts.video.prompt, model: drafts.video.model,
        preview: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+Xb9WAAAAAElFTkSuQmCC', previewKind: 'image'
      });
      let requestPayload = null;
      const progressSnapshots = [];
      const responder = async event => {
        const message = event.data;
        if (!message || message.type !== 'toolplus:canvas-request' || message.action !== 'video.generate') return;
        requestPayload = message.payload;
        window.postMessage({ type: 'toolplus:canvas-progress', requestId: message.requestId, status: 'in_progress', progress: .42, message: '平台生成进度 42%' }, '*');
        await new Promise(resolve => setTimeout(resolve, 40));
        const live = api.getGraph().nodes.find(node => node.id === video.id);
        progressSnapshots.push({ progress: live.data.progress, message: live.data.runMessage });
        window.postMessage({ type: 'toolplus:canvas-response', requestId: message.requestId, result: { ok: true, data: {
          provider: 'tmlab-tasks', model: drafts.video.model, taskId: 'video-integration', status: 'completed', progress: 1,
          url: 'data:video/mp4;base64,AAAA', contentType: 'video/mp4', localPath: 'G:\\\\generated\\\\video-integration.mp4'
        } } }, '*');
      };
      window.addEventListener('message', responder);
      const run = await api.run({ useCache: false, stopOnError: true });
      window.removeEventListener('message', responder);
      const saved = api.getGraph().nodes.find(node => node.id === video.id);
      const shell = document.querySelector('.react-flow__node[data-id="' + video.id + '"]');
      const input = shell.querySelector('.fc-generation-input').getBoundingClientRect();
      const footer = shell.querySelector('.fc-generation-parameters').getBoundingClientRect();
      const submit = shell.querySelector('.fc-generation-submit').getBoundingClientRect();
      const leftChildren = [...shell.querySelectorAll('.fc-generation-parameters__left > *')].map(item => item.getBoundingClientRect().right);
      return {
        status: run.status, payload: requestPayload, previewKind: saved.data.previewKind, progressSnapshots,
        taskId: saved.data.providerTaskId, fileName: saved.data.fileName,
        bounds: { input: { left: input.left, right: input.right, bottom: input.bottom }, footer: { left: footer.left, right: footer.right, bottom: footer.bottom }, submit: { left: submit.left, right: submit.right, bottom: submit.bottom }, maxLeftChildRight: Math.max(...leftChildren) }
      };
    })()
  `);
  assert.equal(result.status, 'success');
  assert.equal(result.payload.model, 'seedance-2.0-fast');
  assert.equal(result.payload.modeType, 'image2video');
  assert.equal(result.payload.ratio, '9:16');
  assert.equal(result.payload.resolution, '720p');
  assert.equal(result.payload.duration, 15);
  assert.equal(result.payload.enableSound, 'on');
  assert.ok(result.progressSnapshots.some(item => Math.abs(item.progress - .42) < .001 && item.message === '平台生成进度 42%'), `provider progress was not mapped to the node: ${JSON.stringify(result.progressSnapshots)}`);
  assert.deepEqual(result.payload.imageUrls, ['https://example.com/first.png', 'https://example.com/last.png']);
  assert.equal(result.previewKind, 'video');
  assert.equal(result.taskId, 'video-integration');
  assert.equal(result.fileName, 'video-integration.mp4');
  assert.ok(result.bounds.footer.left >= result.bounds.input.left && result.bounds.footer.right <= result.bounds.input.right + 1, 'parameter footer must stay inside the input panel');
  assert.ok(result.bounds.footer.bottom <= result.bounds.input.bottom + 1, `parameter footer must not protrude below the input panel: ${JSON.stringify(result.bounds)}`);
  assert.ok(result.bounds.submit.right <= result.bounds.input.right + 1 && result.bounds.submit.bottom <= result.bounds.input.bottom + 1, `submit button must stay inside the rounded input panel: ${JSON.stringify(result.bounds)}`);
  assert.ok(result.bounds.maxLeftChildRight <= result.bounds.submit.left - 2, 'parameter labels must not overlap the submit group');
}

async function verifyGeneratedVideoPlayback(win) {
  const reportPath = path.join(root, 'work', 'real-video-acceptance.json');
  if (!fs.existsSync(reportPath)) return { skipped: true };
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const localPath = report?.result?.data?.localPath;
  if (!report.passed || !localPath || !fs.existsSync(localPath)) return { skipped: true };
  const source = pathToFileURL(localPath).href;
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const node = api.addNode('video', { position: { x: 220, y: 100 }, data: {
        preview: ${JSON.stringify(source)}, previewKind: 'video', mimeType: 'video/mp4', fileName: 'real-seedance.mp4'
      } });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const video = document.querySelector('.react-flow__node[data-id="' + node.id + '"] video');
      if (!video) return { found: false };
      await new Promise(resolve => {
        if (video.readyState >= 1) resolve();
        else { video.addEventListener('loadedmetadata', resolve, { once: true }); setTimeout(resolve, 5000); }
      });
      return { found: true, source: video.currentSrc || video.src, readyState: video.readyState, duration: video.duration };
    })()
  `);
  assert.equal(result.found, true, 'real generated video must render inside the video node');
  assert.ok(result.readyState >= 1, 'real generated video metadata must load in the node');
  assert.ok(result.duration >= 4 && result.duration < 5, `unexpected video duration ${result.duration}`);
  return result;
}

async function verifyLocalVideoMaterialBridge(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const video = api.addNode('video', { position: { x: 220, y: 120 } });
      const current = api.getGraph().nodes.find(node => node.id === video.id);
      const drafts = structuredClone(current.data.generationDrafts);
      const imageURL = URL.createObjectURL(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])], { type: 'image/png' }));
      const lastImageURL = URL.createObjectURL(new Blob([new Uint8Array([137,80,78,71,13,10,26,10,1])], { type: 'image/png' }));
      const audioURL = URL.createObjectURL(new Blob([new Uint8Array([82,73,70,70,1,2,3,4])], { type: 'audio/wav' }));
	  const videoURL = URL.createObjectURL(new Blob([new Uint8Array([0,0,0,24,102,116,121,112])], { type: 'video/mp4' }));
      Object.assign(drafts.video, {
        prompt: '本地首帧和音频参考', model: 'seedance-2.0-fast', modeType: 'text2video',
        ratio: '16:9', resolution: '480p', duration: 5, enableSound: 'on',
        firstFrame: { id: 'local-first', name: 'first.png', kind: 'image', mimeType: 'image/png', url: imageURL },
		lastFrame: { id: 'local-last', name: 'last.png', kind: 'image', mimeType: 'image/png', url: lastImageURL },
		references: [
		  { id: 'local-audio', name: 'voice.wav', kind: 'audio', mimeType: 'audio/wav', url: audioURL },
		  { id: 'local-video', name: 'motion.mp4', kind: 'video', mimeType: 'video/mp4', url: videoURL }
		]
      });
      api.sdk.engine.updateNodeData(video.id, { generationDrafts: drafts, prompt: drafts.video.prompt, model: drafts.video.model });
      let requestPayload = null;
      const responder = event => {
        const message = event.data;
        if (!message || message.type !== 'toolplus:canvas-request' || message.action !== 'video.generate') return;
        requestPayload = message.payload;
        window.postMessage({ type: 'toolplus:canvas-response', requestId: message.requestId, result: { ok: true, data: {
          provider: 'tmlab-tasks', model: drafts.video.model, taskId: 'local-material-integration', status: 'completed', progress: 1,
          url: 'data:video/mp4;base64,AAAA', contentType: 'video/mp4', localPath: 'G:\\\\generated\\\\local-material-integration.mp4'
        } } }, '*');
      };
      window.addEventListener('message', responder);
      const run = await api.run({ useCache: false, stopOnError: true });
      window.removeEventListener('message', responder);
	  URL.revokeObjectURL(imageURL); URL.revokeObjectURL(lastImageURL); URL.revokeObjectURL(audioURL); URL.revokeObjectURL(videoURL);
      return {
        status: run.status,
        modeType: requestPayload?.modeType,
        localAssets: (requestPayload?.localAssets || []).map(item => ({ kind: item.kind, role: item.role, name: item.name, bytes: item.bytes?.byteLength || 0 }))
      };
    })()
  `);
  assert.equal(result.status, 'success');
  assert.equal(result.modeType, 'mixed2video', 'local audio reference must select mixed2video');
	assert.deepEqual(result.localAssets.map(item => [item.kind, item.role]), [['image', 'firstFrame'], ['image', 'lastFrame'], ['audio', 'reference'], ['video', 'reference']]);
  assert.ok(result.localAssets.every(item => item.bytes > 0), 'local materials must cross the bridge with non-empty bytes');
}

async function verifyConnectedVideoMaterials(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.reset();
      const makeAsset = (title, kind, mimeType, bytes, x, y) => {
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }));
        const node = api.addNode('local_asset', { position: { x, y }, data: {
          title, fileName: title, preview: url, previewKind: kind, mediaType: kind, mimeType, status: 'idle'
        } });
        return { node, url };
      };
      const imageA = makeAsset('frame-a.png', 'image', 'image/png', [137,80,78,71,13,10,26,10], 20, 20);
      const imageB = makeAsset('frame-b.png', 'image', 'image/png', [137,80,78,71,13,10,26,10,1], 20, 260);
      const videoRef = makeAsset('motion.mp4', 'video', 'video/mp4', [0,0,0,24,102,116,121,112], 20, 500);
      const addVideoTarget = (prompt, y) => {
        const target = api.addNode('video', { position: { x: 720, y } });
        const current = api.getGraph().nodes.find(node => node.id === target.id);
        const drafts = structuredClone(current.data.generationDrafts);
        Object.assign(drafts.video, { prompt, model: 'seedance-2.0-pro(431)', modeType: 'image2video', ratio: '16:9', resolution: '720p', duration: 4, enableSound: 'off' });
        api.sdk.engine.updateNodeData(target.id, { generationDrafts: drafts, prompt, model: drafts.video.model });
        return target;
      };
      const frames = addVideoTarget('连接图片填入首尾帧', 40);
      const references = addVideoTarget('连接图片和视频作为参考素材', 720);
      api.sdk.addEdge({ source: imageA.node.id, sourcePort: 'output', target: frames.id, targetPort: 'image' });
      api.sdk.addEdge({ source: imageB.node.id, sourcePort: 'output', target: frames.id, targetPort: 'image' });
      api.sdk.addEdge({ source: imageA.node.id, sourcePort: 'output', target: references.id, targetPort: 'image' });
      api.sdk.addEdge({ source: videoRef.node.id, sourcePort: 'output', target: references.id, targetPort: 'image' });
      const payloads = [];
      const responder = event => {
        const message = event.data;
        if (!message || message.type !== 'toolplus:canvas-request' || message.action !== 'video.generate') return;
        payloads.push(message.payload);
        window.postMessage({ type: 'toolplus:canvas-response', requestId: message.requestId, result: { ok: true, data: {
          provider: 'tmlab-tasks', model: message.payload.model, taskId: 'connected-' + payloads.length, status: 'completed', progress: 1,
          url: 'data:video/mp4;base64,AAAA', contentType: 'video/mp4', localPath: 'G:\\\\generated\\\\connected-' + payloads.length + '.mp4'
        } } }, '*');
      };
      window.addEventListener('message', responder);
      const run = await api.run({ useCache: false, stopOnError: true });
      window.removeEventListener('message', responder);
      [imageA.url, imageB.url, videoRef.url].forEach(url => URL.revokeObjectURL(url));
      return { status: run.status, payloads: payloads.map(payload => ({ prompt: payload.prompt, localAssets: payload.localAssets.map(item => ({ name: item.name, kind: item.kind, role: item.role, bytes: item.bytes?.byteLength || 0 })) })) };
    })()
  `);
  assert.equal(result.status, 'success');
  const framePayload = result.payloads.find(payload => payload.prompt === '连接图片填入首尾帧');
  const referencePayload = result.payloads.find(payload => payload.prompt === '连接图片和视频作为参考素材');
  assert.deepEqual(framePayload.localAssets.map(item => [item.name, item.kind, item.role]), [
    ['frame-a.png', 'image', 'firstFrame'], ['frame-b.png', 'image', 'lastFrame']
  ]);
  assert.deepEqual(referencePayload.localAssets.map(item => [item.name, item.kind, item.role]), [
    ['frame-a.png', 'image', 'reference'], ['motion.mp4', 'video', 'reference']
  ]);
  assert.ok([...framePayload.localAssets, ...referencePayload.localAssets].every(item => item.bytes > 0));
}

async function verifyRestartPersistence(win) {
  win.destroy();
  const reopened = await openCanvas();
  const persisted = await reopened.webContents.executeJavaScript(`
    (() => ({
      graph: window.__toolPlusCanvasSDK.getGraph(),
      stored: JSON.parse(localStorage.getItem(window.__toolPlusCanvasSDK.storageKey))
    }))()
  `);
  assert.equal(persisted.graph.id, 'local-dag');
  assert.equal(persisted.graph.nodes.length, 3);
  assert.equal(persisted.graph.edges.length, 2);
  assert.equal(persisted.stored.metadata.persistence, 'local-only');
  assert.equal(persisted.stored.metadata.networkAccess, false);

  const history = await reopened.webContents.executeJavaScript(`
    (() => {
      const api = window.__toolPlusCanvasSDK;
      const before = api.getGraph().nodes.length;
      api.addText('撤销重做验收');
      const afterAdd = api.getGraph().nodes.length;
      const undone = api.undo();
      const afterUndo = api.getGraph().nodes.length;
      const redone = api.redo();
      return { before, afterAdd, undone, afterUndo, redone, afterRedo: api.getGraph().nodes.length };
    })()
  `);
  assert.equal(history.afterAdd, history.before + 1);
  assert.equal(history.undone, true);
  assert.equal(history.afterUndo, history.before);
  assert.equal(history.redone, true);
  assert.equal(history.afterRedo, history.before + 1);
  return reopened;
}

async function verifyCancellation(win) {
  const cancelled = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.sdk.import({
        schemaVersion: 1,
        id: 'cancel-local',
        name: '本地取消',
        nodes: [
          { id: 'start', type: 'text_input', position: { x: 0, y: 0 }, data: { title: '开始', prompt: 'value', status: 'idle', retryCount: 0, cache: false } },
          { id: 'wait', type: 'delay', position: { x: 320, y: 0 }, data: { title: '等待', prompt: '1500', status: 'idle', retryCount: 0, cache: false } },
          { id: 'end', type: 'output', position: { x: 640, y: 0 }, data: { title: '结束', prompt: '', status: 'idle', retryCount: 0, cache: false } }
        ],
        edges: [
          { id: 'c1', source: 'start', sourcePort: 'output', target: 'wait', targetPort: 'input', data: {} },
          { id: 'c2', source: 'wait', sourcePort: 'output', target: 'end', targetPort: 'input', data: {} }
        ],
        viewport: { x: 0, y: 0, zoom: 1 },
        metadata: {}
      });
      const started = performance.now();
      const pending = api.run({ useCache: false });
      setTimeout(() => api.cancel(), 100);
      const result = await pending;
      return {
        status: result.status,
        elapsed: performance.now() - started,
        waitStatus: result.nodeStates.wait.status,
        endStatus: result.nodeStates.end.status
      };
    })()
  `);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.waitStatus, 'cancelled');
  assert.equal(cancelled.endStatus, 'cancelled');
  assert.ok(cancelled.elapsed < 1000, `cancellation took too long: ${cancelled.elapsed}ms`);
}

async function verifyPrototypeId(win) {
  const result = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      api.sdk.import({
        schemaVersion: 1,
        id: 'prototype-id',
        name: '原型键 ID',
        nodes: [{
          id: '__proto__',
          type: 'text_input',
          position: { x: 10, y: 10 },
          data: { title: '安全 ID', prompt: 'safe', status: 'idle', retryCount: 0, cache: false }
        }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        metadata: {}
      });
      const run = await api.run({ useCache: false });
      return {
        status: run.status,
        hasState: Object.prototype.hasOwnProperty.call(run.nodeStates, '__proto__'),
        hasOutput: Object.prototype.hasOwnProperty.call(run.outputs, '__proto__'),
        value: run.outputs['__proto__'].output
      };
    })()
  `);
  assert.equal(result.status, 'success');
  assert.equal(result.hasState, true);
  assert.equal(result.hasOutput, true);
  assert.equal(result.value, 'safe');
}

async function verifyCloseFallback(win) {
  await win.webContents.executeJavaScript(`
    (() => {
      const api = window.__toolPlusCanvasSDK;
      api.sdk.import({
        schemaVersion: 1,
        id: 'close-fallback',
        name: '关闭保存',
        nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, metadata: {}
      });
      api.addText('关闭窗口前 450ms 内的未刷盘草稿');
    })()
  `);
  win.showInactive();
  await new Promise(resolve => setTimeout(resolve, 80));
  const closed = await new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), 5000);
    win.once('closed', () => {
      clearTimeout(timer);
      resolve(true);
    });
    win.close();
  });
  if (!closed) throw new Error('Canvas verification window did not close after win.close().');
  const reopened = await openCanvas();
  const preserved = await reopened.webContents.executeJavaScript(`
    window.__toolPlusCanvasSDK.getGraph().nodes.some(
      node => node.data.prompt === '关闭窗口前 450ms 内的未刷盘草稿'
    )
  `);
  assert.equal(preserved, true, 'real window close must synchronously preserve the latest draft');
  return reopened;
}

async function verifyLargeGraphNodes(win) {
  const stress = await win.webContents.executeJavaScript(`
    (async () => {
      const api = window.__toolPlusCanvasSDK;
      const started = performance.now();
      const nodeCount = 1200;
      const nodes = Array.from({ length: nodeCount }, (_, index) => ({
        id: 'stress-' + index,
        type: 'text_input',
        position: { x: (index % 100) * 280, y: Math.floor(index / 100) * 170 },
        data: { title: '节点 ' + index, prompt: 'value-' + index, status: 'idle', retryCount: 0, cache: false }
      }));
      api.sdk.import({
        schemaVersion: 1,
        id: 'stress-large-graph',
        name: nodeCount + ' 节点简单压力',
        nodes,
        edges: [],
        viewport: { x: 0, y: 0, zoom: 0.5 },
        metadata: { stress: true }
      });
      const validation = api.sdk.validate();
      const exported = JSON.parse(api.sdk.export(0));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        elapsed: performance.now() - started,
        valid: validation.valid,
        issues: validation.issues.length,
        nodes: exported.nodes.length,
        uniqueIds: new Set(exported.nodes.map(node => node.id)).size,
        rendererResponsive: Boolean(document.querySelector('[data-testid="flowcanvas-sdk"]')),
        liveNodes: api.getGraph().nodes.length
      };
    })()
  `);
  assert.equal(stress.valid, true);
  assert.equal(stress.issues, 0);
  assert.equal(stress.nodes, 1200);
  assert.equal(stress.uniqueIds, 1200);
  assert.equal(stress.liveNodes, 1200);
  assert.equal(stress.rendererResponsive, true, 'Electron renderer must remain responsive after the large-node render commit');
  assert.ok(stress.elapsed < 30000, `large-node import/validate/export took ${stress.elapsed}ms`);
  return stress;
}

app.on('window-all-closed', event => event.preventDefault());

app.whenReady().then(async () => {
  verifyStaticIsolation();
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      networkRequests.push(details.url);
      callback({ cancel: true });
    }
  );

  let win;
  const step = async (label, action) => {
    process.stdout.write(`[native-canvas] ${label}... `);
    const value = await action();
    process.stdout.write('ok\n');
    return value;
  };
  try {
    win = await step('openCanvas', openCanvas);
    await step('reset', () => win.webContents.executeJavaScript(`
      localStorage.clear();
      window.__toolPlusCanvasSDK.reset();
    `));
    await step('verifyBootAndIsolation', () => verifyBootAndIsolation(win));
    await step('verifyGenerationSurface', () => verifyGenerationSurface(win));
    await step('verifyLegacyMigration', () => verifyLegacyMigration(win));
    await step('verifyAssetMetadata', () => verifyAssetMetadata(win));
    await step('verifyBlankEmbeddedMedia', () => verifyBlankEmbeddedMedia(win));
    await step('verifyExternalNodeDrops', () => verifyExternalNodeDrops(win));
    await step('verifyImageHostBridge', () => verifyImageHostBridge(win));
    win = await step('verifyGeneratedNodeRestartPersistence', () => verifyGeneratedNodeRestartPersistence(win));
    await step('verifyParallelImageGeneration', () => verifyParallelImageGeneration(win));
    await step('verifyMultiImageReferenceDagAndRerun', () => verifyMultiImageReferenceDagAndRerun(win));
    await step('verifyVideoHostBridge', () => verifyVideoHostBridge(win));
	await step('verifyLocalVideoMaterialBridge', () => verifyLocalVideoMaterialBridge(win));
    await step('verifyConnectedVideoMaterials', () => verifyConnectedVideoMaterials(win));
    await step('verifyGeneratedVideoPlayback', () => verifyGeneratedVideoPlayback(win));
    await step('verifyLocalDag', () => verifyLocalDag(win));
    const screenshot = await step('capture', () => capture(win, 'flowcanvas-sdk-local-only'));
    win = await step('verifyRestartPersistence', () => verifyRestartPersistence(win));
    await step('verifyCancellation', () => verifyCancellation(win));
    await step('verifyPrototypeId', () => verifyPrototypeId(win));
    win = await step('verifyCloseFallback', () => verifyCloseFallback(win));
    const stress = process.env.TOOLPLUS_SKIP_STRESS === '1'
      ? null
      : await step('verifyLargeGraphNodes', () => verifyLargeGraphNodes(win));
    const fixturePreviewUrls = new Set([
      'https://example.com/reference.png',
      'https://example.com/first.png',
      'https://example.com/last.png',
    ]);
    assert.deepEqual(networkRequests.filter(url => !fixturePreviewUrls.has(url)), [], `canvas attempted unexpected network requests: ${networkRequests.join(', ')}`);
    console.log([
      'PASS toolplus-flowcanvas-local-only',
      'electron-sandbox',
      'empty-preload-bridge',
      'csp-connect-local-only',
      'zero-network-requests',
      'generation-node-ui-four-modes-and-edge',
      'legacy-safe-migration',
      'asset-metadata-no-path',
      'blank-embedded-media',
      'external-node-drop-and-local-library',
      'image-host-bridge',
      'multi-image-reference-dag-and-rerun',
      'video-host-bridge',
      'real-video-node-playback',
      'visible-delete-selected-assets',
      'local-dag-dataflow',
      'restart-persistence',
      'undo-redo',
      'local-cancellation',
      'prototype-key-node-type',
      'prototype-key-node-id',
      'real-window-close-fallback',
      stress ? `stress-1200=${Math.round(stress.elapsed)}ms` : 'stress-skipped',
      `screenshot=${screenshot}`
    ].join(' '));
  } finally {
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) window.destroy();
    });
    app.quit();
  }
}).catch(error => {
  console.error(error);
  app.exit(1);
});
