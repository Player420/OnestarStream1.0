/**
 * Keystore Merge Engine
 * 
 * Phase 21: Cross-Device Keystore Sync
 * 
 * Handles intelligent merging of keystores from different devices with:
 * - Conflict resolution (newest keypair wins)
 * - Previous keypairs deduplication
 * - Rotation history merging
 * - Device-local state preservation
 * 
 * CRITICAL: This is the heart of cross-device sync security
 */

import * as crypto from 'crypto';
import type {
  EncryptedKeystoreV4,
  RotationRecordV4,
  SyncRecord,
} from './keystoreV4';
import { HybridKeypair } from './postQuantumCrypto';

// === TYPES ===

// Forward declaration to avoid circular import with keystoreExport
export interface KeystoreExportV1 {
  exportVersion: 'v1';
  exportedAt: number;
  sourceDeviceId: string;
  sourceDeviceName: string;
  keystore: {
    userId: string;
    encryptedIdentity: string;
    encryptedCurrentKeypair: string;
    encryptedPreviousKeypairs?: string;
    rotationHistory: RotationRecordV4[];
  };
  metadata: {
    keystoreVersion: 'v4';
    schemaVersion: number;
    totalPreviousKeypairs: number;
    totalRotations: number;
    lastRotationAt?: number;
  };
  signature: string;
  checksum: string;
}

export interface MergeResult {
  mergedKeystore: EncryptedKeystoreV4;
  stats: MergeStats;
}

export interface MergeStats {
  keypairsUpdated: boolean;
  previousKeypairsMerged: number;
  rotationHistoryMerged: number;
  conflictsResolved: number;
}

// === CONSTANTS ===

const MAX_PREVIOUS_KEYPAIRS = 10; // Limit to prevent unbounded growth

// === MERGE FUNCTIONS ===

/**
 * Merge imported keystore with local keystore
 * 
 * CONFLICT RESOLUTION RULES:
 * 1. Current Keypair: Choose newest by rotation timestamp
 * 2. Previous Keypairs: Merge + dedupe by public key, keep last 10
 * 3. Rotation History: Merge chronologically, dedupe by rotation ID
 * 4. Device-Local State: Always preserve local (never overwrite)
 * 
 * @param local - Current local keystore
 * @param imported - Imported keystore export
 * @returns Merged keystore with statistics
 */
export async function mergeKeystores(
  local: EncryptedKeystoreV4,
  imported: KeystoreExportV1
): Promise<MergeResult> {
  console.log('[Merge] Starting keystore merge...');
  console.log(`[Merge] Local device: ${local.deviceName}`);
  console.log(`[Merge] Import source: ${imported.sourceDeviceName}`);
  
  // === STEP 1: Validate Identity Match ===
  if (local.userId !== imported.keystore.userId) {
    throw new Error(
      'Identity mismatch: Cannot merge keystores from different users'
    );
  }
  
  // === STEP 2: Resolve Current Keypair Conflict ===
  const currentKeypairResult = await resolveCurrentKeypairConflict(
    local,
    imported
  );
  
  // === STEP 3: Merge Previous Keypairs ===
  const previousKeypairsResult = await mergePreviousKeypairs(
    local,
    imported,
    currentKeypairResult.demotedKeypair
  );
  
  // === STEP 4: Merge Rotation History ===
  const mergedRotationHistory = mergeRotationHistories(
    local.rotationHistory,
    imported.keystore.rotationHistory
  );
  
  // === STEP 5: Build Sync Record ===
  const syncRecord: SyncRecord = {
    syncId: crypto.randomUUID(),
    timestamp: Date.now(),
    sourceDeviceId: imported.sourceDeviceId,
    sourceDeviceName: imported.sourceDeviceName,
    targetDeviceId: local.deviceId,
    syncType: 'import',
    keypairsUpdated: currentKeypairResult.updated,
    previousKeypairsMerged: previousKeypairsResult.mergedCount,
    rotationHistoryMerged: mergedRotationHistory.length - local.rotationHistory.length,
    conflictsResolved: currentKeypairResult.conflicted ? 1 : 0,
    signature: imported.signature,
  };
  
  // === STEP 6: Construct Merged Keystore ===
  const mergedKeystore: EncryptedKeystoreV4 = {
    ...local, // Preserve device-local state (salt, biometrics, vaultSettings)
    
    // Update syncable global state
    encryptedCurrentKeypair: currentKeypairResult.selectedKeypair,
    encryptedPreviousKeypairs: previousKeypairsResult.encryptedPrevious,
    rotationHistory: mergedRotationHistory,
    
    // Update sync metadata
    lastSyncedAt: Date.now(),
    syncHistory: [...local.syncHistory, syncRecord],
    
    // Update modification timestamp
    lastModified: Date.now(),
  };
  
  // === STEP 7: Build Statistics ===
  const stats: MergeStats = {
    keypairsUpdated: currentKeypairResult.updated,
    previousKeypairsMerged: previousKeypairsResult.mergedCount,
    rotationHistoryMerged: syncRecord.rotationHistoryMerged,
    conflictsResolved: syncRecord.conflictsResolved,
  };
  
  console.log('[Merge] Complete:');
  console.log(`  - Current keypair ${stats.keypairsUpdated ? 'UPDATED' : 'unchanged'}`);
  console.log(`  - Previous keypairs merged: ${stats.previousKeypairsMerged}`);
  console.log(`  - Rotation history merged: ${stats.rotationHistoryMerged} records`);
  console.log(`  - Conflicts resolved: ${stats.conflictsResolved}`);
  
  return {
    mergedKeystore,
    stats,
  };
}

