const { app, BrowserWindow, ipcMain, dialog, shell, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { TaskManager, validateTaskPayload } = require('./task-manager');
const { WorkflowManager } = require('./workflow-manager');
const { loadSettingsFile, saveSettingsFile } = require('./settings-store');
const { materializeCanvasAssets } = require('./canvas-assets');
const { initializeDataRoot, scheduleDataRoot } = require('./data-root');
const { ModelTaskQueue } = require('./model-task-queue');
const { ModelLibrary } = require('./model-library');
const { friendlyModelError, normalizeAPIKey } = require('./model-credentials');

// Electron/Playwright explicitly pass --user-data-dir for isolated profiles.
// Honour that switch without changing the user's persistent registry choice.
const userDataArgument = process.argv.find(value => String(value).startsWith('--user-data-dir='));
const explicitUserDataRoot = userDataArgument ? path.resolve(userDataArgument.slice('--user-data-dir='.length)) : '';
const dataRootInitialization = explicitUserDataRoot
  ? { dataRoot: explicitUserDataRoot, migratedFrom: '', copied: [] }
  : initializeDataRoot();
app.setPath('userData', dataRootInitialization.dataRoot);

const DEFAULT_WORKSPACE_ROOT = 'G:\\tool-user-file';
const DEFAULT_MODEL_BASE_URL = 'https://api.tmlab.store';
const DEFAULT_IMAGE_MODEL = 'nano-banana-pro(特价版 1)';
const DEFAULT_VIDEO_MODEL = 'seedance-2.0-pro(431)';
const MODEL_CAPABILITIES = ['image', 'video'];

let mainWindow = null;
let taskManager = null;
let workflowManager = null;
let modelLibrary = null;

// Keep enough parallelism for independent canvas nodes while bounding local
// Go child processes and provider polling pressure.
const modelTaskQueue = new ModelTaskQueue(5);
const canvasGenerationControllers = new Map();

function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  return loadSettingsFile(settingsPath(), DEFAULT_WORKSPACE_ROOT);
}

function saveSettings(settings) {
  return saveSettingsFile(settingsPath(), settings, DEFAULT_WORKSPACE_ROOT);
}

async function ensureWorkspace(workspaceRoot) {
  const response = await runBackend(['catalog']);
  if (!response.ok) throw new Error(response.error || 'Cannot load tool catalog');
  for (const tool of response.tools) {
    fs.mkdirSync(path.join(workspaceRoot, tool.key, 'input'), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, tool.key, 'output'), { recursive: true });
  }
}

function backendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin', 'toolplus-backend.exe');
  }
  return path.join(__dirname, '..', 'bin', 'toolplus-backend.exe');
}

function flowCanvasBackendPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', 'flowcanvas-backend.exe');
  return path.join(__dirname, '..', 'bin', 'flowcanvas-backend.exe');
}

function normalizedModelProfiles(settings = loadSettings()) {
  const legacy = settings.canvasModel && typeof settings.canvasModel === 'object' ? settings.canvasModel : {};
  const stored = settings.canvasModels && typeof settings.canvasModels === 'object' ? settings.canvasModels : {};
  const legacyModel = String(legacy.model || '').trim();
  const legacyCapability = /^seedance-/i.test(legacyModel) ? 'video' : 'image';
  const profile = (capability, defaultModel) => {
    const current = stored[capability] && typeof stored[capability] === 'object' ? stored[capability] : {};
    const compatibleLegacy = legacyCapability === capability ? legacy : {};
    return {
      baseURL: current.baseURL || compatibleLegacy.baseURL || DEFAULT_MODEL_BASE_URL,
      model: current.model || compatibleLegacy.model || defaultModel,
      encryptedAPIKey: current.encryptedAPIKey || compatibleLegacy.encryptedAPIKey || ''
    };
  };
  return { image: profile('image', DEFAULT_IMAGE_MODEL), video: profile('video', DEFAULT_VIDEO_MODEL) };
}

