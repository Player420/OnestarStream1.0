/**
 * syncScheduler.ts
 * 
 * Phase 23: Background Sync Scheduler
 * 
 * Automatically checks sync status every 6 hours and emits events
 * when sync is needed. Integrates with vault unlock state and
 * keypair rotation lifecycle.
 * 
 * Features:
 * - Starts on app boot, vault unlock, rotation complete, export/import finish
 * - Runs every 6 hours (configurable)
 * - Emits 'sync:status-change' event when needsSync=true
 * - Safety: prevents overlapping runs, timeout protection, vault-aware
 * - Never auto-imports (that's Phase 24)
 * 
 * Architecture:
 * - Main process scheduler (Electron)
 * - Uses callback-based architecture (no direct src/ imports)
 * - Emits IPC events to renderer
 * - No UI dialogs, no data modification
 */

import { BrowserWindow } from 'electron';

// ===========================
// TYPES
// ===========================

/**
 * Sync health report from Phase 21
 */
export interface SyncHealthReport {
  needsSync: boolean;
  lastSyncedAt: number;
  daysSinceLastSync: number;
  deviceCount: number;
  alignment: {
    aligned: boolean;
    currentKeypairPublicKey: string;
    devicesInSync: string[];
    devicesOutOfSync: string[];
    missingRotations: number;
    staleDays: number;
  };
  warnings: Array<{
    severity: 'critical' | 'warning' | 'info';
    message: string;
    deviceId?: string;
    deviceName?: string;
    daysSinceSync?: number;
    missingRotations?: number;
    recommendedAction?: string;
  }>;
  recommendation: {
    action: 'export' | 'import' | 'no-action-needed';
    reason: string;
    sourceDevice?: string;
    targetDevice?: string;
    priority: 'high' | 'medium' | 'low';
    details?: string;
  };
}

/**
 * Status check callback
 * 
 * Should return sync health report from Phase 21 keystoreSyncStatus module
 */
export type StatusCheckCallback = () => Promise<SyncHealthReport>;

/**
 * Vault unlock check callback
 * 
 * Should return true if persistent keypair is unlocked
 */
export type VaultUnlockCheckCallback = () => boolean;

// ===========================
// CONSTANTS
// ===========================

/** Initial delay: 60 seconds after app boot (1 second in TEST_MODE) */
const INITIAL_DELAY_MS = process.env.TEST_MODE === 'true' ? 1000 : 60 * 1000;

/** Regular interval: 6 hours */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Timeout for each scheduler run: 10 seconds */
const RUN_TIMEOUT_MS = 10 * 1000; // 10 seconds

/** Log prefix for all scheduler messages */
const LOG_PREFIX = '[SyncScheduler]';

// ===========================
// STATE
// ===========================

let isRunning = false;
let initialTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let nextRunTime: number | null = null;
let mainWindow: BrowserWindow | null = null;

/** Callback to check if vault is unlocked (injected by main.ts) */
let vaultUnlockCheck: VaultUnlockCheckCallback | null = null;

/** Callback to get sync health report (injected by main.ts) */
let statusCheckCallback: StatusCheckCallback | null = null;

// ===========================
// CORE FUNCTIONS
// ===========================

/**
 * Initialize scheduler with reference to main window and callbacks
 * 
 * @param window - Main BrowserWindow for IPC communication
 * @param callbacks - Callbacks for vault unlock check and status retrieval
 */
export function initialize(
  window: BrowserWindow,
  callbacks: {
    vaultUnlockCheck: VaultUnlockCheckCallback;
    statusCheck: StatusCheckCallback;
  }
): void {
  mainWindow = window;
  vaultUnlockCheck = callbacks.vaultUnlockCheck;
  statusCheckCallback = callbacks.statusCheck;
  console.log(`${LOG_PREFIX} Initialized with main window and callbacks`);
}

/**
 * Start the scheduler
 * 
 * Behavior:
 * - Schedules initial run after 60 seconds
 * - Sets up 6-hour recurring interval
 * - Safe to call multiple times (no-op if already running)
 */