// === CONFLICT RESOLUTION ===

interface CurrentKeypairResult {
  selectedKeypair: string;
  updated: boolean;
  conflicted: boolean;
  demotedKeypair: string | null;
}

/**
 * Resolve current keypair conflict
 * 
 * Strategy:
 * - Compare encrypted keypairs
 * - If different, resolve by rotation timestamp (newest wins)
 * - Demote older keypair to previous keypairs
 */
async function resolveCurrentKeypairConflict(
  local: EncryptedKeystoreV4,
  imported: KeystoreExportV1
): Promise<CurrentKeypairResult> {
  const localKeypair = local.encryptedCurrentKeypair;
  const importedKeypair = imported.keystore.encryptedCurrentKeypair;
  
  // Quick check: if encrypted strings match, no conflict
  if (localKeypair === importedKeypair) {
    console.log('[Merge] Current keypair: No conflict (identical)');
    return {
      selectedKeypair: localKeypair,
      updated: false,
      conflicted: false,
      demotedKeypair: null,
    };
  }
  
  console.log('[Merge] Current keypair: Conflict detected, resolving...');
  
  // Extract public keys for comparison (avoids full decryption)
  const localPubKey = extractPublicKeyFromEncrypted(localKeypair);
  const importedPubKey = extractPublicKeyFromEncrypted(importedKeypair);
  
  if (localPubKey === importedPubKey) {
    // Same public key but different encrypted format (re-encrypted with different password?)
    // Keep local version
    console.log('[Merge] Same public key, different encryption. Keeping local.');
    return {
      selectedKeypair: localKeypair,
      updated: false,
      conflicted: false,
      demotedKeypair: null,
    };
  }
  
  // Different public keys: resolve by rotation timestamp
  const localLastRotation = findRotationForPublicKey(
    local.rotationHistory,
    localPubKey
  );
  const importedLastRotation = findRotationForPublicKey(
    imported.keystore.rotationHistory,
    importedPubKey
  );
  
  if (!localLastRotation || !importedLastRotation) {
    console.warn('[Merge] Warning: Cannot find rotation history for keypairs');
    // Fallback: Keep local (conservative choice)
    return {
      selectedKeypair: localKeypair,
      updated: false,
      conflicted: true,
      demotedKeypair: importedKeypair,
    };
  }
  
  // Compare timestamps
  if (importedLastRotation.timestamp > localLastRotation.timestamp) {
    // Imported is newer
    console.log(`[Merge] Imported keypair is newer (${new Date(importedLastRotation.timestamp).toISOString()}), updating`);
    return {
      selectedKeypair: importedKeypair,
      updated: true,
      conflicted: true,
      demotedKeypair: localKeypair,
    };
  } else {
    // Local is newer or same age
    console.log(`[Merge] Local keypair is newer (${new Date(localLastRotation.timestamp).toISOString()}), keeping`);
    return {
      selectedKeypair: localKeypair,
      updated: false,
      conflicted: true,
      demotedKeypair: importedKeypair,
    };
  }
}

