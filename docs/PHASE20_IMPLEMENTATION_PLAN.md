# Phase 20 Implementation Plan: Rotation Safety & Hardening

**Status**: In Progress  
**Date**: December 12, 2025  
**Phase**: 20 - Validation, Concurrency Locks & Safety Guarantees

---

## Executive Summary

Phase 19 delivered a complete key rotation engine with database integration. Phase 20 adds production-grade safety guarantees to prevent data corruption, race conditions, and security vulnerabilities during rotation operations.

**Core Objectives:**
1. Global rotation mutex (prevent concurrent rotations)
2. Full previous-keypair decryption & loading
3. Replace 'default-user' placeholder with actual user identity
4. Abort/resume rotation semantics
5. Shutdown guards (graceful cancellation)
6. Comprehensive test matrix
7. Final security audit

---

## File-by-File Patch Plan

### 1. **src/lib/keypairRotation.ts** (+200 lines)

**Purpose**: Add global rotation lock, abort semantics, rollback logic

**New Exports**:
```typescript
// Concurrency Control
export function acquireRotationLock(userId: string): boolean
export function releaseRotationLock(userId: string): void
export function isRotationInProgress(userId?: string): boolean
export function forceReleaseRotationLock(userId: string): void // Emergency cleanup

// Abort Semantics
export interface RotationAbortController {
  abort(): void;
  isAborted(): boolean;
  onAbort(callback: () => void): void;
}
export function createRotationAbortController(): RotationAbortController

// Enhanced Rotation Result
export interface RotationResult {
  success: boolean;
  newKeyId: string;
  oldKeyId: string;
  mediaReWrapped: number;
  mediaFailed: number; // NEW: Track failures
  duration: number;
  error?: string;
  aborted?: boolean; // NEW: Abort flag
  rollbackPerformed?: boolean; // NEW: Rollback flag
}
```

**Implementation Details**:

1. **Global Rotation Lock**:
```typescript
// Per-user rotation locks (Map<userId, LockState>)
const rotationLocks = new Map<string, {
  locked: boolean;
  lockAcquiredAt: Date;
  operation: string; // "rotation" | "migration" | "rewrap"
}>();

function acquireRotationLock(userId: string): boolean {
  if (rotationLocks.get(userId)?.locked) {
    return false; // Lock already held
  }
  rotationLocks.set(userId, {
    locked: true,
    lockAcquiredAt: new Date(),
    operation: 'rotation',
  });
  return true;
}
```

2. **Rotation with Abort Support**:
```typescript
// Modified rotateKeypair signature:
export async function rotateKeypair(
  password: string,
  reason: string,
  userId: string,
  reWrapCallback: (oldKey: HybridKeypair, newKey: HybridKeypair) => Promise<{
    success: number;
    failed: number;
  }>,
  options?: {
    abortController?: RotationAbortController;
    rollbackOnFailureThreshold?: number; // Default: 0.2 (20%)
  }
): Promise<RotationResult>
```

3. **Automatic Rollback Logic**:
```typescript
// If >20% of media re-wrapping fails:
if (failed > 0 && (failed / (success + failed)) > rollbackThreshold) {
  console.error('[Rotation] Failure threshold exceeded, rolling back...');
  
  // Rollback: restore old keystore
  await saveKeystore(oldKeystoreBackup);
  
  return {
    success: false,
    rollbackPerformed: true,
    mediaFailed: failed,
    error: `Rollback: ${failed} of ${success + failed} media failed`,
  };
}
```

4. **Shutdown Guard**:
```typescript
// Check abort controller periodically during re-wrap:
export async function rotateKeypair(...) {
  // ... generate new keypair
  
  // Re-wrap media with abort checks
  let success = 0;
  let failed = 0;
  
  for (const media of allMedia) {
    // Check abort BEFORE each media
    if (options?.abortController?.isAborted()) {
      console.warn('[Rotation] Aborted by user/shutdown');
      await saveKeystore(oldKeystoreBackup); // Rollback
      return { success: false, aborted: true };
    }
    
    try {
      await reWrapCallback(oldKeypair, newKeypair, media);
      success++;
    } catch (error) {
      failed++;
    }
  }
  
  // ... complete rotation
}
```

**Modified Functions**:
- `rotateKeypair()`: Add lock acquisition, abort controller, rollback logic
- `loadKeystoreV3()`: Check if rotation in progress before loading
- `saveKeystore()`: Atomic write with backup

