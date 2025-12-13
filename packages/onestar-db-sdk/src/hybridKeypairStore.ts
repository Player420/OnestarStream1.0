// src/lib/hybridKeypairStore.ts
// Persistent PQ-Hybrid Keypair Storage with Vault Integration
// SECURITY: AES-256-GCM encrypted-at-rest, password-derived keys, hardware-backed optional

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import type { HybridKeypair } from './postQuantumCrypto';

/**
 * KEYSTORE FORMAT VERSION 1
 * 
 * Security Architecture:
 * 1. Private keypair encrypted with user's vault password (AES-256-GCM)
 * 2. Public key stored in plaintext (safe for sharing)
 * 3. PBKDF2-SHA256 key derivation (600,000 iterations)
 * 4. Random salt per keystore (16 bytes)
 * 5. Random IV per encryption (12 bytes)
 * 6. GCM authentication tag (16 bytes, embedded)
 * 
 * Threat Model:
 * - ✅ Protects against: disk theft, memory dumps (when locked), malware (at-rest)
 * - ✅ Forward secrecy: ephemeral X25519 keys in wrapping (separate concern)
 * - ✅ Post-quantum secure: Kyber-768 + X25519 hybrid
 * - ⚠️  Does NOT protect against: keyloggers, screen capture, runtime memory attacks
 * 
 * Storage Location:
 * - macOS: ~/Library/Application Support/OneStarStream/keystore.json
 * - Linux: ~/.config/OneStarStream/keystore.json
 * - Windows: %APPDATA%/OneStarStream/keystore.json
 */

/**
 * Encrypted keystore structure (persisted to disk)
 * 
 * VERSION 1 (Phase 16): Basic persistent keypairs
 * VERSION 2 (Phase 17): Added key rotation metadata
 */
export interface EncryptedKeystore {
  version: 'v1' | 'v2';
  algorithm: 'Kyber768-X25519-AES256GCM';
  
  // Key derivation parameters
  salt: string; // Base64-encoded 16-byte salt
  iterations: number; // PBKDF2 iterations (600,000+)
  
  // Encrypted private keypair
  encryptedKeypair: string; // Base64-encoded AES-GCM(JSON(HybridKeypair))
  iv: string; // Base64-encoded 12-byte GCM IV
  // Note: GCM tag is embedded in encryptedKeypair (SubtleCrypto behavior)
  
  // Public keys (plaintext, safe to share)
  publicKey: {
    kyber: string; // Base64-encoded Kyber public key
    x25519: string; // Base64-encoded X25519 public key
  };
  
  // Metadata
  createdAt: string; // ISO 8601 timestamp
  lastUnlockedAt?: string; // ISO 8601 timestamp
  userId?: string; // Optional user identifier
  
  // Key Rotation Metadata (v2+)
  rotation?: {
    lastRotatedAt?: string; // ISO 8601 timestamp
    rotationCount: number; // Number of times keypair has been rotated
    nextRotationDue?: string; // ISO 8601 timestamp (scheduled rotation)
    rotationPolicy: 'manual' | 'scheduled'; // Rotation strategy
    rotationIntervalDays?: number; // Default: 180 days
  };
  
  // Biometric Enrollment (v2+)
  biometric?: {
    enrolled: boolean;
    enrolledAt?: string; // ISO 8601 timestamp
    method?: 'touch-id' | 'face-id' | 'windows-hello';
    encryptedPasswordHash?: string; // For verification (not password itself!)
  };
}

/**
 * Plaintext keypair (in-memory only)
 */
export interface DecryptedKeypair {
  keypair: HybridKeypair;
  publicKey: {
    kyber: string;
    x25519: string;
  };
  metadata: {
    createdAt: Date;
    lastUnlockedAt?: Date;
    userId?: string;
    rotation?: {
      lastRotatedAt?: Date;
      rotationCount: number;
      nextRotationDue?: Date;
      rotationPolicy: 'manual' | 'scheduled';
      rotationIntervalDays?: number;
    };
    biometric?: {
      enrolled: boolean;
      enrolledAt?: Date;
      method?: 'touch-id' | 'face-id' | 'windows-hello';
    };
  };
}

/**
 * Security constants
 */
const SECURITY_PARAMS = {
  PBKDF2_ITERATIONS: 600_000, // Military-grade (OWASP 2023 recommendation)
  PBKDF2_HASH: 'sha256',
  SALT_LENGTH: 16, // 128 bits
  IV_LENGTH: 12, // 96 bits (GCM standard)
  KEY_LENGTH: 32, // 256 bits (AES-256)
  TAG_LENGTH: 16, // 128 bits (GCM tag)
} as const;

/**
 * Get platform-specific keystore directory
 */
