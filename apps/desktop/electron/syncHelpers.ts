/**
 * syncHelpers.ts
 * 
 * Electron-safe wrappers for @onestar/db-sdk modules
 * 
 * PURPOSE:
 * - Provide stable access to keystoreSyncStatus and postQuantumCrypto
 * - Handle errors gracefully with safe defaults
 * 
 * ARCHITECTURE:
 * - Direct imports from @onestar/db-sdk package
 * - Compatible with TEST_MODE
 * - No IPC overhead (direct imports)
 */

import type { SyncHealthReport } from './syncScheduler';
import { getSyncHealthReport as getHealthReport, isPersistentKeypairUnlocked as checkUnlocked } from '@onestar/db-sdk';

/**
 * Get sync health report from keystoreSyncStatus module
 * 
 * @returns Sync health report or safe defaults on error
 */
export async function getSyncHealthReport(): Promise<SyncHealthReport> {
  try {
    return await getHealthReport();
  } catch (error) {
    console.error('[SyncHelpers] Error getting sync health report:', error);
    
    // Return safe defaults
    return {
      needsSync: false,
      lastSyncedAt: Date.now(),
      daysSinceLastSync: 0,
      deviceCount: 1,
      alignment: {
        aligned: true,
        currentKeypairPublicKey: '',
        devicesInSync: [],
        devicesOutOfSync: [],
        missingRotations: 0,
        staleDays: 0,
      },
      warnings: [],
      recommendation: {
        action: 'no-action-needed',
        reason: 'Error checking sync status',
        priority: 'low',
      },
    };
  }
}

/**
 * Check if persistent keypair is unlocked
 * 
 * @returns True if vault is unlocked, false otherwise
 */
export async function isPersistentKeypairUnlocked(): Promise<boolean> {
  try {
    return checkUnlocked();
  } catch (error) {
    console.error('[SyncHelpers] Error checking vault unlock status:', error);
    return false;
  }
}
