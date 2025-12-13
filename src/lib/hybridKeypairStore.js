"use strict";
// src/lib/hybridKeypairStore.ts
// Persistent PQ-Hybrid Keypair Storage with Vault Integration
// SECURITY: AES-256-GCM encrypted-at-rest, password-derived keys, hardware-backed optional
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
exports.getKeystoreDirectory = getKeystoreDirectory;
exports.getKeystorePath = getKeystorePath;
exports.encryptKeypair = encryptKeypair;
exports.decryptKeypair = decryptKeypair;
exports.saveKeystore = saveKeystore;
exports.loadKeystore = loadKeystore;
exports.keystoreExists = keystoreExists;
exports.deleteKeystore = deleteKeystore;
exports.updateLastUnlocked = updateLastUnlocked;
exports.validateKeystore = validateKeystore;
exports.isRotationDue = isRotationDue;
exports.getRotationStatus = getRotationStatus;
exports.markKeypairRotated = markKeypairRotated;
exports.updateBiometricEnrollment = updateBiometricEnrollment;
exports.loadPreviousKeypairs = loadPreviousKeypairs;
exports.loadKeypairWithHistory = loadKeypairWithHistory;
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/**
 * Security constants
 */
const SECURITY_PARAMS = {
    PBKDF2_ITERATIONS: 600000, // Military-grade (OWASP 2023 recommendation)
    PBKDF2_HASH: 'sha256',
    SALT_LENGTH: 16, // 128 bits
    IV_LENGTH: 12, // 96 bits (GCM standard)
    KEY_LENGTH: 32, // 256 bits (AES-256)
    TAG_LENGTH: 16, // 128 bits (GCM tag)
};
/**
 * Get platform-specific keystore directory
 */
function getKeystoreDirectory() {
    const home = process.env.HOME || process.env.USERPROFILE || '/tmp';
    switch (process.platform) {
        case 'darwin': // macOS
            return path.join(home, 'Library', 'Application Support', 'OneStarStream');
        case 'linux':
            return path.join(home, '.config', 'OneStarStream');
        case 'win32': // Windows
            return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'OneStarStream');
        default:
            return path.join(home, '.onestarstream');
    }
}
/**
 * Get keystore file path
 */
function getKeystorePath() {
    return path.join(getKeystoreDirectory(), 'keystore.json');
}
/**
 * Derive encryption key from password using PBKDF2
 *
 * SECURITY:
 * - 600,000 iterations (takes ~500ms on modern CPU)
 * - SHA-256 hash function
 * - Random 16-byte salt
 *
 * @param password - User's vault password
 * @param salt - 16-byte salt (random or from keystore)
 * @returns 32-byte AES-256 key
 */
function deriveKeyFromPassword(password, salt) {
    if (salt.length !== SECURITY_PARAMS.SALT_LENGTH) {
        throw new Error(`Invalid salt length: expected ${SECURITY_PARAMS.SALT_LENGTH}, got ${salt.length}`);
    }
    return crypto.pbkdf2Sync(password, salt, SECURITY_PARAMS.PBKDF2_ITERATIONS, SECURITY_PARAMS.KEY_LENGTH, SECURITY_PARAMS.PBKDF2_HASH);
}
/**
 * Encrypt keypair with password-derived key
 *
 * SECURITY:
 * - AES-256-GCM (authenticated encryption)
 * - Random IV per encryption
 * - Password-derived key (PBKDF2)
 * - Zeroizes plaintext after encryption
 *
 * @param keypair - Plaintext hybrid keypair
 * @param password - User's vault password
 * @param userId - Optional user identifier
 * @param options - Optional keystore options (rotation policy, biometric)
 * @returns Encrypted keystore structure
 */
