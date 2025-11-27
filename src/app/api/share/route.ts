import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { getMediaById } from '@/lib/mediaStore';
import {
  createShare,
  deleteSharesForMediaAndRecipient,
} from '@/lib/shareStore';
import { getUserByEmail, getUserByUsername } from '@/lib/userStore';

function normalizeRecipientIdentifier(raw: string): string {
  return raw.trim().replace(/^@/, '');
}

export async function POST(req: NextRequest) {
  try {
    const senderUser = await getUserFromRequest(req);
    if (!senderUser) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    const { mediaId, recipient, downloadable } = body as {
      mediaId?: string;
      recipient?: string;
      downloadable?: boolean;
    };

    if (!mediaId || !recipient) {
      return NextResponse.json(
        { ok: false, error: 'mediaId and recipient are required.' },
        { status: 400 }
      );
    }

    // Look up media being shared
    const media = await getMediaById(mediaId);
    if (!media) {
      return NextResponse.json(
        { ok: false, error: 'Media not found.' },
        { status: 404 }
      );
    }

    // Resolve recipient user (username or email)
    const normalized = normalizeRecipientIdentifier(recipient);
    const byUsername = await getUserByUsername(normalized);
    const byEmail = await getUserByEmail(normalized);
    const recipientUser = byUsername || byEmail;

    if (!recipientUser) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Recipient not found. They must be a registered username or email.',
        },
        { status: 400 }
      );
    }

    const recipientAddress = recipientUser.username || recipientUser.email;
    if (!recipientAddress) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Recipient account is missing username/email.',
        },
        { status: 500 }
      );
    }

    // Cleanup: nuke any pending zombies for same media+recipient
    await deleteSharesForMediaAndRecipient(media.id, recipientAddress);

    // Create fresh share record
    const share = await createShare({
      mediaId: media.id,
      recipient: recipientAddress,
      downloadable: downloadable ?? true,
      sender: senderUser.username || senderUser.email || null,
    });

    return NextResponse.json(
      {
        ok: true,
        shareId: share.shareId,
        packageId: share.packageId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[POST /api/share] Internal error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error while creating share.' },
      { status: 500 }
    );
  }
}
