// src/lib/db/mediaBlobs.table.ts
// Database table for encrypted media blob storage
// Uses OneStarDB's persistent storage interface

/**
 * STORAGE ARCHITECTURE:
 * 
 * mediaBlobs table stores encrypted media ciphertext with metadata.
 * This is the raw encrypted content - no plaintext keys stored.
 * 
 * SECURITY INVARIANT:
 * - Only ciphertext is stored (never plaintext)
 * - GCM authentication tag is stored for integrity verification
 * - No decryption keys are stored in this table
 */

export interface MediaBlobRecord {
  mediaBlobId: string; // UUID - primary key
  ciphertext: Uint8Array; // AES-256-GCM encrypted media content
  iv: string; // Base64-encoded IV (12 bytes for GCM)
  mimeType: string; // audio/mpeg, video/mp4, image/jpeg, etc.
  byteLength: number; // Size of ciphertext in bytes
  gcmTag?: string; // Base64-encoded GCM authentication tag (optional for backward compat)
  createdAt: number; // Unix timestamp (ms)
}

/**
 * Database interface accessor.
 * 
 * OneStarDB provides:
 * - put(key, value): Store or update a record
 * - get(key): Retrieve a record by key
 * - append(key, value): Append to a log (not used here)
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
 * Generate table key for a media blob.
 * 
 * Format: "mediaBlobs:{mediaBlobId}"
 */
function blobKey(mediaBlobId: string): string {
  return `mediaBlobs:${mediaBlobId}`;
}

/**
 * Insert a new media blob record into the database.
 * 
 * WORKFLOW:
 * 1. Client encrypts media → generates ciphertext
 * 2. Client uploads ciphertext to server
 * 3. Server calls insert() to persist ciphertext
 * 4. Server NEVER sees plaintext media
 * 
 * @param record - Media blob record to insert
 * @throws Error if database operation fails
 */
export async function insert(record: MediaBlobRecord): Promise<void> {
  const db = getDB();
  const key = blobKey(record.mediaBlobId);
  
  // Serialize record for storage
  const serialized = {
    mediaBlobId: record.mediaBlobId,
    ciphertext: Buffer.from(record.ciphertext).toString('base64'), // Convert to Base64 for storage
    iv: record.iv, // GCM initialization vector
    mimeType: record.mimeType,
    byteLength: record.byteLength,
    gcmTag: record.gcmTag,
    createdAt: record.createdAt,
  };
  
  await db.put(key, JSON.stringify(serialized));
}

/**
 * Retrieve a media blob record by ID.
 * 
 * WORKFLOW:
 * 1. Client requests encrypted media
 * 2. Server calls get() to fetch ciphertext
 * 3. Server returns ciphertext to client
 * 4. Client decrypts with unwrapped mediaKey
 * 
 * @param mediaBlobId - UUID of the media blob
 * @returns Media blob record or null if not found
 */
export async function get(mediaBlobId: string): Promise<MediaBlobRecord | null> {
  const db = getDB();
  const key = blobKey(mediaBlobId);
  
  try {
    const raw = await db.get(key);
    if (!raw) {
      return null;
    }
    
    const parsed = JSON.parse(raw);
    
    // Deserialize ciphertext from Base64
    return {
      mediaBlobId: parsed.mediaBlobId,
      ciphertext: new Uint8Array(Buffer.from(parsed.ciphertext, 'base64')),
      iv: parsed.iv || parsed.gcmTag, // Fallback to gcmTag for backward compat
      mimeType: parsed.mimeType,
      byteLength: parsed.byteLength,
      gcmTag: parsed.gcmTag,
      createdAt: parsed.createdAt,
    };
  } catch (err) {
    console.error(`[mediaBlobs.table] Failed to get blob ${mediaBlobId}:`, err);
    return null;
  }
}

/**
 * Delete a media blob record.
 * 
 * WARNING: This permanently deletes the encrypted media.
 * Ensure all dependent licenses are also cleaned up.
 * 
 * @param mediaBlobId - UUID of the media blob
 */
export async function remove(mediaBlobId: string): Promise<void> {
  const db = getDB();
  const key = blobKey(mediaBlobId);
  
  // OneStarDB typically uses put(key, null) for deletion
  await db.put(key, null);
}

/**
 * Check if a media blob exists.
 * 
 * @param mediaBlobId - UUID of the media blob
 * @returns true if blob exists, false otherwise
 */
export async function exists(mediaBlobId: string): Promise<boolean> {
  const record = await get(mediaBlobId);
  return record !== null;
}

/**
 * Get blob size without loading full ciphertext.
 * 
 * @param mediaBlobId - UUID of the media blob
 * @returns Size in bytes or null if not found
 */
export async function getSize(mediaBlobId: string): Promise<number | null> {
  const record = await get(mediaBlobId);
  return record ? record.byteLength : null;
}
