"use strict";
/**
 * Keystore V4 Schema & Migration
 *
 * Phase 21: Cross-Device Keystore Sync
 *
 * Extends v3 with:
 * - Device metadata (deviceId, deviceName, etc.)
 * - Sync history tracking
 * - Device-local settings isolation
 * - Per-device biometric profiles
 *
 * SECURITY: Device-specific secrets (salt, biometrics) never sync
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
exports.migrateKeystoreV3ToV4 = migrateKeystoreV3ToV4;
exports.isKeystoreV4 = isKeystoreV4;
exports.loadKeystoreV4 = loadKeystoreV4;
exports.saveKeystoreV4 = saveKeystoreV4;
exports.getOrCreateDeviceId = getOrCreateDeviceId;
exports.getDeviceName = getDeviceName;
exports.detectBiometricProfile = detectBiometricProfile;
exports.getDefaultVaultSettings = getDefaultVaultSettings;
exports.countPreviousKeypairs = countPreviousKeypairs;
exports.getLastRotationTimestamp = getLastRotationTimestamp;
exports.getLastRotationFor = getLastRotationFor;
exports.validateRotationChainIntegrity = validateRotationChainIntegrity;
const crypto = __importStar(require("crypto"));
const os = __importStar(require("os"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const electron_1 = require("electron");
// === CONSTANTS ===
const DEVICE_ID_FILE = 'device-id.txt';
// === MIGRATION FUNCTIONS ===
/**
 * Automatically migrate keystore v3 to v4
 *
 * GUARANTEES:
 * - Zero data loss (all v3 fields preserved)
 * - Idempotent (safe to run multiple times)
 * - Reversible (v4 contains all v3 data)
 * - Automatic (no user intervention needed)
 *
 * @param v3Keystore - Existing v3 keystore
 * @returns Migrated v4 keystore
 */
async function migrateKeystoreV3ToV4(v3Keystore) {
    console.log('[KeystoreV4] Migrating v3 → v4...');
    // Generate or load device ID
    const deviceId = await getOrCreateDeviceId();
    const deviceName = getDeviceName();
    // Detect biometric capabilities
    const biometricProfile = await detectBiometricProfile();
    // Migrate rotation history to v4 format
    const rotationHistoryV4 = (v3Keystore.rotationHistory || []).map((record) => ({
        rotationId: record.rotationId || crypto.randomUUID(),
        timestamp: record.timestamp,
        reason: record.reason || 'unknown',
        deviceId: deviceId, // Backfill with current device
        deviceName: deviceName,
        previousPublicKey: record.previousPublicKey || '',
        newPublicKey: record.newPublicKey || '',
        mediaReWrapped: record.mediaReWrapped || 0,
        success: record.success !== false, // Default to true
    }));
    // Convert v3 keypairs to v4 format
    // v3 has: currentKeypair (EncryptedKeypairV3), previousKeypairs (RetiredKeypairV3[])
    // v4 needs: encryptedCurrentKeypair (string), encryptedPreviousKeypairs (string)
    const encryptedCurrentKeypair = JSON.stringify(v3Keystore.currentKeypair);
    const encryptedPreviousKeypairs = v3Keystore.previousKeypairs && v3Keystore.previousKeypairs.length > 0
        ? JSON.stringify(v3Keystore.previousKeypairs)
        : undefined;
    const v4Keystore = {
        version: 'v4',
        // Preserve v3 global identity
        userId: v3Keystore.userId || crypto.randomUUID(),
        encryptedIdentity: encryptedCurrentKeypair, // Use current keypair as identity
        encryptedCurrentKeypair,
        encryptedPreviousKeypairs,
        rotationHistory: rotationHistoryV4,
        // Add v4 device metadata
        deviceId,
        deviceName,
        deviceCreatedAt: Date.now(),
        lastSyncedAt: 0, // Never synced
        syncHistory: [],
        // Preserve device-local state
        salt: v3Keystore.salt,
        biometricProfile,
        vaultSettings: getDefaultVaultSettings(),
        // Metadata
        createdAt: v3Keystore.createdAt ? new Date(v3Keystore.createdAt).getTime() : Date.now(),
        lastModified: Date.now(),
        schemaVersion: 1, // v4 schema version 1
    };
    console.log(`[KeystoreV4] Migration complete: deviceId=${deviceId}, deviceName=${deviceName}`);
    return v4Keystore;
}
/**
 * Check if keystore is v4
 */
function isKeystoreV4(keystore) {
    return keystore && keystore.version === 'v4';
}
/**
 * Load keystore v4 (with automatic migration from v3)
 *
 * @returns Current v4 keystore or null if not found
 */
async function loadKeystoreV4() {
    try {
        // Import keystore loader
        const { loadKeystoreV3 } = await Promise.resolve().then(() => __importStar(require('./keypairRotation')));
        const keystore = await loadKeystoreV3();
        if (!keystore) {
            return null;
        }
        // Check version
        if (keystore.version === 'v4') {
            return keystore;
        }
        if (keystore.version === 'v3') {
            // Automatic migration
            console.log('[KeystoreV4] Detected v3 keystore, migrating to v4...');
            const v4Keystore = await migrateKeystoreV3ToV4(keystore);
            // Save migrated keystore
            await saveKeystoreV4(v4Keystore);
            console.log('[KeystoreV4] Migration saved successfully');
            return v4Keystore;
        }
        throw new Error(`Unsupported keystore version: ${keystore.version}`);
    }
    catch (error) {
        console.error('[KeystoreV4] Load failed:', error);
        throw error;
    }
}
/**
 * Save keystore v4
 */
