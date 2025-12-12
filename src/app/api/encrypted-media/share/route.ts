// src/app/api/encrypted-media/share/route.ts
// SECURITY: Server routes wrapped keys to recipient inbox (NEVER unwraps keys)

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { MediaLicenses, MediaInbox, initializeDB } from '@/lib/db';
import { randomBytes } from 'crypto';

/**
 * CLIENT-SIDE SHARING WORKFLOW (zero plaintext key leakage):
 * 
 * UPDATED FOR PERSISTENT KEYPAIRS (Phase 16 Step 6):
 * 
 * SENDER SIDE:
 * 1. Sender unlocks vault → loads persistent keypair (preload)
 * 2. Sender plays media → unwraps mediaKey with own private keypair
 * 3. Sender fetches recipient's public key (from server or direct exchange)
 * 4. Sender re-wraps mediaKey with recipient's public key (PQ-hybrid KEM)
 * 5. POST to this endpoint: { licenseId, recipientUserId, wrappedKey }
 * 
 * RECIPIENT SIDE:
 * 1. Recipient unlocks vault → loads persistent keypair
 * 2. Recipient fetches shared media from inbox
 * 3. Recipient unwraps mediaKey with own private keypair
 * 4. Recipient decrypts media with mediaKey
 * 
 * BENEFITS OF PERSISTENT KEYPAIRS:
 * - No ephemeral key exchange required (public keys long-lived)
 * - Recipient can decrypt shared media across sessions
 * - Forward secrecy via ephemeral X25519 keys in PQ-hybrid KEM
 * - Post-quantum secure (Kyber-768 + X25519 hybrid)
 * 
 * BACKWARD COMPATIBILITY:
 * - Old format: Password-based wrapping (deprecated)
 * - New format: PQ-hybrid KEM (HybridCiphertext JSON)
 * - This endpoint accepts both (auto-detects JSON vs Base64)
 * 
 * SERVER NEVER SEES: plaintext mediaKey, sender's private key, recipient's private key
 */

export interface ShareRequest {
  licenseId: string; // License to share
  recipientUserId: string; // Recipient's user ID
  
  // Wrapped key for recipient (encrypted with recipient's key)
  wrappedKey: string; // Base64-encoded
  
  // Optional share message
  message?: string;
}

export async function POST(req: NextRequest) {
  try {
    await initializeDB();
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body: ShareRequest = await req.json();

    // Validate required fields
    if (!body.licenseId || !body.recipientUserId || !body.wrappedKey) {
      return NextResponse.json(
        { ok: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Verify sender owns this license
    const license = await MediaLicenses.get(body.licenseId);
    if (!license) {
      return NextResponse.json(
        { ok: false, error: 'License not found' },
        { status: 404 }
      );
    }

    if (license.ownerUserId !== user.id) {
      return NextResponse.json(
        { ok: false, error: 'Access denied: you do not own this license' },
        { status: 403 }
      );
    }

    // Add wrapped key for recipient
    // Wrapped key can be either:
    // - Legacy: Base64 string → Uint8Array
    // - PQ-Hybrid: JSON string (keep as string)
    const wrappedKeyData = body.wrappedKey.startsWith('{')
      ? body.wrappedKey // PQ-hybrid JSON format
      : Buffer.from(body.wrappedKey, 'base64'); // Legacy Base64 format
    
    await MediaLicenses.addWrappedKey(
      body.licenseId,
      body.recipientUserId,
      wrappedKeyData
    );

    // Add share notification to recipient's inbox
    const inboxEntryId = randomBytes(16).toString('hex');
    await MediaInbox.insert({
      inboxEntryId,
      userId: body.recipientUserId,
      licenseId: body.licenseId,
      sharedBy: user.id,
      createdAt: Date.now(),
      status: 'unread',
    });

    console.log('[POST /api/encrypted-media/share] Shared media:', {
      licenseId: body.licenseId,
      senderUserId: user.id,
      recipientUserId: body.recipientUserId,
      inboxEntryId,
      securityNote: 'Server routed wrapped key only, never unwrapped it',
    });

    return NextResponse.json(
      {
        ok: true,
        inboxEntryId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[POST /api/encrypted-media/share] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to share media' },
      { status: 500 }
    );
  }
}
