import type { CanvasEngine } from './core/engine';
import type { FlowCanvasSDK } from './sdk';

export interface FlowCanvasPluginContext {
  sdk: FlowCanvasSDK;
  engine: CanvasEngine;
}

export type PluginCleanup = void | (() => void) | { dispose: () => void };

export interface FlowCanvasPlugin {
  /** Stable identifier used to prevent installing a plugin twice. */
  id: string;
  version?: string;
  install: (context: FlowCanvasPluginContext) => PluginCleanup;
}

const cleanupPlugin = (cleanup: PluginCleanup): void => {
  if (typeof cleanup === 'function') cleanup();
  else cleanup?.dispose();
};

export class PluginHost {
  private readonly installed = new Map<string, { plugin: FlowCanvasPlugin; cleanup: PluginCleanup }>();

  use(plugin: FlowCanvasPlugin, context: FlowCanvasPluginContext): () => void {
    if (!plugin.id.trim()) throw new Error('FlowCanvas plugin id is required.');
    if (this.installed.has(plugin.id)) throw new Error(`FlowCanvas plugin "${plugin.id}" is already installed.`);

    const cleanup = plugin.install(context);
    this.installed.set(plugin.id, { plugin, cleanup });
    return () => this.unuse(plugin.id);
  }

  unuse(id: string): boolean {
    const entry = this.installed.get(id);
    if (!entry) return false;
    this.installed.delete(id);
    cleanupPlugin(entry.cleanup);
    return true;
  }

  has(id: string): boolean {
    return this.installed.has(id);
  }

  list(): FlowCanvasPlugin[] {
    return [...this.installed.values()].map(entry => entry.plugin);
  }

  destroy(): void {
    const errors: unknown[] = [];
    for (const id of [...this.installed.keys()].reverse()) {
      try {
        this.unuse(id);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'One or more FlowCanvas plugin cleanups failed.');
  }
}
