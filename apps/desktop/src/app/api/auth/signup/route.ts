import { NextRequest, NextResponse } from 'next/server';
import {
  createUser,
  getUserByEmail,
  getUserByUsername,
} from '@/lib/userStore';
import {
  createSessionToken,
  getSessionCookieName,
} from '@/lib/authSession';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);

    if (!body) {
      return NextResponse.json(
        { ok: false, error: 'Invalid JSON body.' },
        { status: 400 }
      );
    }

    const { email, username, password } = body as {
      email?: string;
      username?: string;
      password?: string;
    };

    if (!email || !username || !password) {
      return NextResponse.json(
        { ok: false, error: 'Email, username, and password are required.' },
        { status: 400 }
      );
    }

    // Duplicate email
    const existingByEmail = await getUserByEmail(email);
    if (existingByEmail) {
      return NextResponse.json(
        { ok: false, error: 'Email already in use.' },
        { status: 400 }
      );
    }

    // Duplicate username
    const existingByUsername = await getUserByUsername(username);
    if (existingByUsername) {
      return NextResponse.json(
        { ok: false, error: 'Username already in use.' },
        { status: 400 }
      );
    }

    // Create user
    const user = await createUser(email, username, password);

    // Create session cookie
    const token = createSessionToken(user.id);

    const res = NextResponse.json(
      {
        ok: true,
        userId: user.id,
      },
      { status: 200 }
    );

    res.cookies.set(getSessionCookieName(), token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days (match signin)
    });

    return res;

  } catch (err) {
    console.error('[POST /api/auth/signup] Internal error:', err);

    return NextResponse.json(
      { ok: false, error: 'Internal server error during signup.' },
      { status: 500 }
    );
  }
}
