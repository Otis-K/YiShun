const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('toolplus', {
  catalog: () => ipcRenderer.invoke('catalog'),
  runTool: payload => ipcRenderer.invoke('run-tool', payload),
  startTask: payload => ipcRenderer.invoke('start-task', payload),
  cancelTask: taskId => ipcRenderer.invoke('cancel-task', taskId),
  getTask: taskId => ipcRenderer.invoke('get-task', taskId),
  workflowList: () => ipcRenderer.invoke('workflow:list'),
  workflowGet: workflowId => ipcRenderer.invoke('workflow:get', workflowId),
  workflowCreate: workflow => ipcRenderer.invoke('workflow:create', workflow),
  workflowUpdate: workflow => ipcRenderer.invoke('workflow:update', workflow),
  workflowDelete: workflowId => ipcRenderer.invoke('workflow:delete', workflowId),
  workflowDeleteAll: () => ipcRenderer.invoke('workflow:delete-all'),
  workflowStepList: workflowId => ipcRenderer.invoke('workflow:step-list', workflowId),
  workflowStepCreate: step => ipcRenderer.invoke('workflow:step-create', step),
  workflowStepUpdate: step => ipcRenderer.invoke('workflow:step-update', step),
  workflowStepDelete: stepId => ipcRenderer.invoke('workflow:step-delete', stepId),
  workflowStepReorder: payload => ipcRenderer.invoke('workflow:step-reorder', payload),
  workflowStepToggle: payload => ipcRenderer.invoke('workflow:step-toggle', payload),
  workflowStepDuplicate: stepId => ipcRenderer.invoke('workflow:step-duplicate', stepId),
  workflowValidate: workflowId => ipcRenderer.invoke('workflow:validate', workflowId),
  workflowExport: workflowId => ipcRenderer.invoke('workflow:export', workflowId),
  workflowImport: value => ipcRenderer.invoke('workflow:import', value),
  workflowRunStart: payload => ipcRenderer.invoke('workflow:run/start', payload),
  workflowRunCancel: runId => ipcRenderer.invoke('workflow:run/cancel', runId),
  workflowRunResume: runId => ipcRenderer.invoke('workflow:run/resume', runId),
  workflowRunRetry: runId => ipcRenderer.invoke('workflow:run/retry', runId),
  workflowRunGet: runId => ipcRenderer.invoke('workflow:run/get', runId),
  workflowRunList: workflowId => ipcRenderer.invoke('workflow:run/list', workflowId),
  workflowRunLogs: runId => ipcRenderer.invoke('workflow:run/logs', runId),
  onWorkflowRunUpdate: callback => {
    const listener = (_event, run) => callback(run);
    ipcRenderer.on('workflow-run-update', listener);
    return () => ipcRenderer.removeListener('workflow-run-update', listener);
  },
  inspectInputs: paths => ipcRenderer.invoke('inspect-inputs', paths),
  onTaskUpdate: callback => {
    const listener = (_event, task) => callback(task);
    ipcRenderer.on('task-update', listener);
    return () => ipcRenderer.removeListener('task-update', listener);
  },
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectFolders: () => ipcRenderer.invoke('select-folders'),
  selectOutput: () => ipcRenderer.invoke('select-output'),
  getFileSettings: () => ipcRenderer.invoke('get-file-settings'),
  selectWorkspace: () => ipcRenderer.invoke('select-workspace'),
  saveFileSettings: workspaceRoot => ipcRenderer.invoke('save-file-settings', workspaceRoot),
  storageGet: () => ipcRenderer.invoke('storage:get'),
  storageSelect: () => ipcRenderer.invoke('storage:select'),
  storageSave: dataRoot => ipcRenderer.invoke('storage:save', dataRoot),
  canvasModelConfigGet: () => ipcRenderer.invoke('canvas:model-config:get'),
  canvasModelConfigSave: payload => ipcRenderer.invoke('canvas:model-config:save', payload),
  modelLibraryList: () => ipcRenderer.invoke('model-library:list'),
  modelLibraryCreate: payload => ipcRenderer.invoke('model-library:create', payload),
  modelLibraryUpdate: (modelId, payload) => ipcRenderer.invoke('model-library:update', modelId, payload),
  modelLibraryDelete: modelId => ipcRenderer.invoke('model-library:delete', modelId),
  modelLibraryRead: modelId => ipcRenderer.invoke('model-library:read', modelId),
  canvasImageGenerate: payload => ipcRenderer.invoke('canvas:image-generate', payload),
  canvasVideoGenerate: payload => ipcRenderer.invoke('canvas:video-generate', payload),
  onCanvasGenerationProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('canvas:generation-progress', listener);
    return () => ipcRenderer.removeListener('canvas:generation-progress', listener);
  },
  canvasGenerationCancel: requestId => ipcRenderer.invoke('canvas:generation-cancel', requestId),
  revealResult: resultPath => ipcRenderer.invoke('reveal-result', resultPath)
});
