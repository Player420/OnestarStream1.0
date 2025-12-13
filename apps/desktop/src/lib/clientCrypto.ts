// src/lib/clientCrypto.ts
// Browser-compatible cryptography using Web Crypto API (SubtleCrypto)
// Zero plaintext key leakage to server - all operations run client-side

/**
 * SECURITY ARCHITECTURE:
 * 
 * This module provides pure client-side cryptographic operations using
 * the Web Crypto API. It mirrors the security properties of the hardened
 * server-side modules but runs entirely in the browser.
 * 
 * KEY SECURITY PROPERTIES:
 * - All key derivation happens in browser (PBKDF2)
 * - All wrapping/unwrapping happens in browser (AES-GCM)
 * - Server NEVER sees plaintext keys
 * - Server stores only: ciphertext + wrapped keys
 * 
 * COMPATIBILITY:
 * - Works in modern browsers (Chrome 37+, Firefox 34+, Safari 11+)
 * - Works in Electron renderer process
 * - Compatible with onestardb2 hardened modules (same algorithms)
 */

// Security constants (must match server-side secure_primitives.ts)
export const CRYPTO_CONSTANTS = {
  AES_KEY_LENGTH: 32, // AES-256
  AES_GCM_IV_LENGTH: 12, // 96 bits
  AES_GCM_TAG_LENGTH: 16, // 128 bits
  SALT_LENGTH: 16, // 128 bits
  MIN_PBKDF2_ITERATIONS: 600_000, // Updated from 300k → 600k
  RECOMMENDED_PBKDF2_ITERATIONS: 600_000,
} as const;

/**
 * Encrypted vault structure (matches appVaultCrypto_hardened.ts)
 */
export interface EncryptedVault {
  salt: Uint8Array;
  iv: Uint8Array;
  ciphertext: Uint8Array;
  iterations: number;
  tag?: Uint8Array; // GCM tag (embedded in ciphertext by SubtleCrypto)
}

/**
 * Wrapped media key structure
 */
export interface WrappedMediaKey {
  wrappedKey: Uint8Array; // Encrypted media key
  iv: Uint8Array; // Wrapping IV
  salt: Uint8Array; // PBKDF2 salt (if password-wrapped)
  iterations: number; // PBKDF2 iterations
}

/**
 * Get SubtleCrypto instance (browser or Node.js)
 */
function getSubtleCrypto(): SubtleCrypto {
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    return window.crypto.subtle;
  }
  
  // Node.js 15+ (for testing)
  if (typeof globalThis !== 'undefined' && (globalThis as any).crypto?.subtle) {
    return (globalThis as any).crypto.subtle;
  }
  
  throw new Error('SubtleCrypto not available in this environment');
}

/**
 * Ensure Uint8Array is not SharedArrayBuffer (TypeScript type safety helper)
 */
function ensureArrayBuffer(data: Uint8Array): Uint8Array<ArrayBuffer> {
  if (data.buffer instanceof SharedArrayBuffer) {
    // Create new copy with ArrayBuffer (not SharedArrayBuffer)
    const newBuffer = new ArrayBuffer(data.byteLength);
    const newArray = new Uint8Array(newBuffer);
    newArray.set(data);
    return newArray;
  }
  return data as Uint8Array<ArrayBuffer>;
}

/**
 * Generate cryptographically secure random bytes
 */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else if (typeof globalThis !== 'undefined' && (globalThis as any).crypto) {
    (globalThis as any).crypto.getRandomValues(bytes);
  } else {
    throw new Error('Crypto.getRandomValues not available');
  }
  
  return bytes;
}

/**
 * Derive AES-256 key from password using PBKDF2-SHA256.
 * 
 * SECURITY PROPERTIES:
 * - Salted derivation (prevents rainbow tables)
 * - 600,000 iterations (military-grade)
 * - SHA-256 hash function
 * - 256-bit output key
 * 
 * @param password - User's password
 * @param salt - Unique random salt (16 bytes)
 * @param iterations - PBKDF2 iterations (default: 600,000)
 * @returns CryptoKey for AES-GCM operations
 */
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array,
  iterations: number = CRYPTO_CONSTANTS.MIN_PBKDF2_ITERATIONS
): Promise<CryptoKey> {
  if (iterations < CRYPTO_CONSTANTS.MIN_PBKDF2_ITERATIONS) {
    throw new Error(
      `Insufficient PBKDF2 iterations: minimum ${CRYPTO_CONSTANTS.MIN_PBKDF2_ITERATIONS}, got ${iterations}`
    );
  }

  if (salt.byteLength !== CRYPTO_CONSTANTS.SALT_LENGTH) {
    throw new Error(
      `Invalid salt length: expected ${CRYPTO_CONSTANTS.SALT_LENGTH} bytes, got ${salt.byteLength}`
    );
  }

  const subtle = getSubtleCrypto();
  
  // Import password as raw key material
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const passwordKey = await subtle.importKey(
    'raw',
    passwordBytes.buffer.byteLength === passwordBytes.byteLength
      ? passwordBytes
      : new Uint8Array(passwordBytes),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  
  // Derive AES-256-GCM key
  const derivedKey = await subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new Uint8Array(salt),
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: CRYPTO_CONSTANTS.AES_KEY_LENGTH * 8, // 256 bits
    },
    false, // Not extractable (security)
    ['encrypt', 'decrypt']
  );
  
  return derivedKey;
}

