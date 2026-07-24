import { createRoot, type Root } from 'react-dom/client';
import { AutosaveController, type AutosaveHandler, type AutosaveStatus } from './autosave';
import type { CanvasEngineOptions, EdgeInput } from './core/engine';
import { CanvasEngine } from './core/engine';
import type {
  CanvasNode,
  CanvasNodeData,
  CanvasEdge,
  EngineEventMap,
  EngineEventName,
  GraphDocument,
  NodeDefinition,
  RuntimeOptions,
  ValidationResult,
  WorkflowRunResult,
} from './core/types';
import { builtinNodeDefinitions } from './builtins';
import { PluginHost, type FlowCanvasPlugin } from './plugins';
import { FlowCanvasApp } from './react/FlowCanvasApp';
import type {
  FlowCanvasInspectorRenderer,
  FlowCanvasNodeRenderer,
  FlowCanvasRenderers,
} from './react/extensions';
import type { WorkflowRuntime } from './runtime/local-runtime';
import type { GraphMigrationRegistry } from './core/serialization';
import type { FlowCanvasServices, SaveState } from './services';

export interface FlowCanvasSDKOptions {
  container?: HTMLElement | string;
  graph?: GraphDocument;
  /** Optional instance-local graph migration registry used for construction and imports. */
  migrations?: GraphMigrationRegistry;
  nodeTypes?: NodeDefinition[];
  /** Register deterministic demo-only nodes. Defaults to false; production hosts provide real definitions/runtime. */
  includeBuiltinNodes?: boolean;
  runtime?: WorkflowRuntime;
  theme?: 'dark' | 'light';
  readOnly?: boolean;
  historyLimit?: number;
  autosave?: AutosaveHandler;
  autosaveDelay?: number;
  onAutosaveStatus?: (status: AutosaveStatus) => void;
  services?: FlowCanvasServices;
  renderers?: FlowCanvasRenderers;
  plugins?: FlowCanvasPlugin[];
}

const toSaveState = (status: AutosaveStatus): SaveState => ({
  status: status.state === 'pending' || status.state === 'saving'
    ? 'saving'
    : status.state === 'error'
      ? 'error'
      : status.state === 'saved'
        ? 'saved'
        : 'idle',
  message: status.state === 'pending'
    ? '等待保存'
    : status.state === 'saving'
      ? '正在保存'
      : status.state === 'saved'
        ? '已保存'
        : status.error,
});

const safeRendererRecord = <T,>(source?: Record<string, T>): Record<string, T> => (
  Object.assign(Object.create(null) as Record<string, T>, source ?? {})
);

const ownRenderer = <T,>(record: Record<string, T>, type: string): T | undefined => (
  Object.prototype.hasOwnProperty.call(record, type) ? record[type] : undefined
);

export class FlowCanvasSDK {
  readonly engine: CanvasEngine;

  private root?: Root;
  private container?: HTMLElement;
  private theme: 'dark' | 'light';
  private readOnly: boolean;
  private services: FlowCanvasServices;
  private renderers: FlowCanvasRenderers;
  private readonly baseNodeRenderers: Record<string, FlowCanvasNodeRenderer>;
  private readonly baseInspectorRenderers: Record<string, FlowCanvasInspectorRenderer>;
  private readonly nodeRendererLayers = new Map<string, Array<{ token: symbol; renderer: FlowCanvasNodeRenderer }>>();
  private readonly inspectorRendererLayers = new Map<string, Array<{ token: symbol; renderer: FlowCanvasInspectorRenderer }>>();
  private saveState?: SaveState;
  private readonly plugins = new PluginHost();
  private readonly autosave?: AutosaveController;
  private readonly disposeAutosave?: () => void;
  private destroyed = false;

