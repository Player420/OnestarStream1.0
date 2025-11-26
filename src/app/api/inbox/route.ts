import { NextRequest, NextResponse } from 'next/server';
import { listSharesForRecipient } from '@/lib/shareStore';
import { getUserFromRequest } from '@/lib/authSession';

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'You must be logged in to view your inbox.' },
        { status: 401 }
      );
    }

    // A share is valid for this user if recipient matches either:
    // - their email (case-insensitive), OR
    // - their username (exact match).
    const email = user.email.toLowerCase();
    const username = user.username;

    const sharesByEmail = await listSharesForRecipient(email);
    const sharesByUsername =
      username.toLowerCase() === email
        ? []
        : await listSharesForRecipient(username);

    // Merge, dedupe by id
    const merged = [...sharesByEmail];
    for (const s of sharesByUsername) {
      if (!merged.some((m) => m.id === (s as any).id)) {
        merged.push(s);
      }
    }

    return NextResponse.json({ ok: true, shares: merged });
  } catch (err) {
    console.error('[GET /api/inbox] error', err);
    return NextResponse.json(
      { ok: false, error: 'Internal server error.' },
      { status: 500 }
    );
  }
}
