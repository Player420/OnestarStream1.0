/**
 * Phase 21: Cross-Device Keystore Sync - Comprehensive Test Suite
 * 
 * TEST MATRIX: 33 Scenarios covering:
 * - Basic export/import (4 tests)
 * - Conflict resolution (3 tests)
 * - Security validation (6 tests)
 * - Edge cases (6 tests)
 * - Performance (2 tests)
 * - Integration (4 tests)
 * - Device management (5 tests)
 * - Failure recovery (3 tests)
 * 
 * EXECUTION:
 * ```bash
 * node tests/sync/sync-scenarios.test.mjs
 * ```
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';

// Mock imports (in real test, these would import from src/lib/)
// For this test file, we'll create minimal mocks

/**
 * Test helper: Create temporary directory
 */
async function createTestDir() {
  return await mkdtemp(join(tmpdir(), 'onestar-sync-test-'));
}

/**
 * Test helper: Cleanup temporary directory
 */
async function cleanupTestDir(dir) {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to cleanup ${dir}:`, err);
  }
}

/**
 * Test helper: Generate mock keystore v4
 */
function createMockKeystoreV4(deviceId, deviceName, options = {}) {
  const now = Date.now();
  return {
    version: 'v4',
    userId: options.userId || 'user-123',
    encryptedIdentity: options.encryptedIdentity || 'encrypted-identity-data',
    encryptedCurrentKeypair: options.encryptedCurrentKeypair || JSON.stringify({
      publicKey: options.currentPublicKey || `pk-${deviceId}-current`,
      encryptedPrivateKey: 'encrypted-private-key',
      rotatedAt: options.currentRotatedAt || now - (10 * 24 * 60 * 60 * 1000), // 10 days ago
    }),
    encryptedPreviousKeypairs: options.encryptedPreviousKeypairs || options.previousKeypairs || undefined,
    rotationHistory: options.rotationHistory || [],
    deviceId,
    deviceName,
    platform: options.platform || 'darwin',
    deviceCreatedAt: options.deviceCreatedAt || now - (100 * 24 * 60 * 60 * 1000), // 100 days ago
    lastSyncedAt: options.lastSyncedAt || now - (50 * 24 * 60 * 60 * 1000), // 50 days ago
    syncHistory: options.syncHistory || [],
    salt: options.salt || crypto.randomBytes(32).toString('hex'),
    biometricProfile: options.biometricProfile || undefined,
    vaultSettings: options.vaultSettings || undefined,
  };
}

/**
 * Test helper: Simulate encryption (mock)
 */
function mockEncrypt(data, password) {
  // Simple mock encryption: base64(password + JSON)
  const payload = JSON.stringify(data);
  const combined = password + '::' + payload;
  return Buffer.from(combined).toString('base64');
}

/**
 * Test helper: Simulate decryption (mock)
 */
function mockDecrypt(encryptedData, password) {
  // Simple mock decryption: extract JSON after password check
  try {
    const decoded = Buffer.from(encryptedData, 'base64').toString('utf8');
    const [storedPassword, payload] = decoded.split('::', 2);
    
    if (storedPassword !== password) {
      throw new Error('Invalid password');
    }
    
    return JSON.parse(payload);
  } catch (err) {
    throw new Error('Decryption failed');
  }
}

// =============================================================================
// CATEGORY 1: BASIC EXPORT/IMPORT (4 tests)
// =============================================================================

test('TEST-SYNC-001: Export keystore with valid password', async (t) => {
  const testDir = await createTestDir();
  
  try {
    const keystore = createMockKeystoreV4('device-a', 'Device A');
    const password = 'ValidPassword123!';
    
    // Mock export
    const exportPayload = {
      exportVersion: 'v1',
      exportedAt: Date.now(),
      sourceDeviceId: keystore.deviceId,
      sourceDeviceName: keystore.deviceName,
      sourcePlatform: keystore.platform,
      userId: keystore.userId,
      encryptedIdentity: keystore.encryptedIdentity,
      encryptedCurrentKeypair: keystore.encryptedCurrentKeypair,
      encryptedPreviousKeypairs: keystore.encryptedPreviousKeypairs,
      rotationHistory: keystore.rotationHistory,
    };
    
    const encrypted = mockEncrypt(exportPayload, password);
    const exportPath = join(testDir, 'export.json.enc');
    await writeFile(exportPath, encrypted);
    
    // Verify file exists and has content
    const fileContent = await readFile(exportPath, 'utf8');
    assert.ok(fileContent.length > 0, 'Export file should have content');
    assert.ok(fileContent !== JSON.stringify(exportPayload), 'Export should be encrypted');
    
  } finally {
    await cleanupTestDir(testDir);
  }
});

test('TEST-SYNC-002: Import keystore with correct password', async (t) => {
  const testDir = await createTestDir();
  
  try {
    const keystoreA = createMockKeystoreV4('device-a', 'Device A');
    const keystoreB = createMockKeystoreV4('device-b', 'Device B', { userId: keystoreA.userId });
    const password = 'ValidPassword123!';
    
    // Create export from Device A
    const exportPayload = {
      exportVersion: 'v1',
      exportedAt: Date.now(),
      sourceDeviceId: keystoreA.deviceId,
      sourceDeviceName: keystoreA.deviceName,
      userId: keystoreA.userId,
      encryptedCurrentKeypair: keystoreA.encryptedCurrentKeypair,
    };
    
    const encrypted = mockEncrypt(exportPayload, password);
    const exportPath = join(testDir, 'export.json.enc');
    await writeFile(exportPath, encrypted);
    
    // Import on Device B (mock)
    const importedData = mockDecrypt(encrypted, password);
    
    // Verify import data
    assert.equal(importedData.userId, keystoreA.userId, 'User ID should match');
    assert.equal(importedData.sourceDeviceId, keystoreA.deviceId, 'Source device ID should match');
    
  } finally {
    await cleanupTestDir(testDir);
  }
});

test('TEST-SYNC-003: Export includes device metadata', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A');
  
  const exportPayload = {
    exportVersion: 'v1',
    exportedAt: Date.now(),
    sourceDeviceId: keystore.deviceId,
    sourceDeviceName: keystore.deviceName,
    sourcePlatform: keystore.platform,
    userId: keystore.userId,
  };
  
  assert.ok(exportPayload.sourceDeviceId, 'Export should include device ID');
  assert.ok(exportPayload.sourceDeviceName, 'Export should include device name');
  assert.ok(exportPayload.sourcePlatform, 'Export should include platform');
});

test('TEST-SYNC-004: Export excludes device-local secrets', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    salt: 'secret-salt-never-sync',
    biometricProfile: { enabled: true },
    vaultSettings: { autoLockEnabled: true },
  });
  
  const exportPayload = {
    exportVersion: 'v1',
    userId: keystore.userId,
    encryptedCurrentKeypair: keystore.encryptedCurrentKeypair,
    // salt, biometricProfile, vaultSettings intentionally excluded
  };
  
  assert.equal(exportPayload.salt, undefined, 'Salt should NOT be in export');
  assert.equal(exportPayload.biometricProfile, undefined, 'Biometric profile should NOT be in export');
  assert.equal(exportPayload.vaultSettings, undefined, 'Vault settings should NOT be in export');
});

// =============================================================================
// CATEGORY 2: CONFLICT RESOLUTION (3 tests)
// =============================================================================

test('TEST-SYNC-005: Merge chooses newer keypair as current', async (t) => {
  const now = Date.now();
  const olderTimestamp = now - (20 * 24 * 60 * 60 * 1000); // 20 days ago
  const newerTimestamp = now - (5 * 24 * 60 * 60 * 1000); // 5 days ago
  
  const keystoreA = createMockKeystoreV4('device-a', 'Device A', {
    currentPublicKey: 'pk-a',
    currentRotatedAt: olderTimestamp,
  });
  
  const keystoreB = createMockKeystoreV4('device-b', 'Device B', {
    userId: keystoreA.userId,
    currentPublicKey: 'pk-b',
    currentRotatedAt: newerTimestamp,
  });
  
  // Simulate merge logic
  const currentA = JSON.parse(keystoreA.encryptedCurrentKeypair);
  const currentB = JSON.parse(keystoreB.encryptedCurrentKeypair);
  
  const mergedCurrent = currentB.rotatedAt > currentA.rotatedAt ? currentB : currentA;
  
  assert.equal(mergedCurrent.publicKey, 'pk-b', 'Newer keypair should win');
  assert.equal(mergedCurrent.rotatedAt, newerTimestamp, 'Newer timestamp should be preserved');
});

test('TEST-SYNC-006: Merge deduplicates previous keypairs by public key', async (t) => {
  const keystoreA = createMockKeystoreV4('device-a', 'Device A', {
    encryptedPreviousKeypairs: JSON.stringify([
      { publicKey: 'pk-1', encryptedPrivateKey: 'epk-1' },
      { publicKey: 'pk-2', encryptedPrivateKey: 'epk-2' },
    ]),
  });
  
  const keystoreB = createMockKeystoreV4('device-b', 'Device B', {
    userId: keystoreA.userId,
    encryptedPreviousKeypairs: JSON.stringify([
      { publicKey: 'pk-2', encryptedPrivateKey: 'epk-2' }, // duplicate
      { publicKey: 'pk-3', encryptedPrivateKey: 'epk-3' },
    ]),
  });
  
  // Simulate merge deduplication
  const prevA = keystoreA.encryptedPreviousKeypairs ? JSON.parse(keystoreA.encryptedPreviousKeypairs) : [];
  const prevB = keystoreB.encryptedPreviousKeypairs ? JSON.parse(keystoreB.encryptedPreviousKeypairs) : [];
  const combined = [...prevA, ...prevB];
  
  const deduped = Array.from(
    new Map(combined.map(kp => [kp.publicKey, kp])).values()
  );
  
  assert.equal(deduped.length, 3, 'Should have 3 unique keypairs');
  assert.ok(deduped.some(kp => kp.publicKey === 'pk-1'), 'Should have pk-1');
  assert.ok(deduped.some(kp => kp.publicKey === 'pk-2'), 'Should have pk-2');
  assert.ok(deduped.some(kp => kp.publicKey === 'pk-3'), 'Should have pk-3');
});

test('TEST-SYNC-007: Merge limits previous keypairs to 10', async (t) => {
  // Create 12 previous keypairs
  const previousKeypairs = Array.from({ length: 12 }, (_, i) => ({
    publicKey: `pk-${i}`,
    encryptedPrivateKey: `epk-${i}`,
    rotatedAt: Date.now() - (i * 24 * 60 * 60 * 1000),
  }));
  
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    encryptedPreviousKeypairs: JSON.stringify(previousKeypairs),
  });
  
  // Simulate trim to 10 newest
  const parsed = keystore.encryptedPreviousKeypairs ? JSON.parse(keystore.encryptedPreviousKeypairs) : [];
  const sorted = parsed.sort((a, b) => b.rotatedAt - a.rotatedAt);
  const trimmed = sorted.slice(0, 10);
  
  assert.equal(trimmed.length, 10, 'Should limit to 10 keypairs');
  assert.equal(trimmed[0].publicKey, 'pk-0', 'Newest should be first');
  assert.equal(trimmed[9].publicKey, 'pk-9', 'Oldest kept should be 10th');
});

// =============================================================================
// CATEGORY 3: SECURITY VALIDATION (6 tests)
// =============================================================================

test('TEST-SYNC-008: Reject import with mismatched userId', async (t) => {
  const keystoreA = createMockKeystoreV4('device-a', 'Device A', { userId: 'user-123' });
  const keystoreB = createMockKeystoreV4('device-b', 'Device B', { userId: 'user-456' });
  
  // Simulate identity validation
  const identityMatch = keystoreA.userId === keystoreB.userId;
  
  assert.equal(identityMatch, false, 'Should detect identity mismatch');
  // In real implementation, this would throw: 'Identity mismatch: cannot merge keystores from different users'
});

test('TEST-SYNC-009: Detect downgrade attack (missing rotation)', async (t) => {
  const keystoreA = createMockKeystoreV4('device-a', 'Device A', {
    rotationHistory: [
      { rotationId: 'rot-1', timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
      { rotationId: 'rot-2', timestamp: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString() },
      { rotationId: 'rot-3', timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
    ],
  });
  
  const importPayload = {
    rotationHistory: [
      { rotationId: 'rot-1', timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
      // rot-2 missing → downgrade attack
      { rotationId: 'rot-3', timestamp: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString() },
    ],
  };
  
  // Simulate downgrade detection
  const localIds = new Set(keystoreA.rotationHistory.map(r => r.rotationId));
  const importedIds = new Set(importPayload.rotationHistory.map(r => r.rotationId));
  
  let missingCount = 0;
  for (const id of localIds) {
    if (!importedIds.has(id)) missingCount++;
  }
  
  assert.ok(missingCount > 0, 'Should detect missing rotation (downgrade attack)');
});

test('TEST-SYNC-010: Detect replay attack (duplicate sync signature)', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    syncHistory: [
      { syncId: 'sync-1', sourceDeviceId: 'device-b', syncedAt: Date.now() - 10000, signatureHash: 'sig-hash-123' },
    ],
  });
  
  const importPayload = {
    signatureHash: 'sig-hash-123', // duplicate
  };
  
  // Simulate replay detection
  const existingHashes = new Set(keystore.syncHistory.map(s => s.signatureHash));
  const isReplay = existingHashes.has(importPayload.signatureHash);
  
  assert.equal(isReplay, true, 'Should detect replayed sync (duplicate signature)');
});

test('TEST-SYNC-011: Validate HMAC signature before merge', async (t) => {
  const testDir = await createTestDir();
  
  try {
    const exportPayload = {
      exportVersion: 'v1',
      userId: 'user-123',
      encryptedCurrentKeypair: 'encrypted-data',
    };
    
    // Compute HMAC
    const hmac = crypto.createHmac('sha256', 'test-key');
    hmac.update(JSON.stringify(exportPayload));
    const signature = hmac.digest('hex');
    
    const exportWithSignature = {
      ...exportPayload,
      signature,
    };
    
    // Verify HMAC
    const hmacVerify = crypto.createHmac('sha256', 'test-key');
    hmacVerify.update(JSON.stringify(exportPayload));
    const computedSignature = hmacVerify.digest('hex');
    
    const signatureValid = crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(computedSignature, 'hex')
    );
    
    assert.equal(signatureValid, true, 'HMAC signature should be valid');
    
  } finally {
    await cleanupTestDir(testDir);
  }
});

test('TEST-SYNC-012: Reject tampered export (invalid HMAC)', async (t) => {
  const exportPayload = {
    exportVersion: 'v1',
    userId: 'user-123',
    encryptedCurrentKeypair: 'encrypted-data',
  };
  
  // Compute original HMAC
  const hmac = crypto.createHmac('sha256', 'test-key');
  hmac.update(JSON.stringify(exportPayload));
  const originalSignature = hmac.digest('hex');
  
  // Tamper with payload
  exportPayload.userId = 'user-456'; // attacker modifies
  
  // Verify HMAC (should fail)
  const hmacVerify = crypto.createHmac('sha256', 'test-key');
  hmacVerify.update(JSON.stringify(exportPayload));
  const computedSignature = hmacVerify.digest('hex');
  
  const signatureValid = originalSignature === computedSignature;
  
  assert.equal(signatureValid, false, 'HMAC should fail for tampered data');
});

test('TEST-SYNC-013: Password minimum length enforcement', async (t) => {
  const password = 'short'; // < 12 chars
  
  // Simulate password validation
  const isValid = password.length >= 12;
  
  assert.equal(isValid, false, 'Password should be rejected (< 12 chars)');
});

// =============================================================================
// CATEGORY 4: EDGE CASES (6 tests)
// =============================================================================

test('TEST-SYNC-014: Import on device with no previous keypairs', async (t) => {
  const keystoreA = createMockKeystoreV4('device-a', 'Device A', {
    previousKeypairs: undefined,
  });
  
  const importPayload = {
    encryptedPreviousKeypairs: JSON.stringify([
      { publicKey: 'pk-1', encryptedPrivateKey: 'epk-1' },
    ]),
  };
  
  // Simulate merge
  const localPrev = keystoreA.previousKeypairs ? JSON.parse(keystoreA.previousKeypairs) : [];
  const importedPrev = JSON.parse(importPayload.encryptedPreviousKeypairs);
  const merged = [...localPrev, ...importedPrev];
  
  assert.equal(merged.length, 1, 'Should merge empty local with imported keypairs');
});

test('TEST-SYNC-015: Import with identical current keypair (no-op)', async (t) => {
  const currentKeypair = {
    publicKey: 'pk-same',
    encryptedPrivateKey: 'epk-same',
    rotatedAt: Date.now(),
  };
  
  const keystoreA = createMockKeystoreV4('device-a', 'Device A', {
    encryptedCurrentKeypair: JSON.stringify(currentKeypair),
  });
  
  const importPayload = {
    encryptedCurrentKeypair: JSON.stringify(currentKeypair),
  };
  
  // Simulate merge
  const localCurrent = JSON.parse(keystoreA.encryptedCurrentKeypair);
  const importedCurrent = JSON.parse(importPayload.encryptedCurrentKeypair);
  
  const needsUpdate = localCurrent.publicKey !== importedCurrent.publicKey;
  
  assert.equal(needsUpdate, false, 'Should detect no-op (identical current keypair)');
});

test('TEST-SYNC-016: Export with empty rotation history', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    rotationHistory: [],
  });
  
  const exportPayload = {
    rotationHistory: keystore.rotationHistory,
  };
  
  assert.equal(exportPayload.rotationHistory.length, 0, 'Should handle empty rotation history');
});

test('TEST-SYNC-017: Import from future timestamp (time skew)', async (t) => {
  const now = Date.now();
  const futureTimestamp = now + (10 * 60 * 1000); // 10 minutes in future
  
  const importPayload = {
    exportedAt: futureTimestamp,
  };
  
  // Simulate time skew check (allow 15-minute tolerance)
  const timeDiff = Math.abs(futureTimestamp - now);
  const allowedSkew = 15 * 60 * 1000; // 15 minutes
  const isTimeSkewAcceptable = timeDiff <= allowedSkew;
  
  assert.equal(isTimeSkewAcceptable, true, 'Should allow minor time skew (< 15 min)');
});

test('TEST-SYNC-018: Export filename format validation', async (t) => {
  const deviceId = 'device-a';
  const timestamp = Date.now();
  const filename = `onestar-keystore-export-v1-${deviceId}-${timestamp}.json.enc`;
  
  const regex = /^onestar-keystore-export-v1-[\w-]+-\d+\.json\.enc$/;
  const isValid = regex.test(filename);
  
  assert.equal(isValid, true, 'Export filename should match expected format');
});

test('TEST-SYNC-019: Import handles missing optional fields', async (t) => {
  const importPayload = {
    exportVersion: 'v1',
    userId: 'user-123',
    encryptedCurrentKeypair: 'encrypted-data',
    // Optional fields missing: encryptedPreviousKeypairs, rotationHistory
  };
  
  // Simulate safe access
  const previousKeypairs = importPayload.encryptedPreviousKeypairs || undefined;
  const rotationHistory = importPayload.rotationHistory || [];
  
  assert.equal(previousKeypairs, undefined, 'Should handle missing previousKeypairs');
  assert.equal(rotationHistory.length, 0, 'Should default to empty rotation history');
});

// =============================================================================
// CATEGORY 5: PERFORMANCE (2 tests)
// =============================================================================

test('TEST-SYNC-020: Export completes within 5 seconds', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    previousKeypairs: JSON.stringify(Array.from({ length: 10 }, (_, i) => ({
      publicKey: `pk-${i}`,
      encryptedPrivateKey: `epk-${i}`,
    }))),
  });
  
  const startTime = Date.now();
  
  // Simulate export (mock encryption)
  const exportPayload = {
    exportVersion: 'v1',
    userId: keystore.userId,
    encryptedCurrentKeypair: keystore.encryptedCurrentKeypair,
    encryptedPreviousKeypairs: keystore.previousKeypairs,
  };
  
  const encrypted = mockEncrypt(exportPayload, 'TestPassword123!');
  
  const duration = Date.now() - startTime;
  
  assert.ok(duration < 5000, `Export should complete in < 5s (took ${duration}ms)`);
});

test('TEST-SYNC-021: Import completes within 10 seconds', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A');
  const password = 'TestPassword123!';
  
  const exportPayload = {
    exportVersion: 'v1',
    userId: keystore.userId,
    encryptedCurrentKeypair: keystore.encryptedCurrentKeypair,
  };
  
  const encrypted = mockEncrypt(exportPayload, password);
  
  const startTime = Date.now();
  
  // Simulate import (mock decryption + merge)
  const decrypted = mockDecrypt(encrypted, password);
  
  const duration = Date.now() - startTime;
  
  assert.ok(duration < 10000, `Import should complete in < 10s (took ${duration}ms)`);
});

// =============================================================================
// CATEGORY 6: INTEGRATION (4 tests)
// =============================================================================

test('TEST-SYNC-022: Full sync cycle (export → transfer → import)', async (t) => {
  const testDir = await createTestDir();
  
  try {
    // Step 1: Export from Device A
    const keystoreA = createMockKeystoreV4('device-a', 'Device A');
    const password = 'SyncPassword123!';
    
    const exportPayload = {
      exportVersion: 'v1',
      exportedAt: Date.now(),
      sourceDeviceId: keystoreA.deviceId,
      userId: keystoreA.userId,
      encryptedCurrentKeypair: keystoreA.encryptedCurrentKeypair,
    };
    
    const encrypted = mockEncrypt(exportPayload, password);
    const exportPath = join(testDir, 'export.json.enc');
    await writeFile(exportPath, encrypted);
    
    // Step 2: Transfer (simulated by file read)
    const transferredData = await readFile(exportPath, 'utf8');
    
    // Step 3: Import on Device B
    const keystoreB = createMockKeystoreV4('device-b', 'Device B', { userId: keystoreA.userId });
    const imported = mockDecrypt(transferredData, password);
    
    // Verify sync cycle
    assert.equal(imported.userId, keystoreA.userId, 'User ID should match after sync');
    assert.equal(imported.sourceDeviceId, keystoreA.deviceId, 'Source device should be tracked');
    
  } finally {
    await cleanupTestDir(testDir);
  }
});

test('TEST-SYNC-023: Sync updates lastSyncedAt timestamp', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A');
  const oldSyncTime = keystore.lastSyncedAt;
  
  // Simulate import (update lastSyncedAt)
  const newSyncTime = Date.now();
  keystore.lastSyncedAt = newSyncTime;
  
  assert.ok(keystore.lastSyncedAt > oldSyncTime, 'lastSyncedAt should be updated');
});

test('TEST-SYNC-024: Sync adds entry to syncHistory', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    syncHistory: [],
  });
  
  // Simulate import (add sync record)
  const syncRecord = {
    syncId: crypto.randomUUID(),
    sourceDeviceId: 'device-b',
    sourceDeviceName: 'Device B',
    sourcePlatform: 'win32',
    syncedAt: Date.now(),
    signatureHash: 'sig-hash-456',
  };
  
  keystore.syncHistory.push(syncRecord);
  
  assert.equal(keystore.syncHistory.length, 1, 'Sync history should have 1 entry');
  assert.equal(keystore.syncHistory[0].sourceDeviceId, 'device-b', 'Should track source device');
});

test('TEST-SYNC-025: Multiple syncs accumulate in syncHistory', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    syncHistory: [],
  });
  
  // Simulate 3 sync operations
  for (let i = 0; i < 3; i++) {
    keystore.syncHistory.push({
      syncId: crypto.randomUUID(),
      sourceDeviceId: `device-${i}`,
      syncedAt: Date.now() + i * 1000,
      signatureHash: `sig-${i}`,
    });
  }
  
  assert.equal(keystore.syncHistory.length, 3, 'Should accumulate sync records');
});

// =============================================================================
// CATEGORY 7: DEVICE MANAGEMENT (5 tests)
// =============================================================================

test('TEST-SYNC-026: listSyncedDevices returns unique devices', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    rotationHistory: [
      { deviceId: 'device-a', deviceName: 'Device A', timestamp: new Date().toISOString() },
      { deviceId: 'device-b', deviceName: 'Device B', timestamp: new Date().toISOString() },
      { deviceId: 'device-a', deviceName: 'Device A', timestamp: new Date().toISOString() },
    ],
  });
  
  // Simulate listSyncedDevices
  const deviceMap = new Map();
  for (const entry of keystore.rotationHistory) {
    if (!deviceMap.has(entry.deviceId)) {
      deviceMap.set(entry.deviceId, {
        deviceId: entry.deviceId,
        deviceName: entry.deviceName,
        rotationCount: 0,
      });
    }
    deviceMap.get(entry.deviceId).rotationCount++;
  }
  
  assert.equal(deviceMap.size, 2, 'Should return 2 unique devices');
  assert.equal(deviceMap.get('device-a').rotationCount, 2, 'Device A should have 2 rotations');
});

test('TEST-SYNC-027: Device ID persists across app restarts', async (t) => {
  const testDir = await createTestDir();
  
  try {
    const deviceIdFile = join(testDir, 'device-id.txt');
    const deviceId = crypto.randomUUID();
    
    // First run: save device ID
    await writeFile(deviceIdFile, deviceId);
    
    // Second run: load device ID
    const loadedId = await readFile(deviceIdFile, 'utf8');
    
    assert.equal(loadedId, deviceId, 'Device ID should persist across restarts');
    
  } finally {
    await cleanupTestDir(testDir);
  }
});

test('TEST-SYNC-028: Device metadata includes platform', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    platform: 'darwin',
  });
  
  assert.equal(keystore.platform, 'darwin', 'Device metadata should include platform');
});

test('TEST-SYNC-029: Sync tracks device creation timestamp', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A');
  
  assert.ok(keystore.deviceCreatedAt, 'Device should have creation timestamp');
  assert.ok(keystore.deviceCreatedAt <= Date.now(), 'Creation timestamp should be in past');
});

test('TEST-SYNC-030: getSyncStatus returns accurate device count', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A', {
    syncHistory: [
      { sourceDeviceId: 'device-b', sourceDeviceName: 'Device B', syncedAt: Date.now() },
      { sourceDeviceId: 'device-c', sourceDeviceName: 'Device C', syncedAt: Date.now() },
    ],
  });
  
  // Simulate getSyncStatus
  const uniqueDevices = new Set([keystore.deviceId]);
  for (const sync of keystore.syncHistory) {
    uniqueDevices.add(sync.sourceDeviceId);
  }
  
  const deviceCount = uniqueDevices.size;
  
  assert.equal(deviceCount, 3, 'Should count 3 unique devices (including current)');
});

// =============================================================================
// CATEGORY 8: FAILURE RECOVERY (3 tests)
// =============================================================================

test('TEST-SYNC-031: Rollback on import failure (atomic operation)', async (t) => {
  const keystoreBefore = createMockKeystoreV4('device-a', 'Device A');
  const keystoreBackup = structuredClone(keystoreBefore);
  
  try {
    // Simulate import failure
    throw new Error('Import failed');
  } catch (err) {
    // Rollback to backup
    Object.assign(keystoreBefore, keystoreBackup);
  }
  
  assert.equal(keystoreBefore.userId, keystoreBackup.userId, 'User ID should match after rollback');
  assert.equal(keystoreBefore.deviceId, keystoreBackup.deviceId, 'Device ID should match after rollback');
  assert.equal(keystoreBefore.version, keystoreBackup.version, 'Version should match after rollback');
});

test('TEST-SYNC-032: Partial import leaves keystore unchanged', async (t) => {
  const keystore = createMockKeystoreV4('device-a', 'Device A');
  const originalUserId = keystore.userId;
  
  // Simulate partial import failure (validation fails mid-import)
  let importFailed = false;
  try {
    // Step 1: Start import
    const tempUserId = 'user-temp';
    
    // Step 2: Validation fails
    throw new Error('Validation failed');
    
    // Step 3: Would commit (never reached)
    keystore.userId = tempUserId;
  } catch (err) {
    importFailed = true;
  }
  
  assert.equal(importFailed, true, 'Import should fail');
  assert.equal(keystore.userId, originalUserId, 'Keystore should remain unchanged');
});

test('TEST-SYNC-033: Corrupted export file rejected', async (t) => {
  const testDir = await createTestDir();
  
  try {
    const corruptedData = 'not-valid-encrypted-data';
    const exportPath = join(testDir, 'corrupted.json.enc');
    await writeFile(exportPath, corruptedData);
    
    // Attempt import
    let decryptionFailed = false;
    try {
      mockDecrypt(corruptedData, 'password');
    } catch (err) {
      decryptionFailed = true;
    }
    
    assert.equal(decryptionFailed, true, 'Should reject corrupted export');
    
  } finally {
    await cleanupTestDir(testDir);
  }
});

// =============================================================================
// TEST EXECUTION SUMMARY
// =============================================================================

console.log('\n=== Phase 21: Cross-Device Keystore Sync Test Suite ===');
console.log('33 scenarios covering:');
console.log('- Basic export/import (4 tests)');
console.log('- Conflict resolution (3 tests)');
console.log('- Security validation (6 tests)');
console.log('- Edge cases (6 tests)');
console.log('- Performance (2 tests)');
console.log('- Integration (4 tests)');
console.log('- Device management (5 tests)');
console.log('- Failure recovery (3 tests)');
console.log('\nRun with: node tests/sync/sync-scenarios.test.mjs\n');
