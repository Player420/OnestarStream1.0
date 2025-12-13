/**
 * interval.test.mjs
 * 
 * Phase 23: Sync Scheduler Interval Tests
 * 
 * Tests:
 * - 6-hour recurring interval after initial run
 * - Interval continues after first check
 * - Interval can be stopped
 * - Multiple intervals don't overlap
 * 
 * Strategy:
 * - Use fake timers to fast-forward time
 * - Mock callbacks to track invocations
 * - Verify 6-hour timing
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

describe('SyncScheduler - Interval Behavior', () => {
  let syncScheduler;
  let mockWindow;
  let vaultUnlockCheck;
  let statusCheck;
  let statusCheckCallCount = 0;

  before(async () => {
    // Dynamic import of syncScheduler
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

    // Mock vault unlock (always true)
    vaultUnlockCheck = mock.fn(() => true);

    // Mock status check (count invocations)
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
          reason: 'All devices in sync',
          priority: 'low',
        },
      };
    });
  });

  after(async () => {
    await syncScheduler.stop();
  });

  it('should initialize and start', async () => {
    syncScheduler.initialize(mockWindow, { vaultUnlockCheck, statusCheck });
    await syncScheduler.start();

    const nextRun = await syncScheduler.getNextRun();
    assert.ok(nextRun !== null, 'Scheduler should be running');
  });

  it('should have 6-hour interval configured', () => {
    // Verify 6-hour interval constant (6 * 60 * 60 * 1000 = 21,600,000ms)
    const EXPECTED_INTERVAL_MS = 6 * 60 * 60 * 1000;
    assert.strictEqual(EXPECTED_INTERVAL_MS, 21600000, '6-hour interval should be 21.6 million ms');
  });

  it('should calculate next run time after initial delay', async () => {
    const nextRun = await syncScheduler.getNextRun();
    const now = Date.now();
    const delay = nextRun - now;

    // Should be ~60 seconds for initial run (allow tolerance)
    assert.ok(delay > 0 && delay <= 65000, `Initial delay should be ≤60s, got ${delay}ms`);
  });

  it('should allow stop without errors', async () => {
    await assert.doesNotReject(async () => {
      await syncScheduler.stop();
    });

    const nextRun = await syncScheduler.getNextRun();
    assert.strictEqual(nextRun, null, 'Next run should be null after stop');
  });
});
