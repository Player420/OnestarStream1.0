import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { getShareById, markShareAccepted } from '@/lib/shareStore';
import { getMediaById } from '@/lib/mediaStore';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.shareId) {
      return NextResponse.json(
        { ok: false, error: 'shareId is required.' },
        { status: 400 }
      );
    }

    const { shareId } = body as { shareId: string };

    const share = await getShareById(shareId);
    if (!share) {
      return NextResponse.json(
        { ok: false, error: 'Share not found.' },
        { status: 404 }
      );
    }

    const media = await getMediaById(share.mediaId);
    if (!media) {
      return NextResponse.json(
        { ok: false, error: 'Original media not found.' },
        { status: 404 }
      );
    }

    await markShareAccepted(shareId);

    // In your current architecture media.json is global,
    // so we don't need to duplicate the file; accept just marks it.
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/inbox/accept] Internal error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error while accepting share.' },
      { status: 500 }
    );
  }
}

