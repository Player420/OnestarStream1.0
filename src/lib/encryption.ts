'use server';

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // For GCM, 12 bytes is recommended
const KEY_LENGTH = 32; // 256 bits

export function encryptMedia(buffer: Uint8Array, password: string): { encrypted: Buffer, iv: Buffer, authTag: Buffer } {
  const key = Buffer.from(password.padEnd(KEY_LENGTH, '0').slice(0, KEY_LENGTH), 'utf8');
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag };
}

export function decryptMedia(buffer: Uint8Array, password: string, iv: Buffer, authTag: Buffer): Buffer {
  const key = Buffer.from(password.padEnd(KEY_LENGTH, '0').slice(0, KEY_LENGTH), 'utf8');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(buffer), decipher.final()]);
}

export function createOnestarPackage(metadata: any, encryptedBytes: Uint8Array): Buffer {
  const packageData = {
    meta: metadata,
    contents: Buffer.from(encryptedBytes).toString('base64'),

};
  return Buffer.from(JSON.stringify(packageData), 'utf8');
}

export function parseOnestarPackage(buffer: ArrayBuffer): { meta: any, contents: Buffer } {
  const packageData = JSON.parse(Buffer.from(buffer).toString('utf8'));
  return {
    meta: packageData.meta,
    contents: Buffer.from(packageData.contents, 'base64'),
  };
}
