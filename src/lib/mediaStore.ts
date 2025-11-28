import fs from 'fs/promises';
import path from 'path';
import crypto, { randomUUID } from 'crypto';

export type MediaType = 'audio' | 'video' | 'image';

export interface MediaItem {
  id: string;
  title: string;
  fileName: string;
  type: MediaType;
  sizeBytes: number;
  createdAt: string;
  protected: boolean;
  ownerId: string | null; // NEW: owner of this media (user.id)
}

const MEDIA_DIR = path.join(process.cwd(), 'public', 'media');
const PROTECTED_MEDIA_DIR = path.join(process.cwd(), 'protected_media');
const META_PATH = path.join(process.cwd(), 'media.json');

async function ensureSetup() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.mkdir(PROTECTED_MEDIA_DIR, { recursive: true });

  try {
    await fs.access(META_PATH);
  } catch {
    await fs.writeFile(META_PATH, '[]', 'utf8');
  }
}

export async function getAllMedia(): Promise<MediaItem[]> {
  await ensureSetup();
  const raw = await fs.readFile(META_PATH, 'utf8');
  const items = JSON.parse(raw) as any[];

  // Normalize legacy rows
  return items.map((item) => ({
    id: item.id,
    title: item.title ?? '',
    fileName: item.fileName,
    type: item.type as MediaType,
    sizeBytes: item.sizeBytes ?? 0,
    createdAt: item.createdAt ?? new Date().toISOString(),
    protected: item.protected ?? false,
    ownerId: item.ownerId ?? null,
  }));
}

async function saveAllMedia(items: MediaItem[]) {
  await fs.writeFile(META_PATH, JSON.stringify(items, null, 2), 'utf8');
}

interface AddMediaInput {
  title: string;
  type: MediaType;
  sizeBytes: number;
  originalName: string;
  contents: Buffer;
  protected?: boolean;
  ownerId?: string | null; // NEW: who owns this copy
}

/**
 * Symmetric key for media encryption (protected files).
 */
function getKey(): Buffer {
  const defaultKeyHex = '0123456789abcdef0123456789abcdef';
  const keyHex = process.env.ONESTAR_KEY || defaultKeyHex;
  return Buffer.from(keyHex, 'hex');
}

function encryptBuffer(plain: Buffer): Buffer {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // [IV(16)][authTag(16)][ciphertext]
  return Buffer.concat([iv, authTag, encrypted]);
}

function decryptBufferInternal(encrypted: Buffer): Buffer {
  const key = getKey();
  const iv = encrypted.slice(0, 16);
  const authTag = encrypted.slice(16, 32);
  const ciphertext = encrypted.slice(32);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export { decryptBufferInternal as decryptBuffer };

/**
 * Add a new media item, optionally protected (encrypted), for a specific owner.
 */
export async function addMedia(input: AddMediaInput): Promise<MediaItem> {
  await ensureSetup();
  const items = await getAllMedia();

  const id = randomUUID();
  const ext = path.extname(input.originalName) || '';
  const fileName = `${id}${ext}`;
  const isProtected = !!input.protected;
  const ownerId = input.ownerId ?? null;

  let newItem: MediaItem;

  if (isProtected) {
    // Protected: encrypt and store in protected_media as .bin
    const encryptedContents = encryptBuffer(input.contents);
    const secureFileName = `${id}.bin`;
    const filePath = path.join(PROTECTED_MEDIA_DIR, secureFileName);

    await fs.writeFile(filePath, encryptedContents);

    newItem = {
      id,
      title: input.title,
      fileName: secureFileName,
      type: input.type,
      sizeBytes: input.sizeBytes,
      createdAt: new Date().toISOString(),
      protected: true,
      ownerId,
    };
  } else {
    // Non-protected: store plain in public/media
    const filePath = path.join(MEDIA_DIR, fileName);
    await fs.writeFile(filePath, input.contents);

    newItem = {
      id,
      title: input.title,
      fileName,
      type: input.type,
      sizeBytes: input.sizeBytes,
      createdAt: new Date().toISOString(),
      protected: false,
      ownerId,
    };
  }

  items.push(newItem);
  await saveAllMedia(items);

  return newItem;
}

export async function deleteMedia(id: string, ownerId?: string): Promise<boolean> {
  await ensureSetup();
  const items = await getAllMedia();
  const index = items.findIndex((i) => i.id === id && (!ownerId || i.ownerId === ownerId));

  if (index === -1) {
    return false;
  }

  const [deletedItem] = items.splice(index, 1);
  await saveAllMedia(items);

  const baseDir = deletedItem.protected ? PROTECTED_MEDIA_DIR : MEDIA_DIR;
  const filePath = path.join(baseDir, deletedItem.fileName);

  try {
    await fs.unlink(filePath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  return true;
}

export async function getMediaById(id: string): Promise<MediaItem | null> {
  const items = await getAllMedia();
  return items.find((i) => i.id === id) ?? null;
}

export async function getMediaForOwner(ownerId: string): Promise<MediaItem[]> {
  const items = await getAllMedia();
  return items.filter((i) => i.ownerId === ownerId);
}

export function getMediaFilePath(item: MediaItem): string {
  const baseDir = item.protected ? PROTECTED_MEDIA_DIR : MEDIA_DIR;
  return path.join(baseDir, item.fileName);
}
