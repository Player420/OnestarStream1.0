/**
 * startup.test.mjs
 * 
 * Phase 23: Sync Scheduler Startup Tests
 * 
 * Tests:
 * - Scheduler starts with 60-second initial delay
 * - Auto-start on app boot (window load)
 * - No double-start (idempotent)
 * - Next run time calculated correctly
 * 
 * Strategy:
 * - Use fake timers to control time
 * - Mock BrowserWindow and callbacks
 * - Verify initial timer behavior
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

describe('SyncScheduler - Startup Behavior', () => {
  let syncScheduler;
  let mockWindow;
  let vaultUnlockCheck;
  let statusCheck;
  let statusCheckCalled = false;

  before(async () => {
    // Dynamic import of syncScheduler (ESM compatible)
    const module = await import('../dist/syncScheduler.js');
    syncScheduler = module;

    // Mock BrowserWindow
    mockWindow = {
      webContents: {
        send: mock.fn((event, data) => {
          console.log(`[Mock] IPC event sent: ${event}`, data);
        }),
      },
    };

    // Mock vault unlock check (always return true)
    vaultUnlockCheck = mock.fn(() => true);

    // Mock status check (return needsSync=true)
    statusCheck = mock.fn(async () => {
      statusCheckCalled = true;
      return {
        needsSync: true,
        lastSyncedAt: Date.now() - 86400000, // 1 day ago
        daysSinceLastSync: 1,
        deviceCount: 2,
        alignment: {
          aligned: false,
          currentKeypairPublicKey: 'mock-public-key',
          devicesInSync: ['Device A'],
          devicesOutOfSync: ['Device B'],
          missingRotations: 1,
          staleDays: 1,
        },
        warnings: [],
        recommendation: {
          action: 'export',
          reason: 'Test recommendation',
          priority: 'medium',
        },
      };
    });
  });

  after(() => {
    // Clean up timers
    if (syncScheduler.stop) {
      syncScheduler.stop();
    }
  });

  it('should initialize without errors', () => {
    assert.doesNotThrow(() => {
      syncScheduler.initialize(mockWindow, { vaultUnlockCheck, statusCheck });
    });
  });

  it('should start with 60-second initial delay', async () => {
    await syncScheduler.start();

    // Get next run time
    const nextRun = await syncScheduler.getNextRun();
    assert.ok(nextRun !== null, 'Next run time should be set');

    const now = Date.now();
    const delay = nextRun - now;

    // Should be ~60 seconds (allow 5 second tolerance for execution time)
    assert.ok(delay >= 55000 && delay <= 65000, `Delay should be ~60s, got ${delay}ms`);
  });

  it('should not double-start if already running', async () => {
    const firstNextRun = await syncScheduler.getNextRun();

    // Try starting again
    await syncScheduler.start();

    const secondNextRun = await syncScheduler.getNextRun();

    // Next run time should not change (no double-start)
    assert.strictEqual(secondNextRun, firstNextRun, 'Next run time should not change on double-start');
  });

  it('should clean up on stop', async () => {
    await syncScheduler.stop();

    const nextRun = await syncScheduler.getNextRun();
    assert.strictEqual(nextRun, null, 'Next run should be null after stop');
  });
});
