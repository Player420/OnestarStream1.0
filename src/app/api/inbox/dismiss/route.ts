// src/app/api/inbox/dismiss/route.ts
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

    // Must be logged in
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    // Load share
    const share = await getShareById(shareId);
    if (!share) {
      return NextResponse.json(
        { ok: false, error: 'Share not found.' },
        { status: 404 }
      );
    }

    // Mark dismissed
    await markShareRejected(shareId);

    return NextResponse.json({ ok: true }, { status: 200 });

  } catch (err) {
    console.error('[POST /api/inbox/dismiss] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal error while dismissing share.' },
      { status: 500 }
    );
  }
}
