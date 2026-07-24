const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('G:/FlowCanvas-SDK/FlowCanvas-SDK/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'work', 'real-video-acceptance.json');

(async () => {
  const startedAt = new Date().toISOString();
  let application;
  let result;
  try {
    application = await electron.launch({
      executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: ['.'], cwd: root, timeout: 30000,
    });
    const window = await application.firstWindow();
    await window.waitForLoadState('domcontentloaded');
    if (process.env.FLOWCANVAS_REAL_VIDEO_KEY) {
      const saved = await window.evaluate(apiKey => window.toolplus.canvasModelConfigSave({ profiles: {
        video: { baseURL: 'https://api.tmlab.store', model: 'seedance-2.0-pro(431)', apiKey },
      } }), process.env.FLOWCANVAS_REAL_VIDEO_KEY);
      if (!saved?.ok) throw new Error(saved?.error || 'cannot save real video acceptance credential');
    }
    result = await window.evaluate(async () => window.toolplus.canvasVideoGenerate({
      prompt: '电影感城市夜景，霓虹灯光倒映在湿润街道，镜头缓慢向前推进，画面稳定流畅',
      model: 'seedance-2.0-pro(431)', modeType: 'text2video', ratio: '16:9',
      resolution: '720p', duration: 4, enableSound: 'off',
      imageUrls: [], audioUrls: [], mixedList: [], parameters: {},
    }));
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  } finally {
    if (application) await application.close().catch(() => {});
  }
  const localPath = result && result.data && result.data.localPath;
  const report = {
    test: 'Tool Plus video node path: renderer IPC -> Electron queue -> Go unified model layer -> Seedance polling -> local video',
    startedAt, finishedAt: new Date().toISOString(),
    request: { model: 'seedance-2.0-pro(431)', modeType: 'text2video', ratio: '16:9', resolution: '720p', duration: 4, enableSound: 'off' },
    passed: Boolean(result && result.ok && localPath && fs.existsSync(localPath) && fs.statSync(localPath).size > 0),
    result,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ passed: report.passed, taskId: result && result.data && result.data.taskId || '', localPath: localPath || '', error: result && result.error || '', reportPath }));
  process.exitCode = report.passed ? 0 : 2;
})();
