// src/lib/db/mediaLicenses.table.ts
// Database table for media licenses with wrapped keys
// Uses OneStarDB's persistent storage interface

/**
 * STORAGE ARCHITECTURE:
 * 
 * mediaLicenses table stores:
 * - License metadata (ownership, permissions)
 * - Wrapped encryption keys (per-user, encrypted)
 * - Media hash (for deduplication + verification)
 * 
 * SECURITY INVARIANT:
 * - Wrapped keys are stored (encrypted with user's vault key OR PQ-hybrid KEM)
 * - Server NEVER unwraps keys
 * - Deterministic licenseId = SHA-256(mediaHash + ownerUserId)
 * 
 * WRAPPED KEY FORMATS:
 * - Legacy: Simple Base64 string (password-derived AES-GCM wrapping)
 * - PQ-Hybrid: JSON string with { kyberCiphertext, x25519EphemeralPublic, wrappedKey, iv, version: 'v1' }
 */

export interface MediaLicenseRecord {
  licenseId: string; // Deterministic: sha256(mediaHash + ownerUserId)
  ownerUserId: string; // DID or user ID who owns this license
  mediaBlobId: string; // Reference to encrypted media blob
  wrappedKeys: Record<string, Uint8Array | string>; // { userId: wrappedMediaKey (Base64) OR HybridCiphertext (JSON string) }
  metadata: {
    mediaHash: string; // SHA-256 hash of plaintext media (for deduplication)
    mimeType: string; // audio/mpeg, video/mp4, etc.
    duration?: number; // Media duration in seconds (optional)
    size?: number; // Original plaintext size in bytes (optional)
    title?: string; // Optional display title
  };
  createdAt: number; // Unix timestamp (ms)
}

/**
 * Database interface accessor.
 */
function getDB() {
  if (typeof globalThis !== 'undefined' && (globalThis as any).OneStarDB) {
    return (globalThis as any).OneStarDB;
  }
  
  throw new Error(
    'OneStarDB not initialized. Ensure database is opened before accessing tables.'
  );
}

/**
 * Generate table key for a license.
 * 
 * Format: "mediaLicenses:{licenseId}"
 */
function licenseKey(licenseId: string): string {
  return `mediaLicenses:${licenseId}`;
}

/**
 * Generate index key for user's licenses.
 * 
 * Format: "mediaLicenses:byOwner:{ownerUserId}"
 */
function ownerIndexKey(ownerUserId: string): string {
  return `mediaLicenses:byOwner:${ownerUserId}`;
}

/**
 * Serialize wrapped keys for storage.
 * 
 * Supports two formats:
 * - Legacy: Uint8Array → Base64 string
 * - PQ-Hybrid: string (already JSON) → keep as-is
 */
function serializeWrappedKeys(wrappedKeys: Record<string, Uint8Array | string>): Record<string, string> {
  const serialized: Record<string, string> = {};
  for (const [userId, key] of Object.entries(wrappedKeys)) {
    if (typeof key === 'string') {
      // Already serialized (PQ-hybrid JSON format)
      serialized[userId] = key;
    } else {
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
function deserializeWrappedKeys(serialized: Record<string, string>): Record<string, Uint8Array | string> {
  const wrappedKeys: Record<string, Uint8Array | string> = {};
  for (const [userId, value] of Object.entries(serialized)) {
    if (value.startsWith('{')) {
      // PQ-hybrid format (JSON string with HybridCiphertext)
      wrappedKeys[userId] = value;
    } else {
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
export async function insert(record: MediaLicenseRecord): Promise<void> {
  const db = getDB();
  const key = licenseKey(record.licenseId);
  
  // Check for existing license (deterministic licenseId ensures uniqueness)
  const existing = await get(record.licenseId);
  if (existing) {
    throw new Error(
      `License already exists: ${record.licenseId}. ` +
      `Deterministic licenseId prevents duplicate uploads of same media by same user.`
    );
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
export async function get(licenseId: string): Promise<MediaLicenseRecord | null> {
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
  } catch (err) {
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
export async function update(
  licenseId: string,
  update: Partial<Omit<MediaLicenseRecord, 'licenseId' | 'ownerUserId' | 'createdAt'>>
): Promise<void> {
  const existing = await get(licenseId);
  if (!existing) {
    throw new Error(`License not found: ${licenseId}`);
  }
  
  // Merge updates
  const updated: MediaLicenseRecord = {
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
export async function getByOwner(ownerUserId: string): Promise<MediaLicenseRecord[]> {
  const db = getDB();
  const indexKey = ownerIndexKey(ownerUserId);
  
  try {
    const raw = await db.get(indexKey);
    if (!raw) {
      return [];
    }
    
    const licenseIds: string[] = JSON.parse(raw);
    
    // Fetch all licenses in parallel
    const licenses = await Promise.all(
      licenseIds.map(licenseId => get(licenseId))
    );
    
    // Filter out nulls (in case of deleted licenses)
    return licenses.filter((l): l is MediaLicenseRecord => l !== null);
  } catch (err) {
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
async function updateOwnerIndex(
  ownerUserId: string,
  licenseId: string,
  operation: 'add' | 'remove'
): Promise<void> {
  const db = getDB();
  const indexKey = ownerIndexKey(ownerUserId);
  
  let licenseIds: string[] = [];
  
  try {
    const raw = await db.get(indexKey);
    if (raw) {
      licenseIds = JSON.parse(raw);
    }
  } catch {
    // Index doesn't exist yet, start fresh
  }
  
  if (operation === 'add') {
    if (!licenseIds.includes(licenseId)) {
      licenseIds.push(licenseId);
    }
  } else {
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
export async function remove(licenseId: string): Promise<void> {
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
export async function addWrappedKey(
  licenseId: string,
  userId: string,
  wrappedKey: Uint8Array | string
): Promise<void> {
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
export async function getWrappedKey(
  licenseId: string,
  userId: string
): Promise<Uint8Array | string | null> {
  const license = await get(licenseId);
  if (!license) {
    return null;
  }
  
  return license.wrappedKeys[userId] || null;
}
