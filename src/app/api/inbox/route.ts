import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { listSharesForRecipient, type ShareRecord } from '@/lib/shareStore';

/**
 * GET /api/inbox?recipient=...
 *
 * Returns ONLY "pending" shares for the given recipient:
 *  - acceptedAt === null
 *  - rejectedAt === null
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    const url = new URL(req.url);
    const recipientParam = url.searchParams.get('recipient')?.trim() ?? '';

    // If caller passes ?recipient=..., trust it; otherwise fall back to current user
    const recipient =
      recipientParam || user.username || user.email || '';

    if (!recipient) {
      return NextResponse.json(
        { ok: false, error: 'No valid recipient was resolved.' },
        { status: 400 }
      );
    }

    // Load all shares for that recipient from shares.json
    const allShares: ShareRecord[] = await listSharesForRecipient(recipient);

    // Only show PENDING (not accepted, not rejected)
    const pending = allShares.filter(
      (s) => !s.acceptedAt && !s.rejectedAt
    );

    return NextResponse.json(
      {
        ok: true,
        shares: pending,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[GET /api/inbox] Internal error:', err);
    return NextResponse.json(
      {
        ok: false,
        error: 'Internal server error while loading inbox.',
      },
      { status: 500 }
    );
  }
}
