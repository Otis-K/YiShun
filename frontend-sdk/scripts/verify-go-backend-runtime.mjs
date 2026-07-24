import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sdkRoot = path.resolve(__dirname, '..');
const backendRoot = path.resolve(sdkRoot, '..', 'FlowCanvas-Backend-SDK');
const goExe = process.env.GO_EXE || 'G:\\DevEnv\\go_1_24_13\\bin\\go.exe';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      server.close(() => reject(new Error('Failed to allocate TCP port.')));
      return;
    }
    const { port } = address;
    server.close(() => resolve(port));
  });
  server.on('error', reject);
});

const waitForHealth = async baseURL => {
  const deadline = Date.now() + 30000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseURL}/health`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(300);
  }
  throw lastError ?? new Error('Go backend health check timed out.');
};

const createGraph = delayMs => ({
  schemaVersion: 1,
  id: `frontend-go-acceptance-${delayMs}`,
  name: 'Frontend SDK -> Go Backend SDK acceptance',
  nodes: [
    { id: 'text-1', type: 'prompt', position: { x: 80, y: 80 }, data: { title: '故事', prompt: '霓虹雨夜里的追逐故事', delayMs } },
    { id: 'image-1', type: 'image', position: { x: 420, y: 80 }, data: { title: '画面', prompt: '霓虹雨夜，电影感', delayMs } },
    { id: 'video-1', type: 'video', position: { x: 760, y: 80 }, data: { title: '镜头', prompt: '镜头推进', duration: 5, delayMs } },
  ],
  edges: [
    { id: 'edge-text-image', source: 'text-1', sourcePort: 'text', target: 'image-1', targetPort: 'prompt' },
    { id: 'edge-image-video', source: 'image-1', sourcePort: 'image', target: 'video-1', targetPort: 'image' },
    { id: 'edge-text-video', source: 'text-1', sourcePort: 'text', target: 'video-1', targetPort: 'prompt' },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  metadata: { acceptance: 'frontend-go-backend-runtime' },
});

const main = async () => {
  const port = await getFreePort();
  const baseURL = `http://127.0.0.1:${port}/api/flow`;
  const tmpDir = path.join(backendRoot, 'tmp', 'frontend-go-acceptance');
  const serverExe = path.join(tmpDir, process.platform === 'win32' ? 'flowcanvas-backend-acceptance-server.exe' : 'flowcanvas-backend-acceptance-server');
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  const build = spawnSync(goExe, ['build', '-o', serverExe, './examples/server'], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`Go backend example server build failed:\n${build.stdout}\n${build.stderr}`);
  }
  const server = spawn(serverExe, ['-addr', `127.0.0.1:${port}`], {
    cwd: backendRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  server.stdout.on('data', chunk => { stdout += chunk.toString(); });
  server.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    console.error('[go-backend-acceptance] waiting for Go server health');
    await waitForHealth(baseURL);
    console.error('[go-backend-acceptance] importing built frontend SDK');
    const sdk = await import(pathToFileURL(path.join(sdkRoot, 'dist', 'index.js')).href);
    const {
      CanvasEngine,
      GoBackendWorkflowRuntime,
      builtinNodeDefinitions,
    } = sdk;

    console.error('[go-backend-acceptance] running CanvasEngine through Go backend');
    const runtime = new GoBackendWorkflowRuntime({ baseURL });
    const engine = new CanvasEngine({ graph: createGraph(20), runtime });
    for (const definition of builtinNodeDefinitions) engine.registerNodeType(definition);
    const nodeEvents = [];
    engine.on('run:node', state => nodeEvents.push(`${state.nodeId}:${state.status}:${state.progress}`));
    const result = await engine.run({ useCache: false, stopOnError: true });
    if (result.status !== 'success') throw new Error(`Expected success run, got ${result.status}: ${result.error ?? ''}`);
    if (!result.outputs['video-1']?.video) throw new Error('Expected Go backend video output.');
    if (!nodeEvents.some(item => item.startsWith('text-1:running:'))) throw new Error(`Missing text running event: ${nodeEvents.join(',')}`);
    if (!nodeEvents.includes('video-1:success:1')) throw new Error(`Missing video success event: ${nodeEvents.join(',')}`);

    console.error('[go-backend-acceptance] checking Go backend validation');
    const invalid = createGraph(0);
    invalid.nodes[0].data.prompt = '';
    const remoteValidation = await runtime.validate(invalid);
    if (remoteValidation.valid) throw new Error('Expected Go backend validation to reject empty prompt.');
    if (!remoteValidation.issues.some(issue => issue.code === 'NODE_CONFIGURATION_INVALID')) {
      throw new Error(`Expected NODE_CONFIGURATION_INVALID, got ${JSON.stringify(remoteValidation.issues)}`);
    }

    console.error('[go-backend-acceptance] checking frontend cancel -> Go cancel');
    const cancelEngine = new CanvasEngine({ graph: createGraph(700), runtime: new GoBackendWorkflowRuntime({ baseURL }) });
    for (const definition of builtinNodeDefinitions) cancelEngine.registerNodeType(definition);
    const cancelRun = cancelEngine.run({ useCache: false, stopOnError: true });
    setTimeout(() => cancelEngine.cancel(), 80);
    const cancelled = await cancelRun;
    if (cancelled.status !== 'cancelled') throw new Error(`Expected cancelled run, got ${cancelled.status}`);

    const summary = {
      ok: true,
      baseURL,
      checks: [
        'Go example server health',
        'CanvasEngine uses GoBackendWorkflowRuntime',
        'frontend graph -> Go validate -> Go run -> SSE -> frontend states',
        'text -> image -> video output',
        'Go validation rejects empty prompt',
        'frontend cancel -> Go cancel -> cancelled result',
      ],
      nodeEventCount: nodeEvents.length,
      outputKeys: Object.keys(result.outputs),
      cancelledStatus: cancelled.status,
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (process.platform === 'win32' && server.pid) {
      spawnSync('taskkill.exe', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill('SIGKILL');
    }
    await delay(300);
    if (process.env.FLOWCANVAS_ACCEPTANCE_DEBUG === '1') {
      console.error(stdout);
      console.error(stderr);
    }
    rmSync(tmpDir, { recursive: true, force: true });
  }
};

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
