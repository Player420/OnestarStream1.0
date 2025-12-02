import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);

  // Not logged in
  if (!user) {
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
      },
      { status: 200 }
    );
  }

  // Logged in — expose safe fields
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

