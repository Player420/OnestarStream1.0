// src/app/api/encrypted-media/upload/route.ts
// SECURITY: Server receives ciphertext + wrapped keys only (NEVER plaintext keys)

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { MediaBlobs, MediaLicenses, initializeDB } from '@/lib/db';
import { randomUUID } from 'crypto';

/**
 * CLIENT-SIDE UPLOAD WORKFLOW (zero plaintext key leakage):
 * 
 * UPDATED FOR PERSISTENT KEYPAIRS (Phase 16 Step 6):
 * 
 * 1. User unlocks vault with password → loads persistent keypair (client-side preload)
 * 2. User selects media file → reads plaintext (client-side)
 * 3. Compute mediaHash = SHA-256(plaintext) (client-side)
 * 4. Generate random mediaKey (client-side)
 * 5. Encrypt media: ciphertext = AES-256-GCM(plaintext, mediaKey) (client-side)
 * 6. Get user's public key: publicKey = window.onestar.getUserPublicKey() (client-side)
 * 7. Wrap key: wrappedKey = PQ-Hybrid-KEM(mediaKey, publicKey) (client-side)
 *    - wrappedKey is now HybridCiphertext JSON (Kyber + X25519)
 * 8. Compute licenseId = SHA-256(mediaHash + uploaderDID) (client-side)
 * 9. POST to this endpoint: { ciphertext, wrappedKey, metadata }
 * 
 * BENEFITS OF PERSISTENT KEYPAIRS:
 * - Media wrapped with user's long-lived public key
 * - Playback works across app restarts (keypair survives)
 * - Inbox/share workflows use same persistent keypair
 * - Server never sees private keys (encrypted at rest, preload-only in memory)
 * 
 * BACKWARD COMPATIBILITY:
 * - Old format: Base64-encoded AES-wrapped key (password-based)
 * - New format: JSON-encoded HybridCiphertext (PQ-hybrid KEM)
 * - This endpoint accepts both (auto-detects JSON vs Base64)
 * 
 * SERVER NEVER SEES: plaintext media, plaintext mediaKey, password, private keys
 */

export interface UploadRequest {
  // Encrypted media content (AES-256-GCM ciphertext)
  ciphertext: string; // Base64-encoded
  
  // Media encryption IV
  iv: string; // Base64-encoded
  
  // Media metadata
  mediaHash: string; // SHA-256 hex (for deduplication)
  licenseId: string; // Deterministic: sha256(mediaHash + uploaderDID)
  mimeType?: string; // Optional: audio/mpeg, video/mp4
  title?: string; // Optional: display name
  mediaType: 'audio' | 'video' | 'image';
  
  // Wrapped media key (encrypted with user's vault key)
  wrappedKey: string; // Base64-encoded encrypted mediaKey
  wrapIV: string; // Base64-encoded wrapping IV
  wrapMethod: 'password-pbkdf2'; // Currently only password-based
  wrapMetadata?: string; // JSON: { salt?, iterations? } - if needed
}

export async function POST(req: NextRequest) {
  try {
    // Initialize OneStarDB
    initializeDB();
    
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body: UploadRequest = await req.json();

    // Validate required fields
    if (!body.ciphertext || !body.iv || !body.mediaHash || !body.licenseId) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    if (!body.wrappedKey || !body.wrapIV) {
      return NextResponse.json(
        { ok: false, error: 'Missing wrapped key' },
        { status: 400 }
      );
    }

    // Generate unique blob ID
    const mediaBlobId = randomUUID();

    // Decode ciphertext from Base64
    const ciphertext = Buffer.from(body.ciphertext, 'base64');

    // Store encrypted blob in mediaBlobs table
    await MediaBlobs.insert({
      mediaBlobId,
      ciphertext,
      iv: body.iv, // GCM initialization vector
      mimeType: body.mimeType || 'application/octet-stream',
      byteLength: ciphertext.length,
      gcmTag: body.iv, // Store IV as gcmTag for backward compat
      createdAt: Date.now(),
    });

    // Store license in mediaLicenses table with wrapped key
    // Wrapped key can be either:
    // - Legacy: Base64-encoded Uint8Array
    // - PQ-Hybrid: JSON string with HybridCiphertext structure
    const wrappedKeyData = body.wrappedKey.startsWith('{')
      ? body.wrappedKey // PQ-hybrid JSON format
      : Buffer.from(body.wrappedKey, 'base64'); // Legacy Base64 format
    
    await MediaLicenses.insert({
      licenseId: body.licenseId,
      ownerUserId: user.id,
      mediaBlobId,
      wrappedKeys: {
        [user.id]: wrappedKeyData,
      },
      metadata: {
        mediaHash: body.mediaHash,
        mimeType: body.mimeType || 'application/octet-stream',
        title: body.title,
      },
      createdAt: Date.now(),
    });

    console.log('[POST /api/encrypted-media/upload] Stored encrypted media:', {
      mediaBlobId,
      licenseId: body.licenseId,
      ownerUserId: user.id,
      size: ciphertext.length,
      securityNote: 'Server never saw plaintext key or media',
    });

    return NextResponse.json(
      {
        ok: true,
        mediaBlobId,
        licenseId: body.licenseId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[POST /api/encrypted-media/upload] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to upload encrypted media' },
      { status: 500 }
    );
  }
}
