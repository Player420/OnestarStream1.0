// electron/main.ts

import { app, BrowserWindow } from 'electron';
import path from 'path';

// Disable GPU to avoid noisy EGL driver errors on some systems.
// For your current UI, this has no practical downside.
app.disableHardwareAcceleration();

// Single source of truth for the app URL.
// In dev:  ONESTAR_APP_URL=http://137.184.46.163:3002 npm run dev:electron
// Fallback: http://localhost:3002
const APP_URL = process.env.ONESTAR_APP_URL || 'http://localhost:3000';

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    title: 'OnestarStream',
    webPreferences: {
      // When compiled, main.js and preload.js live together in electron/dist
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  console.log('[Electron] Loading app URL:', APP_URL);
  win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();

  // On macOS it’s common to recreate a window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, apps generally stay open until Cmd+Q
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

