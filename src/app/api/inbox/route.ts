import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { listSharesForRecipient } from '@/lib/shareStore';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const recipientParam = url.searchParams.get('recipient');

    // Logged-in user fallback
    const user = await getUserFromRequest(req);
    const fallback = user?.username || user?.email || null;

    const recipient = recipientParam || fallback;
    if (!recipient) {
      return NextResponse.json(
        { ok: false, error: 'Recipient required.' },
        { status: 400 }
      );
    }

    // Pull clean pending-only shares
    const shares = await listSharesForRecipient(recipient);

    return NextResponse.json(
      { ok: true, shares },
      { status: 200 }
    );
  } catch (err) {
    console.error('[GET /api/inbox] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal error.' },
      { status: 500 }
    );
  }
}
