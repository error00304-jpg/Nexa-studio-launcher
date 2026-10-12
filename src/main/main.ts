import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { restoreSession } from './auth/authService';

const DEV_URL = process.env.NEXA_DEV === '1' ? 'http://localhost:5173' : null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0e1014',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  win.once('ready-to-show', () => win.show());

  // Sin ventanas nuevas: los enlaces externos https se abren en el navegador del sistema.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const internal = DEV_URL ? url.startsWith(DEV_URL) : url.startsWith('file://');
    if (!internal) event.preventDefault();
  });

  if (DEV_URL) void win.loadURL(DEV_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  void app.whenReady().then(async () => {
    await restoreSession();
    registerIpc(DEV_URL);
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}