  constructor(options: FlowCanvasSDKOptions = {}) {
    const engineOptions: CanvasEngineOptions = {
      graph: options.graph,
      migrations: options.migrations,
      historyLimit: options.historyLimit,
      runtime: options.runtime,
      readOnly: options.readOnly,
    };
    this.engine = new CanvasEngine(engineOptions);
    this.theme = options.theme ?? 'dark';
    this.readOnly = options.readOnly ?? false;
    this.services = { ...options.services };
    this.baseNodeRenderers = Object.freeze(safeRendererRecord(options.renderers?.nodes));
    this.baseInspectorRenderers = Object.freeze(safeRendererRecord(options.renderers?.inspectors));
    this.renderers = {
      nodes: safeRendererRecord(this.baseNodeRenderers),
      inspectors: safeRendererRecord(this.baseInspectorRenderers),
    };

    const definitions = [
      ...(options.includeBuiltinNodes === true ? builtinNodeDefinitions : []),
      ...(options.nodeTypes ?? []),
    ];
    for (const definition of definitions) {
      if (this.engine.registry.has(definition.type)) this.engine.registry.replace(definition);
      else this.engine.registerNodeType(definition);
    }

    if (options.autosave) {
      this.saveState = { status: 'idle', message: '等待更改' };
      this.autosave = new AutosaveController({
        save: options.autosave,
        delay: options.autosaveDelay,
        onStatus: status => {
          this.saveState = toSaveState(status);
          try {
            options.onAutosaveStatus?.(status);
          } catch (cause) {
            const error = cause instanceof Error ? cause : new Error(String(cause));
            this.engine.events.emit('error', { error, source: 'autosave:status-observer' });
          }
          this.engine.events.emit('autosave:status', status);
          this.render();
        },
        onError: error => this.engine.events.emit('error', { error, source: 'autosave' }),
      });
      this.disposeAutosave = this.engine.on('graph:change', ({ graph }) => this.autosave?.schedule(graph));
    }

    try {
      for (const plugin of options.plugins ?? []) this.use(plugin);
      if (options.container) this.mount(options.container);
    } catch (cause) {
      try {
        this.destroy();
      } catch (cleanupError) {
        throw new AggregateError(
          [cause, cleanupError],
          'FlowCanvasSDK construction failed and cleanup also reported errors.',
        );
      }
      throw cause;
    }
  }

  mount(target: HTMLElement | string): this {
    this.assertAlive();
    const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
    if (!element) throw new Error(`FlowCanvas mount target was not found: ${String(target)}`);
    this.unmount();
    this.container = element;
    this.root = createRoot(element);
    this.render();
    return this;
  }

  unmount(): void {
    this.root?.unmount();
    this.root = undefined;
    this.container = undefined;
  }

  destroy(): void {
    if (this.destroyed) return;
    const errors: unknown[] = [];
    const safely = (cleanup: () => void) => {
      try { cleanup(); } catch (error) { errors.push(error); }
    };
    safely(() => this.plugins.destroy());
    safely(() => this.disposeAutosave?.());
    safely(() => this.autosave?.destroy());
    safely(() => this.unmount());
    safely(() => this.engine.destroy());
    this.destroyed = true;
    if (errors.length) throw new AggregateError(errors, 'FlowCanvasSDK was destroyed, but cleanup errors occurred.');
  }

  async flushAutosave(): Promise<AutosaveStatus | undefined> {
    this.assertAlive();
    return this.autosave?.flush();
  }

  getAutosaveStatus(): AutosaveStatus | undefined {
    this.assertAlive();
    return this.autosave?.getStatus();
  }

  import(input: string | GraphDocument): void {
    this.assertAlive();
    this.engine.importGraph(input);
  }

  export(space = 2): string {
    this.assertAlive();
    return this.engine.exportGraph(space);
  }

  getGraph(): GraphDocument {
    this.assertAlive();
    return this.engine.getGraph();
  }

  validate(): ValidationResult {
    this.assertAlive();
    return this.engine.validate();
  }

  run(options?: RuntimeOptions): Promise<WorkflowRunResult> {
    this.assertAlive();
    return this.engine.run(options);
  }

  runNode(nodeId: string, options?: RuntimeOptions): Promise<WorkflowRunResult> {
    this.assertAlive();
    return this.engine.runNode(nodeId, options);
  }

  cancel(): void {
    this.engine.cancel();
  }

  undo(): boolean {
    this.assertAlive();
    return this.engine.undo();
  }

  redo(): boolean {
    this.assertAlive();
    return this.engine.redo();
  }

  addNode(type: string, position: { x: number; y: number }, data?: Partial<CanvasNodeData>): CanvasNode {
    this.assertAlive();
    return this.engine.addNode(type, position, data);
  }

