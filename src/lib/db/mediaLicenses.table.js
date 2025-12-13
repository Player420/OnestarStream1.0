"use strict";
// src/lib/db/mediaLicenses.table.ts
// Database table for media licenses with wrapped keys
// Uses OneStarDB's persistent storage interface
Object.defineProperty(exports, "__esModule", { value: true });
exports.insert = insert;
exports.get = get;
exports.update = update;
exports.getByOwner = getByOwner;
exports.remove = remove;
exports.addWrappedKey = addWrappedKey;
exports.getWrappedKey = getWrappedKey;
exports.listAllEncryptedMediaMetadata = listAllEncryptedMediaMetadata;
exports.updateWrappedKey = updateWrappedKey;
exports.countEncryptedMedia = countEncryptedMedia;
exports.getPublicKeyForMedia = getPublicKeyForMedia;
/**
 * Database interface accessor.
 */
function getDB() {
    if (typeof globalThis !== 'undefined' && globalThis.OneStarDB) {
        return globalThis.OneStarDB;
    }
    throw new Error('OneStarDB not initialized. Ensure database is opened before accessing tables.');
}
/**
 * Generate table key for a license.
 *
 * Format: "mediaLicenses:{licenseId}"
 */
function licenseKey(licenseId) {
    return `mediaLicenses:${licenseId}`;
}
/**
 * Generate index key for user's licenses.
 *
 * Format: "mediaLicenses:byOwner:{ownerUserId}"
 */
function ownerIndexKey(ownerUserId) {
    return `mediaLicenses:byOwner:${ownerUserId}`;
}
/**
 * Serialize wrapped keys for storage.
 *
 * Supports two formats:
 * - Legacy: Uint8Array → Base64 string
 * - PQ-Hybrid: string (already JSON) → keep as-is
 */
function serializeWrappedKeys(wrappedKeys) {
    const serialized = {};
    for (const [userId, key] of Object.entries(wrappedKeys)) {
        if (typeof key === 'string') {
            // Already serialized (PQ-hybrid JSON format)
            serialized[userId] = key;
        }
        else {
            // Legacy format: Uint8Array → Base64
            serialized[userId] = Buffer.from(key).toString('base64');
        }
    }
    return serialized;
}
/**
 * Deserialize wrapped keys from storage.
 *
 * Auto-detects format:
 * - If string starts with '{', assume PQ-hybrid JSON → keep as string
 * - Otherwise, assume legacy Base64 → convert to Uint8Array
 */
function deserializeWrappedKeys(serialized) {
    const wrappedKeys = {};
    for (const [userId, value] of Object.entries(serialized)) {
        if (value.startsWith('{')) {
            // PQ-hybrid format (JSON string with HybridCiphertext)
            wrappedKeys[userId] = value;
        }
        else {
            // Legacy format (Base64 → Uint8Array)
            wrappedKeys[userId] = new Uint8Array(Buffer.from(value, 'base64'));
        }
    }
    return wrappedKeys;
}
/**
 * Insert a new media license record into the database.
 *
 * WORKFLOW:
 * 1. Client encrypts media → generates mediaHash
 * 2. Client wraps mediaKey with vaultKey → wrappedKey
 * 3. Client computes licenseId = SHA-256(mediaHash + ownerUserId)
 * 4. Server calls insert() to persist license + wrapped key
 * 5. Server NEVER sees plaintext mediaKey
 *
 * @param record - Media license record to insert
 * @throws Error if database operation fails or if license already exists
 */
async function insert(record) {
    const db = getDB();
    const key = licenseKey(record.licenseId);
    // Check for existing license (deterministic licenseId ensures uniqueness)
    const existing = await get(record.licenseId);
    if (existing) {
        throw new Error(`License already exists: ${record.licenseId}. ` +
            `Deterministic licenseId prevents duplicate uploads of same media by same user.`);
    }
    // Serialize record for storage
    const serialized = {
        licenseId: record.licenseId,
        ownerUserId: record.ownerUserId,
        mediaBlobId: record.mediaBlobId,
        wrappedKeys: serializeWrappedKeys(record.wrappedKeys),
        metadata: record.metadata,
        createdAt: record.createdAt,
    };
    await db.put(key, JSON.stringify(serialized));
    // Update owner index (for efficient queries by owner)
    await updateOwnerIndex(record.ownerUserId, record.licenseId, 'add');
}
/**
 * Retrieve a media license record by ID.
 *
 * @param licenseId - Deterministic license identifier
 * @returns Media license record or null if not found
 */
