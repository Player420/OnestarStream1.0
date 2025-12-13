"use strict";
// src/lib/preloadRotationHelpers.ts
// Phase 19: Preload Rotation Helper Functions
// Phase 20: Enhanced with abort controller and failure tracking
// Separates rotation logic from preload.ts for cleaner code
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitRotationEvent = emitRotationEvent;
exports.performRotation = performRotation;
exports.loadRotationStatus = loadRotationStatus;
exports.loadRotationHistory = loadRotationHistory;
exports.checkRotationNeeded = checkRotationNeeded;
const electron_1 = require("electron");
const keypairRotation_1 = require("./keypairRotation");
const mediaDatabase_1 = require("./mediaDatabase");
const hybridKeypairStore_1 = require("./hybridKeypairStore");
/**
 * Emit rotation event to main process (for forwarding to renderer)
 *
 * @param event - Event name
 * @param data - Event data
 */
function emitRotationEvent(event, data) {
    if (typeof electron_1.ipcRenderer !== 'undefined') {
        electron_1.ipcRenderer.send(`rotation:${event}`, data);
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
async function performRotation(password, reason, userId, options) {
    console.log('[PreloadRotationHelpers] Starting rotation...');
    try {
        // Phase 20: Check rotation lock BEFORE emitting events
        if ((0, keypairRotation_1.isRotationInProgress)(userId)) {
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
        const keystore = await (0, keypairRotation_1.loadKeystoreV3)();
        if (!keystore) {
            throw new Error('No keystore found. Please initialize vault first.');
        }
        // Decrypt current keypair with password
        console.log('[PreloadRotationHelpers] Decrypting current keypair...');
        const decrypted = await (0, hybridKeypairStore_1.decryptKeypair)(keystore, password);
        if (!decrypted) {
            throw new Error('Failed to decrypt keypair. Invalid password?');
        }
        const currentKeypair = decrypted.keypair;
        // Create media database interface
        const mediaDatabase = (0, mediaDatabase_1.createMediaDatabase)(userId);
        // Create custom encryption function (uses existing hybridKeypairStore logic)
        const encryptKeypairFn = async (keypair, pwd) => {
            // This is handled by rotateKeypair internally
            // We just need to provide the interface
            throw new Error('encryptKeypairFn should not be called directly');
        };
        // Phase 20: Create re-wrap function with progress events AND failure tracking
        const reWrapAllMediaFn = async (oldKeypair, newKeypair, abortCtrl) => {
            console.log('[PreloadRotationHelpers] Starting media re-wrap...');
            // Use MediaKeyReWrapper with progress events
            const { MediaKeyReWrapper } = await Promise.resolve().then(() => __importStar(require('./mediaKeyReWrapping')));
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
        const result = await (0, keypairRotation_1.rotateKeypair)(currentKeypair, password, userId, // Phase 20: Required parameter
        reason, {
            force: options?.force,
            reWrapMedia: options?.reWrapMedia,
            // Don't pass encryptKeypairFn (rotation engine has default)
            reWrapAllMediaFn,
            abortController: options?.abortController,
            rollbackOnFailureThreshold: options?.rollbackOnFailureThreshold,
        });
        if (result.success) {
            console.log('[PreloadRotationHelpers] Rotation complete');
            emitRotationEvent('finished', {
                newKeyId: result.newKeyId,
                mediaReWrapped: result.mediaReWrapped,
                duration: result.duration,
            });
        }
        else {
            console.error('[PreloadRotationHelpers] Rotation failed:', result.error);
            emitRotationEvent('error', {
                error: result.error,
            });
        }
        return result;
    }
    catch (error) {
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
async function loadRotationStatus() {
    try {
        const keystore = await (0, keypairRotation_1.loadKeystoreV3)();
        if (!keystore) {
            return null;
        }
        return (0, keypairRotation_1.getRotationStatus)(keystore);
    }
    catch (error) {
        console.error('[PreloadRotationHelpers] Failed to load rotation status:', error);
        return null;
    }
}
/**
 * Load rotation history from keystore v3
 *
 * @returns Rotation history array or empty array if no keystore
 */
async function loadRotationHistory() {
    try {
        const keystore = await (0, keypairRotation_1.loadKeystoreV3)();
        if (!keystore) {
            return [];
        }
        return (0, keypairRotation_1.getRotationHistory)(keystore);
    }
    catch (error) {
        console.error('[PreloadRotationHelpers] Failed to load rotation history:', error);
        return [];
    }
}
/**
 * Check if rotation is needed
 *
 * @returns true if rotation is due
 */
async function checkRotationNeeded() {
    try {
        const keystore = await (0, keypairRotation_1.loadKeystoreV3)();
        if (!keystore) {
            return false;
        }
        return (0, keypairRotation_1.needsRotation)(keystore);
    }
    catch (error) {
        console.error('[PreloadRotationHelpers] Failed to check rotation status:', error);
        return false;
    }
}
