import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import { getMediaById, getMediaFilePath, MediaItem } from '@/lib/mediaStore';

export const runtime = 'nodejs';

function getContentType(media: MediaItem): string {
  const ext = path.extname(media.fileName).toLowerCase();

  // Images
  if (media.type === 'image') {
    if (ext === '.png') return 'image/png';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.webp') return 'image/webp';
    return 'image/jpeg';
  }

  // Audio (hi-res + lossless)
  if (media.type === 'audio') {
    if (ext === '.wav' || ext === '.wave') return 'audio/wav';
    if (ext === '.flac') return 'audio/flac';
    if (ext === '.mp3') return 'audio/mpeg';
    if (ext === '.aac') return 'audio/aac';
    if (ext === '.aiff' || ext === '.aif') return 'audio/aiff';
    if (ext === '.m4a' || ext === '.alac') return 'audio/mp4'; // ALAC often wrapped in m4a
    return 'audio/*'; // fallback for unknown audio
  }

  // Video
  if (media.type === 'video') {
    if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.webm') return 'video/webm';
    return 'video/*';
  }

  // Fallback
  return 'application/octet-stream';
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const media = await getMediaById(id);
    if (!media) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const filePath = getMediaFilePath(media);

    // Read full file into memory (simple, OK for your current file sizes)
    const fileBuffer = await fs.readFile(filePath);
    const fileSize = fileBuffer.length;
    const contentType = getContentType(media);

    const range = req.headers.get('range');

    // Handle HTTP Range requests for proper seeking in players
    if (range) {
      const bytesPrefix = 'bytes=';
      if (!range.startsWith(bytesPrefix)) {
        return new NextResponse('Invalid Range', { status: 416 });
      }

      const [startStr, endStr] = range.substring(bytesPrefix.length).split('-');
      let start = Number(startStr);
      let end = endStr ? Number(endStr) : fileSize - 1;

      if (Number.isNaN(start) || start < 0 || start >= fileSize) {
        return new NextResponse('Invalid Range', { status: 416 });
      }

      if (Number.isNaN(end) || end >= fileSize) {
        end = fileSize - 1;
      }

      const chunkSize = end - start + 1;
      const chunk = fileBuffer.subarray(start, end + 1);

      return new NextResponse(chunk, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunkSize),
          'Content-Type': contentType,
        },
      });
    }

    // No Range header – return full file
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Length': String(fileSize),
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (err) {
    console.error('Stream GET error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
