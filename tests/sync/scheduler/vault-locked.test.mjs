/**
 * vault-locked.test.mjs
 * 
 * Phase 23: Sync Scheduler Vault-Aware Tests
 * 
 * Tests:
 * - Scheduler skips check when vault is locked
 * - Scheduler resumes when vault is unlocked
 * - onVaultUnlocked() triggers immediate check
 * - Status check not called when vault locked
 * 
 * Strategy:
 * - Mock vault unlock check to return false
 * - Verify status check is NOT called
 * - Switch vault to unlocked, trigger check
 * - Verify status check IS called
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

describe('SyncScheduler - Vault-Aware Behavior', () => {
  let syncScheduler;
  let mockWindow;
  let vaultUnlockCheck;
  let statusCheck;
  let isVaultUnlocked = false;
  let statusCheckCallCount = 0;

  before(async () => {
    // Dynamic import
    const module = await import('../dist/syncScheduler.js');
    syncScheduler = module;

    // Mock BrowserWindow
    mockWindow = {
      webContents: {
        send: mock.fn((event, data) => {
          console.log(`[Mock] IPC event: ${event}`);
        }),
      },
    };

    // Mock vault unlock check (controlled by test)
    vaultUnlockCheck = mock.fn(() => {
      console.log(`[Mock] Vault unlock check: ${isVaultUnlocked}`);
      return isVaultUnlocked;
    });

    // Mock status check (track calls)
    statusCheck = mock.fn(async () => {
      statusCheckCallCount++;
      console.log(`[Mock] Status check called (count: ${statusCheckCallCount})`);
      return {
        needsSync: false,
        lastSyncedAt: Date.now(),
        daysSinceLastSync: 0,
        deviceCount: 1,
        alignment: {
          aligned: true,
          currentKeypairPublicKey: 'mock-key',
          devicesInSync: ['Device A'],
          devicesOutOfSync: [],
          missingRotations: 0,
          staleDays: 0,
        },
        warnings: [],
        recommendation: {
          action: 'no-action-needed',
          reason: 'All synced',
          priority: 'low',
        },
      };
    });
  });

  after(async () => {
    await syncScheduler.stop();
  });

  it('should skip check when vault is locked', async () => {
    // Reset counters
    statusCheckCallCount = 0;
    isVaultUnlocked = false;

    // Initialize and trigger check
    syncScheduler.initialize(mockWindow, { vaultUnlockCheck, statusCheck });
    await syncScheduler.triggerCheck('test-vault-locked');

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status check was NOT called
    assert.strictEqual(statusCheckCallCount, 0, 'Status check should NOT be called when vault is locked');
  });

  it('should run check when vault is unlocked', async () => {
    // Reset counters
    statusCheckCallCount = 0;
    isVaultUnlocked = true; // Unlock vault

    // Trigger check
    await syncScheduler.triggerCheck('test-vault-unlocked');

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status check WAS called
    assert.strictEqual(statusCheckCallCount, 1, 'Status check should be called when vault is unlocked');
  });

  it('should trigger check on vault unlock lifecycle hook', async () => {
    // Reset counters
    statusCheckCallCount = 0;
    isVaultUnlocked = true;

    // Call onVaultUnlocked lifecycle hook
    await syncScheduler.onVaultUnlocked();

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status check was called
    assert.strictEqual(statusCheckCallCount, 1, 'onVaultUnlocked should trigger status check');
  });

  it('should trigger check on rotation complete', async () => {
    // Reset counters
    statusCheckCallCount = 0;
    isVaultUnlocked = true;

    // Call onRotationComplete lifecycle hook
    await syncScheduler.onRotationComplete();

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status check was called
    assert.strictEqual(statusCheckCallCount, 1, 'onRotationComplete should trigger status check');
  });

  it('should trigger check on export complete', async () => {
    // Reset counters
    statusCheckCallCount = 0;
    isVaultUnlocked = true;

    // Call onExportComplete lifecycle hook
    await syncScheduler.onExportComplete();

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status check was called
    assert.strictEqual(statusCheckCallCount, 1, 'onExportComplete should trigger status check');
  });

  it('should trigger check on import complete', async () => {
    // Reset counters
    statusCheckCallCount = 0;
    isVaultUnlocked = true;

    // Call onImportComplete lifecycle hook
    await syncScheduler.onImportComplete();

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify status check was called
    assert.strictEqual(statusCheckCallCount, 1, 'onImportComplete should trigger status check');
  });
});