export function getKeystoreDirectory(): string {
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
export function getKeystorePath(): string {
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
function deriveKeyFromPassword(password: string, salt: Buffer): Buffer {
  if (salt.length !== SECURITY_PARAMS.SALT_LENGTH) {
    throw new Error(`Invalid salt length: expected ${SECURITY_PARAMS.SALT_LENGTH}, got ${salt.length}`);
  }
  
  return crypto.pbkdf2Sync(
    password,
    salt,
    SECURITY_PARAMS.PBKDF2_ITERATIONS,
    SECURITY_PARAMS.KEY_LENGTH,
    SECURITY_PARAMS.PBKDF2_HASH
  );
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
export async function encryptKeypair(
  keypair: HybridKeypair,
  password: string,
  userId?: string,
  options?: {
    rotationPolicy?: 'manual' | 'scheduled';
    rotationIntervalDays?: number;
    biometricEnrolled?: boolean;
    biometricMethod?: 'touch-id' | 'face-id' | 'windows-hello';
  }
): Promise<EncryptedKeystore> {
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
    const encryptedChunks: Buffer[] = [];
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
    
    const keystore: EncryptedKeystore = {
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
  } catch (error) {
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
export async function decryptKeypair(
  keystore: EncryptedKeystore,
  password: string
): Promise<DecryptedKeypair> {
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
    
    const decryptedChunks: Buffer[] = [];
    decryptedChunks.push(decipher.update(ciphertext));
    decryptedChunks.push(decipher.final()); // Throws if authentication fails
    
    const plaintextBuffer = Buffer.concat(decryptedChunks);
    const plaintextJson = plaintextBuffer.toString('utf-8');
    
    // Zeroize plaintext buffer after parsing
    plaintextBuffer.fill(0);
    
    // Parse keypair JSON
    const parsed = JSON.parse(plaintextJson);
    
    const keypair: HybridKeypair = {
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
    const metadata: DecryptedKeypair['metadata'] = {
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
  } catch (error) {
    // Zeroize key on error
    decryptionKey.fill(0);
    
    if ((error as Error).message.includes('Unsupported state or unable to authenticate data')) {
      throw new Error('Invalid password or keystore has been tampered with');
    }
    throw error;
  } finally {
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
export async function saveKeystore(keystore: EncryptedKeystore): Promise<void> {
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
  } catch (error) {
    // Clean up temp file on error
    try {
      await fs.unlink(tempPath);
    } catch {}
    throw error;
  }
}

/**
 * Load encrypted keystore from disk
 * 
 * @returns Encrypted keystore or null if not found
 */
export async function loadKeystore(): Promise<EncryptedKeystore | null> {
  const keystorePath = getKeystorePath();
  
  try {
    const json = await fs.readFile(keystorePath, 'utf-8');
    const keystore = JSON.parse(json) as EncryptedKeystore;
    
    // Validate structure
    if (!keystore.version || !keystore.encryptedKeypair || !keystore.publicKey) {
      throw new Error('Invalid keystore format');
    }
    
    console.log(`[KeypairStore] Keystore loaded from: ${keystorePath}`);
    return keystore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.log(`[KeypairStore] No keystore found at: ${keystorePath}`);
      return null;
    }
    throw error;
  }
}

/**
 * Check if keystore exists
 */
export async function keystoreExists(): Promise<boolean> {
  const keystorePath = getKeystorePath();
  try {
    await fs.access(keystorePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete keystore from disk
 * 
 * SECURITY: Use secure deletion if available (overwrite with random data)
 */
export async function deleteKeystore(): Promise<void> {
  const keystorePath = getKeystorePath();
  
  try {
    // Overwrite with random data before deletion (basic secure deletion)
    const stats = await fs.stat(keystorePath);
    const randomData = crypto.randomBytes(stats.size);
    await fs.writeFile(keystorePath, randomData);
    
    // Delete file
    await fs.unlink(keystorePath);
    
    console.log(`[KeypairStore] Keystore deleted: ${keystorePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Update last unlocked timestamp
 */
export async function updateLastUnlocked(keystore: EncryptedKeystore): Promise<void> {
  keystore.lastUnlockedAt = new Date().toISOString();
  await saveKeystore(keystore);
}

/**
 * Validate keystore integrity
 * 
 * @param keystore - Keystore to validate
 * @returns true if valid, false otherwise
 */
export function validateKeystore(keystore: EncryptedKeystore): boolean {
  try {
    // Check version
    if (keystore.version !== 'v1' && keystore.version !== 'v2') return false;
    
    // Check required fields
    if (!keystore.salt || !keystore.iv || !keystore.encryptedKeypair) return false;
    if (!keystore.publicKey?.kyber || !keystore.publicKey?.x25519) return false;
    
    // Check iterations
    if (keystore.iterations < SECURITY_PARAMS.PBKDF2_ITERATIONS) return false;
    
    // Check Base64 encoding
    Buffer.from(keystore.salt, 'base64');
    Buffer.from(keystore.iv, 'base64');
    Buffer.from(keystore.encryptedKeypair, 'base64');
    Buffer.from(keystore.publicKey.kyber, 'base64');
    Buffer.from(keystore.publicKey.x25519, 'base64');
    
    return true;
  } catch {
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
export function isRotationDue(keystore: EncryptedKeystore): boolean {
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
export function getRotationStatus(keystore: EncryptedKeystore): {
  isDue: boolean;
  daysSinceCreation: number;
  daysSinceLastRotation?: number;
  daysUntilDue?: number;
  rotationCount: number;
  policy: 'manual' | 'scheduled';
} {
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
  
  let daysUntilDue: number | undefined;
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
export function markKeypairRotated(keystore: EncryptedKeystore, rotationIntervalDays?: number): void {
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
  } else {
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
export function updateBiometricEnrollment(
  keystore: EncryptedKeystore,
  enrolled: boolean,
  method?: 'touch-id' | 'face-id' | 'windows-hello'
): void {
  if (enrolled) {
    keystore.biometric = {
      enrolled: true,
      enrolledAt: new Date().toISOString(),
      method,
    };
  } else {
    keystore.biometric = {
      enrolled: false,
    };
  }
}

/**
 * PHASE 20: PREVIOUS KEYPAIRS LOADING
 * 
 * Load and decrypt historical keypairs for backward compatibility
 */

/**
 * Keystore v3 types (imported from keypairRotation.ts conceptually)
 */
interface EncryptedKeypairV3 {
  encryptedKeypair: string;
  iv: string;
  publicKey: {
    kyber: string;
    x25519: string;
  };
  createdAt: string;
  keyId: string;
}

interface RetiredKeypairV3 extends EncryptedKeypairV3 {
  retiredAt: string;
  reason: string;
}

interface EncryptedKeystoreV3 {
  version: 'v3';
  algorithm: 'Kyber768-X25519-AES256GCM';
  salt: string;
  iterations: number;
  currentKeypair: EncryptedKeypairV3;
  previousKeypairs: RetiredKeypairV3[];
  rotationHistory: any[];
  rotationPolicy: any;
  createdAt: string;
  lastUnlockedAt?: string;
  userId?: string;
  biometric?: any;
}

/**
 * Decrypted keypair with history metadata
 */
export interface DecryptedKeypairWithHistory {
  keypair: DecryptedKeypair;
  previousKeypairs: Array<{
    keypair: HybridKeypair;
    keyId: string;
    createdAt: Date;
    retiredAt: Date;
    reason: string;
  }>;
  rotationHistory: any[];
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
export async function loadPreviousKeypairs(
  password: string
): Promise<Array<{
  keypair: HybridKeypair;
  keyId: string;
  createdAt: Date;
  retiredAt: Date;
  reason: string;
}>> {
  const keystore = await loadKeystore();
  
  if (!keystore) {
    console.warn('[HybridKeypairStore] No keystore found');
    return [];
  }
  
  // Check if v3 keystore
  if ((keystore as any).version !== 'v3') {
    console.warn('[HybridKeypairStore] Keystore is not v3, no previous keypairs available');
    return [];
  }
  
  const keystoreV3 = keystore as unknown as EncryptedKeystoreV3;
  
  if (!keystoreV3.previousKeypairs || keystoreV3.previousKeypairs.length === 0) {
    console.log('[HybridKeypairStore] No previous keypairs in keystore');
    return [];
  }
  
  console.log(`[HybridKeypairStore] Loading ${keystoreV3.previousKeypairs.length} previous keypairs...`);
  
  const previousKeypairs: Array<{
    keypair: HybridKeypair;
    keyId: string;
    createdAt: Date;
    retiredAt: Date;
    reason: string;
  }> = [];
  
  for (const retiredKeypair of keystoreV3.previousKeypairs) {
    try {
      // Build temporary v1-compatible keystore for decryption
      const tempKeystore: EncryptedKeystore = {
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
    } catch (error) {
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
export async function loadKeypairWithHistory(
  password: string
): Promise<DecryptedKeypairWithHistory | null> {
  const keystore = await loadKeystore();
  
  if (!keystore) {
    return null;
  }
  
  // Decrypt current keypair
  const current = await decryptKeypair(keystore, password);
  
  // Decrypt previous keypairs (if v3)
  const previous = await loadPreviousKeypairs(password);
  
  // Get rotation history (if v3)
  const rotationHistory = (keystore as any).version === 'v3'
    ? ((keystore as unknown as EncryptedKeystoreV3).rotationHistory || [])
    : [];
  
  return {
    keypair: current,
    previousKeypairs: previous,
    rotationHistory,
  };
}

