import { NextRequest, NextResponse } from 'next/server';
import { resetUserPassword } from '@/lib/userStore';

/**
 * TEMP DEV ROUTE
 * POST /api/dev/reset-password
 * Body: { identifier: string; newPassword: string }
 *
 * identifier = email OR username (e.g. "1*will" or "user@example.com")
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({} as any))) as {
      identifier?: string;
      newPassword?: string;
    };

    const { identifier, newPassword } = body;

    if (!identifier || !newPassword) {
      return NextResponse.json(
        { ok: false, error: 'identifier and newPassword are required' },
        { status: 400 }
      );
    }

    const updatedUser = await resetUserPassword(identifier, newPassword);

    if (!updatedUser) {
      return NextResponse.json(
        { ok: false, error: 'User not found for given identifier' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[dev/reset-password] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal error resetting password' },
      { status: 500 }
    );
  }
}
