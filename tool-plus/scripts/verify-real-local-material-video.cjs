const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function run() {
  const settingsPath = process.env.FLOWCANVAS_SETTINGS_PATH;
  const sourcePath = process.env.FLOWCANVAS_ACCEPTANCE_IMAGE;
  const acceptanceCase = process.env.FLOWCANVAS_ACCEPTANCE_CASE || (process.env.FLOWCANVAS_ACCEPTANCE_MODE === 'text2video' ? 'text2video' : 'first-last');
  const acceptanceModel = process.env.FLOWCANVAS_ACCEPTANCE_MODEL || 'seedance-2.0-pro(431)';
  const textOnly = acceptanceCase === 'text2video';
  const lastFramePath = process.env.FLOWCANVAS_ACCEPTANCE_LAST_IMAGE;
  const referenceVideoPath = process.env.FLOWCANVAS_ACCEPTANCE_VIDEO;
  const referenceAudioPath = process.env.FLOWCANVAS_ACCEPTANCE_AUDIO;
  if (!settingsPath) throw new Error('settings path is not configured');
  if (acceptanceCase === 'first-last' && (!sourcePath || !lastFramePath)) throw new Error('first/last frame paths are not configured');
  if (acceptanceCase === 'image2video' && !sourcePath) throw new Error('image-to-video source path is not configured');
  if (acceptanceCase === 'mixed' && (!sourcePath || !referenceVideoPath || !referenceAudioPath)) throw new Error('mixed image/video/audio reference paths are not configured');
  app.setPath('userData', path.dirname(settingsPath));
  await app.whenReady();
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const videoProfile = settings.canvasModels?.video || settings.canvasModel || {};
  const encrypted = videoProfile.encryptedAPIKey;
  if (!encrypted || !safeStorage.isEncryptionAvailable()) throw new Error('saved model credential is unavailable');
  let apiKey = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  const outputDir = path.resolve(__dirname, '..', 'work', `real-local-material-video-${acceptanceCase}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const request = {
    action: 'video.generate',
    prompt: '电影感夜景中的未来城市，镜头缓慢向前推进，保持首帧整体视觉风格一致',
    model: acceptanceModel,
    modeType: textOnly ? 'text2video' : acceptanceCase === 'mixed' ? 'mixed2video' : 'image2video',
    ratio: '16:9',
    resolution: acceptanceModel === 'seedance-2.0-pro(431)' ? '720p' : '480p',
    duration: 4,
    enableSound: 'off',
    localAssets: textOnly ? [] : acceptanceCase === 'mixed' ? [
      { path: sourcePath, name: path.basename(sourcePath), kind: 'image', mimeType: 'image/png', role: 'reference' },
      { path: referenceVideoPath, name: path.basename(referenceVideoPath), kind: 'video', mimeType: 'video/mp4', role: 'reference' },
      { path: referenceAudioPath, name: path.basename(referenceAudioPath), kind: 'audio', mimeType: 'audio/mpeg', role: 'reference' }
    ] : acceptanceCase === 'image2video' ? [
      { path: sourcePath, name: path.basename(sourcePath), kind: 'image', mimeType: 'image/png', role: 'firstFrame' }
    ] : [
      { path: sourcePath, name: path.basename(sourcePath), kind: 'image', mimeType: 'image/png', role: 'firstFrame' },
      { path: lastFramePath, name: path.basename(lastFramePath), kind: 'image', mimeType: 'image/png', role: 'lastFrame' }
    ],
    outputDir
  };
  const startedAt = Date.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(path.resolve(__dirname, '..', 'bin', 'flowcanvas-backend.exe'), [], {
      cwd: path.resolve(__dirname, '..'),
      windowsHide: true,
      env: { ...process.env, FLOWCANVAS_MODEL_API_KEY: apiKey, FLOWCANVAS_MODEL_BASE_URL: videoProfile.baseURL || 'https://api.tmlab.store' },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    apiKey = '';
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('real video acceptance timed out'));
    }, 30 * 60 * 1000);
    child.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(-4 * 1024 * 1024); });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-1024 * 1024); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(stdout)); } catch (_) { reject(new Error(stderr || stdout || 'invalid backend response')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
  if (!result.ok) throw new Error(result.error || 'backend rejected acceptance request');
  const data = result.data || {};
  const stat = fs.statSync(data.localPath);
  const uploaded = data.request?.uploadedAssets || [];
  if (!stat.isFile() || stat.size <= 0) throw new Error('generated video file is empty');
  if (data.request?.modeType !== request.modeType) throw new Error('video mode was not preserved');
  const expectedUploads = acceptanceCase === 'first-last'
    ? [['image', 'firstFrame'], ['image', 'lastFrame']]
    : acceptanceCase === 'image2video' ? [['image', 'firstFrame']]
    : acceptanceCase === 'mixed' ? [['image', 'reference'], ['video', 'reference'], ['audio', 'reference']] : [];
  if (JSON.stringify(uploaded.map(item => [item.kind, item.role])) !== JSON.stringify(expectedUploads)) throw new Error('uploaded material metadata mismatch');
  const report = {
    ok: true,
    acceptanceCase,
    provider: data.provider,
    model: data.model,
    status: data.status,
    progress: data.progress,
    taskId: data.taskId,
    modeType: data.request.modeType,
    ratio: data.request.ratio,
    resolution: data.request.resolution,
    duration: data.request.duration,
    enableSound: data.request.enableSound,
    uploadedAssets: uploaded,
    localPath: data.localPath,
    bytes: stat.size,
    contentType: data.contentType,
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000)
  };
  fs.writeFileSync(path.resolve(__dirname, '..', 'work', `real-local-material-video-${acceptanceCase}-acceptance.json`), JSON.stringify(report, null, 2));
  process.stdout.write(JSON.stringify(report));
}

run().then(() => app.quit()).catch(error => {
  process.stderr.write(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  app.exit(1);
});
