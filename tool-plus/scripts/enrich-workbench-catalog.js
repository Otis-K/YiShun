const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const catalogPath = path.join(root, 'backend', 'tool_catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const textExtensions = ['txt', 'md', 'markdown', 'html', 'htm', 'csv', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'conf', 'srt', 'ass'];
const imageExtensions = ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'tif', 'tiff', 'webp'];
const videoExtensions = ['mp4', 'avi', 'mkv', 'mov', 'flv', 'wmv', 'webm', 'mpeg', 'mpg', '3gp', 'ogv', 'ts'];
const audioExtensions = ['mp3', 'aac', 'm4a', 'wma', 'wav', 'flac', 'ogg', 'opus'];

function acceptedExtensions(tool) {
  if (tool.inputKind === 'folders' || tool.inputKind === 'none') return [];
  if (tool.category === '文本工具') {
    if (tool.key.startsWith('markdown-')) return ['md', 'markdown'];
    if (tool.key.startsWith('html-')) return ['html', 'htm'];
    if (tool.key.startsWith('txt-')) return ['txt'];
    return textExtensions;
  }
  if (tool.category === '图片工具') return tool.key.startsWith('svg-') ? ['svg'] : imageExtensions;
  if (tool.category === 'Word 工具') return ['docx'];
  if (tool.category === 'Excel 工具') return ['xlsx'];
  if (tool.category === 'PPT 工具') return ['pptx'];
  if (tool.category === 'PDF 工具') return ['pdf'];
  if (tool.category === '视频工具') return videoExtensions;
  if (tool.category === '音频工具') return [...audioExtensions, ...videoExtensions];
  return ['*'];
}

function outputProfile(tool) {
  if (tool.key.startsWith('rename-') || tool.key.startsWith('folder-')) return 'rename-preview';
  if (/(merge-text|pdf-merge|video-merge|audio-merge)/.test(tool.key)) return 'merge-single';
  if (/(image-split|pdf-split|pdf-to-jpg|extract-images|preview-grid)/.test(tool.key)) return 'split-multiple';
  if (tool.category === '图片工具') return 'image-export';
  if (/^(Word|Excel|PPT) 工具$/.test(tool.category)) return 'office-export';
  if (tool.category === 'PDF 工具' || tool.key === 'markdown-to-pdf') return 'pdf-export';
  if (tool.category === '视频工具' || tool.category === '音频工具') return 'media-export';
  if (tool.category === '网页工具') return 'download';
  if (tool.category === '文件整理') return 'per-input-copy';
  return 'per-input-copy';
}

function outputExtensions(tool) {
  const key = tool.key;
  const direct = {
    'markdown-to-html': ['html'], 'markdown-to-txt': ['txt'], 'html-to-txt': ['txt'],
    'txt-to-html': ['html'], 'txt-to-markdown': ['md'], 'html-to-markdown': ['md'],
    'markdown-to-pdf': ['pdf'], 'merge-text': ['txt'], 'docx-to-txt': ['txt'],
    'docx-to-html': ['html'], 'xlsx-to-csv': ['csv'], 'xlsx-to-json': ['json'],
    'svg-to-pdf': ['pdf'], 'svg-to-jpg': ['jpg'], 'pdf-to-txt': ['txt'],
    'pdf-to-jpg': ['jpg'], 'video-extract-audio': ['mp3'], 'video-preview-grid': ['jpg'],
    'video-to-aac-audio': ['aac'], 'video-to-ogg-audio': ['ogg'], 'video-to-opus-audio': ['opus'],
    'audio-to-mp4-cover': ['mp4']
  };
  if (direct[key]) return direct[key];
  const conversion = key.match(/(?:video|audio)-to-(mp4|avi|mkv|mov|flv|wmv|webm|mpeg|3gp|ogv|ts|mp3|aac|m4a|wma|wav|flac|ogg|opus)$/);
  if (conversion) return [conversion[1]];
  if (key === 'image-convert') return ['png', 'jpg', 'bmp', 'gif', 'tiff'];
  if (key === 'image-modern-convert') return ['webp', 'avif', 'heic'];
  if (key === 'image-split') return ['png'];
  if (key.includes('extract-images')) return imageExtensions;
  if (tool.category === 'PDF 工具') return ['pdf'];
  if (tool.category === 'Word 工具') return ['docx'];
  if (tool.category === 'Excel 工具') return ['xlsx'];
  if (tool.category === 'PPT 工具') return ['pptx'];
  if (tool.category === '图片工具') return imageExtensions;
  if (tool.category === '视频工具') return videoExtensions;
  if (tool.category === '音频工具') return audioExtensions;
  if (tool.category === '网页工具') return [...videoExtensions, ...audioExtensions];
  return ['*'];
}

