// app/api/share/init/route.ts
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROOT_DIR = process.cwd();
// We'll keep share metadata in a simple JSON file for now.
// You can later replace this with ONESTARDB / encrypted store.
const SHARES_JSON_PATH = path.join(ROOT_DIR, 'shares.json');

interface AuthUser {
  id: string;
  email?: string;
}

// This is only metadata. No file bytes.
export interface MediaDescriptor {
  id: string;                 // local id on sender's device
  title: string;
  artist?: string;
  album?: string;
  durationSeconds?: number;
  sizeBytes?: number;
  mimeType?: string;
  fingerprint?: string;       // optional hash/fingerprint
  protected: boolean;
}

export type ShareStatus =
  | 'pending'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface ShareRecord {
  shareId: string;
  fromUserId: string;
  toUserId: string;
  media: MediaDescriptor;
  createdAt: string;
  status: ShareStatus;
}

// TODO: replace this with your real session/auth logic.
async function getAuthenticatedUser(req: NextRequest): Promise<AuthUser | null> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  if (!cookieHeader.includes('ONESTAR_SESSION=')) {
    return null;
  }

  // In your real app, you should parse ONESTAR_SESSION and look up the user.
  // For now we just treat the session token as the user id placeholder.
  const match = cookieHeader.match(/ONESTAR_SESSION=([^;]+)/);
  const userId = match?.[1] ?? 'onestar-user';

  return { id: userId };
}

function loadShares(): ShareRecord[] {
  if (!fs.existsSync(SHARES_JSON_PATH)) {
    return [];
  }

  const raw = fs.readFileSync(SHARES_JSON_PATH, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as ShareRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

function saveShares(shares: ShareRecord[]): void {
  fs.writeFileSync(SHARES_JSON_PATH, JSON.stringify(shares, null, 2), 'utf8');
}

export async function POST(req: NextRequest): Promise<Response> {
  const user = await getAuthenticatedUser(req);

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const body = await req.json().catch(() => null);
  if (!body) {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { toUserId, media } = body as {
    toUserId: string;
    media: MediaDescriptor;
  };

  if (!toUserId || !media || !media.id || !media.title) {
    return new Response(
      JSON.stringify({
        error: 'Missing required fields: toUserId, media.id, media.title',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const shareId = crypto.randomUUID();
  const shareRecord: ShareRecord = {
    shareId,
    fromUserId: user.id,
    toUserId,
    media,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };

  const shares = loadShares();
  shares.push(shareRecord);
  saveShares(shares);

  return new Response(JSON.stringify({ shareId, share: shareRecord }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
