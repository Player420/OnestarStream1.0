// src/lib/db/mediaInbox.table.ts
// Database table for media sharing inbox
// Uses OneStarDB's persistent storage interface

/**
 * STORAGE ARCHITECTURE:
 * 
 * mediaInbox table stores share notifications.
 * When User A shares media with User B:
 * 1. Server adds wrapped key to User B in mediaLicenses table
 * 2. Server creates inbox entry for User B
 * 3. User B sees notification in inbox
 * 4. User B accepts/reads → gains access to media
 * 
 * SECURITY INVARIANT:
 * - Inbox only contains references (licenseId, sharedBy)
 * - Actual wrapped keys stored in mediaLicenses table
 * - Server never unwraps keys
 */

export interface MediaInboxRecord {
  inboxEntryId: string; // UUID - primary key
  userId: string; // DID or user ID who receives this notification
  licenseId: string; // Reference to shared license
  sharedBy: string; // DID or user ID who shared the media
  createdAt: number; // Unix timestamp (ms)
  status: 'unread' | 'read'; // Notification status
  message?: string; // Optional message from sender
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
 * Generate table key for an inbox entry.
 * 
 * Format: "mediaInbox:{inboxEntryId}"
 */
function inboxKey(inboxEntryId: string): string {
  return `mediaInbox:${inboxEntryId}`;
}

/**
 * Generate index key for user's inbox.
 * 
 * Format: "mediaInbox:byUser:{userId}"
 */
function userIndexKey(userId: string): string {
  return `mediaInbox:byUser:${userId}`;
}

/**
 * Insert a new inbox entry (share notification).
 * 
 * WORKFLOW:
 * 1. User A shares media with User B
 * 2. Server adds wrapped key to license (in mediaLicenses table)
 * 3. Server calls insert() to notify User B
 * 4. User B sees notification in inbox
 * 5. User B fetches wrapped key from license when ready to decrypt
 * 
 * @param record - Inbox entry to insert
 * @throws Error if database operation fails
 */
export async function insert(record: MediaInboxRecord): Promise<void> {
  const db = getDB();
  const key = inboxKey(record.inboxEntryId);
  
  // Serialize record for storage
  const serialized = {
    inboxEntryId: record.inboxEntryId,
    userId: record.userId,
    licenseId: record.licenseId,
    sharedBy: record.sharedBy,
    createdAt: record.createdAt,
    status: record.status,
    message: record.message,
  };
  
  await db.put(key, JSON.stringify(serialized));
  
  // Update user index (for efficient inbox queries)
  await updateUserIndex(record.userId, record.inboxEntryId, 'add');
}

/**
 * Retrieve an inbox entry by ID.
 * 
 * @param inboxEntryId - UUID of the inbox entry
 * @returns Inbox entry or null if not found
 */
export async function get(inboxEntryId: string): Promise<MediaInboxRecord | null> {
  const db = getDB();
  const key = inboxKey(inboxEntryId);
  
  try {
    const raw = await db.get(key);
    if (!raw) {
      return null;
    }
    
    const parsed = JSON.parse(raw);
    
    return {
      inboxEntryId: parsed.inboxEntryId,
      userId: parsed.userId,
      licenseId: parsed.licenseId,
      sharedBy: parsed.sharedBy,
      createdAt: parsed.createdAt,
      status: parsed.status,
      message: parsed.message,
    };
  } catch (err) {
    console.error(`[mediaInbox.table] Failed to get inbox entry ${inboxEntryId}:`, err);
    return null;
  }
}

/**
 * List all inbox entries for a specific user.
 * 
 * This is the primary query method for inbox display.
 * 
 * @param userId - User's DID or ID
 * @param filterStatus - Optional: filter by status ('unread' or 'read')
 * @returns Array of inbox entries, sorted by createdAt (newest first)
 */
export async function listForUser(
  userId: string,
  filterStatus?: 'unread' | 'read'
): Promise<MediaInboxRecord[]> {
  const db = getDB();
  const indexKey = userIndexKey(userId);
  
  try {
    const raw = await db.get(indexKey);
    if (!raw) {
      return [];
    }
    
    const entryIds: string[] = JSON.parse(raw);
    
    // Fetch all entries in parallel
    const entries = await Promise.all(
      entryIds.map(entryId => get(entryId))
    );
    
    // Filter out nulls (in case of deleted entries)
    let filtered = entries.filter((e): e is MediaInboxRecord => e !== null);
    
    // Apply status filter if provided
    if (filterStatus) {
      filtered = filtered.filter(e => e.status === filterStatus);
    }
    
    // Sort by createdAt (newest first)
    filtered.sort((a, b) => b.createdAt - a.createdAt);
    
    return filtered;
  } catch (err) {
    console.error(`[mediaInbox.table] Failed to list inbox for user ${userId}:`, err);
    return [];
  }
}

/**
 * Mark an inbox entry as read.
 * 
 * @param inboxEntryId - UUID of the inbox entry
 */
export async function markAsRead(inboxEntryId: string): Promise<void> {
  const entry = await get(inboxEntryId);
  if (!entry) {
    throw new Error(`Inbox entry not found: ${inboxEntryId}`);
  }
  
  if (entry.status === 'read') {
    return; // Already read
  }
  
  const db = getDB();
  const key = inboxKey(inboxEntryId);
  
  const updated = {
    ...entry,
    status: 'read' as const,
  };
  
  await db.put(key, JSON.stringify(updated));
}

/**
 * Delete an inbox entry.
 * 
 * NOTE: This only removes the notification, not the license access.
 * User still has access to the shared media via the license.
 * 
 * @param inboxEntryId - UUID of the inbox entry
 */
export async function remove(inboxEntryId: string): Promise<void> {
  const entry = await get(inboxEntryId);
  if (!entry) {
    return; // Already deleted
  }
  
  const db = getDB();
  const key = inboxKey(inboxEntryId);
  
  // Remove inbox entry
  await db.put(key, null);
  
  // Update user index
  await updateUserIndex(entry.userId, inboxEntryId, 'remove');
}

/**
 * Get count of unread inbox entries for a user.
 * 
 * @param userId - User's DID or ID
 * @returns Number of unread entries
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const entries = await listForUser(userId, 'unread');
  return entries.length;
}

/**
 * Update user index (for efficient queries).
 * 
 * @param userId - User's ID
 * @param inboxEntryId - Entry ID to add or remove
 * @param operation - 'add' or 'remove'
 */
async function updateUserIndex(
  userId: string,
  inboxEntryId: string,
  operation: 'add' | 'remove'
): Promise<void> {
  const db = getDB();
  const indexKey = userIndexKey(userId);
  
  let entryIds: string[] = [];
  
  try {
    const raw = await db.get(indexKey);
    if (raw) {
      entryIds = JSON.parse(raw);
    }
  } catch {
    // Index doesn't exist yet, start fresh
  }
  
  if (operation === 'add') {
    if (!entryIds.includes(inboxEntryId)) {
      entryIds.push(inboxEntryId);
    }
  } else {
    entryIds = entryIds.filter(id => id !== inboxEntryId);
  }
  
  await db.put(indexKey, JSON.stringify(entryIds));
}

/**
 * Mark all inbox entries as read for a user.
 * 
 * @param userId - User's DID or ID
 */
export async function markAllAsRead(userId: string): Promise<void> {
  const unread = await listForUser(userId, 'unread');
  
  await Promise.all(
    unread.map(entry => markAsRead(entry.inboxEntryId))
  );
}

/**
 * Get inbox entries shared by a specific user.
 * 
 * Useful for "Shared by me" views.
 * 
 * @param sharedBy - User's DID or ID who shared the media
 * @param recipientUserId - Recipient's user ID (to scope the query)
 * @returns Array of inbox entries
 */
export async function listSharedBy(
  sharedBy: string,
  recipientUserId?: string
): Promise<MediaInboxRecord[]> {
  // If recipient specified, only search their inbox
  if (recipientUserId) {
    const entries = await listForUser(recipientUserId);
    return entries.filter(e => e.sharedBy === sharedBy);
  }
  
  // Otherwise, this would require a global index (not implemented here)
  // For now, throw an error to indicate this query needs a recipient
  throw new Error(
    'listSharedBy requires recipientUserId parameter. ' +
    'Global "shared by" queries require additional indexing.'
  );
}
