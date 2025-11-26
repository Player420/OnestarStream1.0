import { NextRequest, NextResponse } from 'next/server';
import { verifyUser } from '@/lib/userStore';
import { createSessionToken, getSessionCookieName } from '@/lib/authSession';

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { ok: false, error: 'Email and password required.' },
        { status: 400 }
      );
    }

    // verifyUser uses email currently; this is fine for now
    const user = await verifyUser(email, password);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Invalid email or password.' },
        { status: 401 }
      );
    }

    const token = createSessionToken(user.id);

    const res = NextResponse.json({ ok: true });

    // Set the onestar_session cookie so /api/share can see who you are
    res.cookies.set(getSessionCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return res;
  } catch (err) {
    console.error('[POST /api/auth/signin] error', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
