// app/api/media/route.ts
import { NextRequest } from 'next/server';
import { addMedia, getAllMedia, MediaType } from '@/lib/mediaStore';

export const runtime = 'nodejs'; // we need Node APIs

export async function GET() {
  const items = await getAllMedia();
  return Response.json(items);
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get('file') as unknown as File | null;
  const title = (formData.get('title') as string) || '';
  const downloadableField = formData.get('downloadable') as string | null;
  const isDownloadable = downloadableField === 'on' || downloadableField === 'true' || downloadableField === '1';
  const isProtected = !isDownloadable;
  const type = (formData.get('type') as MediaType) || 'audio';

  if (!file) {
    return new Response('No file uploaded', { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const media = await addMedia({
    title: title || file.name,
    type,
    sizeBytes: buffer.byteLength,
    originalName: file.name,
    contents: buffer,
    protected: isProtected,
  });

  return Response.json(media, { status: 201 });
}
