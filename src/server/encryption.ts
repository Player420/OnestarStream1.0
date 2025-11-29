import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// AES-256-GCM parameters
const ALGO = 'aes-256-gcm';
const PBKDF2_ITER = 100_000;
const KEY_LEN = 32;
const SALT_LEN = 16;

/**
 * Derive an AES key from password.
 */
async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, PBKDF2_ITER, KEY_LEN, 'sha512', (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/**
 * Encrypt a media buffer with AES-256-GCM.
 */
export async function encryptMedia(data: Uint8Array, password: string) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await deriveKey(password, salt);

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);

  const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag, salt };
}

/**
 * Decrypt media using AES-256-GCM.
 */
export async function decryptMedia(
  encrypted: Buffer,
  password: string,
  iv: Buffer,
  authTag: Buffer,
  salt: Buffer
) {
  const key = await deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

/**
 * Wrap encrypted media + metadata into a single .onestar binary package.
 */
export function createOnestarPackage(meta: object, encryptedBytes: Buffer): Buffer {
  const metaStr = JSON.stringify(meta);
  const metaLen = Buffer.byteLength(metaStr);

  const header = Buffer.alloc(4);
  header.writeUInt32BE(metaLen, 0);

  return Buffer.concat([header, Buffer.from(metaStr), encryptedBytes]);
}

/**
 * Parse a .onestar package buffer.
 */
export function parseOnestarPackage(buffer: ArrayBuffer | SharedArrayBuffer): {
  meta: any;
  contents: Buffer;
} {
  const buf = Buffer.from(buffer);
  const metaLen = buf.readUInt32BE(0);

  const metaStr = buf.subarray(4, 4 + metaLen).toString();
  const meta = JSON.parse(metaStr);

  const contents = buf.subarray(4 + metaLen);

  return { meta, contents };
}
