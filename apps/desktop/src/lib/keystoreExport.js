"use strict";
/**
 * Keystore Export & Import with End-to-End Encryption
 *
 * Phase 21: Cross-Device Keystore Sync
 *
 * Export Format: onestar-keystore-export-v1.json.enc
 * - AES-256-GCM encryption
 * - PBKDF2-SHA512 key derivation (100k iterations)
 * - HMAC-SHA256 signature for tamper detection
 * - SHA-256 checksum for integrity verification
 *
 * SECURITY:
 * - Only syncable fields exported (no device-local secrets)
 * - Password confirmation required
 * - Signature validation prevents tampering
 * - Downgrade attack detection
 * - Replay attack prevention
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.exportKeystore = exportKeystore;
exports.importKeystore = importKeystore;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
const keystoreV4_1 = require("./keystoreV4");
const keystoreMerge_1 = require("./keystoreMerge");
// === CONSTANTS ===
const EXPORT_KDF_ITERATIONS = 100000; // 100k iterations (~1 second)
const EXPORT_KEY_LENGTH = 32; // 256-bit key
const EXPORT_IV_LENGTH = 12; // GCM standard IV
const EXPORT_SALT_LENGTH = 32; // 256-bit salt
const EXPORT_VERSION = 'v1';
// === EXPORT FUNCTIONS ===
/**
 * Export keystore to encrypted file
 *
 * @param password - Export password
 * @param confirmPassword - Password confirmation
 * @param outputPath - Optional output file path
 * @returns Export result with file path
 */
