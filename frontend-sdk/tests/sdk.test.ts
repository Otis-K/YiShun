import { describe, expect, it, vi } from 'vitest';
import { FlowCanvasSDK } from '../src/sdk';
import type { FlowCanvasPlugin } from '../src/plugins';
import type { FlowCanvasInspectorRenderer, FlowCanvasNodeRenderer } from '../src/react/extensions';

describe('FlowCanvasSDK public lifecycle', () => {
  it('installs and disposes plugins with their registered node types', () => {
    const cleanup = vi.fn();
    const plugin: FlowCanvasPlugin = {
      id: 'custom-node-plugin',
      install: ({ sdk }) => {
        const unregister = sdk.registerNodeType({
          type: 'custom.echo',
          title: 'Echo',
          category: 'Test',
          inputs: [],
          outputs: [{ id: 'value', label: 'Value', dataType: 'text' }],
          createData: () => ({ title: 'Echo' }),
          execute: () => ({ value: 'ok' }),
        });
        return () => {
          unregister();
          cleanup();
        };
      },
    };
    const sdk = new FlowCanvasSDK({ includeBuiltinNodes: false, plugins: [plugin] });

    expect(sdk.engine.registry.has('custom.echo')).toBe(true);
    expect(sdk.unuse(plugin.id)).toBe(true);
    expect(sdk.engine.registry.has('custom.echo')).toBe(false);
    expect(cleanup).toHaveBeenCalledOnce();
    sdk.destroy();
  });

  it('enforces read-only mode through the public mutation API', () => {
    const sdk = new FlowCanvasSDK({ readOnly: true, includeBuiltinNodes: true });
    expect(sdk.isReadOnly()).toBe(true);
    expect(() => sdk.addNode('prompt', { x: 0, y: 0 })).toThrow(/read.?only|只读/i);

    sdk.setReadOnly(false);
    expect(sdk.addNode('prompt', { x: 0, y: 0 }).type).toBe('prompt');
    sdk.destroy();
  });

  it('flushes autosave and rejects API use after destroy', async () => {
    const saved: number[] = [];
    const sdk = new FlowCanvasSDK({
      includeBuiltinNodes: true,
      autosaveDelay: 60_000,
      autosave: graph => { saved.push(graph.nodes.length); },
    });
    sdk.addNode('prompt', { x: 10, y: 20 });
    await sdk.flushAutosave();
    expect(saved).toEqual([1]);

    sdk.destroy();
    expect(() => sdk.getGraph()).toThrow(/destroyed/);
  });

  it('keeps layered custom renderers correct when disposers run out of order', () => {
    const baseNode: FlowCanvasNodeRenderer = () => null;
    const firstNode: FlowCanvasNodeRenderer = () => null;
    const secondNode: FlowCanvasNodeRenderer = () => null;
    const baseInspector: FlowCanvasInspectorRenderer = () => null;
    const firstInspector: FlowCanvasInspectorRenderer = () => null;
    const secondInspector: FlowCanvasInspectorRenderer = () => null;
    const sdk = new FlowCanvasSDK({
      includeBuiltinNodes: false,
      renderers: { nodes: { custom: baseNode }, inspectors: { custom: baseInspector } },
    });
    const internals = sdk as unknown as {
      renderers: {
        nodes: Record<string, FlowCanvasNodeRenderer>;
        inspectors: Record<string, FlowCanvasInspectorRenderer>;
      };
    };

    const disposeFirstNode = sdk.registerNodeRenderer('custom', firstNode);
    const disposeSecondNode = sdk.registerNodeRenderer('custom', secondNode);
    const disposeFirstInspector = sdk.registerInspectorRenderer('custom', firstInspector);
    const disposeSecondInspector = sdk.registerInspectorRenderer('custom', secondInspector);
    expect(internals.renderers.nodes.custom).toBe(secondNode);
    expect(internals.renderers.inspectors.custom).toBe(secondInspector);

    disposeFirstNode();
    disposeFirstInspector();
    expect(internals.renderers.nodes.custom).toBe(secondNode);
    expect(internals.renderers.inspectors.custom).toBe(secondInspector);

    disposeSecondNode();
    disposeSecondInspector();
    expect(internals.renderers.nodes.custom).toBe(baseNode);
    expect(internals.renderers.inspectors.custom).toBe(baseInspector);
    sdk.destroy();
  });

  it('registers and restores renderers for prototype-shaped node types', () => {
    const baseNode: FlowCanvasNodeRenderer = () => null;
    const overrideNode: FlowCanvasNodeRenderer = () => null;
    const baseInspector: FlowCanvasInspectorRenderer = () => null;
    const overrideInspector: FlowCanvasInspectorRenderer = () => null;
    const sdk = new FlowCanvasSDK({
      renderers: {
        nodes: Object.fromEntries([['__proto__', baseNode]]),
        inspectors: Object.fromEntries([['__proto__', baseInspector]]),
      },
    });
    const internals = sdk as unknown as {
      renderers: {
        nodes: Record<string, FlowCanvasNodeRenderer>;
        inspectors: Record<string, FlowCanvasInspectorRenderer>;
      };
    };

    const disposeNode = sdk.registerNodeRenderer('__proto__', overrideNode);
    const disposeInspector = sdk.registerInspectorRenderer('__proto__', overrideInspector);
    expect(Object.hasOwn(internals.renderers.nodes, '__proto__')).toBe(true);
    expect(internals.renderers.nodes.__proto__).toBe(overrideNode);
    expect(internals.renderers.inspectors.__proto__).toBe(overrideInspector);
    disposeNode();
    disposeInspector();
    expect(internals.renderers.nodes.__proto__).toBe(baseNode);
    expect(internals.renderers.inspectors.__proto__).toBe(baseInspector);
    sdk.destroy();
  });

  it('always finishes core destruction even when a plugin cleanup throws', () => {
    const sdk = new FlowCanvasSDK({
      plugins: [{ id: 'broken-cleanup', install: () => () => { throw new Error('plugin cleanup failed'); } }],
    });
    expect(() => sdk.destroy()).toThrow(AggregateError);
    expect(() => sdk.getGraph()).toThrow(/destroyed/i);
    expect(() => sdk.destroy()).not.toThrow();
  });

  it('keeps internal autosave status/events running when the host status observer throws', async () => {
    const statuses: string[] = [];
    const errors: string[] = [];
    const sdk = new FlowCanvasSDK({
      includeBuiltinNodes: true,
      autosaveDelay: 60_000,
      autosave: () => undefined,
      onAutosaveStatus: () => { throw new Error('host observer failed'); },
    });
    sdk.on('autosave:status', status => statuses.push(status.state));
    sdk.on('error', event => errors.push(event.source));
    sdk.addNode('prompt', { x: 0, y: 0 });
    await sdk.flushAutosave();
    expect(statuses).toContain('saved');
    expect(errors).toContain('autosave:status-observer');
    sdk.destroy();
  });

  it('rolls back earlier plugins and destroys the partial instance when construction fails', () => {
    const cleaned = vi.fn();
    let leaked: FlowCanvasSDK | undefined;
    expect(() => new FlowCanvasSDK({
      plugins: [
        { id: 'first', install: ({ sdk }) => { leaked = sdk; return cleaned; } },
        { id: 'broken', install: () => { throw new Error('install failed'); } },
      ],
    })).toThrow('install failed');
    expect(cleaned).toHaveBeenCalledOnce();
    expect(() => leaked?.getGraph()).toThrow(/destroyed/i);

    expect(() => new FlowCanvasSDK({
      container: '#definitely-missing-flowcanvas-target',
      plugins: [{ id: 'before-mount', install: () => cleaned }],
    })).toThrow(/mount target/i);
    expect(cleaned).toHaveBeenCalledTimes(2);
  });
});