**New Functions**:
- `acquireRotationLock(userId)`: Returns `true` if acquired, `false` if already locked
- `releaseRotationLock(userId)`: Release lock after rotation
- `isRotationInProgress(userId?)`: Check lock state (all users or specific user)
- `createRotationAbortController()`: Create abort controller for rotation
- `forceReleaseRotationLock(userId)`: Emergency cleanup (on crash/shutdown)

**Security Considerations**:
- Lock is in-memory only (process-level, not file-level)
- Lock auto-releases after 30 minutes (prevent deadlock)
- Rollback uses atomic file operations (backup → write → verify)
- Abort controller is checked every 10 media items (not every item for performance)

---

### 2. **src/lib/hybridKeypairStore.ts** (+150 lines)

**Purpose**: Load and decrypt previous keypairs for fallback unwrap

**New Exports**:
```typescript
export interface DecryptedKeypairWithHistory {
  keypair: DecryptedKeypair; // Current keypair
  previousKeypairs: DecryptedKeypair[]; // Historical keypairs
  rotationHistory: RotationHistoryEntry[];
}

export async function loadPreviousKeypairs(
  password: string
): Promise<DecryptedKeypair[]>

export async function loadKeypairWithHistory(
  password: string
): Promise<DecryptedKeypairWithHistory>
```

**Implementation Details**:

1. **Load All Keypairs**:
```typescript
export async function loadPreviousKeypairs(password: string): Promise<DecryptedKeypair[]> {
  const keystore = await loadKeystoreV3();
  if (!keystore) {
    return [];
  }
  
  const previousKeypairs: DecryptedKeypair[] = [];
  
  for (const retiredKeypair of keystore.previousKeypairs) {
    try {
      // Decrypt retired keypair
      const decrypted = await decryptKeypair({
        version: 'v3',
        algorithm: keystore.algorithm,
        salt: keystore.salt,
        iterations: keystore.iterations,
        encryptedKeypair: retiredKeypair.encryptedKeypair,
        iv: retiredKeypair.iv,
        publicKey: retiredKeypair.publicKey,
        createdAt: retiredKeypair.createdAt,
      } as any, password);
      
      previousKeypairs.push({
        keypair: decrypted.keypair,
        publicKey: decrypted.publicKey,
        createdAt: new Date(retiredKeypair.createdAt),
        keyId: retiredKeypair.keyId,
        retiredAt: new Date(retiredKeypair.retiredAt),
      });
      
      console.log(`[HybridKeypairStore] Decrypted previous keypair: ${retiredKeypair.keyId}`);
    } catch (error) {
      console.error(`[HybridKeypairStore] Failed to decrypt previous keypair ${retiredKeypair.keyId}:`, error);
      // Continue with other keypairs (partial success is acceptable)
    }
  }
  
  console.log(`[HybridKeypairStore] Loaded ${previousKeypairs.length} previous keypairs`);
  return previousKeypairs;
}
```

2. **Unified Loading Function**:
```typescript
export async function loadKeypairWithHistory(password: string): Promise<DecryptedKeypairWithHistory> {
  const keystore = await loadKeystoreV3();
  if (!keystore) {
    throw new Error('No keystore found');
  }
  
  // Decrypt current keypair
  const current = await decryptKeypair(keystore, password);
  
  // Decrypt previous keypairs
  const previous = await loadPreviousKeypairs(password);
  
  return {
    keypair: current,
    previousKeypairs: previous,
    rotationHistory: keystore.rotationHistory,
  };
}
```

**Security Considerations**:
- Previous keypairs are decrypted with same password as current
- Failed decryption is logged but non-fatal (partial history is acceptable)
- All private keys are zeroized after use
- Previous keypairs are never saved back to disk (read-only operation)

---

### 3. **electron/preload.ts** (+100 lines)

**Purpose**: Fix 'default-user' placeholder, add lock checks, expose abort API

**User ID Resolution Strategy**:

**Option 1: From Keystore Metadata** (RECOMMENDED)
```typescript
async function getCurrentUserId(): Promise<string> {
  const keystore = await loadKeystoreV3();
  if (keystore?.userId) {
    return keystore.userId;
  }
  
  // Fallback: Generate UUID for first-time users
  const userId = crypto.randomUUID();
  console.log(`[Preload] Generated new user ID: ${userId}`);
  
  // Save to keystore on next vault operation
  // (keystore.userId is set during keypair generation)
  
  return userId;
}
```

