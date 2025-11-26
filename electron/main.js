const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let nextProcess;
const PORT = process.env.PORT || 3002;
const isDev = !app.isPackaged;

function waitForServer(url, timeoutMs = 30000, intervalMs = 1000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    function check() {
      const req = http.get(url, (res) => {
        // Any HTTP response means the server is up
        res.resume();
        resolve();
      });

      req.on('error', () => {
        if (Date.now() - start >= timeoutMs) {
          reject(new Error(`Server did not start at ${url} within ${timeoutMs}ms`));
        } else {
          setTimeout(check, intervalMs);
        }
      });
    }

    check();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.loadURL(`http://localhost:${PORT}/`);
}

function startNextServer() {
  if (isDev) {
    // In dev, you can just run `npm run dev` in a terminal and Electron will connect to it.
    console.log('[electron] Dev mode – expecting Next dev server on port', PORT);
    return;
  }

  const projectRoot = path.join(__dirname, '..');
  const nextBin = path.join(
    projectRoot,
    'node_modules',
    'next',
    'dist',
    'bin',
    'next'
  );

  console.log('[electron] Starting Next.js production server...');
  nextProcess = spawn(
    process.execPath,
    [nextBin, 'start', '--port', String(PORT)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    }
  );

  nextProcess.stdout.on('data', (data) => {
    console.log('[next]', data.toString());
  });

  nextProcess.stderr.on('data', (data) => {
    console.error('[next]', data.toString());
  });

  nextProcess.on('exit', (code, signal) => {
    console.log('[next] exited', { code, signal });
  });
}

async function boot() {
  startNextServer();

  try {
    console.log('[electron] Waiting for http://localhost:' + PORT);
    await waitForServer(`http://localhost:${PORT}/`, 60000, 1000);
    console.log('[electron] Next.js is up, creating window');
    createWindow();
  } catch (err) {
    console.error('[electron] Failed to connect to Next server:', err);
    // You could show an error window here if you want
  }
}

app.whenReady().then(() => {
  boot();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('quit', () => {
  if (nextProcess) {
    nextProcess.kill();
  }
});