async function encryptKeypair(keypair, password, userId, options) {
    // Generate random salt and IV
    const salt = crypto.randomBytes(SECURITY_PARAMS.SALT_LENGTH);
    const iv = crypto.randomBytes(SECURITY_PARAMS.IV_LENGTH);
    // Derive encryption key from password
    const encryptionKey = deriveKeyFromPassword(password, salt);
    try {
        // Serialize keypair to JSON
        const keypairJson = JSON.stringify({
            kyber: {
                publicKey: Buffer.from(keypair.kyber.publicKey).toString('base64'),
                privateKey: Buffer.from(keypair.kyber.privateKey).toString('base64'),
            },
            x25519: {
                publicKey: Buffer.from(keypair.x25519.publicKey).toString('base64'),
                privateKey: Buffer.from(keypair.x25519.privateKey).toString('base64'),
            },
        });
        const plaintextBuffer = Buffer.from(keypairJson, 'utf-8');
        // Encrypt with AES-256-GCM
        const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
        const encryptedChunks = [];
        encryptedChunks.push(cipher.update(plaintextBuffer));
        encryptedChunks.push(cipher.final());
        // Get authentication tag
        const tag = cipher.getAuthTag();
        // Combine ciphertext + tag (standard GCM format)
        const encryptedKeypair = Buffer.concat([...encryptedChunks, tag]);
        // Zeroize sensitive buffers
        plaintextBuffer.fill(0);
        encryptionKey.fill(0);
        // Build keystore (v2 format with rotation metadata)
        const now = new Date();
        const rotationIntervalDays = options?.rotationIntervalDays || 180;
        const nextRotationDue = new Date(now.getTime() + rotationIntervalDays * 24 * 60 * 60 * 1000);
        const keystore = {
            version: 'v2',
            algorithm: 'Kyber768-X25519-AES256GCM',
            salt: salt.toString('base64'),
            iterations: SECURITY_PARAMS.PBKDF2_ITERATIONS,
            encryptedKeypair: encryptedKeypair.toString('base64'),
            iv: iv.toString('base64'),
            publicKey: {
                kyber: Buffer.from(keypair.kyber.publicKey).toString('base64'),
                x25519: Buffer.from(keypair.x25519.publicKey).toString('base64'),
            },
            createdAt: now.toISOString(),
            userId,
            rotation: {
                rotationCount: 0,
                rotationPolicy: options?.rotationPolicy || 'scheduled',
                rotationIntervalDays,
                nextRotationDue: nextRotationDue.toISOString(),
            },
        };
        // Add biometric metadata if enrolled
        if (options?.biometricEnrolled) {
            keystore.biometric = {
                enrolled: true,
                enrolledAt: now.toISOString(),
                method: options.biometricMethod,
            };
        }
        return keystore;
    }
    catch (error) {
        // Zeroize key on error
        encryptionKey.fill(0);
        throw error;
    }
}
/**
 * Decrypt keypair with password-derived key
 *
 * SECURITY:
 * - Validates GCM authentication tag (prevents tampering)
 * - Constant-time comparison (prevents timing attacks)
 * - Zeroizes encryption key after use
 *
 * @param keystore - Encrypted keystore from disk
 * @param password - User's vault password
 * @returns Decrypted keypair
 * @throws Error if password is wrong or keystore is tampered
 */
