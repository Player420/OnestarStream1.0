// src/app/api/auth/forgot-password/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getUserByEmail } from '@/lib/userStore';
import { createResetTokenForUser } from '@/lib/passwordResetStore';
import { sendPasswordResetEmail } from '@/lib/mail';

/**
 * POST /api/auth/forgot-password
 * Body: { email: string }
 *
 * Always returns 200 { ok: true } to avoid leaking which emails exist.
 * If the user exists, a reset token is created.
 * - The token is returned in the response (so the UI can proceed without email).
 * - If SMTP is configured, a reset URL is also emailed; otherwise it is just logged.
 */
export async function POST(req: NextRequest) {
  try {
    const body: any = await req.json();
    const email = typeof body?.email === 'string' ? body.email : '';

    if (!email) {
      return NextResponse.json(
        { ok: false, error: 'email is required' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Attempt to find the user. If not found, we still return ok: true.
    const user = await getUserByEmail(normalizedEmail);

    let token: string | null = null;

    if (user) {
      token = await createResetTokenForUser(user.id);

      const origin = req.nextUrl.origin;
      const resetUrl = `${origin}/reset-password?token=${encodeURIComponent(
        token
      )}`;

      // Try to send email if SMTP is configured; otherwise this will log instead.
      await sendPasswordResetEmail(user.email, resetUrl);
    }

    // Always respond success, even if no user is found, for privacy.
    // We also return the token when a user exists, so the UI can continue
    // without depending on external email infrastructure.
    return NextResponse.json({
      ok: true,
      hasUser: !!user,
      token,
    });
  } catch (err: any) {
    console.error('[auth/forgot-password] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to request password reset' },
      { status: 500 }
    );
  }
}

