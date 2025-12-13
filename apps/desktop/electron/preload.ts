/***************************************************************************************************
 * preload.ts — ARCHITECTURE D + PQ-Hybrid Encrypted Media Playback
 * Renderer <-> Main audio IPC bridge with post-quantum secure decryption.
 **************************************************************************************************/

import { contextBridge, ipcRenderer } from "electron";
import {
  generateHybridKeypair,
  unwrapAndDecryptMedia,
  generateOrLoadPersistentHybridKeypair,
  getPersistentKeypair,
  getPersistentPublicKey,
  lockPersistentKeypair,
  isPersistentKeypairUnlocked,
  ensurePersistentKeypairLoaded,
  type HybridKeypair,
  type HybridCiphertext,
  type HybridPublicKey,
} from "@onestar/db-sdk";
import { VaultLifecycleManager, isVaultUnlocked } from "@onestar/db-sdk";
import {
  isBiometricAvailable,
  enrollBiometric,
  unlockWithBiometric,
  testBiometric,
  unenrollBiometric,
} from "@onestar/db-sdk";
import type { DecryptedKeypair } from "@onestar/db-sdk";
import {
  addMedia,
  getMedia,
  listMedia,
  removeMedia,
  clearIndex,
  refreshIndex,
  getIndexStats,
  type MediaItem,
} from "@onestar/db-sdk";
import {
  streamEncryptedMedia,
  STREAMING_CONFIG,
} from "@onestar/db-sdk";
import {
  performRotation,
  loadRotationStatus,
  loadRotationHistory,
  checkRotationNeeded,
} from "@onestar/db-sdk";
import {
  isRotationInProgress,
  createRotationAbortController,
  type RotationAbortController,
  loadKeystoreV3,
} from "@onestar/db-sdk";

// ========================================
// PHASE 21: SYNC TYPE DEFINITIONS
// ========================================

interface ExportResult {
  success: boolean;
  filePath?: string;
  fileSize?: number;
  exportedAt?: number;
  error?: string;
}

interface ImportResult {
  success: boolean;
  sourceDevice?: string;
  sourceDeviceId?: string;
  keypairsUpdated?: boolean;
  previousKeypairsMerged?: number;
  rotationHistoryMerged?: number;
  conflictsResolved?: number;
  error?: string;
}

interface SyncStatus {
  lastSyncedAt: number;
  totalSyncOperations: number;
  deviceId: string;
  deviceName: string;
  currentKeypairRotatedAt?: number;
  previousKeypairsCount: number;
  needsSync: boolean;
}

interface BiometricProfile {
  enabled: boolean;
  platform: 'darwin' | 'win32' | 'linux';
  biometricType: 'touchid' | 'faceid' | 'windows-hello' | 'none';
  enrolledAt: number;
  lastVerifiedAt?: number;
}

interface VaultSettings {
  autoLockEnabled: boolean;
  autoLockTimeoutMs: number;
  requireBiometricOnLaunch: boolean;
  requirePasswordOnLaunch: boolean;
  allowBackgroundDecrypt: boolean;
}

interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  deviceCreatedAt: number;
  platform: string;
  biometricProfile?: BiometricProfile;
  vaultSettings: VaultSettings;
}

interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  firstSeenAt: number;
  lastSeenAt: number;
  isCurrent: boolean;
  rotationCount?: number;
  syncCount?: number;
}

/**
 * PHASE 20: ACTIVE ROTATION CONTROLLER
 * 
 * Stores abort controller for active rotation (for shutdown handler)
 */
let activeRotationController: RotationAbortController | null = null;

/**
 * PHASE 20: USER ID RESOLUTION
 * 
 * Get current user ID from keystore metadata
 * Strategy: Load from keystore v3 userId field, fallback to UUID
 */
async function getCurrentUserId(): Promise<string> {
  try {
    const keystore = await loadKeystoreV3();
    if (keystore?.userId) {
      return keystore.userId;
    }
    
    // Fallback: Generate UUID for first-time users
    // This will be saved to keystore on next vault operation
    const userId = crypto.randomUUID();
    console.log(`[Preload] Generated new user ID: ${userId}`);
    return userId;
  } catch (error) {
    console.error('[Preload] Failed to get user ID:', error);
    return 'default-user'; // Ultimate fallback
  }
}

/**
 * VAULT LIFECYCLE MANAGER (Phase 17)
 * 
 * Manages vault state, auto-lock, password validation, security events.
 * 
 * Features:
 * - State machine: LOCKED → UNLOCKING → UNLOCKED
 * - Idle auto-lock (5 minutes default)
 * - Password strength enforcement (16-char minimum, entropy checks)
 * - Security event handlers (sleep, screen lock, minimize, blur)
 * - Biometric unlock integration (Touch ID, Windows Hello)
 * - Activity tracking
 */
const vaultLifecycle = new VaultLifecycleManager({
  idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
  minPasswordLength: 16,
  lockOnSleep: true,
  lockOnScreenLock: true,
  lockOnMinimize: false, // Don't lock on minimize (user preference)
  lockOnWindowBlur: false, // Don't lock on blur (too aggressive)
});

/**
 * VAULT LIFECYCLE EVENT LISTENERS (Phase 17)
 * 
 * Forward vault state changes to renderer for UI updates.
 */
vaultLifecycle.on('stateChange', (event) => {
  console.log(`[Preload] Vault state: ${event.oldState} → ${event.newState} (${event.reason})`);
  // Renderer can listen to this via window.onestar.onVaultStateChange
});

vaultLifecycle.on('idleTimeout', (event) => {
  console.log(`[Preload] Idle timeout after ${Math.round(event.idleTimeMs / 1000)}s`);
});

vaultLifecycle.on('activityRecorded', (event) => {
  // Suppress logs (too noisy)
});

/**
 * USER KEYPAIR STORAGE (Persistent + In-Memory)
 * 
 * SECURITY ARCHITECTURE (UPGRADED FOR PERSISTENT KEYPAIRS):
 * 
 * OLD (Phase 15):
 * - PQ-hybrid keypair generated on first use (ephemeral)
 * - Stored in preload memory only
 * - Lost on app restart (not persistent)
 * 
 * NEW (Phase 16 Step 6):
 * - PQ-hybrid keypair generated once, encrypted, stored on disk
 * - Encrypted with user's vault password (AES-256-GCM + PBKDF2)
 * - Decrypted on vault unlock → held in preload memory
 * - Zeroized on vault lock or app exit
 * - NEVER exposed to renderer process
 * 
 * STORAGE:
 * - Disk: ~/Library/Application Support/OneStarStream/keystore.json (encrypted)
 * - Memory: preload context only (decrypted, access-controlled)
 * 
 * LIFECYCLE:
 * 1. First run: generateOrLoadPersistentHybridKeypair(password) → generates + saves
 * 2. Subsequent runs: generateOrLoadPersistentHybridKeypair(password) → loads + decrypts
 * 3. Vault lock: lockPersistentKeypair() → zeroizes memory
 * 4. Vault unlock: generateOrLoadPersistentHybridKeypair(password) → reloads
 * 
 * BACKWARD COMPATIBILITY:
 * - getUserKeypair() now uses persistent keypair (falls back to ephemeral for demo)
 * - Existing media playback continues to work
 * - New uploads use persistent public key (shareable across sessions)
 */
