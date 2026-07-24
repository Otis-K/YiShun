const navigationGroups = [
  {
    label: '总览',
    icon: 'icon-grid',
    items: [
      { category: '全部工具', label: '全部工具', icon: 'icon-grid' },
      { category: '__workflows__', label: '任务流', icon: 'icon-organize' },
      { category: '__file_settings__', label: '文件设置', icon: 'icon-settings' }
    ]
  },
  {
    label: '智能能力',
    icon: 'icon-canvas',
    items: [
      { category: '__canvas__', label: '智能画布', icon: 'icon-canvas' }
    ]
  },
  {
    label: '文档处理',
    icon: 'icon-doc',
    items: [
      { category: 'Word 工具', label: 'Word 工具', icon: 'icon-word' },
      { category: 'Excel 工具', label: 'Excel 工具', icon: 'icon-excel' },
      { category: 'PPT 工具', label: 'PPT 工具', icon: 'icon-doc' },
      { category: 'PDF 工具', label: 'PDF 工具', icon: 'icon-pdf' },
      { category: '文本工具', label: '文本工具', icon: 'icon-text' }
    ]
  },
  {
    label: '图像与整理',
    icon: 'icon-folder',
    items: [
      { category: '图片工具', label: '图片工具', icon: 'icon-image' },
      { category: '文件命名', label: '文件命名', icon: 'icon-folder' },
      { category: '文件夹命名', label: '文件夹命名', icon: 'icon-folder' },
      { category: '文件整理', label: '文件整理', icon: 'icon-organize' }
    ]
  },
  {
    label: '音视频处理',
    icon: 'icon-download',
    items: [
      { category: '视频工具', label: '视频工具', icon: 'icon-download' },
      { category: '音频工具', label: '音频工具', icon: 'icon-download' }
    ]
  },
  {
    label: '网页工具',
    icon: 'icon-download',
    items: [
      { category: '网页工具', label: '视频下载', icon: 'icon-download' }
    ]
  }
];

const categoryMap = {
  Text: '文本工具',
  Word: 'Word 工具',
  Excel: 'Excel 工具',
  PowerPoint: 'PPT 工具',
  PDF: 'PDF 工具',
  Image: '图片工具',
  Web: '网页工具',
  Naming: '文件命名',
  FolderNaming: '文件夹命名',
  Organize: '文件整理',
  Video: '视频工具',
  Audio: '音频工具'
};

const toolMeta = {};
const paramDefs = {};
const pageSize = 12;
const canvasCategory = '__canvas__';
const fileSettingsCategory = '__file_settings__';
const workflowCategory = '__workflows__';
const toolsWithoutFileInput = new Set(['web-video-download']);
const folderInputTools = new Set(['folder-replace', 'folder-insert', 'folder-prefix-suffix', 'folder-case', 'folder-delete', 'mirror-folders']);

const toolApi = window.toolplus || {
  catalog: async () => ({
    ok: true,
    tools: Object.entries(toolMeta).map(([key, meta]) => ({
      key,
      title: meta.title,
      category: meta.category,
      description: meta.description
    }))
  }),
  runTool: async () => ({
    ok: false,
    error: '当前是静态预览模式，请在桌面客户端中运行功能。'
  }),
  startTask: async payload => ({ ok: true, task: { id: 'preview-task', state: 'failed', phase: '静态预览无法执行任务。', payload } }),
  cancelTask: async () => ({ ok: true }),
  getTask: async () => ({ ok: true, task: null }),
  onTaskUpdate: () => () => {},
  inspectInputs: async paths => ({ ok: true, total: paths.length, items: paths.map(path => ({ path, name: path.split(/[\\/]/).pop(), size: 0 })) }),
  selectFiles: async () => [],
  selectFolders: async () => [],
  selectOutput: async () => '',
  getFileSettings: async () => ({ workspaceRoot: 'G:\\tool-user-file' }),
  selectWorkspace: async () => '',
  saveFileSettings: async workspaceRoot => ({ ok: true, workspaceRoot }),
  storageGet: async () => ({ ok: true, dataRoot: 'G:\\tool-plus-data' }),
  storageSelect: async () => '',
  storageSave: async dataRoot => ({ ok: true, dataRoot, restartRequired: false }),
  canvasModelConfigGet: async () => ({ ok: true, profiles: {
    image: { configured: false, baseURL: 'https://api.tmlab.store', model: 'nano-banana-pro(特价版 1)' },
    video: { configured: false, baseURL: 'https://api.tmlab.store', model: 'seedance-2.0-pro(431)' }
  } }),
  canvasModelConfigSave: async payload => ({ ok: true, profiles: payload.profiles || {} }),
  canvasImageGenerate: async () => ({ ok: false, error: '静态预览无法生成图片。' }),
  canvasVideoGenerate: async () => ({ ok: false, error: '静态预览无法生成视频。' }),
  workflowList: async () => ({ ok: true, data: [] }),
  workflowGet: async workflowId => ({ ok: false, error: `静态预览无法读取任务流：${workflowId}` }),
  workflowCreate: async workflow => ({ ok: true, data: { ...workflow, id: `preview-${Date.now()}`, version: 1, updatedAt: new Date().toISOString(), steps: [] } }),
  workflowUpdate: async workflow => ({ ok: true, data: workflow }),
  workflowDelete: async () => ({ ok: true }),
  workflowDeleteAll: async () => ({ ok: true }),
  workflowStepList: async () => ({ ok: true, data: [] }),
  workflowStepCreate: async step => ({ ok: true, data: { ...step, id: `step-${Date.now()}`, sortIndex: 1, enabled: true, updatedAt: new Date().toISOString() } }),
  workflowStepUpdate: async step => ({ ok: true, data: step }),
  workflowStepDelete: async () => ({ ok: true }),
  workflowStepReorder: async () => ({ ok: true }),
  workflowStepToggle: async () => ({ ok: true }),
  workflowStepDuplicate: async () => ({ ok: true }),
  workflowValidate: async () => ({ ok: true, data: null, issues: [] }),
  workflowRunStart: async () => ({ ok: false, error: '静态预览无法运行任务流。' }),
  workflowRunCancel: async () => ({ ok: true }),
  workflowRunResume: async () => ({ ok: false, error: '静态预览无法恢复任务流。' }),
  workflowRunRetry: async () => ({ ok: false, error: '静态预览无法重试任务流。' }),
  workflowRunGet: async () => ({ ok: true, data: null }),
  workflowRunList: async () => ({ ok: true, data: [] }),
  workflowRunLogs: async () => ({ ok: true, data: [] }),
  onWorkflowRunUpdate: () => () => {},
  revealResult: async () => ({ ok: false, error: '静态预览无法打开本地目录。' })
};

let tools = [];
let activeCategory = '全部工具';
let selectedTool = null;
let selectedFiles = [];
let selectedOutput = '';
const selectedOutputs = new Map();
let workspaceRoot = 'G:\\tool-user-file';
let currentPage = 1;
let lastCatalogCategory = '全部工具';
let activeTaskId = '';
let activeTaskState = '';
let taskPollTimer = null;
let inspectedInputs = [];
let pendingRetryInputs = [];
let workbenchStep = 'input';
let lastModalTrigger = null;
let workflows = [];
let selectedWorkflowId = '';
let selectedWorkflow = null;
let workflowSteps = [];
let workflowRunInputs = [];
let workflowRunOutput = '';
let activeWorkflowRunId = '';
let modalResolver = null;

const sidebar = document.querySelector('#sidebar');
const cards = document.querySelector('#cards');
const jumpSelect = document.querySelector('#jumpSelect');
const searchInput = document.querySelector('#searchInput');
const categoryTitle = document.querySelector('#categoryTitle');
const countText = document.querySelector('#countText');
const heroCount = document.querySelector('#heroCount');
const capabilityStatus = document.querySelector('#capabilityStatus');
const catalogView = document.querySelector('#catalogView');
const toolView = document.querySelector('#toolView');
const fileSettingsView = document.querySelector('#fileSettingsView');
const workflowView = document.querySelector('#workflowView');
const canvasView = document.querySelector('#canvasView');
const canvasFrame = document.querySelector('#canvasFrame');
const canvasBackBtn = document.querySelector('#canvasBackBtn');
const canvasImmersiveBtn = document.querySelector('#canvasImmersiveBtn');
const noticeBar = document.querySelector('#noticeBar');
const paramBox = document.querySelector('#paramBox');
const log = document.querySelector('#log');
const status = document.querySelector('#status');
const openResultBtn = document.querySelector('#openResultBtn');
const prevPageBtn = document.querySelector('#prevPageBtn');
const nextPageBtn = document.querySelector('#nextPageBtn');
const pageInfo = document.querySelector('#pageInfo');
const toolRunStatus = document.querySelector('#toolRunStatus');
const noParamsHint = document.querySelector('#noParamsHint');
const toolOpenResultBtn = document.querySelector('#toolOpenResultBtn');
const inputPreview = document.querySelector('#inputPreview');
const previewSummary = document.querySelector('#previewSummary');
const validationBadge = document.querySelector('#validationBadge');
const riskNotice = document.querySelector('#riskNotice');
const taskProgressPanel = document.querySelector('#taskProgressPanel');
const taskCancelBtn = document.querySelector('#taskCancelBtn');
const categoryWorkspace = document.querySelector('#categoryWorkspace');
let noticeTimer = null;
let canvasReturnView = catalogView;
let canvasReturnFocus = null;
let canvasImmersive = false;

function showView(view) {
  [catalogView, toolView, fileSettingsView, workflowView, canvasView].forEach(item => {
    item.hidden = item !== view;
  });
  document.body.classList.toggle('canvasImmersiveMode', view === canvasView && canvasImmersive);
  updateCanvasImmersiveButton();
}

function updateCanvasImmersiveButton() {
  if (!canvasImmersiveBtn) return;
  const enabled = canvasImmersive && !canvasView.hidden;
  canvasImmersiveBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  canvasImmersiveBtn.setAttribute('aria-label', enabled ? '显示全部工具导航' : '隐藏全部工具导航');
  canvasImmersiveBtn.title = enabled ? '显示全部工具导航' : '隐藏全部工具导航';
  const label = canvasImmersiveBtn.querySelector('span');
  if (label) label.textContent = enabled ? '显示导航' : '沉浸式';
}

function setCanvasImmersive(enabled) {
  canvasImmersive = Boolean(enabled);
  document.body.classList.toggle('canvasImmersiveMode', !canvasView.hidden && canvasImmersive);
  updateCanvasImmersiveButton();
  if (canvasFrame.dataset.loaded === 'true') {
    window.requestAnimationFrame(() => {
      try { canvasFrame.contentWindow?.dispatchEvent(new Event('resize')); } catch (_) {}
    });
  }
}

function showCatalogView() {
  if (activeCategory === fileSettingsCategory || activeCategory === workflowCategory) activeCategory = lastCatalogCategory;
  showView(catalogView);
  renderSidebar();
  renderCards();
}

