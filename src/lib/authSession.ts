import { NextRequest } from 'next/server';
import { createHash, createHmac } from 'crypto';
import { getUserById, type User } from './userStore';

const SESSION_SECRET = process.env.ONESTAR_SESSION_KEY ?? 'onestar-dev-session';
const SESSION_COOKIE_NAME = 'onestar_session';
const SESSION_KEY = createHash('sha256').update(SESSION_SECRET).digest(); // 32 bytes

export interface SessionPayload {
  userId: string;
  iat: number;
}

export function createSessionToken(userId: string): string {
  const payloadObj: SessionPayload = { userId, iat: Date.now() };
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const signature = createHmac('sha256', SESSION_KEY)
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  const expectedSignature = createHmac('sha256', SESSION_KEY)
    .update(payload)
    .digest('base64url');

  if (signature !== expectedSignature) return null;

  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    return JSON.parse(json) as SessionPayload;
  } catch {
    return null;
  }
}

export async function getUserFromRequest(req: NextRequest): Promise<User | null> {
  // IMPORTANT: req.cookies.get returns { name, value }, not the value string
  const cookie = req.cookies.get(SESSION_COOKIE_NAME);
  if (!cookie?.value) return null;

  const session = verifySessionToken(cookie.value);
  if (!session) return null;

  return getUserById(session.userId);
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