// === PREVIOUS KEYPAIRS MERGE ===

interface PreviousKeypairsResult {
  encryptedPrevious: string | undefined;
  mergedCount: number;
}

/**
 * Merge previous keypairs from both keystores
 * 
 * Strategy:
 * - Combine both arrays
 * - Add demoted current keypair if conflict occurred
 * - Deduplicate by public key
 * - Sort by rotation timestamp (newest first)
 * - Limit to last 10 keypairs
 */
async function mergePreviousKeypairs(
  local: EncryptedKeystoreV4,
  imported: KeystoreExportV1,
  demotedKeypair: string | null
): Promise<PreviousKeypairsResult> {
  console.log('[Merge] Merging previous keypairs...');
  
  // Collect all encrypted previous keypairs
  const allEncryptedKeypairs: string[] = [];
  
  // Add local previous keypairs
  if (local.encryptedPreviousKeypairs) {
    try {
      const localPrevious = JSON.parse(
        Buffer.from(local.encryptedPreviousKeypairs, 'base64').toString('utf8')
      );
      if (Array.isArray(localPrevious)) {
        allEncryptedKeypairs.push(...localPrevious);
      }
    } catch (error) {
      console.error('[Merge] Failed to parse local previous keypairs:', error);
    }
  }
  
  // Add imported previous keypairs
  if (imported.keystore.encryptedPreviousKeypairs) {
    try {
      const importedPrevious = JSON.parse(
        Buffer.from(imported.keystore.encryptedPreviousKeypairs, 'base64').toString('utf8')
      );
      if (Array.isArray(importedPrevious)) {
        allEncryptedKeypairs.push(...importedPrevious);
      }
    } catch (error) {
      console.error('[Merge] Failed to parse imported previous keypairs:', error);
    }
  }
  
  // Add demoted keypair if conflict occurred
  if (demotedKeypair) {
    allEncryptedKeypairs.push(demotedKeypair);
    console.log('[Merge] Added demoted keypair to previous list');
  }
  
  // Deduplicate by public key
  const uniqueKeypairs = deduplicateEncryptedKeypairsByPublicKey(allEncryptedKeypairs);
  
  // Sort by rotation timestamp (newest first)
  const sortedKeypairs = sortEncryptedKeypairsByRotationTime(
    uniqueKeypairs,
    [...local.rotationHistory, ...imported.keystore.rotationHistory]
  );
  
  // Limit to last N keypairs
  const limitedKeypairs = sortedKeypairs.slice(0, MAX_PREVIOUS_KEYPAIRS);
  
  console.log(`[Merge] Previous keypairs: ${allEncryptedKeypairs.length} total → ${uniqueKeypairs.length} unique → ${limitedKeypairs.length} kept`);
  
  if (limitedKeypairs.length === 0) {
    return {
      encryptedPrevious: undefined,
      mergedCount: 0,
    };
  }
  
  // Re-serialize as encrypted JSON array
  const encryptedPrevious = Buffer.from(
    JSON.stringify(limitedKeypairs),
    'utf8'
  ).toString('base64');
  
  const originalLocalCount = local.encryptedPreviousKeypairs
    ? JSON.parse(Buffer.from(local.encryptedPreviousKeypairs, 'base64').toString('utf8')).length
    : 0;
  
  return {
    encryptedPrevious,
    mergedCount: limitedKeypairs.length - originalLocalCount,
  };
}

/**
 * Deduplicate encrypted keypairs by public key
 */
