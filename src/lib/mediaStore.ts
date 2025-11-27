import fs from 'fs/promises';
import path from 'path';
import crypto, { randomUUID } from 'crypto';

export type MediaType = 'audio' | 'video' | 'image';

export interface MediaItem {
  id: string;
  ownerId: string;          // NEW: which user owns this media
  title: string;
  fileName: string;
  type: MediaType;
  sizeBytes: number;
  createdAt: string;
  protected: boolean;
}

const MEDIA_DIR = path.join(process.cwd(), 'public', 'media');
const PROTECTED_MEDIA_DIR = path.join(process.cwd(), 'secure_media');
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

/**
 * Load and normalize all media entries.
 * Old entries (from before ownerId) get ownerId = 'legacy-global'
 * so we can keep them distinct and ignore them in per-user views.
 */
export async function getAllMedia(): Promise<MediaItem[]> {
  await ensureSetup();
  const raw = await fs.readFile(META_PATH, 'utf8');

  let items: any[] = [];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }

  return items.map((item: any) => {
    const ownerId =
      typeof item.ownerId === 'string' && item.ownerId.length > 0
        ? item.ownerId
        : 'legacy-global';

    const mediaType: MediaType =
      item.type === 'video' || item.type === 'image' ? item.type : 'audio';

    return {
      id: item.id ?? randomUUID(),
      ownerId,
      title: item.title ?? '',
      fileName: item.fileName,
      type: mediaType,
      sizeBytes: typeof item.sizeBytes === 'number' ? item.sizeBytes : 0,
      createdAt: item.createdAt ?? new Date().toISOString(),
      protected: item.protected ?? false,
    } satisfies MediaItem;
  });
}

async function saveAllMedia(items: MediaItem[]) {
  await fs.writeFile(META_PATH, JSON.stringify(items, null, 2), 'utf8');
}

interface AddMediaInput {
  ownerId: string;       // NEW: who owns this media
  title: string;
  type: MediaType;
  sizeBytes: number;
  originalName: string;
  contents: Buffer;
}

/**
 * Symmetric key for media encryption (protected files).
 * Uses ONESTAR_KEY from env or a fixed dev default.
 */
function getKey(): Buffer {
  // 32-byte key for AES-256-GCM.
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
  // Layout: [IV(16)][authTag(16)][ciphertext]
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

// Export decryptBuffer if you need it in /api/protected-stream
export { decryptBufferInternal as decryptBuffer };

/**
 * Add a new media item, optionally protected (encrypted),
 * and associate it with a specific ownerId.
 */
export async function addMedia(
  input: AddMediaInput & { protected?: boolean }
): Promise<MediaItem> {
  await ensureSetup();
  const items = await getAllMedia();

  const id = randomUUID();
  const ext = path.extname(input.originalName) || '';
  const fileName = `${id}${ext}`;
  let newItem: MediaItem;

  const isProtected = !!input.protected;

  if (isProtected) {
    // Protected: encrypt and store in secure_media as .bin
    const encryptedContents = encryptBuffer(input.contents);
    const secureFileName = `${id}.bin`;
    const filePath = path.join(PROTECTED_MEDIA_DIR, secureFileName);

    await fs.writeFile(filePath, encryptedContents);

    newItem = {
      id,
      ownerId: input.ownerId,
      title: input.title,
      fileName: secureFileName,
      type: input.type,
      sizeBytes: input.sizeBytes,
      createdAt: new Date().toISOString(),
      protected: true,
    };
  } else {
    // Non-protected: store plain in public/media
    const filePath = path.join(MEDIA_DIR, fileName);
    await fs.writeFile(filePath, input.contents);

    newItem = {
      id,
      ownerId: input.ownerId,
      title: input.title,
      fileName,
      type: input.type,
      sizeBytes: input.sizeBytes,
      createdAt: new Date().toISOString(),
      protected: false,
    };
  }

  items.push(newItem);
  await saveAllMedia(items);

  return newItem;
}

/**
 * Delete a media item by id.
 * (Caller should ensure only the owner can trigger this.)
 */
export async function deleteMedia(id: string): Promise<boolean> {
  await ensureSetup();
  const items = await getAllMedia();
  const index = items.findIndex((i) => i.id === id);

  if (index === -1) {
    return false;
  }

  const [deletedItem] = items.splice(index, 1);
  await saveAllMedia(items);

  // Choose correct base directory depending on protected flag
  const baseDir = deletedItem.protected ? PROTECTED_MEDIA_DIR : MEDIA_DIR;
  const filePath = path.join(baseDir, deletedItem.fileName);

  try {
    await fs.unlink(filePath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  return true;
}

/**
 * Get a single media item by id (any owner).
 */
export async function getMediaById(id: string): Promise<MediaItem | null> {
  const items = await getAllMedia();
  return items.find((i) => i.id === id) ?? null;
}

/**
 * Get all media items belonging to a specific user.
 */
export async function getMediaForUser(ownerId: string): Promise<MediaItem[]> {
  const items = await getAllMedia();
  return items.filter((i) => i.ownerId === ownerId);
}

/**
 * Resolve the on-disk path to a media file.
 */
export function getMediaFilePath(item: MediaItem): string {
  const baseDir = item.protected ? PROTECTED_MEDIA_DIR : MEDIA_DIR;
  return path.join(baseDir, item.fileName);
}