function publicModelSettings() {
  const profiles = normalizedModelProfiles();
  const publicProfile = profile => ({
    configured: Boolean(profile.encryptedAPIKey), baseURL: profile.baseURL, model: profile.model,
    apiKeyHint: profile.encryptedAPIKey ? '已安全保存' : '未配置'
  });
  const image = publicProfile(profiles.image);
  const video = publicProfile(profiles.video);
  return { ok: true, profiles: { image, video }, image, video, ...image };
}

function decryptModelAPIKey(capability) {
  const profile = normalizedModelProfiles()[capability];
  const encrypted = profile && profile.encryptedAPIKey;
  const label = capability === 'video' ? '视频' : '图片';
  if (!encrypted) throw new Error(`请先在设置中配置${label}模型 API Key。`);
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法使用安全凭据存储。');
  let decrypted;
  try {
    decrypted = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  } catch (_) {
    throw new Error(`${label}模型 API Key 无法解密，请在设置中重新保存。`);
  }
  const apiKey = normalizeAPIKey(decrypted);
  if (!apiKey) throw new Error(`请先在设置中配置${label}模型 API Key。`);
  return apiKey;
}

function saveModelSettings(payload = {}) {
  const settings = loadSettings();
  const profiles = normalizedModelProfiles(settings);
  const requested = payload.profiles && typeof payload.profiles === 'object' ? payload.profiles : { image: payload };
  for (const capability of MODEL_CAPABILITIES) {
    const update = requested[capability];
    if (!update || typeof update !== 'object') continue;
    const baseURL = String(update.baseURL || profiles[capability].baseURL || DEFAULT_MODEL_BASE_URL).trim().replace(/\/+$/, '');
    const defaultModel = capability === 'video' ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL;
    const model = String(update.model || profiles[capability].model || defaultModel).trim();
    let parsed;
    try { parsed = new URL(baseURL); } catch (_) { return { ok: false, error: `${capability === 'video' ? '视频' : '图片'}模型 API 地址无效。` }; }
    if (parsed.protocol !== 'https:') return { ok: false, error: '模型 API 地址必须使用 HTTPS。' };
    if (!model) return { ok: false, error: '模型名称不能为空。' };
    let encryptedAPIKey = profiles[capability].encryptedAPIKey || '';
    const apiKey = normalizeAPIKey(update.apiKey);
    const currentBaseURL = String(profiles[capability].baseURL || DEFAULT_MODEL_BASE_URL).trim().replace(/\/+$/, '');
    if (encryptedAPIKey && baseURL !== currentBaseURL && !apiKey) {
      return { ok: false, error: `修改${capability === 'video' ? '视频' : '图片'}模型 API 地址时必须重新输入 API Key。` };
    }
    if (apiKey) {
      if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: '当前系统无法使用安全凭据存储。' };
      encryptedAPIKey = safeStorage.encryptString(apiKey).toString('base64');
    }
    profiles[capability] = { baseURL, model, encryptedAPIKey };
  }
  const next = { ...settings, canvasModels: profiles };
  delete next.canvasModel;
  saveSettings(next);
  return publicModelSettings();
}

