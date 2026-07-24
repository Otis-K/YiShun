const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tool_catalog.json'), 'utf8'));
const levels = {
  L0: { name: '基线', required: true, timeoutScale: 1 },
  L1: { name: '真实负载', required: true, timeoutScale: 2 },
  L2: { name: '大负载', required: true, timeoutScale: 4 },
  L3: { name: '极限负载', required: true, timeoutScale: 8 },
  L4: { name: '破坏负载', required: true, timeoutScale: 1 },
  L5: { name: '长稳负载', required: true, durationHours: 24 }
};

const manifest = {
  schemaVersion: 1,
  productVersion: require(path.join(root, 'package.json')).version,
  seed: 20260713,
  generatedAt: new Date().toISOString(),
  gates: {
    cancellationMs: 2000,
    idleRssMB: 500,
    normalPeakRssMB: 1536,
    heavyPeakRssMB: 4096,
    leakGrowthMB: 100,
    uiFeedbackMs: 300,
    progressHeartbeatMs: 1000
  },
  levels,
  tools: catalog.map(tool => ({
    key: tool.key,
    category: tool.category,
    maturity: tool.maturity,
    limits: tool.limits,
    timeoutSeconds: tool.timeoutSeconds,
    performanceBudget: tool.performanceBudget,
    uiReferenceId: tool.uiReferenceId,
    cases: levelsToCases(tool)
  }))
};

const output = process.argv[2] || path.join(__dirname, 'manifest.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`PASS devil-manifest ${manifest.tools.length} tools ${manifest.tools.reduce((sum, tool) => sum + tool.cases.length, 0)} cases`);

function levelsToCases(tool) {
  return Object.keys(levels).map(level => ({
    id: `${tool.key}:${level}`,
    level,
    required: true,
    timeoutSeconds: level === 'L5' ? 24 * 60 * 60 : tool.timeoutSeconds * levels[level].timeoutScale,
    oracle: oracleFor(tool.category),
    status: 'not-run'
  }));
}

function oracleFor(category) {
  if (category === '图片工具') return 'image-structure';
  if (category === 'PDF 工具') return 'pdf-cross-validator';
  if (/Word|Excel|PPT/.test(category)) return 'ooxml-relationships-native-open';
  if (/视频|音频/.test(category)) return 'ffprobe-stream-sync';
  if (/文件/.test(category)) return 'mapping-count-hash';
  return 'text-encoding-lines-hash';
}
