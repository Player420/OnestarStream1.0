import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { addMedia, getAllMedia } from '@/lib/mediaStore';
import type { MediaType } from '@/lib/mediaStore';

// GET /api/media → list media (global store on this node)
export async function GET(req: NextRequest) {
  try {
    // We still check auth so unauthenticated callers get an empty list.
    const user = await getUserFromRequest(req);

    if (!user) {
      // Not logged in → nothing to show
      return NextResponse.json([], { status: 200 });
    }

    const items = await getAllMedia();
    return NextResponse.json(items, { status: 200 });
  } catch (err) {
    console.error('[GET /api/media] error:', err);
    return NextResponse.json(
      { error: 'Failed to load media.' },
      { status: 500 },
    );
  }
}

// POST /api/media → upload new media
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);

    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 },
      );
    }

    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json(
        { ok: false, error: 'Invalid form data.' },
        { status: 400 },
      );
    }

    const file = formData.get('file') as File | null;
    const title = (formData.get('title') as string | null) ?? '';
    const typeRaw = (formData.get('type') as string | null) ?? 'audio';
    const downloadableRaw = formData.get('downloadable');

    if (!file) {
      return NextResponse.json(
        { ok: false, error: 'File is required.' },
        { status: 400 },
      );
    }

    const type = (typeRaw || 'audio') as MediaType;
    const downloadable = downloadableRaw !== null; // checkbox present → true

    const arrayBuffer = await file.arrayBuffer();
    const contents = Buffer.from(arrayBuffer);

    // If "Downloadable" is checked, we store plain.
    // If unchecked, we treat it as protected/encrypted.
    const protectedFlag = !downloadable;

    const newItem = await addMedia({
      title: title || file.name,
      type,
      sizeBytes: file.size,
      originalName: file.name,
      contents,
      protected: protectedFlag,
    });

    console.log('[POST /api/media] uploaded media', {
      id: newItem.id,
      title: newItem.title,
      protected: newItem.protected,
    });

    return NextResponse.json(
      { ok: true, media: newItem },
      { status: 200 },
    );
  } catch (err) {
    console.error('[POST /api/media] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to upload media.' },
      { status: 500 },
    );
  }
}

