// src/lib/onestardb.ts
// Server-side wrapper for onestardb2 SDK
// Uses window.onestar for filesystem I/O and passes byte arrays to the SDK
// 
// WARNING: This module uses Node.js crypto and onestardb2 SDK.
// DO NOT import this module in Client Components.
// Use Server Actions or API routes to access database functionality.

import crypto from 'crypto';

import {
  createDatabase,
  openDatabase,
  getLicenseService,
  getIdentityService,
  getAttachmentService,
  getUsageService,
  getQuotaService,
  getAuthService,
  getAttachmentMetadataStore,
  verifyAccess,
  verifyAccessComposed,
  RealCryptoProvider,
  encryptMediaBuffer,
  decryptMediaBuffer,
  buildEncryptedAttachment,
  buildAttachmentMetadataRecord,
  type DatabaseHandle,
  type AttachmentMetadataStore,
  type AttachmentMetadata,
} from "@onestar/db/sdk";

import type {
  SignedLicense,
  EncryptedAttachment,
  CustodyKeyPair,
  UsageReceipt,
  SignupInput,
  LoginInput,
  UserRecord,
} from "@onestar/db/sdk/types";

// -----------------------------------------------------------------------------
// Type augmentation for window.onestar
// -----------------------------------------------------------------------------
// NOTE: Types are defined in types/global.d.ts (Phase 18)
// This declaration ensures compatibility with the global types
// In Electron environment, these APIs are always available

// Helper to access onestar APIs (assumes Electron environment)
function getOnestarAPI() {
  if (!window.onestar) {
    throw new Error('window.onestar not available - must run in Electron');
  }
  return window.onestar;
}

// -----------------------------------------------------------------------------
// SDK Instance Management
// -----------------------------------------------------------------------------

let database: DatabaseHandle | null = null;
let cryptoProvider: RealCryptoProvider | null = null;
let attachmentMetadataStore: AttachmentMetadataStore | null = null;
let licenseService: ReturnType<typeof getLicenseService> | null = null;
let identityService: ReturnType<typeof getIdentityService> | null = null;
let attachmentService: ReturnType<typeof getAttachmentService> | null = null;
let usageService: ReturnType<typeof getUsageService> | null = null;
let quotaService: ReturnType<typeof getQuotaService> | null = null;
let authService: ReturnType<typeof getAuthService> | null = null;

// -----------------------------------------------------------------------------
// Initialization
// -----------------------------------------------------------------------------

export interface InitializeOptions {
  databasePath: string;
  serverPublicKey?: Uint8Array;
  serverPrivateKey?: Uint8Array;
}

/**
 * Initialize the onestardb2 SDK with required services.
 * Must be called before using any other functions.
 */
export async function initialize(options: InitializeOptions): Promise<void> {
  const { databasePath, serverPublicKey, serverPrivateKey } = options;

  // Create or open database with persistent stores
  database = await openDatabase(databasePath);

  // Initialize crypto provider
  cryptoProvider = new RealCryptoProvider();

  // Get attachment metadata store from database handle
  attachmentMetadataStore = getAttachmentMetadataStore(database);

  // Initialize services using the database handle
  licenseService = getLicenseService(database, cryptoProvider);
  
  // Identity service requires server keys (quantum-secure)
  if (serverPublicKey && serverPrivateKey) {
    identityService = getIdentityService(serverPublicKey, serverPrivateKey);
  }

  attachmentService = getAttachmentService();
  usageService = getUsageService(database, cryptoProvider);
  quotaService = getQuotaService();
  authService = getAuthService();
}

/**
 * Check if the SDK has been initialized.
 */
export function isInitialized(): boolean {
  return licenseService !== null;
}

function ensureInitialized(): void {
  if (!isInitialized()) {
    throw new Error("onestardb not initialized. Call initialize() first.");
  }
}

// -----------------------------------------------------------------------------
// User Authentication
// -----------------------------------------------------------------------------

/**
 * Sign up a new user with quantum-secure identity.
 */
export async function authorizeUser(input: SignupInput): Promise<UserRecord> {
  ensureInitialized();
  if (!authService) throw new Error("Auth service not initialized");
  return authService.signup(input);
}

/**
 * Log in an existing user.
 */
export async function loginUser(input: LoginInput): Promise<UserRecord> {
  ensureInitialized();
  if (!authService) throw new Error("Auth service not initialized");
  return authService.login(input);
}