**Option 2: From Vault Lifecycle Manager** (Alternative)
```typescript
async function getCurrentUserId(): Promise<string> {
  // VaultLifecycleManager tracks user identity
  const session = vaultLifecycle.getActiveSession();
  return session?.userId || 'default-user';
}
```

**Option 3: From Local User Profile** (Future Enhancement)
```typescript
async function getCurrentUserId(): Promise<string> {
  // Read from local user profile (multi-user support)
  const profile = await loadLocalUserProfile();
  return profile.userId;
}
```

**Chosen Strategy**: Option 1 (keystore metadata) for single-user deployment, with fallback UUID generation.

**Updated Rotation API**:
```typescript
rotateKeypair: async (password, reason, options) => {
  try {
    // 1. Get user ID from keystore
    const userId = await getCurrentUserId();
    
    // 2. Check rotation lock
    if (isRotationInProgress(userId)) {
      throw new Error('Key rotation already in progress. Please wait.');
    }
    
    // 3. Create abort controller
    const abortController = createRotationAbortController();
    
    // 4. Store abort controller globally (for shutdown handler)
    activeRotationController = abortController;
    
    // 5. Perform rotation
    const result = await performRotation(password, reason, userId, {
      ...options,
      abortController,
    });
    
    return result;
  } catch (error) {
    console.error('[Preload API] Rotation failed:', error);
    throw error;
  } finally {
    activeRotationController = null;
  }
}
```

**New APIs**:
```typescript
// Check if rotation is locked
isRotationLocked: async (userId?: string): Promise<boolean> => {
  return isRotationInProgress(userId);
}

// Abort active rotation (for UI "Cancel" button)
abortRotation: async (): Promise<void> => {
  if (activeRotationController) {
    console.log('[Preload API] Aborting rotation...');
    activeRotationController.abort();
  }
}
```

**Shutdown Handler**:
```typescript
// Listen for app shutdown events
ipcRenderer.on('app-will-quit', () => {
  console.log('[Preload] App shutting down, aborting rotation...');
  if (activeRotationController) {
    activeRotationController.abort();
  }
});
```

---

### 4. **src/lib/encryptedStreamDecoder.ts** (+50 lines)

**Purpose**: Load previous keypairs for fallback unwrap

**Updated `streamEncryptedMedia()` Function**:
```typescript
export async function streamEncryptedMedia(
  licenseId: string,
  password: string,
  onProgress?: (progress: { decryptedBytes: number; totalBytes: number }) => void
): Promise<MediaStreamResult> {
  // ... existing setup
  
  // PHASE 20: Load previous keypairs for backward compatibility
  let previousKeypairs: HybridKeypair[] = [];
  
  try {
    const history = await loadPreviousKeypairs(password);
    previousKeypairs = history.map(dk => dk.keypair);
    console.log(`[StreamDecoder] Loaded ${previousKeypairs.length} previous keypairs for fallback`);
  } catch (error) {
    console.warn('[StreamDecoder] Failed to load previous keypairs:', error);
    // Continue with current keypair only (fallback disabled)
  }
  
  // Unwrap media key with fallback
  let mediaKey: Uint8Array;
  try {
    mediaKey = await unwrapMediaKeyWithFallback(
      wrappedKey,
      keypair.keypair,
      previousKeypairs // NEW: Pass previous keypairs
    );
  } catch (error) {
    throw new Error(`Failed to decrypt media key. Rotation may have occurred. ${error}`);
  }
  
  // ... existing streaming logic
}
```

**Security Considerations**:
- Previous keypairs are loaded once per stream (not cached globally)
- Failed loading is non-fatal (stream continues with current keypair only)
- All keypairs are zeroized after stream completes

---

### 5. **electron/main.ts** (+80 lines)

**Purpose**: Add shutdown guards, force-release locks on crash

**Shutdown Handler**:
```typescript
import { forceReleaseRotationLock, isRotationInProgress } from '../src/lib/keypairRotation';

// Before app quit
app.on('before-quit', async (event) => {
  console.log('[Main] App quitting, checking for active rotation...');
  
  if (isRotationInProgress()) {
    console.warn('[Main] Rotation in progress, waiting for abort...');
    
    // Notify preload to abort
    event.preventDefault();
    
    // Send abort signal to all windows
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('app-will-quit');
    });
    
    // Wait up to 10 seconds for graceful abort
    setTimeout(() => {
      console.error('[Main] Rotation abort timeout, forcing quit...');
      
      // Force-release all locks
      forceReleaseRotationLock('*'); // Release all users
      
      app.quit();
    }, 10000);
  }
});
```

