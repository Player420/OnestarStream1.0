// src/lib/encryptedMediaStore.ts
// Database storage for encrypted media with zero plaintext key leakage
// Server stores: ciphertext + wrapped keys only (never plaintext keys)

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

/**
 * STORAGE ARCHITECTURE:
 * 
 * This module provides persistent storage for:
 * 1. Encrypted media blobs (ciphertext only)
 * 2. License records (metadata + access control)
 * 3. Wrapped keys (encrypted, per-user)
 * 4. Inbox entries (share notifications)
 * 
 * SECURITY INVARIANTS:
 * - Server NEVER stores plaintext keys
 * - Server NEVER unwraps keys
 * - Server only routes wrapped keys between users
 * - All key operations happen client-side
 */

// Storage paths
const ENCRYPTED_MEDIA_DIR = path.join(process.cwd(), 'localdata', 'encrypted_media');
const LICENSES_PATH = path.join(process.cwd(), 'localdata', 'licenses.json');
const WRAPPED_KEYS_PATH = path.join(process.cwd(), 'localdata', 'wrapped_keys.json');
const INBOX_PATH = path.join(process.cwd(), 'localdata', 'inbox.json');

/**
 * Encrypted media blob metadata (server-side storage)
 */
export interface EncryptedMediaBlob {
  mediaId: string; // UUID
  mediaHash: string; // SHA-256 of plaintext (for deduplication)
  licenseId: string; // Deterministic: sha256(mediaHash + uploaderRootIdentity)
  uploaderDID: string; // Uploader's decentralized identifier
  ciphertextPath: string; // Filesystem path to encrypted blob
  iv: string; // Base64-encoded GCM IV
  sizeBytes: number; // Ciphertext size
  mimeType?: string; // Optional: audio/mpeg, video/mp4, etc.
  createdAt: string; // ISO timestamp
}

/**
 * License record (defines access control)
 */
export interface LicenseRecord {
  licenseId: string; // Deterministic
  mediaId: string;
  mediaHash: string;
  uploaderDID: string;
  mediaType: 'audio' | 'video' | 'image';
  title?: string;
  validFrom: string; // ISO timestamp
  validUntil?: string; // Optional: ISO timestamp (null = forever)
  maxPlayCount?: number; // Optional: null = unlimited
  transferable: boolean; // Can license be transferred to another user?
  createdAt: string;
}

/**
 * Wrapped media key (encrypted key, per-user storage)
 */
export interface WrappedKeyRecord {
  keyId: string; // UUID (unique wrap instance)
  mediaId: string; // Which media this key decrypts
  licenseId: string; // Which license authorizes this key
  ownerDID: string; // Who owns this wrapped key
  wrappedKey: string; // Base64-encoded encrypted key
  wrapIV: string; // Base64-encoded wrapping IV
  wrapMethod: 'password-pbkdf2' | 'x25519-ecdh'; // How key was wrapped
  wrapMetadata?: string; // JSON: { salt?, iterations?, publicKey? }
  createdAt: string;
}

/**
 * Inbox entry (share notification)
 */
export interface InboxEntry {
  inboxId: string; // UUID
  recipientDID: string; // Who receives this share
  senderDID: string; // Who sent this share
  mediaId: string;
  licenseId: string;
  wrappedKeyId: string; // Reference to wrapped key record
  message?: string; // Optional message from sender
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  acceptedAt?: string;
  rejectedAt?: string;
}

// -----------------------------------------------------------------------------
// Storage Initialization
// -----------------------------------------------------------------------------

async function ensureStorage() {
  await fs.mkdir(ENCRYPTED_MEDIA_DIR, { recursive: true });
  await fs.mkdir(path.dirname(LICENSES_PATH), { recursive: true });
  
  for (const filePath of [LICENSES_PATH, WRAPPED_KEYS_PATH, INBOX_PATH]) {
    try {
      await fs.access(filePath);
    } catch {
      await fs.writeFile(filePath, '[]', 'utf8');
    }
  }
}

// -----------------------------------------------------------------------------
// Encrypted Media Blob Storage
// -----------------------------------------------------------------------------

/**
 * Store encrypted media ciphertext to filesystem.
 * 
 * @param ciphertext - Encrypted media content
 * @param metadata - Media metadata
 * @returns File path where ciphertext was stored
 */
