import { NextRequest } from "next/server";
import { createHash, createHmac } from "crypto";
import { getUserById, type User } from "./userStore";

/**
 * ============================================================
 * SESSION SECRET
 * ============================================================
 * MUST exist in .env.local
 * Example:
 *   ONESTAR_SESSION_KEY=5c8e75d0f7c43382a1c9cc70c0dcd3d9...
 *
 * If this key changes:
 *   - ALL sessions become invalid
 *   - Existing cookies cannot be verified
 */
const RAW_SECRET = process.env.ONESTAR_SESSION_KEY;

if (!RAW_SECRET || RAW_SECRET.length < 32) {
  console.warn(
    "[authSession] WARNING: Your ONESTAR_SESSION_KEY is missing or too weak. " +
      "Use at least a 32+ byte hex string. All sessions depend on this being stable."
  );
}

/**
 * Derive an HMAC key from the secret.
 * This ensures a consistent 32-byte signing key:
 */
const SESSION_KEY = createHash("sha256")
  .update(RAW_SECRET ?? "onestar-dev-session-fallback-do-not-use-in-prod")
  .digest();

/**
 * Name of our HttpOnly cookie
 */
const SESSION_COOKIE_NAME = "onestar_session";

/**
 * Payload stored in the JWT-style signed token.
 */
export interface SessionPayload {
  userId: string;
  iat: number; // issued-at timestamp (ms)
}

/**
 * ============================================================
 * createSessionToken(userId)
 * ============================================================
 * Returns a token like:
 *   base64(payload).base64(signature)
 */
export function createSessionToken(userId: string): string {
  const payloadObj: SessionPayload = {
    userId,
    iat: Date.now(),
  };

  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");

  const signature = createHmac("sha256", SESSION_KEY)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

/**
 * ============================================================
 * verifySessionToken(token)
 * ============================================================
 * - Validates the signature
 * - Validates expiration
 * - Parses the payload safely
 */
export function verifySessionToken(token: string): SessionPayload | null {
  if (!token || !token.includes(".")) return null;

  const [payload, signature] = token.split(".");

  const expectedSig = createHmac("sha256", SESSION_KEY)
    .update(payload)
    .digest("base64url");

  if (expectedSig !== signature) {
    return null;
  }

  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const data = JSON.parse(json) as SessionPayload;

    // Enforce an 8-hour session lifetime
    const MAX_AGE_MS = 1000 * 60 * 60 * 8;
    if (Date.now() - data.iat > MAX_AGE_MS) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
}

/**
 * ============================================================
 * getUserFromRequest(req)
 * ============================================================
 * - Reads the session cookie
 * - Validates & decodes token
 * - Loads User object
 */
export async function getUserFromRequest(
  req: NextRequest
): Promise<User | null> {
  const raw = req.cookies.get(SESSION_COOKIE_NAME);
  if (!raw?.value) return null;

  const session = verifySessionToken(raw.value);
  if (!session) return null;

  return getUserById(session.userId);
}

/**
 * Simple export to keep the cookie name consistent.
 */
export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}