function showNotice(message, tone = 'info') {
  noticeBar.textContent = message;
  noticeBar.dataset.tone = tone;
  noticeBar.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { noticeBar.hidden = true; }, 4200);
}

function formatCount(category) {
  if (category === canvasCategory || category === fileSettingsCategory || category === workflowCategory) {
    return 1;
  }
  if (category === '全部工具') {
    return tools.length;
  }
  return tools.filter(tool => tool.category === category).length;
}

function normalizeTools(rawTools) {
  return (rawTools || []).map((tool, index) => {
    const category = tool.category || '全部工具';
    const title = tool.title || tool.key;
    const description = tool.description || '暂无功能描述。';
    paramDefs[tool.key] = Array.isArray(tool.params) ? tool.params : [];
    if (tool.inputKind === 'none') toolsWithoutFileInput.add(tool.key);
    if (tool.inputKind === 'folders') folderInputTools.add(tool.key);
    return {
      ...tool,
      category,
      title,
      description,
      sequence: index + 1,
      displayNo: String(index + 1).padStart(3, '0'),
      searchText: `${tool.key} ${title} ${description} ${category}`.toLowerCase()
    };
  });
}

function appendLog(text) {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const current = log.textContent.trim();
  const entries = current ? current.split('\n\n') : [];
  entries.unshift(`[${timestamp}] ${text.trim()}`);
  log.textContent = entries.slice(0, 6).join('\n\n');
}

function createIcon(iconId) {
  return `
    <svg class="navIcon" aria-hidden="true">
      <use href="#${iconId}"></use>
    </svg>
  `;
}

function renderSidebar() {
  sidebar.innerHTML = '';
  const displayedCategory = !toolView.hidden && selectedTool
    ? selectedTool.category
    : (!workflowView.hidden ? workflowCategory : (!canvasView.hidden ? canvasCategory : activeCategory));

  navigationGroups.forEach(group => {
    const section = document.createElement('section');
    section.className = 'navGroup';

    const title = document.createElement('div');
    title.className = 'navGroupTitle';
    title.innerHTML = `
      ${createIcon(group.icon)}
      <span>${group.label}</span>
    `;
    section.appendChild(title);

    group.items.forEach(item => {
      const button = document.createElement('button');
      button.className = `sideItem ${item.category === displayedCategory ? 'active' : ''}`;
      button.type = 'button';
      button.innerHTML = `
        <span class="sideItemMain">
          ${createIcon(item.icon)}
          <span class="sideItemLabel">${item.label}</span>
        </span>
      `;
      button.onclick = () => {
        if ((item.category === fileSettingsCategory || item.category === workflowCategory) && activeCategory !== item.category) {
          lastCatalogCategory = activeCategory;
        }
        activeCategory = item.category;
        currentPage = 1;
        if (activeCategory === workflowCategory) {
          renderSidebar();
          openWorkflowView();
          return;
        }
        if (activeCategory === fileSettingsCategory) {
          renderSidebar();
          openFileSettingsView();
          return;
        }
        showCatalogView();
      };
      section.appendChild(button);
    });

    sidebar.appendChild(section);
  });
}

function renderJump() {
  jumpSelect.innerHTML = '<option value="">快速跳转到某个功能</option>';
  tools.forEach(tool => {
    const option = document.createElement('option');
    option.value = tool.key;
    option.textContent = `#${tool.displayNo} ${tool.title}`;
    jumpSelect.appendChild(option);
  });

  jumpSelect.onchange = () => {
    const tool = tools.find(item => item.key === jumpSelect.value);
    if (tool) {
      openToolView(tool);
      jumpSelect.value = '';
    }
  };
}

function getFilteredTools() {
  if (activeCategory === canvasCategory || activeCategory === fileSettingsCategory || activeCategory === workflowCategory) {
    return [];
  }
  const query = searchInput.value.trim().toLowerCase();
  return tools.filter(tool => {
    const categoryMatch = activeCategory === '全部工具' || tool.category === activeCategory;
    const searchMatch = !query || tool.searchText.includes(query);
    return categoryMatch && searchMatch;
  });
}

function renderEmptyState() {
  const empty = document.createElement('article');
  empty.className = 'emptyState';
  empty.innerHTML = `
    <div class="emptyStateInner">
      <svg><use href="#icon-grid"></use></svg>
      <strong>没有找到匹配的功能</strong>
      <span>可以尝试更换分类，或者清空搜索条件后重新查看。</span>
    </div>
  `;
  cards.appendChild(empty);
}

