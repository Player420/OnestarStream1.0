"use strict";
// src/lib/localMediaIndex.ts
// Phase 18: Secure Local Media Index with AES-256-GCM Encrypted Storage
// SECURITY: Index encrypted with vault-derived key, atomic writes, zeroization
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
exports.addMedia = addMedia;
exports.getMedia = getMedia;
exports.listMedia = listMedia;
exports.removeMedia = removeMedia;
exports.clearIndex = clearIndex;
exports.refreshIndex = refreshIndex;
exports.getIndexStats = getIndexStats;
const electron_1 = require("electron");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const postQuantumCrypto_1 = require("./postQuantumCrypto");
// Security parameters
const INDEX_ENCRYPTION = {
    ALGORITHM: 'aes-256-gcm',
    KEY_DERIVATION: 'sha256',
    IV_LENGTH: 12, // GCM standard
    TAG_LENGTH: 16, // GCM authentication tag
    ENCODING: 'base64',
};
/**
 * Get index file path
 */
function getIndexPath() {
    const userDataPath = electron_1.app.getPath('userData');
    return path.join(userDataPath, 'media-index.enc');
}
/**
 * Derive encryption key from vault keypair
 *
 * SECURITY:
 * - Uses persistent vault keypair (must be unlocked)
 * - Derives deterministic key via SHA-256(kyber_sk || x25519_sk)
 * - 256-bit key for AES-256-GCM
 * - Key never stored, derived on-demand
 *
 * @returns 32-byte encryption key
 * @throws Error if vault is locked
 */
function deriveIndexEncryptionKey() {
    const decryptedKeypair = (0, postQuantumCrypto_1.getPersistentKeypair)();
    if (!decryptedKeypair) {
        throw new Error('[LocalMediaIndex] Vault is locked. Cannot derive encryption key.');
    }
    // Derive key from both private keys (PQ-hybrid)
    // Note: decryptedKeypair.keypair contains the actual HybridKeypair
    const keyMaterial = Buffer.concat([
        Buffer.from(decryptedKeypair.keypair.kyber.privateKey),
        Buffer.from(decryptedKeypair.keypair.x25519.privateKey),
    ]);
    // SHA-256 hash for deterministic key derivation
    const key = crypto.createHash(INDEX_ENCRYPTION.KEY_DERIVATION).update(keyMaterial).digest();
    // Zeroize key material
    keyMaterial.fill(0);
    if (key.length !== 32) {
        throw new Error('[LocalMediaIndex] Derived key length invalid');
    }
    return key;
}
/**
 * Encrypt index data
 *
 * @param index - Plaintext index
 * @returns Encrypted index with IV and auth tag
 */
function encryptIndex(index) {
    const key = deriveIndexEncryptionKey();
    const iv = crypto.randomBytes(INDEX_ENCRYPTION.IV_LENGTH);
    try {
        // Serialize index
        const plaintext = JSON.stringify(index);
        // Encrypt with AES-256-GCM
        const cipher = crypto.createCipheriv(INDEX_ENCRYPTION.ALGORITHM, key, iv);
        const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return {
            ciphertext: encrypted.toString(INDEX_ENCRYPTION.ENCODING),
            iv: iv.toString(INDEX_ENCRYPTION.ENCODING),
            tag: tag.toString(INDEX_ENCRYPTION.ENCODING),
        };
    }
    finally {
        // Zeroize key
        key.fill(0);
    }
}
/**
 * Decrypt index data
 *
 * @param ciphertext - Encrypted index (Base64)
 * @param iv - Initialization vector (Base64)
 * @param tag - Authentication tag (Base64)
 * @returns Plaintext index
 * @throws Error if decryption fails
 */