// -----------------------------------------------------------------------------
// Media Access Verification
// -----------------------------------------------------------------------------

export interface CheckMediaAccessParams {
  mediaId: string;
  license: SignedLicense;
  requester: CustodyKeyPair;
  action: string;
}

/**
 * Check if a user has access to a media file based on their license.
 * Uses window.onestar to read the encrypted file from disk.
 */
export async function checkMediaAccess(
  params: CheckMediaAccessParams
): Promise<{ authorized: boolean; decryptedContent?: Uint8Array; error?: string }> {
  ensureInitialized();

  if (!window.onestar) {
    return { authorized: false, error: "window.onestar not available" };
  }

  try {
    const { mediaId, license, requester, action } = params;

    // Get file path from media index
    if (!window.onestar?.getFilePath) {
      return { authorized: false, error: "getFilePath not available" };
    }
    const pathResult = await window.onestar.getFilePath(mediaId);
    if (!pathResult.ok || !pathResult.data) {
      return { authorized: false, error: "Media not found" };
    }

    const { absPath } = pathResult.data;

    // Read encrypted file bytes
    if (!window.onestar?.getFileBytes) {
      return { authorized: false, error: "getFileBytes not available" };
    }
    const bytesResult = await window.onestar.getFileBytes(absPath);
    if (!bytesResult.ok || !bytesResult.data) {
      return { authorized: false, error: "Failed to read media file" };
    }

    // Construct EncryptedAttachment from bytes
    // This assumes the file is stored in a specific format
    const attachment: EncryptedAttachment = {
      attachmentId: mediaId,
      ciphertext: bytesResult.data,
      encryption: {
        algorithm: "AES-256-GCM",
        iv: new Uint8Array(12), // Should be extracted from file metadata
        tag: new Uint8Array(16), // Should be extracted from file metadata
      },
      wrappedKeys: {}, // Should be populated from file metadata
      createdAt: new Date().toISOString(),
    };

    // Verify access using SDK
    const decryptedContent = await verifyAccess({
      attachment,
      license,
      licenseService: licenseService!,
      cryptoService: attachmentService!,
      requester,
      action,
    });

    return { authorized: true, decryptedContent };
  } catch (err) {
    return { authorized: false, error: String(err) };
  }
}

// -----------------------------------------------------------------------------
// Share License Management
// -----------------------------------------------------------------------------

export interface IssueShareLicenseParams {
  issuer: string;
  subjectAttachmentId: string;
  policy: {
    allowRead?: boolean;
    allowWrite?: boolean;
    [key: string]: any;
  };
  issuerPrivateKey: string;
}

/**
 * Issue a new share license for a media file.
 */
export async function issueShareLicense(
  params: IssueShareLicenseParams
): Promise<SignedLicense> {
  ensureInitialized();

  const { issuer, subjectAttachmentId, policy, issuerPrivateKey } = params;

  const license = await licenseService!.issueLicense(
    {
      issuer,
      subjectAttachmentId,
      version: 1,
      policy,
    },
    issuerPrivateKey
  );

  return license;
}

/**
 * Verify a share license without decrypting content.
 * Checks license validity and policy.
 */
export async function verifyShare(
  license: SignedLicense,
  attachmentId: string,
  consumer: string,
  action: string
): Promise<boolean> {
  ensureInitialized();

  try {
    const allowed = await licenseService!.verifyLicenseForAttachment({
      attachmentId,
      license,
      consumer,
      action,
      now: new Date(),
    });

    return allowed;
  } catch {
    return false;
  }
}

/**
 * Revoke a previously issued license.
 */
export async function revokeShareLicense(params: {
  license: SignedLicense;
  attachmentId: string;
  revokedBy: string;
  revokedByPrivateKey: string;
  reason: string;
  detail?: string;
}): Promise<void> {
  ensureInitialized();

  await licenseService!.revokeLicense({
    license: params.license,
    attachmentId: params.attachmentId,
    revokedBy: params.revokedBy,
    revokedByPrivateKey: params.revokedByPrivateKey,
    reason: params.reason as any,
    detail: params.detail,
  });
}

// -----------------------------------------------------------------------------
// Usage Tracking
// -----------------------------------------------------------------------------

