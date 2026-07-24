const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('toolplusCanvas', Object.freeze({}));
