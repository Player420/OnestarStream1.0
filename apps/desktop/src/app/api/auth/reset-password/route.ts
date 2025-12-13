// src/app/api/auth/reset-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { consumeResetToken } from '@/lib/passwordResetStore';
import { getUserById, resetUserPassword } from '@/lib/userStore';

/**
 * POST /api/auth/reset-password
 * Body: { token: string; newPassword: string }
 *
 * Uses a one-time, expiring token created by /api/auth/forgot-password.
 * On success, the user's passwordHash in users.enc is updated via resetUserPassword.
 */
export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json();
    const token = typeof body?.token === 'string' ? body.token : '';
    const newPassword =
      typeof body?.newPassword === 'string' ? body.newPassword : '';

    if (!token) {
      return NextResponse.json(
        { ok: false, error: 'token is required' },
        { status: 400 }
      );
    }

    if (!newPassword) {
      return NextResponse.json(
        { ok: false, error: 'newPassword is required' },
        { status: 400 }
      );
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { ok: false, error: 'newPassword must be at least 8 characters' },
        { status: 400 }
      );
    }

    // Validate & consume the token (one-time use).
    const record = await consumeResetToken(token);
    if (!record) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or expired reset token' },
        { status: 400 }
      );
    }

    const user = await getUserById(record.userId);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'User not found for this reset token' },
        { status: 404 }
      );
    }

    // resetUserPassword accepts an "identifier" string (email or username).
    // Use the user's email as the identifier for the update.
    const updatedUser = await resetUserPassword(user.email, newPassword);
    if (!updatedUser) {
      return NextResponse.json(
        { ok: false, error: 'Failed to reset password for this user' },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[auth/reset-password] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to reset password' },
      { status: 500 }
    );
  }
}
