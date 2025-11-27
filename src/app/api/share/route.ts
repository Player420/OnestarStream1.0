import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { getMediaById } from '@/lib/mediaStore';
import {
  getUserByEmail,
  getUserByUsername,
  type User,
} from '@/lib/userStore';
import { createShare } from '@/lib/shareStore';

async function findRecipientUser(recipient: string): Promise<User | null> {
  const normalized = recipient.trim().replace(/^@/, '');

  const byUsername = await getUserByUsername(normalized);
  if (byUsername) return byUsername;

  const byEmail = await getUserByEmail(normalized);
  if (byEmail) return byEmail;

  return null;
}

// POST /api/share
export async function POST(req: NextRequest) {
  try {
    const senderUser = await getUserFromRequest(req);
    if (!senderUser) {
      return NextResponse.json(
        { valid: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { valid: false, error: 'Invalid JSON body.' },
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
        { valid: false, error: 'mediaId and recipient are required.' },
        { status: 400 }
      );
    }

    const media = await getMediaById(mediaId);
    if (!media) {
      return NextResponse.json(
        { valid: false, error: 'Media not found.' },
        { status: 404 }
      );
    }

    const recipientUser = await findRecipientUser(recipient);
    if (!recipientUser) {
      return NextResponse.json(
        {
          valid: false,
          error:
            'Recipient not found. They must be a registered username or email.',
        },
        { status: 400 }
      );
    }

    const share = await createShare({
      mediaId: media.id,
      recipient: recipientUser.username || recipientUser.email,
      downloadable: downloadable ?? true,
      sender: senderUser.username || senderUser.email,
      mediaTitle: media.title || media.fileName || '(untitled)',
      mediaType: media.type,
    });

    return NextResponse.json(
      {
        valid: true,
        shareId: share.id,
        packageId: share.packageId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[POST /api/share] Internal error:', err);
    return NextResponse.json(
      {
        valid: false,
        error: 'Internal server error while creating share.',
      },
      { status: 500 }
    );
  }
}