async function decryptKeypair(keystore, password) {
    if (keystore.version !== 'v1') {
        throw new Error(`Unsupported keystore version: ${keystore.version}`);
    }
    // Decode Base64 fields
    const salt = Buffer.from(keystore.salt, 'base64');
    const iv = Buffer.from(keystore.iv, 'base64');
    const encryptedData = Buffer.from(keystore.encryptedKeypair, 'base64');
    // Derive decryption key
    const decryptionKey = deriveKeyFromPassword(password, salt);
    try {
        // Split ciphertext and tag
        const ciphertext = encryptedData.subarray(0, -SECURITY_PARAMS.TAG_LENGTH);
        const tag = encryptedData.subarray(-SECURITY_PARAMS.TAG_LENGTH);
        // Decrypt with AES-256-GCM
        const decipher = crypto.createDecipheriv('aes-256-gcm', decryptionKey, iv);
        decipher.setAuthTag(tag);
        const decryptedChunks = [];
        decryptedChunks.push(decipher.update(ciphertext));
        decryptedChunks.push(decipher.final()); // Throws if authentication fails
        const plaintextBuffer = Buffer.concat(decryptedChunks);
        const plaintextJson = plaintextBuffer.toString('utf-8');
        // Zeroize plaintext buffer after parsing
        plaintextBuffer.fill(0);
        // Parse keypair JSON
        const parsed = JSON.parse(plaintextJson);
        const keypair = {
            kyber: {
                publicKey: new Uint8Array(Buffer.from(parsed.kyber.publicKey, 'base64')),
                privateKey: new Uint8Array(Buffer.from(parsed.kyber.privateKey, 'base64')),
            },
            x25519: {
                publicKey: new Uint8Array(Buffer.from(parsed.x25519.publicKey, 'base64')),
                privateKey: new Uint8Array(Buffer.from(parsed.x25519.privateKey, 'base64')),
            },
        };
        // Build metadata (with v2 rotation/biometric support)
        const metadata = {
            createdAt: new Date(keystore.createdAt),
            lastUnlockedAt: keystore.lastUnlockedAt ? new Date(keystore.lastUnlockedAt) : undefined,
            userId: keystore.userId,
        };
        // Add rotation metadata (v2+)
        if (keystore.rotation) {
            metadata.rotation = {
                lastRotatedAt: keystore.rotation.lastRotatedAt ? new Date(keystore.rotation.lastRotatedAt) : undefined,
                rotationCount: keystore.rotation.rotationCount,
                nextRotationDue: keystore.rotation.nextRotationDue ? new Date(keystore.rotation.nextRotationDue) : undefined,
                rotationPolicy: keystore.rotation.rotationPolicy,
                rotationIntervalDays: keystore.rotation.rotationIntervalDays,
            };
        }
        // Add biometric metadata (v2+)
        if (keystore.biometric) {
            metadata.biometric = {
                enrolled: keystore.biometric.enrolled,
                enrolledAt: keystore.biometric.enrolledAt ? new Date(keystore.biometric.enrolledAt) : undefined,
                method: keystore.biometric.method,
            };
        }
        return {
            keypair,
            publicKey: keystore.publicKey,
            metadata,
        };
    }
    catch (error) {
        // Zeroize key on error
        decryptionKey.fill(0);
        if (error.message.includes('Unsupported state or unable to authenticate data')) {
            throw new Error('Invalid password or keystore has been tampered with');
        }
        throw error;
    }
    finally {
        // Always zeroize decryption key
        decryptionKey.fill(0);
    }
}
/**
 * Save encrypted keystore to disk
 *
 * SECURITY:
 * - Atomic write (write to temp file, then rename)
 * - Restrictive permissions (0600 = owner read/write only)
 * - Directory creation with secure permissions
 *
 * @param keystore - Encrypted keystore
 */
async function saveKeystore(keystore) {
    const keystorePath = getKeystorePath();
    const keystoreDir = path.dirname(keystorePath);
    const tempPath = `${keystorePath}.tmp`;
    try {
        // Ensure directory exists with secure permissions
        await fs.mkdir(keystoreDir, { recursive: true, mode: 0o700 });
        // Serialize to JSON
        const json = JSON.stringify(keystore, null, 2);
        // Write to temp file with secure permissions
        await fs.writeFile(tempPath, json, { encoding: 'utf-8', mode: 0o600 });
        // Atomic rename (prevents partial writes)
        await fs.rename(tempPath, keystorePath);
        console.log(`[KeypairStore] Keystore saved to: ${keystorePath}`);
    }
    catch (error) {
        // Clean up temp file on error
        try {
            await fs.unlink(tempPath);
        }
        catch { }
        throw error;
    }
}
/**
 * Load encrypted keystore from disk
 *
 * @returns Encrypted keystore or null if not found
 */
async function loadKeystore() {
    const keystorePath = getKeystorePath();
    try {
        const json = await fs.readFile(keystorePath, 'utf-8');
        const keystore = JSON.parse(json);
        // Validate structure
        if (!keystore.version || !keystore.encryptedKeypair || !keystore.publicKey) {
            throw new Error('Invalid keystore format');
        }
        console.log(`[KeypairStore] Keystore loaded from: ${keystorePath}`);
        return keystore;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`[KeypairStore] No keystore found at: ${keystorePath}`);
            return null;
        }
        throw error;
    }
}
/**
 * Check if keystore exists
 */