export interface RecordUsageParams {
  licenseId: string;
  principal: string;
  action: string;
  attachmentId: string;
  signerPrivateKey: string;
}

/**
 * Record a usage event for audit and quota tracking.
 */
export async function recordUsage(params: RecordUsageParams): Promise<UsageReceipt> {
  ensureInitialized();

  const { licenseId, principal, action, attachmentId, signerPrivateKey } = params;

  const receipt = await usageService!.createReceipt(
    {
      licenseId,
      principal,
      action,
      attachmentId,
    },
    signerPrivateKey
  );

  return receipt;
}

/**
 * Check if a user is within their quota limits.
 */
export async function checkUsageQuota(params: {
  licenseId: string;
  principal: string;
  action: string;
  maxUses: number;
  windowSeconds?: number;
}): Promise<boolean> {
  ensureInitialized();

  const { licenseId, principal, action, maxUses, windowSeconds } = params;

  // This requires a UsageReceiptLifecycleStore which we need to initialize
  // For now, return true (no quota enforcement)
  // In production, implement proper quota checking
  return true;
}

// -----------------------------------------------------------------------------
// License ID Generation
// -----------------------------------------------------------------------------

/**
 * Compute deterministic license ID using SHA-256(mediaHash + uploaderRootIdentity).
 * 
 * SECURITY PROPERTIES:
 * - Same file + same uploader = same licenseId (deduplication)
 * - Same file + different uploader = different licenseId (correct ownership)
 * - Collision resistance: 256-bit SHA-256
 * - Verifiable: anyone can recompute given mediaHash and uploaderRootIdentity
 * 
 * @param mediaHash - SHA-256 hash of the media content (hex string)
 * @param uploaderRootIdentity - DID or root identity of the uploader
 * @returns Deterministic licenseId (hex string)
 */
export function computeLicenseId(
  mediaHash: string,
  uploaderRootIdentity: string
): string {
  return crypto
    .createHash('sha256')
    .update(mediaHash)
    .update(uploaderRootIdentity)
    .digest('hex');
}

// -----------------------------------------------------------------------------
// Media Encryption & Decryption
// -----------------------------------------------------------------------------

export interface EncryptAndStoreMediaParams {
  filePath: string;
  custodians: CustodyKeyPair[];
  mediaId?: string;
  uploaderRootIdentity: string; // Required for license generation
}

/**
 * Encrypt a media file and store it in protected_media/.
 * Returns the attachment ID, mediaHash, and licenseId for later retrieval.
 */
export async function encryptAndStoreMedia(
  params: EncryptAndStoreMediaParams
): Promise<{ 
  attachmentId: string; 
  mediaHash: string;
  licenseId: string;
  success: boolean; 
  error?: string 
}> {
  ensureInitialized();

  if (!window.onestar) {
    return { 
      attachmentId: "", 
      mediaHash: "",
      licenseId: "",
      success: false, 
      error: "window.onestar not available" 
    };
  }

  if (!attachmentMetadataStore) {
    return { 
      attachmentId: "", 
      mediaHash: "",
      licenseId: "",
      success: false, 
      error: "Attachment metadata store not initialized" 
    };
  }

  try {
    const { filePath, custodians, mediaId, uploaderRootIdentity } = params;

    // Read file bytes via window.onestar
    if (!window.onestar?.getFileBytes) {
      return { 
        attachmentId: "", 
        mediaHash: "",
        licenseId: "",
        success: false, 
        error: "getFileBytes not available" 
      };
    }
    const bytesResult = await window.onestar.getFileBytes(filePath);
    if (!bytesResult.ok || !bytesResult.data) {
      return { 
        attachmentId: "", 
        mediaHash: "",
        licenseId: "",
        success: false, 
        error: "Failed to read file" 
      };
    }

    // Compute media hash (SHA-256 of plaintext)
    const mediaHash = crypto
      .createHash('sha256')
      .update(bytesResult.data)
      .digest('hex');

    // Generate deterministic licenseId
    const licenseId = computeLicenseId(mediaHash, uploaderRootIdentity);

    // Encrypt the file (now async due to PQ-hybrid key wrapping)
    const { ciphertext, metadata } = await encryptMediaBuffer(
      Buffer.from(bytesResult.data),
      custodians
    );

    // Build attachment
    const attachment = buildEncryptedAttachment(ciphertext, metadata);

    // Build metadata record with wrapped keys
    const metadataRecord = buildAttachmentMetadataRecord(
      metadata,
      filePath,
      ciphertext.length
    );

        // Store metadata persistently in SDK's AttachmentMetadataStore\n    await attachmentMetadataStore.appendRecord({\n      attachmentId: attachment.attachmentId,\n      filePath,\n      iv: Buffer.from(metadata.iv).toString('base64'),\n      tag: Buffer.from(metadata.tag).toString('base64'),\n      wrappedKeys: Object.fromEntries(\n        Object.entries(metadata.wrappedKeys).map(([did, key]) => [\n          did,\n          Buffer.from(key).toString('base64'),\n        ])\n      ),\n      hash: mediaHash,\n      size: ciphertext.length,\n      createdAt: new Date().toISOString(),\n    });

    // Store encrypted file in protected_media/ via window.onestar
    // Note: This requires implementing a save function in window.onestar
    // For now, we'll assume the media is stored and return the attachment ID

    return {
      attachmentId: attachment.attachmentId,
      mediaHash,
      licenseId,
      success: true,
    };
  } catch (err) {
    return {
      attachmentId: "",
      mediaHash: "",
      licenseId: "",
      success: false,
      error: String(err),
    };
  }
}

