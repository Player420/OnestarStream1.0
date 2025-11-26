import { NextRequest, NextResponse } from 'next/server';
import { deleteMedia, getMediaById } from '@/lib/mediaStore';

// Next 16: params is a Promise and must be awaited.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const mediaItem = await getMediaById(id);
  if (!mediaItem) {
    return new NextResponse('Media not found', { status: 404 });
  }

  const ok = await deleteMedia(id);
  if (!ok) {
    return new NextResponse('Failed to delete media', { status: 500 });
  }

  // 204 = No Content on successful delete
  return new NextResponse(null, { status: 204 });
}
