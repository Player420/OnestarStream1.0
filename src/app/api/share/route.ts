import { NextRequest, NextResponse } from 'next/server';
import { createShare } from '@/lib/shareStore';
import { getMediaById } from '@/lib/mediaStore';
import { findUserByEmailOrUsername } from '@/lib/userStore';
import { getUserFromRequest } from '@/lib/authSession';

// POST /api/share
// Body: { mediaId: string; recipient: string; downloadable?: boolean }
export async function POST(req: NextRequest) {
  try {
    // 1) Require a logged-in sender
    const sender = await getUserFromRequest(req);
    if (!sender) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          error: 'You must be logged in to share tracks.',
        },
        { status: 401 }
      );
    }

    const { mediaId, recipient, downloadable } = await req.json();

    if (!mediaId || !recipient) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          error: 'mediaId and recipient are required.',
        },
        { status: 400 }
      );
    }

    // 2) Validate that the recipient is a real user (email OR username)
    const recipientUser = await findUserByEmailOrUsername(recipient);
    if (!recipientUser) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          error: 'Recipient is not a valid OnestarStream user.',
        },
        { status: 400 }
      );
    }

    // 3) Ensure media exists
    const mediaItem = await getMediaById(mediaId);
    if (!mediaItem) {
      return NextResponse.json(
        {
          ok: false,
          valid: false,
          error: 'Media not found.',
        },
        { status: 404 }
      );
    }

    // 4) Create the share record (shareStore handles IDs, packageId etc.)
    const share = await createShare({
      mediaId: mediaItem.id,
      recipient: recipientUser.username || recipientUser.email,
      downloadable: !!downloadable,
      // keep sender info so we can show "From: sender" in inbox
      senderId: sender.id,
      senderUsername: sender.username,
      senderEmail: sender.email,
      mediaTitle: mediaItem.title,
      mediaType: mediaItem.type,
    });

    // 5) Respond in the same style your UI expects
    return NextResponse.json(
      {
        ok: true,
        valid: true,
        shareId: share.id,
        mediaId: share.mediaId,
        recipient: share.recipient,
        downloadable: share.downloadable,
        packageId: share.packageId,
        createdAt: share.createdAt,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[POST /api/share] Error:', err);
    return NextResponse.json(
      {
        ok: false,
        valid: false,
        error: 'Failed to create share.',
      },
      { status: 500 }
    );
  }
}

