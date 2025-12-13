import { NextRequest, NextResponse } from 'next/server';
import { verifyUser } from '@/lib/userStore';
import { createSessionToken, getSessionCookieName } from '@/lib/authSession';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body || !body.email || !body.password) {
      return NextResponse.json(
        { ok: false, error: 'Email and password are required.' },
        { status: 400 }
      );
    }

    const { email, password } = body;

    const user = await verifyUser(email, password);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const token = createSessionToken(user.id);

    const res = NextResponse.json(
      { ok: true },
      { status: 200 }
    );

    // IMPORTANT:
    // App is currently served over plain HTTP (no TLS),
    // so we CANNOT use `secure: true` yet or the cookie will never be sent.
    res.cookies.set(getSessionCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // must be false while running on http://137.184.46.163:3002
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });

    return res;

  } catch (err) {
    console.error('[POST /api/auth/signin] Internal error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error during sign in.' },
      { status: 500 }
    );
  }
}