function renderCards() {
  if (activeCategory === canvasCategory) {
    renderCanvasModule();
    return;
  }

  const filtered = getFilteredTools();
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(currentPage, totalPages);

  categoryTitle.textContent = activeCategory;
  countText.textContent = `共 ${filtered.length} 项功能`;
  heroCount.textContent = `${tools.length} 项`;
  cards.innerHTML = '';

  const start = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  if (!pageItems.length) {
    renderEmptyState();
  }

  pageItems.forEach((tool, index) => {
    const visibleSequence = activeCategory === '全部工具'
      ? tool.sequence
      : start + index + 1;
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <button class="cardButton" type="button">
        <div class="cardHead">
          <span class="cardNo">${visibleSequence}.</span>
          <h3 class="cardTitle">${tool.title}</h3>
        </div>
        <p class="cardDescription">${tool.description}</p>
        <div class="cardFoot">
          <span class="cardKey">${tool.key}</span>
          <span class="cardAction">${tool.maturity === 'stable' ? '稳定功能' : '实验功能'} · 打开</span>
        </div>
      </button>
    `;
    card.querySelector('.cardButton').onclick = () => openToolView(tool);
    cards.appendChild(card);
  });

  const placeholdersNeeded = pageItems.length ? pageSize - pageItems.length : pageSize - 1;
  for (let index = 0; index < placeholdersNeeded; index += 1) {
    const placeholder = document.createElement('article');
    placeholder.className = 'card card-placeholder';
    cards.appendChild(placeholder);
  }

  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages;
  pageInfo.textContent = `第 ${currentPage} / ${totalPages} 页`;
}

async function renderCanvasModule() {
  categoryTitle.textContent = '智能画布';
  countText.textContent = 'Tool Plus 原生画布';
  heroCount.textContent = `${tools.length} 项`;
  prevPageBtn.disabled = true;
  nextPageBtn.disabled = true;
  pageInfo.textContent = '同窗口模块';
  cards.innerHTML = '';

  if (activeCategory !== canvasCategory) return;
  const card = document.createElement('article');
  card.className = 'canvasModuleCard canvasLaunchCard';
  card.innerHTML = `
    <div class="canvasModuleHead">
      <span class="canvasModuleIcon">${createIcon('icon-canvas')}</span>
      <div>
        <h3>打开智能画布</h3>
        <p>在当前主窗口中进入 FlowCanvas SDK，添加节点、编排连线并保存本地工作流。</p>
      </div>
    </div>
    <div class="canvasLaunchPreview" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <div class="canvasModuleActions">
      <button id="canvasOpenBtn" class="primary" type="button">打开画布</button>
    </div>
  `;
  cards.appendChild(card);

  for (let index = 0; index < pageSize - 1; index += 1) {
    const placeholder = document.createElement('article');
    placeholder.className = 'card card-placeholder';
    cards.appendChild(placeholder);
  }

  card.querySelector('#canvasOpenBtn').onclick = openCanvas;
}

function currentWizardSteps() {
  const steps = [];
  if (!selectedTool || !toolsWithoutFileInput.has(selectedTool.key)) steps.push('input');
  if ((paramDefs[selectedTool && selectedTool.key] || []).length) steps.push('options');
  steps.push('output', 'result');
  return steps;
}

function stepLabel(step, index) {
  return ({
    input: '选择需要处理的记录',
    options: '功能参数',
    output: '设置保存位置',
    result: '开始处理'
  })[step] || `步骤 ${index + 1}`;
}

function updateWorkbenchStepper() {
  const steps = currentWizardSteps();
  document.querySelectorAll('.wizardStep').forEach(button => {
    const step = button.dataset.step;
    const visibleIndex = steps.indexOf(step);
    button.hidden = visibleIndex < 0;
    button.classList.toggle('active', step === workbenchStep);
    button.classList.toggle('done', visibleIndex >= 0 && visibleIndex < steps.indexOf(workbenchStep));
    const number = button.querySelector('span');
    if (number) number.textContent = String(visibleIndex + 1);
    const text = stepLabel(step, visibleIndex);
    button.childNodes.forEach(node => {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = text;
    });
  });
  document.querySelectorAll('.wizardPane').forEach(pane => {
    pane.classList.toggle('active', pane.dataset.step === workbenchStep);
  });
  document.querySelector('#wizardPrevBtn').hidden = steps.indexOf(workbenchStep) <= 0;
  const runButton = document.querySelector('#runBtn');
  runButton.textContent = workbenchStep === 'result'
    ? (activeTaskId && !['succeeded', 'partial_failed', 'failed', 'cancelled', 'timed_out'].includes(activeTaskState) ? '执行中' : '开始处理')
    : '下一步';
}

function setWorkbenchStep(step) {
  const steps = currentWizardSteps();
  workbenchStep = steps.includes(step) ? step : steps[0];
  updateWorkbenchStepper();
  renderInputPreview();
  renderOutputProfile();
  const workspace = document.querySelector('.toolFormWorkspace');
  if (workspace) requestAnimationFrame(() => { workspace.scrollTop = 0; });
}

function showBlockingModal(message, trigger = document.activeElement) {
  lastModalTrigger = trigger;
  const modal = document.querySelector('#blockingModal');
  document.querySelector('#blockingModalTitle').textContent = '需要先完成当前步骤';
  document.querySelector('#blockingModalMessage').textContent = message;
  document.querySelector('#blockingModalInput').hidden = true;
  document.querySelector('#blockingModalCancel').hidden = true;
  document.querySelector('#blockingModalOk').textContent = '确定';
  modalResolver = null;
  modal.hidden = false;
  document.querySelector('#blockingModalOk').focus();
}

function hideBlockingModal(result = true) {
  const modal = document.querySelector('#blockingModal');
  modal.hidden = true;
  if (modalResolver) {
    const input = document.querySelector('#blockingModalInput');
    modalResolver(result === true && !input.hidden ? input.value : result);
    modalResolver = null;
  }
  if (lastModalTrigger && typeof lastModalTrigger.focus === 'function') lastModalTrigger.focus();
}

function askModal({ title, message, inputValue = '', confirmText = '确定', cancelText = '取消' }, trigger = document.activeElement) {
  lastModalTrigger = trigger;
  document.querySelector('#blockingModalTitle').textContent = title;
  document.querySelector('#blockingModalMessage').textContent = message;
  const input = document.querySelector('#blockingModalInput');
  input.hidden = inputValue === null;
  input.value = inputValue || '';
  document.querySelector('#blockingModalOk').textContent = confirmText;
  const cancel = document.querySelector('#blockingModalCancel');
  cancel.hidden = false;
  cancel.textContent = cancelText;
  document.querySelector('#blockingModal').hidden = false;
  return new Promise(resolve => {
    modalResolver = resolve;
    (input.hidden ? document.querySelector('#blockingModalOk') : input).focus();
  });
}

function validateWorkbenchStep(step) {
  if (!selectedTool) return { ok: false, message: '尚未选择功能。' };
  if (step === 'input' && !toolsWithoutFileInput.has(selectedTool.key) && !selectedFiles.length) {
    return { ok: false, message: '请先添加需要处理的文件或文件夹。' };
  }
  if (step === 'options') {
    const invalid = [...paramBox.querySelectorAll('input, select')].find(input => !input.checkValidity());
    if (invalid) return { ok: false, message: '功能参数中还有不符合要求的字段。' };
  }
  if (step === 'output') {
    const destructive = document.querySelector('input[name="outputMode"][value="overwrite"]');
    if (destructive && destructive.checked) return { ok: false, message: '覆盖原路径是危险操作，本版交付先固定为安全输出到新位置。' };
  }
  return { ok: true };
}

function advanceWorkbench() {
  const validation = validateWorkbenchStep(workbenchStep);
  if (!validation.ok) {
    showBlockingModal(validation.message, document.querySelector('#runBtn'));
    return;
  }
  const steps = currentWizardSteps();
  const index = steps.indexOf(workbenchStep);
  if (index < steps.length - 1) {
    setWorkbenchStep(steps[index + 1]);
    return;
  }
  submitCurrentTool();
}

function retreatWorkbench() {
  const steps = currentWizardSteps();
  const index = steps.indexOf(workbenchStep);
  if (index > 0) setWorkbenchStep(steps[index - 1]);
}

function renderOutputProfile() {
  const panel = document.querySelector('#outputProfilePanel');
  if (!panel || !selectedTool) return;
  panel.innerHTML = '';
  const title = document.createElement('h3');
  title.textContent = ({
    'rename-preview': '命名落盘',
    'merge-single': '合并输出',
    'split-multiple': '拆分输出',
    'image-export': '图片导出',
    'office-export': 'Office 导出',
    'pdf-export': 'PDF 导出',
    'media-export': '媒体导出',
    download: '下载输出',
    'no-file-result': '结果导出'
  })[selectedTool.outputProfile] || '输出参数';
  panel.appendChild(title);
  const fields = Array.isArray(selectedTool.outputFields) ? selectedTool.outputFields : [];
  if (!fields.length) {
    const text = document.createElement('p');
    text.className = 'outputProfileHint';
    text.textContent = `${selectedTool.outputProfile || 'per-input-copy'} · 使用工具默认输出契约。`;
    panel.appendChild(text);
    return;
  }
  fields.forEach(field => {
    const row = document.createElement('label');
    row.className = 'outputField';
    const caption = document.createElement('span');
    caption.textContent = field.label || field.name;
    let control;
    if (field.type === 'select' && Array.isArray(field.choices)) {
      control = document.createElement('select');
      field.choices.forEach(choice => {
        const option = document.createElement('option');
        option.value = choice;
        option.textContent = choice;
        control.appendChild(option);
      });
    } else if (field.type === 'slider' || field.type === 'number') {
      control = document.createElement('input');
      control.type = 'number';
      if (field.min !== undefined) control.min = field.min;
      if (field.max !== undefined) control.max = field.max;
      if (field.step !== undefined) control.step = field.step;
    } else if (field.type === 'checkbox' || field.type === 'switch') {
      control = document.createElement('input');
      control.type = 'checkbox';
      control.checked = Boolean(field.value);
    } else {
      control = document.createElement('input');
      control.type = 'text';
    }
    control.dataset.name = field.name;
    control.dataset.outputField = 'true';
    if (field.value !== undefined && control.type !== 'checkbox') control.value = String(field.value);
    if (field.locked) control.disabled = true;
    row.append(caption, control);
    panel.appendChild(row);
  });
}

function openToolView(tool) {
  selectedTool = tool;
  selectedFiles = [];
  selectedOutput = selectedOutputs.get(tool.key) || '';
  noticeBar.hidden = true;
  clearTimeout(noticeTimer);
  document.querySelector('#dialogTitle').textContent = tool.title;
  document.querySelector('#dialogDesc').textContent = tool.description;
  document.querySelector('#toolViewKey').textContent = tool.key;
  document.querySelector('#pickedFiles').textContent = '未选择';
  document.querySelector('#pickedOutput').textContent = selectedOutput || `默认：${workspaceRoot}\\${tool.key}\\output`;
  document.querySelector('#inputFileField').hidden = toolsWithoutFileInput.has(tool.key);
  paramBox.innerHTML = '';
  inspectedInputs = [];
  activeTaskId = '';
  activeTaskState = '';
  pendingRetryInputs = [];
  clearInterval(taskPollTimer);
  taskProgressPanel.hidden = true;
  taskCancelBtn.hidden = true;
  document.querySelector('#runBtn').disabled = false;
  document.querySelector('#runBtn').textContent = '下一步';

  (paramDefs[tool.key] || []).forEach(param => {
    const row = document.createElement('div');
    row.className = 'param';

    const label = document.createElement('label');
    label.textContent = param.label;

    let input;
    if (param.type === 'select') {
      input = document.createElement('select');
      param.choices.forEach(choice => {
        const option = document.createElement('option');
        option.value = choice;
        option.textContent = choice;
        input.appendChild(option);
      });
    } else {
      input = document.createElement('input');
      input.type = param.type || 'text';
    }

    input.dataset.name = param.name;
    if (param.value !== undefined) {
      input.value = String(param.value);
    } else if (param.type !== 'select') {
      input.value = '';
    }
    if (param.min !== undefined) input.min = param.min;
    if (param.max !== undefined) input.max = param.max;
    if (param.step !== undefined) input.step = param.step;
    row.append(label, input);
    input.addEventListener('input', renderInputPreview);
    input.addEventListener('change', renderInputPreview);
    paramBox.appendChild(row);
  });

  noParamsHint.hidden = (paramDefs[tool.key] || []).length > 0;
  toolRunStatus.textContent = '等待选择记录';
  toolOpenResultBtn.hidden = true;
  toolOpenResultBtn.dataset.path = '';
  showView(toolView);
  workbenchStep = currentWizardSteps()[0];
  setWorkbenchStep(workbenchStep);
  renderSidebar();
}

document.querySelector('#toolBackBtn').onclick = showCatalogView;
document.querySelector('#toolCancelBtn').onclick = showCatalogView;

async function chooseToolInputs(forceFolders = false) {
  if (!selectedTool) return;
  selectedFiles = forceFolders || folderInputTools.has(selectedTool.key)
    ? await toolApi.selectFolders()
    : await toolApi.selectFiles();
  document.querySelector('#pickedFiles').textContent = selectedFiles.length
    ? `已选择 ${selectedFiles.length} 个${folderInputTools.has(selectedTool.key) ? '文件夹' : '文件'}`
    : '未选择';
  const inspection = await toolApi.inspectInputs(selectedFiles);
  inspectedInputs = inspection.ok ? inspection.items : [];
  if (!inspection.ok) showNotice(inspection.error || '输入检查失败。', 'error');
  renderInputPreview();
}

document.querySelector('#pickFiles').onclick = () => chooseToolInputs(false);
document.querySelector('#pickFilesTop').onclick = () => chooseToolInputs(false);
document.querySelector('#pickFoldersTop').onclick = () => chooseToolInputs(true);
document.querySelector('#pickFoldersInline').onclick = () => chooseToolInputs(true);
document.querySelector('#clearInputsBtn').onclick = () => {
  selectedFiles = [];
  inspectedInputs = [];
  pendingRetryInputs = [];
  document.querySelector('#pickedFiles').textContent = '未选择';
  renderInputPreview();
};

document.querySelector('#pickOutput').onclick = async () => {
  const output = await toolApi.selectOutput();
  if (output) {
    selectedOutput = output;
    selectedOutputs.set(selectedTool.key, output);
  }
  document.querySelector('#pickedOutput').textContent = selectedOutput || `默认：${workspaceRoot}\\${selectedTool.key}\\output`;
  renderInputPreview();
};

function collectOptions() {
  const options = {};
  document.querySelectorAll('#paramBox input, #paramBox select, #outputProfilePanel input, #outputProfilePanel select').forEach(input => {
    if (!input.dataset.name || input.disabled) return;
    options[input.dataset.name] = input.type === 'checkbox' ? String(input.checked) : input.value;
  });
  return options;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatElapsed(ms) {
  const seconds = Math.floor((Number(ms) || 0) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function namingPreview(name, options) {
  if (!selectedTool || !/^(file|folder|rename)-/.test(selectedTool.key)) return '';
  const key = selectedTool.key;
  const prefix = options.prefix || '';
  const suffix = options.suffix || '';
  const find = options.find || options.search || options.old || '';
  const replacement = options.replace || options.replacement || options.new || '';
  if (key.includes('prefix-suffix')) return `${prefix}${name}${suffix}`;
  if (key.includes('replace') && find) return name.split(find).join(replacement);
  if (key.includes('case')) {
    const mode = String(options.mode || options.case || '').toLowerCase();
    return mode.includes('upper') || mode.includes('大写') ? name.toUpperCase() : name.toLowerCase();
  }
  return '';
}

function categoryKind(tool) {
  const category = String(tool && tool.category || '');
  if (category.includes('文本')) return 'text';
  if (category.includes('图片')) return 'image';
  if (category.includes('PDF')) return 'pdf';
  if (/(Word|Excel|PPT)/.test(category)) return 'office';
  if (/(视频|音频|网页)/.test(category)) return 'media';
  return 'file';
}

function appendWorkspaceHeading(parent, eyebrow, title, description, facts = []) {
  const header = document.createElement('header');
  header.className = 'categoryWorkspaceHeader';
  const copy = document.createElement('div');
  const label = document.createElement('small');
  label.textContent = eyebrow;
  const heading = document.createElement('h2');
  heading.textContent = title;
  const detail = document.createElement('p');
  detail.textContent = description;
  copy.append(label, heading, detail);
  const factList = document.createElement('div');
  factList.className = 'workspaceFacts';
  facts.forEach(([value, caption]) => {
    const fact = document.createElement('span');
    const strong = document.createElement('strong');
    strong.textContent = value;
    const small = document.createElement('small');
    small.textContent = caption;
    fact.append(strong, small);
    factList.appendChild(fact);
  });
  header.append(copy, factList);
  parent.appendChild(header);
}

function appendEmptyWorkspace(parent, title, description) {
  const empty = document.createElement('div');
  empty.className = 'workspaceEmpty';
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#icon-doc');
  icon.appendChild(use);
  const strong = document.createElement('strong');
  strong.textContent = title;
  const text = document.createElement('span');
  text.textContent = description;
  empty.append(icon, strong, text);
  parent.appendChild(empty);
}

function appendDataTable(parent, columns, rows, className = '') {
  const table = document.createElement('div');
  table.className = `workspaceTable ${className}`.trim();
  const head = document.createElement('div');
  head.className = 'workspaceTableRow workspaceTableHead';
  columns.forEach(column => {
    const cell = document.createElement('span');
    cell.textContent = column;
    head.appendChild(cell);
  });
  table.appendChild(head);
  rows.slice(0, 100).forEach(values => {
    const row = document.createElement('div');
    row.className = 'workspaceTableRow';
    values.forEach(value => {
      const cell = document.createElement('span');
      cell.textContent = value;
      cell.title = value;
      row.appendChild(cell);
    });
    table.appendChild(row);
  });
  parent.appendChild(table);
}

function renderImageWorkspace(options) {
  const first = inspectedInputs.find(item => !item.error);
  const dimensions = first && first.dimensions;
  appendWorkspaceHeading(categoryWorkspace, '图像工作台', '批量动作与结果对照', '左侧核对原图，右侧预估输出；参数变化不会改写原文件。', [
    [String(inspectedInputs.length), '队列'],
    [dimensions ? `${dimensions.width}×${dimensions.height}` : '—', '当前尺寸']
  ]);
  if (!first) {
    appendEmptyWorkspace(categoryWorkspace, '选择图片开始预览', '支持批量动作队列；选择后显示原图尺寸、格式和输出参数。');
    return;
  }
  const compare = document.createElement('div');
  compare.className = 'imageCompare';
  ['原始', '输出预估'].forEach((labelText, index) => {
    const pane = document.createElement('figure');
    const label = document.createElement('figcaption');
    label.textContent = labelText;
    const surface = document.createElement('div');
    surface.className = 'imageSurface';
    if (first.thumbnail) {
      const image = document.createElement('img');
      image.src = first.thumbnail;
      image.alt = index ? `${first.name} 输出预估` : first.name;
      surface.appendChild(image);
    } else {
      const placeholder = document.createElement('span');
      placeholder.textContent = first.extension ? first.extension.slice(1).toUpperCase() : 'IMAGE';
      surface.appendChild(placeholder);
    }
    const meta = document.createElement('small');
    meta.textContent = index
      ? `${options.format || options.type || '保持格式'} · ${options.quality ? `质量 ${options.quality}` : '使用当前参数'}`
      : `${formatBytes(first.size)}${dimensions ? ` · ${dimensions.width}×${dimensions.height}` : ''}`;
    pane.append(label, surface, meta);
    compare.appendChild(pane);
  });
  categoryWorkspace.appendChild(compare);
}

function renderFileWorkspace(options) {
  const outcomes = inspectedInputs.map(item => namingPreview(item.name, options) || item.name);
  const conflicts = outcomes.filter((name, index) => outcomes.indexOf(name) !== index).length;
  appendWorkspaceHeading(categoryWorkspace, '文件规则工作台', '旧名称 / 新名称实时核对', '规则只生成预览；存在重名冲突时禁止执行。', [
    [String(inspectedInputs.length), '项目'],
    [String(conflicts), '冲突']
  ]);
  if (!inspectedInputs.length) {
    appendEmptyWorkspace(categoryWorkspace, '选择文件或文件夹', '选择后会生成逐项变更清单，并标出重名和无变化项目。');
    return;
  }
  appendDataTable(categoryWorkspace, ['原名称', '新名称', '状态'], inspectedInputs.map((item, index) => [
    item.name,
    outcomes[index],
    outcomes.indexOf(outcomes[index]) !== index ? '名称冲突' : (outcomes[index] === item.name ? '无变化' : '待处理')
  ]), 'fileRuleTable');
}

function renderTextWorkspace(options) {
  const first = inspectedInputs.find(item => !item.error);
  const query = options.find || options.search || options.query || '';
  const sample = first && first.text && first.text.sample || '';
  const matches = query && sample ? sample.split(query).length - 1 : 0;
  appendWorkspaceHeading(categoryWorkspace, '文本工作台', '内容、匹配与编码', '在执行前核对文本样本、查找命中和编码状态。', [
    [first && first.text ? first.text.encoding : '—', '编码'],
    [String(matches), '样本命中']
  ]);
  if (!first) {
    appendEmptyWorkspace(categoryWorkspace, '选择文本文件', '选择后显示实际编码、行数与内容样本。');
    return;
  }
  const editor = document.createElement('div');
  editor.className = 'textWorkbench';
  const gutter = document.createElement('div');
  gutter.className = 'textGutter';
  const lines = Math.max(1, Math.min(14, first.text && first.text.lines || 1));
  gutter.textContent = Array.from({ length: lines }, (_, index) => index + 1).join('\n');
  const content = document.createElement('pre');
  content.textContent = sample || '当前文件没有可显示的文本样本。';
  editor.append(gutter, content);
  categoryWorkspace.appendChild(editor);
}

function renderPdfWorkspace() {
  const first = inspectedInputs.find(item => !item.error);
  const pages = Number(first && first.pdf && first.pdf.pages) || 0;
  appendWorkspaceHeading(categoryWorkspace, 'PDF 工作台', '页面范围与文档预览', '先确认页数、页面范围和不可逆影响，再提交处理。', [
    [pages ? String(pages) : '—', '页数'],
    [String(inspectedInputs.length), '文档']
  ]);
  if (!first) {
    appendEmptyWorkspace(categoryWorkspace, '选择 PDF 文档', '选择后显示真实页数、页面导航和操作范围。');
    return;
  }
  const viewer = document.createElement('div');
  viewer.className = 'pdfWorkbench';
  const rail = document.createElement('div');
  rail.className = 'pdfPageRail';
  const shown = Math.min(Math.max(pages, 1), 8);
  for (let index = 1; index <= shown; index += 1) {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.textContent = `第 ${index} 页`;
    if (index === 1) thumb.className = 'active';
    rail.appendChild(thumb);
  }
  const page = document.createElement('div');
  page.className = 'pdfPageSurface';
  const badge = document.createElement('span');
  badge.textContent = 'PDF';
  const name = document.createElement('strong');
  name.textContent = first.name;
  const scope = document.createElement('small');
  scope.textContent = pages ? `当前范围：第 1–${pages} 页` : '页数读取中；执行前需要核对范围';
  page.append(badge, name, scope);
  viewer.append(rail, page);
  categoryWorkspace.appendChild(viewer);
}

function renderOfficeWorkspace() {
  const first = inspectedInputs.find(item => !item.error);
  const kind = selectedTool.category.startsWith('Excel') ? '工作表' : (selectedTool.category.startsWith('PPT') ? '幻灯片' : '页面与对象');
  const count = Number(first && first.office && first.office.count) || 0;
  appendWorkspaceHeading(categoryWorkspace, 'Office 工作台', `${kind}范围`, '按文档原生结构选择处理范围，避免把 Word、Excel 和 PPT 当成普通文件。', [
    [count ? String(count) : '—', kind],
    [String(inspectedInputs.length), '文档']
  ]);
  if (!first) {
    appendEmptyWorkspace(categoryWorkspace, '选择 Office 文档', `选择后显示${kind}数量、媒体对象与处理范围。`);
    return;
  }
  const model = document.createElement('div');
  model.className = `officeModel office-${selectedTool.category.split(' ')[0].toLowerCase()}`;
  const rail = document.createElement('div');
  rail.className = 'officeObjectRail';
  const shown = Math.min(Math.max(count, 3), 8);
  for (let index = 1; index <= shown; index += 1) {
    const item = document.createElement('span');
    item.textContent = `${kind} ${index}`;
    if (index === 1) item.className = 'active';
    rail.appendChild(item);
  }
  const surface = document.createElement('div');
  surface.className = 'officeSurface';
  const title = document.createElement('strong');
  title.textContent = first.name;
  const detail = document.createElement('span');
  detail.textContent = first.office && first.office.mediaCount ? `${first.office.mediaCount} 个媒体对象` : '保留原文档结构进行处理';
  surface.append(title, detail);
  model.append(rail, surface);
  categoryWorkspace.appendChild(model);
}

function formatDuration(seconds) {
  if (!Number.isFinite(Number(seconds))) return '—';
  const value = Math.max(0, Math.round(Number(seconds)));
  return `${String(Math.floor(value / 3600)).padStart(2, '0')}:${String(Math.floor(value % 3600 / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}

function renderMediaWorkspace() {
  const first = inspectedInputs.find(item => !item.error);
  const media = first && first.media || {};
  appendWorkspaceHeading(categoryWorkspace, '媒体队列', '源文件、预设与处理队列', '核对时长、分辨率和输出预设；运行后按真实任务状态更新。', [
    [formatDuration(media.durationSeconds), '时长'],
    [media.width && media.height ? `${media.width}×${media.height}` : '—', '画面']
  ]);
  if (!first && !toolsWithoutFileInput.has(selectedTool.key)) {
    appendEmptyWorkspace(categoryWorkspace, '选择音视频文件', '选择后读取媒体流信息，并显示批处理队列。');
    return;
  }
  const rows = inspectedInputs.length ? inspectedInputs.map(item => [
    item.name,
    formatDuration(item.media && item.media.durationSeconds),
    item.media && item.media.width ? `${item.media.width}×${item.media.height}` : (item.extension || '—'),
    '等待执行'
  ]) : [['网络媒体地址', '—', '由下载器检测', '等待执行']];
  appendDataTable(categoryWorkspace, ['源文件', '时长', '规格', '队列状态'], rows, 'mediaQueueTable');
}

function renderInputRecordTable() {
  const kind = categoryKind(selectedTool);
  const needsInput = !toolsWithoutFileInput.has(selectedTool.key);
  if (!inspectedInputs.length) {
    appendEmptyWorkspace(
      categoryWorkspace,
      needsInput ? '您可以将文件或文件夹拖放到此处' : '此功能不需要本地输入',
      needsInput ? '也可以使用右上角按钮添加文件或从文件夹导入。' : '继续设置参数和保存位置即可。'
    );
    return;
  }
  const rows = inspectedInputs.slice(0, 100).map((item, index) => {
    const statusText = item.error ? item.error : '可处理';
    if (kind === 'image') {
      return [
        String(index + 1),
        item.name,
        item.dimensions ? `${item.dimensions.width}×${item.dimensions.height}` : '—',
        item.extension || '—',
        formatBytes(item.size),
        statusText,
        '移除'
      ];
    }
    if (kind === 'pdf') {
      return [
        item.name,
        item.pdf && item.pdf.pages ? `${item.pdf.pages} 页` : '页数待检测',
        formatBytes(item.size),
        item.encrypted ? '加密' : '未加密',
        statusText
      ];
    }
    if (kind === 'office') {
      return [
        item.name,
        item.office && item.office.count ? `${item.office.count} 项结构` : '结构待检测',
        formatBytes(item.size),
        item.encrypted ? '加密' : '未加密',
        statusText
      ];
    }
    if (kind === 'media') {
      return [
        item.name,
        item.media ? formatDuration(item.media.durationSeconds) : '—',
        item.media && item.media.width ? `${item.media.width}×${item.media.height}` : (item.extension || '—'),
        item.media && item.media.codec ? item.media.codec : '—',
        formatBytes(item.size),
        statusText
      ];
    }
    if (item.directory) {
      return [String(index + 1), item.name, item.path, item.children ? `${item.children} 项` : '待统计', statusText, '移除'];
    }
    return [String(index + 1), item.name, item.path, item.extension || '—', formatBytes(item.size), statusText, '移除'];
  });
  if (kind === 'image') appendDataTable(categoryWorkspace, ['序号', '名称', '尺寸', '格式', '大小', '状态', '操作'], rows, 'inputRecordTable imageRecordTable');
  else if (kind === 'pdf' || kind === 'office') appendDataTable(categoryWorkspace, ['名称', '页/表/幻灯片数', '大小', '加密状态', '状态'], rows, 'inputRecordTable officeRecordTable');
  else if (kind === 'media') appendDataTable(categoryWorkspace, ['名称', '时长', '分辨率/采样率', '编码', '大小', '状态'], rows, 'inputRecordTable mediaRecordTable');
  else if (inspectedInputs.some(item => item.directory)) appendDataTable(categoryWorkspace, ['序号', '文件夹名', '路径', '包含项数', '状态', '操作'], rows, 'inputRecordTable folderRecordTable');
  else appendDataTable(categoryWorkspace, ['序号', '名称', '路径', '类型', '大小', '状态', '操作'], rows, 'inputRecordTable fileRecordTable');
}

function renderCategoryWorkspace() {
  if (!categoryWorkspace || !selectedTool) return;
  categoryWorkspace.textContent = '';
  const kind = categoryKind(selectedTool);
  categoryWorkspace.dataset.category = kind;
  if (workbenchStep === 'input') {
    appendWorkspaceHeading(categoryWorkspace, '选择记录', selectedTool.title, '输入记录会在执行前再次校验，原文件保持只读。', [
      [String(selectedFiles.length), '已选'],
      [selectedOutput ? '自定义' : '默认', '输出']
    ]);
    renderInputRecordTable();
    return;
  }
  const options = collectOptions();
  if (kind === 'image') renderImageWorkspace(options);
  else if (kind === 'text') renderTextWorkspace(options);
  else if (kind === 'pdf') renderPdfWorkspace();
  else if (kind === 'office') renderOfficeWorkspace();
  else if (kind === 'media') renderMediaWorkspace();
  else renderFileWorkspace(options);
}

function renderInputPreview() {
  if (!inputPreview || !selectedTool) return;
  inputPreview.innerHTML = '';
  const needsInput = !toolsWithoutFileInput.has(selectedTool.key);
  const options = collectOptions();
  const invalidControls = [...paramBox.querySelectorAll('input')].filter(input => !input.checkValidity());
  const failures = inspectedInputs.filter(item => item.error);
  const minInputs = Number(selectedTool.limits && selectedTool.limits.minInputs);
  const maxInputs = Number(selectedTool.limits && selectedTool.limits.maxInputs);
  const belowLimit = Number.isFinite(minInputs) && selectedFiles.length < minInputs;
  const exceedsLimit = Number.isFinite(maxInputs) && selectedFiles.length > maxInputs;
  const maxPixels = Number(selectedTool.limits && selectedTool.limits.maxPixelsPerImage);
  const maxWidth = Number(selectedTool.limits && selectedTool.limits.maxWidth);
  const maxHeight = Number(selectedTool.limits && selectedTool.limits.maxHeight);
  const maxInputBytes = Number(selectedTool.limits && selectedTool.limits.maxInputBytes);
  const oversizedFiles = inspectedInputs.filter(item => !item.directory && Number.isFinite(maxInputBytes) && Number(item.size) > maxInputBytes);
  const oversizedImages = inspectedInputs.filter(item => item.dimensions && (
    (Number.isFinite(maxPixels) && item.dimensions.width * item.dimensions.height > maxPixels) ||
    (Number.isFinite(maxWidth) && item.dimensions.width > maxWidth) ||
    (Number.isFinite(maxHeight) && item.dimensions.height > maxHeight)
  ));
  const maxDurationSeconds = Number(selectedTool.limits && selectedTool.limits.maxDurationSeconds);
  const oversizedMedia = inspectedInputs.filter(item => item.media && (
    (Number.isFinite(maxDurationSeconds) && Number(item.media.durationSeconds) > maxDurationSeconds) ||
    (Number.isFinite(maxWidth) && Number(item.media.width) > maxWidth) ||
    (Number.isFinite(maxHeight) && Number(item.media.height) > maxHeight)
  ));
  const maxSheets = Number(selectedTool.limits && selectedTool.limits.maxSheets);
  const maxSlides = Number(selectedTool.limits && selectedTool.limits.maxSlides);
  const maxEmbeddedMedia = Number(selectedTool.limits && selectedTool.limits.maxEmbeddedMedia);
  const maxEmbeddedMediaBytes = Number(selectedTool.limits && selectedTool.limits.maxEmbeddedMediaBytes);
  const oversizedOffice = inspectedInputs.filter(item => item.office && (
    (Number.isFinite(maxSheets) && Number(item.office.count) > maxSheets) ||
    (Number.isFinite(maxSlides) && Number(item.office.count) > maxSlides) ||
    (Number.isFinite(maxEmbeddedMedia) && Number(item.office.mediaCount) > maxEmbeddedMedia) ||
    (Number.isFinite(maxEmbeddedMediaBytes) && Number(item.office.maxMediaBytes) > maxEmbeddedMediaBytes)
  ));
  const outputNames = inspectedInputs.map(item => namingPreview(item.name, options)).filter(Boolean);
  const conflicts = outputNames.filter((name, index) => outputNames.indexOf(name) !== index);
  const valid = (!needsInput || selectedFiles.length > 0) && !invalidControls.length && !failures.length && !conflicts.length && !belowLimit && !exceedsLimit && !oversizedFiles.length && !oversizedImages.length && !oversizedOffice.length && !oversizedMedia.length;

  validationBadge.textContent = valid ? '可以执行' : '需要处理';
  validationBadge.dataset.tone = valid ? 'success' : 'error';
  const totalBytes = inspectedInputs.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  previewSummary.textContent = selectedFiles.length
    ? `${selectedFiles.length} 项 · ${formatBytes(totalBytes)} · 仅渲染前 ${Math.min(inspectedInputs.length, 100)} 项，避免极端批量冻结`
    : (needsInput ? '选择真实文件后显示输入摘要与风险。' : '此工具无需本地输入文件，请确认参数。');

  const risks = [];
  if (needsInput && !selectedFiles.length) risks.push('尚未选择输入文件。');
  if (invalidControls.length) risks.push('有参数超出允许范围，请检查标红字段。');
  if (failures.length) risks.push(`${failures.length} 个输入无法读取，请移除或恢复权限。`);
  if (belowLimit) risks.push(`此工具至少需要 ${minInputs} 个输入，当前只有 ${selectedFiles.length} 个。`);
  if (exceedsLimit) risks.push(`输入数量 ${selectedFiles.length} 超过此工具上限 ${maxInputs}，请拆分批次。`);
  if (oversizedFiles.length) risks.push(`${oversizedFiles.length} 个文件超过此工具的单文件硬上限 ${formatBytes(maxInputBytes)}，请拆分或改用更适合超大文件的工具。`);
  if (oversizedImages.length) risks.push(`${oversizedImages.length} 张图片超过此工具的 ${maxPixels} 像素硬上限。`);
  if (oversizedOffice.length) risks.push(`${oversizedOffice.length} 个 Office 文件超过工作表、幻灯片、媒体数量或单媒体大小硬上限，请拆分文档或压缩超大图片后重试。`);
  if (oversizedMedia.length) risks.push(`${oversizedMedia.length} 个媒体文件超过 ${maxWidth || '不限'}×${maxHeight || '不限'} 或 ${maxDurationSeconds || '不限'} 秒硬上限，请先裁剪、缩放或拆分。`);
  if (conflicts.length) risks.push(`预览发现 ${new Set(conflicts).size} 个同名冲突，执行前必须修改规则。`);
  if (selectedTool.maturity !== 'stable') risks.push('此功能尚未完成方案要求的 L0–L5 全矩阵验收，当前按实验功能展示。');
  if (/pdf-(redact|compress)/.test(selectedTool.key)) risks.push('此 PDF 操作可能改变文本层、链接、书签或表单；请保留原文件并核对结果。');
  if (/image-/.test(selectedTool.key)) risks.push('格式转换可能影响透明通道、色彩配置或动画帧；完成后请检查结果摘要。');
  riskNotice.hidden = !risks.length;
  riskNotice.textContent = risks.join(' ');

  inspectedInputs.slice(0, 100).forEach(item => {
    const row = document.createElement('div');
    row.className = 'previewRow';
    row.dataset.error = Boolean(item.error || oversizedFiles.includes(item) || oversizedOffice.includes(item) || oversizedMedia.includes(item));
    const identity = document.createElement('strong');
    identity.textContent = item.name;
    identity.title = item.path;
    const detail = document.createElement('span');
    const dimensions = item.dimensions ? ` · ${item.dimensions.width}×${item.dimensions.height}` : '';
    detail.textContent = item.error || `${formatBytes(item.size)}${dimensions}`;
    const outcome = document.createElement('span');
    outcome.textContent = namingPreview(item.name, options) || '输出新文件，不覆盖原文件';
    row.append(identity, detail, outcome);
    inputPreview.appendChild(row);
  });
  renderCategoryWorkspace();
  return valid;
}

function updateTaskUI(task) {
  if (!task || task.id !== activeTaskId) return;
  activeTaskState = task.state;
  const terminal = ['succeeded', 'partial_failed', 'failed', 'cancelled', 'timed_out'].includes(task.state);
  taskProgressPanel.hidden = false;
  taskProgressPanel.dataset.running = String(task.state === 'running');
  taskProgressPanel.dataset.terminal = String(terminal);
  taskProgressPanel.dataset.state = task.state;
  const determinate = task.progressAvailable === true && Number.isFinite(Number(task.percent));
  taskProgressPanel.dataset.determinate = String(determinate);
  const progressFill = document.querySelector('#progressFill');
  if (determinate) {
    progressFill.style.width = `${Math.max(0, Math.min(100, Number(task.percent)))}%`;
    progressFill.style.transform = 'none';
  } else {
    progressFill.style.width = '';
    progressFill.style.transform = '';
  }
  document.querySelector('#taskPhase').textContent = task.phase || '任务处理中';
  const itemProgress = Number.isFinite(Number(task.totalItems)) ? ` · ${Number(task.completedItems) || 0}/${task.totalItems} 项` : '';
  const eta = Number.isFinite(Number(task.etaMs)) ? ` · 剩余 ${formatElapsed(task.etaMs)}` : '';
  document.querySelector('#taskTiming').textContent = `已用 ${formatElapsed(task.elapsedMs)}${itemProgress}${eta} · 分类超时 ${task.timeoutSeconds} 秒`;
  document.querySelector('#taskStateBadge').textContent = ({ queued: '排队中', running: '运行中', succeeded: '成功', partial_failed: '部分完成', failed: '失败', cancelled: '已取消', timed_out: '已超时' })[task.state] || task.state;
  const currentName = task.currentItem ? String(task.currentItem).split(/[\\/]/).pop() : '';
  document.querySelector('#taskCurrentFile').textContent = task.state === 'running'
    ? (determinate
      ? `${currentName ? `当前：${currentName} · ` : ''}${Number(task.percent).toFixed(0)}%${task.speed ? ` · ${task.speed}` : ''}`
      : `${currentName ? `当前：${currentName} · ` : ''}此操作没有可验证的中间百分比，完成前仅显示真实耗时。`)
    : '';
  taskCancelBtn.hidden = terminal;
  const runButton = document.querySelector('#runBtn');
  runButton.disabled = !terminal;
  runButton.textContent = terminal ? '再次执行' : (task.state === 'queued' ? '排队中' : '执行中');
  const results = document.querySelector('#taskResults');
  results.textContent = '';
  if (!terminal) {
    const workspace = document.querySelector('.toolFormWorkspace');
    requestAnimationFrame(() => { workspace.scrollTop = workspace.scrollHeight; });
  }
  if (!terminal) {
    toolRunStatus.textContent = task.state === 'queued' ? '任务正在排队' : '任务正在执行';
    return;
  }

  clearInterval(taskPollTimer);
  if (task.state === 'succeeded') {
    const firstOutput = task.outputs[0] || '';
    toolRunStatus.textContent = firstOutput ? `执行完成，共 ${task.outputs.length} 个结果` : '执行完成';
    status.textContent = firstOutput ? `执行完成，已保存到：${firstOutput}` : '执行完成';
    results.textContent = task.outputs.length ? task.outputs.join('\n') : '后端未返回输出清单，请核对工具行为。';
    if (firstOutput) {
      for (const button of [openResultBtn, toolOpenResultBtn]) {
        button.dataset.path = firstOutput;
        button.hidden = false;
      }
    }
    appendLog(`${selectedTool.title}\n${task.outputs.join('\n')}`);
  } else if (task.state === 'partial_failed') {
    pendingRetryInputs = Array.isArray(task.failedInputs) ? task.failedInputs.filter(Boolean) : [];
    toolRunStatus.textContent = `${task.itemResults.length - pendingRetryInputs.length} 项成功，${pendingRetryInputs.length} 项失败`;
    status.textContent = `${selectedTool.title} 部分完成`;
    runButton.textContent = pendingRetryInputs.length ? `重试失败项（${pendingRetryInputs.length}）` : '再次执行';
    const lines = (task.itemResults || []).map(item => {
      const name = item.input ? String(item.input).split(/[\\/]/).pop() : '当前任务';
      return item.state === 'succeeded' ? `成功  ${name}` : `失败  ${name}：${item.error || '未知错误'}`;
    });
    results.textContent = lines.join('\n');
    appendLog(`${selectedTool.title} 部分完成\n${lines.join('\n')}`);
    showNotice('部分文件处理失败，可以直接重试失败项。', 'error');
  } else if (task.state === 'cancelled') {
    toolRunStatus.textContent = '已取消并清理进程';
    status.textContent = '任务已取消';
    results.textContent = task.cancellationLatencyMs === null ? '任务在启动前取消。' : `取消耗时 ${task.cancellationLatencyMs} ms；请核对输出目录中是否存在临时文件。`;
    appendLog(`${selectedTool.title} 已取消`);
  } else {
    toolRunStatus.textContent = task.state === 'timed_out' ? '执行超时' : '执行失败';
    status.textContent = toolRunStatus.textContent;
    results.textContent = task.error || task.phase;
    appendLog(`失败：${task.error || task.phase}`);
    showNotice(task.error || task.phase, 'error');
  }
}

async function submitCurrentTool() {
  if (!renderInputPreview()) {
    toolRunStatus.textContent = '请先修复预览中的问题';
    showBlockingModal('执行前检查未通过，请按预览提示修复。', document.querySelector('#runBtn'));
    return;
  }
  status.textContent = `正在提交：${selectedTool.title}`;
  toolRunStatus.textContent = '正在创建任务';
  openResultBtn.hidden = true;
  toolOpenResultBtn.hidden = true;
  document.querySelector('#runBtn').disabled = true;
  document.querySelector('#runBtn').textContent = '正在提交';
  const retryInputs = pendingRetryInputs.length ? [...pendingRetryInputs] : null;
  const executionInputs = retryInputs || selectedFiles;
  pendingRetryInputs = [];
  const response = await toolApi.startTask({
    tool: selectedTool.key,
    inputs: executionInputs,
    inputMetadata: inspectedInputs.filter(item => executionInputs.includes(item.path)).map(item => ({ path: item.path, dimensions: item.dimensions, office: item.office, media: item.media })),
    outputDir: selectedOutput,
    options: collectOptions()
  });
  if (!response.ok || !response.task) {
    if (retryInputs) pendingRetryInputs = retryInputs;
    document.querySelector('#runBtn').disabled = false;
    document.querySelector('#runBtn').textContent = '开始执行';
    toolRunStatus.textContent = '任务创建失败';
    showNotice(response.error || '无法创建任务。', 'error');
    return;
  }
  activeTaskId = response.task.id;
  updateTaskUI(response.task);
  clearInterval(taskPollTimer);
  taskPollTimer = setInterval(async () => {
    const current = await toolApi.getTask(activeTaskId);
    if (current.ok && current.task) updateTaskUI(current.task);
  }, 500);
}

document.querySelector('#runBtn').onclick = event => {
  event.preventDefault();
  advanceWorkbench();
};

document.querySelector('#wizardPrevBtn').onclick = retreatWorkbench;

document.querySelectorAll('.wizardStep').forEach(button => {
  button.onclick = () => {
    const steps = currentWizardSteps();
    const targetIndex = steps.indexOf(button.dataset.step);
    const currentIndex = steps.indexOf(workbenchStep);
    if (targetIndex >= 0 && targetIndex <= currentIndex) setWorkbenchStep(button.dataset.step);
  };
});

document.querySelector('#blockingModalOk').onclick = () => hideBlockingModal(true);
document.querySelector('#blockingModalCancel').onclick = () => hideBlockingModal(false);
document.querySelector('#blockingModal').addEventListener('keydown', event => {
  if (event.key === 'Escape') hideBlockingModal(false);
});

taskCancelBtn.onclick = async () => {
  if (!activeTaskId || !['queued', 'running'].includes(activeTaskState)) return;
  taskCancelBtn.disabled = true;
  const result = await toolApi.cancelTask(activeTaskId);
  taskCancelBtn.disabled = false;
  if (!result.ok) showNotice(result.error, 'error');
};

toolApi.onTaskUpdate(updateTaskUI);

openResultBtn.onclick = async () => {
  const result = await toolApi.revealResult(openResultBtn.dataset.path);
  if (!result.ok) showNotice(result.error, 'error');
};

toolOpenResultBtn.onclick = async () => {
  const result = await toolApi.revealResult(toolOpenResultBtn.dataset.path);
  if (!result.ok) showNotice(result.error, 'error');
};

function newWorkflowDraft(name) {
  return {
    name: name || `任务流 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    description: '',
    failurePolicy: 'stop-on-error',
    outputPolicy: { mode: 'new-directory' },
    conflictPolicy: 'auto-number',
    notification: 'app',
    concurrency: 0
  };
}

function workflowToolByKey(key) {
  return tools.find(tool => tool.key === key);
}

async function openWorkflowView() {
  showView(workflowView);
  renderSidebar();
  await loadWorkflows();
}

async function loadWorkflows() {
  const response = await toolApi.workflowList();
  if (!response.ok) {
    showNotice(response.error || '任务流读取失败。', 'error');
    return;
  }
  workflows = Array.isArray(response.data) ? response.data : [];
  renderWorkflowRows();
}

function renderWorkflowRows() {
  const tbody = document.querySelector('#workflowRows');
  tbody.innerHTML = '';
  const query = document.querySelector('#workflowSearch').value.trim().toLowerCase();
  const filtered = workflows.filter(item => !query || `${item.name} ${item.description || ''}`.toLowerCase().includes(query));
  if (!filtered.length) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="5" class="workflowEmptyCell">暂无任务流</td>';
    tbody.appendChild(row);
    return;
  }
  filtered.forEach((workflow, index) => {
    const row = document.createElement('tr');
    row.dataset.workflowId = workflow.id;
    row.innerHTML = `
      <td>${index + 1}</td>
      <td><strong>${workflow.name}</strong><small>${workflow.description || '未填写描述'}</small></td>
      <td>${formatWorkflowTime(workflow.updatedAt)}</td>
      <td>${workflow.lastRunStatus || '未运行'} · v${workflow.version || 1}</td>
      <td class="workflowActions">
        <button data-action="run" class="blueAction" type="button">运行</button>
        <button data-action="steps" type="button">步骤设置</button>
        <button data-action="rename" type="button">修改</button>
        <button data-action="delete" class="dangerAction" type="button">删除</button>
      </td>
    `;
    row.querySelector('[data-action="steps"]').onclick = () => selectWorkflow(workflow.id);
    row.querySelector('[data-action="run"]').onclick = async () => {
      await selectWorkflow(workflow.id);
      document.querySelector('#workflowRunBtn').focus();
    };
    row.querySelector('[data-action="rename"]').onclick = async () => renameWorkflow(workflow);
    row.querySelector('[data-action="delete"]').onclick = async () => deleteWorkflow(workflow.id);
    tbody.appendChild(row);
  });
}

function formatWorkflowTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function selectWorkflow(workflowId) {
  selectedWorkflowId = workflowId;
  const response = await toolApi.workflowGet(workflowId);
  if (!response.ok) {
    showNotice(response.error || '无法打开任务流。', 'error');
    return;
  }
  selectedWorkflow = response.data;
  workflowSteps = Array.isArray(selectedWorkflow.steps) ? selectedWorkflow.steps : [];
  document.querySelector('#workflowDetail').hidden = false;
  document.querySelector('#workflowDetailTitle').textContent = `${selectedWorkflow.name} · 步骤设置`;
  document.querySelector('#workflowPickedInputs').textContent = workflowRunInputs.length ? `已选择 ${workflowRunInputs.length} 项` : '未选择';
  document.querySelector('#workflowPickedOutput').textContent = workflowRunOutput || '未选择';
  renderWorkflowSteps();
  await validateSelectedWorkflow();
}

function renderWorkflowSteps() {
  const container = document.querySelector('#workflowStepRows');
  container.innerHTML = '';
  if (!workflowSteps.length) {
    const empty = document.createElement('div');
    empty.className = 'workflowStepEmpty';
    empty.textContent = '当前任务还没有步骤，添加一个功能开始编排。';
    container.appendChild(empty);
    return;
  }
  workflowSteps.sort((a, b) => Number(a.sortIndex) - Number(b.sortIndex)).forEach((step, index) => {
    const tool = workflowToolByKey(step.toolKey);
    const row = document.createElement('article');
    row.className = 'workflowStepRow';
    row.dataset.stepId = step.id;
    const optionsText = Object.keys(step.options || {}).length ? JSON.stringify(step.options) : '默认参数';
    row.innerHTML = `
      <span class="workflowStepIndex">${index + 1}</span>
      <input class="workflowStepName" value="${escapeAttr(step.name || `步骤 ${index + 1}`)}">
      <select class="workflowToolSelect"></select>
      <label class="workflowToggle"><input type="checkbox" ${step.enabled ? 'checked' : ''}>启用</label>
      <span class="workflowStepSummary">${tool ? tool.outputProfile || tool.outputContract && tool.outputContract.kind || '输出契约' : '工具缺失'} · ${optionsText}</span>
      <div class="workflowStepActions">
        <button data-action="up" type="button">上移</button>
        <button data-action="down" type="button">下移</button>
        <button data-action="copy" type="button">复制</button>
        <button data-action="delete" class="dangerAction" type="button">删除</button>
      </div>
    `;
    const select = row.querySelector('.workflowToolSelect');
    tools.forEach(candidate => {
      const option = document.createElement('option');
      option.value = candidate.key;
      option.textContent = `${candidate.category} · ${candidate.title}${candidate.workflowCapable === false ? '（不可编排）' : ''}`;
      option.disabled = candidate.workflowCapable === false;
      select.appendChild(option);
    });
    select.value = step.toolKey;
    row.querySelector('.workflowStepName').onchange = async event => updateWorkflowStep({ ...step, name: event.target.value.trim() || step.name });
    select.onchange = async event => {
      const nextTool = workflowToolByKey(event.target.value);
      await updateWorkflowStep({ ...step, toolKey: event.target.value, name: nextTool ? nextTool.title : step.name, options: {} });
    };
    row.querySelector('.workflowToggle input').onchange = async event => {
      const response = await toolApi.workflowStepToggle({ stepId: step.id, enabled: event.target.checked });
      if (!response.ok) showNotice(response.error || '启停步骤失败。', 'error');
      await selectWorkflow(selectedWorkflowId);
    };
    row.querySelector('[data-action="up"]').onclick = () => moveWorkflowStep(index, -1);
    row.querySelector('[data-action="down"]').onclick = () => moveWorkflowStep(index, 1);
    row.querySelector('[data-action="copy"]').onclick = async () => {
      const response = await toolApi.workflowStepDuplicate(step.id);
      if (!response.ok) showNotice(response.error || '复制步骤失败。', 'error');
      await selectWorkflow(selectedWorkflowId);
    };
    row.querySelector('[data-action="delete"]').onclick = async () => {
      const response = await toolApi.workflowStepDelete(step.id);
      if (!response.ok) showNotice(response.error || '删除步骤失败。', 'error');
      await selectWorkflow(selectedWorkflowId);
    };
    container.appendChild(row);
  });
}

function escapeAttr(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function updateWorkflowStep(step) {
  const response = await toolApi.workflowStepUpdate(step);
  if (!response.ok) {
    showNotice(response.error || '保存步骤失败。', 'error');
    return;
  }
  await selectWorkflow(selectedWorkflowId);
}

async function moveWorkflowStep(index, delta) {
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= workflowSteps.length) return;
  const ordered = [...workflowSteps].sort((a, b) => Number(a.sortIndex) - Number(b.sortIndex));
  const [item] = ordered.splice(index, 1);
  ordered.splice(nextIndex, 0, item);
  const response = await toolApi.workflowStepReorder({ workflowId: selectedWorkflowId, orderedIds: ordered.map(step => step.id) });
  if (!response.ok) showNotice(response.error || '排序失败。', 'error');
  await selectWorkflow(selectedWorkflowId);
}

async function validateSelectedWorkflow() {
  if (!selectedWorkflowId) return;
  const response = await toolApi.workflowValidate(selectedWorkflowId);
  const issues = response.issues || [];
  const errors = issues.filter(issue => issue.severity === 'error');
  document.querySelector('#workflowIssues').textContent = errors.length
    ? `${errors.length} 个阻断问题：${errors[0].message}`
    : (issues.length ? `${issues.length} 个提醒` : '校验通过');
  document.querySelector('#workflowIssues').dataset.tone = errors.length ? 'error' : 'success';
}

async function createWorkflowFromTool(tool) {
  const created = await toolApi.workflowCreate(newWorkflowDraft(tool ? `${tool.title} 任务流` : '新任务流'));
  if (!created.ok) {
    showNotice(created.error || '创建任务流失败。', 'error');
    return null;
  }
  const workflow = created.data;
  if (tool) {
    const step = await toolApi.workflowStepCreate({
      workflowId: workflow.id,
      name: tool.title,
      enabled: true,
      toolKey: tool.key,
      options: collectOptions(),
      inputBinding: { source: 'run-input' }
    });
    if (!step.ok) showNotice(step.error || '任务流已创建，但步骤保存失败。', 'error');
  }
  await loadWorkflows();
  await selectWorkflow(workflow.id);
  return workflow;
}

async function renameWorkflow(workflow) {
  const nextName = await askModal({ title: '修改任务名称', message: '输入新的任务名称。', inputValue: workflow.name }, document.activeElement);
  if (nextName === false) return;
  const response = await toolApi.workflowUpdate({ ...workflow, name: String(nextName).trim() || workflow.name });
  if (!response.ok) showNotice(response.error || '修改任务失败。', 'error');
  await loadWorkflows();
}

async function deleteWorkflow(workflowId) {
  const confirmed = await askModal({ title: '删除任务流', message: '确定删除这个任务流？', inputValue: null, confirmText: '删除' }, document.activeElement);
  if (!confirmed) return;
  const response = await toolApi.workflowDelete(workflowId);
  if (!response.ok) showNotice(response.error || '删除任务失败。', 'error');
  if (selectedWorkflowId === workflowId) {
    selectedWorkflowId = '';
    selectedWorkflow = null;
    document.querySelector('#workflowDetail').hidden = true;
  }
  await loadWorkflows();
}

async function addWorkflowStep() {
  if (!selectedWorkflowId) return;
  const firstTool = tools.find(tool => tool.workflowCapable !== false) || tools[0];
  const response = await toolApi.workflowStepCreate({
    workflowId: selectedWorkflowId,
    name: firstTool ? firstTool.title : '新步骤',
    enabled: true,
    toolKey: firstTool ? firstTool.key : '',
    options: {},
    inputBinding: { source: workflowSteps.length ? 'previous-step' : 'run-input' }
  });
  if (!response.ok) showNotice(response.error || '添加步骤失败。', 'error');
  await selectWorkflow(selectedWorkflowId);
}

async function runSelectedWorkflow() {
  if (!selectedWorkflowId) return;
  if (!workflowRunOutput) {
    showNotice('请先选择最终输出目录。', 'error');
    return;
  }
  const response = await toolApi.workflowRunStart({ workflowId: selectedWorkflowId, inputs: workflowRunInputs, outputDir: workflowRunOutput });
  if (!response.ok) {
    showNotice(response.error || '任务流运行失败。', 'error');
    if (response.issues && response.issues.length) document.querySelector('#workflowIssues').textContent = response.issues[0].message;
    return;
  }
  activeWorkflowRunId = response.run && response.run.id || '';
  renderWorkflowRun(response.run);
}

function renderWorkflowRun(run) {
  const panel = document.querySelector('#workflowRunPanel');
  if (!run) return;
  panel.hidden = false;
  const summary = run.summary || {};
  const logs = Array.isArray(summary.logs) ? summary.logs.slice(-8) : [];
  const outputs = Array.isArray(summary.finalOutputs) ? summary.finalOutputs : [];
  panel.innerHTML = `
    <strong>运行状态：${run.status}</strong>
    <span>步骤 ${summary.completedSteps || 0}/${summary.totalSteps || workflowSteps.filter(step => step.enabled).length}</span>
    <pre>${logs.map(item => typeof item === 'string' ? item : item.message || JSON.stringify(item)).join('\n')}</pre>
    <p>${outputs.length ? outputs.join('\n') : '暂无最终输出。'}</p>
    <div>
      <button id="workflowRetryRunBtn" type="button">重试失败</button>
      <button id="workflowResumeRunBtn" type="button">恢复</button>
    </div>
  `;
  document.querySelector('#workflowCancelRunBtn').hidden = ['completed', 'partial', 'failed', 'cancelled', 'authorization_required'].includes(run.status);
  const retry = panel.querySelector('#workflowRetryRunBtn');
  const resume = panel.querySelector('#workflowResumeRunBtn');
  retry.onclick = async () => {
    const response = await toolApi.workflowRunRetry(run.id);
    if (response.ok) renderWorkflowRun(response.run); else showNotice(response.error || '重试失败。', 'error');
  };
  resume.onclick = async () => {
    const response = await toolApi.workflowRunResume(run.id);
    if (response.ok) renderWorkflowRun(response.run); else showNotice(response.error || '恢复失败。', 'error');
  };
}

document.querySelector('#workflowBackBtn').onclick = showCatalogView;
document.querySelector('#workflowSearch').oninput = renderWorkflowRows;
document.querySelector('#workflowAddBtn').onclick = () => createWorkflowFromTool(null);
document.querySelector('#workflowDeleteAllBtn').onclick = async () => {
  const confirmed = await askModal({ title: '删除所有任务流', message: '确定删除所有任务流？', inputValue: null, confirmText: '全部删除' }, document.querySelector('#workflowDeleteAllBtn'));
  if (!confirmed) return;
  const response = await toolApi.workflowDeleteAll();
  if (!response.ok) showNotice(response.error || '删除所有任务失败。', 'error');
  selectedWorkflowId = '';
  document.querySelector('#workflowDetail').hidden = true;
  await loadWorkflows();
};
document.querySelector('#workflowAddStepBtn').onclick = addWorkflowStep;
document.querySelector('#workflowPickInputsBtn').onclick = async () => {
  workflowRunInputs = await toolApi.selectFiles();
  document.querySelector('#workflowPickedInputs').textContent = workflowRunInputs.length ? `已选择 ${workflowRunInputs.length} 项` : '未选择';
};
document.querySelector('#workflowPickOutputBtn').onclick = async () => {
  workflowRunOutput = await toolApi.selectOutput();
  document.querySelector('#workflowPickedOutput').textContent = workflowRunOutput || '未选择';
};
document.querySelector('#workflowRunBtn').onclick = runSelectedWorkflow;
document.querySelector('#workflowCancelRunBtn').onclick = async () => {
  if (!activeWorkflowRunId) return;
  const response = await toolApi.workflowRunCancel(activeWorkflowRunId);
  if (response.ok) renderWorkflowRun(response.run); else showNotice(response.error || '取消失败。', 'error');
};
document.querySelector('#saveAsWorkflowBtn').onclick = async () => {
  if (!selectedTool) return;
  const workflow = await createWorkflowFromTool(selectedTool);
  if (workflow) {
    activeCategory = workflowCategory;
    showView(workflowView);
    renderSidebar();
    showNotice('已保存为任务流。', 'success');
  }
};

toolApi.onWorkflowRunUpdate(run => {
  if (run && run.id === activeWorkflowRunId) renderWorkflowRun(run);
});

document.querySelector('#clearBtn').onclick = () => {
  currentPage = 1;
  renderCards();
  searchInput.focus();
};

searchInput.oninput = () => {
  currentPage = 1;
  renderCards();
};

prevPageBtn.onclick = () => {
  if (currentPage > 1) {
    currentPage -= 1;
    renderCards();
  }
};

nextPageBtn.onclick = () => {
  const totalPages = Math.max(1, Math.ceil(getFilteredTools().length / pageSize));
  if (currentPage < totalPages) {
    currentPage += 1;
    renderCards();
  }
};

document.querySelector('#helpBtn').onclick = () => {
  showNotice('批处理工具和智能画布均在本机运行；画布内容自动保存在当前用户数据中。');
};

document.querySelector('#settingsBtn').onclick = async () => {
  if (activeCategory !== fileSettingsCategory) lastCatalogCategory = activeCategory;
  activeCategory = fileSettingsCategory;
  renderSidebar();
  await openFileSettingsView();
};

async function openFileSettingsView() {
  const [settings, modelSettings, storageSettings] = await Promise.all([
    toolApi.getFileSettings(),
    toolApi.canvasModelConfigGet(),
    toolApi.storageGet()
  ]);
  workspaceRoot = settings.workspaceRoot || workspaceRoot;
  document.querySelector('#workspacePath').value = workspaceRoot;
  document.querySelector('#workspaceHint').textContent = `每个功能目录：${workspaceRoot}\\<功能>\\input 和 output`;
  document.querySelector('#dataRootPath').value = storageSettings.dataRoot || 'G:\\tool-plus-data';
  document.querySelector('#dataRootHint').textContent = `当前数据目录：${storageSettings.dataRoot || 'G:\\tool-plus-data'}；更改后需重启应用完成迁移。`;
  const imageModel = modelSettings.profiles?.image || modelSettings.image || modelSettings;
  const videoModel = modelSettings.profiles?.video || modelSettings.video || {};
  document.querySelector('#canvasModelBaseUrl').value = imageModel.baseURL || 'https://api.tmlab.store';
  document.querySelector('#canvasImageModel').value = imageModel.model || 'nano-banana-pro(特价版 1)';
  document.querySelector('#canvasModelApiKey').value = '';
  document.querySelector('#canvasModelHint').textContent = imageModel.configured
    ? '图片 API Key 已由 Windows 安全存储加密；留空保存不会覆盖。'
    : '尚未配置图片 API Key；密钥不会写入项目、画布或安装包。';
  document.querySelector('#canvasVideoModelBaseUrl').value = videoModel.baseURL || 'https://api.tmlab.store';
  document.querySelector('#canvasVideoModel').value = videoModel.model || 'seedance-2.0-pro(431)';
  document.querySelector('#canvasVideoModelApiKey').value = '';
  document.querySelector('#canvasVideoModelHint').textContent = videoModel.configured
    ? '视频 API Key 已由 Windows 安全存储加密；留空保存不会覆盖。'
    : '尚未配置视频 API Key；图片密钥不会覆盖此配置。';
  showView(fileSettingsView);
}

document.querySelector('#settingsBackBtn').onclick = showCatalogView;
document.querySelector('#settingsCancelBtn').onclick = showCatalogView;

document.querySelector('#pickWorkspace').onclick = async () => {
  const selected = await toolApi.selectWorkspace();
  if (selected) document.querySelector('#workspacePath').value = selected;
};

document.querySelector('#pickDataRoot').onclick = async () => {
  const selected = await toolApi.storageSelect();
  if (selected) document.querySelector('#dataRootPath').value = selected;
};

document.querySelector('#saveSettingsBtn').onclick = async () => {
  const nextRoot = document.querySelector('#workspacePath').value.trim();
  const nextDataRoot = document.querySelector('#dataRootPath').value.trim();
  const [result, modelResult, storageResult] = await Promise.all([
    toolApi.saveFileSettings(nextRoot),
    toolApi.canvasModelConfigSave({ profiles: {
      image: {
        baseURL: document.querySelector('#canvasModelBaseUrl').value.trim(),
        model: document.querySelector('#canvasImageModel').value.trim(),
        apiKey: document.querySelector('#canvasModelApiKey').value.trim()
      },
      video: {
        baseURL: document.querySelector('#canvasVideoModelBaseUrl').value.trim(),
        model: document.querySelector('#canvasVideoModel').value.trim(),
        apiKey: document.querySelector('#canvasVideoModelApiKey').value.trim()
      }
    } }),
    toolApi.storageSave(nextDataRoot)
  ]);
  if (!result.ok || !modelResult.ok || !storageResult.ok) {
    showNotice(result.error || modelResult.error || storageResult.error, 'error');
    return;
  }
  workspaceRoot = result.workspaceRoot;
  selectedOutputs.clear();
  selectedOutput = '';
  appendLog(`文件工作区已设置为：${workspaceRoot}`);
  document.querySelector('#canvasModelApiKey').value = '';
  document.querySelector('#canvasVideoModelApiKey').value = '';
  const savedImage = modelResult.profiles?.image || modelResult.image || modelResult;
  const savedVideo = modelResult.profiles?.video || modelResult.video || {};
  document.querySelector('#canvasModelHint').textContent = savedImage.configured
    ? '图片 API Key 已由 Windows 安全存储加密；留空保存不会覆盖。'
    : '尚未配置图片 API Key；密钥不会写入项目、画布或安装包。';
  document.querySelector('#canvasVideoModelHint').textContent = savedVideo.configured
    ? '视频 API Key 已由 Windows 安全存储加密；留空保存不会覆盖。'
    : '尚未配置视频 API Key；图片密钥不会覆盖此配置。';
  document.querySelector('#dataRootHint').textContent = storageResult.restartRequired
    ? `新目录：${storageResult.dataRoot}；请重启应用，数据会在启动前自动迁移。`
    : `当前数据目录：${storageResult.dataRoot}`;
  showNotice(storageResult.restartRequired
    ? '设置已保存；请重启应用以迁移并切换数据目录。'
    : '文件工作区、应用数据目录与画布模型设置已保存。', 'success');
};

function openCanvas() {
  const visibleView = [catalogView, toolView, fileSettingsView, workflowView]
    .find(view => view && !view.hidden);
  canvasReturnView = visibleView || catalogView;
  canvasReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  status.textContent = '智能画布已打开（主窗口本地模式）';
  canvasImmersive = true;
  showView(canvasView);
  renderSidebar();
  if (canvasFrame.dataset.loaded !== 'true') {
    canvasFrame.dataset.loaded = 'true';
    canvasFrame.src = canvasFrame.dataset.src;
  }
  appendLog('FlowCanvas SDK 智能画布已在当前主窗口中打开；画布数据仅保存在本机。');
  requestAnimationFrame(() => canvasBackBtn.focus());
}

function returnFromCanvas() {
  const target = canvasReturnView && canvasReturnView.isConnected ? canvasReturnView : catalogView;
  setCanvasImmersive(false);
  showView(target);
  renderSidebar();
  if (target === catalogView) renderCards();
  status.textContent = '已从智能画布返回';
  appendLog('已从智能画布返回进入前页面。');
  requestAnimationFrame(() => {
    const fallback = target === catalogView ? document.querySelector('#canvasOpenBtn') : null;
    const focusTarget = canvasReturnFocus && canvasReturnFocus.isConnected ? canvasReturnFocus : fallback;
    if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
  });
}

canvasBackBtn.onclick = returnFromCanvas;
canvasImmersiveBtn.onclick = () => setCanvasImmersive(!canvasImmersive || canvasView.hidden);
canvasFrame.addEventListener('load', () => {
  if (canvasFrame.dataset.loaded !== 'true') return;
  status.textContent = '智能画布已就绪（主窗口本地模式）';
});

window.addEventListener('message', async event => {
  if (!canvasFrame.contentWindow || event.source !== canvasFrame.contentWindow) return;
  const message = event.data;
  if (message && message.type === 'toolplus:canvas-cancel' && message.requestId) {
    await toolApi.canvasGenerationCancel(message.requestId);
    return;
  }
  if (!message || message.type !== 'toolplus:canvas-request' || !message.requestId) return;
  let result;
  try {
    const payload = { ...(message.payload || {}), _requestId: message.requestId };
    if (message.action === 'image.generate') result = await toolApi.canvasImageGenerate(payload);
    else if (message.action === 'video.generate') result = await toolApi.canvasVideoGenerate(payload);
    else if (message.action === 'model.config.get') result = await toolApi.canvasModelConfigGet();
    else result = { ok: false, error: `不支持的画布请求：${message.action}` };
  } catch (error) {
    result = { ok: false, error: error.message || String(error) };
  }
  canvasFrame.contentWindow.postMessage({
    type: 'toolplus:canvas-response',
    requestId: message.requestId,
    result
  }, '*');
});

toolApi.onCanvasGenerationProgress?.(progress => {
  if (!canvasFrame.contentWindow || !progress || !progress.requestId) return;
  canvasFrame.contentWindow.postMessage({ type: 'toolplus:canvas-progress', ...progress }, '*');
});

document.querySelector('#updateBtn').onclick = () => {
  showNotice('当前版本通过新版安装包覆盖升级。');
};

(async function init() {
  const settings = await toolApi.getFileSettings();
  workspaceRoot = settings.workspaceRoot || workspaceRoot;
  const response = await toolApi.catalog();
  tools = normalizeTools(response.tools);
  const stableCount = tools.filter(tool => tool.maturity === 'stable').length;
  const experimentalCount = tools.filter(tool => tool.maturity === 'experimental').length;
  capabilityStatus.textContent = stableCount === tools.length
    ? `稳定 ${stableCount} 项`
    : `实验 ${experimentalCount} 项 · 稳定 ${stableCount} 项`;
  renderSidebar();
  renderJump();
  renderCards();
  appendLog('客户端已加载，功能目录同步完成。');
})();
