import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';

import { getShareById, markShareAccepted } from '@/lib/shareStore';
import { addMedia, getMediaById, getMediaFilePath } from '@/lib/mediaStore';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  const { shareId, recipient } = body as {
    shareId?: string;
    recipient?: string;
  };

  if (!shareId || !recipient) {
    return NextResponse.json(
      { ok: false, error: 'shareId and recipient are required' },
      { status: 400 }
    );
  }

  const share = await getShareById(shareId);
  if (!share) {
    return NextResponse.json(
      { ok: false, error: 'Share not found' },
      { status: 404 }
    );
  }

  if (share.recipient !== recipient) {
    return NextResponse.json(
      { ok: false, error: 'Not authorized for this share' },
      { status: 403 }
    );
  }

  const media = await getMediaById(share.mediaId);
  if (!media) {
    return NextResponse.json(
      { ok: false, error: 'Original media not found' },
      { status: 404 }
    );
  }

  // Read the original file contents
  const sourcePath = getMediaFilePath(media);
  const contents = await fs.readFile(sourcePath);

  // Generate a unique license ID for the accepted share
  const { randomUUID } = await import('crypto');
  const licenseId = `license-${randomUUID()}`;

  // For now, we keep the same title + type.
  // "downloadable" flag controls protected vs play-only for the *new* item.
  const newItem = await addMedia({
    title: media.title,
    type: media.type,
    sizeBytes: contents.length,
    originalName: media.fileName,
    contents,
    protected: !share.downloadable,
    licenseId,
  });

  await markShareAccepted(shareId);

  return NextResponse.json({ ok: true, media: newItem });
}
