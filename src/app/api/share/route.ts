import { NextRequest, NextResponse } from 'next/server';

import { getUserFromRequest } from '@/lib/authSession';
import { getMediaById } from '@/lib/mediaStore';
import {
  createShare,
  findUserByEmailOrUsername,
} from '@/lib/shareStore';

export async function POST(req: NextRequest) {
  try {
    const sender = await getUserFromRequest(req);
    if (!sender) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON.' },
        { status: 400 }
      );
    }

    const { mediaId, recipient, downloadable } = body;

    if (!mediaId || !recipient) {
      return NextResponse.json(
        { ok: false, error: 'mediaId and recipient required.' },
        { status: 400 }
      );
    }

    const media = await getMediaById(mediaId);
    if (!media) {
      return NextResponse.json(
        { ok: false, error: 'Media not found.' },
        { status: 404 }
      );
    }

    // Resolve recipient
    const recipientUser = await findUserByEmailOrUsername(recipient);
    if (!recipientUser) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'Recipient not found. Must be an existing username or email.',
        },
        { status: 400 }
      );
    }

    // Create ONE clean share record
    const share = await createShare({
      mediaId: media.id,
      recipient: recipientUser.username || recipientUser.email,
      downloadable: downloadable ?? true,
      sender: sender.username || sender.email,
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
    console.error('[POST /api/share] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