async function get(licenseId) {
    const db = getDB();
    const key = licenseKey(licenseId);
    try {
        const raw = await db.get(key);
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return {
            licenseId: parsed.licenseId,
            ownerUserId: parsed.ownerUserId,
            mediaBlobId: parsed.mediaBlobId,
            wrappedKeys: deserializeWrappedKeys(parsed.wrappedKeys),
            metadata: parsed.metadata,
            createdAt: parsed.createdAt,
        };
    }
    catch (err) {
        console.error(`[mediaLicenses.table] Failed to get license ${licenseId}:`, err);
        return null;
    }
}
/**
 * Update a media license record.
 *
 * USE CASES:
 * - Add wrapped key for new user (sharing)
 * - Update metadata (title, duration)
 * - Modify permissions
 *
 * SECURITY NOTE:
 * - Cannot modify licenseId (deterministic, immutable)
 * - Cannot modify ownerUserId (ownership is permanent)
 * - Can add wrapped keys for sharing
 *
 * @param licenseId - License to update
 * @param update - Partial record with fields to update
 */
async function update(licenseId, update) {
    const existing = await get(licenseId);
    if (!existing) {
        throw new Error(`License not found: ${licenseId}`);
    }
    // Merge updates
    const updated = {
        ...existing,
        ...update,
        // Preserve immutable fields
        licenseId: existing.licenseId,
        ownerUserId: existing.ownerUserId,
        createdAt: existing.createdAt,
        // Merge wrapped keys if provided
        wrappedKeys: update.wrappedKeys
            ? { ...existing.wrappedKeys, ...update.wrappedKeys }
            : existing.wrappedKeys,
        // Merge metadata if provided
        metadata: update.metadata
            ? { ...existing.metadata, ...update.metadata }
            : existing.metadata,
    };
    const db = getDB();
    const key = licenseKey(licenseId);
    const serialized = {
        licenseId: updated.licenseId,
        ownerUserId: updated.ownerUserId,
        mediaBlobId: updated.mediaBlobId,
        wrappedKeys: serializeWrappedKeys(updated.wrappedKeys),
        metadata: updated.metadata,
        createdAt: updated.createdAt,
    };
    await db.put(key, JSON.stringify(serialized));
}
/**
 * Get all licenses owned by a specific user.
 *
 * @param ownerUserId - User's DID or ID
 * @returns Array of license records
 */
async function getByOwner(ownerUserId) {
    const db = getDB();
    const indexKey = ownerIndexKey(ownerUserId);
    try {
        const raw = await db.get(indexKey);
        if (!raw) {
            return [];
        }
        const licenseIds = JSON.parse(raw);
        // Fetch all licenses in parallel
        const licenses = await Promise.all(licenseIds.map(licenseId => get(licenseId)));
        // Filter out nulls (in case of deleted licenses)
        return licenses.filter((l) => l !== null);
    }
    catch (err) {
        console.error(`[mediaLicenses.table] Failed to get licenses for owner ${ownerUserId}:`, err);
        return [];
    }
}
/**
 * Update owner index (for efficient queries).
 *
 * @param ownerUserId - User's ID
 * @param licenseId - License ID to add or remove
 * @param operation - 'add' or 'remove'
 */
async function updateOwnerIndex(ownerUserId, licenseId, operation) {
    const db = getDB();
    const indexKey = ownerIndexKey(ownerUserId);
    let licenseIds = [];
    try {
        const raw = await db.get(indexKey);
        if (raw) {
            licenseIds = JSON.parse(raw);
        }
    }
    catch {
        // Index doesn't exist yet, start fresh
    }
    if (operation === 'add') {
        if (!licenseIds.includes(licenseId)) {
            licenseIds.push(licenseId);
        }
    }
    else {
        licenseIds = licenseIds.filter(id => id !== licenseId);
    }
    await db.put(indexKey, JSON.stringify(licenseIds));
}
/**
 * Delete a media license record.
 *
 * WARNING: This removes all wrapped keys for this license.
 * Users who were shared this media will lose access.
 *
 * @param licenseId - License ID to delete
 */
async function remove(licenseId) {
    const existing = await get(licenseId);
    if (!existing) {
        return; // Already deleted
    }
    const db = getDB();
    const key = licenseKey(licenseId);
    // Remove license record
    await db.put(key, null);
    // Update owner index
    await updateOwnerIndex(existing.ownerUserId, licenseId, 'remove');
}
/**
 * Add a wrapped key for a new user (sharing).
 *
 * WORKFLOW:
 * 1. User A owns media with licenseId
 * 2. User A unwraps mediaKey with own vaultKey (client-side)
 * 3. User A wraps mediaKey with User B's key (client-side)
 * 4. Server calls addWrappedKey() to add User B's wrapped key
 * 5. Server NEVER sees plaintext mediaKey
 *
 * @param licenseId - License to share
 * @param userId - User receiving the share
 * @param wrappedKey - Encrypted mediaKey for recipient (Uint8Array for legacy, string for PQ-hybrid JSON)
 */
