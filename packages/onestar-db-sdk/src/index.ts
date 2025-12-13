/**
 * @onestar/db-sdk
 * 
 * Node-only database and crypto SDK for Electron main/preload processes.
 * This package consolidates all Node.js-dependent modules for:
 * - Post-quantum cryptography (hybrid Kyber + Ed25519)
 * - Keystore management (v4 format with rotation)
 * - Vault lifecycle and biometric unlock
 * - Local media indexing and encrypted streaming
 * - Keypair rotation and keystore export/import/merge
 * 
 * DO NOT import this package from Next.js client components.
 * Use only in:
 * - Electron main process
 * - Electron preload scripts
 * - Next.js server components and API routes
 */

// Re-export all modules from their original locations
// These will be moved into this package incrementally

// Post-quantum cryptography
export * from './postQuantumCrypto';
export type {
  HybridKeypair,
  HybridPublicKey,
  HybridCiphertext,
} from './postQuantumCrypto';

// Hybrid keypair store
export * from './hybridKeypairStore';
export type { DecryptedKeypair } from './hybridKeypairStore';

// Vault lifecycle
export * from './vaultLifecycle';
export { VaultLifecycleManager, isVaultUnlocked } from './vaultLifecycle';

// Biometric unlock
export * from './biometricUnlock';

// Local media index
export * from './localMediaIndex';
export type { MediaItem } from './localMediaIndex';

// Encrypted stream decoder
export * from './encryptedStreamDecoder';
export { STREAMING_CONFIG } from './encryptedStreamDecoder';

// Keypair rotation
export {
  rotateKeypair,
  getRotationStatus,
  getRotationHistory,
  needsRotation,
  loadKeystoreV3,
  unwrapMediaKeyWithFallback,
  isRotationInProgress,
  acquireRotationLock,
  releaseRotationLock,
  createRotationAbortController,
  type RotationAbortController,
} from './keypairRotation';

// Keystore v4
export * from './keystoreV4';

// Keystore export/import
export {
  exportKeystore,
  importKeystore,
} from './keystoreExport';

// Keystore merge
export * from './keystoreMerge';

// Keystore sync status
export * from './keystoreSyncStatus';

// Preload rotation helpers
export * from './preloadRotationHelpers';

// Media database
export * from './mediaDatabase';

// Media key re-wrapping
export * from './mediaKeyReWrapping';

// Encryption utilities
export * from './encryption';

// Time utilities
export * from './timeUtils';
