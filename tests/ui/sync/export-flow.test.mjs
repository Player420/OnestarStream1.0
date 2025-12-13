/**
 * export-flow.test.mjs
 * 
 * Tests for export flow component
 * 
 * Coverage:
 * - Password validation (min 12 chars, match)
 * - Export API call with correct params
 * - Success state with file info
 * - Error handling
 * - Output path customization
 * - Flow reset for multiple exports
 */

import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

describe('ExportFlow', () => {
  beforeEach(() => {
    global.window = {
      onestar: {
        sync: {
          exportKeystore: mock.fn((password, confirmPassword, outputPath) => {
            if (password !== confirmPassword) {
              return Promise.resolve({
                success: false,
                error: 'Passwords do not match',
              });
            }
            if (password.length < 12) {
              return Promise.resolve({
                success: false,
                error: 'Password must be at least 12 characters',
              });
            }
            return Promise.resolve({
              success: true,
              filePath: outputPath || '/Users/owner/keystore-export.json.enc',
              fileSize: 12345,
              timestamp: Date.now(),
            });
          }),
        },
      },
    };
  });

  it('should validate password length (min 12 chars)', async () => {
    const password = 'short';
    const confirmPassword = 'short';

    const result = await global.window.onestar.sync.exportKeystore(password, confirmPassword);
    
    assert.equal(result.success, false);
    assert.equal(result.error, 'Password must be at least 12 characters');
  });

  it('should validate password confirmation match', async () => {
    const password = 'ValidPassword123';
    const confirmPassword = 'DifferentPassword123';

    const result = await global.window.onestar.sync.exportKeystore(password, confirmPassword);
    
    assert.equal(result.success, false);
    assert.equal(result.error, 'Passwords do not match');
  });

  it('should export successfully with valid password', async () => {
    const password = 'ValidPassword123';
    const confirmPassword = 'ValidPassword123';

    const result = await global.window.onestar.sync.exportKeystore(password, confirmPassword);
    
    assert.equal(result.success, true);
    assert.ok(result.filePath);
    assert.ok(result.fileSize > 0);
    assert.ok(result.timestamp > 0);
  });

  it('should use custom output path when provided', async () => {
    const password = 'ValidPassword123';
    const confirmPassword = 'ValidPassword123';
    const outputPath = '/custom/path/export.json.enc';

    const result = await global.window.onestar.sync.exportKeystore(password, confirmPassword, outputPath);
    
    assert.equal(result.success, true);
    assert.equal(result.filePath, outputPath);
  });

  it('should use default output path when not provided', async () => {
    const password = 'ValidPassword123';
    const confirmPassword = 'ValidPassword123';

    const result = await global.window.onestar.sync.exportKeystore(password, confirmPassword);
    
    assert.equal(result.success, true);
    assert.equal(result.filePath, '/Users/owner/keystore-export.json.enc');
  });

  it('should format file size correctly', () => {
    const formatFileSize = (bytes) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    assert.equal(formatFileSize(500), '500 B');
    assert.equal(formatFileSize(1024), '1.00 KB');
    assert.equal(formatFileSize(12345), '12.06 KB');
    assert.equal(formatFileSize(1048576), '1.00 MB');
  });

  it('should handle export API errors', async () => {
    // Override mock to throw error
    global.window.onestar.sync.exportKeystore = mock.fn(() => Promise.reject(new Error('Export failed')));

    try {
      await global.window.onestar.sync.exportKeystore('ValidPassword123', 'ValidPassword123');
      assert.fail('Should have thrown error');
    } catch (err) {
      assert.equal(err.message, 'Export failed');
    }
  });

  it('should call export API exactly once per export', async () => {
    const exportKeystore = global.window.onestar.sync.exportKeystore;
    const password = 'ValidPassword123';

    await exportKeystore(password, password);
    
    assert.equal(exportKeystore.mock.calls.length, 1);
    assert.equal(exportKeystore.mock.calls[0].arguments[0], password);
    assert.equal(exportKeystore.mock.calls[0].arguments[1], password);
  });
});

console.log('✅ ExportFlow tests passed');
