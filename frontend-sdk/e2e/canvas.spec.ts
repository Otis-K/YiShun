import { expect, test, type Page } from '@playwright/test';

const sdk = (page: Page) => page.getByTestId('flowcanvas-sdk');
const nodes = (page: Page) => page.locator('.react-flow__node');
const pageErrors = new WeakMap<Page, string[]>();

interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

interface GenerationLayoutSnapshot {
  composer: LayoutRect;
  input: LayoutRect;
  prompt: LayoutRect;
  references: LayoutRect;
  referenceList: LayoutRect;
  parameters: LayoutRect;
  parameterLeft: LayoutRect;
  submitGroup: LayoutRect;
  submitButton: LayoutRect;
  leadingControls: LayoutRect;
  chips: LayoutRect[];
  chipRemovers: LayoutRect[];
  parameterControls: LayoutRect[];
  widths: Record<string, number>;
  rowTops: number[];
  horizontalOverflow: Record<string, number>;
}

const inside = (outer: LayoutRect, inner: LayoutRect, label: string) => {
  const tolerance = 1;
  expect(inner.x, `${label} left`).toBeGreaterThanOrEqual(outer.x - tolerance);
  expect(inner.y, `${label} top`).toBeGreaterThanOrEqual(outer.y - tolerance);
  expect(inner.right, `${label} right`).toBeLessThanOrEqual(outer.right + tolerance);
  expect(inner.bottom, `${label} bottom`).toBeLessThanOrEqual(outer.bottom + tolerance);
};

const separated = (first: LayoutRect, second: LayoutRect, label: string) => {
  const tolerance = 1;
  const overlaps = first.x < second.right - tolerance
    && first.right > second.x + tolerance
    && first.y < second.bottom - tolerance
    && first.bottom > second.y + tolerance;
  expect(overlaps, label).toBe(false);
};

const generationDrafts = (references: Array<Record<string, unknown>>) => ({
  text: { prompt: '', model: 'GMLM 3.1', references: [] },
  image: {
    prompt: '生成一张具有电影灯光、丰富材质和高速动势的商业插画。',
    model: 'nano-banana-pro(特价版 1)',
    references,
    ratio: '16:9',
    quality: '标准画质 · 2K',
    panorama: false,
    count: 1,
  },
  video: {
    prompt: '角色从雨夜站台向镜头走来，保持人物一致并缓慢推进镜头。',
    model: 'seedance-2.0-fast',
    references,
    resolution: '480p',
    duration: 5,
    firstFrame: references[0] ?? '',
    lastFrame: references[1] ?? '',
    modeType: 'mixed2video',
    ratio: '16:9',
    enableSound: 'off',
  },
  audio: { prompt: '', model: 'Mureka V9', references: [], lyricsMode: '自动生成' },
});

async function importGenerationLayout(page: Page, mode: 'image' | 'video') {
  const references = Array.from({ length: 4 }, (_, index) => ({
    id: `layout-reference-${index}`,
    name: `20260718_这是用于验证素材列表不会挤压参数栏与提交按钮的超长参考素材文件名_${index + 1}.png`,
    kind: index === 2 && mode === 'video' ? 'video' : index === 3 && mode === 'video' ? 'audio' : 'image',
    mimeType: index === 2 && mode === 'video' ? 'video/mp4' : index === 3 && mode === 'video' ? 'audio/mpeg' : 'image/png',
    url: index < 2 || mode === 'image' ? '/assets/scene-character.jpg' : undefined,
  }));
  const drafts = generationDrafts(references);
  await page.evaluate(({ activeMode, generationDraftValues }) => {
    const instance = (window as typeof window & { flowCanvas: { import: (graph: string) => void } }).flowCanvas;
    const active = generationDraftValues[activeMode];
    instance.import(JSON.stringify({
      schemaVersion: 1,
      id: `generation-layout-${activeMode}`,
      name: `${activeMode} generation layout acceptance`,
      viewport: { x: 360, y: 60, zoom: 1 },
      metadata: { acceptance: 'generation-layout' },
      nodes: [{
        id: `layout-${activeMode}`,
        type: activeMode,
        position: { x: 0, y: 0 },
        width: 560,
        height: 620,
        data: {
          title: activeMode === 'image' ? '图片生成布局验收' : '视频生成布局验收',
          description: '生成节点真实浏览器几何验收',
          status: 'idle',
          generationMode: activeMode,
          generationDrafts: generationDraftValues,
          prompt: active.prompt,
          model: active.model,
        },
      }],
      edges: [],
    }));
  }, { activeMode: mode, generationDraftValues: drafts });
  await expect(nodes(page)).toHaveCount(1);
  await expect(page.locator(`.react-flow__node[data-id="layout-${mode}"] .fc-generation-composer`)).toBeVisible();
}

