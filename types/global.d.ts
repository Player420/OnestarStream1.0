export {};

// Phase 18: Local Media Index types
interface LocalMediaItem {
  id: string;
  title: string;
  mimeType: string;
  duration?: number;
  fileSize?: number;
  createdAt: string;
  hasDownloadPermission: boolean;
  licenseId: string;
  ownerUserId: string;
  mediaHash?: string;
}

interface MediaIndexStats {
  mediaCount: number;
  totalSize: number;
  lastUpdated: string;
  oldestMedia?: string;
  newestMedia?: string;
}

interface StreamingConfig {
  chunkSize: number;
  headerSize: number;
  authTagSize: number;
}

// Phase 19: Key Rotation types
interface RotationResult {
  success: boolean;
  newKeyId: string;
  oldKeyId: string;
  mediaReWrapped: number;
  duration: number;
  error?: string;
}

interface RotationStatus {
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
}

interface RotationHistoryEntry {
  timestamp: string;
  oldKeyId: string;
  newKeyId: string;
  reason: string;
  mediaReWrapped: number;
  duration: number;
  triggeredBy: 'automatic' | 'manual' | 'security-event';
}

// Phase 21: Cross-Device Keystore Sync types
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
  platform: string;
  biometricType?: 'TouchID' | 'FaceID' | 'WindowsHello' | 'Fingerprint' | 'None';
  enrolledAt?: number;
  lastUsedAt?: number;
}

interface VaultSettings {
  autoLockEnabled: boolean;
  autoLockTimeoutMinutes: number;
  requireBiometricForUnlock: boolean;
  requirePasswordForRotation: boolean;
  requirePasswordForExport: boolean;
}

interface DeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  deviceCreatedAt: number;
  lastSyncedAt: number;
  currentKeypairRotatedAt?: number;
  previousKeypairsCount: number;
  biometricProfile?: BiometricProfile;
  vaultSettings?: VaultSettings;
}

interface DeviceRecord {
  deviceId: string;
  deviceName: string;
  platform: string;
  firstSeen: number;
  lastActivity: number;
  rotationCount: number;
  syncCount: number;
}