/**
 * Unlock app vault with password (decrypt vault to get content).
 * 
 * This is the first step in the client-side workflow:
 * 1. User enters password
 * 2. Derive vaultKey from password
 * 3. Decrypt vault to get wrapped media keys
 * 
 * @param password - User's password
 * @param encryptedVault - Encrypted vault data
 * @returns Decrypted vault plaintext
 * @throws Error if password is wrong or vault is tampered
 */
export async function unlockVault(
  password: string,
  encryptedVault: EncryptedVault
): Promise<Uint8Array> {
  const vaultKey = await deriveKeyFromPassword(
    password,
    encryptedVault.salt,
    encryptedVault.iterations
  );
  
  const subtle = getSubtleCrypto();
  
  try {
    const plaintext = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ensureArrayBuffer(encryptedVault.iv),
        tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH * 8,
      },
      vaultKey,
      ensureArrayBuffer(encryptedVault.ciphertext)
    );
    
    return new Uint8Array(plaintext);
  } catch (err) {
    throw new Error('Failed to unlock vault: wrong password or tampered vault');
  }
}

/**
 * Create encrypted app vault (encrypt content with password).
 * 
 * @param password - User's password
 * @param plaintext - Data to encrypt
 * @param iterations - PBKDF2 iterations (default: 600,000)
 * @returns Encrypted vault
 */
export async function createVault(
  password: string,
  plaintext: Uint8Array,
  iterations: number = CRYPTO_CONSTANTS.MIN_PBKDF2_ITERATIONS
): Promise<EncryptedVault> {
  const salt = randomBytes(CRYPTO_CONSTANTS.SALT_LENGTH);
  const iv = randomBytes(CRYPTO_CONSTANTS.AES_GCM_IV_LENGTH);
  
  const vaultKey = await deriveKeyFromPassword(password, salt, iterations);
  const subtle = getSubtleCrypto();
  
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ensureArrayBuffer(iv),
      tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH * 8,
    },
    vaultKey,
    ensureArrayBuffer(plaintext)
  );
  
  return {
    salt,
    iv,
    ciphertext: new Uint8Array(ciphertext),
    iterations,
  };
}

/**
 * Generate a new random AES-256 media key.
 * 
 * This key will encrypt the actual media content.
 * It must be wrapped (encrypted) before being stored.
 * 
 * @returns Random 256-bit media key (non-extractable CryptoKey)
 */
export async function generateMediaKey(): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  
  return await subtle.generateKey(
    {
      name: 'AES-GCM',
      length: CRYPTO_CONSTANTS.AES_KEY_LENGTH * 8,
    },
    true, // Extractable (needed for wrapping)
    ['encrypt', 'decrypt']
  );
}

/**
 * Wrap media key with vault key (password-based wrapping).
 * 
 * CLIENT-SIDE WORKFLOW:
 * 1. User unlocks vault with password → derives vaultKey
 * 2. User uploads media → generates random mediaKey
 * 3. Encrypt media with mediaKey (streaming)
 * 4. Wrap mediaKey with vaultKey ← THIS FUNCTION
 * 5. Send ciphertext + wrapped key to server
 * 
 * SERVER NEVER SEES: password, vaultKey, or plaintext mediaKey
 * 
 * @param mediaKey - Raw media key to wrap
 * @param vaultKey - Derived vault key (from password)
 * @returns Wrapped key structure
 */
export async function wrapMediaKey(
  mediaKey: CryptoKey,
  vaultKey: CryptoKey
): Promise<WrappedMediaKey> {
  const iv = randomBytes(CRYPTO_CONSTANTS.AES_GCM_IV_LENGTH);
  const subtle = getSubtleCrypto();
  
  // Export media key as raw bytes
  const mediaKeyBytes = await subtle.exportKey('raw', mediaKey);
  
  // Wrap (encrypt) media key with vault key
  const wrappedKey = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ensureArrayBuffer(iv),
      tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH * 8,
    },
    vaultKey,
    mediaKeyBytes
  );
  
  return {
    wrappedKey: new Uint8Array(wrappedKey),
    iv,
    salt: new Uint8Array(0), // Not used for key wrapping (salt is in vault)
    iterations: 0, // Not used for key wrapping
  };
}

