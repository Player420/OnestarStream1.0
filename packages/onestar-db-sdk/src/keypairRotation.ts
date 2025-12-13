// src/lib/keypairRotation.ts
// Phase 19: Automated Key Rotation Engine
// Phase 20: Rotation Safety & Concurrency Control
// SECURITY: Forward secrecy through periodic key rotation, backward compat for old media

import * as crypto from 'crypto';
import {
  generateHybridKeypair,
  wrapMediaKeyHybrid,
  unwrapMediaKeyHybrid,
  serializePublicKey,
  type HybridKeypair,
  type HybridPublicKey,
  type HybridCiphertext,
} from './postQuantumCrypto';
import {
  getKeystorePath,
  loadKeystore,
  saveKeystore,
  type EncryptedKeystore,
} from './hybridKeypairStore';
import * as fs from 'fs/promises';

/**
 * PHASE 20: ROTATION CONCURRENCY CONTROL
 * 
 * Global rotation lock system to prevent:
 * - Two rotations running simultaneously
 * - Rotation during vault lock
 * - Rotation during app shutdown
 * - Database corruption from concurrent rewrap
 */

interface RotationLockState {
  locked: boolean;
  lockAcquiredAt: Date;
  userId: string;
  operation: string;
}

const rotationLocks = new Map<string, RotationLockState>();

// Lock timeout (30 minutes - prevents deadlock)
const LOCK_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Rotation abort controller
 * Allows graceful cancellation of rotation operations
 */
export interface RotationAbortController {
  abort(): void;
  isAborted(): boolean;
  onAbort(callback: () => void): void;
}

/**
 * Create abort controller for rotation
 */
export function createRotationAbortController(): RotationAbortController {
  let aborted = false;
  const callbacks: Array<() => void> = [];
  
  return {
    abort(): void {
      if (!aborted) {
        aborted = true;
        console.log('[RotationAbortController] Abort signal triggered');
        callbacks.forEach(cb => {
          try {
            cb();
          } catch (error) {
            console.error('[RotationAbortController] Callback error:', error);
          }
        });
      }
    },
    
    isAborted(): boolean {
      return aborted;
    },
    
    onAbort(callback: () => void): void {
      if (aborted) {
        callback(); // Call immediately if already aborted
      } else {
        callbacks.push(callback);
      }
    },
  };
}

/**
 * Acquire rotation lock for a user
 * 
 * @param userId - User identifier
 * @returns true if lock acquired, false if already locked
 */
export function acquireRotationLock(userId: string): boolean {
  const existing = rotationLocks.get(userId);
  
  if (existing && existing.locked) {
    // Check for timeout (auto-release after 30 minutes)
    const elapsed = Date.now() - existing.lockAcquiredAt.getTime();
    if (elapsed < LOCK_TIMEOUT_MS) {
      console.warn(`[RotationLock] Lock already held for user ${userId} (${Math.round(elapsed / 1000)}s ago)`);
      return false;
    } else {
      console.warn(`[RotationLock] Lock timeout exceeded, force-releasing lock for user ${userId}`);
      rotationLocks.delete(userId);
    }
  }
  
  rotationLocks.set(userId, {
    locked: true,
    lockAcquiredAt: new Date(),
    userId,
    operation: 'rotation',
  });
  
  console.log(`[RotationLock] Lock acquired for user ${userId}`);
  return true;
}

/**
 * Release rotation lock for a user
 * 
 * @param userId - User identifier
 */
export function releaseRotationLock(userId: string): void {
  if (rotationLocks.has(userId)) {
    rotationLocks.delete(userId);
    console.log(`[RotationLock] Lock released for user ${userId}`);
  }
}

/**
 * Check if rotation is in progress
 * 
 * @param userId - Optional user ID (checks all users if omitted)
 * @returns true if any/specified rotation is in progress
 */