**Crash Recovery**:
```typescript
app.on('will-quit', () => {
  console.log('[Main] Final cleanup, releasing all locks...');
  forceReleaseRotationLock('*');
});
```

---

### 6. **src/lib/rotationScheduler.ts** (+80 lines)

**Purpose**: Add lock checks before scheduled rotation

**Updated `performScheduledCheck()` Method**:
```typescript
private async performScheduledCheck(): Promise<void> {
  try {
    console.log('[RotationScheduler] Performing scheduled rotation check...');
    
    const keystore = await loadKeystoreV3();
    if (!keystore) {
      console.warn('[RotationScheduler] No keystore found, skipping check');
      return;
    }
    
    // PHASE 20: Check if rotation is already in progress
    const userId = keystore.userId || 'default-user';
    if (isRotationInProgress(userId)) {
      console.warn('[RotationScheduler] Rotation already in progress, skipping scheduled check');
      this.emit('check-skipped', { reason: 'rotation-in-progress' });
      return;
    }
    
    // Check if vault is unlocked
    if (!isPersistentKeypairUnlocked()) {
      console.warn('[RotationScheduler] Vault locked, skipping scheduled rotation');
      this.emit('check-skipped', { reason: 'vault-locked' });
      return;
    }
    
    // ... existing rotation check logic
  } catch (error) {
    console.error('[RotationScheduler] Check failed:', error);
    this.emit('error', error instanceof Error ? error : new Error(String(error)));
  }
}
```

**New Event**:
```typescript
'check-skipped': (status: { reason: string }) => void;
```

---

### 7. **src/lib/preloadRotationHelpers.ts** (+100 lines)

**Purpose**: Update performRotation() to use abort controller, track failures

**Updated `performRotation()` Function**:
```typescript
export async function performRotation(
  password: string,
  reason: string,
  userId: string,
  options?: {
    abortController?: RotationAbortController;
    rollbackOnFailureThreshold?: number;
  }
): Promise<RotationResult> {
  const startTime = Date.now();
  
  try {
    // 1. Acquire rotation lock
    if (!acquireRotationLock(userId)) {
      throw new Error('Another rotation is already in progress');
    }
    
    // Emit start event
    emitRotationEvent('rotation:start', { userId, reason });
    
    // 2. Create MediaDatabase instance
    const mediaDb = new OneStarMediaDatabase(userId);
    
    // 3. Call rotation engine with abort support
    const result = await rotateKeypair(
      password,
      reason,
      userId,
      async (oldKeypair, newKeypair) => {
        // Re-wrap callback with progress tracking
        const allMedia = await mediaDb.fetchUserMedia(userId);
        
        let success = 0;
        let failed = 0;
        
        for (let i = 0; i < allMedia.length; i++) {
          // Check abort every 10 items
          if (i % 10 === 0 && options?.abortController?.isAborted()) {
            console.warn('[PerformRotation] Aborted during re-wrap');
            throw new Error('Rotation aborted by user');
          }
          
          try {
            // Unwrap with old key
            const mediaKey = await unwrapMediaKeyHybrid(
              allMedia[i].wrappedKey,
              oldKeypair
            );
            
            // Re-wrap with new key
            const newWrappedKey = await wrapMediaKeyHybrid(
              mediaKey,
              newKeypair.publicKey
            );
            
            // Update database
            await mediaDb.updateMediaKey(allMedia[i].id, newWrappedKey);
            
            success++;
            
            // Emit progress
            emitRotationEvent('rotation:progress', {
              current: i + 1,
              total: allMedia.length,
              success,
              failed,
            });
          } catch (error) {
            console.error(`[PerformRotation] Failed to re-wrap media ${allMedia[i].id}:`, error);
            failed++;
          }
        }
        
        return { success, failed };
      },
      {
        abortController: options?.abortController,
        rollbackOnFailureThreshold: options?.rollbackOnFailureThreshold || 0.2,
      }
    );
    
    // Emit finished event
    emitRotationEvent('rotation:finished', {
      success: result.success,
      newKeyId: result.newKeyId,
      mediaReWrapped: result.mediaReWrapped,
      duration: Date.now() - startTime,
    });
    
    return result;
  } catch (error) {
    console.error('[PerformRotation] Rotation failed:', error);
    
    // Emit error event
    emitRotationEvent('rotation:error', {
      error: error instanceof Error ? error.message : String(error),
    });
    
    throw error;
  } finally {
    // Always release lock
    releaseRotationLock(userId);
  }
}
```

