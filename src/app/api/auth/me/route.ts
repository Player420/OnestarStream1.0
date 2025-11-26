import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';

export async function GET(req: NextRequest) {
  // Try to resolve the current user from the session cookie
  const user = await getUserFromRequest(req);

  if (!user) {
    // Not logged in
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
      },
      { status: 200 }
    );
  }

  // Logged in – expose only safe fields
  return NextResponse.json(
    {
      authenticated: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: user.createdAt,
      },
    },
    { status: 200 }
  );
}
