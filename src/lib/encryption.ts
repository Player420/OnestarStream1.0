'use server';

import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // For GCM, 12 bytes is recommended
const KEY_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 recommendation
const SALT_LENGTH = 16;

export function encryptMedia(
  buffer: Uint8Array,
  password: string
): { encrypted: Buffer; iv: Buffer; authTag: Buffer; salt: Buffer } {
  const salt = randomBytes(SALT_LENGTH);
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag, salt };
}

export function decryptMedia(
  buffer: Uint8Array,
  password: string,
  iv: Buffer,
  authTag: Buffer,
  salt: Buffer
): Buffer {
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha512');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

export function createOnestarPackage(
  metadata: any,
  encryptedBytes: Uint8Array
): Buffer {
  // encryptedBytes is a Uint8Array; convert to a Buffer before base64 encoding
  const contentsBase64 = Buffer.from(encryptedBytes).toString('base64');

  const packageData = {
    meta: metadata,
    contents: contentsBase64,
  };

  return Buffer.from(JSON.stringify(packageData), 'utf8');
}

export function parseOnestarPackage(
  buffer: ArrayBuffer
): { meta: any; contents: Buffer } {
  const packageData = JSON.parse(Buffer.from(buffer).toString('utf8'));
  return {
    meta: packageData.meta,
    contents: Buffer.from(packageData.contents, 'base64'),
  };
}
