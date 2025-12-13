/**
 * status-change-event.test.mjs
 * 
 * Phase 23: Sync Scheduler Event Emission Tests
 * 
 * Tests:
 * - 'sync:status-change' event emitted when needsSync=true
 * - No event when needsSync=false
 * - Event payload structure correct
 * - Event contains alignment data, warnings, recommendations
 * 
 * Strategy:
 * - Mock BrowserWindow.webContents.send
 * - Trigger manual sync check
 * - Verify IPC event emission
 */

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert';

describe('SyncScheduler - Status Change Events', () => {
  let syncScheduler;
  let mockWindow;
  let vaultUnlockCheck;
  let statusCheck;
  let ipcEventsCalled = [];

  before(async () => {
    // Dynamic import
    const module = await import('../dist/syncScheduler.js');
    syncScheduler = module;

    // Mock BrowserWindow with event tracking
    mockWindow = {
      webContents: {
        send: mock.fn((event, data) => {
          ipcEventsCalled.push({ event, data });
          console.log(`[Mock] IPC event: ${event}`, JSON.stringify(data, null, 2));
        }),
      },
    };

    // Mock vault unlock
    vaultUnlockCheck = mock.fn(() => true);
  });

  after(async () => {
    await syncScheduler.stop();
  });

  it('should emit event when needsSync=true', async () => {
    // Reset tracking
    ipcEventsCalled = [];

    // Mock status check returning needsSync=true
    statusCheck = mock.fn(async () => ({
      needsSync: true,
      lastSyncedAt: Date.now() - 86400000, // 1 day ago
      daysSinceLastSync: 1,
      deviceCount: 2,
      alignment: {
        aligned: false,
        currentKeypairPublicKey: 'mock-key',
        devicesInSync: ['Device A'],
        devicesOutOfSync: ['Device B'],
        missingRotations: 1,
        staleDays: 1,
      },
      warnings: [
        {
          severity: 'warning',
          message: 'Device out of sync',
          deviceName: 'Device B',
          missingRotations: 1,
        },
      ],
      recommendation: {
        action: 'export',
        reason: 'Sync needed',
        priority: 'high',
      },
    }));

    // Initialize and trigger check
    syncScheduler.initialize(mockWindow, { vaultUnlockCheck, statusCheck });
    await syncScheduler.triggerCheck('test-needs-sync');

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify event was emitted
    assert.ok(ipcEventsCalled.length > 0, 'IPC event should be emitted');

    const event = ipcEventsCalled.find((e) => e.event === 'sync:status-change');
    assert.ok(event, 'sync:status-change event should be emitted');

    // Verify payload structure
    assert.strictEqual(event.data.needsSync, true, 'needsSync should be true');
    assert.ok(event.data.lastSyncedAt, 'lastSyncedAt should be present');
    assert.strictEqual(event.data.deviceCount, 2, 'deviceCount should match');
    assert.ok(event.data.alignment, 'alignment should be present');
    assert.ok(Array.isArray(event.data.warnings), 'warnings should be array');
    assert.ok(event.data.recommendation, 'recommendation should be present');
  });

  it('should NOT emit event when needsSync=false', async () => {
    // Reset tracking
    ipcEventsCalled = [];

    // Mock status check returning needsSync=false
    statusCheck = mock.fn(async () => ({
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
    }));

    // Initialize and trigger check
    syncScheduler.initialize(mockWindow, { vaultUnlockCheck, statusCheck });
    await syncScheduler.triggerCheck('test-no-sync-needed');

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify NO event was emitted
    const event = ipcEventsCalled.find((e) => e.event === 'sync:status-change');
    assert.strictEqual(event, undefined, 'sync:status-change should NOT be emitted when needsSync=false');
  });

  it('should include warnings in event payload', async () => {
    // Reset tracking
    ipcEventsCalled = [];

    // Mock status check with warnings
    statusCheck = mock.fn(async () => ({
      needsSync: true,
      lastSyncedAt: Date.now() - 172800000, // 2 days ago
      daysSinceLastSync: 2,
      deviceCount: 3,
      alignment: {
        aligned: false,
        currentKeypairPublicKey: 'mock-key',
        devicesInSync: ['Device A'],
        devicesOutOfSync: ['Device B', 'Device C'],
        missingRotations: 2,
        staleDays: 2,
      },
      warnings: [
        {
          severity: 'critical',
          message: 'Multiple devices out of sync',
          missingRotations: 2,
        },
        {
          severity: 'warning',
          message: 'Sync is stale',
          daysSinceSync: 2,
        },
      ],
      recommendation: {
        action: 'export',
        reason: 'Critical sync needed',
        priority: 'high',
      },
    }));

    // Initialize and trigger
    syncScheduler.initialize(mockWindow, { vaultUnlockCheck, statusCheck });
    await syncScheduler.triggerCheck('test-warnings');

    // Wait for async operations
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify warnings included
    const event = ipcEventsCalled.find((e) => e.event === 'sync:status-change');
    assert.ok(event, 'Event should be emitted');
    assert.strictEqual(event.data.warnings.length, 2, 'Should have 2 warnings');
    assert.strictEqual(event.data.warnings[0].severity, 'critical', 'First warning should be critical');
  });
});
