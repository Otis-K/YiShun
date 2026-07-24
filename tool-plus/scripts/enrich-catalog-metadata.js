const fs = require('node:fs');
const path = require('node:path');

const catalogPath = path.join(__dirname, '..', 'backend', 'tool_catalog.json');
const tools = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const atomicTools = new Set([
  'merge-text',
  'docx-replace-images', 'xlsx-replace-images', 'pptx-replace-images',
  'pdf-merge', 'video-merge', 'audio-merge'
]);

const profiles = {
  '文本工具': { timeoutSeconds: 300, limits: { maxInputs: 1000, maxInputBytes: 1073741824 }, budget: { peakRssMB: 1536, cancelMs: 2000 } },
  '图片工具': { timeoutSeconds: 900, limits: { maxInputs: 1000, maxPixelsPerImage: 268435456 }, budget: { peakRssMB: 4096, cancelMs: 2000 } },
  'PDF 工具': { timeoutSeconds: 1800, limits: { maxInputs: 100, maxPagesPerInput: 5000 }, budget: { peakRssMB: 4096, cancelMs: 2000 } },
  'Word 工具': { timeoutSeconds: 900, limits: { maxInputs: 100, modernFormatsOnly: true }, budget: { peakRssMB: 2500, cancelMs: 2000 } },
  'Excel 工具': { timeoutSeconds: 900, limits: { maxInputs: 100, modernFormatsOnly: true }, budget: { peakRssMB: 2500, cancelMs: 2000 } },
  'PPT 工具': { timeoutSeconds: 900, limits: { maxInputs: 100, modernFormatsOnly: true }, budget: { peakRssMB: 2500, cancelMs: 2000 } },
  '视频工具': { timeoutSeconds: 7200, limits: { maxInputs: 100 }, budget: { peakRssMB: 4096, cancelMs: 2000 } },
  '音频工具': { timeoutSeconds: 7200, limits: { maxInputs: 100 }, budget: { peakRssMB: 4096, cancelMs: 2000 } },
  '网页工具': { timeoutSeconds: 7200, limits: { maxInputs: 0, drmBypass: false }, budget: { peakRssMB: 1536, cancelMs: 2000 } },
  default: { timeoutSeconds: 1800, limits: { maxInputs: 100000 }, budget: { peakRssMB: 1536, cancelMs: 2000 } }
};

for (const tool of tools) {
  const profile = profiles[tool.category] || profiles.default;
  tool.maturity = tool.maturity || 'experimental';
  tool.limits = Object.keys(tool.limits || {}).length ? tool.limits : profile.limits;
  tool.timeoutSeconds = Number(tool.timeoutSeconds) > 0 ? tool.timeoutSeconds : profile.timeoutSeconds;
  tool.performanceBudget = Object.keys(tool.performanceBudget || {}).length ? tool.performanceBudget : profile.budget;
  tool.uiReferenceId = `ui-${categorySlug(tool.category)}`;
  tool.acceptanceCaseIds = Array.isArray(tool.acceptanceCaseIds) && tool.acceptanceCaseIds.length
    ? tool.acceptanceCaseIds
    : ['L0-baseline', 'L1-real', 'L2-large', 'L3-limit', 'L4-destructive', 'L5-soak'].map(id => `${tool.key}:${id}`);
  tool.executionMode = atomicTools.has(tool.key) || /^(rename-|folder-|classify-|mirror-|modify-file-times)/.test(tool.key)
    ? 'atomic'
    : 'per-input';
}

fs.writeFileSync(catalogPath, `${JSON.stringify(tools, null, 2)}\n`, 'utf8');

function categorySlug(category) {
  if (category === 'PDF 工具') return 'pdf';
  if (category === '图片工具') return 'image';
  if (category === '视频工具' || category === '音频工具' || category === '网页工具') return 'media';
  if (category === 'Word 工具' || category === 'Excel 工具' || category === 'PPT 工具') return 'office';
  if (category === '文本工具') return 'text';
  return 'file';
}
