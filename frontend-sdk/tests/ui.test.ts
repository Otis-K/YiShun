import { createElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CanvasEngine } from '../src/core/engine';
import { createEmptyGraph } from '../src/core/serialization';
import type { GraphDocument, NodeDefinition } from '../src/core/types';
import { FlowCanvasApp } from '../src/react/FlowCanvasApp';
import { Inspector } from '../src/react/Inspector';
import type { FlowCanvasInspectorRendererProps, FlowCanvasNodeRendererProps } from '../src/react/extensions';
import { RuntimeConfigurationRequiredError } from '../src/runtime/errors';
import { builtinNodeDefinitions } from '../src/builtins';
import { createGenerationDrafts, inferVideoModeType, type GenerationDrafts } from '../src/generation';

const definition: NodeDefinition = {
  type: 'test.text',
  title: '测试文本',
  category: '测试',
  description: '用于 UI 测试',
  inputs: [],
  outputs: [],
  createData: () => ({ title: '测试文本', prompt: '' }),
};

function graphWithNode(type = definition.type): GraphDocument {
  const graph = createEmptyGraph('UI 测试');
  graph.nodes.push({
    id: 'node-1',
    type,
    position: { x: 80, y: 80 },
    data: { title: type === definition.type ? '原始名称' : '保留的未知节点', prompt: '初始内容' },
  });
  return graph;
}

function createEngine(graph = createEmptyGraph('UI 测试')): CanvasEngine {
  const engine = new CanvasEngine({ graph });
  engine.registerNodeType(definition);
  return engine;
}

function createImageGenerationEngine(prompt = ''): CanvasEngine {
  const graph = createEmptyGraph('生成提示词输入测试');
  const drafts = createGenerationDrafts();
  drafts.image.prompt = prompt;
  graph.nodes.push({
    id: 'image-generation-node',
    type: 'image',
    position: { x: 80, y: 80 },
    data: {
      title: '图片生成',
      prompt,
      generationMode: 'image',
      generationDrafts: drafts,
    },
  });
  const engine = new CanvasEngine({ graph });
  builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
  return engine;
}

const app = (engine: CanvasEngine, props: Partial<Parameters<typeof FlowCanvasApp>[0]> = {}) => createElement(
  'div',
  { style: { width: 900, height: 640 } },
  createElement(FlowCanvasApp, {
    engine,
    theme: 'dark',
    onThemeChange: () => undefined,
    ...props,
  }),
);