function runFlowCanvasBackend(payload, signal, onProgress) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) { reject(new DOMException('Generation cancelled.', 'AbortError')); return; }
    const action = payload && payload.action === 'video.generate' ? 'video.generate' : 'image.generate';
    const capability = action === 'video.generate' ? 'video' : 'image';
    const modelSettings = normalizedModelProfiles()[capability];
    let apiKey;
    try { apiKey = decryptModelAPIKey(capability); } catch (error) { reject(error); return; }
    const outputDir = path.join(app.getPath('userData'), 'canvas-assets', action === 'video.generate' ? 'videos' : 'images');
    fs.mkdirSync(outputDir, { recursive: true });
    let staged;
    try { staged = materializeCanvasAssets(payload && payload.localAssets, path.join(app.getPath('userData'), 'canvas-assets')); } catch (error) { reject(error); return; }
    const configuredModel = String(modelSettings.model || (capability === 'video' ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL)).trim();
    const requestedModel = String(payload && payload.model || '').trim();
    if (requestedModel && requestedModel !== configuredModel) {
      staged.cleanup();
      reject(new Error(`节点模型与${capability === 'video' ? '视频' : '图片'}模型配置不一致，请在设置中切换模型。`));
      return;
    }
    const request = {
      action,
      prompt: String(payload && payload.prompt || '').trim(),
      model: configuredModel,
      size: String(payload && payload.size || '').trim(),
      aspectRatio: String(payload && payload.aspectRatio || '').trim(),
      images: Array.isArray(payload && payload.images) ? payload.images : [],
      imageReferenceOrder: Array.isArray(payload && payload.imageReferenceOrder) ? payload.imageReferenceOrder : [],
      parameters: payload && payload.parameters && typeof payload.parameters === 'object' ? payload.parameters : {},
      modeType: String(payload && payload.modeType || '').trim(),
      ratio: String(payload && payload.ratio || '').trim(),
      resolution: String(payload && payload.resolution || '').trim(),
      duration: Number(payload && payload.duration || 0),
      enableSound: String(payload && payload.enableSound || '').trim(),
      imageUrls: Array.isArray(payload && payload.imageUrls) ? payload.imageUrls : [],
      audioUrls: Array.isArray(payload && payload.audioUrls) ? payload.audioUrls : [],
      mixedList: Array.isArray(payload && payload.mixedList) ? payload.mixedList : [],
	  localAssets: staged.assets,
      outputDir
    };
    const child = spawn(flowCanvasBackendPath(), [], {
      cwd: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
      windowsHide: true,
      env: {
        ...process.env,
        FLOWCANVAS_MODEL_API_KEY: apiKey,
        FLOWCANVAS_MODEL_BASE_URL: modelSettings.baseURL || DEFAULT_MODEL_BASE_URL
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    apiKey = '';
    let stdout = '';
    let stderr = '';
    let progressBuffer = '';
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
	  if (signal) signal.removeEventListener('abort', abortChild);
	  staged.cleanup();
      if (error) reject(friendlyModelError(error, capability)); else resolve(value);
    };
    const abortChild = () => {
      child.kill();
      finish(new DOMException('Generation cancelled.', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', abortChild, { once: true });
    const timer = setTimeout(() => {
      child.kill();
	  finish(new Error(`${action === 'video.generate' ? '视频' : '图片'}生成等待超时（30 分钟）。`));
    }, 30 * 60 * 1000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-4 * 1024 * 1024); });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr = (stderr + text).slice(-1024 * 1024);
      progressBuffer += text;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event && event.type === 'progress' && typeof onProgress === 'function') {
            onProgress({
              status: String(event.status || 'running'),
              progress: Math.max(0, Math.min(1, Number(event.progress) || 0)),
              message: String(event.message || '模型平台处理中')
            });
          }
        } catch (_) { /* Preserve non-JSON backend diagnostics in stderr. */ }
      }
    });
    child.on('error', error => finish(error));
    child.on('close', code => {
      let result;
      try { result = JSON.parse(stdout); } catch (_) {
        finish(new Error(stderr || stdout || `图片后端异常退出（${code}）。`));
        return;
      }
      if (!result.ok) {
        finish(new Error(result.error || stderr || '图片生成失败。'));
        return;
      }
      if (result.data && result.data.localPath && path.isAbsolute(result.data.localPath)) {
        result.data.resultUrl = result.data.url || '';
        result.data.remoteUrl = result.data.remoteUrl || result.data.resultUrl;
        result.data.url = pathToFileURL(result.data.localPath).href;
      }
      finish(null, result);
    });
    child.stdin.end(JSON.stringify(request));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#f7f8fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, '..', 'frontend', 'yishun.html'));
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
}

