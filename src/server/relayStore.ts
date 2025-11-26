'use server';

import fs from 'fs';
import path from 'path';

const ROOT = path.join(process.cwd(), 'onestar_data');
const MEDIA_DIR = path.join(ROOT, 'media');
const META_DIR = path.join(ROOT, 'metadata');

function ensureDirs() {
  if (!fs.existsSync(ROOT)) fs.mkdirSync(ROOT);
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR);
  if (!fs.existsSync(META_DIR)) fs.mkdirSync(META_DIR);
}

ensureDirs();

/**
 * Save encrypted track to local disk.
 */
export async function uploadEncryptedTrack(id: string, encrypted: Uint8Array) {
  const file = path.join(MEDIA_DIR, `${id}.bin`);
  await fs.promises.writeFile(file, Buffer.from(encrypted));
  return true;
}

/**
 * Load encrypted track.
 */
export async function downloadEncryptedTrack(id: string): Promise<Buffer | null> {
  const file = path.join(MEDIA_DIR, `${id}.bin`);
  if (!fs.existsSync(file)) return null;
  return await fs.promises.readFile(file);
}

/**
 * Save metadata JSON.
 */
export async function saveMetadata(id: string, metadata: any) {
  const file = path.join(META_DIR, `${id}.json`);
  await fs.promises.writeFile(file, JSON.stringify(metadata, null, 2));
  return true;
}

/**
 * Load metadata JSON.
 */
export async function loadMetadata(id: string): Promise<any | null> {
  const file = path.join(META_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  const raw = await fs.promises.readFile(file, 'utf8');
  return JSON.parse(raw);
}

/**
 * List all media items in the Library.
 */
export async function listMediaItems() {
  const files = await fs.promises.readdir(MEDIA_DIR);
  const list = [];

  for (const file of files) {
    if (!file.endsWith('.bin')) continue;

    const id = file.replace('.bin', '');
    const metadata = await loadMetadata(id);

    list.push({
      id,
      title: metadata?.title ?? 'Untitled',
      type: metadata?.type ?? 'audio',
      fileName: file,
      sizeBytes: fs.statSync(path.join(MEDIA_DIR, file)).size,
      createdAt: metadata?.createdAt ?? new Date().toISOString(),
      protected: true,
    });
  }

  return list;
}

/**
 * Delete track + metadata.
 */
export async function deleteMedia(id: string) {
  const mediaPath = path.join(MEDIA_DIR, `${id}.bin`);
  const metaPath = path.join(META_DIR, `${id}.json`);

  if (fs.existsSync(mediaPath)) await fs.promises.unlink(mediaPath);
  if (fs.existsSync(metaPath)) await fs.promises.unlink(metaPath);

  return true;
}