function decryptIndex(ciphertext, iv, tag) {
    const key = deriveIndexEncryptionKey();
    try {
        // Decode Base64
        const ciphertextBytes = Buffer.from(ciphertext, INDEX_ENCRYPTION.ENCODING);
        const ivBytes = Buffer.from(iv, INDEX_ENCRYPTION.ENCODING);
        const tagBytes = Buffer.from(tag, INDEX_ENCRYPTION.ENCODING);
        // Validate lengths
        if (ivBytes.length !== INDEX_ENCRYPTION.IV_LENGTH) {
            throw new Error(`[LocalMediaIndex] Invalid IV length: ${ivBytes.length}`);
        }
        if (tagBytes.length !== INDEX_ENCRYPTION.TAG_LENGTH) {
            throw new Error(`[LocalMediaIndex] Invalid tag length: ${tagBytes.length}`);
        }
        // Decrypt with AES-256-GCM
        const decipher = crypto.createDecipheriv(INDEX_ENCRYPTION.ALGORITHM, key, ivBytes);
        decipher.setAuthTag(tagBytes);
        const decrypted = Buffer.concat([decipher.update(ciphertextBytes), decipher.final()]);
        const plaintext = decrypted.toString('utf8');
        // Parse JSON
        const index = JSON.parse(plaintext);
        // Zeroize decrypted plaintext
        decrypted.fill(0);
        return index;
    }
    finally {
        // Zeroize key
        key.fill(0);
    }
}
/**
 * Load index from disk (atomic read)
 *
 * @returns MediaIndex or null if not found
 */
async function loadIndex() {
    const indexPath = getIndexPath();
    try {
        // Check if file exists
        await fs.access(indexPath);
        // Read encrypted index
        const fileContent = await fs.readFile(indexPath, 'utf8');
        const encryptedData = JSON.parse(fileContent);
        // Validate structure
        if (!encryptedData.ciphertext || !encryptedData.iv || !encryptedData.tag) {
            throw new Error('[LocalMediaIndex] Invalid encrypted index format');
        }
        // Decrypt index
        const index = decryptIndex(encryptedData.ciphertext, encryptedData.iv, encryptedData.tag);
        console.log('[LocalMediaIndex] Loaded index:', {
            version: index.version,
            mediaCount: index.media.length,
            updatedAt: index.updatedAt,
        });
        return index;
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[LocalMediaIndex] No existing index found');
            return null;
        }
        throw error;
    }
}
/**
 * Save index to disk (atomic write)
 *
 * SECURITY:
 * - Write to temp file first
 * - Rename to final location (atomic on POSIX)
 * - Prevents corruption from interrupted writes
 *
 * @param index - Index to save
 */
async function saveIndex(index) {
    const indexPath = getIndexPath();
    const tempPath = `${indexPath}.tmp`;
    try {
        // Ensure directory exists
        await fs.mkdir(path.dirname(indexPath), { recursive: true });
        // Encrypt index
        const encrypted = encryptIndex(index);
        // Serialize encrypted data
        const fileContent = JSON.stringify({
            version: 'v1',
            ciphertext: encrypted.ciphertext,
            iv: encrypted.iv,
            tag: encrypted.tag,
            encryptedAt: new Date().toISOString(),
        });
        // Write to temp file
        await fs.writeFile(tempPath, fileContent, { encoding: 'utf8', mode: 0o600 });
        // Atomic rename (POSIX guarantees atomicity)
        await fs.rename(tempPath, indexPath);
        console.log('[LocalMediaIndex] Saved index:', {
            mediaCount: index.media.length,
            updatedAt: index.updatedAt,
        });
    }
    catch (error) {
        // Cleanup temp file on error
        try {
            await fs.unlink(tempPath);
        }
        catch {
            // Ignore cleanup errors
        }
        throw error;
    }
}
/**
 * Add media item to index
 *
 * @param item - Media item to add
 */
