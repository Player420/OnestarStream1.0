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
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const { email, username, password } = body as {
    email?: string;
    username?: string;
    password?: string;
  };

  if (!email || !username || !password) {
    return NextResponse.json(
      { error: 'email, username and password are required' },
      { status: 400 },
    );
  }

  // Basic duplicate checks
  const existingByEmail = await getUserByEmail(email);
  if (existingByEmail) {
    return NextResponse.json(
      { error: 'Email already in use' },
      { status: 400 },
    );
  }

  const existingByUsername = await getUserByUsername(username);
  if (existingByUsername) {
    return NextResponse.json(
      { error: 'Username already in use' },
      { status: 400 },
    );
  }

  // Create encrypted user record
  const user = await createUser(email, username, password);

  // Log them in immediately by setting session cookie
  const token = createSessionToken(user.id);
  const res = NextResponse.json({ ok: true, userId: user.id });

  res.cookies.set(getSessionCookieName(), token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  return res;
}
