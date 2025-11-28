/* src/app/api/inbox/dismiss/route.ts */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';

import {
  getShareById,
  markShareRejected
} from '@/lib/shareStore';

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
    const shareId = body?.shareId;

    if (!shareId) {
      return NextResponse.json(
        { ok: false, error: 'shareId is required.' },
        { status: 400 }
      );
    }

    // Load the share
    const share = await getShareById(shareId);
    if (!share) {
      // Zombie row → pretend success but nothing to do
      return NextResponse.json({ ok: true, cleared: true }, { status: 200 });
    }

    // Reject the share
    const updated = await markShareRejected(shareId);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: 'Failed to reject share.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, shareId },
      { status: 200 }
    );

  } catch (err) {
    console.error('[POST /api/inbox/dismiss] Internal error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
