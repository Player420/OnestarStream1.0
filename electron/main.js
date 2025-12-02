// main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let serverProcess = null;

// Single source of truth for the port
const APP_PORT = process.env.APP_PORT || '3002';

function startLocalServer() {
  const isDev = !app.isPackaged;

  // In dev, point to the repo root where node_modules/next lives
  const projectRoot = isDev
    ? path.join(__dirname, '..')
    : path.join(process.resourcesPath, 'app');

  const serverScript = isDev
    ? path.join(projectRoot, 'node_modules', '.bin', 'next')
    : path.join(projectRoot, 'server.js'); // for packaged app later

  if (isDev) {
    // DEV: run Next in dev mode on APP_PORT
    serverProcess = spawn(serverScript, ['dev', '-p', APP_PORT], {
      cwd: projectRoot,
      shell: true,
      env: {
        ...process.env,
        PORT: APP_PORT,
      },
    });
  } else {
    // PROD: run your Node server.js using PORT
    serverProcess = spawn('node', [serverScript], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: APP_PORT,
      },
    });
  }

  serverProcess.stdout.on('data', (data) => {
    console.log('[App Server]', data.toString());
  });

  serverProcess.stderr.on('data', (data) => {
    console.error('[App Server ERROR]', data.toString());
  });

  serverProcess.on('close', () => {
    console.log('Local server stopped');
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    title: 'OnestarStream',
  });

  // In dev, we're running Next on localhost:APP_PORT
  win.loadURL(`http://localhost:${APP_PORT}`);
}

app.whenReady().then(() => {
  // 1) Start the Next dev server
  startLocalServer();

  // 2) Give the server a bit of time to boot before loading the URL
  //    (your logs show ~1.1s; 2s is a safe cushion)
  setTimeout(() => {
    createWindow();
  }, 2000);
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