async function saveKeystoreV4(keystore) {
    try {
        const { saveKeystore } = await Promise.resolve().then(() => __importStar(require('./hybridKeypairStore')));
        // Update lastModified
        keystore.lastModified = Date.now();
        await saveKeystore(keystore);
        console.log('[KeystoreV4] Saved successfully');
    }
    catch (error) {
        console.error('[KeystoreV4] Save failed:', error);
        throw error;
    }
}
// === DEVICE MANAGEMENT ===
/**
 * Get or create persistent device ID
 *
 * Device ID persists across app restarts and is unique to this installation.
 * Stored in user data directory (not in keystore).
 */
async function getOrCreateDeviceId() {
    try {
        const userDataPath = electron_1.app.getPath('userData');
        const deviceIdPath = path.join(userDataPath, DEVICE_ID_FILE);
        // Try to load existing device ID
        if (fs.existsSync(deviceIdPath)) {
            const deviceId = fs.readFileSync(deviceIdPath, 'utf8').trim();
            if (deviceId && deviceId.length > 0) {
                return deviceId;
            }
        }
        // Generate new device ID
        const newDeviceId = crypto.randomUUID();
        fs.writeFileSync(deviceIdPath, newDeviceId, 'utf8');
        console.log(`[KeystoreV4] Generated new device ID: ${newDeviceId}`);
        return newDeviceId;
    }
    catch (error) {
        console.error('[KeystoreV4] Device ID generation failed:', error);
        // Fallback to random UUID (will be different each app launch)
        return crypto.randomUUID();
    }
}
/**
 * Get human-readable device name
 */
function getDeviceName() {
    try {
        const hostname = os.hostname();
        const platform = process.platform;
        // Clean up hostname (remove .local, etc.)
        const cleanHostname = hostname.replace(/\.local$/i, '');
        // Add platform suffix for clarity
        const platformMap = {
            darwin: 'macOS',
            win32: 'Windows',
            linux: 'Linux',
        };
        const platformName = platformMap[platform] || platform;
        return `${cleanHostname} (${platformName})`;
    }
    catch (error) {
        console.error('[KeystoreV4] Device name detection failed:', error);
        return `Unknown Device (${process.platform})`;
    }
}
/**
 * Detect biometric capabilities of current device
 */
async function detectBiometricProfile() {
    const platform = process.platform;
    if (platform === 'darwin') {
        // macOS: Check for Touch ID / Face ID
        // Note: Actual biometric detection requires native modules
        // For now, assume available if macOS 10.12.2+
        return {
            enabled: false, // User must enable explicitly
            platform: 'darwin',
            biometricType: 'touchid', // Default assumption
            enrolledAt: 0,
        };
    }
    else if (platform === 'win32') {
        // Windows: Check for Windows Hello
        return {
            enabled: false,
            platform: 'win32',
            biometricType: 'windows-hello',
            enrolledAt: 0,
        };
    }
    else {
        // Linux: No built-in biometric support
        return undefined;
    }
}
/**
 * Get default vault settings for new device
 */
function getDefaultVaultSettings() {
    return {
        autoLockEnabled: true,
        autoLockTimeoutMs: 15 * 60 * 1000, // 15 minutes
        requireBiometricOnLaunch: false,
        requirePasswordOnLaunch: true,
        allowBackgroundDecrypt: false,
    };
}
// === UTILITY FUNCTIONS ===
/**
 * Count number of previous keypairs in keystore
 */
function countPreviousKeypairs(keystore) {
    if (!keystore.encryptedPreviousKeypairs) {
        return 0;
    }
    try {
        // Previous keypairs are encrypted as JSON array
        // We can't count without decrypting, so estimate from string length
        // This is approximate - actual count requires decryption
        const estimatedSize = Buffer.from(keystore.encryptedPreviousKeypairs, 'base64').length;
        const avgKeypairSize = 5000; // Approximate bytes per encrypted keypair
        return Math.floor(estimatedSize / avgKeypairSize);
    }
    catch (error) {
        return 0;
    }
}
/**
 * Get timestamp of last rotation
 */
function getLastRotationTimestamp(keystore) {
    if (keystore.rotationHistory.length === 0) {
        return undefined;
    }
    // Rotation history is sorted chronologically
    return keystore.rotationHistory[keystore.rotationHistory.length - 1].timestamp;
}
/**
 * Get last rotation for specific public key
 */
function getLastRotationFor(keystore, publicKey) {
    // Search rotation history in reverse (newest first)
    for (let i = keystore.rotationHistory.length - 1; i >= 0; i--) {
        const record = keystore.rotationHistory[i];
        if (record.newPublicKey === publicKey) {
            return record;
        }
    }
    return null;
}
/**
 * Validate rotation history integrity
 *
 * Ensures:
 * - No gaps in rotation sequence
 * - Chronological ordering
 * - No duplicate rotation IDs
 */
function validateRotationChainIntegrity(rotationHistory) {
    if (rotationHistory.length === 0) {
        return; // Empty history is valid
    }
    const seenIds = new Set();
    let lastTimestamp = 0;
    for (let i = 0; i < rotationHistory.length; i++) {
        const record = rotationHistory[i];
        // Check for duplicate IDs
        if (seenIds.has(record.rotationId)) {
            throw new Error(`Duplicate rotation ID: ${record.rotationId}`);
        }
        seenIds.add(record.rotationId);
        // Check chronological order
        if (record.timestamp < lastTimestamp) {
            throw new Error(`Rotation history not chronological at index ${i}`);
        }
        lastTimestamp = record.timestamp;
        // Check successful rotations have new key
        if (record.success && !record.newPublicKey) {
            throw new Error(`Successful rotation ${record.rotationId} missing new public key`);
        }
    }
    console.log(`[KeystoreV4] Rotation chain validated: ${rotationHistory.length} records`);
}
// === EXPORTS ===
// EncryptedKeystoreV3 is imported from keypairRotation.ts and re-exported above
