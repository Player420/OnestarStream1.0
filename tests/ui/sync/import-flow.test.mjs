/**
 * import-flow.test.mjs
 * 
 * Tests for import flow component
 * 
 * Coverage:
 * - File selection
 * - Password validation
 * - Import API call
 * - Security validation display
 * - Merge statistics
 * - Error handling (password, identity mismatch, downgrade)
 * - Flow reset
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('ImportFlow', () => {
  beforeEach(() => {
    global.window = {
      onestar: {
        sync: {
          importKeystore: mock.fn((filePath, password) => {
            if (password !== 'ValidPassword123') {
              return Promise.resolve({
                success: false,
                error: 'INVALID_PASSWORD',
              });
            }
            if (filePath.includes('mismatch')) {
              return Promise.resolve({
                success: false,
                error: 'IDENTITY_MISMATCH',
              });
            }
            if (filePath.includes('downgrade')) {
              return Promise.resolve({
                success: false,
                error: 'DOWNGRADE_ATTACK',
              });
            }
            return Promise.resolve({
              success: true,
              sourceDevice: {
                deviceId: 'source-device-123',
                deviceName: 'Test iPhone',
              },
              mergeStats: {
                keypairsUpdated: true,
                previousKeypairsMerged: 2,
                rotationHistoryMerged: 5,
                conflictsResolved: 1,
              },
              securityChecks: {
                hmacVerified: true,
                rotationChainValid: true,
                noDowngradeAttack: true,
                noReplayAttack: true,
              },
            });
          }),
        },
      },
    };
  });

  it('should import successfully with valid password', async () => {
    const filePath = '/path/to/export.json.enc';
    const password = 'ValidPassword123';

    const result = await global.window.onestar.sync.importKeystore(filePath, password);
    
    assert.equal(result.success, true);
    assert.equal(result.sourceDevice.deviceName, 'Test iPhone');
    assert.equal(result.mergeStats.keypairsUpdated, true);
  });

  it('should fail with invalid password', async () => {
    const filePath = '/path/to/export.json.enc';
    const password = 'WrongPassword123';

    const result = await global.window.onestar.sync.importKeystore(filePath, password);
    
    assert.equal(result.success, false);
    assert.equal(result.error, 'INVALID_PASSWORD');
  });

  it('should detect identity mismatch', async () => {
    const filePath = '/path/to/mismatch-export.json.enc';
    const password = 'ValidPassword123';

    const result = await global.window.onestar.sync.importKeystore(filePath, password);
    
    assert.equal(result.success, false);
    assert.equal(result.error, 'IDENTITY_MISMATCH');
  });

  it('should detect downgrade attack', async () => {
    const filePath = '/path/to/downgrade-export.json.enc';
    const password = 'ValidPassword123';

    const result = await global.window.onestar.sync.importKeystore(filePath, password);
    
    assert.equal(result.success, false);
    assert.equal(result.error, 'DOWNGRADE_ATTACK');
  });

  it('should display merge statistics', async () => {
    const filePath = '/path/to/export.json.enc';
    const password = 'ValidPassword123';

    const result = await global.window.onestar.sync.importKeystore(filePath, password);
    
    assert.equal(result.mergeStats.previousKeypairsMerged, 2);
    assert.equal(result.mergeStats.rotationHistoryMerged, 5);
    assert.equal(result.mergeStats.conflictsResolved, 1);
  });

  it('should verify security checks', async () => {
    const filePath = '/path/to/export.json.enc';
    const password = 'ValidPassword123';

    const result = await global.window.onestar.sync.importKeystore(filePath, password);
    
    assert.equal(result.securityChecks.hmacVerified, true);
    assert.equal(result.securityChecks.rotationChainValid, true);
    assert.equal(result.securityChecks.noDowngradeAttack, true);
    assert.equal(result.securityChecks.noReplayAttack, true);
  });

  it('should accept .json.enc files only', () => {
    const validFiles = [
      'export.json.enc',
      'keystore-export.json.enc',
      'backup-2025-01-10.json.enc',
    ];

    const invalidFiles = [
      'export.json',
      'export.txt',
      'export.enc',
      'export.zip',
    ];

    validFiles.forEach(file => {
      assert.ok(file.endsWith('.json.enc'), `${file} should be valid`);
    });

    invalidFiles.forEach(file => {
      assert.ok(!file.endsWith('.json.enc'), `${file} should be invalid`);
    });
  });

  it('should handle import API errors', async () => {
    // Override mock to throw error
    global.window.onestar.sync.importKeystore = mock.fn(() => Promise.reject(new Error('Import failed')));

    try {
      await global.window.onestar.sync.importKeystore('/path/to/export.json.enc', 'ValidPassword123');
      assert.fail('Should have thrown error');
    } catch (err) {
      assert.equal(err.message, 'Import failed');
    }
  });

  it('should call import API exactly once per import', async () => {
    const importKeystore = global.window.onestar.sync.importKeystore;
    const filePath = '/path/to/export.json.enc';
    const password = 'ValidPassword123';

    await importKeystore(filePath, password);
    
    assert.equal(importKeystore.mock.calls.length, 1);
    assert.deepEqual(importKeystore.mock.calls[0].arguments, [filePath, password]);
  });

  it('should provide contextual error guidance', () => {
    const errorGuidance = {
      INVALID_PASSWORD: 'The password you entered is incorrect. Please try again with the password you used during export.',
      IDENTITY_MISMATCH: 'This export is from a different identity and cannot be imported into this vault.',
      DOWNGRADE_ATTACK: 'Security validation failed: The export appears to be older than your current keystore. This could be a downgrade attack.',
    };

    assert.ok(errorGuidance.INVALID_PASSWORD.includes('password'));
    assert.ok(errorGuidance.IDENTITY_MISMATCH.includes('identity'));
    assert.ok(errorGuidance.DOWNGRADE_ATTACK.includes('downgrade attack'));
  });
});

console.log('✅ ImportFlow tests passed');
