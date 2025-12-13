import { NextRequest, NextResponse } from 'next/server';
import { deleteShareById } from '@/lib/shareStore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const { shareId } = body;

    if (!shareId) {
      return NextResponse.json(
        { ok: false, error: 'Missing shareId' },
        { status: 400 }
      );
    }

    const deleted = await deleteShareById(shareId);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: 'Share not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Error in /api/inbox/delete:', err);
    return NextResponse.json(
      { ok: false, error: 'Error deleting share.' },
      { status: 500 }
    );
  }
}

