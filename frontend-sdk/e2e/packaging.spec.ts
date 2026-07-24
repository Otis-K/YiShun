import path from 'node:path';
import { expect, test, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const electronMain = path.resolve('demo/standalone/electron-main.cjs');

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

async function closeElectron(application: ElectronApplication | undefined): Promise<void> {
  if (!application) return;
  const child = application.process();
  const close = application.close().then(() => true, () => true);
  if (await Promise.race([close, delay(8_000).then(() => false)])) return;

  // Electron/Playwright occasionally leaves the transport waiting even after
  // every renderer assertion and SDK destroy completed. Bound test cleanup so
  // it cannot consume the entire test timeout or leak the child process.
  if (child.exitCode === null && !child.killed) child.kill();
  await Promise.race([
    close,
    new Promise<void>(resolve => {
      if (child.exitCode !== null) resolve();
      else child.once('exit', () => resolve());
    }),
    delay(3_000),
  ]);
}

test('IIFE mounts, runs and destroys in a sandboxed Electron file renderer', async () => {
  let application: ElectronApplication | undefined;
  const errors: string[] = [];

  try {
    application = await electron.launch({
      args: [electronMain],
      env: { ...process.env, FLOWCANVAS_E2E: '1' },
      timeout: 30_000,
    });
    const page: Page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.waitForFunction(() => document.documentElement.dataset.flowcanvasReady !== undefined);
    await expect(page.locator('[data-testid="flowcanvas-sdk"]')).toHaveCount(1);
    await expect(page.locator('.fc-rail button')).toHaveCount(4);
    await expect(page.locator('.fc-brand, .fc-document')).toHaveCount(0);
    await expect(page.locator('[data-testid="rf__minimap"]')).toHaveCount(1);
    await expect(page.locator('.fc-canvas-tools')).toHaveCount(1);

    const renderer = await page.evaluate(() => {
      const target = window as typeof window & {
        FlowCanvas?: { FlowCanvasSDK?: unknown };
        flowCanvasStandalone: { destroy: () => void; getGraph: () => { nodes: unknown[] } };
        flowCanvasAcceptance?: { mounted: boolean; nodeCount: number; runStatus: string; protocol: string };
        electronHost?: { runtime: string; contextIsolated: boolean; sandboxed: boolean };
        require?: unknown;
        process?: unknown;
      };
      return {
        ready: document.documentElement.dataset.flowcanvasReady,
        apiType: typeof target.FlowCanvas?.FlowCanvasSDK,
        acceptance: target.flowCanvasAcceptance,
        electronHost: target.electronHost,
        requireType: typeof target.require,
        processType: typeof target.process,
        graphNodes: target.flowCanvasStandalone.getGraph().nodes.length,
      };
    });
    expect(renderer).toEqual({
      ready: 'true',
      apiType: 'function',
      acceptance: {
        mounted: true,
        nodeCount: 1,
        runStatus: 'success',
        protocol: 'file:',
      },
      electronHost: {
        runtime: 'electron',
        contextIsolated: true,
        sandboxed: true,
      },
      requireType: 'undefined',
      processType: 'undefined',
      graphNodes: 1,
    });

    const preferences = await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window) throw new Error('Electron acceptance window was not found.');
      return window.webContents.getLastWebPreferences();
    });
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.webSecurity).toBe(true);
    expect(preferences.allowRunningInsecureContent).toBe(false);

    await page.evaluate(() => {
      const target = window as typeof window & { flowCanvasStandalone: { destroy: () => void } };
      target.flowCanvasStandalone.destroy();
      document.documentElement.dataset.flowcanvasDestroyed = 'true';
    });
    await expect(page.locator('#app')).toBeEmpty();
    await expect(page.locator('html')).toHaveAttribute('data-flowcanvas-destroyed', 'true');
    expect(errors).toEqual([]);
  } finally {
    await closeElectron(application);
  }
});
