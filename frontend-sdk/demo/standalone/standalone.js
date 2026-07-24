(async () => {
  'use strict';

  try {
    const api = globalThis.FlowCanvas;
    if (!api || typeof api.FlowCanvasSDK !== 'function') {
      throw new Error('window.FlowCanvas.FlowCanvasSDK was not exposed by the IIFE bundle.');
    }

    const sdk = new api.FlowCanvasSDK({
      container: '#app',
      theme: 'dark',
      includeBuiltinNodes: true,
    });
    const node = sdk.addNode('prompt', { x: 180, y: 140 }, {
      title: 'Electron 离线验收节点',
      prompt: '验证 file:// 渲染、执行和销毁闭环。',
    });

    globalThis.flowCanvasStandalone = sdk;
    const result = await sdk.runNode(node.id);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    globalThis.flowCanvasAcceptance = {
      mounted: document.querySelector('[data-testid="flowcanvas-sdk"]') !== null,
      nodeCount: sdk.getGraph().nodes.length,
      runStatus: result.status,
      protocol: location.protocol,
    };
    document.documentElement.dataset.flowcanvasReady = 'true';
  } catch (error) {
    const output = document.querySelector('#bootstrap-error');
    if (output) {
      output.hidden = false;
      output.textContent = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    document.documentElement.dataset.flowcanvasReady = 'error';
    throw error;
  }
})();
