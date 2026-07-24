'use strict';

const path = require('node:path');
const { app, BrowserWindow } = require('electron');

let mainWindow;

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1440,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'electron-preload.cjs'),
    },
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await mainWindow.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => app.quit());
