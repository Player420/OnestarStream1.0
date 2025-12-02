// src/lib/passwordResetStore.ts
import fs from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';

export interface PasswordResetRecord {
  token: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

const RESET_PATH = path.join(process.cwd(), 'password_resets.json');
const DEFAULT_TTL_MINUTES = 60;

/* -------------------------------------------------------
   File helpers
---------------------------------------------------------*/
async function ensureResetFile(): Promise<void> {
  try {
    await fs.access(RESET_PATH);
  } catch {
    await fs.writeFile(RESET_PATH, '[]', 'utf8');
  }
}

async function loadAllResets(): Promise<PasswordResetRecord[]> {
  await ensureResetFile();
  const raw = await fs.readFile(RESET_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(normalizeResetRecord);
    }
    return [];
  } catch {
    return [];
  }
}

async function saveAllResets(records: PasswordResetRecord[]): Promise<void> {
  await fs.writeFile(RESET_PATH, JSON.stringify(records, null, 2), 'utf8');
}

function normalizeResetRecord(raw: any): PasswordResetRecord {
  return {
    token: String(raw.token),
    userId: String(raw.userId),
    createdAt: raw.createdAt ?? new Date().toISOString(),
    expiresAt:
      raw.expiresAt ??
      new Date(
        Date.now() + DEFAULT_TTL_MINUTES * 60 * 1000
      ).toISOString(),
    usedAt: raw.usedAt ?? null,
  };
}

/* -------------------------------------------------------
   Public API
---------------------------------------------------------*/

/**
 * Create a reset token tied to a specific userId.
 * Tokens expire after ttlMinutes (default 60).
 */
export async function createResetTokenForUser(
  userId: string,
  ttlMinutes: number = DEFAULT_TTL_MINUTES
): Promise<string> {
  const records = await loadAllResets();
  const now = Date.now();
  const expiresAt = new Date(now + ttlMinutes * 60 * 1000).toISOString();

  const token = randomBytes(32).toString('hex');

  const record: PasswordResetRecord = {
    token,
    userId,
    createdAt: new Date(now).toISOString(),
    expiresAt,
    usedAt: null,
  };

  records.push(record);
  await saveAllResets(records);

  return token;
}

/**
 * Find a token that is not used and not expired.
 */
export async function findValidResetToken(
  token: string
): Promise<PasswordResetRecord | null> {
  const records = await loadAllResets();
  const now = Date.now();

  const rec = records.find((r) => r.token === token);
  if (!rec) return null;

  if (rec.usedAt) return null;
  if (new Date(rec.expiresAt).getTime() < now) return null;

  return rec;
}

/**
 * Mark a token as used if it is valid (not used, not expired).
 * Returns the updated record or null if invalid.
 */
export async function consumeResetToken(
  token: string
): Promise<PasswordResetRecord | null> {
  const records = await loadAllResets();
  const now = Date.now();

  const idx = records.findIndex((r) => r.token === token);
  if (idx === -1) return null;

  const rec = records[idx];

  if (rec.usedAt) return null;
  if (new Date(rec.expiresAt).getTime() < now) return null;

  const updated: PasswordResetRecord = {
    ...rec,
    usedAt: new Date(now).toISOString(),
  };

  records[idx] = updated;
  await saveAllResets(records);

  return updated;
}

/**
 * Optional: cleanup helper to remove expired & used tokens.
 * Not called by the main flow, but safe to use from a cron/job.
 */
export async function pruneExpiredTokens(): Promise<number> {
  const records = await loadAllResets();
  const now = Date.now();

  const kept: PasswordResetRecord[] = [];
  let removed = 0;

  for (const rec of records) {
    const expired = new Date(rec.expiresAt).getTime() < now;
    const used = !!rec.usedAt;

    if (expired || used) {
      removed += 1;
      continue;
    }
    kept.push(rec);
  }

  if (removed > 0) {
    await saveAllResets(kept);
  }

  return removed;
}