async function addWrappedKey(licenseId, userId, wrappedKey) {
    await update(licenseId, {
        wrappedKeys: { [userId]: wrappedKey },
    });
}
/**
 * Get wrapped key for a specific user.
 *
 * @param licenseId - License ID
 * @param userId - User's ID
 * @returns Wrapped key (Uint8Array for legacy, string for PQ-hybrid) or null if user doesn't have access
 */
async function getWrappedKey(licenseId, userId) {
    const license = await get(licenseId);
    if (!license) {
        return null;
    }
    return license.wrappedKeys[userId] || null;
}
/**
 * List all encrypted media metadata for a user (for key rotation).
 *
 * Used by MediaKeyReWrapper to fetch all media that needs re-wrapping.
 *
 * @param userId - User ID
 * @returns Array of media metadata with wrapped keys
 */
async function listAllEncryptedMediaMetadata(userId) {
    try {
        const licenses = await getByOwner(userId);
        const metadata = [];
        for (const license of licenses) {
            const wrappedKey = license.wrappedKeys[userId];
            if (!wrappedKey) {
                console.warn(`[mediaLicenses.table] User ${userId} has no wrapped key for license ${license.licenseId}`);
                continue;
            }
            metadata.push({
                licenseId: license.licenseId,
                mediaBlobId: license.mediaBlobId,
                wrappedKey,
                wrappedToPublicKey: license.metadata.wrappedToPublicKey,
                mimeType: license.metadata.mimeType,
                mediaHash: license.metadata.mediaHash,
            });
        }
        console.log(`[mediaLicenses.table] Found ${metadata.length} media items for user ${userId}`);
        return metadata;
    }
    catch (err) {
        console.error(`[mediaLicenses.table] Failed to list media metadata for user ${userId}:`, err);
        throw err;
    }
}
/**
 * Update wrapped key for a user after key rotation.
 *
 * WORKFLOW:
 * 1. Rotation engine unwraps mediaKey with old keypair
 * 2. Rotation engine re-wraps mediaKey with new keypair
 * 3. Rotation engine calls this function to update database
 * 4. Metadata updated with new public key keyId
 *
 * @param licenseId - License ID
 * @param userId - User ID
 * @param newWrappedKey - New wrapped key (Uint8Array for legacy, string for PQ-hybrid)
 * @param newPublicKeyId - New public key keyId (for tracking)
 */
async function updateWrappedKey(licenseId, userId, newWrappedKey, newPublicKeyId) {
    try {
        const license = await get(licenseId);
        if (!license) {
            throw new Error(`License ${licenseId} not found`);
        }
        // Update wrapped key
        license.wrappedKeys[userId] = newWrappedKey;
        // Update metadata with new public key keyId
        license.metadata.wrappedToPublicKey = newPublicKeyId;
        license.metadata.lastReWrapped = new Date().toISOString();
        // Save updated license
        const db = getDB();
        const key = licenseKey(licenseId);
        const serialized = {
            licenseId: license.licenseId,
            ownerUserId: license.ownerUserId,
            mediaBlobId: license.mediaBlobId,
            wrappedKeys: serializeWrappedKeys(license.wrappedKeys),
            metadata: license.metadata,
            createdAt: license.createdAt,
        };
        await db.put(key, JSON.stringify(serialized));
        console.log(`[mediaLicenses.table] Updated wrapped key for license ${licenseId}, user ${userId}`);
    }
    catch (err) {
        console.error(`[mediaLicenses.table] Failed to update wrapped key for license ${licenseId}:`, err);
        throw err;
    }
}
/**
 * Count encrypted media items for a user.
 *
 * Used for progress tracking during key rotation.
 *
 * @param userId - User ID
 * @returns Number of media items
 */
async function countEncryptedMedia(userId) {
    try {
        const licenses = await getByOwner(userId);
        return licenses.length;
    }
    catch (err) {
        console.error(`[mediaLicenses.table] Failed to count media for user ${userId}:`, err);
        return 0;
    }
}
/**
 * Get public key keyId used to wrap media (for rotation tracking).
 *
 * @param licenseId - License ID
 * @returns Public key keyId or null if not set
 */
async function getPublicKeyForMedia(licenseId) {
    try {
        const license = await get(licenseId);
        if (!license) {
            return null;
        }
        return license.metadata.wrappedToPublicKey || null;
    }
    catch (err) {
        console.error(`[mediaLicenses.table] Failed to get public key for license ${licenseId}:`, err);
        return null;
    }
}
