import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: false, user: null }, { status: 200 });
    }

    return NextResponse.json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          createdAt: user.createdAt,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[GET /api/me] error:', err);
    return NextResponse.json(
      { ok: false, user: null, error: 'Internal error' },
      { status: 500 }
    );
  }
}
