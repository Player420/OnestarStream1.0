import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { deleteMedia } from '@/lib/mediaStore';

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // In Next 16, params is a Promise – we MUST await it
    const { id } = await context.params;

    // Optional: enforce auth so only signed-in users can delete
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    const deleted = await deleteMedia(id);
    if (!deleted) {
      return NextResponse.json(
        { ok: false, error: 'Media not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[DELETE /api/media/[id]] Internal error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to delete media.' },
      { status: 500 }
    );
  }
}
