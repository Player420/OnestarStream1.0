import { NextRequest, NextResponse } from 'next/server';
import { resetUserPassword } from '@/lib/userStore';

const ADMIN_KEY = process.env.ONESTAR_ADMIN_KEY;

/**
 * DEV / ADMIN ONLY:
 * POST /api/dev/reset-password
 * Body: { identifier: string; newPassword: string }
 *
 * - identifier can be email, username, or @username
 * - Only works if user has an active license
 */
export async function POST(req: NextRequest) {
  try {
    // Admin guard via header
    const incomingKey = req.headers.get('x-admin-key');
    if (!ADMIN_KEY || incomingKey !== ADMIN_KEY) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const identifier = body?.identifier as string | undefined;
    const newPassword = body?.newPassword as string | undefined;

    if (!identifier || !newPassword) {
      return NextResponse.json(
        { ok: false, error: 'identifier and newPassword are required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { ok: false, error: 'newPassword must be at least 8 characters' },
        { status: 400 }
      );
    }

    const updatedUser = await resetUserPassword(identifier, newPassword);

    return NextResponse.json({
      ok: true,
      userId: updatedUser.id,
      email: updatedUser.email,
      username: updatedUser.username,
    });
  } catch (err: any) {
    console.error('[dev/reset-password] error:', err);

    const message = err?.message ?? String(err);

    // Surface “not found” and “no license” as 400/404 style errors
    if (message.includes('User not found')) {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 404 }
      );
    }

    if (message.includes('does not have an active license')) {
      return NextResponse.json(
        { ok: false, error: message },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { ok: false, error: 'Internal error resetting password' },
      { status: 500 }
    );
  }
}
