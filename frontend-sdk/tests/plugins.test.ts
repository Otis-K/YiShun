import { describe, expect, it, vi } from 'vitest';
import { PluginHost, type FlowCanvasPluginContext } from '../src/plugins';

const context = {} as FlowCanvasPluginContext;

describe('PluginHost', () => {
  it('installs each plugin once and disposes it explicitly', () => {
    const cleanup = vi.fn();
    const host = new PluginHost();
    const remove = host.use({ id: 'example', install: () => cleanup }, context);

    expect(host.has('example')).toBe(true);
    expect(host.list().map(plugin => plugin.id)).toEqual(['example']);
    expect(() => host.use({ id: 'example', install: () => undefined }, context)).toThrow(/already installed/);

    remove();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(host.has('example')).toBe(false);
  });

  it('disposes plugins in reverse installation order', () => {
    const calls: string[] = [];
    const host = new PluginHost();
    host.use({ id: 'first', install: () => () => calls.push('first') }, context);
    host.use({ id: 'second', install: () => ({ dispose: () => calls.push('second') }) }, context);

    host.destroy();
    expect(calls).toEqual(['second', 'first']);
  });

  it('continues reverse cleanup after a plugin throws and reports the aggregate', () => {
    const calls: string[] = [];
    const host = new PluginHost();
    host.use({ id: 'first', install: () => () => calls.push('first') }, context);
    host.use({ id: 'broken', install: () => () => { calls.push('broken'); throw new Error('cleanup failed'); } }, context);
    host.use({ id: 'last', install: () => () => calls.push('last') }, context);

    expect(() => host.destroy()).toThrow(AggregateError);
    expect(calls).toEqual(['last', 'broken', 'first']);
    expect(host.list()).toEqual([]);
  });
});