function profileFields(profile, tool) {
  const common = [
    { name: 'outputDir', label: '输出位置', type: 'path', required: profile !== 'no-file-result' },
    { name: 'conflictStrategy', label: '重名处理', type: 'select', value: 'auto-number', choices: ['auto-number'], locked: true, help: '当前执行内核始终自动编号，绝不静默覆盖。' },
    { name: 'notification', label: '完成通知', type: 'select', value: 'app', choices: ['app', 'silent'] }
  ];
  const profileSpecific = {
    'rename-preview': [{ name: 'renamePreview', label: '名称预览', type: 'rename-preview', source: 'tool-options' }, { name: 'preserveExtension', label: '保留扩展名', type: 'switch', value: true, locked: true }],
    'merge-single': [{ name: 'cardinality', label: '输出方式', type: 'readonly', value: '合并为单个文件' }],
    'split-multiple': [{ name: 'namingTemplate', label: '命名规则', type: 'readonly', value: '源名称_序号' }],
    'image-export': [{ name: 'imageFormat', label: '目标图像格式', type: 'readonly', value: outputExtensions(tool).join(' / ') }, { name: 'metadataPolicy', label: '元数据策略', type: 'readonly', value: '由当前功能决定' }],
    'office-export': [{ name: 'officeFormat', label: '目标 Office 格式', type: 'readonly', value: outputExtensions(tool).join(' / ') }, { name: 'compatibilityMode', label: '兼容模式', type: 'readonly', value: '保持 OOXML 兼容' }],
    'pdf-export': [{ name: 'pdfVersion', label: 'PDF 兼容性', type: 'readonly', value: '保持源文件或工具默认' }, { name: 'pagePolicy', label: '页面范围', type: 'readonly', value: '由功能参数决定' }],
    'media-export': [{ name: 'container', label: '输出容器', type: 'readonly', value: outputExtensions(tool).join(' / ') }, { name: 'codecPolicy', label: '编码策略', type: 'readonly', value: '由本地 FFmpeg 安全预设决定' }],
    download: [{ name: 'downloadFormat', label: '下载格式', type: 'readonly', value: '按清晰度与站点可用流选择' }],
    'per-input-copy': [{ name: 'hierarchy', label: '目录层级', type: 'readonly', value: '扁平输出，重名自动编号' }]
  };
  return [...(profileSpecific[profile] || []), ...common];
}

for (const tool of catalog) {
  const accepted = acceptedExtensions(tool);
  const profile = outputProfile(tool);
  const workflowUnavailableReason = tool.key === 'web-video-download'
    ? '该工具依赖外部站点实时响应，当前不能保证可恢复的确定性 artifact。'
    : '';
  tool.acceptedExtensions = accepted;
  tool.inputContract = { kind: tool.inputKind, extensions: accepted, cardinality: tool.executionMode === 'atomic' ? 'batch' : 'per-input' };
  tool.outputContract = {
    kind: 'files',
    extensions: outputExtensions(tool),
    cardinality: /(merge-text|pdf-merge|video-merge|audio-merge)/.test(tool.key) ? 'single' : (tool.executionMode === 'atomic' ? 'batch' : 'per-input')
  };
  tool.workflowCapable = !workflowUnavailableReason;
  if (workflowUnavailableReason) tool.workflowUnavailableReason = workflowUnavailableReason;
  else delete tool.workflowUnavailableReason;
  tool.destructive = false;
  tool.cardinality = tool.outputContract.cardinality;
  tool.entitlementKey = `tool.${tool.key}`;
  tool.requiredPlan = 'free';
  tool.wizard = { hasOptionsStep: Array.isArray(tool.params) && tool.params.length > 0 };
  tool.uiSchema = { schemaVersion: 1, fields: tool.params || [] };
  tool.outputProfile = profile;
  tool.outputFields = profileFields(profile, tool);
}

fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`Enriched ${catalog.length} tools with workbench and workflow contracts.`);
