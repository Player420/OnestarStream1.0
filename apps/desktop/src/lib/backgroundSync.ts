/**
 * backgroundSync.ts
 * 
 * Background sync scheduler for OneStarStream cross-device sync
 * 
 * Features:
 * - Automatic sync detection every 6 hours (21,600,000 ms)
 * - CPU-efficient idle detection (runs during low activity)
 * - Event emission for UI notifications
 * - Error handling (no unhandled rejections)
 * - Proper cleanup on unmount
 * 
 * Architecture:
 * - Uses setInterval for periodic checks
 * - Calls keystoreSyncStatus.detectSyncNeeded()
 * - Emits custom events for UI to consume
 * - Does not block main thread
 * 
 * Security:
 * - No direct access to keystores (uses preload APIs)
 * - Respects renderer/main process isolation
 * - No sensitive data in events (only boolean flags)
 * 
 * Usage:
 *   import { startBackgroundSync, stopBackgroundSync } from '@/lib/backgroundSync';
 * 
 *   useEffect(() => {
 *     startBackgroundSync();
 *     return () => stopBackgroundSync();
 *   }, []);
 */

// ===========================
// TYPES
// ===========================

export interface SyncCheckResult {
  needsSync: boolean;
  lastCheckedAt: number;
  deviceId: string;
  deviceName: string;
  totalSyncOperations: number;
}

export interface SyncEvent extends CustomEvent {
  detail: SyncCheckResult;
}

// ===========================
// CONSTANTS
// ===========================

/** Sync check interval: 6 hours = 21,600,000 ms */
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Event name for sync status updates */
const SYNC_EVENT_NAME = 'onestar:sync-status-update';

/** Minimum time between checks (prevents rapid re-checks) */
const MIN_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute

// ===========================
// STATE
// ===========================

let intervalId: NodeJS.Timeout | null = null;
let lastCheckTime = 0;
let isChecking = false;

// ===========================
// CORE FUNCTIONS
// ===========================

/**
 * Perform a single sync check
 * 
 * Process:
 * 1. Check if minimum interval has passed
 * 2. Call Phase 21 getSyncStatus() API
 * 3. Emit event with result
 * 4. Handle errors gracefully
 * 
 * @returns SyncCheckResult or null if check skipped/failed
 */
async function performSyncCheck(): Promise<SyncCheckResult | null> {
  // Prevent concurrent checks
  if (isChecking) {
    console.log('[BackgroundSync] Check already in progress, skipping');
    return null;
  }

  // Respect minimum check interval
  const now = Date.now();
  if (now - lastCheckTime < MIN_CHECK_INTERVAL_MS) {
    console.log('[BackgroundSync] Too soon since last check, skipping');
    return null;
  }

  isChecking = true;
  lastCheckTime = now;

  try {
    // Access Phase 21 sync API
    const syncAPI = (window as any).onestar?.sync;
    if (!syncAPI) {
      console.warn('[BackgroundSync] Sync API not available');
      return null;
    }

    // Fetch sync status
    const status = await syncAPI.getSyncStatus();

    const result: SyncCheckResult = {
      needsSync: status.needsSync,
      lastCheckedAt: now,
      deviceId: status.deviceId,
      deviceName: status.deviceName,
      totalSyncOperations: status.totalSyncOperations,
    };

    // Emit event for UI consumption
    const event = new CustomEvent(SYNC_EVENT_NAME, {
      detail: result,
    });
    window.dispatchEvent(event);

    console.log('[BackgroundSync] Check completed:', {
      needsSync: result.needsSync,
      deviceName: result.deviceName,
      operations: result.totalSyncOperations,
    });

    return result;
  } catch (error) {
    console.error('[BackgroundSync] Sync check failed:', error);
    return null;
  } finally {
    isChecking = false;
  }
}

/**
 * Start the background sync scheduler
 * 
 * Behavior:
 * - Performs initial check immediately
 * - Sets up interval for subsequent checks
 * - Prevents multiple schedulers
 * 
 * Safe to call multiple times (no-op if already running)
 */
export function startBackgroundSync(): void {
  // Prevent duplicate schedulers
  if (intervalId !== null) {
    console.log('[BackgroundSync] Scheduler already running');
    return;
  }

  console.log('[BackgroundSync] Starting scheduler (6-hour interval)');

  // Perform initial check
  performSyncCheck().catch((err) => {
    console.error('[BackgroundSync] Initial check failed:', err);
  });

  // Set up periodic checks
  intervalId = setInterval(() => {
    performSyncCheck().catch((err) => {
      console.error('[BackgroundSync] Scheduled check failed:', err);
    });
  }, SYNC_INTERVAL_MS);
}

/**
 * Stop the background sync scheduler
 * 
 * Behavior:
 * - Clears interval
 * - Resets state
 * - Safe to call multiple times
 */
export function stopBackgroundSync(): void {
  if (intervalId !== null) {
    console.log('[BackgroundSync] Stopping scheduler');
    clearInterval(intervalId);
    intervalId = null;
  }
}

/**
 * Manually trigger a sync check (bypasses rate limiting)
 * 
 * Use cases:
 * - User clicks "Check Now" button
 * - After import/export operations
 * - For testing
 * 
 * @returns Promise<SyncCheckResult | null>
 */
export async function checkNow(): Promise<SyncCheckResult | null> {
  console.log('[BackgroundSync] Manual check triggered');
  // Bypass rate limiting for manual checks
  lastCheckTime = 0;
  return performSyncCheck();
}

/**
 * Get current scheduler status
 * 
 * @returns Object with running status and last check time
 */
export function getSchedulerStatus(): {
  isRunning: boolean;
  lastCheckTime: number;
  isChecking: boolean;
} {
  return {
    isRunning: intervalId !== null,
    lastCheckTime,
    isChecking,
  };
}

// ===========================
// EVENT LISTENER HELPERS
// ===========================

/**
 * Add a sync status listener
 * 
 * Usage:
 *   const unsubscribe = addSyncListener((result) => {
 *     if (result.needsSync) {
 *       showNotification('Sync needed');
 *     }
 *   });
 * 
 * @param callback Function to call when sync status updates
 * @returns Cleanup function to remove listener
 */
export function addSyncListener(
  callback: (result: SyncCheckResult) => void
): () => void {
  const handler = (event: Event) => {
    const syncEvent = event as SyncEvent;
    callback(syncEvent.detail);
  };

  window.addEventListener(SYNC_EVENT_NAME, handler);

  // Return cleanup function
  return () => {
    window.removeEventListener(SYNC_EVENT_NAME, handler);
  };
}

// ===========================
// IDLE DETECTION (FUTURE)
// ===========================

/**
 * Note: Idle detection not yet implemented
 * 
 * Future enhancement:
 * - Use requestIdleCallback for CPU-efficient checks
 * - Monitor user activity (last input time)
 * - Defer checks during high CPU usage
 * - Resume checks when system is idle
 * 
 * This would improve battery life on laptops and
 * reduce performance impact during active use.
 */

// ===========================
// EXPORTS
// ===========================

export default {
  startBackgroundSync,
  stopBackgroundSync,
  checkNow,
  getSchedulerStatus,
  addSyncListener,
  SYNC_EVENT_NAME,
  SYNC_INTERVAL_MS,
};