declare global {
  interface Window {
    onestar?: {
      // Audio API
      loadMedia?: (absPath: string) => Promise<{ ok: boolean; error?: string }>;
      playHD?: () => Promise<{ ok: boolean }>;
      pauseHD?: () => Promise<{ ok: boolean }>;
      seekHD?: (seconds: number) => Promise<{ ok: boolean }>;
      getAudioTime?: () => Promise<{ currentTime: number; duration: number }>;
      
      // Chunked save API
      startChunkedSave?: (opts: {
        originalName: string;
        title?: string;
        type?: string;
        downloadable?: boolean;
      }) => Promise<{ ok: boolean; data?: { sessionId: string }; error?: string }>;
      appendChunk?: (opts: { sessionId: string; chunk: Uint8Array }) => Promise<{ ok: boolean; error?: string }>;
      finishChunkedSave?: (opts: { sessionId: string }) => Promise<{ ok: boolean; error?: string }>;
      
      // Media management
      listMedia?: () => Promise<{ ok: boolean; data?: any[]; error?: string }>;
      deleteMedia?: (id: string) => Promise<{ ok: boolean; error?: string }>;
      
      // File operations
      getFilePath?: (id: string) => Promise<{ ok: boolean; data?: { absPath: string }; error?: string }>;
      getShareFile?: (id: string) => Promise<{ ok: boolean; data?: { filePath: string; fileName: string; mimeType: string }; error?: string }>;
      getFileBytes?: (filePath: string) => Promise<{ ok: boolean; data?: Uint8Array; error?: string }>;
      saveReceivedShare?: (payload: unknown) => Promise<{ ok: boolean }>;
      
      // Phase 17: Monolithic Encrypted Media Playback (backward compatibility)
      /**
       * Decrypt and play encrypted media from database (monolithic).
       * SECURITY: All decryption happens in preload (keys never reach renderer).
       * 
       * @param mediaId - Media blob ID from database
       * @returns Object with Blob URL and cleanup function
       */
      unwrapAndDecryptMedia?: (mediaId: string) => Promise<{
        blobUrl: string;
        mimeType: string;
        title?: string;
        cleanup: () => void;
      }>;

      // Phase 18: Local Media Index APIs
      /**
       * Get all media items from encrypted local index.
       * INSTANT: < 50ms response time (no server query).
       */
      getLocalMediaIndex?: () => Promise<LocalMediaItem[]>;
      
      /**
       * Sync local index with server (fetch all user's media).
       * @returns Number of media items fetched
       */
      refreshLocalMediaIndex?: () => Promise<number>;
      
      /**
       * Get single media item from local index.
       * @param mediaId - Media blob ID
       */
      getMediaFromIndex?: (mediaId: string) => Promise<LocalMediaItem | null>;
      
      /**
       * Add or update media item in local index.
       */
      addMediaToIndex?: (item: LocalMediaItem) => Promise<void>;
      
      /**
       * Remove media item from local index.
       * @returns true if removed, false if not found
       */
      removeMediaFromIndex?: (mediaId: string) => Promise<boolean>;
      
      /**
       * Clear entire local index (delete all items).
       */
      clearLocalMediaIndex?: () => Promise<void>;
      
      /**
       * Get statistics about local index.
       */
      getMediaIndexStats?: () => Promise<MediaIndexStats>;

      // Phase 18: Streaming Decryption APIs
      /**
       * Open encrypted media as streaming generator.
       * PROGRESSIVE: Start playback in < 200ms (first chunk only).
       * MEMORY EFFICIENT: 99.6% memory reduction vs monolithic.
       * 
       * @param mediaId - Media blob ID
       * @param startByte - Optional start byte (for seeking)
       * @param endByte - Optional end byte (for seeking)
       * @returns Async generator yielding decrypted chunks
       */
      openEncryptedStream?: (
        mediaId: string,
        startByte?: number,
        endByte?: number
      ) => Promise<AsyncGenerator<Uint8Array, void, unknown>>;
      
      /**
       * Get streaming configuration constants.
       */
      getStreamingConfig?: () => StreamingConfig;

      // Phase 19: Key Rotation APIs
      /**
       * Rotate user's persistent keypair (manual trigger).
       * 
       * WORKFLOW:
       * 1. Generate new PQ-hybrid keypair
       * 2. Re-wrap all user's media keys (optional)
       * 3. Move current → previous[]
       * 4. Set new as current
       * 5. Update rotation history
       * 6. Atomically save keystore v3
       * 
       * @param password - Vault password (for re-verification)
       * @param reason - Reason for rotation
       * @param options - Rotation options
       * @returns Rotation result
       */
      rotateKeypair?: (
        password: string,
        reason?: string,
        options?: {
          force?: boolean;
          reWrapMedia?: boolean;
        }
      ) => Promise<RotationResult>;
      
      /**
       * Get rotation status for UI display.
       */
      getRotationStatus?: () => Promise<RotationStatus | null>;
      
      /**
       * Check if keypair rotation is due.
       */
      needsRotation?: () => Promise<boolean>;
      
      /**
       * Get rotation history for audit trail.
       */
      getRotationHistory?: () => Promise<RotationHistoryEntry[]>;
      
      /**
       * Register rotation event listener.
       * 
       * Events:
       * - rotation-due: Rotation is overdue
       * - rotation-warning: Rotation due soon
       * - rotation-complete: Rotation finished
       * - rotation-progress: Re-wrapping progress
       */
      onRotationEvent?: (
        event: 'rotation-due' | 'rotation-warning' | 'rotation-complete' | 'rotation-progress',
        callback: (data: any) => void
      ) => void;
      
      /**
       * Unregister rotation event listener.
       */
      offRotationEvent?: (
        event: 'rotation-due' | 'rotation-warning' | 'rotation-complete' | 'rotation-progress',
        callback: (data: any) => void
      ) => void;
      
      // Phase 21: Cross-Device Keystore Sync APIs
      sync?: {
        /**
         * Export encrypted keystore for cross-device sync.
         * 
         * WORKFLOW:
         * 1. Validate password confirmation match
         * 2. Load keystore v4
         * 3. Build export payload (syncable fields only)
         * 4. Compute HMAC-SHA256 signature
         * 5. Encrypt with AES-256-GCM + PBKDF2-SHA512 (100k iterations)
         * 6. Write to file: onestar-keystore-export-v1-[device]-[timestamp].json.enc
         * 7. Record export in sync history
         * 
         * SECURITY:
         * - Device-local secrets NEVER synced (salt, biometrics)
         * - Password must be min 12 chars
         * - PBKDF2 iterations: 100,000 (~1 second per password guess)
         * - HMAC signature prevents tampering
         * 
         * @param password - Export password (min 12 chars)
         * @param confirmPassword - Password confirmation (must match)
         * @param outputPath - Optional custom export path
         * @returns Export result
         */
        exportKeystore: (
          password: string,
          confirmPassword: string,
          outputPath?: string
        ) => Promise<ExportResult>;
        
        /**
         * Import encrypted keystore from another device.
         * 
         * WORKFLOW:
         * 1. Read encrypted file
         * 2. Validate format
         * 3. Decrypt with AES-256-GCM (authenticated)
         * 4. Verify HMAC-SHA256 signature
         * 5. Verify SHA-256 checksum
         * 6. Validate rotation chain integrity
         * 7. Load current keystore
         * 8. Validate identity match (same userId)
         * 9. Detect attacks (downgrade, replay)
         * 10. Merge keystores (conflict resolution)
         * 11. Save merged result
         * 
         * CONFLICT RESOLUTION:
         * - Current keypair: Newest by timestamp wins
         * - Previous keypairs: Dedupe by public key, keep 10 newest
         * - Rotation history: Merge chronologically
         * - Device-local state: Always preserved
         * 
         * ATTACK PREVENTION:
         * - Downgrade detection: Validates rotation chain completeness
         * - Replay detection: Tracks signature deduplication
         * - Tampering detection: HMAC signature verification
         * 
         * @param filePath - Path to encrypted export file
         * @param password - Export password
         * @returns Import result with merge statistics
         */
        importKeystore: (
          filePath: string,
          password: string
        ) => Promise<ImportResult>;
        
        /**
         * Get current sync status for UI display.
         * 
         * @returns Sync status metadata
         */
        getSyncStatus: () => Promise<SyncStatus>;
        
        /**
         * Get device info including biometrics and vault settings.
         * 
         * @returns Device metadata
         */
        getDeviceInfo: () => Promise<DeviceInfo>;
        
        /**
         * List all synced devices with activity tracking.
         * 
         * LOGIC:
         * - Scans rotation history for device IDs
         * - Scans sync history for device IDs
         * - Builds device map with counts
         * - Sorts by last activity (newest first)
         * 
         * @returns Array of device records
         */
        listSyncedDevices: () => Promise<DeviceRecord[]>;
      };

      // Phase 23: Sync Scheduler APIs
      syncScheduler?: {
        /**
         * Start the background sync scheduler.
         * 
         * BEHAVIOR:
         * - First run: 60 seconds after start
         * - Subsequent runs: Every 6 hours
         * - Auto-triggers on vault unlock, rotation, export, import
         * 
         * Safe to call multiple times (no-op if already running)
         */
        start: () => Promise<void>;
        
        /**
         * Stop the background sync scheduler.
         * 
         * Cleans up all timers and resets state.
         * Safe to call multiple times.
         */
        stop: () => Promise<void>;
        
        /**
         * Get the epoch timestamp of the next scheduled run.
         * 
         * @returns Timestamp in milliseconds, or null if not scheduled
         */
        getNextRun: () => Promise<number | null>;
      };

      // Phase 23: Event System
      events?: {
        /**
         * Register an event listener.
         * 
         * @param event - Event name
         * @param callback - Callback function
         */
        on: (event: string, callback: (...args: any[]) => void) => void;
        
        /**
         * Remove an event listener.
         * 
         * @param event - Event name
         * @param callback - Callback function
         */
        off: (event: string, callback: (...args: any[]) => void) => void;
        
        /**
         * Register a one-time event listener.
         * 
         * @param event - Event name
         * @param callback - Callback function
         */
        once: (event: string, callback: (...args: any[]) => void) => void;
      };

      /**
       * Internal IPC invoke (used by E2E tests)
       * 
       * @param channel - IPC channel
       * @param data - Data to send
       * @returns Promise with result
       * @private
       */
      _ipcInvoke?: (channel: string, data: any) => Promise<any>;

      /**
       * TEST MODE ONLY: Test-only APIs for E2E automation
       * 
       * Only available when TEST_MODE=true.
       */
      __test?: {
        /**
         * Emit fake IPC event from main to renderer
         * 
         * @param channel - Event channel
         * @param data - Event data
         */
        emitIpcEvent: (channel: string, data: any) => Promise<void>;

        /**
         * Set mock vault locked state
         * 
         * @param locked - True to lock, false to unlock
         */
        setVaultLocked: (locked: boolean) => Promise<void>;

        /**
         * Trigger key rotation completion event
         */
        triggerRotation: () => Promise<void>;

        /**
         * Get vault locked state
         */
        getVaultLocked: () => Promise<boolean>;
      };
    };
  }
}