---

### 8. **types/global.d.ts** (+50 lines)

**Purpose**: Add abort API, lock check API to window.onestar

**New Type Definitions**:
```typescript
interface RotationAPI {
  /**
   * Check if key rotation is currently in progress.
   * 
   * @param userId - Optional user ID (defaults to current user)
   * @returns true if rotation locked
   */
  isRotationLocked(userId?: string): Promise<boolean>;
  
  /**
   * Abort the currently running rotation.
   * Safe to call even if no rotation is active.
   */
  abortRotation(): Promise<void>;
  
  /**
   * Rotate keypair with abort support.
   */
  rotateKeypair(
    password: string,
    reason: string,
    options?: {
      rollbackOnFailureThreshold?: number; // Default: 0.2 (20%)
    }
  ): Promise<RotationResult>;
}
```

---

## Implementation Timeline

### Phase 20.1: Concurrency Control (4 hours)
- ✅ Global rotation lock in keypairRotation.ts
- ✅ Lock checks in preload.ts
- ✅ Lock checks in rotationScheduler.ts
- ✅ Shutdown guards in main.ts

### Phase 20.2: Previous Keypairs Loading (3 hours)
- ✅ loadPreviousKeypairs() in hybridKeypairStore.ts
- ✅ Update streamEncryptedMedia() to load history
- ✅ Test fallback unwrap with 3 rotations

### Phase 20.3: User ID Resolution (2 hours)
- ✅ Implement getCurrentUserId() in preload.ts
- ✅ Update performRotation() calls
- ✅ Test with keystore metadata

### Phase 20.4: Abort & Rollback (4 hours)
- ✅ Abort controller in keypairRotation.ts
- ✅ Rollback logic (>20% failure threshold)
- ✅ Abort API in preload.ts
- ✅ Test abort during re-wrap

### Phase 20.5: Testing & Documentation (5 hours)
- ✅ Create comprehensive test matrix
- ✅ Perform security audit
- ✅ Document all changes
- ✅ Create Phase 21 readiness checklist

**Total Estimated Time**: 18 hours

---

## Security Verification Checklist

### Concurrency Safety
- [ ] Two rotations cannot run simultaneously (per-user lock)
- [ ] Lock auto-releases after 30 minutes (prevent deadlock)
- [ ] Rotation blocked during vault lock state
- [ ] Rotation blocked during app shutdown
- [ ] Force-release locks on crash recovery

### Data Integrity
- [ ] Automatic rollback on >20% re-wrap failures
- [ ] Atomic keystore writes (backup → write → verify)
- [ ] Partial re-wrap does not corrupt database
- [ ] Abort during re-wrap restores original keystore

### Key Material Safety
- [ ] Previous keypairs never exposed to renderer
- [ ] All private keys zeroized after use
- [ ] Fallback unwrap does not leak key order
- [ ] Timing attacks mitigated (constant-time unwrap attempts)

### Audit Trail
- [ ] All rotation attempts logged (success/failure/abort)
- [ ] Failure reasons captured in rotationHistory
- [ ] Lock acquisition/release logged
- [ ] Shutdown-triggered aborts logged

---

## Testing Strategy

See **PHASE20_TEST_MATRIX.md** (to be created) for full 30-step test plan.

**Critical Test Scenarios**:
1. Concurrent rotation attempts (should block)
2. Rotation during vault lock (should fail gracefully)
3. Rotation during app shutdown (should abort + rollback)
4. Rotation with 0 media (should succeed instantly)
5. Rotation with 1000 media (should show progress)
6. Rotation abort mid-way (should rollback)
7. Rotation with 50% wrapped with old keys (fallback unwrap)
8. Rotation with >20% re-wrap failures (automatic rollback)

---

## Next Steps (Phase 21)

After Phase 20 completion, implement:
1. **Rotation UI Components** (settings page, status badge, history table)
2. **Rotation Progress Modal** (real-time progress indicator)
3. **Rotation Notifications** (due warnings, completion alerts)
4. **Performance Optimization** (parallel re-wrapping, incremental rotation)

---

**Document Version**: 1.0  
**Last Updated**: December 12, 2025  
**Author**: Phase 20 Implementation Team
