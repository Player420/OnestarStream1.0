// src/app/api/encrypted-media/get/[mediaId]/route.ts
// SECURITY: Server returns ciphertext + wrapped key (NEVER unwraps key)
// Phase 18: Added range request support for streaming decryption

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { MediaBlobs, MediaLicenses, initializeDB } from '@/lib/db';

/**
 * CLIENT-SIDE DECRYPTION WORKFLOW (zero plaintext key leakage):
 * 
 * 1. User unlocks vault with password → derives vaultKey (client-side)
 * 2. GET from this endpoint: { ciphertext, wrappedKey, iv }
 * 3. Unwrap key: mediaKey = AES-GCM-decrypt(wrappedKey, vaultKey) (client-side)
 * 4. Decrypt media: plaintext = AES-256-GCM-decrypt(ciphertext, mediaKey, iv) (client-side)
 * 5. Play decrypted media (client-side)
 * 
 * SERVER NEVER SEES: plaintext media, plaintext mediaKey, password, vaultKey
 * 
 * Phase 18 STREAMING:
 * - Supports HTTP Range requests (start/end byte positions)
 * - Returns partial ciphertext for chunked decryption
 * - Maintains backward compatibility with full-file requests
 */

/**
 * Parse HTTP Range header
 * 
 * @param rangeHeader - Range header value (e.g., "bytes=0-1023")
 * @param totalSize - Total file size
 * @returns Range object or null if invalid
 */
function parseRangeHeader(
  rangeHeader: string,
  totalSize: number
): { start: number; end: number } | null {
  const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  if (!match) {
    return null;
  }

  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

  // Validate range
  if (start < 0 || start >= totalSize || end < start || end >= totalSize) {
    return null;
  }

  return { start, end };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    await initializeDB();
    const { mediaId } = await params;
    
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Get the media blob by mediaBlobId
    const mediaBlob = await MediaBlobs.get(mediaId);
    if (!mediaBlob) {
      return NextResponse.json(
        { ok: false, error: 'Media not found' },
        { status: 404 }
      );
    }

    // Get all licenses for this media blob
    const allLicenses = await MediaLicenses.getByOwner(user.id);
    const license = allLicenses.find((lic) => lic.mediaBlobId === mediaId);

    if (!license) {
      return NextResponse.json(
        { ok: false, error: 'License not found or access denied' },
        { status: 403 }
      );
    }

    // Get wrapped key for this user
    const wrappedKey = await MediaLicenses.getWrappedKey(license.licenseId, user.id);
    if (!wrappedKey) {
      return NextResponse.json(
        { ok: false, error: 'Access denied: no wrapped key found' },
        { status: 403 }
      );
    }

    // Phase 18: Check for Range header (streaming support)
    const rangeHeader = req.headers.get('range');
    const totalSize = mediaBlob.ciphertext.length;
    
    let ciphertextBytes: Buffer;
    let statusCode = 200;
    let responseHeaders: Record<string, string> = {};

    if (rangeHeader) {
      // Parse range request
      const range = parseRangeHeader(rangeHeader, totalSize);
      
      if (!range) {
        return NextResponse.json(
          { ok: false, error: 'Invalid range request' },
          { status: 416, headers: { 'Content-Range': `bytes */${totalSize}` } }
        );
      }

      // Extract requested byte range
      ciphertextBytes = Buffer.from(mediaBlob.ciphertext.subarray(range.start, range.end + 1));
      statusCode = 206; // Partial Content
      responseHeaders = {
        'Content-Range': `bytes ${range.start}-${range.end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': ciphertextBytes.length.toString(),
      };

      console.log('[GET /api/encrypted-media/get] Range request:', {
        mediaId,
        range: `${range.start}-${range.end}`,
        totalSize,
        partialSize: ciphertextBytes.length,
      });
    } else {
      // Full file request (backward compatibility)
      ciphertextBytes = Buffer.from(mediaBlob.ciphertext);
      responseHeaders = {
        'Accept-Ranges': 'bytes',
        'Content-Length': ciphertextBytes.length.toString(),
      };
    }

    console.log('[GET /api/encrypted-media/get] Returning encrypted media:', {
      mediaId,
      licenseId: license.licenseId,
      ownerUserId: license.ownerUserId,
      requesterUserId: user.id,
      size: ciphertextBytes.length,
      isPartial: statusCode === 206,
      securityNote: 'Server returning ciphertext + wrapped key only',
    });

    // Return ciphertext + wrapped key
    // Wrapped key can be either:
    // - Legacy: Uint8Array → Base64
    // - PQ-Hybrid: string (already JSON)
    const wrappedKeyResponse = typeof wrappedKey === 'string'
      ? wrappedKey // PQ-hybrid JSON format
      : Buffer.from(wrappedKey).toString('base64'); // Legacy Base64
    
    return NextResponse.json(
      {
        ok: true,
        mediaBlobId: mediaId,
        licenseId: license.licenseId,
        ciphertext: ciphertextBytes.toString('base64'),
        iv: mediaBlob.iv || mediaBlob.gcmTag, // Use iv field (fallback to gcmTag for backward compat)
        wrappedKey: wrappedKeyResponse,
        metadata: {
          title: license.metadata.title,
          mimeType: license.metadata.mimeType,
          mediaHash: license.metadata.mediaHash,
          ownerUserId: license.ownerUserId,
        },
        // Phase 18: Include range metadata
        rangeInfo: rangeHeader ? {
          isPartial: true,
          totalSize,
        } : undefined,
      },
      { status: statusCode, headers: responseHeaders }
    );
  } catch (err) {
    console.error('[GET /api/encrypted-media/get] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to get encrypted media' },
      { status: 500 }
    );
  }
}