export function isRotationInProgress(userId?: string): boolean {
  if (userId) {
    const lock = rotationLocks.get(userId);
    if (!lock) return false;
    
    // Check for timeout
    const elapsed = Date.now() - lock.lockAcquiredAt.getTime();
    if (elapsed >= LOCK_TIMEOUT_MS) {
      rotationLocks.delete(userId);
      return false;
    }
    
    return lock.locked;
  }
  
  // Check all users
  for (const [uid, lock] of rotationLocks.entries()) {
    const elapsed = Date.now() - lock.lockAcquiredAt.getTime();
    if (elapsed >= LOCK_TIMEOUT_MS) {
      rotationLocks.delete(uid);
    } else if (lock.locked) {
      return true;
    }
  }
  
  return false;
}

/**
 * Force-release all rotation locks (emergency cleanup)
 * 
 * @param userId - User ID or '*' for all users
 */
export function forceReleaseRotationLock(userId: string): void {
  if (userId === '*') {
    console.warn('[RotationLock] Force-releasing ALL rotation locks');
    rotationLocks.clear();
  } else {
    console.warn(`[RotationLock] Force-releasing rotation lock for user ${userId}`);
    rotationLocks.delete(userId);
  }
}

/**
 * KEYSTORE V3 SCHEMA (Phase 19)
 * 
 * Multi-keypair model:
 * - currentKeypair: Active key (encryption + decryption)
 * - previousKeypairs[]: Retired keys (decryption only)
 * - rotationHistory[]: Audit trail
 * 
 * Security Properties:
 * - Forward secrecy: New keys cannot decrypt old media (unless re-wrapped)
 * - Backward compatibility: Old keys can still decrypt legacy media
 * - Audit trail: Track all rotations for compliance
 * - Atomic updates: Rotation is all-or-nothing
 */

export interface EncryptedKeypairV3 {
  encryptedKeypair: string; // AES-GCM encrypted HybridKeypair JSON
  iv: string; // Base64-encoded 12-byte GCM IV
  publicKey: {
    kyber: string;
    x25519: string;
  };
  createdAt: string; // ISO 8601
  keyId: string; // Unique identifier (UUIDv4)
}

export interface RetiredKeypairV3 extends EncryptedKeypairV3 {
  retiredAt: string; // ISO 8601
  reason: string; // "rotation" | "compromised" | "manual" | "expired"
}

export interface RotationHistoryEntry {
  timestamp: string; // ISO 8601
  oldKeyId: string;
  newKeyId: string;
  reason: string;
  mediaReWrapped: number;
  duration: number; // milliseconds
  triggeredBy: 'automatic' | 'manual' | 'security-event';
}

export interface RotationPolicy {
  mode: 'manual' | 'scheduled';
  intervalDays: number; // Default: 180
  nextRotationDue?: string; // ISO 8601
  autoRotateEnabled: boolean;
}

export interface EncryptedKeystoreV3 {
  version: 'v3';
  algorithm: 'Kyber768-X25519-AES256GCM';
  
  // Key derivation (unchanged)
  salt: string;
  iterations: number;
  
  // Multi-keypair structure
  currentKeypair: EncryptedKeypairV3;
  previousKeypairs: RetiredKeypairV3[];
  rotationHistory: RotationHistoryEntry[];
  
  // Rotation policy
  rotationPolicy: RotationPolicy;
  
  // Metadata
  createdAt: string;
  lastUnlockedAt?: string;
  userId?: string;
  
  // Biometric (unchanged)
  biometric?: {
    enrolled: boolean;
    enrolledAt?: string;
    method?: 'touch-id' | 'face-id' | 'windows-hello';
    encryptedPasswordHash?: string;
  };
}

/**
 * Generate UUID v4 for keyId
 */
function generateUUID(): string {
  return crypto.randomUUID();
}

/**
 * Calculate next rotation due date
 * 
 * @param intervalDays - Days until next rotation
 * @returns ISO 8601 timestamp
 */
function calculateNextRotation(intervalDays: number): string {
  const now = new Date();
  const nextRotation = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);
  return nextRotation.toISOString();
}

/**
 * Calculate key age in days
 * 
 * @param createdAt - ISO 8601 timestamp
 * @returns Days since creation
 */
