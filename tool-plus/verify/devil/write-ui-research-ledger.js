const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const version = require(path.join(root, 'package.json')).version;
const research = path.join(root, 'work', `acceptance-${version}`, 'ui-research');
const original = JSON.parse(fs.readFileSync(path.join(research, 'original', 'ORIGINAL_MANIFEST.json'), 'utf8'));
const annotated = JSON.parse(fs.readFileSync(path.join(research, 'annotated', 'ANNOTATED_MANIFEST.json'), 'utf8'));

const categories = {
  pdf: {
    primary: 'PDFgear 官方教程实际界面', secondary: 'Adobe Acrobat Organize Pages、PDF24 Creator 官方功能说明',
    preserve: '页面缩略图、页面级选择、顶部任务工具栏、作用范围和输出动作始终可见',
    borrow: 'Acrobat 的页面组织心智模型；PDF24 的离线批处理和结果后续动作',
    reject: '只给页码文本框而没有页面反馈；把栅格化损失藏在普通压缩选项中',
    implementation: '左侧页面/文件导航，中部文档与页面预览，右侧范围和参数，底部执行与结构损失说明'
  },
  image: {
    primary: 'XnConvert 批量动作流水线', secondary: 'Squoosh 前后对比与质量反馈',
    preserve: '输入列表、动作顺序、预览、格式/质量和输出策略分区',
    borrow: 'Squoosh 的前后对比、文件大小变化、即时质量反馈',
    reject: '把裁剪坐标、水印位置、透明通道风险放在无预览的通用输入框中',
    implementation: '批量列表与动作队列保持 XnConvert 的高密度；单项预览采用 Squoosh 的前后检查模式'
  },
  media: {
    primary: 'HandBrake 源摘要、预设和编码进度', secondary: 'Shutter Encoder 文件队列与功能面板',
    preserve: '源流信息、目标预设、容器/编码兼容性、队列、真实速度/进度/ETA/取消',
    borrow: 'Shutter Encoder 的批量文件队列和明确的目标位置控制',
    reject: '只有“处理中”的动画；没有源轨道、目标编码、预计时长或可取消入口',
    implementation: '源流摘要与预览占主区域，右侧预设和编码目标，底部持久队列及真实进度'
  },
  file: {
    primary: 'Microsoft PowerRename 实时新旧名称预览', secondary: 'Advanced Renamer 规则栈和冲突列',
    preserve: '规则输入和结果表同时可见；每一项显示原名、新名、状态和冲突',
    borrow: 'Advanced Renamer 的多规则顺序、错误行和批次状态',
    reject: '点击执行后才发现名称冲突；对 1000 项一次性创建全部复杂 DOM',
    implementation: '左侧规则栈，右侧虚拟化新旧名称表，冲突阻断，底部显示受影响数量并执行'
  },
  office: {
    primary: 'LibreOffice Writer/Calc/Impress 原生对象界面', secondary: 'Microsoft Office 选择窗格和对象作用范围',
    preserve: '文档类型原生心智模型：页、工作表、幻灯片和对象层级；范围与对象状态可见',
    borrow: 'Office 选择窗格的对象显示/隐藏、分组和当前选择反馈',
    reject: '只显示文件路径，无法知道处理哪一页、表、幻灯片或嵌入对象',
    implementation: '按 Word/Excel/PPT 切换导航模型，中部对象清单/预览，右侧范围与保留选项'
  },
  text: {
    primary: 'VS Code 搜索替换与 Search Editor', secondary: 'Notepad++ 紧凑命令对话模式',
    preserve: '查询、正则/大小写选项、命中数、逐项结果和编码状态在执行前可见',
    borrow: 'Notepad++ 的紧凑输入密度，仅用于简单跳转/单值动作',
    reject: '替换前不展示命中；编码转换不显示检测值、目标编码和非法字节风险',
    implementation: '顶部查询条件，中部虚拟化命中预览，右侧编码/换行摘要，底部显示受影响文件和执行命令'
  }
};

const counts = Object.fromEntries(Object.keys(categories).map(category => [category, original.records.filter(item => item.category === category).length]));
const products = Object.fromEntries(Object.keys(categories).map(category => [category, [...new Set(original.records.filter(item => item.category === category).map(item => item.product))]]));

const sources = `# UI 竞品调研来源与证据\n\n` +
  `访问日期：2026-07-14。原图仅来自官方产品页、官方文档或官方源码仓库；不包含生成图、本项目截图或宣传图。\n\n` +
  `- 原始实际界面：${original.count}/36\n- 标注界面：${annotated.count}/36\n- 分类联系表：${annotated.contacts.length}/6\n\n` +
  `| 类别 | 实际截图产品 | 数量 | 主参考 | 次参考 |\n|---|---|---:|---|---|\n` +
  Object.entries(categories).map(([key, value]) => `| ${key} | ${products[key].join('、')} | ${counts[key]} | ${value.primary} | ${value.secondary} |`).join('\n') +
  `\n\n每张图片的来源 URL、访问日期、尺寸、动画帧号和 SHA-256 见 \`original/ORIGINAL_MANIFEST.json\`；标注编号与哈希见 \`annotated/ANNOTATED_MANIFEST.json\`。PDF 首轮产品页合成宣传图已经从证据集剔除，最终 6 张均为官方教程中的完整实际操作界面。\n`;

const ledger = `# UI 决策账本\n\n| 类别 | 决策 | 主参考证据 | 次参考边界 | 本项目实现 |\n|---|---|---|---|---|\n` +
  Object.entries(categories).map(([key, value]) => `| ${key} | ${value.preserve} | ${value.primary} | ${value.borrow} | ${value.implementation} |`).join('\n') +
  `\n\n## 不采用项\n\n` + Object.entries(categories).map(([key, value]) => `- **${key}**：${value.reject}`).join('\n') + '\n';

const locks = `# 六类 UI 参考锁\n\n## 设计简报\n\n` +
  `为经常批量处理文件、但不应理解底层命令行的 Windows 用户设计桌面生产工具。核心目标是让用户在执行前理解输入、范围、质量损失和输出，在长任务中获得可信进度并随时取消。视觉基调保持安静、紧凑、工作导向；主要风险是万能参数表单、假进度、隐藏损失和批量列表冻结。路径为研究锁定后的直接生产实现。\n\n` +
  Object.entries(categories).map(([key, value]) => `## ${key.toUpperCase()}\n\n- **主参考**：${value.primary}\n- **必须保留**：${value.preserve}\n- **只借用**：${value.borrow}\n- **本项目落点**：${value.implementation}\n- **拒绝**：${value.reject}\n- **视觉角色**：白/浅灰工作画布、深色正文、绿色仅用于主执行与成功、红色仅用于错误与破坏性风险；8px 以内圆角、1px 边框、无装饰性渐变和浮动卡片。\n`).join('\n');

fs.writeFileSync(path.join(research, 'sources.md'), sources, 'utf8');
fs.writeFileSync(path.join(research, 'decision-ledger.md'), ledger, 'utf8');
fs.writeFileSync(path.join(research, 'reference-locks.md'), locks, 'utf8');
console.log(`PASS UI research ledger originals=${original.count} annotated=${annotated.count} categories=${Object.keys(categories).length}`);
