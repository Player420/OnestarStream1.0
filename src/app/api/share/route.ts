// src/app/api/share/route.ts
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
        { status: 401 },
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body.' },
        { status: 400 },
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
        { status: 400 },
      );
    }

    // Look up the media being shared
    const media = await getMediaById(mediaId);
    if (!media) {
      return NextResponse.json(
        { ok: false, error: 'Media not found.' },
        { status: 404 },
      );
    }

    // Resolve recipient account (username or email)
    const normalizedRecipient = normalizeRecipientIdentifier(recipient);

    const userByUsername = await getUserByUsername(normalizedRecipient);
    const userByEmail = userByUsername
      ? null
      : await getUserByEmail(normalizedRecipient);

    const recipientUser = userByUsername ?? userByEmail;

    if (!recipientUser) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Recipient not found. They must be a registered username or email.',
        },
        { status: 400 },
      );
    }

    const resolvedRecipient = recipientUser.username || recipientUser.email;

    // Clean out any old pending shares for the same media+recipient
    await deleteSharesForMediaAndRecipient(media.id, resolvedRecipient);

    const share = await createShare({
      mediaId: media.id,
      recipient: resolvedRecipient,
      downloadable: downloadable ?? true,
      sender: senderUser.username || senderUser.email,
      mediaTitle: media.title || media.fileName || '(untitled)',
      mediaType: media.type,
    });

    return NextResponse.json(
      {
        ok: true,
        shareId: share.shareId,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/share] Internal error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: 'Internal server error while creating share.',
      },
      { status: 500 },
    );
  }
}
