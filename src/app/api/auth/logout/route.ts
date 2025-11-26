import { NextRequest, NextResponse } from 'next/server';
import { getSessionCookieName } from '@/lib/authSession';

export async function POST(_req: NextRequest) {
  const res = NextResponse.json({ ok: true });

  res.cookies.set(getSessionCookieName(), '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return res;
}