async function keystoreExists() {
    const keystorePath = getKeystorePath();
    try {
        await fs.access(keystorePath);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Delete keystore from disk
 *
 * SECURITY: Use secure deletion if available (overwrite with random data)
 */
async function deleteKeystore() {
    const keystorePath = getKeystorePath();
    try {
        // Overwrite with random data before deletion (basic secure deletion)
        const stats = await fs.stat(keystorePath);
        const randomData = crypto.randomBytes(stats.size);
        await fs.writeFile(keystorePath, randomData);
        // Delete file
        await fs.unlink(keystorePath);
        console.log(`[KeypairStore] Keystore deleted: ${keystorePath}`);
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}
/**
 * Update last unlocked timestamp
 */
async function updateLastUnlocked(keystore) {
    keystore.lastUnlockedAt = new Date().toISOString();
    await saveKeystore(keystore);
}
/**
 * Validate keystore integrity
 *
 * @param keystore - Keystore to validate
 * @returns true if valid, false otherwise
 */
function validateKeystore(keystore) {
    try {
        // Check version
        if (keystore.version !== 'v1' && keystore.version !== 'v2')
            return false;
        // Check required fields
        if (!keystore.salt || !keystore.iv || !keystore.encryptedKeypair)
            return false;
        if (!keystore.publicKey?.kyber || !keystore.publicKey?.x25519)
            return false;
        // Check iterations
        if (keystore.iterations < SECURITY_PARAMS.PBKDF2_ITERATIONS)
            return false;
        // Check Base64 encoding
        Buffer.from(keystore.salt, 'base64');
        Buffer.from(keystore.iv, 'base64');
        Buffer.from(keystore.encryptedKeypair, 'base64');
        Buffer.from(keystore.publicKey.kyber, 'base64');
        Buffer.from(keystore.publicKey.x25519, 'base64');
        return true;
    }
    catch {
        return false;
    }
}
/**
 * KEY ROTATION UTILITIES (Phase 17)
 *
 * Key rotation is critical for long-term security:
 * - Limits blast radius of key compromise
 * - Provides forward secrecy
 * - Complies with security policies (e.g., 180-day rotation)
 *
 * IMPORTANT: Rotating keys requires re-wrapping ALL media keys!
 * This is a Phase 19 feature (not fully implemented yet).
 */
/**
 * Check if key rotation is due
 *
 * @param keystore - Encrypted keystore
 * @returns true if rotation is overdue
 */
function isRotationDue(keystore) {
    if (!keystore.rotation || keystore.rotation.rotationPolicy === 'manual') {
        return false;
    }
    if (!keystore.rotation.nextRotationDue) {
        return false;
    }
    const nextRotationDate = new Date(keystore.rotation.nextRotationDue);
    return Date.now() >= nextRotationDate.getTime();
}
/**
 * Get rotation status
 *
 * @param keystore - Encrypted keystore
 * @returns Rotation status summary
 */
function getRotationStatus(keystore) {
    const createdAt = new Date(keystore.createdAt);
    const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    if (!keystore.rotation) {
        return {
            isDue: false,
            daysSinceCreation,
            rotationCount: 0,
            policy: 'manual',
        };
    }
    const lastRotatedAt = keystore.rotation.lastRotatedAt ? new Date(keystore.rotation.lastRotatedAt) : createdAt;
    const daysSinceLastRotation = (Date.now() - lastRotatedAt.getTime()) / (1000 * 60 * 60 * 24);
    let daysUntilDue;
    if (keystore.rotation.nextRotationDue) {
        const nextRotationDate = new Date(keystore.rotation.nextRotationDue);
        daysUntilDue = (nextRotationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    }
    return {
        isDue: isRotationDue(keystore),
        daysSinceCreation,
        daysSinceLastRotation,
        daysUntilDue,
        rotationCount: keystore.rotation.rotationCount,
        policy: keystore.rotation.rotationPolicy,
    };
}
/**
 * Update rotation metadata (after successful rotation)
 *
 * NOTE: This updates metadata only. Actual key rotation (generating new keypair + re-wrapping media)
 * is implemented in Phase 19.
 *
 * @param keystore - Encrypted keystore
 * @param rotationIntervalDays - Days until next rotation
 */
function markKeypairRotated(keystore, rotationIntervalDays) {
    const now = new Date();
    const intervalDays = rotationIntervalDays || keystore.rotation?.rotationIntervalDays || 180;
    const nextRotationDue = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    if (!keystore.rotation) {
        keystore.rotation = {
            rotationCount: 1,
            rotationPolicy: 'scheduled',
            rotationIntervalDays: intervalDays,
            lastRotatedAt: now.toISOString(),
            nextRotationDue: nextRotationDue.toISOString(),
        };
    }
    else {
        keystore.rotation.rotationCount += 1;
        keystore.rotation.lastRotatedAt = now.toISOString();
        keystore.rotation.nextRotationDue = nextRotationDue.toISOString();
        keystore.rotation.rotationIntervalDays = intervalDays;
    }
}
/**
 * Update biometric enrollment status
 *
 * @param keystore - Encrypted keystore
 * @param enrolled - true to mark as enrolled
 * @param method - Biometric method used
 */
function updateBiometricEnrollment(keystore, enrolled, method) {
    if (enrolled) {
        keystore.biometric = {
            enrolled: true,
            enrolledAt: new Date().toISOString(),
            method,
        };
    }
    else {
        keystore.biometric = {
            enrolled: false,
        };
    }
}
/**
 * Load and decrypt all previous keypairs from keystore v3
 *
 * PHASE 20: Enable backward compatibility for media wrapped with old keys
 *
 * SECURITY:
 * - All keypairs encrypted with same password (user's vault password)
 * - Failed decryption is non-fatal (partial history acceptable)
 * - Private keys zeroized after use (caller's responsibility)
 *
 * @param password - User's vault password
 * @returns Array of decrypted previous keypairs
 */
async function loadPreviousKeypairs(password) {
    const keystore = await loadKeystore();
    if (!keystore) {
        console.warn('[HybridKeypairStore] No keystore found');
        return [];
    }
    // Check if v3 keystore
    if (keystore.version !== 'v3') {
        console.warn('[HybridKeypairStore] Keystore is not v3, no previous keypairs available');
        return [];
    }
    const keystoreV3 = keystore;
    if (!keystoreV3.previousKeypairs || keystoreV3.previousKeypairs.length === 0) {
        console.log('[HybridKeypairStore] No previous keypairs in keystore');
        return [];
    }
    console.log(`[HybridKeypairStore] Loading ${keystoreV3.previousKeypairs.length} previous keypairs...`);
    const previousKeypairs = [];
    for (const retiredKeypair of keystoreV3.previousKeypairs) {
        try {
            // Build temporary v1-compatible keystore for decryption
            const tempKeystore = {
                version: 'v1',
                algorithm: keystoreV3.algorithm,
                salt: keystoreV3.salt,
                iterations: keystoreV3.iterations,
                encryptedKeypair: retiredKeypair.encryptedKeypair,
                iv: retiredKeypair.iv,
                publicKey: retiredKeypair.publicKey,
                createdAt: retiredKeypair.createdAt,
            };
            // Decrypt keypair
            const decrypted = await decryptKeypair(tempKeystore, password);
            previousKeypairs.push({
                keypair: decrypted.keypair,
                keyId: retiredKeypair.keyId,
                createdAt: new Date(retiredKeypair.createdAt),
                retiredAt: new Date(retiredKeypair.retiredAt),
                reason: retiredKeypair.reason,
            });
            console.log(`[HybridKeypairStore] Decrypted previous keypair: ${retiredKeypair.keyId} (retired: ${retiredKeypair.retiredAt})`);
        }
        catch (error) {
            console.error(`[HybridKeypairStore] Failed to decrypt previous keypair ${retiredKeypair.keyId}:`, error);
            // Continue with other keypairs (partial success is acceptable)
        }
    }
    console.log(`[HybridKeypairStore] Successfully loaded ${previousKeypairs.length} of ${keystoreV3.previousKeypairs.length} previous keypairs`);
    return previousKeypairs;
}
/**
 * Load keystore with full history (current + previous keypairs)
 *
 * PHASE 20: Unified loading function for rotation and playback
 *
 * @param password - User's vault password
 * @returns Decrypted keystore with history
 */
async function loadKeypairWithHistory(password) {
    const keystore = await loadKeystore();
    if (!keystore) {
        return null;
    }
    // Decrypt current keypair
    const current = await decryptKeypair(keystore, password);
    // Decrypt previous keypairs (if v3)
    const previous = await loadPreviousKeypairs(password);
    // Get rotation history (if v3)
    const rotationHistory = keystore.version === 'v3'
        ? (keystore.rotationHistory || [])
        : [];
    return {
        keypair: current,
        previousKeypairs: previous,
        rotationHistory,
    };
}
