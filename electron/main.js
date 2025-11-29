const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let serverProcess = null;

function startLocalServer() {
  const isDev = !app.isPackaged;
  const projectRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : process.cwd();

  const serverScript = isDev
    ? path.join(projectRoot, 'node_modules', '.bin', 'next')
    : path.join(projectRoot, 'server.js');

  if (isDev) {
    serverProcess = spawn(serverScript, ['start', '-p', '3005'], {
      cwd: projectRoot,
      shell: true,
      env: {
        ...process.env,
        PORT: '3005'
      }
    });
  } else {
    // When packaged, Node server is already bundled as server.js:
    serverProcess = spawn('node', [serverScript], {
      cwd: projectRoot,
      env: {
        ...process.env,
        PORT: '3005'
      }
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
      preload: path.join(__dirname, 'preload.js')
    },
    title: "OnestarStream",
  });

  win.loadURL('http://localhost:3005');
}

app.whenReady().then(() => {
  startLocalServer();
  createWindow();
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
