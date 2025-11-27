import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MediaType } from './mediaStore';

export interface ShareRecord {
  id: string;                // stable share ID used everywhere
  mediaId: string;           // ID of the original media item
  recipient: string;         // username or email of recipient
  downloadable: boolean;     // whether recipient can download
  packageId: string;         // logical package/batch ID
  createdAt: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
  sender: string | null;     // username/email of sender (for UI)
  mediaTitle: string;        // copied from media at share time
  mediaType: MediaType;      // 'audio' | 'video' | 'image'
}

const SHARE_PATH = path.join(process.cwd(), 'shares.json');

/* -------------------------------------------------------
   Ensure shares.json exists
---------------------------------------------------------*/
async function ensureShareFile() {
  try {
    await fs.access(SHARE_PATH);
  } catch {
    await fs.writeFile(SHARE_PATH, '[]', 'utf8');
  }
}

/* -------------------------------------------------------
   Read shares.json raw
---------------------------------------------------------*/
async function getAllSharesRaw(): Promise<any[]> {
  await ensureShareFile();
  const raw = await fs.readFile(SHARE_PATH, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------
   Write shares.json
---------------------------------------------------------*/
async function saveAllShares(shares: ShareRecord[]) {
  await fs.writeFile(SHARE_PATH, JSON.stringify(shares, null, 2), 'utf8');
}

/* -------------------------------------------------------
   Normalize raw object → ShareRecord
   Handles older shapes { shareId, ... } or { id, ... }
---------------------------------------------------------*/
function normalizeShare(raw: any): ShareRecord {
  const id = raw.id ?? raw.shareId ?? randomUUID();

  return {
    id,
    mediaId: raw.mediaId,
    recipient: raw.recipient,
    downloadable: raw.downloadable ?? true,
    packageId: raw.packageId ?? `pkg_${raw.mediaId ?? id}`,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    acceptedAt: raw.acceptedAt ?? null,
    rejectedAt: raw.rejectedAt ?? null,
    sender: raw.sender ?? null,
    mediaTitle: raw.mediaTitle ?? raw.title ?? '(untitled)',
    mediaType: (raw.mediaType as MediaType) ?? 'audio',
  };
}

/* -------------------------------------------------------
   Get all normalized shares
---------------------------------------------------------*/
async function getAllSharesNormalized(): Promise<ShareRecord[]> {
  const rawList = await getAllSharesRaw();
  return rawList.map(normalizeShare);
}

/* -------------------------------------------------------
   Create a new share
---------------------------------------------------------*/
export async function createShare(input: {
  mediaId: string;
  recipient: string;
  downloadable: boolean;
  sender: string | null;
  mediaTitle: string;
  mediaType: MediaType;
}): Promise<ShareRecord> {
  const shares = await getAllSharesNormalized();

  const share: ShareRecord = {
    id: randomUUID(),
    mediaId: input.mediaId,
    recipient: input.recipient,
    downloadable: input.downloadable,
    packageId: `pkg_${input.mediaId}`,
    createdAt: new Date().toISOString(),
    acceptedAt: null,
    rejectedAt: null,
    sender: input.sender ?? null,
    mediaTitle: input.mediaTitle,
    mediaType: input.mediaType,
  };

  shares.push(share);
  await saveAllShares(shares);

  return share;
}

/* -------------------------------------------------------
   List shares for a given user
---------------------------------------------------------*/
export async function listSharesForRecipient(
  recipient: string
): Promise<ShareRecord[]> {
  const shares = await getAllSharesNormalized();
  return shares.filter((s) => s.recipient === recipient);
}

/* -------------------------------------------------------
   Get a specific share by ID
---------------------------------------------------------*/
export async function getShareById(id: string): Promise<ShareRecord | null> {
  const shares = await getAllSharesNormalized();
  return shares.find((s) => s.id === id) ?? null;
}

/* -------------------------------------------------------
   Mark share as accepted
---------------------------------------------------------*/
export async function markShareAccepted(
  id: string
): Promise<ShareRecord | null> {
  const shares = await getAllSharesNormalized();
  const idx = shares.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const updated: ShareRecord = {
    ...shares[idx],
    acceptedAt: new Date().toISOString(),
    rejectedAt: null,
  };

  shares[idx] = updated;
  await saveAllShares(shares);
  return updated;
}

/* -------------------------------------------------------
   Mark share as rejected (DISMISS)
---------------------------------------------------------*/
export async function markShareRejected(
  id: string
): Promise<ShareRecord | null> {
  const shares = await getAllSharesNormalized();
  const idx = shares.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const updated: ShareRecord = {
    ...shares[idx],
    rejectedAt: new Date().toISOString(),
    acceptedAt: null,
  };

  shares[idx] = updated;
  await saveAllShares(shares);
  return updated;
}
