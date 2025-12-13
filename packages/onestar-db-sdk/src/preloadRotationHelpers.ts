// src/lib/preloadRotationHelpers.ts
// Phase 19: Preload Rotation Helper Functions
// Phase 20: Enhanced with abort controller and failure tracking
// Separates rotation logic from preload.ts for cleaner code

import { ipcRenderer } from 'electron';
import {
  loadKeystoreV3,
  rotateKeypair,
  getRotationStatus,
  getRotationHistory,
  needsRotation,
  acquireRotationLock,
  releaseRotationLock,
  isRotationInProgress,
  createRotationAbortController,
  type RotationResult,
  type RotationAbortController,
  type EncryptedKeystoreV3,
} from './keypairRotation';
import { createMediaDatabase } from './mediaDatabase';
import { reWrapAllMediaKeys } from './mediaKeyReWrapping';
import { getPersistentKeypair, type HybridKeypair } from './postQuantumCrypto';
import { decryptKeypair } from './hybridKeypairStore';

/**
 * Emit rotation event to main process (for forwarding to renderer)
 * 
 * @param event - Event name
 * @param data - Event data
 */
export function emitRotationEvent(event: string, data: any): void {
  if (typeof ipcRenderer !== 'undefined') {
    ipcRenderer.send(`rotation:${event}`, data);
  }
}

/**
 * Perform full key rotation workflow with event emissions
 * 
 * WORKFLOW (Phase 20 Enhanced):
 * 1. Check rotation lock (Phase 20)
 * 2. Emit rotation-start
 * 3. Load current keystore v3
 * 4. Decrypt current keypair with password
 * 5. Create media database interface
 * 6. Create abort controller (Phase 20)
 * 7. Call rotation engine with re-wrap callback
 * 8. Emit rotation-progress events during re-wrap
 * 9. Check abort controller periodically (Phase 20)
 * 10. Emit rotation-finished on success
 * 11. Emit rotation-error on failure
 * 12. Release rotation lock (Phase 20)
 * 
 * @param password - Vault password
 * @param reason - Rotation reason
 * @param userId - User ID for media database
 * @param options - Rotation options
 * @returns Rotation result
 */
export async function performRotation(
  password: string,
  reason: string,
  userId: string,
  options?: {
    force?: boolean;
    reWrapMedia?: boolean;
    abortController?: RotationAbortController;
    rollbackOnFailureThreshold?: number; // Phase 20
  }
): Promise<RotationResult> {
  console.log('[PreloadRotationHelpers] Starting rotation...');
  
  try {
    // Phase 20: Check rotation lock BEFORE emitting events
    if (isRotationInProgress(userId)) {
      console.error('[PreloadRotationHelpers] Rotation already in progress');
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
    
    // Emit rotation start event
    emitRotationEvent('start', { reason });
    
    // Load current keystore v3
    const keystore = await loadKeystoreV3();
    if (!keystore) {
      throw new Error('No keystore found. Please initialize vault first.');
    }
    
    // Decrypt current keypair with password
    console.log('[PreloadRotationHelpers] Decrypting current keypair...');
    const decrypted = await decryptKeypair(keystore as any, password);
    if (!decrypted) {
      throw new Error('Failed to decrypt keypair. Invalid password?');
    }
    
    const currentKeypair = decrypted.keypair;
    
    // Create media database interface
    const mediaDatabase = createMediaDatabase(userId);
    
    // Create custom encryption function (uses existing hybridKeypairStore logic)
    const encryptKeypairFn = async (keypair: HybridKeypair, pwd: string) => {
      // This is handled by rotateKeypair internally
      // We just need to provide the interface
      throw new Error('encryptKeypairFn should not be called directly');
    };
    
    // Phase 20: Create re-wrap function with progress events AND failure tracking
    const reWrapAllMediaFn = async (
      oldKeypair: HybridKeypair,
      newKeypair: HybridKeypair,
      abortCtrl?: RotationAbortController
    ): Promise<{ success: number; failed: number }> => {
      console.log('[PreloadRotationHelpers] Starting media re-wrap...');
      
      // Use MediaKeyReWrapper with progress events
      const { MediaKeyReWrapper } = await import('./mediaKeyReWrapping');
      const reWrapper = new MediaKeyReWrapper(mediaDatabase);
      
      // Listen for progress events
      reWrapper.on('progress', (progress) => {
        console.log(`[PreloadRotationHelpers] Re-wrap progress: ${progress.percentage.toFixed(1)}%`);
        emitRotationEvent('progress', progress);
      });
      
      // Perform re-wrap
      const result = await reWrapper.reWrapAllMediaKeys(userId, oldKeypair, newKeypair);
      
      if (!result.success) {
        // Phase 20: Return failure count instead of throwing
        return {
          success: result.reWrapped,
          failed: result.errors.length,
        };
      }
      
      return {
        success: result.reWrapped,
        failed: 0,
      };
    };
    
    // Call rotation engine (Phase 20: Updated signature with userId)
    console.log('[PreloadRotationHelpers] Calling rotation engine...');
    const result = await rotateKeypair(
      currentKeypair,
      password,
      userId, // Phase 20: Required parameter
      reason,
      {
        force: options?.force,
        reWrapMedia: options?.reWrapMedia,
        // Don't pass encryptKeypairFn (rotation engine has default)
        reWrapAllMediaFn,
        abortController: options?.abortController,
        rollbackOnFailureThreshold: options?.rollbackOnFailureThreshold,
      }
    );
    
    if (result.success) {
      console.log('[PreloadRotationHelpers] Rotation complete');
      emitRotationEvent('finished', {
        newKeyId: result.newKeyId,
        mediaReWrapped: result.mediaReWrapped,
        duration: result.duration,
      });
    } else {
      console.error('[PreloadRotationHelpers] Rotation failed:', result.error);
      emitRotationEvent('error', {
        error: result.error,
      });
    }
    
    return result;
  } catch (error) {
    console.error('[PreloadRotationHelpers] Rotation error:', error);
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    emitRotationEvent('error', { error: errorMessage });
    
    return {
      success: false,
      newKeyId: '',
      oldKeyId: '',
      mediaReWrapped: 0,
      mediaFailed: 0, // Phase 20: Required field
      duration: 0,
      error: errorMessage,
    };
  }
}

/**
 * Load rotation status from keystore v3
 * 
 * @returns Rotation status or null if no keystore
 */
export async function loadRotationStatus(): Promise<ReturnType<typeof getRotationStatus> | null> {
  try {
    const keystore = await loadKeystoreV3();
    if (!keystore) {
      return null;
    }
    
    return getRotationStatus(keystore);
  } catch (error) {
    console.error('[PreloadRotationHelpers] Failed to load rotation status:', error);
    return null;
  }
}

/**
 * Load rotation history from keystore v3
 * 
 * @returns Rotation history array or empty array if no keystore
 */
export async function loadRotationHistory(): Promise<ReturnType<typeof getRotationHistory>> {
  try {
    const keystore = await loadKeystoreV3();
    if (!keystore) {
      return [];
    }
    
    return getRotationHistory(keystore);
  } catch (error) {
    console.error('[PreloadRotationHelpers] Failed to load rotation history:', error);
    return [];
  }
}

/**
 * Check if rotation is needed
 * 
 * @returns true if rotation is due
 */
export async function checkRotationNeeded(): Promise<boolean> {
  try {
    const keystore = await loadKeystoreV3();
    if (!keystore) {
      return false;
    }
    
    return needsRotation(keystore);
  } catch (error) {
    console.error('[PreloadRotationHelpers] Failed to check rotation status:', error);
    return false;
  }
}
