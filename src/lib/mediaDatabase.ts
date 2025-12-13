// src/lib/mediaDatabase.ts
// Phase 19: MediaDatabase Implementation for Key Rotation
// Implements MediaDatabase interface from mediaKeyReWrapping.ts

import * as MediaLicenses from './db/mediaLicenses.table';
import type { EncryptedMediaMetadata } from './db/mediaLicenses.table';
import type { HybridCiphertext } from './postQuantumCrypto';
import type { MediaDatabase } from './mediaKeyReWrapping';

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
export class OneStarMediaDatabase implements MediaDatabase {
  private userId: string;
  
  constructor(userId: string) {
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
  async fetchUserMedia(userId: string): Promise<Array<{
    id: string;
    wrappedKey: HybridCiphertext;
  }>> {
    if (userId !== this.userId) {
      throw new Error(`MediaDatabase initialized for user ${this.userId}, cannot fetch for user ${userId}`);
    }
    
    console.log(`[OneStarMediaDatabase] Fetching media for user ${userId}`);
    
    const metadata = await MediaLicenses.listAllEncryptedMediaMetadata(userId);
    
    // Convert to MediaDatabase format
    const mediaItems = metadata.map((item: EncryptedMediaMetadata) => {
      // Parse wrapped key (handle both formats)
      let wrappedKey: HybridCiphertext;
      
      if (typeof item.wrappedKey === 'string') {
        // PQ-hybrid JSON format
        try {
          wrappedKey = JSON.parse(item.wrappedKey);
        } catch (err) {
          throw new Error(`Failed to parse wrapped key for media ${item.licenseId}: ${err}`);
        }
      } else {
        // Legacy format (Uint8Array) - not supported by rotation engine
        throw new Error(
          `Media ${item.licenseId} uses legacy wrapped key format. ` +
          `Please re-upload with PQ-hybrid format before rotation.`
        );
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
  async updateMediaKey(mediaId: string, newWrappedKey: HybridCiphertext): Promise<void> {
    console.log(`[OneStarMediaDatabase] Updating wrapped key for media ${mediaId}`);
    
    // Serialize HybridCiphertext to JSON string
    const newWrappedKeyString = JSON.stringify(newWrappedKey);
    
    // Get new public key keyId from ciphertext (for tracking)
    // Note: HybridCiphertext doesn't directly contain keyId, so we'll use a placeholder
    // In production, you'd track this separately or add keyId to metadata
    const newPublicKeyId = 'rotated-' + Date.now();
    
    // Update database
    await MediaLicenses.updateWrappedKey(
      mediaId,
      this.userId,
      newWrappedKeyString,
      newPublicKeyId
    );
    
    console.log(`[OneStarMediaDatabase] Updated media ${mediaId} with new wrapped key`);
  }
}

/**
 * Create a MediaDatabase instance for a user.
 * 
 * @param userId - User ID
 * @returns MediaDatabase implementation
 */
export function createMediaDatabase(userId: string): MediaDatabase {
  return new OneStarMediaDatabase(userId);
}