export async function start(): Promise<void> {
  if (initialTimer || intervalTimer) {
    console.log(`${LOG_PREFIX} Already running, ignoring start request`);
    return;
  }

  console.log(`${LOG_PREFIX} Starting scheduler`);
  console.log(`${LOG_PREFIX} Initial run in ${INITIAL_DELAY_MS / 1000} seconds`);
  console.log(`${LOG_PREFIX} Recurring interval: ${SYNC_INTERVAL_MS / 1000 / 60 / 60} hours`);

  // Schedule initial run after 60 seconds
  initialTimer = setTimeout(async () => {
    await performSyncCheck('initial');
    initialTimer = null;
  }, INITIAL_DELAY_MS);

  // Calculate next run time
  nextRunTime = Date.now() + INITIAL_DELAY_MS;

  // Set up recurring interval (starts after initial delay completes)
  setTimeout(() => {
    intervalTimer = setInterval(async () => {
      await performSyncCheck('interval');
    }, SYNC_INTERVAL_MS);

    console.log(`${LOG_PREFIX} Recurring interval started (every 6 hours)`);
  }, INITIAL_DELAY_MS);
}

/**
 * Stop the scheduler
 * 
 * Cleans up all timers and resets state.
 * Safe to call multiple times.
 */
export async function stop(): Promise<void> {
  console.log(`${LOG_PREFIX} Stopping scheduler`);

  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }

  if (intervalTimer) {
    clearInterval(intervalTimer);
    intervalTimer = null;
  }

  nextRunTime = null;
  console.log(`${LOG_PREFIX} Stopped`);
}

/**
 * Get the epoch timestamp of the next scheduled run
 * 
 * @returns Timestamp in milliseconds, or null if not scheduled
 */
export async function getNextRun(): Promise<number | null> {
  return nextRunTime;
}

/**
 * Manually trigger a sync check
 * 
 * Used by:
 * - Vault unlock handler
 * - Key rotation completion handler
 * - Export/import completion handler
 * 
 * Bypasses timing constraints but still respects:
 * - Vault lock state
 * - isRunning flag (no concurrent runs)
 * - Timeout protection
 * 
 * @param trigger - Description of what triggered this check
 */
export async function triggerCheck(trigger: string): Promise<void> {
  console.log(`${LOG_PREFIX} Manual check triggered: ${trigger}`);
  await performSyncCheck(trigger);
}

// ===========================
// SCHEDULER LOGIC
// ===========================

/**
 * Perform a single sync check
 * 
 * Process:
 * 1. Check if already running (skip if true)
 * 2. Check if vault is unlocked (skip if locked)
 * 3. Call getSyncStatus() from keystoreSyncStatus
 * 4. If needsSync=true, emit 'sync:status-change' event
 * 5. Update next run time
 * 6. Handle errors gracefully
 * 
 * Safety:
 * - Timeout protection (10 seconds max)
 * - No concurrent runs (isRunning flag)
 * - Vault-aware (only runs when unlocked)
 * - Error isolation (never crashes app)
 * 
 * @param trigger - Description of what triggered this check
 */
async function performSyncCheck(trigger: string): Promise<void> {
  // Prevent concurrent runs
  if (isRunning) {
    console.log(`${LOG_PREFIX} Sync check already in progress, skipping`);
    return;
  }

  isRunning = true;

  try {
    // Timeout protection
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Sync check timed out after 10 seconds')), RUN_TIMEOUT_MS);
    });

    const checkPromise = performSyncCheckInternal(trigger);

    await Promise.race([checkPromise, timeoutPromise]);
  } catch (error) {
    console.error(`${LOG_PREFIX} Sync check failed:`, error);
  } finally {
    isRunning = false;

    // Update next run time (only for interval checks)
    if (trigger === 'interval') {
      nextRunTime = Date.now() + SYNC_INTERVAL_MS;
    }
  }
}

/**
 * Internal sync check implementation
 * 
 * @param trigger - Description of what triggered this check
 */
