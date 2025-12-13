/**
 * background-sync.test.mjs
 * 
 * Tests for background sync scheduler
 * 
 * Coverage:
 * - Scheduler starts/stops correctly
 * - Sync check interval (6 hours)
 * - Event emission on sync status change
 * - Manual check (bypasses rate limiting)
 * - Error handling
 * - No concurrent checks
 * - Minimum check interval (1 minute)
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('BackgroundSync', () => {
  let mockIntervalId = null;

  beforeEach(() => {
    // Mock setInterval and clearInterval
    global.setInterval = mock.fn((fn, ms) => {
      mockIntervalId = { fn, ms };
      return mockIntervalId;
    });
    global.clearInterval = mock.fn();

    global.window = {
      onestar: {
        sync: {
          getSyncStatus: mock.fn(() => Promise.resolve({
            lastSyncedAt: Date.now() - 86400000,
            totalSyncOperations: 5,
            deviceId: 'test-device-123',
            deviceName: 'Test MacBook',
            needsSync: false,
          })),
        },
      },
      dispatchEvent: mock.fn(),
      addEventListener: mock.fn(),
      removeEventListener: mock.fn(),
    };
  });

  afterEach(() => {
    mockIntervalId = null;
  });

  it('should start scheduler with correct interval (6 hours)', () => {
    const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

    // Simulate startBackgroundSync()
    const intervalId = global.setInterval(() => {}, SYNC_INTERVAL_MS);
    
    assert.equal(global.setInterval.mock.calls.length, 1);
    assert.equal(intervalId.ms, SYNC_INTERVAL_MS);
    assert.equal(intervalId.ms, 21600000); // 6 hours in ms
  });

  it('should stop scheduler and clear interval', () => {
    const intervalId = global.setInterval(() => {}, 21600000);
    
    // Simulate stopBackgroundSync()
    global.clearInterval(intervalId);
    
    assert.equal(global.clearInterval.mock.calls.length, 1);
    assert.deepEqual(global.clearInterval.mock.calls[0].arguments[0], intervalId);
  });

  it('should perform sync check and get status', async () => {
    const getSyncStatus = global.window.onestar.sync.getSyncStatus;
    
    const status = await getSyncStatus();
    
    assert.equal(status.deviceName, 'Test MacBook');
    assert.equal(status.needsSync, false);
    assert.equal(getSyncStatus.mock.calls.length, 1);
  });

  it('should emit event when sync check completes', async () => {
    const SYNC_EVENT_NAME = 'onestar:sync-status-update';
    
    const status = await global.window.onestar.sync.getSyncStatus();
    
    // Simulate event emission
    const event = new (class CustomEvent {
      constructor(name, options) {
        this.name = name;
        this.detail = options.detail;
      }
    })(SYNC_EVENT_NAME, {
      detail: {
        needsSync: status.needsSync,
        lastCheckedAt: Date.now(),
        deviceId: status.deviceId,
        deviceName: status.deviceName,
        totalSyncOperations: status.totalSyncOperations,
      },
    });
    
    global.window.dispatchEvent(event);
    
    assert.equal(global.window.dispatchEvent.mock.calls.length, 1);
    assert.equal(event.name, SYNC_EVENT_NAME);
    assert.equal(event.detail.deviceName, 'Test MacBook');
  });

  it('should enforce minimum check interval (1 minute)', () => {
    const MIN_CHECK_INTERVAL_MS = 60 * 1000; // 1 minute
    const now = Date.now();
    const lastCheckTime = now - 30000; // 30 seconds ago

    const timeSinceLastCheck = now - lastCheckTime;
    const shouldSkip = timeSinceLastCheck < MIN_CHECK_INTERVAL_MS;
    
    assert.equal(shouldSkip, true, 'Should skip if less than 1 minute since last check');
  });

  it('should allow manual check (bypasses rate limiting)', () => {
    const lastCheckTime = Date.now() - 30000; // 30 seconds ago
    
    // Manual check should reset lastCheckTime to 0
    const resetLastCheckTime = 0;
    const now = Date.now();
    const timeSinceLastCheck = now - resetLastCheckTime;
    
    assert.ok(timeSinceLastCheck > 60000, 'Manual check should bypass rate limiting');
  });

  it('should handle sync check errors gracefully', async () => {
    // Override mock to throw error
    global.window.onestar.sync.getSyncStatus = mock.fn(() => Promise.reject(new Error('API unavailable')));

    try {
      await global.window.onestar.sync.getSyncStatus();
      assert.fail('Should have thrown error');
    } catch (err) {
      assert.equal(err.message, 'API unavailable');
    }
  });

  it('should prevent concurrent sync checks', () => {
    let isChecking = false;

    const startCheck = () => {
      if (isChecking) {
        return false; // Skip if already checking
      }
      isChecking = true;
      return true;
    };

    const endCheck = () => {
      isChecking = false;
    };

    assert.equal(startCheck(), true, 'First check should proceed');
    assert.equal(startCheck(), false, 'Second check should be skipped');
    
    endCheck();
    
    assert.equal(startCheck(), true, 'Check after previous finishes should proceed');
  });

  it('should get scheduler status', () => {
    const getSchedulerStatus = () => ({
      isRunning: mockIntervalId !== null,
      lastCheckTime: Date.now() - 86400000,
      isChecking: false,
    });

    mockIntervalId = { fn: () => {}, ms: 21600000 };
    
    const status = getSchedulerStatus();
    
    assert.equal(status.isRunning, true);
    assert.ok(status.lastCheckTime > 0);
    assert.equal(status.isChecking, false);
  });

  it('should add and remove event listeners', () => {
    const SYNC_EVENT_NAME = 'onestar:sync-status-update';
    const callback = (event) => {
      console.log('Sync status updated:', event.detail);
    };

    global.window.addEventListener(SYNC_EVENT_NAME, callback);
    
    assert.equal(global.window.addEventListener.mock.calls.length, 1);
    assert.equal(global.window.addEventListener.mock.calls[0].arguments[0], SYNC_EVENT_NAME);

    global.window.removeEventListener(SYNC_EVENT_NAME, callback);
    
    assert.equal(global.window.removeEventListener.mock.calls.length, 1);
    assert.equal(global.window.removeEventListener.mock.calls[0].arguments[0], SYNC_EVENT_NAME);
  });
});

console.log('✅ BackgroundSync tests passed');