async function generationLayout(page: Page, mode: 'image' | 'video'): Promise<GenerationLayoutSnapshot> {
  return page.locator(`.react-flow__node[data-id="layout-${mode}"]`).evaluate((root, activeMode) => {
    const required = (selector: string): HTMLElement => {
      const element = root.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing generation layout element: ${selector}`);
      return element;
    };
    const rect = (element: Element): LayoutRect => {
      const value = element.getBoundingClientRect();
      return {
        x: value.x,
        y: value.y,
        width: value.width,
        height: value.height,
        right: value.right,
        bottom: value.bottom,
      };
    };
    const horizontalOverflow = (selector: string) => {
      const element = required(selector);
      return Math.max(0, element.scrollWidth - element.clientWidth);
    };
    const parameterWidth = (label: string) => {
      const control = root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
      if (!control) throw new Error(`Missing generation parameter: ${label}`);
      return rect(control.closest<HTMLElement>('.fc-generation-select, .fc-model-select') ?? control).width;
    };
    const parameterLabels = activeMode === 'image'
      ? ['图片生成模型', '图片比例', '图片画质', '图片数量']
      : ['视频生成模型', '视频比例', '视频分辨率', '视频时长', '生成声音'];
    const parameters = required('.fc-generation-parameters');
    const parameterControls = Array.from(required('.fc-generation-parameters__left').children).map(rect);
    return {
      composer: rect(required('.fc-generation-composer')),
      input: rect(required('.fc-generation-input')),
      prompt: rect(required('.fc-generation-input > textarea')),
      references: rect(required('.fc-generation-reference-chips')),
      referenceList: rect(required('.fc-generation-reference-chips__list')),
      parameters: rect(parameters),
      parameterLeft: rect(required('.fc-generation-parameters__left')),
      submitGroup: rect(required('.fc-generation-submit-group')),
      submitButton: rect(required('.fc-generation-submit')),
      leadingControls: rect(required(activeMode === 'image' ? '.fc-generation-attachments' : '.fc-generation-frames')),
      chips: Array.from(root.querySelectorAll('.fc-generation-reference-chip')).map(rect),
      chipRemovers: Array.from(root.querySelectorAll('.fc-generation-reference-chip button')).map(rect),
      parameterControls,
      widths: Object.fromEntries(parameterLabels.map(label => [label, parameterWidth(label)])),
      rowTops: [...new Set(parameterControls.map(value => Math.round(value.y)))].sort((a, b) => a - b),
      horizontalOverflow: {
        composer: horizontalOverflow('.fc-generation-composer'),
        input: horizontalOverflow('.fc-generation-input'),
        references: horizontalOverflow('.fc-generation-reference-chips'),
        referenceList: horizontalOverflow('.fc-generation-reference-chips__list'),
        parameters: horizontalOverflow('.fc-generation-parameters'),
        parameterLeft: horizontalOverflow('.fc-generation-parameters__left'),
      },
    };
  }, mode);
}

function expectSharedGenerationGeometry(layout: GenerationLayoutSnapshot) {
  inside(layout.composer, layout.input, 'input in composer');
  inside(layout.input, layout.leadingControls, 'leading controls in input');
  inside(layout.input, layout.prompt, 'prompt in input');
  inside(layout.input, layout.references, 'reference tray in input');
  inside(layout.references, layout.referenceList, 'reference list in tray');
  inside(layout.input, layout.parameters, 'parameters in input');
  inside(layout.parameters, layout.parameterLeft, 'parameter controls in footer');
  inside(layout.parameters, layout.submitGroup, 'submit group in footer');
  inside(layout.submitGroup, layout.submitButton, 'submit button in submit group');
  expect(layout.submitButton.right, 'submit button keeps right safe area').toBeLessThanOrEqual(layout.input.right - 12);
  expect(layout.submitButton.bottom, 'submit button keeps bottom safe area').toBeLessThanOrEqual(layout.input.bottom - 12);
  expect(layout.leadingControls.bottom, 'leading controls before prompt').toBeLessThanOrEqual(layout.prompt.y + 1);
  expect(layout.references.bottom, 'reference previews before prompt').toBeLessThanOrEqual(layout.prompt.y + 1);
  expect(layout.prompt.bottom, 'prompt before parameters').toBeLessThanOrEqual(layout.parameters.y + 1);
  expect(layout.chips).toHaveLength(3);
  expect(layout.chipRemovers).toHaveLength(3);
  layout.chips.forEach((chip, index) => {
    inside(layout.referenceList, chip, `reference chip ${index + 1}`);
    inside(chip, layout.chipRemovers[index]!, `reference chip ${index + 1} remove button`);
    if (index > 0) separated(layout.chips[index - 1]!, chip, `reference chips ${index} and ${index + 1} overlap`);
  });
  layout.parameterControls.forEach((control, index) => {
    inside(layout.parameterLeft, control, `parameter control ${index + 1}`);
    separated(control, layout.submitGroup, `parameter control ${index + 1} overlaps submit group`);
  });
  for (const [name, overflow] of Object.entries(layout.horizontalOverflow)) {
    expect(overflow, `${name} horizontal overflow`).toBeLessThanOrEqual(1);
  }
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(sdk(page)).toBeVisible();
  await expect(nodes(page)).toHaveCount(5);
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page) ?? []).toEqual([]);
});

test('renders the workflow, switches theme, edits a node, and supports undo/redo', async ({ page }) => {
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
  await expect(sdk(page)).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '切换主题' }).click();
  await expect(sdk(page)).toHaveAttribute('data-theme', 'light');

  await nodes(page).filter({ hasText: '01 · 场景脚本' }).click();
  await page.getByTitle('属性面板').click();
  const title = page.getByLabel('节点名称');
  await expect(title).toHaveValue('01 · 场景脚本');
  await title.fill('01 · 雨夜开场');
  await expect(nodes(page).filter({ hasText: '01 · 雨夜开场' })).toHaveCount(1);

  await page.getByTitle('撤销').click();
  await expect(nodes(page).filter({ hasText: '01 · 场景脚本' })).toHaveCount(1);
  await page.getByTitle('重做').click();
  await expect(nodes(page).filter({ hasText: '01 · 雨夜开场' })).toHaveCount(1);

});

test('adds a node from the library and rejects an invalid typed connection', async ({ page }) => {
  await page.getByTitle('添加图片节点').click();
  await expect(nodes(page)).toHaveCount(6);
  await expect(page.locator('.fc-statusbar')).toContainText('6 节点');

  const errorName = await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { addEdge: (edge: object) => unknown } }).flowCanvas;
    try {
      instance.addEdge({ source: 'voice', sourcePort: 'audio', target: 'character', targetPort: 'prompt' });
      return '';
    } catch (error) {
      return error instanceof Error ? error.name : String(error);
    }
  });
  expect(errorName).toBe('GraphValidationError');
  await expect(page.locator('.react-flow__edge')).toHaveCount(6);
});

test('creates a real port connection, drags nodes, and copies a multi-selection', async ({ page }) => {
  await page.getByTitle('添加图片节点').click();
  const addedNode = nodes(page).last();
  const promptHandle = addedNode.locator('.fc-port--input[title="智能素材输入"]');
  const source = await page.locator('.react-flow__node[data-id="script"] .fc-port--output[title="智能素材输出"]').boundingBox();
  const target = await promptHandle.boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.locator('.react-flow__edge')).toHaveCount(7);

  const script = page.locator('.react-flow__node[data-id="script"]');
  const beforePosition = await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { getGraph: () => { nodes: Array<{ id: string; position: { x: number; y: number } }> } } }).flowCanvas;
    return instance.getGraph().nodes.find(node => node.id === 'script')!.position;
  });
  const header = await script.locator('.fc-node__header').boundingBox();
  expect(header).not.toBeNull();
  await page.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
  await page.mouse.down();
  await page.mouse.move(header!.x + header!.width / 2 + 140, header!.y + header!.height / 2 + 90, { steps: 16 });
  await page.mouse.up();
  await expect.poll(async () => page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { getGraph: () => { nodes: Array<{ id: string; position: { x: number; y: number } }> } } }).flowCanvas;
    return instance.getGraph().nodes.find(node => node.id === 'script')!.position.x;
  })).not.toBe(beforePosition.x);

  await script.click();
  await page.locator('.react-flow__node[data-id="character"]').click({ modifiers: ['Shift'] });
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expect(nodes(page)).toHaveCount(8);
});

test('routes an image dropped on the prompt handle to the image reference input', async ({ page }) => {
  await page.getByTitle('添加图片节点').click();
  const addedNode = nodes(page).last();
  const promptHandle = await addedNode.locator('.fc-port--input[title="提示词 · text"]').boundingBox();
  const imageHandle = await page.locator('.react-flow__node[data-id="character"] .fc-port--output[title="图像 · image"]').boundingBox();
  expect(promptHandle).not.toBeNull();
  expect(imageHandle).not.toBeNull();
  await page.mouse.move(imageHandle!.x + imageHandle!.width / 2, imageHandle!.y + imageHandle!.height / 2);
  await page.mouse.down();
  await page.mouse.move(promptHandle!.x + promptHandle!.width / 2, promptHandle!.y + promptHandle!.height / 2, { steps: 12 });
  await page.mouse.up();
  const latestEdge = await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { getGraph: () => { edges: Array<{ source: string; sourcePort: string; targetPort: string }> } } }).flowCanvas;
    return instance.getGraph().edges.at(-1);
  });
  expect(latestEdge).toMatchObject({ source: 'character', sourcePort: 'image', targetPort: 'reference' });
});

test('exports, imports, and executes a complete graph', async ({ page }) => {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTitle('导出 JSON').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('.flowcanvas.json');

  const exported = await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { export: () => string } }).flowCanvas;
    return instance.export();
  });
  const document = JSON.parse(exported) as { nodes: unknown[]; edges: unknown[] };
  expect(document.nodes).toHaveLength(5);
  expect(document.edges).toHaveLength(6);

  await page.getByTitle('导入 JSON').click();
  await page.locator('.fc-canvas-actions input[accept*="json"]').setInputFiles({
    name: 'workflow.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exported),
  });
  await expect(page.getByText('工作流已导入')).toBeVisible();

  await page.getByRole('button', { name: '运行全部' }).click();
  await expect(page.getByRole('button', { name: '停止' })).toBeVisible();
  await expect(page.getByText('工作流运行完成')).toBeVisible({ timeout: 10_000 });
  await expect(nodes(page).filter({ hasText: '已完成' })).toHaveCount(5);
});

test('cancels a running workflow and reflects host-triggered lifecycle', async ({ page }) => {
  await page.getByRole('button', { name: '运行全部' }).click();
  const stop = page.getByRole('button', { name: '停止' });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(page.getByText('运行已取消')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: '运行全部' })).toBeVisible();

  await page.evaluate(async () => {
    const instance = (window as typeof window & { flowCanvas: { run: () => Promise<unknown> } }).flowCanvas;
    await instance.run();
  });
  await expect(page.getByRole('button', { name: '运行全部' })).toBeVisible();
});

test('applies imported viewport state and supports multiple isolated mounts', async ({ page }) => {
  await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { export: () => string; import: (value: string) => void } }).flowCanvas;
    const graph = JSON.parse(instance.export());
    graph.viewport = { x: 123, y: 87, zoom: 0.7 };
    instance.import(JSON.stringify(graph));
  });
  await expect.poll(async () => page.locator('.react-flow__viewport').first().getAttribute('style')).toContain('scale(0.7)');

  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'second-flowcanvas';
    Object.assign(host.style, { position: 'fixed', width: '480px', height: '320px', right: '0', bottom: '0', zIndex: '9999' });
    document.body.append(host);
    const first = (window as typeof window & { flowCanvas: { constructor: new (options: object) => { addNode: (...args: unknown[]) => void; destroy: () => void } } }).flowCanvas;
    const second = new first.constructor({ container: host, includeBuiltinNodes: true, theme: 'light' });
    second.addNode('prompt', { x: 10, y: 10 });
    Object.assign(window, { secondFlowCanvas: second });
  });
  await expect(sdk(page)).toHaveCount(2);
  await expect(page.locator('#second-flowcanvas').getByTestId('flowcanvas-sdk')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => (window as typeof window & { secondFlowCanvas: { destroy: () => void } }).secondFlowCanvas.destroy());
  await expect(sdk(page)).toHaveCount(1);
});

test('keeps 5k-node transient editing within a simple browser stress budget', async ({ page }) => {
  test.setTimeout(60_000);
  const result = await page.evaluate(async () => {
    const sdkInstance = (window as typeof window & {
      flowCanvas: {
        export: () => string;
        import: (value: string) => void;
        engine: {
          captureSnapshot: () => object;
          updateNodeData: (id: string, data: object, options: object) => void;
          commitSnapshot: (label: string, before: object) => void;
        };
      };
    }).flowCanvas;
    const graph = JSON.parse(sdkInstance.export());
    graph.edges = [];
    graph.nodes = Array.from({ length: 5_000 }, (_, index) => ({
      id: `stress-${index}`,
      type: 'prompt',
      position: { x: (index % 100) * 300, y: Math.floor(index / 100) * 220 },
      data: { title: `Stress ${index}`, prompt: `Prompt ${index}` },
    }));
    const importStarted = performance.now();
    sdkInstance.import(JSON.stringify(graph));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const importMs = performance.now() - importStarted;
    const before = sdkInstance.engine.captureSnapshot();
    const editingStarted = performance.now();
    for (let index = 0; index < 20; index += 1) {
      sdkInstance.engine.updateNodeData('stress-0', { title: `Typing ${index}` }, { record: false, transient: true });
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    }
    sdkInstance.engine.commitSnapshot('stress typing', before);
    return { importMs, editMs: performance.now() - editingStarted };
  });
  expect(result.importMs).toBeLessThan(15_000);
  expect(result.editMs).toBeLessThan(10_000);
  await expect(page.locator('.fc-statusbar')).toContainText('5000 节点');
});

test('keeps the canvas usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByTitle('属性面板').click();
  await expect(sdk(page)).toBeVisible();
  await expect(page.locator('.fc-canvas')).toBeVisible();
  await expect(page.locator('.fc-inspector')).toBeVisible();
  await expect(page.locator('.fc-run-button')).toBeVisible();

  const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
  expect(bodyWidth).toBeLessThanOrEqual(390);
});

test('switches between real select and pan modes', async ({ page }) => {
  const root = sdk(page);
  const rail = page.locator('.fc-canvas-tools');
  await expect(root).toHaveAttribute('data-interaction-mode', 'select');
  await rail.getByTitle('平移').click();
  await expect(root).toHaveAttribute('data-interaction-mode', 'pan');
  await expect(rail.getByTitle('平移')).toHaveAttribute('aria-pressed', 'true');

  await rail.getByTitle('选择').click();
  await expect(root).toHaveAttribute('data-interaction-mode', 'select');
  await nodes(page).filter({ hasText: '01 · 场景脚本' }).click();
  await page.getByTitle('属性面板').click();
  await expect(page.getByLabel('节点名称')).toHaveValue('01 · 场景脚本');
});

test('supports right-click disconnect and node pause-retry actions', async ({ page }) => {
  const before = await page.evaluate(() => JSON.parse((window as typeof window & { flowCanvas: { export: () => string } }).flowCanvas.export()).edges.length);
  const edge = page.locator('.react-flow__edge').first();
  await edge.dispatchEvent('contextmenu', { clientX: 420, clientY: 250, button: 2, buttons: 2 });
  await expect(page.getByRole('menu', { name: '连线操作' })).toBeVisible();
  await page.getByRole('menuitem', { name: '取消连线' }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse((window as typeof window & { flowCanvas: { export: () => string } }).flowCanvas.export()).edges.length)).toBe(before - 1);

  const node = nodes(page).first();
  await node.click({ button: 'right', force: true });
  const menu = page.getByRole('menu', { name: '节点操作' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: '暂停' })).toBeDisabled();
  await expect(menu.getByRole('menuitem', { name: '重试' })).toBeEnabled();
  await expect(menu.getByRole('menuitem', { name: '删除节点' })).toBeEnabled();
  await page.locator('.fc-canvas-actions').click();
  await expect(menu).toHaveCount(0);
});

test('restores all canvas media, keeps connected media out of frame slots, and unlinks selected frames', async ({ page }) => {
  const drafts = generationDrafts([]);
  drafts.image.prompt = '内部上游提示词';
  drafts.video.prompt = '使用首帧生成视频';
  await page.evaluate(generationDraftValues => {
    const instance = (window as typeof window & { flowCanvas: { import: (graph: string) => void } }).flowCanvas;
    instance.import(JSON.stringify({
      schemaVersion: 1,
      id: 'persisted-material-acceptance',
      name: 'persisted material acceptance',
      viewport: { x: 150, y: 90, zoom: 1 },
      metadata: {},
      nodes: [{
        id: 'idle-image', type: 'image', position: { x: 20, y: 20 },
        data: {
          title: '重启后图片', generationMode: 'image', generationDrafts: generationDraftValues,
          status: 'idle', preview: '/assets/scene-character.jpg', previewKind: 'image', mimeType: 'image/jpeg',
        },
      }, {
        id: 'video-target', type: 'video', position: { x: 720, y: 20 },
        data: { title: '视频生成', generationMode: 'video', generationDrafts: generationDraftValues, status: 'idle' },
      }],
      edges: [{ id: 'frame-edge', source: 'idle-image', sourcePort: 'image', target: 'video-target', targetPort: 'image' }],
    }));
  }, drafts);

  const video = page.locator('.react-flow__node[data-id="video-target"]');
  await expect(video.getByTitle('从画布素材中选择首帧')).toBeVisible();
  await expect(video.getByLabel('已选参考素材')).toBeVisible();
  await expect(video).not.toContainText('上游语义');
  await expect(page.getByLabel('当前缩放 100%')).toBeVisible();

  await video.getByTitle('从画布素材中选择首帧').click();
  await page.getByRole('button', { name: '使用素材 重启后图片' }).click();
  await expect(video.getByTitle('在画布中央预览首帧').locator('img')).toHaveCount(0);
  await expect(video.getByRole('button', { name: '移除首帧素材' })).toBeVisible();
  await video.getByTitle('在画布中央预览首帧').click();
  await expect(page.getByRole('dialog', { name: '素材预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭素材预览' }).click();

  await video.getByRole('button', { name: '移除首帧素材' }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await expect(nodes(page)).toHaveCount(2);

  await video.getByTitle('从画布素材中选择首帧').click();
  await expect(page.getByRole('listbox', { name: '选择画布素材' })).toContainText('重启后图片');
});

test('catches malformed JSON without replacing the current graph', async ({ page }) => {
  await page.getByTitle('导入 JSON').click();
  await page.locator('.fc-canvas-actions input[accept*="json"]').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ definitely-not-json'),
  });
  await expect(page.getByText(/导入失败/)).toBeVisible();
  await expect(nodes(page)).toHaveCount(5);
});

test('renders unknown nodes safely and enforces read-only UI entries', async ({ page }) => {
  const unknownGraph = await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { export: () => string } }).flowCanvas;
    const graph = JSON.parse(instance.export()) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };
    graph.nodes = [{
      id: 'unknown-node',
      type: 'external.missing',
      position: { x: 80, y: 80 },
      data: { title: '原始数据已保留', prompt: '不丢失' },
    }];
    graph.edges = [];
    return JSON.stringify(graph);
  });
  await page.evaluate(input => {
    const instance = (window as typeof window & { flowCanvas: { import: (graph: string) => void; setReadOnly: (value: boolean) => void } }).flowCanvas;
    instance.import(input);
    instance.setReadOnly(true);
  }, unknownGraph);

  await expect(nodes(page)).toHaveCount(1);
  await expect(nodes(page).first()).toContainText('原始数据已保留');
  await expect(nodes(page).first()).toContainText('未注册');
  await expect(sdk(page)).toHaveAttribute('data-read-only', 'true');
  await expect(page.getByTitle('添加文本节点')).toBeDisabled();
  await expect(page.getByTitle('添加图片节点')).toBeDisabled();
  await expect(page.getByTitle('添加视频节点')).toBeDisabled();
  await expect(page.getByTitle('添加音频节点')).toBeDisabled();
  await expect(page.getByTitle('导入 JSON')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '运行全部' })).toHaveCount(1);
  await expect(page.getByTitle('撤销')).toBeDisabled();
  await nodes(page).first().click();
  await page.getByTitle('属性面板').click();
  await expect(page.getByLabel('节点名称')).toHaveAttribute('readonly', '');
});

test('keeps long image references and standardized controls inside the composer in both themes', async ({ page }) => {
  await importGenerationLayout(page, 'image');

  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') {
      await page.getByRole('button', { name: '切换主题' }).click();
      await expect(sdk(page)).toHaveAttribute('data-theme', 'light');
    }
    const before = await generationLayout(page, 'image');
    expectSharedGenerationGeometry(before);
    expect(before.rowTops, `${theme} image controls use one stable row`).toHaveLength(1);
    expect(before.widths).toEqual({
      图片生成模型: 144,
      图片比例: 62,
      图片画质: 116,
      图片数量: 62,
    });
    await page.locator('.react-flow__node[data-id="layout-image"]').screenshot({
      path: `artifacts/screenshots/generation-layout-image-${theme}.png`,
    });

    await page.getByRole('button', { name: '图片比例' }).click();
    await page.getByRole('option', { name: /21:9/ }).click();
    await page.getByRole('button', { name: '图片画质' }).click();
    await page.getByRole('option', { name: /高清画质 · 4K/ }).click();
    const after = await generationLayout(page, 'image');
    expectSharedGenerationGeometry(after);
    expect(after.widths, `${theme} image control widths stay stable after selecting longer values`).toEqual(before.widths);
  }
});

test('opens material and overflow libraries outside the node clipping boundary and expands model details', async ({ page }) => {
  await importGenerationLayout(page, 'image');

  const pickerButton = page.getByTitle('从画布已生成素材中选择');
  await pickerButton.click();
  const picker = page.getByRole('listbox', { name: '选择画布素材' });
  await expect(picker).toBeVisible();
  const pickerGeometry = await picker.evaluate(element => {
    const node = document.querySelector('.react-flow__node[data-id="layout-image"]');
    const root = element.closest('.fc-sdk');
    const rect = element.getBoundingClientRect();
    return {
      isInsideNode: Boolean(node?.contains(element)),
      isInsideSdk: Boolean(root?.contains(element)),
      width: Math.round(rect.width),
    };
  });
  expect(pickerGeometry).toEqual({ isInsideNode: false, isInsideSdk: true, width: 460 });

  await pickerButton.click();
  await page.getByRole('button', { name: '图片生成模型' }).click();
  const modelMenu = page.getByRole('listbox', { name: '图片生成模型选项' });
  await expect(modelMenu).toBeVisible();
  await expect(modelMenu).toContainText('Nano Banana Pro');
  await expect(modelMenu).toContainText('支持 14 个参考');
  expect(Math.round((await modelMenu.boundingBox())!.width)).toBe(360);
  await page.getByRole('button', { name: '图片生成模型' }).click();

  await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { getGraph: () => Record<string, unknown>; engine: { updateNodeData: (id: string, patch: Record<string, unknown>) => void } } }).flowCanvas;
    const graph = instance.getGraph() as { nodes: Array<{ id: string; data: Record<string, unknown> }> };
    const target = graph.nodes.find(node => node.id === 'layout-image');
    if (!target) throw new Error('layout image node missing');
    const drafts = structuredClone(target.data.generationDrafts) as ReturnType<typeof generationDrafts>;
    drafts.image.references = Array.from({ length: 14 }, (_, index) => ({
      id: `overflow-${index}`,
      name: `参考素材_${index + 1}.png`,
      kind: 'image',
      mimeType: 'image/png',
      url: '/assets/scene-character.jpg',
    }));
    instance.engine.updateNodeData('layout-image', { generationDrafts: drafts });
  });
  const more = page.getByRole('button', { name: '查看全部 14 个参考素材' });
  await expect(more).toBeVisible();
  await more.click();
  const library = page.getByRole('dialog', { name: '全部参考素材' });
  await expect(library).toBeVisible();
  await expect(library.locator('article')).toHaveCount(14);
  expect(await library.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  expect(await library.evaluate(element => document.querySelector('.react-flow__node[data-id="layout-image"]')?.contains(element))).toBe(false);
});

test('uses a four-by-four material grid, scrolls overflow, and previews media in the canvas center', async ({ page }) => {
  const drafts = generationDrafts([]);
  await page.evaluate(generationDraftValues => {
    const instance = (window as typeof window & { flowCanvas: { import: (graph: string) => void } }).flowCanvas;
    const sources = Array.from({ length: 17 }, (_, index) => ({
      id: `catalog-image-${index}`,
      type: 'image',
      position: { x: 40 + (index % 4) * 180, y: 760 + Math.floor(index / 4) * 160 },
      data: {
        title: `素材图片 ${index + 1}`,
        generationMode: 'image',
        generationDrafts: generationDraftValues,
        status: 'completed',
        preview: '/assets/scene-character.jpg',
        previewKind: 'image',
        mimeType: 'image/jpeg',
      },
    }));
    instance.import(JSON.stringify({
      schemaVersion: 1,
      id: 'material-grid-acceptance',
      name: 'material grid acceptance',
      viewport: { x: 260, y: 40, zoom: 1 },
      metadata: {},
      nodes: [{
        id: 'material-grid-target', type: 'video', position: { x: 0, y: 0 },
        data: { title: '视频生成', generationMode: 'video', generationDrafts: generationDraftValues, status: 'idle' },
      }, {
        id: 'catalog-video-real', type: 'video', position: { x: 760, y: 760 },
        data: { title: '已生成视频', generationMode: 'video', generationDrafts: generationDraftValues, status: 'completed', preview: 'data:video/mp4;base64,AAAA', previewKind: 'video', mimeType: 'video/mp4' },
      }, {
        id: 'catalog-video-legacy-frame', type: 'video', position: { x: 940, y: 760 },
        data: { title: '仅首帧的旧视频', generationMode: 'video', generationDrafts: generationDraftValues, status: 'completed', preview: '/assets/scene-city.jpg', previewKind: 'image', mimeType: 'image/jpeg' },
      }, ...sources],
      edges: [],
    }));
  }, drafts);

  const target = page.locator('.react-flow__node[data-id="material-grid-target"]');
  await target.getByTitle('选择画布素材或上传图片、视频和音频').click();
  const picker = page.getByRole('listbox', { name: '选择画布素材' });
  await expect(picker).toBeVisible();
  const layout = await picker.locator('.fc-generation-reference-popover__grid').evaluate(element => ({
    cards: element.querySelectorAll('.fc-generation-reference-card').length,
    columns: getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
    scrolls: element.scrollHeight > element.clientHeight,
  }));
  expect(layout).toEqual({ cards: 17, columns: 4, scrolls: true });
  const uploadBounds = await picker.evaluate(element => {
    const panel = element.getBoundingClientRect();
    const upload = element.querySelector('.fc-generation-reference-popover__upload')?.getBoundingClientRect();
    return upload ? {
      leftInside: upload.left >= panel.left,
      rightInside: upload.right <= panel.right + 1,
      bottomInside: upload.bottom <= panel.bottom + 1,
    } : null;
  });
  expect(uploadBounds).toEqual({ leftInside: true, rightInside: true, bottomInside: true });

  const downloadPromise = page.waitForEvent('download');
  await picker.getByRole('button', { name: '导出素材 素材图片 1', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('素材图片 1');

  await picker.getByRole('button', { name: '预览素材 素材图片 1', exact: true }).click();
  const preview = page.getByRole('dialog', { name: '素材预览' });
  await expect(preview).toBeVisible();
  await expect(preview.locator('img')).toBeVisible();
  await page.getByRole('button', { name: '关闭素材预览' }).click();

  await picker.getByRole('tab', { name: '视频' }).click();
  await expect(picker.getByText('已生成视频')).toBeVisible();
  await expect(picker.getByText('仅首帧的旧视频')).toHaveCount(0);
  await picker.getByRole('button', { name: '预览素材 已生成视频', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '素材预览' }).locator('video')).toBeVisible();
});

test('keeps the parameter row pinned to the bottom after a long prompt expands', async ({ page }) => {
  await importGenerationLayout(page, 'video');
  await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { getGraph: () => { nodes: Array<{ id: string; data: Record<string, unknown> }> }; engine: { updateNodeData: (id: string, patch: Record<string, unknown>) => void } } }).flowCanvas;
    const target = instance.getGraph().nodes.find(node => node.id === 'layout-video');
    if (!target) throw new Error('layout video node missing');
    const drafts = structuredClone(target.data.generationDrafts) as { video: { prompt: string } };
    drafts.video.prompt = Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 行镜头、动作与场景描述`).join('\n');
    instance.engine.updateNodeData('layout-video', { generationDrafts: drafts });
  });
  const node = page.locator('.react-flow__node[data-id="layout-video"]');
  const geometry = await node.evaluate(element => {
    const input = element.querySelector('.fc-generation-input')!.getBoundingClientRect();
    const footer = element.querySelector('.fc-generation-parameters')!.getBoundingClientRect();
    const textarea = element.querySelector('textarea') as HTMLTextAreaElement;
    return {
      bottomGap: Math.round(input.bottom - footer.bottom),
      textareaHasInternalScroll: textarea.scrollHeight > textarea.clientHeight + 1,
    };
  });
  expect(geometry.bottomGap).toBeLessThanOrEqual(13);
  expect(geometry.textareaHasInternalScroll).toBe(false);
});

