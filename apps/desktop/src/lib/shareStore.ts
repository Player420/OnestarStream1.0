// src/lib/shareStore.ts
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MediaType } from './mediaStore';

export interface ShareRecord {
  shareId: string;
  mediaId: string;
  recipient: string;
  downloadable: boolean;
  packageId: string;
  createdAt: string;
  acceptedAt: string | null;
  rejectedAt?: string | null;
  sender: string | null;
  mediaTitle?: string | null;
  mediaType?: MediaType | null;
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
---------------------------------------------------------*/
function normalizeShare(raw: any): ShareRecord {
  return {
    shareId: raw.shareId ?? raw.id ?? randomUUID(),
    mediaId: raw.mediaId,
    recipient: raw.recipient,
    downloadable: raw.downloadable ?? true,
    packageId: raw.packageId ?? `pkg_${raw.mediaId}`,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    acceptedAt: raw.acceptedAt ?? null,
    rejectedAt: raw.rejectedAt ?? null,
    sender: raw.sender ?? null,
    mediaTitle: raw.mediaTitle ?? null,
    mediaType: (raw.mediaType as MediaType | null) ?? null,
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
  mediaTitle?: string | null;
  mediaType?: MediaType | null;
}): Promise<ShareRecord> {
  const shares = await getAllSharesNormalized();

  const share: ShareRecord = {
    shareId: randomUUID(),
    mediaId: input.mediaId,
    recipient: input.recipient,
    downloadable: input.downloadable,
    packageId: `pkg_${input.mediaId}`,
    createdAt: new Date().toISOString(),
    acceptedAt: null,
    rejectedAt: null,
    sender: input.sender ?? null,
    mediaTitle: input.mediaTitle ?? null,
    mediaType: input.mediaType ?? null,
  };

  shares.push(share);
  await saveAllShares(shares);

  return share;
}

/* -------------------------------------------------------
   List shares for a given user (only pending, non-zombie)
---------------------------------------------------------*/
export async function listSharesForRecipient(
  recipient: string
): Promise<ShareRecord[]> {
  const shares = await getAllSharesNormalized();

  return shares.filter(
    (s) =>
      s.recipient === recipient &&
      !s.acceptedAt &&
      !s.rejectedAt &&
      !!s.mediaId // ignore totally corrupt rows
  );
}

/* -------------------------------------------------------
   Get a specific share by ID
---------------------------------------------------------*/
export async function getShareById(
  shareId: string
): Promise<ShareRecord | null> {
  const shares = await getAllSharesNormalized();
  return shares.find((s) => s.shareId === shareId) ?? null;
}

/* -------------------------------------------------------
   Mark share as accepted
---------------------------------------------------------*/
export async function markShareAccepted(
  shareId: string
): Promise<ShareRecord | null> {
  const shares = await getAllSharesNormalized();
  const idx = shares.findIndex((s) => s.shareId === shareId);
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
   Mark share as rejected (dismiss)
---------------------------------------------------------*/
export async function markShareRejected(
  shareId: string
): Promise<ShareRecord | null> {
  const shares = await getAllSharesNormalized();
  const idx = shares.findIndex((s) => s.shareId === shareId);
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

/* -------------------------------------------------------
   HARD DELETE shares by mediaId + recipient
   (used to nuke legacy/zombie rows with bad IDs)
---------------------------------------------------------*/
export async function deleteSharesForMediaAndRecipient(
  mediaId: string,
  recipient: string
): Promise<number> {
  const shares = await getAllSharesNormalized();

  const kept: ShareRecord[] = [];
  let removed = 0;

  for (const s of shares) {
    const isZombieCandidate =
      s.mediaId === mediaId &&
      s.recipient === recipient &&
      !s.acceptedAt &&
      !s.rejectedAt;

    if (isZombieCandidate) {
      removed += 1;
      continue;
    }
    kept.push(s);
  }

  if (removed > 0) {
    await saveAllShares(kept);
  }

  return removed;
}

/* -------------------------------------------------------
   HARD DELETE a single share by shareId
---------------------------------------------------------*/
export async function deleteShareById(
  shareId: string
): Promise<ShareRecord | null> {
  const shares = await getAllSharesNormalized();

  const index = shares.findIndex((s) => s.shareId === shareId);
  if (index === -1) {
    return null;
  }

  const [deleted] = shares.splice(index, 1);
  await saveAllShares(shares);

  return deleted ?? null;
}