describe('FlowCanvas React UI', () => {
  it('隔离多实例状态并真正切换选择/平移模式', () => {
    const firstTheme = vi.fn();
    const secondTheme = vi.fn();
    render(createElement('div', {},
      app(createEngine(), { theme: 'dark', onThemeChange: firstTheme }),
      app(createEngine(), { theme: 'light', onThemeChange: secondTheme }),
    ));

    const instances = screen.getAllByTestId('flowcanvas-sdk');
    expect(instances).toHaveLength(2);
    expect(instances[0]).toHaveAttribute('data-theme', 'dark');
    expect(instances[1]).toHaveAttribute('data-theme', 'light');

    fireEvent.click(within(instances[0]).getByTitle('平移'));
    expect(instances[0]).toHaveAttribute('data-interaction-mode', 'pan');
    expect(instances[1]).toHaveAttribute('data-interaction-mode', 'select');
    fireEvent.click(within(instances[0]).getByLabelText('切换主题'));
    expect(firstTheme).toHaveBeenCalledWith('light');
    expect(secondTheme).not.toHaveBeenCalled();
  });

  it('只读模式关闭所有图数据写入入口', () => {
    const engine = createEngine(graphWithNode());
    engine.setSelection({ nodeIds: ['node-1'], edgeIds: [] });
    render(app(engine, { readOnly: true }));

    const root = screen.getByTestId('flowcanvas-sdk');
    expect(root).toHaveAttribute('data-read-only', 'true');
    expect(within(root).queryByTitle('添加节点')).not.toBeInTheDocument();
    expect(within(root).queryByTitle('导入 JSON')).not.toBeInTheDocument();
    expect(within(root).getByRole('button', { name: '运行全部' })).toBeInTheDocument();
    expect(within(root).getByTitle('撤销')).toBeDisabled();
    expect(within(root).getByTitle('重做')).toBeDisabled();
    expect(within(root).getByLabelText('节点名称')).toHaveAttribute('readonly');
    expect(within(root).getByLabelText('重试次数')).toBeDisabled();
    expect(within(root).queryByRole('button', { name: '删除' })).not.toBeInTheDocument();
  });

  it('没有注入服务时不展示假素材与 AI 功能，注入后可使用文件选择', async () => {
    const { unmount } = render(app(createEngine()));
    expect(screen.queryByTitle('AI 助手')).not.toBeInTheDocument();
    expect(screen.queryByTitle('上传素材')).not.toBeInTheDocument();
    expect(screen.queryByText('上传图片或视频')).not.toBeInTheDocument();
    unmount();

    const pickFiles = vi.fn().mockResolvedValue([]);
    render(app(createEngine(), {
      services: {
        assets: { accept: 'image/*', pickFiles },
        assistant: { send: async () => ({ message: '真实回复' }) },
      },
    }));
    expect(screen.getByTitle('AI 助手')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('上传素材'));
    const file = new File(['image'], 'scene.png', { type: 'image/png' });
    const input = document.querySelector<HTMLInputElement>('input[accept="image/*"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });
    await waitFor(() => expect(pickFiles).toHaveBeenCalledTimes(1));
    expect(pickFiles.mock.calls[0][0].files).toEqual([file]);
    expect(pickFiles.mock.calls[0][0].source).toBe('picker');
  });

  it('V3 每个节点独立保留四模式输入状态并提供左侧四入口', () => {
    const graph = createEmptyGraph('V3 UI');
    const engine = new CanvasEngine({ graph });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    const first = engine.addNode('prompt', { x: 80, y: 80 }, { title: '节点一', prompt: '文本草稿' });
    const second = engine.addNode('prompt', { x: 680, y: 80 }, { title: '节点二', prompt: '保持文本' });
    render(app(engine));

    expect(screen.queryByText('FlowCanvas')).not.toBeInTheDocument();
    expect(screen.queryByText(/未命名故事/)).not.toBeInTheDocument();
    const entries = screen.getByRole('navigation', { name: '生成节点入口' });
    expect(within(entries).getByTitle('收起节点抽屉')).toBeEnabled();
    expect(within(entries).getByTitle('添加文本节点')).toBeEnabled();
    expect(within(entries).getByTitle('添加图片节点')).toBeEnabled();
    expect(within(entries).getByTitle('添加视频节点')).toBeEnabled();
    expect(within(entries).getByTitle('添加音频节点')).toBeEnabled();
    fireEvent.click(within(entries).getByTitle('收起节点抽屉'));
    expect(within(entries).getByTitle('展开节点抽屉')).toBeInTheDocument();
    expect(within(entries).queryByTitle('添加文本节点')).not.toBeInTheDocument();
    fireEvent.click(within(entries).getByTitle('展开节点抽屉'));
    expect(within(entries).getByTitle('添加文本节点')).toBeEnabled();
    expect(screen.getByTestId('rf__minimap')).toBeInTheDocument();

    const firstNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${first.id}"]`)!;
    const imageTab = Array.from(firstNode.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
      .find(tab => tab.textContent === '图片生成');
    expect(imageTab).toBeDefined();
    fireEvent.click(imageTab!);
    expect(engine.getGraph().nodes.find(node => node.id === first.id)?.type).toBe('image');
    expect(engine.getGraph().nodes.find(node => node.id === second.id)?.type).toBe('prompt');
    const imageRatio = firstNode.querySelector<HTMLButtonElement>('button[aria-label="图片比例"]');
    expect(imageRatio).not.toBeNull();
    fireEvent.click(imageRatio!);
    fireEvent.click(screen.getByRole('option', { name: /9:16/ }));
    const firstData = engine.getGraph().nodes.find(node => node.id === first.id)?.data;
    expect((firstData?.generationDrafts as { image: { ratio: string } }).image.ratio).toBe('9:16');
    expect(engine.getGraph().nodes.find(node => node.id === second.id)?.data.prompt).toBe('保持文本');
    const currentFirstNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${first.id}"]`)!;
    const modelTrigger = currentFirstNode.querySelector<HTMLButtonElement>('button[aria-label="图片生成模型"]');
    expect(modelTrigger).not.toBeNull();
    fireEvent.click(modelTrigger!);
    expect(modelTrigger).toHaveAttribute('aria-expanded', 'true');
    const modelMenu = document.querySelector<HTMLElement>('.fc-model-select__menu[aria-label="图片生成模型选项"]')!;
    expect(modelMenu).not.toHaveAttribute('hidden');
    expect(within(modelMenu).getByText('支持 1K、2K、4K 与多种画幅的图片生成模型')).toBeInTheDocument();
    const nanoOption = Array.from(modelMenu.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent?.includes('Nano Banana Pro'))!;
    fireEvent.click(nanoOption);
    expect(modelTrigger).toHaveTextContent('Nano Banana Pro');
    expect(modelTrigger!.querySelector('span')).toHaveAttribute('title', 'nano-banana-pro(特价版 1)');
  });

  it('生成提示词快速连续输入保持焦点，失焦时只提交一次并可一次撤销', () => {
    const engine = createImageGenerationEngine();
    const graphChanges = vi.fn();
    engine.on('graph:change', graphChanges);
    render(app(engine));

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('图片生成描述');
    const nodeShell = textarea.closest<HTMLElement>('.react-flow__node');
    const value = 'she walks through the neon city at midnight';
    expect(nodeShell).not.toBeNull();
    act(() => { textarea.focus(); });
    expect(document.activeElement).toBe(textarea);
    for (let index = 1; index <= value.length; index += 1) {
      fireEvent.change(textarea, { target: { value: value.slice(0, index) } });
      expect(document.activeElement).toBe(textarea);
      expect(nodeShell?.style.visibility).not.toBe('hidden');
    }

    expect(textarea).toHaveValue(value);
    expect(((engine.getGraph().nodes[0]?.data.generationDrafts as GenerationDrafts).image.prompt)).toBe(value);
    expect(graphChanges).not.toHaveBeenCalled();
    expect(engine.history.canUndo).toBe(false);

    fireEvent.blur(textarea);
    expect(graphChanges).toHaveBeenCalledTimes(1);
    expect(engine.history.canUndo).toBe(true);
    act(() => { engine.undo(); });
    expect(((engine.getGraph().nodes[0]?.data.generationDrafts as GenerationDrafts).image.prompt)).toBe('');
  });

  it('中文输入法组合期间以本地草稿为准且不会被图状态回写打断', () => {
    const engine = createImageGenerationEngine();
    const graphChanges = vi.fn();
    engine.on('graph:change', graphChanges);
    render(app(engine));

    const textarea = screen.getByLabelText<HTMLTextAreaElement>('图片生成描述');
    const values = ['一', '一只', '一只穿', '一只穿着', '一只穿着铠甲', '一只穿着铠甲的勇士'];
    act(() => { textarea.focus(); });
    expect(document.activeElement).toBe(textarea);
    fireEvent.compositionStart(textarea);
    values.forEach(value => {
      fireEvent.change(textarea, { target: { value } });
      expect(document.activeElement).toBe(textarea);
      expect(textarea).toHaveValue(value);
    });
    fireEvent.compositionEnd(textarea, { data: values.at(-1) });

    expect(document.activeElement).toBe(textarea);
    expect(textarea).toHaveValue(values.at(-1));
    expect(graphChanges).not.toHaveBeenCalled();
    fireEvent.blur(textarea);
    expect(graphChanges).toHaveBeenCalledTimes(1);
    act(() => { engine.undo(); });
    expect(((engine.getGraph().nodes[0]?.data.generationDrafts as GenerationDrafts).image.prompt)).toBe('');
  });

  it('图片和视频素材用同级大预览渲染，视频使用封面播放器', () => {
    const assetDefinition: NodeDefinition = {
      type: 'asset.preview',
      title: '素材节点',
      category: '输入',
      icon: 'image',
      inputs: [],
      outputs: [],
      createData: () => ({ title: '素材节点' }),
    };
    const graph = createEmptyGraph('媒体预览');
    graph.nodes.push(
      {
        id: 'image-asset',
        type: 'asset.preview',
        position: { x: 80, y: 80 },
        data: {
          title: '图片素材',
          preview: 'data:image/png;base64,iVBORw0KGgo=',
          mimeType: 'image/png',
          previewKind: 'image',
        },
      },
      {
        id: 'video-asset',
        type: 'asset.preview',
        position: { x: 420, y: 80 },
        data: {
          title: '视频素材',
          preview: 'blob:flowcanvas-video-preview',
          mimeType: 'video/mp4',
          previewKind: 'video',
        },
      },
    );
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(assetDefinition);

    render(app(engine));

    const imageNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="image-asset"] article.fc-node--media-image');
    const videoNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="video-asset"] article.fc-node--media-video');
    const image = imageNode?.querySelector<HTMLImageElement>('img.fc-node__preview');
    const videoShell = videoNode?.querySelector<HTMLElement>('.fc-video-preview.fc-node__preview');
    const video = videoShell?.querySelector<HTMLVideoElement>('video');
    const playButton = videoShell?.querySelector<HTMLButtonElement>('button[aria-label="播放视频预览"]');
    expect(imageNode).not.toBeNull();
    expect(videoNode).not.toBeNull();
    expect(image).not.toBeNull();
    expect(image?.src).toContain('data:image/png');
    expect(videoShell).not.toBeNull();
    expect(video).not.toBeNull();
    expect(video?.controls).toBe(false);
    expect(video?.getAttribute('preload')).toBe('metadata');
    expect(video).not.toHaveClass('nodrag');
    expect(playButton).not.toBeNull();
    expect(videoShell?.querySelector<HTMLInputElement>('input[aria-label="视频播放进度"]')).not.toBeNull();
    fireEvent.play(video!);
    expect(videoShell?.querySelector<HTMLButtonElement>('button[aria-label="暂停视频预览"]')).not.toBeNull();
  });

  it('节点使用固定尺寸且不显示尺寸调整控件', () => {
    const graph = createEmptyGraph('固定尺寸');
    graph.nodes.push({
      id: 'blank-size',
      type: 'blank',
      position: { x: 80, y: 80 },
      width: 520,
      height: 360,
      data: { title: '空白节点', embeddedMedia: [] },
    });
    graph.nodes.push({
      id: 'prompt-size',
      type: 'prompt',
      position: { x: 680, y: 80 },
      width: 360,
      height: 240,
      data: { title: '文本节点', generationMode: 'text' },
    });
    const engine = new CanvasEngine({ graph });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    engine.setSelection({ nodeIds: ['blank-size', 'prompt-size'], edgeIds: [] });

    render(app(engine));

    const blankShell = document.querySelector<HTMLElement>('.react-flow__node[data-id="blank-size"]');
    const promptShell = document.querySelector<HTMLElement>('.react-flow__node[data-id="prompt-size"]');
    expect(blankShell?.style.width).toBe('420px');
    expect(blankShell?.style.height).toBe('290px');
    expect(promptShell?.style.width).toBe('720px');
    expect(promptShell?.style.height).toBe('642px');
    expect(document.querySelectorAll('.react-flow__resize-control')).toHaveLength(0);
  });

  it('左侧节点栏提供空白节点入口', () => {
    const engine = new CanvasEngine({ graph: createEmptyGraph('空白节点入口') });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    render(app(engine));

    const blankButton = screen.getByTitle('添加空白节点');
    expect(blankButton).toBeEnabled();
    fireEvent.click(blankButton);
    expect(engine.getGraph().nodes).toHaveLength(1);
    expect(engine.getGraph().nodes[0]?.type).toBe('blank');
  });

  it('选中空白节点上传视频会转换为视频节点，不新增分离素材节点', async () => {
    const engine = new CanvasEngine({ graph: createEmptyGraph('嵌入素材') });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    const blank = engine.addNode('blank', { x: 80, y: 80 });
    engine.setSelection({ nodeIds: [blank.id], edgeIds: [] });
    const pickFiles = vi.fn(async request => [{
      type: 'local_asset',
      data: {
        title: 'clip.mp4',
        fileName: 'clip.mp4',
        mimeType: 'video/mp4',
        mediaType: 'video',
        previewKind: 'video',
        preview: 'blob:clip-video',
        size: 5,
        lastModified: 123,
      },
    }]);

    render(app(engine, {
      services: { assets: { accept: 'image/*,video/*,audio/*', pickFiles } },
    }));
    fireEvent.click(screen.getByTitle('上传素材'));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="video"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(['video'], 'clip.mp4', { type: 'video/mp4' })] } });

    await waitFor(() => expect(pickFiles).toHaveBeenCalled());
    expect(pickFiles.mock.calls[0]?.[0].targetNodeId).toBe(blank.id);
    await waitFor(() => expect(engine.getGraph().nodes).toHaveLength(1));
    const node = engine.getGraph().nodes[0];
    expect(node?.type).toBe('video');
    expect(node?.data.generationMode).toBe('video');
    expect(node?.data.previewKind).toBe('video');
    expect(node?.data.preview).toBe('blob:clip-video');
    expect(node?.data.embeddedMedia).toHaveLength(1);
    expect((node?.data.generationDrafts as GenerationDrafts).video.references).toHaveLength(1);
    expect(document.querySelector('[data-node-type="local_asset"]')).toBeNull();
  });

  it('外部素材可拖入空白、图片和视频节点并按节点能力绑定', async () => {
    const engine = new CanvasEngine({ graph: createEmptyGraph('节点拖入素材') });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    const blank = engine.addNode('blank', { x: 40, y: 40 });
    const image = engine.addNode('image', { x: 520, y: 40 });
    const video = engine.addNode('video', { x: 1040, y: 40 });
    const pickFiles = vi.fn(async request => (Array.from(request.files ?? []) as File[]).map(file => ({
      type: 'local_asset',
      data: {
        title: file.name,
        fileName: file.name,
        mimeType: file.type,
        mediaType: file.type.startsWith('video/') ? 'video' : 'image',
        previewKind: file.type.startsWith('video/') ? 'video' : 'image',
        preview: `blob:${file.name}`,
      },
    })));
    render(app(engine, {
      services: { assets: { accept: 'image/*,video/*,audio/*', pickFiles } },
    }));

    const drop = async (nodeId: string, file: File) => {
      const target = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)!;
      fireEvent.drop(target, {
        clientX: 100,
        clientY: 100,
        dataTransfer: { files: [file], types: ['Files'], getData: () => '' },
      });
      await waitFor(() => expect(pickFiles).toHaveBeenCalled());
    };

    await drop(blank.id, new File(['image'], 'blank-image.png', { type: 'image/png' }));
    expect(pickFiles.mock.calls.at(-1)?.[0].targetNodeId).toBe(blank.id);
    await waitFor(() => expect(engine.getGraph().nodes.find(node => node.id === blank.id)?.type).toBe('image'));

    await drop(image.id, new File(['image'], 'image-reference.png', { type: 'image/png' }));
    await waitFor(() => expect(
      ((engine.getGraph().nodes.find(node => node.id === image.id)?.data.generationDrafts as GenerationDrafts).image.references),
    ).toHaveLength(1));

    await drop(video.id, new File(['video'], 'video-reference.mp4', { type: 'video/mp4' }));
    await waitFor(() => expect(
      ((engine.getGraph().nodes.find(node => node.id === video.id)?.data.generationDrafts as GenerationDrafts).video.references),
    ).toHaveLength(1));

    const targetNode = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${video.id}"]`)!;
    fireEvent.click(within(targetNode).getByTitle('选择画布素材或上传图片、视频和音频'));
    fireEvent.click(within(screen.getByRole('listbox', { name: '选择画布素材' })).getByRole('tab', { name: '图片' }));
    expect(within(screen.getByRole('listbox', { name: '选择画布素材' })).getByText('image-reference.png')).toBeInTheDocument();
  });

  it('没有目标节点时上传媒体会创建空白容器节点', async () => {
    const engine = new CanvasEngine({ graph: createEmptyGraph('自动空白容器') });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    const pickFiles = vi.fn(async request => [{
      type: 'local_asset',
      data: {
        title: 'poster.png',
        fileName: 'poster.png',
        mimeType: 'image/png',
        mediaType: 'image',
        previewKind: 'image',
        preview: 'blob:poster-image',
        size: 4,
        lastModified: 456,
      },
    }]);

    render(app(engine, {
      services: { assets: { accept: 'image/*,video/*,audio/*', pickFiles } },
    }));
    fireEvent.click(screen.getByTitle('上传素材'));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][accept*="image"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [new File(['image'], 'poster.png', { type: 'image/png' })] } });

    await waitFor(() => expect(pickFiles).toHaveBeenCalled());
    expect(pickFiles.mock.calls[0]?.[0].targetNodeId).toBeUndefined();
    await waitFor(() => expect(engine.getGraph().nodes).toHaveLength(1));
    const node = engine.getGraph().nodes[0];
    expect(node?.type).toBe('blank');
    expect(node?.data.previewKind).toBe('image');
    expect(node?.data.embeddedMedia).toHaveLength(1);
    expect(document.querySelector('.react-flow__node[data-id="' + node?.id + '"] img.fc-node__preview')).not.toBeNull();
  });

  it('提供可见的删除选中入口，素材节点不用找属性面板也能删除', () => {
    const assetDefinition: NodeDefinition = {
      type: 'asset.preview',
      title: '素材节点',
      category: '输入',
      icon: 'image',
      inputs: [],
      outputs: [],
      createData: () => ({ title: '素材节点' }),
    };
    const graph = createEmptyGraph('删除测试');
    const engine = new CanvasEngine({ graph });
    engine.registerNodeType(assetDefinition);
    const asset = engine.addNode('asset.preview', { x: 80, y: 80 }, {
      title: '待删除素材',
      preview: 'blob:delete-me',
      mimeType: 'video/mp4',
      previewKind: 'video',
    });
    engine.setSelection({ nodeIds: [asset.id], edgeIds: [] });

    render(app(engine));

    const deleteButton = screen.getByRole('button', { name: '删除选中' });
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);
    expect(engine.getGraph().nodes).toHaveLength(0);
  });

  it('生成节点上传素材 chip 和视频首帧尾帧可以单独移除', () => {
    const graph = createEmptyGraph('生成素材移除');
    const engine = new CanvasEngine({ graph });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    const drafts = createGenerationDrafts();
    drafts.image.references = [{
      id: 'image-ref',
      name: '参考图.png',
      kind: 'image',
      mimeType: 'image/png',
      url: 'blob:image-ref',
    }];
    const imageNode = engine.addNode('image', { x: 80, y: 80 }, {
      title: '图片生成',
      generationMode: 'image',
      generationDrafts: drafts,
      preview: 'blob:image-ref',
      previewKind: 'image',
      mimeType: 'image/png',
    });
    const videoDrafts = createGenerationDrafts();
    videoDrafts.video.firstFrame = {
      id: 'first-frame',
      name: '首帧.png',
      kind: 'image',
      mimeType: 'image/png',
      url: 'blob:first-frame',
    };
    const videoNode = engine.addNode('video', { x: 500, y: 80 }, {
      title: '视频生成',
      generationMode: 'video',
      generationDrafts: videoDrafts,
      preview: 'blob:first-frame',
      previewKind: 'image',
      mimeType: 'image/png',
    });

    render(app(engine));
    const removeReference = document.querySelector<HTMLButtonElement>('button[aria-label="移除素材 参考图.png"]');
    expect(removeReference).not.toBeNull();
    fireEvent.click(removeReference!);
    const imageData = engine.getGraph().nodes.find(node => node.id === imageNode.id)?.data;
    expect(((imageData?.generationDrafts as GenerationDrafts).image.references)).toHaveLength(0);
    expect(imageData?.preview).toBe('');

    const removeFirstFrame = document.querySelector<HTMLButtonElement>('button[aria-label="移除首帧素材"]');
    expect(removeFirstFrame).not.toBeNull();
    fireEvent.click(removeFirstFrame!);
    const videoData = engine.getGraph().nodes.find(node => node.id === videoNode.id)?.data;
    expect((videoData?.generationDrafts as GenerationDrafts).video.firstFrame).toBe('');
    expect(videoData?.preview).toBe('');
  });

  it('素材选择器展示画布全部媒体，连线只进入普通素材栏且首帧需显式选择', () => {
    const graph = createEmptyGraph('画布素材选择');
    const sourceDrafts = createGenerationDrafts();
    sourceDrafts.image.prompt = '已完成图片';
    graph.nodes.push({
      id: 'completed-image',
      type: 'image',
      position: { x: 40, y: 40 },
      data: {
        title: '已完成图片素材',
        generationMode: 'image',
        generationDrafts: sourceDrafts,
        status: 'completed' as never,
        preview: 'blob:completed-image',
        previewKind: 'image',
        mimeType: 'image/png',
      },
    }, {
      id: 'legacy-video-with-frame',
      type: 'video',
      position: { x: 40, y: 380 },
      data: {
        title: '错误的图片视频缩略图',
        generationMode: 'video',
        generationDrafts: createGenerationDrafts(),
        status: 'completed' as never,
        preview: 'blob:legacy-first-frame',
        previewKind: 'image',
        mimeType: 'image/png',
      },
    }, {
      id: 'completed-video',
      type: 'video',
      position: { x: 40, y: 720 },
      data: {
        title: '真实视频素材',
        generationMode: 'video',
        generationDrafts: createGenerationDrafts(),
        status: 'completed' as never,
        preview: 'blob:completed-video',
        previewKind: 'video',
        mimeType: 'video/mp4',
      },
    });
    const videoDrafts = createGenerationDrafts();
    graph.nodes.push({
      id: 'video-target',
      type: 'video',
      position: { x: 720, y: 40 },
      data: { title: '视频生成', generationMode: 'video', generationDrafts: videoDrafts },
    });
    const engine = new CanvasEngine({ graph });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    render(app(engine));

    const videoNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="video-target"]')!;
    fireEvent.click(within(videoNode).getByTitle('选择画布素材或上传图片、视频和音频'));
    const picker = screen.getByRole('listbox', { name: '选择画布素材' });
    expect(picker).toBeInTheDocument();
    expect(within(picker).getByText('已完成图片素材')).toBeInTheDocument();
    expect(within(picker).getByRole('option', { name: /已完成图片素材/ })).toHaveAttribute('aria-selected', 'false');
    expect(within(picker).queryByText('真实视频素材')).not.toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '导出素材 已完成图片素材' })).toBeInTheDocument();
    fireEvent.click(within(picker).getByRole('tab', { name: '视频' }));
    expect(within(picker).getByText('真实视频素材')).toBeInTheDocument();
    expect(within(picker).queryByText('错误的图片视频缩略图')).not.toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: '导出素材 真实视频素材' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /上传本地素材/ })).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole('button', { name: '预览素材 真实视频素材' }));
    const videoPreview = screen.getByRole('dialog', { name: '素材预览' });
    expect(videoPreview.querySelector('video')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭素材预览' }));

    fireEvent.click(within(picker).getByRole('tab', { name: '图片' }));

    fireEvent.pointerDown(screen.getByTestId('flowcanvas-sdk'));
    expect(screen.queryByRole('listbox', { name: '选择画布素材' })).not.toBeInTheDocument();

    act(() => { engine.addEdge({ source: 'completed-image', sourcePort: 'image', target: 'video-target', targetPort: 'image' }); });
    const connectedVideoNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="video-target"]')!;
    expect(within(connectedVideoNode).queryByTitle('在画布中央预览首帧')).not.toBeInTheDocument();
    expect(within(connectedVideoNode).getByLabelText('已选参考素材')).toBeInTheDocument();
    fireEvent.click(within(connectedVideoNode).getByTitle('从画布素材中选择首帧'));
    fireEvent.click(within(screen.getByRole('listbox', { name: '选择画布素材' })).getByRole('button', { name: '使用素材 已完成图片素材' }));
    fireEvent.click(within(connectedVideoNode).getByTitle('在画布中央预览首帧'));
    expect(screen.getByRole('dialog', { name: '素材预览' })).toBeInTheDocument();
    expect(within(connectedVideoNode).getByTitle('在画布中央预览首帧').querySelector('img')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '关闭素材预览' }));
    fireEvent.click(within(connectedVideoNode).getByRole('button', { name: '移除首帧素材' }));
    expect(engine.getGraph().edges).toHaveLength(0);
  });

  it('视频请求模式由素材配置自动推导且界面不再提供重复下拉框', () => {
    const drafts = createGenerationDrafts();
    expect(inferVideoModeType(drafts.video)).toBe('text2video');
    drafts.video.firstFrame = { id: 'first', name: '首帧', kind: 'image', url: 'blob:first' };
    expect(inferVideoModeType(drafts.video)).toBe('image2video');
    drafts.video.firstFrame = '';
    drafts.video.references = [{ id: 'video', name: '参考视频', kind: 'video', url: 'blob:video' }];
    expect(inferVideoModeType(drafts.video)).toBe('mixed2video');

    const graph = createEmptyGraph('自动模式');
    graph.nodes.push({ id: 'auto-video', type: 'video', position: { x: 0, y: 0 }, data: { title: '视频生成', generationMode: 'video', generationDrafts: drafts } });
    const engine = new CanvasEngine({ graph });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    render(app(engine));
    expect(screen.queryByRole('button', { name: '生成模式' })).not.toBeInTheDocument();
  });

  it('重启遗留图片进入全画布素材库，已有连线不会自动占用首尾帧', () => {
    const graph = createEmptyGraph('素材持久化与断线');
    const imageDrafts = createGenerationDrafts();
    imageDrafts.image.prompt = '不会暴露到节点 UI 的上游提示词';
    const videoDrafts = createGenerationDrafts();
    graph.nodes.push({
      id: 'persisted-image', type: 'image', position: { x: 40, y: 40 },
      data: {
        title: '重启后图片', generationMode: 'image', generationDrafts: imageDrafts,
        status: 'idle', preview: 'blob:persisted-image', previewKind: 'image', mimeType: 'image/png',
      },
    }, {
      id: 'video-with-frame', type: 'video', position: { x: 740, y: 40 },
      data: { title: '视频生成', generationMode: 'video', generationDrafts: videoDrafts },
    });
    graph.edges.push({
      id: 'image-to-first-frame', source: 'persisted-image', sourcePort: 'image',
      target: 'video-with-frame', targetPort: 'image',
    });
    const engine = new CanvasEngine({ graph });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    engine.setSelection({ nodeIds: [], edgeIds: ['image-to-first-frame'] });
    render(app(engine));

    expect(screen.getByLabelText('当前缩放 100%')).toBeInTheDocument();
    expect(screen.queryByText(/上游语义/)).not.toBeInTheDocument();
    const videoNode = document.querySelector<HTMLElement>('.react-flow__node[data-id="video-with-frame"]')!;
    expect(within(videoNode).queryByRole('button', { name: '移除首帧素材' })).not.toBeInTheDocument();
    expect(within(videoNode).getByLabelText('已选参考素材')).toBeInTheDocument();
    fireEvent.click(within(videoNode).getByTitle('从画布素材中选择首帧'));
    expect(within(screen.getByRole('listbox', { name: '选择画布素材' })).getByText('重启后图片')).toBeInTheDocument();
    expect(engine.getGraph().edges).toHaveLength(1);
    expect(engine.getGraph().nodes).toHaveLength(2);
  });

  it('单输入单输出端口由内部判断类型，生成前拦截超出模型上限的素材', () => {
    const graph = createEmptyGraph('模型素材上限');
    const videoDrafts = createGenerationDrafts();
    videoDrafts.video.prompt = '生成测试视频';
    graph.nodes.push({
      id: 'video-limit-target', type: 'video', position: { x: 720, y: 40 },
      data: { title: '视频生成', generationMode: 'video', generationDrafts: videoDrafts },
    });
    for (const id of ['audio-a', 'audio-b']) {
      const audioDrafts = createGenerationDrafts();
      graph.nodes.push({
        id, type: 'audio', position: { x: 40, y: id === 'audio-a' ? 40 : 260 },
        data: { title: id, generationMode: 'audio', generationDrafts: audioDrafts, status: 'success', preview: `blob:${id}`, previewKind: 'audio', mimeType: 'audio/mpeg' },
      });
      graph.edges.push({ id: `${id}-edge`, source: id, sourcePort: 'audio', target: 'video-limit-target', targetPort: 'image' });
    }
    const engine = new CanvasEngine({ graph });
    builtinNodeDefinitions.forEach(item => engine.registerNodeType(item));
    render(app(engine));

    for (const node of document.querySelectorAll('.react-flow__node')) {
      expect(node.querySelectorAll('.fc-port--input').length).toBeLessThanOrEqual(1);
      expect(node.querySelectorAll('.fc-port--output').length).toBeLessThanOrEqual(1);
    }
    const target = document.querySelector<HTMLElement>('.react-flow__node[data-id="video-limit-target"]')!;
    fireEvent.click(within(target).getByRole('button', { name: '生成当前节点' }));
    expect(screen.getByText(/最多支持 1 个参考音频/)).toBeInTheDocument();
    expect(engine.isNodeRunning('video-limit-target')).toBe(false);
  });

  it('切换生成模式会同步节点类型、标题和运行状态', () => {
    const engine = createImageGenerationEngine('生成一张海报');
    engine.updateNodeData('image-generation-node', { status: 'success', progress: 1 });
    render(app(engine));

    fireEvent.click(screen.getByRole('tab', { name: '视频生成' }));

    const node = engine.getGraph().nodes.find(item => item.id === 'image-generation-node');
    expect(node?.type).toBe('video');
    expect(node?.data.generationMode).toBe('video');
    expect(node?.data.title).toBe('视频生成');
    expect(node?.data.status).toBe('idle');
    expect(document.querySelector('.react-flow__node[data-id="image-generation-node"] article')).toHaveAttribute('data-node-type', 'video');
  });

  it('已完成节点可重新生成且只刷新当前节点', async () => {
    const engine = createImageGenerationEngine('生成一张海报');
    engine.updateNodeData('image-generation-node', { status: 'success', progress: 1 });
    const runNode = vi.spyOn(engine, 'runNode').mockResolvedValue({
      runId: 'run-rerun', status: 'success', outputs: {}, nodeStates: {}, startedAt: Date.now(), endedAt: Date.now(),
    });
    render(app(engine));

    fireEvent.click(screen.getByRole('button', { name: '重新生成当前节点' }));
    await waitFor(() => expect(runNode).toHaveBeenCalledWith('image-generation-node', { refreshNodeIds: ['image-generation-node'] }));
  });

  it('捕获损坏 JSON，并为未知节点保留可见的 fallback', async () => {
    const engine = createEngine(graphWithNode('plugin.missing'));
    render(app(engine));
    expect(screen.getAllByText(/未知节点/).length).toBeGreaterThan(0);
    expect(screen.getByText(/plugin\.missing/)).toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>('input[accept*="json"]');
    expect(input).not.toBeNull();
    const brokenFile = { name: 'broken.json', text: async () => '{ broken' } as File;
    fireEvent.change(input!, { target: { files: [brokenFile] } });
    await waitFor(() => expect(screen.getByText(/\u5bfc\u5165\u5931\u8d25/)).toBeInTheDocument());
    expect(engine.getGraph().nodes[0]?.type).toBe('plugin.missing');
  });

  it('safely renders a prototype-shaped node type and icon without a custom renderer', () => {
    const protoDefinition: NodeDefinition = {
      type: '__proto__', title: 'Prototype node', category: 'Test', icon: '__proto__',
      inputs: [], outputs: [], createData: () => ({ title: 'Prototype node' }),
    };
    const graph = graphWithNode('__proto__');
    graph.nodes[0].data.title = 'Prototype node';
    const engine = createEngine(graph);
    engine.registerNodeType(protoDefinition);

    render(app(engine));
    expect(screen.getByText('Prototype node')).toBeInTheDocument();
    expect(screen.queryByText('自定义节点渲染失败')).not.toBeInTheDocument();
  });

  it('支持自定义节点与属性渲染器', () => {
    const engine = createEngine(graphWithNode());
    engine.setSelection({ nodeIds: ['node-1'], edgeIds: [] });
    const NodeRenderer = ({ node }: FlowCanvasNodeRendererProps) => createElement('div', { 'data-testid': 'custom-node' }, `NODE:${node.data.title}`);
    const InspectorRenderer = ({ definition: renderedDefinition }: FlowCanvasInspectorRendererProps) => createElement('div', { 'data-testid': 'custom-inspector' }, `INSPECTOR:${renderedDefinition.type}`);

    render(app(engine, {
      renderers: {
        nodes: { [definition.type]: NodeRenderer },
        inspectors: { [definition.type]: InspectorRenderer },
      },
    }));
    expect(screen.getByTestId('custom-node')).toHaveTextContent('NODE:原始名称');
    expect(screen.getByTestId('custom-inspector')).toHaveTextContent(`INSPECTOR:${definition.type}`);
  });

  it('隔离恶意或崩溃的自定义渲染器', () => {
    const engine = createEngine(graphWithNode());
    const errors: string[] = [];
    engine.on('error', event => errors.push(event.source));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const BrokenRenderer = ({ node }: FlowCanvasNodeRendererProps) => {
      (node.data as { title: string }).title = '篡改';
      throw new Error('renderer exploded');
    };

    render(app(engine, { renderers: { nodes: { [definition.type]: BrokenRenderer } } }));
    expect(screen.getByText('自定义节点渲染失败')).toBeInTheDocument();
    expect(engine.getGraph().nodes[0].data.title).toBe('原始名称');
    expect(errors).toContain(`renderer:node:${definition.type}`);
    consoleError.mockRestore();
  });

  it('编辑后可直接点击撤销，不依赖输入框先失焦', () => {
    const engine = createEngine(graphWithNode());
    engine.setSelection({ nodeIds: ['node-1'], edgeIds: [] });
    render(app(engine));
    const title = screen.getByLabelText('节点名称');
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: '待撤销' } });
    const undo = screen.getByTitle('撤销');
    expect(undo).not.toBeDisabled();
    fireEvent.click(undo);
    expect(engine.getGraph().nodes[0].data.title).toBe('原始名称');
  });

  it('自定义编辑器的快捷键不会误删画布节点', () => {
    const engine = createEngine(graphWithNode());
    engine.setSelection({ nodeIds: ['node-1'], edgeIds: [] });
    const EditorRenderer = () => createElement('div', {
      contentEditable: true,
      suppressContentEditableWarning: true,
      'data-testid': 'plugin-editor',
    }, '编辑中');
    render(app(engine, { renderers: { nodes: { [definition.type]: EditorRenderer } } }));
    fireEvent.keyDown(screen.getByTestId('plugin-editor'), { key: 'Delete' });
    expect(engine.getGraph().nodes).toHaveLength(1);
  });

  it('将连续属性输入合并为一条撤销历史', () => {
    const engine = createEngine(graphWithNode());
    const graphChanges = vi.fn();
    engine.on('graph:change', graphChanges);
    const node = engine.getGraph().nodes[0]!;
    render(createElement(Inspector, {
      engine,
      node,
      definition,
      issues: [],
      onClose: () => undefined,
      tab: 'properties',
      onTabChange: () => undefined,
    }));

    const title = screen.getByLabelText('节点名称');
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: '第一步' } });
    fireEvent.change(title, { target: { value: '第二步' } });
    fireEvent.change(title, { target: { value: '最终名称' } });
    expect(engine.history.canUndo).toBe(false);
    expect(graphChanges).not.toHaveBeenCalled();
    fireEvent.blur(title);
    expect(engine.history.canUndo).toBe(true);
    expect(graphChanges).toHaveBeenCalledTimes(1);
    expect(engine.getGraph().nodes[0]?.data.title).toBe('最终名称');
    act(() => { engine.undo(); });
    expect(engine.getGraph().nodes[0]?.data.title).toBe('原始名称');
  });

  it('将运行配置缺失交给宿主处理且不产生未捕获异常', async () => {
    const configurationError = new RuntimeConfigurationRequiredError('请配置视频模型', ['videoModel']);
    const engine = new CanvasEngine({
      runtime: {
        execute: async () => { throw configurationError; },
      },
    });
    const onRequired = vi.fn().mockResolvedValue(undefined);
    render(app(engine, { services: { configuration: { onRequired } } }));

    fireEvent.click(screen.getByRole('button', { name: '运行全部' }));
    await waitFor(() => expect(onRequired).toHaveBeenCalledWith(configurationError));
    expect(screen.getByText(/请先完成配置/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: '运行全部' })).toBeInTheDocument());
  });
});
