/**
 * launchElectron.js
 * 
 * Launches Electron in headless mode with Chrome DevTools Protocol enabled
 * Returns CDP client for test automation
 * 
 * PATCHED VERSION - Phase 23 Task 7
 */

import { spawn, execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../../..');

/**
 * Kill any process using the given port
 */
function killPortProcess(port) {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore' });
  } catch (err) {
    // Port already free
  }
}

/**
 * Launch Electron with TEST_MODE enabled and CDP debugging
 * 
 * @param {Object} options
 * @param {number} options.debugPort - Chrome DevTools Protocol port (default: 9222)
 * @param {boolean} options.headless - Run in headless mode (default: true)
 * @param {number} options.timeout - Startup timeout in ms (default: 30000)
 * @returns {Promise<{electronProcess, cdpClient, close}>}
 */
export async function launchElectron(options = {}) {
  const {
    debugPort = 9222,
    headless = true,
    timeout = 30000,
  } = options;

  console.log('[LaunchElectron] Starting Electron with TEST_MODE=true');

  // Clean up any existing process on CDP port
  console.log(`[LaunchElectron] Cleaning up port ${debugPort}...`);
  killPortProcess(debugPort);
  await new Promise(resolve => setTimeout(resolve, 500));

  // Electron executable path
  const electronPath = join(projectRoot, 'node_modules/.bin/electron');
  const mainPath = join(projectRoot, 'electron/dist/main.js');

  // Environment variables
  const env = {
    ...process.env,
    TEST_MODE: 'true',
    NODE_ENV: 'test',
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    ONESTAR_APP_URL: 'http://localhost:3000',
  };

  // Launch arguments
  const args = [
    mainPath,
    `--remote-debugging-port=${debugPort}`,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
  ];

  if (headless) {
    args.push('--headless=new');
  }

  // Spawn Electron process
  const electronProcess = spawn(electronPath, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: projectRoot,
  });

  // Log Electron output
  electronProcess.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.log(`[Electron] ${output}`);
    }
  });

  electronProcess.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output && !output.includes('DevTools') && !output.includes('ALSA')) {
      console.error(`[Electron Error] ${output}`);
    }
  });

  // Wait for Electron to be ready
  await new Promise((resolve, reject) => {
    const startTime = Date.now();
    let resolved = false;

    const checkInterval = setInterval(() => {
      if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        if (!resolved) {
          electronProcess.kill();
          reject(new Error('Electron startup timeout'));
        }
      }
    }, 100);

    electronProcess.stdout.on('data', (data) => {
      const output = data.toString();
      if (output.includes('Window loaded') || output.includes('App ready')) {
        if (!resolved) {
          resolved = true;
          clearInterval(checkInterval);
          resolve();
        }
      }
    });

    electronProcess.on('error', (error) => {
      if (!resolved) {
        resolved = true;
        clearInterval(checkInterval);
        reject(error);
      }
    });

    electronProcess.on('exit', (code) => {
      if (code !== 0 && code !== null && !resolved) {
        resolved = true;
        clearInterval(checkInterval);
        reject(new Error(`Electron exited with code ${code}`));
      }
    });

    // Fallback: resolve after 3 seconds if no logs detected
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        clearInterval(checkInterval);
        console.warn('[LaunchElectron] No startup message, proceeding anyway');
        resolve();
      }
    }, 3000);
  });

  console.log('[LaunchElectron] Electron process started, connecting CDP...');

  // Connect to Chrome DevTools Protocol (dynamic import for ESM compatibility)
  const CDP = (await import('chrome-remote-interface')).default;
  let cdpClient;
  let connectAttempts = 0;
  const maxAttempts = 30;

  while (connectAttempts < maxAttempts) {
    try {
      cdpClient = await CDP({ port: debugPort });
      console.log('[LaunchElectron] CDP connected successfully');
      break;
    } catch (error) {
      connectAttempts++;
      if (connectAttempts >= maxAttempts) {
        electronProcess.kill();
        throw new Error(`Failed to connect to CDP after ${maxAttempts} attempts: ${error.message}`);
      }
      // Exponential backoff
      await new Promise(resolve => setTimeout(resolve, 100 + connectAttempts * 10));
    }
  }

  // Enable CDP domains
  const { Page, Runtime, Network } = cdpClient;
  await Promise.all([
    Page.enable(),
    Runtime.enable(),
    Network.enable(),
  ]);

  console.log('[LaunchElectron] CDP domains enabled');

  // Wait for page to be interactive
  try {
    await Runtime.evaluate({ expression: '1+1', returnByValue: true });
    console.log('[LaunchElectron] Runtime ready');
  } catch (err) {
    console.warn('[LaunchElectron] Runtime check failed:', err.message);
  }

  // Close function
  const close = async () => {
    console.log('[LaunchElectron] Closing Electron...');
    try {
      await cdpClient.close();
    } catch (err) {
      console.error('[LaunchElectron] Error closing CDP:', err.message);
    }
    
    electronProcess.kill('SIGTERM');
    
    // Wait for graceful shutdown
    await new Promise((resolve) => {
      const killTimeout = setTimeout(() => {
        console.warn('[LaunchElectron] Force killing Electron');
        try {
          electronProcess.kill('SIGKILL');
        } catch (err) {
          // Already dead
        }
        resolve();
      }, 5000);
      
      electronProcess.on('exit', () => {
        clearTimeout(killTimeout);
        resolve();
      });
    });

    console.log('[LaunchElectron] Electron closed');
  };

  return { electronProcess, cdpClient, close };
}