async function addMedia(item) {
    console.log('[LocalMediaIndex] Adding media:', item.id);
    // Load existing index
    let index = await loadIndex();
    if (!index) {
        index = {
            version: 'v1',
            media: [],
            updatedAt: new Date().toISOString(),
        };
    }
    // Check for duplicates
    const existingIndex = index.media.findIndex((m) => m.id === item.id);
    if (existingIndex !== -1) {
        console.log('[LocalMediaIndex] Updating existing media:', item.id);
        index.media[existingIndex] = item;
    }
    else {
        index.media.push(item);
    }
    // Update timestamp
    index.updatedAt = new Date().toISOString();
    // Save index
    await saveIndex(index);
}
/**
 * Get media item by ID
 *
 * @param id - Media blob ID
 * @returns Media item or null if not found
 */
async function getMedia(id) {
    const index = await loadIndex();
    if (!index) {
        return null;
    }
    const item = index.media.find((m) => m.id === id);
    return item || null;
}
/**
 * List all media items
 *
 * @returns Array of media items
 */
async function listMedia() {
    const index = await loadIndex();
    if (!index) {
        return [];
    }
    return index.media;
}
/**
 * Remove media item from index
 *
 * @param id - Media blob ID
 * @returns true if removed, false if not found
 */
async function removeMedia(id) {
    console.log('[LocalMediaIndex] Removing media:', id);
    const index = await loadIndex();
    if (!index) {
        return false;
    }
    const initialLength = index.media.length;
    index.media = index.media.filter((m) => m.id !== id);
    if (index.media.length === initialLength) {
        return false; // Not found
    }
    // Update timestamp
    index.updatedAt = new Date().toISOString();
    // Save index
    await saveIndex(index);
    return true;
}
/**
 * Clear entire index (delete file)
 *
 * SECURITY: Securely delete index file
 */
async function clearIndex() {
    console.log('[LocalMediaIndex] Clearing index');
    const indexPath = getIndexPath();
    try {
        await fs.unlink(indexPath);
        console.log('[LocalMediaIndex] Index cleared');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            console.log('[LocalMediaIndex] No index to clear');
            return;
        }
        throw error;
    }
}
/**
 * Refresh index from server
 *
 * Fetches all user's media licenses from API and rebuilds local index.
 *
 * @returns Number of media items indexed
 */
async function refreshIndex() {
    console.log('[LocalMediaIndex] Refreshing index from server...');
    try {
        // Fetch all media licenses from API
        const response = await fetch('http://localhost:3000/api/encrypted-media/inbox', {
            credentials: 'include',
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch media list: ${response.statusText}`);
        }
        const data = await response.json();
        if (!data.ok) {
            throw new Error(data.error || 'Failed to retrieve media list');
        }
        // Convert API response to MediaItem format
        const mediaItems = (data.items || []).map((item) => ({
            id: item.mediaBlobId,
            title: item.metadata?.title || 'Untitled',
            mimeType: item.metadata?.mimeType || 'application/octet-stream',
            duration: item.metadata?.duration,
            fileSize: item.metadata?.fileSize,
            createdAt: item.createdAt || new Date().toISOString(),
            hasDownloadPermission: item.hasDownloadPermission || false,
            licenseId: item.licenseId,
            ownerUserId: item.ownerUserId,
            mediaHash: item.metadata?.mediaHash,
        }));
        // Create new index
        const index = {
            version: 'v1',
            media: mediaItems,
            updatedAt: new Date().toISOString(),
        };
        // Save index
        await saveIndex(index);
        console.log('[LocalMediaIndex] Index refreshed:', {
            mediaCount: mediaItems.length,
        });
        return mediaItems.length;
    }
    catch (error) {
        console.error('[LocalMediaIndex] Failed to refresh index:', error);
        throw error;
    }
}
/**
 * Get index statistics
 *
 * @returns Index stats
 */
async function getIndexStats() {
    const index = await loadIndex();
    if (!index) {
        return null;
    }
    const totalSize = index.media.reduce((sum, item) => sum + (item.fileSize || 0), 0);
    return {
        mediaCount: index.media.length,
        totalSize,
        updatedAt: index.updatedAt,
    };
}
