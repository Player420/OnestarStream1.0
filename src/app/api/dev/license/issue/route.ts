import { NextRequest, NextResponse } from 'next/server';
import { issueLicenseToUser } from '@/lib/userStore';

const ADMIN_KEY = process.env.ONESTAR_ADMIN_KEY;

/**
 * DEV / ADMIN:
 * POST /api/dev/license/issue
 * Body: { identifier: string }
 *
 * identifier = email, username, or @username
 */
export async function POST(req: NextRequest) {
  try {
    const incomingKey = req.headers.get('x-admin-key');
    if (!ADMIN_KEY || incomingKey !== ADMIN_KEY) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const identifier = body?.identifier as string | undefined;

    if (!identifier) {
      return NextResponse.json(
        { ok: false, error: 'identifier is required' },
        { status: 400 }
      );
    }

    const { user, licenseKey } = await issueLicenseToUser(identifier);

    return NextResponse.json({
      ok: true,
      userId: user.id,
      email: user.email,
      username: user.username,
      licenseKey,
      licenseStatus: user.licenseStatus,
    });
  } catch (err: any) {
    console.error('[dev/license/issue] error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: 'Failed to issue license',
        details: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
