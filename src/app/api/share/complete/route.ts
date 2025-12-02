// app/api/share/complete/route.ts
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROOT_DIR = process.cwd();
const SHARES_JSON_PATH = path.join(ROOT_DIR, 'shares.json');

interface AuthUser {
  id: string;
  email?: string;
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
  media: unknown; // we don’t need full typing here for status updates
  createdAt: string;
  status: ShareStatus;
}

async function getAuthenticatedUser(req: NextRequest): Promise<AuthUser | null> {
  const cookieHeader = req.headers.get('cookie') ?? '';
  if (!cookieHeader.includes('ONESTAR_SESSION=')) {
    return null;
  }

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

  const { shareId, status } = body as {
    shareId: string;
    status: ShareStatus;
  };

  if (!shareId || !status) {
    return new Response(
      JSON.stringify({ error: 'Missing shareId or status' }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }

  const shares = loadShares();
  const idx = shares.findIndex((s) => s.shareId === shareId);

  if (idx === -1) {
    return new Response(JSON.stringify({ error: 'Share not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const share = shares[idx];

  // Only sender or receiver can update the status
  if (share.fromUserId !== user.id && share.toUserId !== user.id) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  share.status = status;
  shares[idx] = share;
  saveShares(shares);

  return new Response(JSON.stringify({ ok: true, share }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