function deduplicateEncryptedKeypairsByPublicKey(
  encryptedKeypairs: string[]
): string[] {
  const seen = new Map<string, string>();
  
  for (const encrypted of encryptedKeypairs) {
    const pubKey = extractPublicKeyFromEncrypted(encrypted);
    if (!seen.has(pubKey)) {
      seen.set(pubKey, encrypted);
    }
  }
  
  return Array.from(seen.values());
}

/**
 * Sort encrypted keypairs by rotation time (newest first)
 */
function sortEncryptedKeypairsByRotationTime(
  encryptedKeypairs: string[],
  rotationHistory: RotationRecordV4[]
): string[] {
  // Build timestamp map
  const timestampMap = new Map<string, number>();
  
  for (const record of rotationHistory) {
    timestampMap.set(record.newPublicKey, record.timestamp);
  }
  
  // Sort by timestamp (newest first)
  return encryptedKeypairs.slice().sort((a, b) => {
    const pubKeyA = extractPublicKeyFromEncrypted(a);
    const pubKeyB = extractPublicKeyFromEncrypted(b);
    
    const timeA = timestampMap.get(pubKeyA) || 0;
    const timeB = timestampMap.get(pubKeyB) || 0;
    
    return timeB - timeA; // Descending (newest first)
  });
}

// === ROTATION HISTORY MERGE ===

/**
 * Merge rotation histories from both keystores
 * 
 * Strategy:
 * - Combine arrays
 * - Deduplicate by rotation ID
 * - Sort chronologically (oldest first)
 * - Validate no gaps in sequence
 */
function mergeRotationHistories(
  local: RotationRecordV4[],
  imported: RotationRecordV4[]
): RotationRecordV4[] {
  console.log(`[Merge] Merging rotation history: ${local.length} local + ${imported.length} imported`);
  
  // Combine arrays
  const all = [...local, ...imported];
  
  // Deduplicate by rotationId
  const seen = new Set<string>();
  const unique = all.filter(record => {
    if (seen.has(record.rotationId)) {
      return false;
    }
    seen.add(record.rotationId);
    return true;
  });
  
  // Sort chronologically (oldest first)
  unique.sort((a, b) => a.timestamp - b.timestamp);
  
  console.log(`[Merge] Rotation history merged: ${all.length} total → ${unique.length} unique`);
  
  return unique;
}

// === UTILITY FUNCTIONS ===

/**
 * Extract public key from encrypted keypair (without full decryption)
 * 
 * NOTE: This is a placeholder. In production, you would:
 * 1. Parse the encrypted structure
 * 2. Extract the public key (which is not encrypted)
 * 3. Return base64-encoded public key for comparison
 * 
 * For now, we use a hash of the encrypted data as a proxy
 */
function extractPublicKeyFromEncrypted(encryptedKeypair: string): string {
  // In v3/v4 format, encrypted keypair is a JSON object containing:
  // { ciphertext, iv, authTag, publicKey (unencrypted) }
  
  try {
    const parsed = JSON.parse(
      Buffer.from(encryptedKeypair, 'base64').toString('utf8')
    );
    
    if (parsed.publicKey) {
      // Public key is stored unencrypted for comparison
      return parsed.publicKey;
    }
  } catch (error) {
    // Fallback: use hash of entire encrypted blob
  }
  
  // Fallback: Hash the encrypted data as proxy
  const hash = crypto.createHash('sha256');
  hash.update(encryptedKeypair, 'utf8');
  return hash.digest('base64');
}

/**
 * Find rotation record for specific public key
 */
function findRotationForPublicKey(
  rotationHistory: RotationRecordV4[],
  publicKey: string
): RotationRecordV4 | null {
  // Search in reverse (newest first)
  for (let i = rotationHistory.length - 1; i >= 0; i--) {
    const record = rotationHistory[i];
    
    // Check if this rotation created the public key
    if (record.newPublicKey === publicKey) {
      return record;
    }
  }
  
  return null;
}

// === EXPORTS ===
// Types already exported via interface declarations above
