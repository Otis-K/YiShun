'use strict';

const { contextBridge } = require('electron');

const security = Object.freeze({
  runtime: 'electron',
  contextIsolated: process.contextIsolated === true,
  sandboxed: process.sandboxed === true,
});

// Expose only immutable diagnostics used by the example and acceptance test.
// The SDK itself needs no Node, Electron or IPC privileges in the renderer.
contextBridge.exposeInMainWorld('electronHost', security);