async function performSyncCheckInternal(trigger: string): Promise<void> {
  console.log(`${LOG_PREFIX} Performing sync check (trigger: ${trigger})`);

  // Check callbacks are configured
  if (!vaultUnlockCheck || !statusCheckCallback) {
    console.error(`${LOG_PREFIX} Callbacks not configured, aborting sync check`);
    return;
  }

  // Check if vault is unlocked
  const vaultUnlocked = vaultUnlockCheck();
  if (!vaultUnlocked) {
    console.log(`${LOG_PREFIX} Vault is locked, skipping sync check`);
    return;
  }

  try {
    // Get comprehensive sync health report
    const healthReport = await statusCheckCallback();

    console.log(`${LOG_PREFIX} Sync status:`, {
      needsSync: healthReport.needsSync,
      deviceCount: healthReport.deviceCount,
      lastSyncedAt: new Date(healthReport.lastSyncedAt).toISOString(),
      daysSinceLastSync: healthReport.daysSinceLastSync,
    });

    // Emit event if sync is needed
    if (healthReport.needsSync) {
      console.log(`${LOG_PREFIX} Sync needed, emitting event`);
      emitStatusChangeEvent(healthReport);
    } else {
      console.log(`${LOG_PREFIX} Vault is up to date, no sync needed`);
    }
  } catch (error) {
    console.error(`${LOG_PREFIX} Error during sync check:`, error);
  }
}

/**
 * Emit 'sync:status-change' IPC event to renderer
 * 
 * Event payload:
 * - needsSync: boolean
 * - lastSyncedAt: number (epoch timestamp)
 * - daysSinceLastSync: number
 * - deviceCount: number
 * - alignment: SyncAlignment (devices in/out of sync)
 * 
 * @param healthReport - Sync health report from getSyncHealthReport()
 */
function emitStatusChangeEvent(healthReport: any): void {
  if (!mainWindow) {
    console.warn(`${LOG_PREFIX} Cannot emit event: mainWindow not initialized`);
    return;
  }

  try {
    // Send IPC event to renderer
    mainWindow.webContents.send('sync:status-change', {
      needsSync: healthReport.needsSync,
      lastSyncedAt: healthReport.lastSyncedAt,
      daysSinceLastSync: healthReport.daysSinceLastSync,
      deviceCount: healthReport.deviceCount,
      alignment: healthReport.alignment,
      warnings: healthReport.warnings,
      recommendation: healthReport.recommendation,
    });

    console.log(`${LOG_PREFIX} Emitted 'sync:status-change' event to renderer`);
  } catch (error) {
    console.error(`${LOG_PREFIX} Failed to emit event:`, error);
  }
}

// ===========================
// LIFECYCLE HOOKS
// ===========================

/**
 * Hook called when vault is unlocked
 * 
 * Triggers an immediate sync check (bypasses 6-hour interval)
 */
export async function onVaultUnlocked(): Promise<void> {
  console.log(`${LOG_PREFIX} Vault unlocked, triggering sync check`);
  await triggerCheck('vault-unlocked');
}

/**
 * Hook called when keypair rotation completes
 * 
 * Triggers an immediate sync check to detect rotation drift
 */
export async function onRotationComplete(): Promise<void> {
  console.log(`${LOG_PREFIX} Keypair rotation completed, triggering sync check`);
  await triggerCheck('rotation-complete');
}

/**
 * Hook called when export operation completes
 * 
 * Triggers an immediate sync check (export updates lastSyncedAt)
 */
export async function onExportComplete(): Promise<void> {
  console.log(`${LOG_PREFIX} Export completed, triggering sync check`);
  await triggerCheck('export-complete');
}

/**
 * Hook called when import operation completes
 * 
 * Triggers an immediate sync check (import merges keypairs)
 */
export async function onImportComplete(): Promise<void> {
  console.log(`${LOG_PREFIX} Import completed, triggering sync check`);
  await triggerCheck('import-complete');
}

// ===========================
// EXPORTS
// ===========================

export default {
  initialize,
  start,
  stop,
  getNextRun,
  triggerCheck,
  onVaultUnlocked,
  onRotationComplete,
  onExportComplete,
  onImportComplete,
};
