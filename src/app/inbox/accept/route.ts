import { NextRequest, NextResponse } from 'next/server';
import { markShareAccepted } from '@/lib/shareStore';
import { acceptSharedPackage } from '@/server/accept';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { shareId, packageId, downloadable } = body;

    if (!shareId || !packageId) {
      return NextResponse.json(
        { ok: false, error: 'Missing shareId or packageId' },
        { status: 400 }
      );
    }

    // 1. Mark share as accepted in shares.json
    const updated = await markShareAccepted(shareId);
    if (!updated) {
      return NextResponse.json(
        { ok: false, error: 'Share not found' },
        { status: 404 }
      );
    }

    // 2. Actually copy the media file into the user's library
    const result = await acceptSharedPackage({
      packageId,
      downloadable: downloadable ?? true,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, share: updated }, { status: 200 });
  } catch (err) {
    console.error('Error accepting share:', err);
    return NextResponse.json(
      { ok: false, error: 'Server error accepting share' },
      { status: 500 }
    );
  }
}