let userHybridKeypair: HybridKeypair | null = null; // Legacy ephemeral (fallback only)

/**
 * PERFORMANCE: Cache parsed wrappedKey JSON to avoid repeated JSON.parse
 * SECURITY: Safe because wrappedKey is immutable ciphertext (no secret material)
 * BENEFIT: Saves 0.2-0.5ms + reduces GC pressure on repeated playback
 */
const wrappedKeyCache = new Map<string, HybridCiphertext>();

/**
 * Get or generate user's PQ-hybrid keypair.
 * 
 * UPGRADED IMPLEMENTATION (Phase 16 Step 6):
 * - Prioritizes persistent keypair (if unlocked)
 * - Falls back to ephemeral keypair (backward compatibility only)
 * 
 * SECURITY:
 * - Persistent keypair: encrypted at rest, vault-password protected
 * - Ephemeral keypair: in-memory only (demo/fallback mode)
 * - Both are NEVER exposed to renderer process
 * 
 * PRODUCTION USAGE:
 * - Always unlock vault first: await window.onestar.unlockKeypair(password)
 * - Then use media APIs (upload, playback, sharing)
 * 
 * @returns User's hybrid keypair
 */
async function getUserKeypair(): Promise<HybridKeypair> {
  // Priority 1: Use persistent keypair if unlocked
  const persistentKeypair = getPersistentKeypair();
  if (persistentKeypair) {
    console.log('[Preload] Using persistent PQ-hybrid keypair (vault unlocked)');
    return persistentKeypair.keypair;
  }
  
  // Priority 2: Fall back to ephemeral keypair (backward compatibility)
  if (!userHybridKeypair) {
    console.log('[Preload] WARNING: Using ephemeral keypair (vault not unlocked)');
    console.log('[Preload] This keypair will be lost on app restart!');
    console.log('[Preload] For production: call window.onestar.unlockKeypair(password) first');
    userHybridKeypair = await generateHybridKeypair();
    console.log('[Preload] Ephemeral keypair generated:', {
      kyberPublic: userHybridKeypair.kyber.publicKey.length,
      kyberPrivate: userHybridKeypair.kyber.privateKey.length,
      x25519Public: userHybridKeypair.x25519.publicKey.length,
      x25519Private: userHybridKeypair.x25519.privateKey.length,
    });
  }
  return userHybridKeypair;
}

/**
 * Unwrap and decrypt encrypted media.
 * SECURITY: All cryptographic operations happen in preload (never renderer).
 * 
 * PERFORMANCE OPTIMIZATIONS (Phase 1 - Quick Wins):
 * - Decode Base64 strings ONCE in preload (not in postQuantumCrypto)
 * - Cache parsed wrappedKey JSON (avoid repeated JSON.parse)
 * - Pass pre-decoded Uint8Arrays to crypto functions (eliminates copies)
 * - Batch validation before expensive operations
 * 
 * Estimated Performance Gain: 40% faster, 60% less memory
 * 
 * Workflow:
 * 1. Fetch encrypted media from API
 * 2. Batch validate + decode Base64 strings
 * 3. Unwrap mediaKey using PQ-hybrid KEM
 * 4. Decrypt ciphertext with AES-256-GCM
 * 5. Create Blob URL for playback
 * 6. Zeroize keys from memory
 * 
 * @param mediaId - Media blob ID from database
 * @returns Object with Blob URL, mimeType, and cleanup function
 * @throws Error if decryption fails
 */
async function unwrapAndDecryptMediaForPlayback(mediaId: string): Promise<{
  blobUrl: string;
  mimeType: string;
  title?: string;
  cleanup: () => void;
}> {
  const perfStart = performance.now(); // Performance instrumentation
  
  try {
    console.log(`[Preload] Decrypting media: ${mediaId}`);

    // Step 1: Fetch encrypted media from API
    const response = await fetch(`http://localhost:3000/api/encrypted-media/get/${mediaId}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch media: ${response.statusText}`);
    }

    const data = await response.json();
    
    // Type guard for API response
    if (typeof data !== 'object' || data === null || !('ok' in data)) {
      throw new Error('[Preload] Invalid API response format');
    }
    
    const typedData = data as {
      ok: boolean;
      error?: string;
      mediaBlobId?: string;
      licenseId?: string;
      ciphertext?: string;
      iv?: string;
      wrappedKey?: string;
      metadata?: {
        mimeType?: string;
        title?: string;
      };
    };
    
    if (!typedData.ok) {
      throw new Error(typedData.error || 'Failed to retrieve encrypted media');
    }

    console.log('[Preload] Media retrieved:', {
      mediaId: typedData.mediaBlobId,
      licenseId: typedData.licenseId,
      ciphertextSize: typedData.ciphertext?.length,
      mimeType: typedData.metadata?.mimeType,
    });

    // SECURITY: Validate API response fields before decryption
    if (!typedData.ciphertext || typeof typedData.ciphertext !== 'string') {
      throw new Error('[Preload] Invalid ciphertext in API response');
    }
    if (!typedData.iv || typeof typedData.iv !== 'string') {
      throw new Error('[Preload] Invalid IV in API response');
    }
    if (!typedData.wrappedKey || typeof typedData.wrappedKey !== 'string') {
      throw new Error('[Preload] Invalid wrappedKey in API response');
    }
    if (!typedData.metadata?.mimeType) {
      throw new Error('[Preload] Missing mimeType in metadata');
    }

    // Validate IV length (12 bytes for GCM)
    const ivBytes = Buffer.from(typedData.iv, 'base64');
    if (ivBytes.length !== 12) {
      throw new Error(`[Preload] Invalid IV length: expected 12 bytes, got ${ivBytes.length}`);
    }

    console.log('[Preload] API response validated');

    // PERFORMANCE: Decode Base64 strings ONCE (not in crypto functions)
    const perfDecodeStart = performance.now();
    const ciphertextBytes = Buffer.from(typedData.ciphertext, 'base64');
    const ivBytesDecoded = Buffer.from(typedData.iv, 'base64');
    console.log(`[Perf] Base64 decode: ${(performance.now() - perfDecodeStart).toFixed(2)}ms`);

    // PERFORMANCE: Check wrappedKey cache (avoid repeated JSON.parse)
    let wrappedKey = wrappedKeyCache.get(mediaId);
    if (!wrappedKey) {
      // Parse wrapped key (detect format)
      if (typeof typedData.wrappedKey === 'string' && typedData.wrappedKey.startsWith('{')) {
        // PQ-hybrid format (JSON)
        wrappedKey = JSON.parse(typedData.wrappedKey) as HybridCiphertext;
        wrappedKeyCache.set(mediaId, wrappedKey); // Cache for future playback
        console.log('[Preload] Parsed and cached PQ-hybrid wrapped key');
      } else {
        // Legacy format - not supported in this implementation
        throw new Error('Legacy wrapped key format not supported. Use PQ-hybrid format.');
      }
    } else {
      console.log('[Perf] wrappedKey cache hit');
    }

    // Step 3: Get user's keypair
    const keypair = await getUserKeypair();

    // Step 4: Unwrap and decrypt media (OPTIMIZED: Pass pre-decoded buffers)
    console.log('[Preload] Unwrapping and decrypting...');
    const perfDecryptStart = performance.now();
    const plaintext = await unwrapAndDecryptMedia(
      ciphertextBytes, // ← Pre-decoded Uint8Array (no Base64 overhead in crypto)
      ivBytesDecoded,  // ← Pre-decoded Uint8Array
      wrappedKey,      // ← Cached HybridCiphertext
      keypair          // ← User's private keypair
    );
    console.log(`[Perf] Decrypt: ${(performance.now() - perfDecryptStart).toFixed(2)}ms`);

    console.log('[Preload] Decryption successful:', plaintext.length, 'bytes');

    // Step 5: Create Blob for playback
    const perfBlobStart = performance.now();
    const blob = new Blob([plaintext], { type: typedData.metadata.mimeType });
    const blobUrl = URL.createObjectURL(blob);
    console.log(`[Perf] Blob creation: ${(performance.now() - perfBlobStart).toFixed(2)}ms`);

    console.log('[Preload] Blob URL created:', blobUrl);
    console.log(`[Perf] Total pipeline: ${(performance.now() - perfStart).toFixed(2)}ms`);

    // Step 6: Return with cleanup function
    return {
      blobUrl,
      mimeType: typedData.metadata.mimeType,
      title: typedData.metadata.title,
      cleanup: () => {
        console.log('[Preload] Revoking Blob URL:', blobUrl);
        URL.revokeObjectURL(blobUrl);
      },
    };
  } catch (error) {
    console.error('[Preload] Decryption error:', error);
    throw error;
  }
}

