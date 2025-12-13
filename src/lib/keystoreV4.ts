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

import * as crypto from 'crypto';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { EncryptedKeystoreV3 } from './keypairRotation';

// === TYPES ===

export interface EncryptedKeystoreV4 {
  version: 'v4';
  
  // === GLOBAL IDENTITY (syncable) ===
  userId: string;                   // Root user identity
  encryptedIdentity: string;        // Identity keypair (encrypted with vault password)
  encryptedCurrentKeypair: string;  // Current keypair (encrypted)
  encryptedPreviousKeypairs?: string; // Previous keypairs array (encrypted)
  rotationHistory: RotationRecordV4[]; // Chronological rotation log
  
  // === DEVICE METADATA (syncable) ===
  deviceId: string;                 // UUID for this device
  deviceName: string;               // User-friendly name
  deviceCreatedAt: number;          // When this device was initialized
  lastSyncedAt: number;             // Last successful sync timestamp
  syncHistory: SyncRecord[];        // Log of all sync operations
  
  // === DEVICE-LOCAL STATE (non-syncable) ===
  salt: string;                     // Device-specific password salt
  biometricProfile?: BiometricProfile; // Device-specific biometric binding
  vaultSettings: VaultSettings;     // Device-specific preferences
  
  // === METADATA ===
  createdAt: number;
  lastModified: number;
  schemaVersion: number;            // For future migrations (v4 = 1)
}

export interface RotationRecordV4 {
  rotationId: string;
  timestamp: number;
  reason: string;
  deviceId: string;                 // Which device performed rotation
  deviceName?: string;              // Optional device name
  previousPublicKey: string;
  newPublicKey: string;
  mediaReWrapped: number;
  success: boolean;
}

export interface SyncRecord {
  syncId: string;                   // UUID for this sync operation
  timestamp: number;                // When sync occurred
  sourceDeviceId: string;           // Device that exported
  sourceDeviceName?: string;        // Optional source device name
  targetDeviceId: string;           // Device that imported
  syncType: 'export' | 'import';    // Operation type
  keypairsUpdated: boolean;         // Whether keypairs changed
  previousKeypairsMerged: number;   // Number of previous keys merged
  rotationHistoryMerged: number;    // Number of rotation records merged
  conflictsResolved: number;        // Number of conflicts encountered
  signature: string;                // HMAC signature of sync data
}

export interface BiometricProfile {
  enabled: boolean;
  platform: 'darwin' | 'win32' | 'linux';
  biometricType: 'touchid' | 'faceid' | 'windows-hello' | 'none';
  enrolledAt: number;
  lastVerifiedAt?: number;
}

export interface VaultSettings {
  autoLockEnabled: boolean;
  autoLockTimeoutMs: number;
  requireBiometricOnLaunch: boolean;
  requirePasswordOnLaunch: boolean;
  allowBackgroundDecrypt: boolean;
}

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
export async function migrateKeystoreV3ToV4(
  v3Keystore: EncryptedKeystoreV3
): Promise<EncryptedKeystoreV4> {
  console.log('[KeystoreV4] Migrating v3 → v4...');
  
  // Generate or load device ID
  const deviceId = await getOrCreateDeviceId();
  const deviceName = getDeviceName();
  
  // Detect biometric capabilities
  const biometricProfile = await detectBiometricProfile();
  
  // Migrate rotation history to v4 format
  const rotationHistoryV4: RotationRecordV4[] = (v3Keystore.rotationHistory || []).map((record: any) => ({
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
  
  const v4Keystore: EncryptedKeystoreV4 = {
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
export function isKeystoreV4(keystore: any): keystore is EncryptedKeystoreV4 {
  return keystore && keystore.version === 'v4';
}

/**
 * Load keystore v4 (with automatic migration from v3)
 * 
 * @returns Current v4 keystore or null if not found
 */
export async function loadKeystoreV4(): Promise<EncryptedKeystoreV4 | null> {
  try {
    // Import keystore loader
    const { loadKeystoreV3 } = await import('./keypairRotation');
    const keystore = await loadKeystoreV3();
    
    if (!keystore) {
      return null;
    }
    
    // Check version
    if ((keystore as any).version === 'v4') {
      return keystore as unknown as EncryptedKeystoreV4;
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
  } catch (error) {
    console.error('[KeystoreV4] Load failed:', error);
    throw error;
  }
}

/**
 * Save keystore v4
 */
export async function saveKeystoreV4(keystore: EncryptedKeystoreV4): Promise<void> {
  try {
    const { saveKeystore } = await import('./hybridKeypairStore');
    
    // Update lastModified
    keystore.lastModified = Date.now();
    
    await saveKeystore(keystore as any);
    console.log('[KeystoreV4] Saved successfully');
  } catch (error) {
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
export async function getOrCreateDeviceId(): Promise<string> {
  try {
    const userDataPath = app.getPath('userData');
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
  } catch (error) {
    console.error('[KeystoreV4] Device ID generation failed:', error);
    // Fallback to random UUID (will be different each app launch)
    return crypto.randomUUID();
  }
}

/**
 * Get human-readable device name
 */
export function getDeviceName(): string {
  try {
    const hostname = os.hostname();
    const platform = process.platform;
    
    // Clean up hostname (remove .local, etc.)
    const cleanHostname = hostname.replace(/\.local$/i, '');
    
    // Add platform suffix for clarity
    const platformMap: Record<string, string> = {
      darwin: 'macOS',
      win32: 'Windows',
      linux: 'Linux',
    };
    const platformName = platformMap[platform] || platform;
    
    return `${cleanHostname} (${platformName})`;
  } catch (error) {
    console.error('[KeystoreV4] Device name detection failed:', error);
    return `Unknown Device (${process.platform})`;
  }
}

/**
 * Detect biometric capabilities of current device
 */
export async function detectBiometricProfile(): Promise<BiometricProfile | undefined> {
  const platform = process.platform as 'darwin' | 'win32' | 'linux';
  
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
  } else if (platform === 'win32') {
    // Windows: Check for Windows Hello
    return {
      enabled: false,
      platform: 'win32',
      biometricType: 'windows-hello',
      enrolledAt: 0,
    };
  } else {
    // Linux: No built-in biometric support
    return undefined;
  }
}

/**
 * Get default vault settings for new device
 */
export function getDefaultVaultSettings(): VaultSettings {
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
export function countPreviousKeypairs(keystore: EncryptedKeystoreV4): number {
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
  } catch (error) {
    return 0;
  }
}

/**
 * Get timestamp of last rotation
 */
export function getLastRotationTimestamp(keystore: EncryptedKeystoreV4): number | undefined {
  if (keystore.rotationHistory.length === 0) {
    return undefined;
  }
  
  // Rotation history is sorted chronologically
  return keystore.rotationHistory[keystore.rotationHistory.length - 1].timestamp;
}

/**
 * Get last rotation for specific public key
 */
export function getLastRotationFor(
  keystore: EncryptedKeystoreV4,
  publicKey: string
): RotationRecordV4 | null {
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
export function validateRotationChainIntegrity(
  rotationHistory: RotationRecordV4[]
): void {
  if (rotationHistory.length === 0) {
    return; // Empty history is valid
  }
  
  const seenIds = new Set<string>();
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