test('keeps video parameters and the credit/submit group aligned in one row in both themes', async ({ page }) => {
  await importGenerationLayout(page, 'video');

  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light') {
      await page.getByRole('button', { name: '切换主题' }).click();
      await expect(sdk(page)).toHaveAttribute('data-theme', 'light');
    }
    const before = await generationLayout(page, 'video');
    expectSharedGenerationGeometry(before);
    expect(before.rowTops, `${theme} video controls stay in one row`).toHaveLength(1);
    expect(Math.abs(before.submitGroup.y - before.parameterControls[0]!.y), `${theme} credit/submit aligns with parameter row`).toBeLessThanOrEqual(1);
    expect(before.widths).toEqual({
      视频生成模型: 144,
      视频比例: 70,
      视频分辨率: 84,
      视频时长: 70,
      生成声音: 70,
    });
    await page.locator('.react-flow__node[data-id="layout-video"]').screenshot({
      path: `artifacts/screenshots/generation-layout-video-${theme}.png`,
    });

    await expect(page.getByRole('button', { name: '生成模式' })).toHaveCount(0);
    await page.getByRole('button', { name: '视频比例' }).click();
    await page.getByRole('option', { name: /adaptive/ }).click();
    await page.getByRole('button', { name: '视频分辨率' }).click();
    await page.getByRole('option', { name: /720p/ }).click();
    await page.getByRole('button', { name: '视频时长' }).click();
    await page.getByRole('option', { name: /15秒/ }).click();
    const after = await generationLayout(page, 'video');
    expectSharedGenerationGeometry(after);
    expect(after.rowTops, `${theme} video controls stay in one row after changing values`).toHaveLength(1);
    expect(after.widths, `${theme} video control widths stay stable after changing values`).toEqual(before.widths);
  }
});

test('renders provider failure details inside the node preview', async ({ page }) => {
  await importGenerationLayout(page, 'image');
  await page.evaluate(() => {
    const instance = (window as typeof window & { flowCanvas: { engine: { updateNodeData: (id: string, patch: Record<string, unknown>) => void } } }).flowCanvas;
    instance.engine.updateNodeData('layout-image', { status: 'error', progress: .38, runError: 'Seedance task task_failed: 算力不足' });
  });
  const failure = page.locator('.react-flow__node[data-id="layout-image"] .fc-generation-node__error');
  await expect(failure).toBeVisible();
  await expect(failure).toContainText('生成失败');
  await expect(failure).toContainText('算力不足');
});

test('captures desktop dark, desktop light, and mobile acceptance views', async ({ page }) => {
  await page.screenshot({ path: 'artifacts/screenshots/flowcanvas-desktop-dark.png', fullPage: true });
  await page.getByRole('button', { name: '切换主题' }).click();
  await page.screenshot({ path: 'artifacts/screenshots/flowcanvas-desktop-light.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'artifacts/screenshots/flowcanvas-mobile-light.png', fullPage: true });
});
