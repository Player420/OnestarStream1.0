import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { addMedia, getMediaForOwner, type MediaType } from '@/lib/mediaStore';
import { randomUUID } from 'crypto';

export async function GET(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ ok: true, items: [] }, { status: 200 });
    }

    const items = await getMediaForOwner(user.id);
    return NextResponse.json(items, { status: 200 });
  } catch (err) {
    console.error('[GET /api/media] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to load media.' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 },
      );
    }

    const formData = await req.formData();

    const file = formData.get('file');
    const title = (formData.get('title') as string) || '';
    const type = formData.get('type') as MediaType;
    const protectedFlag = formData.get('protected') === 'true';

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: 'Missing file.' },
        { status: 400 },
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());

    // Generate a unique license ID for this media
    const licenseId = `license-${randomUUID()}`;

    const item = await addMedia({
      title: title || file.name,
      type,
      sizeBytes: buf.length,
      originalName: file.name,
      contents: buf,
      protected: protectedFlag,
      ownerId: user.id, // critical: media belongs to this user
      licenseId, // NEW: attach license ID for usage tracking
    });

    console.log('[POST /api/media] uploaded media', {
      id: item.id,
      title: item.title,
      protected: item.protected,
      ownerId: item.ownerId,
      licenseId: item.licenseId,
    });

    return NextResponse.json(item, { status: 200 });
  } catch (err) {
    console.error('[POST /api/media] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to upload media.' },
      { status: 500 },
    );
  }
}

