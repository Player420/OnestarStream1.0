import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { markShareRejected } from '@/lib/shareStore';

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

    const updated = await markShareRejected(shareId);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: 'Share not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[POST /api/inbox/dismiss] Internal error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error while dismissing share.' },
      { status: 500 }
    );
  }
}

