import { describe, expect, it, vi } from 'vitest';
import { AutosaveController, AutosaveFlushError, type AutosaveStatus } from '../src/autosave';
import { createEmptyGraph } from '../src/core/serialization';

describe('AutosaveController', () => {
  it('coalesces pending revisions and saves the newest graph', async () => {
    const saved: string[] = [];
    const controller = new AutosaveController({
      delay: 10_000,
      save: graph => { saved.push(graph.name); },
    });

    const first = createEmptyGraph('first');
    const second = createEmptyGraph('second');
    controller.schedule(first);
    controller.schedule(second);
    await controller.flush();

    expect(saved).toEqual(['second']);
    expect(controller.getStatus()).toMatchObject({ revision: 2, savedRevision: 2 });
    controller.destroy();
  });

  it('serialises asynchronous writes so revisions cannot complete out of order', async () => {
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    const started: number[] = [];
    const finished: number[] = [];
    const controller = new AutosaveController({
      delay: 10_000,
      save: async (_graph, context) => {
        started.push(context.revision);
        if (context.revision === 1) await firstPending;
        finished.push(context.revision);
      },
    });

    controller.schedule(createEmptyGraph('one'));
    const firstFlush = controller.flush();
    await vi.waitFor(() => expect(started).toEqual([1]));

    controller.schedule(createEmptyGraph('two'));
    const secondFlush = controller.flush();
    expect(started).toEqual([1]);
    releaseFirst();
    await Promise.all([firstFlush, secondFlush]);

    expect(started).toEqual([1, 2]);
    expect(finished).toEqual([1, 2]);
    expect(controller.getStatus()).toMatchObject({ revision: 2, savedRevision: 2 });
    controller.destroy();
  });

  it('reports rejected saves and makes an explicit flush fail', async () => {
    const statuses: AutosaveStatus[] = [];
    const onError = vi.fn();
    const controller = new AutosaveController({
      save: async () => { throw new Error('disk unavailable'); },
      onStatus: status => statuses.push(status),
      onError,
    });

    controller.schedule(createEmptyGraph('error'));
    await expect(controller.flush()).rejects.toMatchObject({
      name: 'AutosaveFlushError',
      code: 'AUTOSAVE_FLUSH_FAILED',
      status: { state: 'error', savedRevision: 0, revision: 1 },
    } satisfies Partial<AutosaveFlushError>);

    expect(onError).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toMatchObject({ state: 'error', error: 'disk unavailable' });
    expect(controller.getStatus()).toMatchObject({ state: 'error', error: 'disk unavailable' });
    controller.destroy();
  });

  it('retains a failed snapshot so an explicit second flush can retry it', async () => {
    let attempts = 0;
    const controller = new AutosaveController({
      save: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary outage');
      },
    });

    controller.schedule(createEmptyGraph('retry-me'));
    await expect(controller.flush()).rejects.toBeInstanceOf(AutosaveFlushError);
    await expect(controller.flush()).resolves.toMatchObject({
      state: 'saved', revision: 1, savedRevision: 1,
    });
    expect(attempts).toBe(2);
    controller.destroy();
  });

  it('never requeues an older failed snapshot behind a newer revision', async () => {
    let rejectFirst!: (error: Error) => void;
    const firstPending = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    const saved: string[] = [];
    const controller = new AutosaveController({
      delay: 60_000,
      save: async (graph, { revision }) => {
        saved.push(graph.name);
        if (revision === 1) await firstPending;
      },
    });

    controller.schedule(createEmptyGraph('one'));
    const firstFlush = controller.flush();
    await vi.waitFor(() => expect(saved).toEqual(['one']));
    controller.schedule(createEmptyGraph('two'));
    const secondFlush = controller.flush();
    rejectFirst(new Error('old revision failed'));

    await expect(firstFlush).rejects.toBeInstanceOf(AutosaveFlushError);
    await expect(secondFlush).resolves.toMatchObject({ revision: 2, savedRevision: 2 });
    await expect(controller.flush()).resolves.toMatchObject({ revision: 2, savedRevision: 2 });
    expect(saved).toEqual(['one', 'two']);
    controller.destroy();
  });

  it('does not let throwing host observers prevent or corrupt persistence', async () => {
    const saved: string[] = [];
    const observerErrors: string[] = [];
    const controller = new AutosaveController({
      delay: 60_000,
      save: graph => { saved.push(graph.name); },
      onStatus: () => { throw new Error('host status observer failed'); },
      onError: error => { observerErrors.push(error.message); },
    });

    controller.schedule(createEmptyGraph('still-saved'));
    await controller.flush();
    expect(saved).toEqual(['still-saved']);
    expect(controller.getStatus()).toMatchObject({ state: 'saved', revision: 1, savedRevision: 1 });
    expect(observerErrors).toContain('host status observer failed');
    controller.destroy();
  });

  it('does not emit a stale saved status after being destroyed mid-write', async () => {
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    const states: string[] = [];
    const controller = new AutosaveController({
      save: () => pending,
      onStatus: status => states.push(status.state),
    });
    controller.schedule(createEmptyGraph('destroyed'));
    const flushing = controller.flush();
    await vi.waitFor(() => expect(states).toContain('saving'));
    controller.destroy();
    release();
    await expect(flushing).rejects.toBeInstanceOf(AutosaveFlushError);
    expect(states.at(-1)).toBe('saving');
  });
});
