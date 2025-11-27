import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/authSession';

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });

  const cookieName = getSessionCookieName();

  // Fully delete the cookie in every browser
  res.cookies.set(cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    expires: new Date(0), // <-- required for Safari/Chrome
  });

  return res;
}