async function exportKeystore(password, confirmPassword, outputPath) {
    try {
        // Step 1: Validate password confirmation
        if (password !== confirmPassword) {
            return {
                success: false,
                error: 'Password confirmation mismatch',
            };
        }
        if (password.length < 8) {
            return {
                success: false,
                error: 'Export password must be at least 8 characters',
            };
        }
        // Step 2: Load current keystore v4
        const keystore = await (0, keystoreV4_1.loadKeystoreV4)();
        if (!keystore) {
            return {
                success: false,
                error: 'No keystore found',
            };
        }
        console.log(`[Export] Exporting keystore from device: ${keystore.deviceName}`);
        // Step 3: Build export payload (syncable fields only)
        const exportPayload = {
            exportVersion: EXPORT_VERSION,
            exportedAt: Date.now(),
            sourceDeviceId: keystore.deviceId,
            sourceDeviceName: keystore.deviceName,
            keystore: {
                userId: keystore.userId,
                encryptedIdentity: keystore.encryptedIdentity,
                encryptedCurrentKeypair: keystore.encryptedCurrentKeypair,
                encryptedPreviousKeypairs: keystore.encryptedPreviousKeypairs,
                rotationHistory: keystore.rotationHistory,
            },
            metadata: {
                keystoreVersion: 'v4',
                schemaVersion: keystore.schemaVersion,
                totalPreviousKeypairs: estimatePreviousKeypairsCount(keystore),
                totalRotations: keystore.rotationHistory.length,
                lastRotationAt: (0, keystoreV4_1.getLastRotationTimestamp)(keystore),
            },
            signature: '',
            checksum: '',
        };
        // Step 4: Compute HMAC signature
        const signatureKey = await deriveSignatureKey(password);
        const dataToSign = JSON.stringify({
            keystore: exportPayload.keystore,
            metadata: exportPayload.metadata,
            exportedAt: exportPayload.exportedAt,
            sourceDeviceId: exportPayload.sourceDeviceId,
        });
        exportPayload.signature = computeHMAC(dataToSign, signatureKey);
        exportPayload.checksum = computeSHA256(dataToSign);
        // Step 5: Encrypt with AES-GCM
        const exportSalt = crypto.randomBytes(EXPORT_SALT_LENGTH);
        const exportIV = crypto.randomBytes(EXPORT_IV_LENGTH);
        const encryptionKey = await deriveEncryptionKey(password, exportSalt);
        const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, exportIV);
        const plaintext = JSON.stringify(exportPayload, null, 2);
        const ciphertext = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final(),
        ]);
        const authTag = cipher.getAuthTag();
        // Step 6: Build encrypted file
        const encryptedFile = {
            format: 'onestar-keystore-export-v1',
            encryptionAlgorithm: 'AES-256-GCM',
            kdfAlgorithm: 'PBKDF2-SHA512',
            kdfIterations: EXPORT_KDF_ITERATIONS,
            salt: exportSalt.toString('base64'),
            iv: exportIV.toString('base64'),
            authTag: authTag.toString('base64'),
            ciphertext: ciphertext.toString('base64'),
        };
        // Step 7: Zeroize sensitive data
        encryptionKey.fill(0);
        signatureKey.fill(0);
        // Step 8: Write to file
        const fileContent = JSON.stringify(encryptedFile, null, 2);
        const finalPath = outputPath || generateDefaultExportPath(keystore.deviceName);
        await fs.promises.writeFile(finalPath, fileContent, 'utf8');
        console.log(`[Export] Success: ${finalPath} (${fileContent.length} bytes)`);
        // Step 9: Record export in sync history
        await recordExportOperation(keystore, exportPayload);
        return {
            success: true,
            filePath: finalPath,
            fileSize: fileContent.length,
            exportedAt: exportPayload.exportedAt,
        };
    }
    catch (error) {
        console.error('[Export] Failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
/**
 * Import keystore from encrypted file
 *
 * @param exportFilePath - Path to export file
 * @param password - Decryption password
 * @returns Import result with merge statistics
 */
async function importKeystore(exportFilePath, password) {
    try {
        console.log(`[Import] Importing from: ${exportFilePath}`);
        // Step 1: Read encrypted file
        if (!fs.existsSync(exportFilePath)) {
            return {
                success: false,
                error: `File not found: ${exportFilePath}`,
            };
        }
        const fileContent = await fs.promises.readFile(exportFilePath, 'utf8');
        const encryptedFile = JSON.parse(fileContent);
        // Step 2: Validate file format
        if (encryptedFile.format !== 'onestar-keystore-export-v1') {
            return {
                success: false,
                error: `Unsupported export format: ${encryptedFile.format}`,
            };
        }
        // Step 3: Derive decryption key
        const salt = Buffer.from(encryptedFile.salt, 'base64');
        const decryptionKey = await deriveEncryptionKey(password, salt, encryptedFile.kdfIterations);
        // Step 4: Decrypt with AES-GCM (authenticated)
        const iv = Buffer.from(encryptedFile.iv, 'base64');
        const authTag = Buffer.from(encryptedFile.authTag, 'base64');
        const ciphertext = Buffer.from(encryptedFile.ciphertext, 'base64');
        const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, iv);
        decipher.setAuthTag(authTag);
        let plaintext;
        try {
            plaintext = Buffer.concat([
                decipher.update(ciphertext),
                decipher.final(),
            ]).toString('utf8');
        }
        catch (error) {
            decryptionKey.fill(0);
            return {
                success: false,
                error: 'Decryption failed: Invalid password or corrupted file',
            };
        }
        const exportPayload = JSON.parse(plaintext);
        // Step 5: Verify HMAC signature
        const signatureKey = await deriveSignatureKey(password);
        const dataToVerify = JSON.stringify({
            keystore: exportPayload.keystore,
            metadata: exportPayload.metadata,
            exportedAt: exportPayload.exportedAt,
            sourceDeviceId: exportPayload.sourceDeviceId,
        });
        const expectedSignature = computeHMAC(dataToVerify, signatureKey);
        if (!crypto.timingSafeEqual(Buffer.from(exportPayload.signature, 'base64'), Buffer.from(expectedSignature, 'base64'))) {
            decryptionKey.fill(0);
            signatureKey.fill(0);
            return {
                success: false,
                error: 'Signature verification failed: File may be tampered',
            };
        }
        // Step 6: Verify checksum
        const expectedChecksum = computeSHA256(dataToVerify);
        if (exportPayload.checksum !== expectedChecksum) {
            decryptionKey.fill(0);
            signatureKey.fill(0);
            return {
                success: false,
                error: 'Checksum mismatch: File corrupted',
            };
        }
        // Step 7: Validate rotation chain integrity
        try {
            (0, keystoreV4_1.validateRotationChainIntegrity)(exportPayload.keystore.rotationHistory);
        }
        catch (error) {
            return {
                success: false,
                error: `Rotation chain validation failed: ${error instanceof Error ? error.message : 'unknown'}`,
            };
        }
        // Step 8: Load current keystore
        const currentKeystore = await (0, keystoreV4_1.loadKeystoreV4)();
        if (!currentKeystore) {
            decryptionKey.fill(0);
            signatureKey.fill(0);
            return {
                success: false,
                error: 'No local keystore found. Please initialize keystore first.',
            };
        }
        // Step 9: Validate identity match
        if (currentKeystore.userId !== exportPayload.keystore.userId) {
            decryptionKey.fill(0);
            signatureKey.fill(0);
            return {
                success: false,
                error: 'Identity mismatch: Cannot import keystore from different user',
            };
        }
        // Step 10: Detect attacks
        try {
            validateNoDowngradeAttack(currentKeystore, exportPayload);
            validateSyncNotReplayed(currentKeystore, exportPayload);
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Security validation failed',
            };
        }
        console.log(`[Import] Validation passed, merging keystore from ${exportPayload.sourceDeviceName}...`);
        // Step 11: Merge keystores
        const mergeResult = await (0, keystoreMerge_1.mergeKeystores)(currentKeystore, exportPayload);
        // Step 12: Save merged keystore
        await (0, keystoreV4_1.saveKeystoreV4)(mergeResult.mergedKeystore);
        // Step 13: Zeroize sensitive data
        decryptionKey.fill(0);
        signatureKey.fill(0);
        console.log(`[Import] Success: ${mergeResult.stats.rotationHistoryMerged} rotations merged, ${mergeResult.stats.conflictsResolved} conflicts resolved`);
        return {
            success: true,
            sourceDevice: exportPayload.sourceDeviceName,
            sourceDeviceId: exportPayload.sourceDeviceId,
            keypairsUpdated: mergeResult.stats.keypairsUpdated,
            previousKeypairsMerged: mergeResult.stats.previousKeypairsMerged,
            rotationHistoryMerged: mergeResult.stats.rotationHistoryMerged,
            conflictsResolved: mergeResult.stats.conflictsResolved,
        };
    }
    catch (error) {
        console.error('[Import] Failed:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}
// === CRYPTOGRAPHIC PRIMITIVES ===
/**
 * Derive encryption key from password using PBKDF2-SHA512
 */
async function deriveEncryptionKey(password, salt, iterations = EXPORT_KDF_ITERATIONS) {
    return new Promise((resolve, reject) => {
        crypto.pbkdf2(password, salt, iterations, EXPORT_KEY_LENGTH, 'sha512', (err, derivedKey) => {
            if (err)
                reject(err);
            else
                resolve(derivedKey);
        });
    });
}
/**
 * Derive signature key from password (separate from encryption key)
 */
async function deriveSignatureKey(password) {
    const sigSalt = Buffer.from('onestar-export-signature-v1', 'utf8');
    return deriveEncryptionKey(password, sigSalt, EXPORT_KDF_ITERATIONS);
}
/**
 * Compute HMAC-SHA256 signature
 */
function computeHMAC(data, key) {
    const hmac = crypto.createHmac('sha256', key);
    hmac.update(data, 'utf8');
    return hmac.digest('base64');
}
/**
 * Compute SHA-256 checksum
 */
function computeSHA256(data) {
    const hash = crypto.createHash('sha256');
    hash.update(data, 'utf8');
    return hash.digest('base64');
}
// === SECURITY VALIDATION ===
/**
 * Validate no downgrade attack
 */
function validateNoDowngradeAttack(local, imported) {
    // Check 1: All local rotations must exist in imported
    const localRotationIds = new Set(local.rotationHistory.map(r => r.rotationId));
    const importedRotationIds = new Set(imported.keystore.rotationHistory.map(r => r.rotationId));
    const missingRotations = [];
    for (const localId of localRotationIds) {
        if (!importedRotationIds.has(localId)) {
            missingRotations.push(localId);
        }
    }
    if (missingRotations.length > 0) {
        throw new Error(`Downgrade attack detected: ${missingRotations.length} local rotations missing in import`);
    }
    // Check 2: Timestamp regression check
    const localLastRotation = local.rotationHistory[local.rotationHistory.length - 1];
    const importedLastRotation = imported.keystore.rotationHistory[imported.keystore.rotationHistory.length - 1];
    if (localLastRotation && importedLastRotation) {
        const timeDiff = localLastRotation.timestamp - importedLastRotation.timestamp;
        if (timeDiff > 30 * 86400000) {
            // More than 30 days older
            console.warn('[Import] Warning: Imported keystore is >30 days older than local');
            // Allow but log for audit
        }
    }
}
/**
 * Validate sync not replayed
 */
function validateSyncNotReplayed(local, imported) {
    // Check if this exact export was already imported
    const importSignature = imported.signature;
    const alreadyImported = local.syncHistory.some(sync => sync.signature === importSignature);
    if (alreadyImported) {
        throw new Error('Replay attack detected: This export was already imported');
    }
    // Check timestamp is reasonable
    const now = Date.now();
    const exportAge = now - imported.exportedAt;
    if (exportAge > 30 * 86400000) {
        console.warn('[Import] Warning: Export is >30 days old');
    }
    if (imported.exportedAt > now + 3600000) {
        throw new Error('Invalid export: Timestamp is in the future');
    }
}
// === UTILITY FUNCTIONS ===
/**
 * Generate default export file path
 */
function generateDefaultExportPath(deviceName) {
    const downloadsPath = electron_1.app.getPath('downloads');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeDeviceName = deviceName.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `onestar-keystore-export-v1-${safeDeviceName}-${timestamp}.json.enc`;
    return path.join(downloadsPath, filename);
}
/**
 * Estimate previous keypairs count (without decryption)
 */
function estimatePreviousKeypairsCount(keystore) {
    if (!keystore.encryptedPreviousKeypairs) {
        return 0;
    }
    try {
        const estimatedSize = Buffer.from(keystore.encryptedPreviousKeypairs, 'base64').length;
        const avgKeypairSize = 5000; // Approximate bytes per encrypted keypair
        return Math.floor(estimatedSize / avgKeypairSize);
    }
    catch (error) {
        return 0;
    }
}
/**
 * Record export operation in sync history
 */
async function recordExportOperation(keystore, exportPayload) {
    const syncRecord = {
        syncId: crypto.randomUUID(),
        timestamp: exportPayload.exportedAt,
        sourceDeviceId: keystore.deviceId,
        sourceDeviceName: keystore.deviceName,
        targetDeviceId: 'unknown', // Will be filled by importer
        syncType: 'export',
        keypairsUpdated: false,
        previousKeypairsMerged: 0,
        rotationHistoryMerged: 0,
        conflictsResolved: 0,
        signature: exportPayload.signature,
    };
    keystore.syncHistory.push(syncRecord);
    keystore.lastSyncedAt = exportPayload.exportedAt;
    await (0, keystoreV4_1.saveKeystoreV4)(keystore);
}
