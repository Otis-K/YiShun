const { contextBridge } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const tools = JSON.parse(fs.readFileSync(path.join(root, 'backend', 'tool_catalog.json'), 'utf8'));
const sampleInput = path.join(root, 'work', 'verify', 'sample.pdf');
let workflowIdCounter = 1;
let stepIdCounter = 1;
const workflowStore = [];
function now() { return new Date().toISOString(); }

contextBridge.exposeInMainWorld('toolplus', {
  catalog: async () => ({ ok: true, tools }),
  getFileSettings: async () => ({ workspaceRoot: path.join(root, 'work', 'verify') }),
  selectFiles: async () => [sampleInput],
  selectFolders: async () => [path.join(root, 'work', 'verify')],
  selectOutput: async () => path.join(root, 'work', 'verify-output'),
  selectWorkspace: async () => '',
  saveFileSettings: async workspaceRoot => ({ ok: true, workspaceRoot }),
  revealResult: async () => ({ ok: true }),
  startTask: async () => ({ ok: true, task: { id: 'verify-task', state: 'succeeded', phase: '完成', outputs: [path.join(root, 'work', 'verify-output', 'sample.pdf')], elapsedMs: 120, timeoutSeconds: 300, itemResults: [] } }),
  cancelTask: async () => ({ ok: true }),
  getTask: async () => ({ ok: true, task: null }),
  onTaskUpdate: () => () => {},
  inspectInputs: async paths => ({
    ok: true,
    total: paths.length,
    items: paths.map(value => ({
      path: value,
      name: path.basename(value),
      extension: path.extname(value),
      size: 24576,
      pdf: path.extname(value).toLowerCase() === '.pdf' ? { pages: 3 } : undefined,
      directory: fs.existsSync(value) && fs.statSync(value).isDirectory()
    }))
  }),
  workflowList: async () => ({ ok: true, data: workflowStore.map(item => ({ ...item, steps: undefined })) }),
  workflowGet: async id => ({ ok: true, data: workflowStore.find(item => item.id === id) }),
  workflowCreate: async workflow => {
    const item = { ...workflow, id: `wf-${workflowIdCounter++}`, version: 1, createdAt: now(), updatedAt: now(), lastRunStatus: '', steps: [] };
    workflowStore.push(item);
    return { ok: true, data: item };
  },
  workflowUpdate: async workflow => {
    const index = workflowStore.findIndex(item => item.id === workflow.id);
    if (index >= 0) workflowStore[index] = { ...workflowStore[index], ...workflow, updatedAt: now() };
    return { ok: true, data: workflowStore[index] || workflow };
  },
  workflowDelete: async id => {
    const index = workflowStore.findIndex(item => item.id === id);
    if (index >= 0) workflowStore.splice(index, 1);
    return { ok: true };
  },
  workflowDeleteAll: async () => {
    workflowStore.splice(0, workflowStore.length);
    return { ok: true };
  },
  workflowStepList: async id => ({ ok: true, data: (workflowStore.find(item => item.id === id) || { steps: [] }).steps }),
  workflowStepCreate: async step => {
    const workflow = workflowStore.find(item => item.id === step.workflowId);
    if (!workflow) return { ok: false, error: 'workflow missing' };
    const created = { ...step, id: `step-${stepIdCounter++}`, sortIndex: workflow.steps.length + 1, enabled: step.enabled !== false, createdAt: now(), updatedAt: now() };
    workflow.steps.push(created);
    workflow.updatedAt = now();
    return { ok: true, data: created };
  },
  workflowStepUpdate: async step => {
    const workflow = workflowStore.find(item => item.id === step.workflowId);
    if (!workflow) return { ok: false, error: 'workflow missing' };
    const index = workflow.steps.findIndex(item => item.id === step.id);
    if (index >= 0) workflow.steps[index] = { ...workflow.steps[index], ...step, updatedAt: now() };
    return { ok: true, data: workflow.steps[index] };
  },
  workflowStepDelete: async stepId => {
    for (const workflow of workflowStore) workflow.steps = workflow.steps.filter(step => step.id !== stepId);
    return { ok: true };
  },
  workflowStepReorder: async payload => {
    const workflow = workflowStore.find(item => item.id === payload.workflowId);
    if (workflow) workflow.steps = payload.orderedIds.map((id, index) => ({ ...workflow.steps.find(step => step.id === id), sortIndex: index + 1 })).filter(Boolean);
    return { ok: true };
  },
  workflowStepToggle: async payload => {
    for (const workflow of workflowStore) {
      const step = workflow.steps.find(item => item.id === payload.stepId);
      if (step) step.enabled = payload.enabled;
    }
    return { ok: true };
  },
  workflowStepDuplicate: async stepId => {
    for (const workflow of workflowStore) {
      const step = workflow.steps.find(item => item.id === stepId);
      if (step) {
        const copy = { ...step, id: `step-${stepIdCounter++}`, name: `${step.name} 副本`, sortIndex: workflow.steps.length + 1 };
        workflow.steps.push(copy);
        return { ok: true, data: copy };
      }
    }
    return { ok: false, error: 'step missing' };
  },
  workflowValidate: async id => ({ ok: true, data: workflowStore.find(item => item.id === id), issues: [] }),
  workflowRunStart: async payload => ({ ok: true, run: { id: 'run-verify', workflowId: payload.workflowId, status: 'completed', summary: { totalSteps: 1, completedSteps: 1, logs: ['verify run completed'], finalOutputs: [path.join(root, 'work', 'verify-output')] } } }),
  workflowRunCancel: async () => ({ ok: true, run: { id: 'run-verify', status: 'cancelled', summary: { logs: ['cancelled'] } } }),
  workflowRunResume: async () => ({ ok: true, run: { id: 'run-verify', status: 'completed', summary: { logs: ['resumed'] } } }),
  workflowRunRetry: async () => ({ ok: true, run: { id: 'run-verify', status: 'completed', summary: { logs: ['retried'] } } }),
  workflowRunGet: async () => ({ ok: true, data: null }),
  workflowRunList: async () => ({ ok: true, data: [] }),
  workflowRunLogs: async () => ({ ok: true, data: [] }),
  onWorkflowRunUpdate: () => () => {}
});