/**
 * Unwrap media key with vault key (password-based unwrapping).
 * 
 * CLIENT-SIDE PLAYBACK WORKFLOW:
 * 1. User unlocks vault with password → derives vaultKey
 * 2. Fetch wrapped media key from server
 * 3. Unwrap mediaKey with vaultKey ← THIS FUNCTION
 * 4. Fetch encrypted media ciphertext
 * 5. Decrypt media with mediaKey (streaming)
 * 6. Play decrypted media
 * 
 * @param wrappedKey - Wrapped key structure
 * @param vaultKey - Derived vault key (from password)
 * @returns Unwrapped media key (ready for decryption)
 */
export async function unwrapMediaKey(
  wrappedKey: WrappedMediaKey,
  vaultKey: CryptoKey
): Promise<CryptoKey> {
  const subtle = getSubtleCrypto();
  
  try {
    // Unwrap (decrypt) media key
    const mediaKeyBytes = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ensureArrayBuffer(wrappedKey.iv),
        tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH * 8,
      },
      vaultKey,
      ensureArrayBuffer(wrappedKey.wrappedKey)
    );
    
    // Import unwrapped bytes as CryptoKey
    const mediaKey = await subtle.importKey(
      'raw',
      mediaKeyBytes,
      {
        name: 'AES-GCM',
        length: CRYPTO_CONSTANTS.AES_KEY_LENGTH * 8,
      },
      false, // Not extractable (security)
      ['encrypt', 'decrypt']
    );
    
    return mediaKey;
  } catch (err) {
    throw new Error('Failed to unwrap media key: wrong vault key or tampered data');
  }
}

/**
 * Encrypt media buffer with media key (client-side encryption).
 * 
 * @param plaintext - Media content to encrypt
 * @param mediaKey - Media encryption key
 * @returns Encrypted ciphertext with embedded GCM tag
 */
export async function encryptMediaBuffer(
  plaintext: Uint8Array,
  mediaKey: CryptoKey
): Promise<{ ciphertext: Uint8Array; iv: Uint8Array }> {
  const iv = randomBytes(CRYPTO_CONSTANTS.AES_GCM_IV_LENGTH);
  const subtle = getSubtleCrypto();
  
  const ciphertext = await subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: ensureArrayBuffer(iv),
      tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH * 8,
    },
    mediaKey,
    ensureArrayBuffer(plaintext)
  );
  
  return {
    ciphertext: new Uint8Array(ciphertext),
    iv,
  };
}

/**
 * Decrypt media buffer with media key (client-side decryption).
 * 
 * @param ciphertext - Encrypted media content (with embedded GCM tag)
 * @param mediaKey - Media decryption key
 * @param iv - Initialization vector used during encryption
 * @returns Decrypted plaintext
 * @throws Error if authentication fails (tampered data)
 */
export async function decryptMediaBuffer(
  ciphertext: Uint8Array,
  mediaKey: CryptoKey,
  iv: Uint8Array
): Promise<Uint8Array> {
  const subtle = getSubtleCrypto();
  
  try {
    const plaintext = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ensureArrayBuffer(iv),
        tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH * 8,
      },
      mediaKey,
      ensureArrayBuffer(ciphertext)
    );
    
    return new Uint8Array(plaintext);
  } catch (err) {
    throw new Error('Failed to decrypt media: wrong key or tampered data');
  }
}

/**
 * Compute SHA-256 hash of data (for mediaHash computation).
 * 
 * @param data - Data to hash
 * @returns SHA-256 hash (hex string)
 */
export async function sha256(data: Uint8Array): Promise<string> {
  const subtle = getSubtleCrypto();
  const hashBuffer = await subtle.digest('SHA-256', ensureArrayBuffer(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Compute deterministic license ID.
 * 
 * licenseId = SHA-256(mediaHash || uploaderRootIdentity)
 * 
 * @param mediaHash - SHA-256 hash of media content (hex)
 * @param uploaderRootIdentity - Uploader's DID or root identity
 * @returns Deterministic licenseId (hex)
 */
export async function computeLicenseId(
  mediaHash: string,
  uploaderRootIdentity: string
): Promise<string> {
  const combined = new TextEncoder().encode(mediaHash + uploaderRootIdentity);
  return await sha256(combined);
}
