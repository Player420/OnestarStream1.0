import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import {
  getShareById,
  markShareRejected,
} from '@/lib/shareStore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.shareId) {
      return NextResponse.json(
        { ok: false, error: 'shareId is required.' },
        { status: 400 }
      );
    }

    const shareId = body.shareId;

    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    const share = await getShareById(shareId);
    if (!share) {
      return NextResponse.json(
        { ok: false, error: 'Share not found.' },
        { status: 404 }
      );
    }

    const senderId = share.sender;
    const currentUserId = user.username || user.email;

    if (senderId !== currentUserId) {
      return NextResponse.json(
        { ok: false, error: 'You do not have permission to revoke this share.' },
        { status: 403 }
      );
    }

    await markShareRejected(shareId);

    return NextResponse.json(
      { ok: true, revoked: true },
      { status: 200 }
    );

  } catch (err) {
    console.error('[POST /api/inbox/revoke] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal error while revoking share.' },
      { status: 500 }
    );
  }
}