function runBackend(args, payload) {
  return new Promise((resolve, reject) => {
    const cwd = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
    const child = spawn(backendPath(), args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0 && !stdout) {
        reject(new Error(stderr || `backend exited with ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`Invalid backend response: ${stdout || stderr || error.message}`));
      }
    });
    if (payload) {
      child.stdin.write(JSON.stringify(payload));
    }
    child.stdin.end();
  });
}

function workflowDBPath() {
  return path.join(app.getPath('userData'), 'tool-plus.db');
}

function workflowCall(action, payload = {}) {
  return runBackend(['workflow'], { action, dbPath: workflowDBPath(), ...payload });
}

function packagedToolPath(...segments) {
  const root = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
  return path.join(root, ...segments);
}

function captureProcess(command, args, timeoutMs = 5000) {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer = null;
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const append = (current, chunk) => (current + chunk.toString()).slice(-1024 * 1024);
    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', error => finish({ code: -1, stdout, stderr: `${stderr}\n${error.message}` }));
    child.on('close', code => finish({ code, stdout, stderr }));
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch (_) {}
      finish({ code: -1, stdout, stderr: `${stderr}\nmetadata inspection timed out` });
    }, timeoutMs);
  });
}

async function readFileSlice(filePath, start, length) {
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function detectText(buffer) {
  let encoding = 'UTF-8';
  let offset = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    encoding = 'UTF-8 BOM';
    offset = 3;
  } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    encoding = 'UTF-16 LE';
    offset = 2;
  } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    encoding = 'UTF-16 BE';
    offset = 2;
  }
  let sample;
  if (encoding === 'UTF-16 LE') sample = buffer.subarray(offset).toString('utf16le');
  else if (encoding === 'UTF-16 BE') {
    const swapped = Buffer.from(buffer.subarray(offset));
    swapped.swap16();
    sample = swapped.toString('utf16le');
  } else sample = buffer.subarray(offset).toString('utf8');
  const replacementCount = (sample.match(/\ufffd/g) || []).length;
  if (replacementCount > Math.max(2, sample.length * 0.01)) encoding = '本地编码/未知';
  sample = sample.replace(/\u0000/g, '').slice(0, 12000);
  return { encoding, lines: sample ? sample.split(/\r?\n/).length : 0, sample };
}

function countUniqueMatches(text, expression) {
  return new Set([...text.matchAll(expression)].map(match => match[1] || match[0])).size;
}

function zipCentralEntries(buffer) {
  const entries = [];
  for (let offset = 0; offset + 46 <= buffer.length;) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) break;
    entries.push({
      name: buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8').replace(/\\/g, '/'),
      uncompressedBytes: buffer.readUInt32LE(offset + 24)
    });
    offset = end;
  }
  return entries;
}

async function inspectOffice(item) {
  const stat = await fs.promises.stat(item.path);
  const length = Math.min(stat.size, 4 * 1024 * 1024);
  const tail = await readFileSlice(item.path, Math.max(0, stat.size - length), length);
  const centralEntries = zipCentralEntries(tail);
  const entryNames = centralEntries.map(entry => entry.name);
  let count = 0;
  if (item.extension === '.xlsx') count = entryNames.filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name)).length;
  else if (item.extension === '.pptx') count = entryNames.filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name)).length;
  else if (item.extension === '.docx') count = entryNames.some(name => /^word\/document\.xml$/i.test(name)) ? 1 : 0;
  const media = centralEntries.filter(entry => /^(?:word|xl|ppt)\/media\//i.test(entry.name));
  item.office = {
    count,
    mediaCount: media.length,
    maxMediaBytes: media.reduce((maximum, entry) => Math.max(maximum, entry.uncompressedBytes), 0)
  };
}

async function inspectPDF(item) {
  const executable = packagedToolPath('tools', 'pdfcpu.exe');
  if (!fs.existsSync(executable)) return;
  const result = await captureProcess(executable, ['info', item.path], 8000);
  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/(?:Pages|page count)\s*:\s*(\d+)/i);
  if (match) item.pdf = { pages: Number(match[1]) };
}

async function inspectMedia(item) {
  const executable = packagedToolPath('tools', 'ffmpeg', 'ffmpeg.exe');
  if (!fs.existsSync(executable)) return;
  const result = await captureProcess(executable, ['-hide_banner', '-i', item.path], 8000);
  const output = `${result.stdout}\n${result.stderr}`;
  const duration = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const video = output.match(/Video:[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/i);
  item.media = {
    durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
    width: video ? Number(video[1]) : null,
    height: video ? Number(video[2]) : null
  };
}

async function enrichInputInspection(item, index) {
  if (item.directory) return;
  if (/^\.(png|jpe?g|gif|bmp|webp|tiff?)$/i.test(item.extension)) {
    const image = nativeImage.createFromPath(item.path);
    if (!image.isEmpty()) {
      item.dimensions = image.getSize();
      if (index < 12) {
        const size = image.getSize();
        const thumbnail = size.width > 720 || size.height > 480 ? image.resize({ width: Math.min(size.width, 720), quality: 'good' }) : image;
        item.thumbnail = thumbnail.toDataURL();
      }
    }
    return;
  }
  if (/^\.(txt|md|markdown|csv|json|xml|ya?ml|log|ini|conf|srt|ass|html?|css|js|ts)$/i.test(item.extension)) {
    const stat = await fs.promises.stat(item.path);
    item.text = detectText(await readFileSlice(item.path, 0, Math.min(stat.size, 128 * 1024)));
    return;
  }
  if (item.extension === '.pdf') return inspectPDF(item);
  if (/^\.(docx|xlsx|pptx)$/i.test(item.extension)) return inspectOffice(item);
  if (/^\.(mp4|mkv|mov|avi|webm|mp3|wav|flac|aac|m4a|ogg|wma)$/i.test(item.extension)) return inspectMedia(item);
}

app.whenReady().then(async () => {
  loadSettings();
  modelLibrary = new ModelLibrary(path.join(app.getPath('userData'), 'model-library'));
  const legacyBootstrapKey = process.env.FLOWCANVAS_BOOTSTRAP_API_KEY || '';
  const imageBootstrapKey = process.env.FLOWCANVAS_BOOTSTRAP_IMAGE_API_KEY || legacyBootstrapKey;
  const videoBootstrapKey = process.env.FLOWCANVAS_BOOTSTRAP_VIDEO_API_KEY || legacyBootstrapKey;
  if (imageBootstrapKey || videoBootstrapKey) {
    const saved = saveModelSettings({ profiles: {
      image: {
        apiKey: imageBootstrapKey, baseURL: process.env.FLOWCANVAS_IMAGE_MODEL_BASE_URL || process.env.FLOWCANVAS_MODEL_BASE_URL || DEFAULT_MODEL_BASE_URL,
        model: process.env.FLOWCANVAS_IMAGE_MODEL_ID || (legacyBootstrapKey ? process.env.FLOWCANVAS_MODEL_ID : '') || DEFAULT_IMAGE_MODEL
      },
      video: {
        apiKey: videoBootstrapKey, baseURL: process.env.FLOWCANVAS_VIDEO_MODEL_BASE_URL || process.env.FLOWCANVAS_MODEL_BASE_URL || DEFAULT_MODEL_BASE_URL,
        model: process.env.FLOWCANVAS_VIDEO_MODEL_ID || DEFAULT_VIDEO_MODEL
      }
    } });
    if (!saved.ok) console.error('Cannot initialize model credential:', saved.error);
  }
  for (const name of ['FLOWCANVAS_BOOTSTRAP_API_KEY', 'FLOWCANVAS_BOOTSTRAP_IMAGE_API_KEY', 'FLOWCANVAS_BOOTSTRAP_VIDEO_API_KEY']) delete process.env[name];
  taskManager = new TaskManager({
    command: backendPath(),
    cwd: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..'),
    maxConcurrent: 2
  });
  taskManager.on('update', task => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('task-update', task);
  });

  const workflowCatalogResponse = await runBackend(['catalog']);
  if (!workflowCatalogResponse.ok) throw new Error(workflowCatalogResponse.error || 'Cannot load workflow catalog');
  workflowManager = new WorkflowManager({
    taskManager,
    workflowCall,
    catalog: workflowCatalogResponse.tools || [],
    userDataRoot: app.getPath('userData')
  });
  workflowManager.on('update', run => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workflow-run-update', run);
  });

  ipcMain.handle('catalog', () => runBackend(['catalog']));
  ipcMain.handle('run-tool', async (_event, payload) => {
    if (!payload || typeof payload !== 'object') return { ok: false, error: '任务参数无效。' };
    if (!payload.outputDir) {
      const { workspaceRoot } = loadSettings();
      payload.outputDir = path.join(workspaceRoot, payload.tool, 'output');
    }
    const catalogResponse = await runBackend(['catalog']);
    const tool = (catalogResponse.tools || []).find(item => item.key === payload.tool);
    if (!tool) return { ok: false, error: '未知工具，目录可能已过期，请重新打开功能。' };
    const validation = validateTaskPayload(payload, tool);
    if (!validation.ok) return validation;
    fs.mkdirSync(payload.outputDir, { recursive: true });
    return runBackend(['run'], payload);
  });
  ipcMain.handle('start-task', async (_event, payload) => {
    if (!payload || typeof payload !== 'object') return { ok: false, error: '任务参数无效。' };
    if (!payload.outputDir) {
      const { workspaceRoot } = loadSettings();
      payload.outputDir = path.join(workspaceRoot, payload.tool, 'output');
    }
    const catalogResponse = await runBackend(['catalog']);
    const tool = (catalogResponse.tools || []).find(item => item.key === payload.tool);
    if (!tool) return { ok: false, error: '未知工具，目录可能已过期，请重新打开功能。' };
    const validation = validateTaskPayload(payload, tool);
    if (!validation.ok) return validation;
    fs.mkdirSync(payload.outputDir, { recursive: true });
    const timeoutSeconds = tool.timeoutSeconds || 300;
    return { ok: true, task: taskManager.submit(payload, timeoutSeconds, tool.executionMode) };
  });
  ipcMain.handle('cancel-task', (_event, taskId) => taskManager.cancel(taskId));
  ipcMain.handle('get-task', (_event, taskId) => ({ ok: true, task: taskManager.snapshot(taskId) }));
  ipcMain.handle('workflow:list', () => workflowCall('list'));
  ipcMain.handle('workflow:get', (_event, workflowId) => workflowCall('get', { workflowId }));
  ipcMain.handle('workflow:create', (_event, workflow) => workflowCall('create', { workflow }));
  ipcMain.handle('workflow:update', (_event, workflow) => workflowCall('update', { workflow }));
  ipcMain.handle('workflow:delete', (_event, workflowId) => workflowCall('delete', { workflowId }));
  ipcMain.handle('workflow:delete-all', () => workflowCall('delete-all'));
  ipcMain.handle('workflow:step-list', (_event, workflowId) => workflowCall('step-list', { workflowId }));
  ipcMain.handle('workflow:step-create', (_event, step) => workflowCall('step-create', { step }));
  ipcMain.handle('workflow:step-update', (_event, step) => workflowCall('step-update', { step }));
  ipcMain.handle('workflow:step-delete', (_event, stepId) => workflowCall('step-delete', { stepId }));
  ipcMain.handle('workflow:step-reorder', (_event, payload) => workflowCall('step-reorder', payload || {}));
  ipcMain.handle('workflow:step-toggle', (_event, payload) => workflowCall('step-toggle', payload || {}));
  ipcMain.handle('workflow:step-duplicate', (_event, stepId) => workflowCall('step-duplicate', { stepId }));
  ipcMain.handle('workflow:validate', (_event, workflowId) => workflowCall('validate', { workflowId }));
  ipcMain.handle('workflow:export', (_event, workflowId) => workflowCall('export', { workflowId }));
  ipcMain.handle('workflow:import', (_event, importValue) => workflowCall('import', { importValue }));
  ipcMain.handle('workflow:run/start', (_event, payload) => workflowManager.start(payload || {}));
  ipcMain.handle('workflow:run/cancel', (_event, runId) => workflowManager.cancel(runId));
  ipcMain.handle('workflow:run/resume', (_event, runId) => workflowManager.resume(runId, false));
  ipcMain.handle('workflow:run/retry', (_event, runId) => workflowManager.resume(runId, true));
  ipcMain.handle('workflow:run/get', async (_event, runId) => {
    const active = workflowManager.snapshot(runId);
    return active ? { ok: true, data: active } : workflowCall('run-get', { runId });
  });
  ipcMain.handle('workflow:run/list', (_event, workflowId) => workflowCall('run-list', { workflowId: workflowId || '' }));
  ipcMain.handle('workflow:run/logs', async (_event, runId) => {
    const active = workflowManager.snapshot(runId);
    if (active) return { ok: true, data: active.summary && active.summary.logs || [] };
    const saved = await workflowCall('run-get', { runId });
    return saved.ok ? { ok: true, data: saved.data.summary && saved.data.summary.logs || [] } : saved;
  });
  ipcMain.handle('inspect-inputs', async (_event, paths) => {
    const items = [];
    const selectedPaths = (Array.isArray(paths) ? paths : []).slice(0, 1000);
    for (const [index, inputPath] of selectedPaths.entries()) {
      try {
        const stat = await fs.promises.stat(inputPath);
        const item = {
          path: inputPath,
          name: path.basename(inputPath),
          extension: path.extname(inputPath).toLowerCase(),
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          directory: stat.isDirectory()
        };
        if (index < 100) {
          try { await enrichInputInspection(item, index); } catch (error) {
            item.inspectionWarning = error.message;
          }
        }
        items.push(item);
      } catch (error) {
        items.push({ path: inputPath, name: path.basename(inputPath), error: error.message });
      }
    }
    return { ok: true, total: Array.isArray(paths) ? paths.length : 0, items };
  });
  ipcMain.handle('select-files', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('select-folders', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('select-output', async () => {
    const { workspaceRoot } = loadSettings();
    const result = await dialog.showOpenDialog({
      defaultPath: workspaceRoot,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('get-file-settings', () => ({ workspaceRoot: loadSettings().workspaceRoot }));
  ipcMain.handle('storage:get', () => ({
    ok: true,
    dataRoot: app.getPath('userData'),
    migratedFrom: dataRootInitialization.migratedFrom || '',
  }));
  ipcMain.handle('storage:select', async () => {
    const result = await dialog.showOpenDialog({
      defaultPath: app.getPath('userData'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('storage:save', (_event, dataRoot) => {
    try {
      return { ok: true, ...scheduleDataRoot(dataRoot, app.getPath('userData')) };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });
  ipcMain.handle('canvas:model-config:get', () => publicModelSettings());
  ipcMain.handle('canvas:model-config:save', (_event, payload) => saveModelSettings(payload));
  ipcMain.handle('model-library:list', () => {
    try { return { ok: true, models: modelLibrary.list() }; }
    catch (error) { return { ok: false, error: error.message || '读取用户模特失败。' }; }
  });
  ipcMain.handle('model-library:create', (_event, payload) => {
    try { return { ok: true, model: modelLibrary.create(payload || {}) }; }
    catch (error) { return { ok: false, error: error.message || '添加用户模特失败。' }; }
  });
  ipcMain.handle('model-library:update', (_event, modelId, payload) => {
    try { return { ok: true, model: modelLibrary.update(modelId, payload || {}) }; }
    catch (error) { return { ok: false, error: error.message || '更新用户模特失败。' }; }
  });
  ipcMain.handle('model-library:delete', (_event, modelId) => {
    try { return { ok: true, deleted: modelLibrary.delete(modelId) }; }
    catch (error) { return { ok: false, error: error.message || '删除用户模特失败。' }; }
  });
  ipcMain.handle('model-library:read', (_event, modelId) => {
    try {
      const model = modelLibrary.read(modelId);
      return { ok: true, model: { ...model, image: { ...model.image, bytes: Uint8Array.from(model.image.bytes) } } };
    } catch (error) {
      return { ok: false, error: error.message || '读取用户模特图片失败。' };
    }
  });
  ipcMain.handle('canvas:image-generate', async (event, payload) => {
    const requestId = String(payload && payload._requestId || '');
    const controller = new AbortController();
    if (requestId) canvasGenerationControllers.set(requestId, controller);
    try {
      const result = await modelTaskQueue.submit(() => runFlowCanvasBackend({ ...(payload || {}), action: 'image.generate' }, controller.signal, progress => {
        if (!event.sender.isDestroyed() && requestId) event.sender.send('canvas:generation-progress', { requestId, ...progress });
      }), controller.signal);
      return result;
    } catch (error) {
      return { ok: false, cancelled: error && error.name === 'AbortError', error: error.message };
    } finally {
      if (requestId && canvasGenerationControllers.get(requestId) === controller) canvasGenerationControllers.delete(requestId);
    }
  });
  ipcMain.handle('canvas:video-generate', async (event, payload) => {
    const requestId = String(payload && payload._requestId || '');
    const controller = new AbortController();
    if (requestId) canvasGenerationControllers.set(requestId, controller);
    try {
      const result = await modelTaskQueue.submit(() => runFlowCanvasBackend({ ...(payload || {}), action: 'video.generate' }, controller.signal, progress => {
        if (!event.sender.isDestroyed() && requestId) event.sender.send('canvas:generation-progress', { requestId, ...progress });
      }), controller.signal);
      return result;
    } catch (error) {
      return { ok: false, cancelled: error && error.name === 'AbortError', error: error.message };
    } finally {
      if (requestId && canvasGenerationControllers.get(requestId) === controller) canvasGenerationControllers.delete(requestId);
    }
  });
  ipcMain.handle('canvas:generation-cancel', (_event, requestId) => {
    const controller = canvasGenerationControllers.get(String(requestId || ''));
    if (!controller) return { ok: true, cancelled: false };
    controller.abort();
    return { ok: true, cancelled: true };
  });
  ipcMain.handle('select-workspace', async () => {
    const { workspaceRoot } = loadSettings();
    const result = await dialog.showOpenDialog({
      defaultPath: workspaceRoot,
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? '' : result.filePaths[0];
  });
  ipcMain.handle('save-file-settings', async (_event, workspaceRoot) => {
    if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
      return { ok: false, error: '请选择有效的绝对路径。' };
    }
    await ensureWorkspace(workspaceRoot);
    const settings = loadSettings();
    saveSettings({ ...settings, workspaceRoot });
    return { ok: true, workspaceRoot };
  });
  ipcMain.handle('reveal-result', async (_event, resultPath) => {
    if (!resultPath || !path.isAbsolute(resultPath) || !fs.existsSync(resultPath)) {
      return { ok: false, error: '结果文件不存在或已被移动。' };
    }
    const info = fs.statSync(resultPath);
    if (info.isDirectory()) {
      const error = await shell.openPath(resultPath);
      return error ? { ok: false, error } : { ok: true };
    }
    shell.showItemInFolder(resultPath);
    return { ok: true };
  });
  ensureWorkspace(loadSettings().workspaceRoot).catch(error => console.error('Cannot initialize workspace:', error));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (taskManager) taskManager.shutdown();
});
