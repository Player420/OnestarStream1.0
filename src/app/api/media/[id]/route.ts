import { NextRequest, NextResponse } from 'next/server';
import { deleteMedia } from '@/lib/mediaStore';
import { getUserFromRequest } from '@/lib/authSession';

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const user = await getUserFromRequest(_req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 },
      );
    }

    const ok = await deleteMedia(id, user.id);
    if (!ok) {
      return NextResponse.json(
        { ok: false, error: 'Media not found or not owned by you.' },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('[DELETE /api/media/[id]] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to delete media.' },
      { status: 500 },
    );
  }
}