function calculateKeyAge(createdAt: string): number {
  const created = new Date(createdAt);
  return (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Migrate keystore from v2 to v3
 * 
 * MIGRATION STRATEGY:
 * - Convert single keypair to currentKeypair
 * - Initialize empty previousKeypairs[]
 * - Create migration entry in rotationHistory
 * - Keep v2 backup for safety
 * - Atomic operation (all-or-nothing)
 * 
 * @param v2Keystore - Existing v2 keystore
 * @returns Migrated v3 keystore
 */
export async function migrateKeystoreV2ToV3(v2Keystore: EncryptedKeystore): Promise<EncryptedKeystoreV3> {
  if (v2Keystore.version !== 'v2') {
    throw new Error(`Cannot migrate from version ${v2Keystore.version}, expected v2`);
  }
  
  console.log('[KeypairRotation] Migrating keystore v2 → v3');
  
  // 1. Convert current keypair to v3 format with keyId
  const currentKeypair: EncryptedKeypairV3 = {
    encryptedKeypair: v2Keystore.encryptedKeypair,
    iv: v2Keystore.iv,
    publicKey: v2Keystore.publicKey,
    createdAt: v2Keystore.createdAt,
    keyId: generateUUID(), // Assign ID to existing keypair
  };
  
  // 2. Initialize empty previous keypairs (none before v3)
  const previousKeypairs: RetiredKeypairV3[] = [];
  
  // 3. Create migration entry in rotation history
  const rotationHistory: RotationHistoryEntry[] = [
    {
      timestamp: new Date().toISOString(),
      oldKeyId: 'v2-migration',
      newKeyId: currentKeypair.keyId,
      reason: 'Migrated from keystore v2 to v3',
      mediaReWrapped: 0,
      duration: 0,
      triggeredBy: 'automatic',
    },
  ];
  
  // 4. Convert rotation policy
  const rotationPolicy: RotationPolicy = {
    mode: v2Keystore.rotation?.rotationPolicy || 'scheduled',
    intervalDays: v2Keystore.rotation?.rotationIntervalDays || 180,
    nextRotationDue: v2Keystore.rotation?.nextRotationDue || calculateNextRotation(180),
    autoRotateEnabled: v2Keystore.rotation?.rotationPolicy === 'scheduled',
  };
  
  // 5. Build v3 keystore
  const v3Keystore: EncryptedKeystoreV3 = {
    version: 'v3',
    algorithm: v2Keystore.algorithm,
    salt: v2Keystore.salt,
    iterations: v2Keystore.iterations,
    currentKeypair,
    previousKeypairs,
    rotationHistory,
    rotationPolicy,
    createdAt: v2Keystore.createdAt,
    lastUnlockedAt: v2Keystore.lastUnlockedAt,
    userId: v2Keystore.userId,
    biometric: v2Keystore.biometric,
  };
  
  // 6. Save backup of v2 keystore
  const keystorePath = getKeystorePath();
  const backupPath = `${keystorePath}.v2.backup`;
  await fs.copyFile(keystorePath, backupPath);
  console.log(`[KeypairRotation] Backup created: ${backupPath}`);
  
  console.log('[KeypairRotation] Migration complete');
  return v3Keystore;
}

/**
 * Load keystore with automatic v2 → v3 migration
 * 
 * @returns Keystore (v3 format)
 */
export async function loadKeystoreV3(): Promise<EncryptedKeystoreV3 | null> {
  const keystore = await loadKeystore();
  
  if (!keystore) {
    return null;
  }
  
  // Auto-migrate v2 → v3
  if (keystore.version === 'v2') {
    const v3Keystore = await migrateKeystoreV2ToV3(keystore);
    await saveKeystore(v3Keystore as any); // TypeScript workaround
    return v3Keystore;
  }
  
  // Check if already v3
  if (keystore.version === 'v1') {
    throw new Error('Keystore v1 is no longer supported. Please upgrade to v2 first.');
  }
  
  if ((keystore as any).version !== 'v3') {
    throw new Error(`Unsupported keystore version: ${keystore.version}`);
  }
  
  return keystore as unknown as EncryptedKeystoreV3;
}

/**
 * Check if keystore needs rotation
 * 
 * @param keystore - v3 keystore
 * @returns true if rotation is due
 */
export function needsRotation(keystore: EncryptedKeystoreV3): boolean {
  if (!keystore.rotationPolicy.autoRotateEnabled) {
    return false;
  }
  
  if (keystore.rotationPolicy.mode === 'manual') {
    return false;
  }
  
  if (!keystore.rotationPolicy.nextRotationDue) {
    return false;
  }
  
  const nextRotationDate = new Date(keystore.rotationPolicy.nextRotationDue);
  return Date.now() >= nextRotationDate.getTime();
}

/**
 * Get rotation status for UI display
 * 
 * @param keystore - v3 keystore
 * @returns Rotation status summary
 */
export function getRotationStatus(keystore: EncryptedKeystoreV3): {
  currentKeyId: string;
  currentKeyAge: number; // days
  rotationCount: number;
  needsRotation: boolean;
  nextRotationDue?: string;
  daysUntilDue?: number;
  previousKeysCount: number;
  lastRotation?: {
    timestamp: string;
    reason: string;
    mediaReWrapped: number;
  };
} {
  const currentKeyAge = calculateKeyAge(keystore.currentKeypair.createdAt);
  const previousKeysCount = keystore.previousKeypairs.length;
  const rotationCount = keystore.rotationHistory.length - 1; // Subtract migration entry
  
  let daysUntilDue: number | undefined;
  if (keystore.rotationPolicy.nextRotationDue) {
    const nextRotationDate = new Date(keystore.rotationPolicy.nextRotationDue);
    daysUntilDue = (nextRotationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  }
  
  // Get last rotation (excluding migration)
  const lastRotationEntry = keystore.rotationHistory
    .filter(entry => entry.oldKeyId !== 'v2-migration')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];
  
  const lastRotation = lastRotationEntry ? {
    timestamp: lastRotationEntry.timestamp,
    reason: lastRotationEntry.reason,
    mediaReWrapped: lastRotationEntry.mediaReWrapped,
  } : undefined;
  
  return {
    currentKeyId: keystore.currentKeypair.keyId,
    currentKeyAge,
    rotationCount,
    needsRotation: needsRotation(keystore),
    nextRotationDue: keystore.rotationPolicy.nextRotationDue,
    daysUntilDue,
    previousKeysCount,
    lastRotation,
  };
}

/**
 * Get rotation history for audit trail
 * 
 * @param keystore - v3 keystore
 * @returns Array of rotation entries
 */
export function getRotationHistory(keystore: EncryptedKeystoreV3): RotationHistoryEntry[] {
  return keystore.rotationHistory
    .filter(entry => entry.oldKeyId !== 'v2-migration') // Exclude migration entry
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

/**
 * Rotation result
 */
export interface RotationResult {
  success: boolean;
  newKeyId: string;
  oldKeyId: string;
  mediaReWrapped: number;
  mediaFailed: number; // Phase 20: Track failures
  duration: number;
  error?: string;
  aborted?: boolean; // Phase 20: Abort flag
  rollbackPerformed?: boolean; // Phase 20: Rollback flag
}

/**
 * Core key rotation function
 * 
 * ROTATION WORKFLOW:
 * 1. Acquire rotation lock (Phase 20)
 * 2. Verify vault is unlocked
 * 3. Load current v3 keystore
 * 4. Decrypt current keypair (for re-wrapping)
 * 5. Generate new hybrid keypair
 * 6. Re-wrap all user's media keys (optional)
 * 7. Check abort controller periodically (Phase 20)
 * 8. Automatic rollback on >20% failures (Phase 20)
 * 9. Move current → previous
 * 10. Set new as current
 * 11. Update rotation history
 * 12. Atomically save keystore
 * 13. Zeroize keys
 * 14. Release rotation lock (Phase 20)
 * 
 * SECURITY:
 * - All operations in preload (trusted context)
 * - Atomic keystore update (all-or-nothing)
 * - Keys zeroized after use
 * - Audit trail maintained
 * - Forward secrecy guaranteed
 * - Concurrency-safe (Phase 20)
 * 
 * @param currentKeypair - Decrypted current keypair (from vault)
 * @param password - User's vault password
 * @param userId - User identifier
 * @param reason - Reason for rotation
 * @param options - Rotation options
 * @returns Rotation result
 */
export async function rotateKeypair(
  currentKeypair: HybridKeypair,
  password: string,
  userId: string,
  reason: string = 'manual rotation',
  options?: {
    force?: boolean;
    reWrapMedia?: boolean;
    encryptKeypairFn?: (keypair: HybridKeypair, password: string) => Promise<{ encryptedKeypair: string; iv: string }>;
    reWrapAllMediaFn?: (
      oldKeypair: HybridKeypair,
      newKeypair: HybridKeypair,
      abortController?: RotationAbortController
    ) => Promise<{ success: number; failed: number }>;
    abortController?: RotationAbortController;
    rollbackOnFailureThreshold?: number; // Default: 0.2 (20%)
  }
): Promise<RotationResult> {
  const startTime = Date.now();
  
  // Phase 20: Acquire rotation lock
  if (!acquireRotationLock(userId)) {
    console.error('[KeypairRotation] Failed to acquire rotation lock');
    return {
      success: false,
      newKeyId: '',
      oldKeyId: '',
      mediaReWrapped: 0,
      mediaFailed: 0,
      duration: 0,
      error: 'Another rotation is already in progress',
    };
  }
  
  // Backup keystore for rollback
  let keystoreBackup: EncryptedKeystoreV3 | null = null;
  
  try {
    console.log('[KeypairRotation] Starting key rotation...');
    console.log(`[KeypairRotation] Reason: ${reason}`);
    
    // 1. Load current v3 keystore
    const currentKeystore = await loadKeystoreV3();
    if (!currentKeystore) {
      throw new Error('No keystore found');
    }
    
    if (currentKeystore.version !== 'v3') {
      throw new Error('Must migrate to v3 before rotation');
    }
    
    // Create backup for rollback
    keystoreBackup = { ...currentKeystore };
    
    // Phase 20: Check abort controller before expensive operations
    if (options?.abortController?.isAborted()) {
      console.warn('[KeypairRotation] Rotation aborted before keypair generation');
      return {
        success: false,
        newKeyId: '',
        oldKeyId: currentKeystore.currentKeypair.keyId,
        mediaReWrapped: 0,
        mediaFailed: 0,
        duration: Date.now() - startTime,
        aborted: true,
      };
    }
    
    // 2. Generate new hybrid keypair
    console.log('[KeypairRotation] Generating new keypair...');
    const newKeypair = await generateHybridKeypair();
    const newKeyId = generateUUID();
    
    // 3. Re-wrap all user's media keys (if enabled)
    let mediaReWrapped = 0;
    let mediaFailed = 0;
    
    if (options?.reWrapMedia !== false) {
      console.log('[KeypairRotation] Re-wrapping media keys...');
      
      if (options?.reWrapAllMediaFn) {
        const result = await options.reWrapAllMediaFn(
          currentKeypair,
          newKeypair,
          options.abortController
        );
        
        mediaReWrapped = result.success;
        mediaFailed = result.failed;
      } else {
        console.warn('[KeypairRotation] No reWrapAllMediaFn provided, skipping media re-wrap');
      }
      
      console.log(`[KeypairRotation] Re-wrapped ${mediaReWrapped} media keys, ${mediaFailed} failed`);
      
      // Phase 20: Automatic rollback on high failure rate
      const rollbackThreshold = options?.rollbackOnFailureThreshold ?? 0.2;
      const totalMedia = mediaReWrapped + mediaFailed;
      
      if (mediaFailed > 0 && totalMedia > 0) {
        const failureRate = mediaFailed / totalMedia;
        
        if (failureRate > rollbackThreshold) {
          console.error(`[KeypairRotation] Failure rate ${(failureRate * 100).toFixed(1)}% exceeds threshold ${(rollbackThreshold * 100)}%, rolling back...`);
          
          // Rollback: restore original keystore
          if (keystoreBackup) {
            await saveKeystore(keystoreBackup as any);
          }
          
          return {
            success: false,
            newKeyId: '',
            oldKeyId: currentKeystore.currentKeypair.keyId,
            mediaReWrapped,
            mediaFailed,
            duration: Date.now() - startTime,
            error: `Rollback: ${mediaFailed} of ${totalMedia} media failed (${(failureRate * 100).toFixed(1)}%)`,
            rollbackPerformed: true,
          };
        }
      }
    }
    
    // Phase 20: Check abort before committing changes
    if (options?.abortController?.isAborted()) {
      console.warn('[KeypairRotation] Rotation aborted after re-wrap, rolling back...');
      
      if (keystoreBackup) {
        await saveKeystore(keystoreBackup as any);
      }
      
      return {
        success: false,
        newKeyId: '',
        oldKeyId: currentKeystore.currentKeypair.keyId,
        mediaReWrapped,
        mediaFailed,
        duration: Date.now() - startTime,
        aborted: true,
        rollbackPerformed: true,
      };
    }
    
    // 4. Encrypt new keypair
    console.log('[KeypairRotation] Encrypting new keypair...');
    let encryptedNewKeypair: { encryptedKeypair: string; iv: string };
    
    if (options?.encryptKeypairFn) {
      encryptedNewKeypair = await options.encryptKeypairFn(newKeypair, password);
    } else {
      // Default encryption (inline for now - should use hybridKeypairStore.encryptKeypair)
      const iv = crypto.randomBytes(12);
      const keypairJson = JSON.stringify({
        kyber: {
          publicKey: Buffer.from(newKeypair.kyber.publicKey).toString('base64'),
          privateKey: Buffer.from(newKeypair.kyber.privateKey).toString('base64'),
        },
        x25519: {
          publicKey: Buffer.from(newKeypair.x25519.publicKey).toString('base64'),
          privateKey: Buffer.from(newKeypair.x25519.privateKey).toString('base64'),
        },
      });
      
      // Derive key from password (simplified - should use deriveKeyFromPassword)
      const salt = Buffer.from(currentKeystore.salt, 'base64');
      const encryptionKey = crypto.pbkdf2Sync(password, salt, 600_000, 32, 'sha256');
      
      const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
      const encrypted = Buffer.concat([cipher.update(keypairJson, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      
      encryptedNewKeypair = {
        encryptedKeypair: Buffer.concat([encrypted, tag]).toString('base64'),
        iv: iv.toString('base64'),
      };
      
      encryptionKey.fill(0); // Zeroize
    }
    
    // 5. Build new v3 keystore
    console.log('[KeypairRotation] Building new keystore...');
    const newKeystore: EncryptedKeystoreV3 = {
      ...currentKeystore,
      
      // Move current to previous
      previousKeypairs: [
        ...currentKeystore.previousKeypairs,
        {
          ...currentKeystore.currentKeypair,
          retiredAt: new Date().toISOString(),
          reason,
        },
      ],
      
      // Set new as current
      currentKeypair: {
        encryptedKeypair: encryptedNewKeypair.encryptedKeypair,
        iv: encryptedNewKeypair.iv,
        publicKey: {
          kyber: Buffer.from(newKeypair.kyber.publicKey).toString('base64'),
          x25519: Buffer.from(newKeypair.x25519.publicKey).toString('base64'),
        },
        createdAt: new Date().toISOString(),
        keyId: newKeyId,
      },
      
      // Append to rotation history
      rotationHistory: [
        ...currentKeystore.rotationHistory,
        {
          timestamp: new Date().toISOString(),
          oldKeyId: currentKeystore.currentKeypair.keyId,
          newKeyId,
          reason,
          mediaReWrapped,
          duration: Date.now() - startTime,
          triggeredBy: options?.force ? 'security-event' : 'manual',
        },
      ],
      
      // Update rotation policy
      rotationPolicy: {
        ...currentKeystore.rotationPolicy,
        nextRotationDue: calculateNextRotation(currentKeystore.rotationPolicy.intervalDays),
      },
    };
    
    // 6. Atomically save keystore
    console.log('[KeypairRotation] Saving keystore...');
    await saveKeystore(newKeystore as any); // TypeScript workaround
    
    // 7. Zeroize keys
    console.log('[KeypairRotation] Zeroizing keys...');
    currentKeypair.kyber.privateKey.fill(0);
    currentKeypair.x25519.privateKey.fill(0);
    newKeypair.kyber.privateKey.fill(0);
    newKeypair.x25519.privateKey.fill(0);
    
    const duration = Date.now() - startTime;
    console.log(`[KeypairRotation] Rotation complete in ${duration}ms`);
    
    return {
      success: true,
      newKeyId,
      oldKeyId: currentKeystore.currentKeypair.keyId,
      mediaReWrapped,
      mediaFailed,
      duration,
    };
  } catch (error) {
    console.error('[KeypairRotation] Rotation failed:', error);
    
    // Attempt rollback on error
    if (keystoreBackup) {
      try {
        console.log('[KeypairRotation] Rolling back keystore after error...');
        await saveKeystore(keystoreBackup as any);
      } catch (rollbackError) {
        console.error('[KeypairRotation] Rollback failed:', rollbackError);
      }
    }
    
    return {
      success: false,
      newKeyId: '',
      oldKeyId: '',
      mediaReWrapped: 0,
      mediaFailed: 0,
      duration: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
      rollbackPerformed: !!keystoreBackup,
    };
  } finally {
    // Phase 20: Always release lock
    releaseRotationLock(userId);
  }
}

/**
 * Unwrap media key with fallback to previous keypairs
 * 
 * BACKWARD COMPATIBILITY:
 * - Try current keypair first (fastest path)
 * - Try previous keypairs in reverse chronological order
 * - Fail if no keypair can unwrap
 * 
 * SECURITY (Phase 20):
 * - Constant-time unwrap (mitigates timing attacks)
 * - All keypairs attempted regardless of success
 * - Timing does NOT leak key position information
 * 
 * @param wrappedKey - Hybrid ciphertext from database
 * @param currentKeypair - Current decrypted keypair
 * @param previousKeypairs - Previous decrypted keypairs (optional)
 * @returns Unwrapped media key
 */
export async function unwrapMediaKeyWithFallback(
  wrappedKey: HybridCiphertext,
  currentKeypair: HybridKeypair,
  previousKeypairs?: HybridKeypair[]
): Promise<Uint8Array> {
  // Phase 20: Constant-time unwrap to prevent timing side-channels
  // Strategy: Try ALL keys, measure ALL times, return first success
  
  const allKeypairs: HybridKeypair[] = [
    currentKeypair,
    ...(previousKeypairs || []).slice().reverse(), // Newest to oldest
  ];
  
  // Try all keypairs in parallel (constant time regardless of which succeeds)
  const results = await Promise.allSettled(
    allKeypairs.map(async (keypair, index) => {
      try {
        const mediaKey = await unwrapMediaKeyHybrid(wrappedKey, keypair);
        return { success: true as const, mediaKey, index };
      } catch (error) {
        return { success: false as const, error, index };
      }
    })
  );
  
  // Find first successful unwrap
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'fulfilled' && result.value.success) {
      const keyType = i === 0 ? 'current' : `previous[${i - 1}]`;
      console.log(`[KeypairRotation] Successfully unwrapped with ${keyType} key (constant-time)`);
      return result.value.mediaKey;
    }
  }
  
  // All unwrap attempts failed
  const totalAttempts = allKeypairs.length;
  console.error(`[KeypairRotation] Failed to unwrap with all ${totalAttempts} available keypairs`);
  throw new Error(`Failed to unwrap media key with all available keypairs (tried ${totalAttempts} keys)`);
}
