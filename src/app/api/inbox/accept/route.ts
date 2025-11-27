import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';

import {
  getShareById,
  markShareAccepted,
} from '@/lib/shareStore';

import {
  getMediaById,
  getMediaFilePath,
  addMedia
} from '@/lib/mediaStore';


export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.shareId) {
      return NextResponse.json(
        { ok: false, error: 'shareId is required.' },
        { status: 400 }
      );
    }

    const shareId = body.shareId;

    // Require user auth
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated.' },
        { status: 401 }
      );
    }

    // Load share
    const share = await getShareById(shareId);
    if (!share) {
      return NextResponse.json(
        { ok: false, error: 'Share not found.' },
        { status: 404 }
      );
    }

    // Load original media
    const media = await getMediaById(share.mediaId);
    if (!media) {
      return NextResponse.json(
        { ok: false, error: 'Original media not found.' },
        { status: 404 }
      );
    }

    // Copy the file into recipient’s library (protected or not)
    const filePath = getMediaFilePath(media);
    const fileContents = await (await import('fs/promises')).readFile(filePath);

    await addMedia({
      title: media.title,
      type: media.type,
      sizeBytes: media.sizeBytes,
      originalName: media.fileName,
      contents: fileContents,
      protected: !share.downloadable   // true => protected media folder
    });

    // Mark accepted
    await markShareAccepted(shareId);

    return NextResponse.json({ ok: true }, { status: 200 });

  } catch (err) {
    console.error('[POST /api/inbox/accept] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal error while accepting share.' },
      { status: 500 }
    );
  }
}