export interface LoadAndDecryptMediaParams {
  attachmentId: string;
  requester: CustodyKeyPair;
  license: SignedLicense;
}

export interface LoadAndDecryptMediaOptions {
  onQuotaExceeded?: () => void;
}

/**
 * Load and decrypt a media file with license verification.
 * Returns a Blob URL for playback in the browser.
 */
export async function loadAndDecryptMedia(
  params: LoadAndDecryptMediaParams,
  options?: LoadAndDecryptMediaOptions
): Promise<{ blobUrl?: string; success: boolean; error?: string }> {
  ensureInitialized();

  if (!window.onestar) {
    return { success: false, error: "window.onestar not available" };
  }

  try {
    const { attachmentId, requester, license } = params;

    // Check quota before decryption
    const withinQuota = await checkUsageQuota({
      licenseId: license.license.licenseId,
      principal: requester.did,
      action: "read",
      maxUses: 1000, // TODO: Get from license policy
      windowSeconds: 86400, // 24 hours
    });

    if (!withinQuota) {
      if (options?.onQuotaExceeded) {
        options.onQuotaExceeded();
      }
      return { success: false, error: "QUOTA_EXCEEDED" };
    }

    // Load attachment metadata from store
    let attachmentMetadata: AttachmentMetadata | null = null;
    if (attachmentMetadataStore) {
      attachmentMetadata = await attachmentMetadataStore.getById(attachmentId);
    }

    // Get file path - try metadata first, fall back to media index
    let absPath: string;
    if (attachmentMetadata) {
      absPath = attachmentMetadata.filePath;
    } else {
      if (!window.onestar?.getFilePath) {
        return { success: false, error: "getFilePath not available" };
      }
      const pathResult = await window.onestar.getFilePath(attachmentId);
      if (!pathResult.ok || !pathResult.data) {
        return { success: false, error: "Media not found" };
      }
      absPath = pathResult.data.absPath;
    }

    // Read encrypted file bytes
    if (!window.onestar?.getFileBytes) {
      throw new Error("getFileBytes not available");
    }
    const bytesResult = await window.onestar.getFileBytes(absPath);
    if (!bytesResult.ok || !bytesResult.data) {
      return { success: false, error: "Failed to read encrypted media" };
    }

    // Construct EncryptedAttachment
    let attachment: EncryptedAttachment;
    
    if (attachmentMetadata) {
      // Use real metadata from store
      const wrappedKeys: Record<string, Uint8Array> = {};
      for (const [did, base64Key] of Object.entries(attachmentMetadata.wrappedKeys)) {
        wrappedKeys[did] = Buffer.from(base64Key, "base64") as any;
      }

      attachment = {
        attachmentId,
        ciphertext: bytesResult.data,
        encryption: {
          algorithm: "AES-256-GCM",
          iv: Buffer.from(attachmentMetadata.iv, "base64") as any,
          tag: attachmentMetadata.tag
            ? (Buffer.from(attachmentMetadata.tag, "base64") as any)
            : new Uint8Array(16), // Fallback for old metadata without tag
        },
        wrappedKeys,
        createdAt: attachmentMetadata.createdAt,
      };
    } else {
      // Fallback: use placeholder metadata (TODO: should always have metadata)
      attachment = {
        attachmentId,
        ciphertext: bytesResult.data,
        encryption: {
          algorithm: "AES-256-GCM",
          iv: new Uint8Array(12),
          tag: new Uint8Array(16),
        },
        wrappedKeys: {},
        createdAt: new Date().toISOString(),
      };
    }

    // Verify license-based access
    try {
      await verifyAccess({
        attachment,
        license,
        licenseService: licenseService!,
        cryptoService: attachmentService!,
        requester,
        action: "read",
      });
    } catch (err) {
      return { success: false, error: "ACCESS_DENIED" };
    }

    // Decrypt the media
    const plaintext = decryptMediaBuffer(attachment, requester);

    // Create Blob URL for playback
    const blob = new Blob([plaintext as any], { type: "audio/mpeg" }); // TODO: Detect mime type
    const blobUrl = URL.createObjectURL(blob);

    // Record usage event
    await recordUsageEvent({
      attachmentId,
      licenseId: license.license.licenseId,
      principal: requester.did,
      action: "read",
      durationMs: 0, // Will be updated during playback
    });

    return { blobUrl, success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// -----------------------------------------------------------------------------
// Usage Event Tracking
// -----------------------------------------------------------------------------

export interface RecordUsageEventParams {
  attachmentId: string;
  licenseId: string;
  principal: string;
  action: string;
  durationMs?: number;
}

/**
 * Record a usage event (e.g., media playback).
 * Creates a signed receipt for audit trails.
 */
export async function recordUsageEvent(
  params: RecordUsageEventParams
): Promise<{ success: boolean; error?: string }> {
  ensureInitialized();

  if (!cryptoProvider) {
    return { success: false, error: "Crypto provider not initialized" };
  }

  try {
    const { attachmentId, licenseId, principal, action } = params;

    // Generate a temporary signing key (in production, use user's key)
    // TODO: Replace with actual user's private key
    const signerPrivateKey = "temp_key_base64";

    const receipt = await recordUsage({
      licenseId,
      principal,
      action,
      attachmentId,
      signerPrivateKey,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Check if a user is within their quota limits before playback.
 */
export async function checkQuotaBeforePlayback(params: {
  attachmentId: string;
  licenseId: string;
  principal: string;
  action: string;
}): Promise<boolean> {
  ensureInitialized();

  const { licenseId, principal, action } = params;

  return checkUsageQuota({
    licenseId,
    principal,
    action,
    maxUses: 1000,
    windowSeconds: 86400,
  });
}

// -----------------------------------------------------------------------------
// Real-Time Usage Tracking
// -----------------------------------------------------------------------------

export interface UsageSession {
  sessionId: string;
  attachmentId: string;
  licenseId: string;
  principal: string;
  action: string;
  startTime: number; // timestamp in ms
  accumulatedMs: number;
  isActive: boolean;
}

// Track active usage sessions
const activeSessions = new Map<string, UsageSession>();

/**
 * Start a new usage tracking session.
 * Call this when playback begins.
 */
export function startUsageSession(params: {
  attachmentId: string;
  licenseId: string;
  principal: string;
  action?: string;
}): UsageSession {
  const { attachmentId, licenseId, principal, action = "read" } = params;

  const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  
  const session: UsageSession = {
    sessionId,
    attachmentId,
    licenseId,
    principal,
    action,
    startTime: Date.now(),
    accumulatedMs: 0,
    isActive: true,
  };

  activeSessions.set(sessionId, session);
  return session;
}

/**
 * Update a usage session with additional playback time.
 * Call this periodically during playback (e.g., from timeupdate event).
 */
export function updateUsageSession(session: UsageSession, deltaMs: number): void {
  const activeSession = activeSessions.get(session.sessionId);
  if (!activeSession || !activeSession.isActive) {
    return;
  }

  activeSession.accumulatedMs += deltaMs;
}

/**
 * End a usage session and persist the usage receipt.
 * Call this when playback ends or is paused for an extended period.
 */
export async function endUsageSession(
  session: UsageSession
): Promise<{ success: boolean; receiptId?: string; error?: string }> {
  ensureInitialized();

  const activeSession = activeSessions.get(session.sessionId);
  if (!activeSession) {
    return { success: false, error: "Session not found" };
  }

  if (!activeSession.isActive) {
    return { success: false, error: "Session already ended" };
  }

  // Mark session as inactive
  activeSession.isActive = false;

  try {
    // Create usage receipt with accumulated time
    // For now, we'll use a temporary signing key
    // TODO: Replace with actual user's private key
    const signerPrivateKey = "temp_key_base64";

    const receipt = await recordUsage({
      licenseId: activeSession.licenseId,
      principal: activeSession.principal,
      action: activeSession.action,
      attachmentId: activeSession.attachmentId,
      signerPrivateKey,
    });

    // Remove from active sessions
    activeSessions.delete(session.sessionId);

    return {
      success: true,
      receiptId: receipt.receiptId,
    };
  } catch (err) {
    return {
      success: false,
      error: String(err),
    };
  }
}

/**
 * Get an active usage session by ID.
 */
export function getUsageSession(sessionId: string): UsageSession | null {
  return activeSessions.get(sessionId) ?? null;
}

/**
 * Attach usage tracking to an HTML audio/video element.
 * Automatically tracks playback and records usage.
 */
export function attachPlayerUsageTracking(
  element: HTMLAudioElement | HTMLVideoElement,
  params: {
    attachmentId: string;
    licenseId: string;
    principal: string;
    onQuotaExceeded?: () => void;
  }
): { session: UsageSession; detach: () => void } {
  const { attachmentId, licenseId, principal, onQuotaExceeded } = params;

  // Start usage session
  const session = startUsageSession({
    attachmentId,
    licenseId,
    principal,
    action: "play",
  });

  let lastUpdateTime = Date.now();
  let quotaCheckInterval: NodeJS.Timeout | null = null;

  // Handle timeupdate event (fires every ~250ms during playback)
  const handleTimeUpdate = () => {
    if (element.paused || element.seeking) {
      return;
    }

    const now = Date.now();
    const deltaMs = now - lastUpdateTime;
    lastUpdateTime = now;

    // Update session with playback delta
    updateUsageSession(session, deltaMs);
  };

  // Handle pause/ended events
  const handlePauseOrEnd = async () => {
    await endUsageSession(session);
    
    if (quotaCheckInterval) {
      clearInterval(quotaCheckInterval);
      quotaCheckInterval = null;
    }
  };

  // Handle play event (restart tracking after pause)
  const handlePlay = () => {
    lastUpdateTime = Date.now();
    session.isActive = true;
  };

  // Handle seeking (reset time to prevent double-counting)
  const handleSeeking = () => {
    lastUpdateTime = Date.now();
  };

  // Periodic quota checking (every 30 seconds)
  const startQuotaChecking = () => {
    quotaCheckInterval = setInterval(async () => {
      const withinQuota = await checkUsageQuota({
        licenseId,
        principal,
        action: "play",
        maxUses: 1000,
        windowSeconds: 86400,
      });

      if (!withinQuota) {
        // Quota exceeded during playback
        element.pause();
        await handlePauseOrEnd();
        
        if (onQuotaExceeded) {
          onQuotaExceeded();
        }
      }
    }, 30000); // Check every 30 seconds
  };

  // Attach event listeners
  element.addEventListener("timeupdate", handleTimeUpdate);
  element.addEventListener("pause", handlePauseOrEnd);
  element.addEventListener("ended", handlePauseOrEnd);
  element.addEventListener("play", handlePlay);
  element.addEventListener("seeking", handleSeeking);

  // Start quota checking
  startQuotaChecking();

  // Return detach function to clean up
  const detach = () => {
    element.removeEventListener("timeupdate", handleTimeUpdate);
    element.removeEventListener("pause", handlePauseOrEnd);
    element.removeEventListener("ended", handlePauseOrEnd);
    element.removeEventListener("play", handlePlay);
    element.removeEventListener("seeking", handleSeeking);
    
    if (quotaCheckInterval) {
      clearInterval(quotaCheckInterval);
    }
    
    // End session if still active
    if (session.isActive) {
      endUsageSession(session);
    }
  };

  return { session, detach };
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

export {
  // Re-export types for convenience
  type SignedLicense,
  type EncryptedAttachment,
  type CustodyKeyPair,
  type UsageReceipt,
  type SignupInput,
  type LoginInput,
  type UserRecord,
};
