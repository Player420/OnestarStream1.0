/**
 * buildApp.js
 * 
 * Build Next.js and Electron before running E2E tests
 */

import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '../../..');

/**
 * Run a command and return a promise
 * 
 * @param {string} command - Command to run
 * @param {string[]} args - Command arguments
 * @param {string} cwd - Working directory
 * @returns {Promise<void>}
 */
function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`[Build] Running: ${command} ${args.join(' ')}`);
    
    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: true,
    });

    proc.on('error', reject);
    proc.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

/**
 * Build Next.js app
 * 
 * @returns {Promise<void>}
 */
export async function buildNextJs() {
  console.log('[Build] Building Next.js application...');
  try {
    await runCommand('npm', ['run', 'build'], projectRoot);
    console.log('[Build] Next.js build complete');
  } catch (error) {
    console.error('[Build] Next.js build failed:', error.message);
    throw error;
  }
}

/**
 * Build Electron app
 * 
 * @returns {Promise<void>}
 */
export async function buildElectron() {
  console.log('[Build] Building Electron application...');
  try {
    await runCommand('npx', ['tsc'], join(projectRoot, 'electron'));
    console.log('[Build] Electron build complete');
  } catch (error) {
    console.error('[Build] Electron build failed:', error.message);
    throw error;
  }
}

/**
 * Build both Next.js and Electron
 * 
 * @param {Object} options
 * @param {boolean} options.skipNextJs - Skip Next.js build (default: false)
 * @param {boolean} options.skipElectron - Skip Electron build (default: false)
 * @returns {Promise<void>}
 */
export async function buildAll(options = {}) {
  const {
    skipNextJs = false,
    skipElectron = false,
  } = options;

  try {
    if (!skipNextJs) {
      await buildNextJs();
    }

    if (!skipElectron) {
      await buildElectron();
    }

    console.log('[Build] All builds complete');
  } catch (error) {
    console.error('[Build] Build process failed');
    throw error;
  }
}
