"use strict";
// src/lib/mediaDatabase.ts
// Phase 19: MediaDatabase Implementation for Key Rotation
// Implements MediaDatabase interface from mediaKeyReWrapping.ts
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
exports.OneStarMediaDatabase = void 0;
exports.createMediaDatabase = createMediaDatabase;
const MediaLicenses = __importStar(require("./db/mediaLicenses.table"));
/**
 * OneStarStream MediaDatabase implementation
 *
 * Integrates with existing database layer (mediaLicenses.table.ts)
 * to provide media key re-wrapping functionality during rotation.
 *
 * SECURITY:
 * - Never stores unwrapped keys
 * - Atomic database updates
 * - Validates user ownership before re-wrapping
 */
class OneStarMediaDatabase {
    constructor(userId) {
        this.userId = userId;
    }
    /**
     * Fetch all media items for the user.
     *
     * Returns media metadata with:
     * - id: licenseId
     * - wrappedKey: Current wrapped key (Uint8Array or string for PQ-hybrid)
     *
     * @returns Array of media items with wrapped keys
     */
    async fetchUserMedia(userId) {
        if (userId !== this.userId) {
            throw new Error(`MediaDatabase initialized for user ${this.userId}, cannot fetch for user ${userId}`);
        }
        console.log(`[OneStarMediaDatabase] Fetching media for user ${userId}`);
        const metadata = await MediaLicenses.listAllEncryptedMediaMetadata(userId);
        // Convert to MediaDatabase format
        const mediaItems = metadata.map((item) => {
            // Parse wrapped key (handle both formats)
            let wrappedKey;
            if (typeof item.wrappedKey === 'string') {
                // PQ-hybrid JSON format
                try {
                    wrappedKey = JSON.parse(item.wrappedKey);
                }
                catch (err) {
                    throw new Error(`Failed to parse wrapped key for media ${item.licenseId}: ${err}`);
                }
            }
            else {
                // Legacy format (Uint8Array) - not supported by rotation engine
                throw new Error(`Media ${item.licenseId} uses legacy wrapped key format. ` +
                    `Please re-upload with PQ-hybrid format before rotation.`);
            }
            return {
                id: item.licenseId,
                wrappedKey,
            };
        });
        console.log(`[OneStarMediaDatabase] Fetched ${mediaItems.length} media items`);
        return mediaItems;
    }
    /**
     * Update media item with new wrapped key after rotation.
     *
     * @param mediaId - License ID
     * @param newWrappedKey - New wrapped key (HybridCiphertext)
     */
    async updateMediaKey(mediaId, newWrappedKey) {
        console.log(`[OneStarMediaDatabase] Updating wrapped key for media ${mediaId}`);
        // Serialize HybridCiphertext to JSON string
        const newWrappedKeyString = JSON.stringify(newWrappedKey);
        // Get new public key keyId from ciphertext (for tracking)
        // Note: HybridCiphertext doesn't directly contain keyId, so we'll use a placeholder
        // In production, you'd track this separately or add keyId to metadata
        const newPublicKeyId = 'rotated-' + Date.now();
        // Update database
        await MediaLicenses.updateWrappedKey(mediaId, this.userId, newWrappedKeyString, newPublicKeyId);
        console.log(`[OneStarMediaDatabase] Updated media ${mediaId} with new wrapped key`);
    }
}
exports.OneStarMediaDatabase = OneStarMediaDatabase;
/**
 * Create a MediaDatabase instance for a user.
 *
 * @param userId - User ID
 * @returns MediaDatabase implementation
 */
function createMediaDatabase(userId) {
    return new OneStarMediaDatabase(userId);
}
