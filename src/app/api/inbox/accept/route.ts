import { NextRequest, NextResponse } from 'next/server';
import { acceptSharedPackage } from '@/server/accept';
import { markShareAccepted } from '@/lib/shareStore';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const { packageId, shareId, downloadable } = body;

    if (!packageId) {
      return NextResponse.json(
        { ok: false, error: 'Missing packageId' },
        { status: 400 }
      );
    }

    // Actually import/decrypt the package into Protected media
    const accepted = await acceptSharedPackage({
      packageId,
      downloadable: downloadable !== false,
    });

    if (!accepted) {
      return NextResponse.json(
        { ok: false, error: 'Failed to accept package.' },
        { status: 500 }
      );
    }

    // If we know which share this came from, mark it accepted
    if (shareId) {
      await markShareAccepted(shareId);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Error in /api/inbox/accept:', err);
    return NextResponse.json(
      { ok: false, error: 'Error accepting shared item.' },
      { status: 500 }
    );
  }
}
