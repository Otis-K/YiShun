/**
 * Standalone browser entry.
 *
 * Vite wraps these named exports as `window.FlowCanvas` for the IIFE build.
 * The npm ESM/CJS entry remains separate so Electron bundlers can externalize
 * React while a file:// renderer can load this dependency-complete artifact.
 */
export * from './index.js';