export async function storeEncryptedBlob(
  ciphertext: Uint8Array,
  metadata: Omit<EncryptedMediaBlob, 'ciphertextPath' | 'sizeBytes'>
): Promise<EncryptedMediaBlob> {
  await ensureStorage();
  
  const fileName = `${metadata.mediaId}.enc`;
  const metaFileName = `${metadata.mediaId}.meta.json`;
  const ciphertextPath = path.join(ENCRYPTED_MEDIA_DIR, fileName);
  const metaPath = path.join(ENCRYPTED_MEDIA_DIR, metaFileName);
  
  // Store ciphertext
  await fs.writeFile(ciphertextPath, ciphertext);
  
  // Store metadata separately (includes IV)
  await fs.writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
  
  return {
    ...metadata,
    ciphertextPath,
    sizeBytes: ciphertext.byteLength,
  };
}

/**
 * Retrieve encrypted media ciphertext from filesystem.
 * 
 * @param mediaId - Media identifier
 * @returns Encrypted ciphertext
 */
export async function getEncryptedBlob(mediaId: string): Promise<Uint8Array | null> {
  const fileName = `${mediaId}.enc`;
  const ciphertextPath = path.join(ENCRYPTED_MEDIA_DIR, fileName);
  
  try {
    const buffer = await fs.readFile(ciphertextPath);
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/**
 * Get encrypted blob metadata (includes IV).
 * 
 * @param mediaId - Media identifier
 * @returns Blob metadata with IV
 */
export async function getEncryptedBlobMetadata(
  mediaId: string
): Promise<Omit<EncryptedMediaBlob, 'ciphertextPath' | 'sizeBytes'> | null> {
  const metaFileName = `${mediaId}.meta.json`;
  const metaPath = path.join(ENCRYPTED_MEDIA_DIR, metaFileName);
  
  try {
    const content = await fs.readFile(metaPath, 'utf8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Delete encrypted media blob.
 * 
 * @param mediaId - Media identifier
 */
export async function deleteEncryptedBlob(mediaId: string): Promise<void> {
  const fileName = `${mediaId}.enc`;
  const ciphertextPath = path.join(ENCRYPTED_MEDIA_DIR, fileName);
  
  try {
    await fs.unlink(ciphertextPath);
  } catch {
    // Ignore if already deleted
  }
}

// -----------------------------------------------------------------------------
// License Record Storage
// -----------------------------------------------------------------------------

async function getAllLicenses(): Promise<LicenseRecord[]> {
  await ensureStorage();
  const raw = await fs.readFile(LICENSES_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveLicenses(licenses: LicenseRecord[]): Promise<void> {
  await fs.writeFile(LICENSES_PATH, JSON.stringify(licenses, null, 2), 'utf8');
}

/**
 * Create a new license record.
 * 
 * @param license - License to store
 */
export async function createLicense(license: LicenseRecord): Promise<void> {
  const licenses = await getAllLicenses();
  
  // Check for duplicates (deterministic licenseId)
  const existing = licenses.find(l => l.licenseId === license.licenseId);
  if (existing) {
    throw new Error(`License already exists: ${license.licenseId}`);
  }
  
  licenses.push(license);
  await saveLicenses(licenses);
}

/**
 * Get license by ID.
 * 
 * @param licenseId - License identifier
 */
export async function getLicense(licenseId: string): Promise<LicenseRecord | null> {
  const licenses = await getAllLicenses();
  return licenses.find(l => l.licenseId === licenseId) || null;
}

/**
 * Get all licenses for a specific media item.
 * 
 * @param mediaId - Media identifier
 */
export async function getLicensesByMedia(mediaId: string): Promise<LicenseRecord[]> {
  const licenses = await getAllLicenses();
  return licenses.filter(l => l.mediaId === mediaId);
}

/**
 * Get all licenses uploaded by a specific user.
 * 
 * @param uploaderDID - Uploader's DID
 */
export async function getLicensesByUploader(uploaderDID: string): Promise<LicenseRecord[]> {
  const licenses = await getAllLicenses();
  return licenses.filter(l => l.uploaderDID === uploaderDID);
}

// -----------------------------------------------------------------------------
// Wrapped Key Storage
// -----------------------------------------------------------------------------

async function getAllWrappedKeys(): Promise<WrappedKeyRecord[]> {
  await ensureStorage();
  const raw = await fs.readFile(WRAPPED_KEYS_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveWrappedKeys(keys: WrappedKeyRecord[]): Promise<void> {
  await fs.writeFile(WRAPPED_KEYS_PATH, JSON.stringify(keys, null, 2), 'utf8');
}

/**
 * Store a wrapped media key.
 * 
 * SECURITY: Server stores wrapped (encrypted) key only.
 * Server NEVER unwraps or accesses plaintext key.
 * 
 * @param wrappedKey - Wrapped key record
 */
export async function storeWrappedKey(wrappedKey: WrappedKeyRecord): Promise<void> {
  const keys = await getAllWrappedKeys();
  keys.push(wrappedKey);
  await saveWrappedKeys(keys);
}

/**
 * Get wrapped keys for a specific user and media.
 * 
 * @param ownerDID - User's DID
 * @param mediaId - Media identifier
 */
export async function getWrappedKeys(
  ownerDID: string,
  mediaId: string
): Promise<WrappedKeyRecord[]> {
  const keys = await getAllWrappedKeys();
  return keys.filter(k => k.ownerDID === ownerDID && k.mediaId === mediaId);
}

/**
 * Get a specific wrapped key by ID.
 * 
 * @param keyId - Wrapped key identifier
 */
export async function getWrappedKeyById(keyId: string): Promise<WrappedKeyRecord | null> {
  const keys = await getAllWrappedKeys();
  return keys.find(k => k.keyId === keyId) || null;
}

/**
 * Delete wrapped keys for a specific media item.
 * 
 * @param mediaId - Media identifier
 */
export async function deleteWrappedKeysByMedia(mediaId: string): Promise<void> {
  const keys = await getAllWrappedKeys();
  const filtered = keys.filter(k => k.mediaId !== mediaId);
  await saveWrappedKeys(filtered);
}

// -----------------------------------------------------------------------------
// Inbox Storage
// -----------------------------------------------------------------------------

async function getAllInboxEntries(): Promise<InboxEntry[]> {
  await ensureStorage();
  const raw = await fs.readFile(INBOX_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveInboxEntries(entries: InboxEntry[]): Promise<void> {
  await fs.writeFile(INBOX_PATH, JSON.stringify(entries, null, 2), 'utf8');
}

/**
 * Add a share to recipient's inbox.
 * 
 * @param entry - Inbox entry
 */
export async function addToInbox(entry: InboxEntry): Promise<void> {
  const entries = await getAllInboxEntries();
  entries.push(entry);
  await saveInboxEntries(entries);
}

/**
 * Get all inbox entries for a user.
 * 
 * @param recipientDID - User's DID
 * @param status - Optional: filter by status
 */
export async function getInbox(
  recipientDID: string,
  status?: 'pending' | 'accepted' | 'rejected'
): Promise<InboxEntry[]> {
  const entries = await getAllInboxEntries();
  let filtered = entries.filter(e => e.recipientDID === recipientDID);
  
  if (status) {
    filtered = filtered.filter(e => e.status === status);
  }
  
  return filtered;
}

/**
 * Update inbox entry status.
 * 
 * @param inboxId - Inbox entry identifier
 * @param status - New status
 */
export async function updateInboxStatus(
  inboxId: string,
  status: 'accepted' | 'rejected'
): Promise<void> {
  const entries = await getAllInboxEntries();
  const entry = entries.find(e => e.inboxId === inboxId);
  
  if (!entry) {
    throw new Error(`Inbox entry not found: ${inboxId}`);
  }
  
  entry.status = status;
  
  if (status === 'accepted') {
    entry.acceptedAt = new Date().toISOString();
  } else if (status === 'rejected') {
    entry.rejectedAt = new Date().toISOString();
  }
  
  await saveInboxEntries(entries);
}

/**
 * Delete inbox entry.
 * 
 * @param inboxId - Inbox entry identifier
 */
export async function deleteInboxEntry(inboxId: string): Promise<void> {
  const entries = await getAllInboxEntries();
  const filtered = entries.filter(e => e.inboxId !== inboxId);
  await saveInboxEntries(filtered);
}

// -----------------------------------------------------------------------------
// Utility Functions
// -----------------------------------------------------------------------------

/**
 * Get complete media info (blob + license + wrapped keys).
 * 
 * @param mediaId - Media identifier
 * @param ownerDID - User's DID
 */
export async function getMediaInfo(mediaId: string, ownerDID: string) {
  const licenses = await getLicensesByMedia(mediaId);
  const wrappedKeys = await getWrappedKeys(ownerDID, mediaId);
  const ciphertext = await getEncryptedBlob(mediaId);
  
  return {
    mediaId,
    licenses,
    wrappedKeys,
    hasCiphertext: !!ciphertext,
  };
}

/**
 * Delete all data for a media item (cascade delete).
 * 
 * @param mediaId - Media identifier
 */
export async function deleteMedia(mediaId: string): Promise<void> {
  // Delete encrypted blob
  await deleteEncryptedBlob(mediaId);
  
  // Delete wrapped keys
  await deleteWrappedKeysByMedia(mediaId);
  
  // Delete licenses
  const licenses = await getAllLicenses();
  const filteredLicenses = licenses.filter(l => l.mediaId !== mediaId);
  await saveLicenses(filteredLicenses);
  
  // Delete inbox entries
  const inbox = await getAllInboxEntries();
  const filteredInbox = inbox.filter(e => e.mediaId !== mediaId);
  await saveInboxEntries(filteredInbox);
}