  addEdge(edge: EdgeInput): CanvasEdge {
    this.assertAlive();
    return this.engine.addEdge(edge);
  }

  registerNodeType<TData extends CanvasNodeData>(definition: NodeDefinition<TData>): () => void {
    this.assertAlive();
    return this.engine.registerNodeType(definition);
  }

  registerNodeRenderer(type: string, renderer: FlowCanvasNodeRenderer): () => void {
    this.assertAlive();
    const token = Symbol(type);
    const layers = this.nodeRendererLayers.get(type) ?? [];
    layers.push({ token, renderer });
    this.nodeRendererLayers.set(type, layers);
    this.refreshNodeRenderer(type);
    this.render();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const current = this.nodeRendererLayers.get(type);
      if (!current) return;
      const index = current.findIndex(entry => entry.token === token);
      if (index === -1) return;
      current.splice(index, 1);
      if (!current.length) this.nodeRendererLayers.delete(type);
      this.refreshNodeRenderer(type);
      this.render();
    };
  }

  registerInspectorRenderer(type: string, renderer: FlowCanvasInspectorRenderer): () => void {
    this.assertAlive();
    const token = Symbol(type);
    const layers = this.inspectorRendererLayers.get(type) ?? [];
    layers.push({ token, renderer });
    this.inspectorRendererLayers.set(type, layers);
    this.refreshInspectorRenderer(type);
    this.render();
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      const current = this.inspectorRendererLayers.get(type);
      if (!current) return;
      const index = current.findIndex(entry => entry.token === token);
      if (index === -1) return;
      current.splice(index, 1);
      if (!current.length) this.inspectorRendererLayers.delete(type);
      this.refreshInspectorRenderer(type);
      this.render();
    };
  }

  setServices(services: FlowCanvasServices): void {
    this.assertAlive();
    this.services = { ...services };
    this.render();
  }

  getServices(): Readonly<FlowCanvasServices> {
    return this.services;
  }

  use(plugin: FlowCanvasPlugin): () => void {
    this.assertAlive();
    return this.plugins.use(plugin, { sdk: this, engine: this.engine });
  }

  unuse(pluginId: string): boolean {
    this.assertAlive();
    return this.plugins.unuse(pluginId);
  }

  setTheme(theme: 'dark' | 'light'): void {
    this.assertAlive();
    this.theme = theme;
    this.render();
  }

  getTheme(): 'dark' | 'light' {
    return this.theme;
  }

  setReadOnly(readOnly: boolean): void {
    this.assertAlive();
    this.readOnly = readOnly;
    this.engine.setReadOnly(readOnly);
    this.render();
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  on<K extends EngineEventName>(event: K, listener: (payload: EngineEventMap[K]) => void): () => void {
    this.assertAlive();
    return this.engine.on(event, listener);
  }

  private render(): void {
    this.root?.render(
      <FlowCanvasApp
        engine={this.engine}
        theme={this.theme}
        readOnly={this.readOnly}
        renderers={this.renderers}
        services={this.services}
        saveState={this.saveState}
        onThemeChange={theme => this.setTheme(theme)}
      />,
    );
  }

  private refreshNodeRenderer(type: string): void {
    const nodes = safeRendererRecord(this.renderers.nodes);
    const layers = this.nodeRendererLayers.get(type);
    const active = layers?.[layers.length - 1]?.renderer ?? ownRenderer(this.baseNodeRenderers, type);
    if (active) Object.defineProperty(nodes, type, {
      value: active, enumerable: true, configurable: true, writable: true,
    });
    else delete nodes[type];
    this.renderers = { ...this.renderers, nodes };
  }

  private refreshInspectorRenderer(type: string): void {
    const inspectors = safeRendererRecord(this.renderers.inspectors);
    const layers = this.inspectorRendererLayers.get(type);
    const active = layers?.[layers.length - 1]?.renderer ?? ownRenderer(this.baseInspectorRenderers, type);
    if (active) Object.defineProperty(inspectors, type, {
      value: active, enumerable: true, configurable: true, writable: true,
    });
    else delete inspectors[type];
    this.renderers = { ...this.renderers, inspectors };
  }

  private assertAlive(): void {
    if (this.destroyed) throw new Error('FlowCanvasSDK instance has been destroyed.');
  }
}