// Expose exact Architecture D API at the top-level `window.onestar` object.
const api = {
  // Audio API
  loadMedia: (absPath: string) => ipcRenderer.invoke("onestar:loadMedia", { absPath }),
  playHD: () => ipcRenderer.invoke("onestar:playHD"),
  pauseHD: () => ipcRenderer.invoke("onestar:pauseHD"),
  seekHD: (seconds: number) => ipcRenderer.invoke("onestar:seekHD", { seconds }),
  getAudioTime: () => ipcRenderer.invoke("onestar:getAudioTime"),

  // Chunked save API
  startChunkedSave: (opts: any) => ipcRenderer.invoke("onestar:startSave", opts),
  appendChunk: (opts: any) =>
    ipcRenderer.invoke("onestar:appendSave", {
      sessionId: opts.sessionId,
      chunk: Buffer.from(opts.chunk),
    }),
  finishChunkedSave: (opts: any) => ipcRenderer.invoke("onestar:finishSave", opts),

  // Media list / management
  listMedia: () => ipcRenderer.invoke("onestar:listMedia"),
  deleteMedia: (id: string) => ipcRenderer.invoke("onestar:deleteMedia", { id }),

  // Helpers (existing handlers)
  getFilePath: (id: string) => ipcRenderer.invoke("onestar:getFilePath", { id }),
  getShareFile: (id: string) => ipcRenderer.invoke("onestar:getShareFile", { id }),
  getFileBytes: (absPath: string) => ipcRenderer.invoke("onestar:getFileBytes", { absPath }),

  // Encrypted Media Playback API (PQ-Hybrid Secure)
  /**
   * Decrypt and play encrypted media from database.
   * SECURITY: All decryption happens in preload (keys never reach renderer).
   * 
   * @param mediaId - Media blob ID from database
   * @returns Object with Blob URL and cleanup function
   */
  unwrapAndDecryptMedia: (mediaId: string) => unwrapAndDecryptMediaForPlayback(mediaId),

  /***************************************************************************************************
   * PERSISTENT KEYPAIR LIFECYCLE APIs (Phase 16 Step 6)
   * 
   * These APIs manage the user's long-lived PQ-hybrid keypair with vault integration.
   * 
   * SECURITY BOUNDARY:
   * - All APIs execute in preload (trusted context)
   * - Private keys NEVER exposed to renderer
   * - Public keys safe to return (used for wrapping)
   * - Password processed only in preload (never stored)
   **************************************************************************************************/

  /**
   * Unlock user's persistent keypair with vault password.
   * 
   * Phase 17 UPGRADE:
   * - Uses VaultLifecycleManager for password validation
   * - Enforces 16-char minimum, entropy checks
   * - Records activity (starts idle timer)
   * - Emits state change events
   * 
   * WORKFLOW:
   * 1. Derive key from password (PBKDF2, 600k iterations)
   * 2. Load encrypted keystore from disk
   * 3. Decrypt keypair (AES-256-GCM)
   * 4. Store in preload memory
   * 5. Update last unlocked timestamp
   * 
   * FIRST RUN:
   * - Generates new keypair if keystore doesn't exist
   * - Encrypts and saves to disk
   * 
   * SUBSEQUENT RUNS:
   * - Loads existing keypair from disk
   * - Decrypts with password
   * 
   * @param password - User's vault password
   * @param userId - Optional user identifier
   * @returns Success status, public key, metadata, and unlock duration
   * @throws Error if password is wrong or too weak
   */
  unlockKeypair: async (password: string, userId?: string) => {
    try {
      console.log('[Preload API] Unlocking vault...');
      
      // Phase 17: Use VaultLifecycleManager
      const result = await vaultLifecycle.unlockWithPassword(password, userId);
      
      if (!result.success) {
        throw new Error(result.error || 'Unknown unlock error');
      }
      
      console.log('[Preload API] Vault unlocked successfully');
      return {
        success: true,
        publicKey: result.keypair!.publicKey,
        metadata: {
          createdAt: result.keypair!.metadata.createdAt.toISOString(),
          lastUnlockedAt: result.keypair!.metadata.lastUnlockedAt?.toISOString(),
          userId: result.keypair!.metadata.userId,
          rotation: result.keypair!.metadata.rotation ? {
            lastRotatedAt: result.keypair!.metadata.rotation.lastRotatedAt?.toISOString(),
            rotationCount: result.keypair!.metadata.rotation.rotationCount,
            nextRotationDue: result.keypair!.metadata.rotation.nextRotationDue?.toISOString(),
            rotationPolicy: result.keypair!.metadata.rotation.rotationPolicy,
            rotationIntervalDays: result.keypair!.metadata.rotation.rotationIntervalDays,
          } : undefined,
          biometric: result.keypair!.metadata.biometric,
        },
        unlockDurationMs: result.duration,
      };
    } catch (error) {
      console.error('[Preload API] Failed to unlock vault:', error);
      throw new Error(`Vault unlock failed: ${(error as Error).message}`);
    }
  },

  /**
   * Lock (wipe) persistent keypair from memory.
   * 
   * Phase 17 UPGRADE:
   * - Uses VaultLifecycleManager.lock()
   * - Stops idle timer
   * - Emits state change events
   * 
   * SECURITY:
   * - Zeroizes all private key material
   * - Call when user locks vault
   * - Call on app exit (cleanup)
   * 
   * USAGE:
   * - User clicks "Lock Vault" button
   * - Session timeout
   * - User logout
   */
  lockKeypair: () => {
    try {
      console.log('[Preload API] Locking vault...');
      vaultLifecycle.lock('Manual lock');
      console.log('[Preload API] Vault locked successfully');
      return { success: true };
    } catch (error) {
      console.error('[Preload API] Failed to lock vault:', error);
      throw new Error(`Vault lock failed: ${(error as Error).message}`);
    }
  },

  /**
   * Get user's public key (safe to share).
   * 
   * SECURITY: Public key is NOT sensitive (used for wrapping).
   * 
   * USE CASES:
   * - Media upload (wrap key with user's public key)
   * - Inbox share (wrap key with recipient's public key)
   * - P2P key exchange (send public key to peer)
   * 
   * @returns HybridPublicKey or null if vault is locked
   */
  getUserPublicKey: (): HybridPublicKey | null => {
    const publicKey = getPersistentPublicKey();
    
    if (!publicKey) {
      console.log('[Preload API] No public key available (vault locked)');
    }
    
    return publicKey;
  },

  /**
   * Check if keypair is currently unlocked.
   * 
   * @returns true if keypair is in memory
   */
  isKeypairUnlocked: (): boolean => {
    return isPersistentKeypairUnlocked();
  },

  /**
   * Ensure keypair is loaded (or throw error).
   * 
   * Helper for enforcing vault unlock before crypto operations.
   * 
   * @throws Error if keypair is not unlocked
   */
  ensureKeypairLoaded: () => {
    ensurePersistentKeypairLoaded();
  },

  /***************************************************************************************************
   * PHASE 17: VAULT HARDENING APIs
   **************************************************************************************************/

  /**
   * Validate password strength (without unlocking).
   * 
   * CHECKS:
   * - Minimum 16 characters
   * - Shannon entropy (bits)
   * - Character diversity (lowercase, uppercase, digits, symbols)
   * - Common password blacklist
   * 
   * @param password - Password to validate
   * @returns Validation result with strength level and errors
   */
  validatePassword: (password: string) => {
    return vaultLifecycle.validatePassword(password);
  },

  /**
   * Get vault state.
   * 
   * @returns 'LOCKED' | 'UNLOCKING' | 'UNLOCKED'
   */
  getVaultState: () => {
    return vaultLifecycle.getState();
  },

  /**
   * Get idle time (seconds since last activity).
   * 
   * @returns Seconds since last activity
   */
  getIdleTime: () => {
    return vaultLifecycle.getIdleTime();
  },

  /**
   * Record user activity (resets idle timer).
   * 
   * Call on:
   * - Mouse movement
   * - Keyboard input
   * - Media playback
   */
  recordActivity: () => {
    vaultLifecycle.recordActivity();
  },

  /**
   * Update vault configuration.
   * 
   * @param config - Partial config to update
   */
  updateVaultConfig: (config: Partial<{
    idleTimeoutMs: number;
    minPasswordLength: number;
    lockOnSleep: boolean;
    lockOnScreenLock: boolean;
    lockOnMinimize: boolean;
    lockOnWindowBlur: boolean;
  }>) => {
    vaultLifecycle.updateConfig(config);
  },

  /***************************************************************************************************
   * BIOMETRIC UNLOCK APIs (Touch ID, Windows Hello)
   **************************************************************************************************/

  /**
   * Check if biometric authentication is available.
   * 
   * @returns Availability info (available, platform, method)
   */
  isBiometricAvailable: () => {
    return isBiometricAvailable();
  },

  /**
   * Enroll biometric unlock.
   * 
   * SECURITY:
   * - Encrypts password with OS secure storage
   * - macOS: Keychain with Touch ID/Face ID
   * - Windows: DPAPI with Windows Hello
   * - Linux: libsecret (not biometric)
   * 
   * @param password - User's vault password
   * @param userId - Optional user identifier
   * @returns Enrollment result
   */
  enrollBiometric: async (password: string, userId?: string) => {
    return enrollBiometric(password, userId);
  },

  /**
   * Unlock vault with biometric (Touch ID, Windows Hello).
   * 
   * WORKFLOW:
   * 1. Decrypt password from OS secure storage (triggers biometric prompt)
   * 2. Unlock keypair with decrypted password
   * 3. Start idle timer
   * 
   * @param encryptedPasswordBase64 - Base64-encoded encrypted password from enrollment
   * @param userId - Optional user identifier
   * @returns Unlock result with keypair
   */
  unlockWithBiometric: async (encryptedPasswordBase64: string, userId?: string) => {
    try {
      console.log('[Preload API] Unlocking with biometric...');
      const encryptedPassword = Buffer.from(encryptedPasswordBase64, 'base64');
      const result = await unlockWithBiometric(encryptedPassword, userId);
      
      if (!result.success) {
        throw new Error(result.error || 'Biometric unlock failed');
      }
      
      console.log('[Preload API] Biometric unlock successful');
      return {
        success: true,
        publicKey: result.keypair!.publicKey,
        metadata: {
          createdAt: result.keypair!.metadata.createdAt.toISOString(),
          lastUnlockedAt: result.keypair!.metadata.lastUnlockedAt?.toISOString(),
          userId: result.keypair!.metadata.userId,
        },
        unlockDurationMs: result.duration,
      };
    } catch (error) {
      console.error('[Preload API] Biometric unlock failed:', error);
      throw new Error(`Biometric unlock failed: ${(error as Error).message}`);
    }
  },

  /**
   * Test biometric hardware (triggers prompt without unlocking).
   * 
   * @returns Test result
   */
  testBiometric: async () => {
    return testBiometric();
  },

  /**
   * Unenroll biometric unlock.
   * 
   * SECURITY:
   * - Removes encrypted password from OS secure storage
   * - User must unlock with password again
   * 
   * @param userId - Optional user identifier (unused in current implementation)
   */
  unenrollBiometric: (userId?: string) => {
    return unenrollBiometric();
  },

  /***************************************************************************************************
   * PHASE 18: LOCAL MEDIA INDEX APIs
   **************************************************************************************************/

  /**
   * Get local media index.
   * 
   * Returns encrypted, cached list of user's media library.
   * Much faster than querying server every time.
   * 
   * @returns Array of media items
   */
  getLocalMediaIndex: async (): Promise<MediaItem[]> => {
    try {
      const media = await listMedia();
      console.log('[Preload API] Retrieved local media index:', media.length);
      return media;
    } catch (error) {
      console.error('[Preload API] Failed to get local media index:', error);
      throw new Error(`Failed to get local media index: ${(error as Error).message}`);
    }
  },

  /**
   * Refresh local media index from server.
   * 
   * Fetches all media licenses from API and rebuilds local index.
   * Call this after uploading new media or receiving shares.
   * 
   * @returns Number of media items indexed
   */
  refreshLocalMediaIndex: async (): Promise<number> => {
    try {
      const count = await refreshIndex();
      console.log('[Preload API] Refreshed local media index:', count);
      return count;
    } catch (error) {
      console.error('[Preload API] Failed to refresh local media index:', error);
      throw new Error(`Failed to refresh local media index: ${(error as Error).message}`);
    }
  },

  /**
   * Get media item by ID from local index.
   * 
   * @param mediaId - Media blob ID
   * @returns Media item or null if not found
   */
  getMediaFromIndex: async (mediaId: string): Promise<MediaItem | null> => {
    try {
      const item = await getMedia(mediaId);
      return item;
    } catch (error) {
      console.error('[Preload API] Failed to get media from index:', error);
      throw new Error(`Failed to get media from index: ${(error as Error).message}`);
    }
  },

  /**
   * Add media item to local index.
   * 
   * @param item - Media item to add
   */
  addMediaToIndex: async (item: MediaItem): Promise<void> => {
    try {
      await addMedia(item);
      console.log('[Preload API] Added media to index:', item.id);
    } catch (error) {
      console.error('[Preload API] Failed to add media to index:', error);
      throw new Error(`Failed to add media to index: ${(error as Error).message}`);
    }
  },

  /**
   * Remove media item from local index.
   * 
   * @param mediaId - Media blob ID
   * @returns true if removed, false if not found
   */
  removeMediaFromIndex: async (mediaId: string): Promise<boolean> => {
    try {
      const removed = await removeMedia(mediaId);
      console.log('[Preload API] Removed media from index:', mediaId);
      return removed;
    } catch (error) {
      console.error('[Preload API] Failed to remove media from index:', error);
      throw new Error(`Failed to remove media from index: ${(error as Error).message}`);
    }
  },

  /**
   * Clear entire local media index.
   */
  clearLocalMediaIndex: async (): Promise<void> => {
    try {
      await clearIndex();
      console.log('[Preload API] Cleared local media index');
    } catch (error) {
      console.error('[Preload API] Failed to clear local media index:', error);
      throw new Error(`Failed to clear local media index: ${(error as Error).message}`);
    }
  },

  /**
   * Get local media index statistics.
   * 
   * @returns Index stats or null if no index
   */
  getMediaIndexStats: async (): Promise<{
    mediaCount: number;
    totalSize: number;
    updatedAt?: string;
  } | null> => {
    try {
      const stats = await getIndexStats();
      return stats;
    } catch (error) {
      console.error('[Preload API] Failed to get index stats:', error);
      throw new Error(`Failed to get index stats: ${(error as Error).message}`);
    }
  },

  /***************************************************************************************************
   * PHASE 18: STREAMING DECRYPTION APIs
   **************************************************************************************************/

  /**
   * Open encrypted media stream.
   * 
   * Returns async generator that yields decrypted chunks.
   * Use for progressive playback with MediaSource API.
   * 
   * BENEFITS:
   * - Fast time-to-first-byte (<200ms)
   * - Low memory usage (only active chunks)
   * - Progressive playback (start while downloading)
   * - Seeking support (range requests)
   * 
   * USAGE:
   * ```typescript
   * const stream = await window.onestar.openEncryptedStream(mediaId);
   * for await (const chunk of stream) {
   *   sourceBuffer.appendBuffer(chunk);
   * }
   * ```
   * 
   * @param mediaId - Media blob ID
   * @param startByte - Optional start byte (for seeking)
   * @param endByte - Optional end byte (for seeking)
   * @returns Async generator of decrypted chunks
   */
  openEncryptedStream: async (
    mediaId: string,
    startByte?: number,
    endByte?: number
  ): Promise<AsyncGenerator<Uint8Array, void, unknown>> => {
    try {
      console.log('[Preload API] Opening encrypted stream:', { mediaId, startByte, endByte });

      // Create async generator wrapper
      async function* streamWrapper() {
        for await (const chunk of streamEncryptedMedia(mediaId, startByte, endByte)) {
          // Convert Buffer to Uint8Array for renderer
          yield new Uint8Array(chunk);
        }
      }

      return streamWrapper();
    } catch (error) {
      console.error('[Preload API] Failed to open encrypted stream:', error);
      throw new Error(`Failed to open encrypted stream: ${(error as Error).message}`);
    }
  },

  /**
   * Get streaming configuration.
   * 
   * @returns Streaming config (chunk size, etc.)
   */
  getStreamingConfig: () => {
    return {
      chunkSize: STREAMING_CONFIG.CHUNK_SIZE,
      headerSize: STREAMING_CONFIG.HEADER_SIZE,
      authTagSize: STREAMING_CONFIG.AUTH_TAG_SIZE,
    };
  },

  /***************************************************************************************************
   * PHASE 19: KEY ROTATION APIs
   **************************************************************************************************/

  /**
   * Rotate user's persistent keypair (manual trigger).
   * 
   * ROTATION WORKFLOW:
   * 1. Verify vault is unlocked
   * 2. Generate new PQ-hybrid keypair
   * 3. Re-wrap all user's media keys (optional)
   * 4. Move current keypair to previous[]
   * 5. Set new keypair as current
   * 6. Update rotation history
   * 7. Atomically save keystore v3
   * 8. Zeroize old keys
   * 
   * SECURITY:
   * - Requires vault unlocked
   * - Re-verifies password
   * - Atomic operation (all-or-nothing)
   * - Audit trail maintained
   * - Forward secrecy guaranteed
   * 
   * PERFORMANCE:
   * - ~10-12 seconds for 1000 media items
   * - Progress events emitted
   * 
   * @param password - Vault password (for re-verification)
   * @param reason - Reason for rotation (e.g., "manual", "scheduled", "security-event")
   * @param options - Rotation options
   * @returns Rotation result
   */
  /**
   * Phase 20: Rotate keypair with safety guarantees
   * 
   * Safety features:
   * - Checks rotation lock before starting
   * - Creates abort controller for graceful cancellation
   * - Resolves user ID from keystore metadata
   * - Supports automatic rollback on failures
   */
  rotateKeypair: async (
    password: string,
    reason: string = 'manual rotation',
    options?: {
      force?: boolean;
      reWrapMedia?: boolean;
      rollbackOnFailureThreshold?: number;
    }
  ): Promise<{
    success: boolean;
    newKeyId: string;
    oldKeyId: string;
    mediaReWrapped: number;
    mediaFailed: number;
    duration: number;
    error?: string;
    aborted?: boolean;
    rollbackPerformed?: boolean;
  }> => {
    try {
      console.log('[Preload API] Keypair rotation requested:', { reason, options });

      // Phase 20: Get current user ID from keystore
      const userId = await getCurrentUserId();
      console.log(`[Preload API] User ID: ${userId}`);

      // Phase 20: Check rotation lock
      if (isRotationInProgress(userId)) {
        console.error('[Preload API] Rotation already in progress');
        return {
          success: false,
          newKeyId: '',
          oldKeyId: '',
          mediaReWrapped: 0,
          mediaFailed: 0,
          duration: 0,
          error: 'Another rotation is already in progress. Please wait.',
        };
      }

      // Phase 20: Create abort controller
      const abortController = createRotationAbortController();
      activeRotationController = abortController;

      try {
        // Call rotation helper with abort support
        const result = await performRotation(password, reason, userId, {
          ...options,
          abortController,
        });

        return result;
      } finally {
        // Clear active rotation controller
        activeRotationController = null;
      }
    } catch (error) {
      console.error('[Preload API] Rotation failed:', error);
      activeRotationController = null;
      return {
        success: false,
        newKeyId: '',
        oldKeyId: '',
        mediaReWrapped: 0,
        mediaFailed: 0,
        duration: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  /**
   * Get rotation status for UI display.
   * 
   * @returns Rotation status summary
   */
  getRotationStatus: async (): Promise<{
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
  } | null> => {
    try {
      console.log('[Preload API] Getting rotation status...');

      const status = await loadRotationStatus();
      return status;
    } catch (error) {
      console.error('[Preload API] Failed to get rotation status:', error);
      return null;
    }
  },

  /**
   * Check if keypair rotation is due.
   * 
   * @returns true if rotation needed
   */
  needsRotation: async (): Promise<boolean> => {
    try {
      const status = await api.getRotationStatus();
      return status?.needsRotation ?? false;
    } catch (error) {
      console.error('[Preload API] Failed to check rotation status:', error);
      return false;
    }
  },

  /**
   * Get rotation history for audit trail.
   * 
   * @returns Array of rotation entries (newest first)
   */
  getRotationHistory: async (): Promise<Array<{
    timestamp: string;
    oldKeyId: string;
    newKeyId: string;
    reason: string;
    mediaReWrapped: number;
    duration: number;
    triggeredBy: 'automatic' | 'manual' | 'security-event';
  }>> => {
    try {
      console.log('[Preload API] Getting rotation history...');

      const history = await loadRotationHistory();
      return history;
    } catch (error) {
      console.error('[Preload API] Failed to get rotation history:', error);
      return [];
    }
  },

  /**
   * Register rotation event listener.
   * 
   * Events:
   * - 'rotation-due': Rotation is overdue
   * - 'rotation-warning': Rotation due soon
   * - 'rotation-complete': Rotation finished
   * - 'rotation-progress': Re-wrapping progress
   * 
   * @param event - Event name
   * @param callback - Event callback
   */
  onRotationEvent: (
    event: 'rotation-due' | 'rotation-warning' | 'rotation-complete' | 'rotation-progress',
    callback: (data: any) => void
  ): void => {
    ipcRenderer.on(`rotation:${event}`, (_event, data) => callback(data));
  },

  /**
   * Unregister rotation event listener.
   * 
   * @param event - Event name
   * @param callback - Event callback
   */
  offRotationEvent: (
    event: 'rotation-due' | 'rotation-warning' | 'rotation-complete' | 'rotation-progress',
    callback: (data: any) => void
  ): void => {
    ipcRenderer.removeListener(`rotation:${event}`, callback);
  },

  /**
   * Phase 20: Check if rotation is currently locked/in-progress
   * 
   * @param userId - Optional user ID (defaults to current user)
   * @returns true if rotation is in progress
   */
  isRotationLocked: async (userId?: string): Promise<boolean> => {
    try {
      const targetUserId = userId || await getCurrentUserId();
      return isRotationInProgress(targetUserId);
    } catch (error) {
      console.error('[Preload API] Failed to check rotation lock:', error);
      return false;
    }
  },

  /**
   * Phase 20: Abort the currently running rotation
   * 
   * Safe to call even if no rotation is active.
   * Rotation will perform rollback and emit rotation-error event.
   */
  abortRotation: async (): Promise<void> => {
    try {
      if (activeRotationController) {
        console.log('[Preload API] Aborting rotation...');
        activeRotationController.abort();
      } else {
        console.log('[Preload API] No active rotation to abort');
      }
    } catch (error) {
      console.error('[Preload API] Failed to abort rotation:', error);
    }
  },

  // ========================================
  // PHASE 21: CROSS-DEVICE SYNC APIs
  // ========================================

  sync: {
    /**
     * Export keystore to encrypted file for cross-device sync
     * 
     * SECURITY:
     * - Requires vault to be unlocked
     * - Password confirmation required
     * - Export encrypted with AES-256-GCM + 100k PBKDF2
     * - HMAC-SHA256 signature prevents tampering
     * - Only syncable fields exported (no device-local secrets)
     * 
     * @param password - Export password (min 8 characters)
     * @param confirmPassword - Password confirmation
     * @param outputPath - Optional output file path (defaults to Downloads)
     * @returns Export result with file path and metadata
     */
    exportKeystore: async (
      password: string,
      confirmPassword: string,
      outputPath?: string
    ): Promise<ExportResult> => {
      try {
        console.log('[Sync API] Export keystore requested');

        // Verify vault is unlocked
        if (!isVaultUnlocked()) {
          return {
            success: false,
            error: 'Vault must be unlocked to export keystore',
          };
        }

        // Emit sync-start event
        ipcRenderer.send('sync:start', { operation: 'export' });

        // Import export function
        const { exportKeystore } = await import('@onestar/db-sdk');

        // Perform export
        const result = await exportKeystore(password, confirmPassword, outputPath);

        // Emit appropriate event
        if (result.success) {
          ipcRenderer.send('sync:complete', {
            operation: 'export',
            filePath: result.filePath,
            fileSize: result.fileSize,
          });
          console.log(`[Sync API] Export successful: ${result.filePath}`);
        } else {
          ipcRenderer.send('sync:error', {
            operation: 'export',
            error: result.error,
          });
          console.error(`[Sync API] Export failed: ${result.error}`);
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Sync API] Export exception:', error);

        ipcRenderer.send('sync:error', {
          operation: 'export',
          error: errorMessage,
        });

        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    /**
     * Import keystore from encrypted file
     * 
     * SECURITY:
     * - Requires vault to be unlocked
     * - Validates HMAC signature before merge
     * - Validates SHA-256 checksum
     * - Detects downgrade attacks
     * - Detects replay attacks
     * - Preserves device-local state (salt, biometrics)
     * 
     * MERGE BEHAVIOR:
     * - Current keypair: newest wins (by timestamp)
     * - Previous keypairs: deduplicated by public key
     * - Rotation history: merged chronologically
     * - Device-local settings: always preserved
     * 
     * @param filePath - Path to encrypted export file
     * @param password - Decryption password
     * @returns Import result with merge statistics
     */
    importKeystore: async (
      filePath: string,
      password: string
    ): Promise<ImportResult> => {
      try {
        console.log(`[Sync API] Import keystore from: ${filePath}`);

        // Verify vault is unlocked
        if (!isVaultUnlocked()) {
          return {
            success: false,
            error: 'Vault must be unlocked to import keystore',
          };
        }

        // Emit sync-start event
        ipcRenderer.send('sync:start', { operation: 'import', filePath });

        // Import function
        const { importKeystore } = await import('@onestar/db-sdk');

        // Perform import
        const result = await importKeystore(filePath, password);

        // Emit appropriate event
        if (result.success) {
          ipcRenderer.send('sync:complete', {
            operation: 'import',
            sourceDevice: result.sourceDevice,
            sourceDeviceId: result.sourceDeviceId,
            keypairsUpdated: result.keypairsUpdated,
            previousKeypairsMerged: result.previousKeypairsMerged,
            rotationHistoryMerged: result.rotationHistoryMerged,
            conflictsResolved: result.conflictsResolved,
          });
          console.log('[Sync API] Import successful');
          console.log(`  - Source: ${result.sourceDevice}`);
          console.log(`  - Keypairs updated: ${result.keypairsUpdated}`);
          console.log(`  - Previous merged: ${result.previousKeypairsMerged}`);
          console.log(`  - Rotations merged: ${result.rotationHistoryMerged}`);
          console.log(`  - Conflicts resolved: ${result.conflictsResolved}`);
        } else {
          ipcRenderer.send('sync:error', {
            operation: 'import',
            error: result.error,
          });
          console.error(`[Sync API] Import failed: ${result.error}`);
        }

        return result;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('[Sync API] Import exception:', error);

        ipcRenderer.send('sync:error', {
          operation: 'import',
          error: errorMessage,
        });

        return {
          success: false,
          error: errorMessage,
        };
      }
    },

    /**
     * Get current sync status for this device
     * 
     * Returns information about:
     * - Last sync timestamp
     * - Total sync operations
     * - Current device info
     * - Keypair status
     * 
     * @returns Sync status with device metadata
     */
    getSyncStatus: async (): Promise<SyncStatus> => {
      try {
        const { loadKeystoreV4, getLastRotationTimestamp } = await import('@onestar/db-sdk');

        const keystore = await loadKeystoreV4();

        if (!keystore) {
          return {
            lastSyncedAt: 0,
            totalSyncOperations: 0,
            deviceId: 'unknown',
            deviceName: 'Unknown Device',
            currentKeypairRotatedAt: undefined,
            previousKeypairsCount: 0,
            needsSync: false,
          };
        }

        // Count previous keypairs
        let previousCount = 0;
        if (keystore.encryptedPreviousKeypairs) {
          try {
            const prev = JSON.parse(
              Buffer.from(keystore.encryptedPreviousKeypairs, 'base64').toString('utf8')
            );
            previousCount = Array.isArray(prev) ? prev.length : 0;
          } catch (error) {
            // Ignore parse errors
          }
        }

        return {
          lastSyncedAt: keystore.lastSyncedAt,
          totalSyncOperations: keystore.syncHistory.length,
          deviceId: keystore.deviceId,
          deviceName: keystore.deviceName,
          currentKeypairRotatedAt: getLastRotationTimestamp(keystore),
          previousKeypairsCount: previousCount,
          needsSync: false, // TODO: Implement sync need detection
        };
      } catch (error) {
        console.error('[Sync API] Failed to get sync status:', error);
        throw error;
      }
    },

    /**
     * Get information about this device
     * 
     * Returns device-specific metadata including:
     * - Device ID (persistent across sessions)
     * - Device name (hostname + platform)
     * - Creation timestamp
     * - Platform info
     * - Biometric profile
     * - Vault settings (device-local)
     * 
     * @returns Device information
     */
    getDeviceInfo: async (): Promise<DeviceInfo> => {
      try {
        const { loadKeystoreV4 } = await import('@onestar/db-sdk');

        const keystore = await loadKeystoreV4();

        if (!keystore) {
          // Return basic info if no keystore
          const os = await import('os');
          return {
            deviceId: 'unknown',
            deviceName: os.hostname(),
            deviceCreatedAt: 0,
            platform: process.platform,
            biometricProfile: undefined,
            vaultSettings: {
              autoLockEnabled: false,
              autoLockTimeoutMs: 0,
              requireBiometricOnLaunch: false,
              requirePasswordOnLaunch: true,
              allowBackgroundDecrypt: false,
            },
          };
        }

        return {
          deviceId: keystore.deviceId,
          deviceName: keystore.deviceName,
          deviceCreatedAt: keystore.deviceCreatedAt,
          platform: process.platform,
          biometricProfile: keystore.biometricProfile,
          vaultSettings: keystore.vaultSettings,
        };
      } catch (error) {
        console.error('[Sync API] Failed to get device info:', error);
        throw error;
      }
    },

    /**
     * List all devices that have synced with this keystore
     * 
     * Extracts unique devices from:
     * - Rotation history (deviceId attribution)
     * - Sync history (source/target devices)
     * 
     * Includes:
     * - Current device (marked with isCurrent: true)
     * - Remote devices from rotation/sync history
     * - Last activity timestamp for each device
     * 
     * @returns Array of synced devices
     */
    listSyncedDevices: async (): Promise<DeviceRecord[]> => {
      try {
        const { loadKeystoreV4 } = await import('@onestar/db-sdk');

        const keystore = await loadKeystoreV4();

        if (!keystore) {
          return [];
        }

        // Build device map
        const devices = new Map<string, DeviceRecord>();

        // Add current device
        devices.set(keystore.deviceId, {
          deviceId: keystore.deviceId,
          deviceName: keystore.deviceName,
          firstSeenAt: keystore.deviceCreatedAt,
          lastSeenAt: Date.now(),
          isCurrent: true,
          rotationCount: 0,
          syncCount: 0,
        });

        // Add devices from rotation history
        for (const rotation of keystore.rotationHistory) {
          if (rotation.deviceId) {
            if (!devices.has(rotation.deviceId)) {
              devices.set(rotation.deviceId, {
                deviceId: rotation.deviceId,
                deviceName: rotation.deviceName || `Device ${rotation.deviceId.slice(0, 8)}`,
                firstSeenAt: rotation.timestamp,
                lastSeenAt: rotation.timestamp,
                isCurrent: false,
                rotationCount: 1,
                syncCount: 0,
              });
            } else {
              const device = devices.get(rotation.deviceId)!;
              device.lastSeenAt = Math.max(device.lastSeenAt, rotation.timestamp);
              device.rotationCount = (device.rotationCount || 0) + 1;
            }
          }
        }

        // Add devices from sync history
        for (const sync of keystore.syncHistory) {
          // Source device
          if (sync.sourceDeviceId && !devices.has(sync.sourceDeviceId)) {
            devices.set(sync.sourceDeviceId, {
              deviceId: sync.sourceDeviceId,
              deviceName: sync.sourceDeviceName || `Device ${sync.sourceDeviceId.slice(0, 8)}`,
              firstSeenAt: sync.timestamp,
              lastSeenAt: sync.timestamp,
              isCurrent: false,
              rotationCount: 0,
              syncCount: 1,
            });
          } else if (sync.sourceDeviceId) {
            const device = devices.get(sync.sourceDeviceId)!;
            device.lastSeenAt = Math.max(device.lastSeenAt, sync.timestamp);
            device.syncCount = (device.syncCount || 0) + 1;
          }

          // Target device (usually current device, but track anyway)
          if (sync.targetDeviceId && devices.has(sync.targetDeviceId)) {
            const device = devices.get(sync.targetDeviceId)!;
            device.syncCount = (device.syncCount || 0) + 1;
          }
        }

        // Convert to array and sort by last activity
        return Array.from(devices.values()).sort(
          (a, b) => b.lastSeenAt - a.lastSeenAt
        );
      } catch (error) {
        console.error('[Sync API] Failed to list synced devices:', error);
        throw error;
      }
    },
  },

  /**
   * PHASE 23: SYNC SCHEDULER API
   * 
   * Control the background sync scheduler.
   * 
   * Features:
   * - start(): Start the scheduler
   * - stop(): Stop the scheduler
   * - getNextRun(): Get timestamp of next scheduled check
   * 
   * The scheduler automatically checks sync status every 6 hours
   * and emits 'sync:status-change' events when sync is needed.
   */
  syncScheduler: {
    /**
     * Start the background sync scheduler
     * 
     * Behavior:
     * - First run: 60 seconds after start
     * - Subsequent runs: Every 6 hours
     * - Auto-triggers on vault unlock, rotation, export, import
     * 
     * Safe to call multiple times (no-op if already running)
     */
    async start(): Promise<void> {
      try {
        await ipcRenderer.invoke('sync:scheduler:start');
      } catch (error) {
        console.error('[Sync Scheduler API] Failed to start:', error);
        throw error;
      }
    },

    /**
     * Stop the background sync scheduler
     * 
     * Cleans up all timers and resets state.
     * Safe to call multiple times.
     */
    async stop(): Promise<void> {
      try {
        await ipcRenderer.invoke('sync:scheduler:stop');
      } catch (error) {
        console.error('[Sync Scheduler API] Failed to stop:', error);
        throw error;
      }
    },

    /**
     * Get the epoch timestamp of the next scheduled run
     * 
     * @returns Timestamp in milliseconds, or null if not scheduled
     */
    async getNextRun(): Promise<number | null> {
      try {
        return await ipcRenderer.invoke('sync:scheduler:getNextRun');
      } catch (error) {
        console.error('[Sync Scheduler API] Failed to get next run:', error);
        return null;
      }
    },
  },

  /**
   * PHASE 23: EVENT SYSTEM
   * 
   * Listen for sync scheduler events.
   * 
   * Events:
   * - 'sync-status-change': Emitted when needsSync=true
   */
  events: {
    /**
     * Register an event listener
     * 
     * @param event - Event name
     * @param callback - Callback function
     */
    on(event: string, callback: (...args: any[]) => void): void {
      ipcRenderer.on(event, (_event, ...args) => {
        callback(...args);
      });
    },

    /**
     * Remove an event listener
     * 
     * @param event - Event name
     * @param callback - Callback function
     */
    off(event: string, callback: (...args: any[]) => void): void {
      ipcRenderer.removeListener(event, callback);
    },

    /**
     * Register a one-time event listener
     * 
     * @param event - Event name
     * @param callback - Callback function
     */
    once(event: string, callback: (...args: any[]) => void): void {
      ipcRenderer.once(event, (_event, ...args) => {
        callback(...args);
      });
    },
  },

  /**
   * Internal IPC invoke (used by E2E tests)
   * 
   * @param channel - IPC channel
   * @param data - Data to send
   * @returns Promise with result
   * @private
   */
  _ipcInvoke: async (channel: string, data: any) => {
    return await ipcRenderer.invoke(channel, data);
  },
};

/**
 * TEST MODE SUPPORT (E2E Testing)
 * 
 * Expose test-only APIs for E2E automation.
 * Only available when TEST_MODE=true.
 */
if (process.env.TEST_MODE === 'true') {
  console.log('[Preload] TEST_MODE enabled - exposing test APIs');

  (api as any).__test = {
    /**
     * Emit fake IPC event from main to renderer
     * 
     * @param channel - Event channel
     * @param data - Event data
     */
    async emitIpcEvent(channel: string, data: any): Promise<void> {
      await ipcRenderer.invoke('test:emit-sync-status', data);
    },

    /**
     * Set mock vault locked state
     * 
     * @param locked - True to lock, false to unlock
     */
    async setVaultLocked(locked: boolean): Promise<void> {
      await ipcRenderer.invoke('test:set-vault-locked', locked);
    },

    /**
     * Trigger key rotation completion event
     */
    async triggerRotation(): Promise<void> {
      await ipcRenderer.invoke('test:trigger-rotation');
    },

    /**
     * Get vault locked state
     */
    async getVaultLocked(): Promise<boolean> {
      const result = await ipcRenderer.invoke('test:get-vault-locked');
      return result;
    },
  };
}

/**
 * PHASE 20: SHUTDOWN HANDLER
 * 
 * Listen for app shutdown and abort active rotations gracefully
 */
ipcRenderer.on('app-will-quit', () => {
  console.log('[Preload] App shutting down, checking for active rotation...');
  if (activeRotationController) {
    console.warn('[Preload] Aborting rotation due to app shutdown');
    activeRotationController.abort();
  }
});

contextBridge.exposeInMainWorld("onestar", api);

