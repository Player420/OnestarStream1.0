// src/server/accept.ts

import { parseOnestarPackage, decryptMedia } from './encryption';
import { addMedia, MediaType } from '../lib/mediaStore';
import { downloadEncryptedTrack } from './relayStore';

export interface OnestarPackageMetaV1 {
  version: 1;
  cipher: 'aes-256-gcm';
  kdf: 'pbkdf2';
  // crypto params encoded as base64 so meta is JSON-safe
  saltB64: string;
  ivB64: string;
  authTagB64: string;
  // basic file info
  fileName: string;
  type: MediaType;
  sizeBytes: number;
  createdAt: string;
  title?: string;
  // later: sender, album, multi-file layouts, etc.
}

export interface AcceptOptions {
  /**
   * If true, recipient is allowed to download/export a plain file from their app.
   * If false, we keep it “protected / play-only” in the local protected store.
   */
  downloadable: boolean;
}

/**
 * Accept a shared Onestar package:
 *  - Fetch encrypted package from relay (opaque blob)
 *  - Parse header + metadata
 *  - Decrypt with recipient’s password
 *  - Store into local media library (protected vs public)
 *  - Return the new MediaItem (so UI can refresh Library/Inbox)
 */
export async function acceptSharedPackage(
  packageId: string,
  password: string,
  options: AcceptOptions
) {
  // 1. Download the encrypted package from relay.
  //    Relay treats this as an opaque blob; no plaintext on relay.
  const pkgBuffer = await downloadEncryptedTrack(packageId);
  if (!pkgBuffer) {
    throw new Error('Package not found on relay for id: ' + packageId);
  }

  // 2. Parse Onestar package:
  //    Layout = [4-byte metaLen][meta JSON][ciphertext]
  const arrayBufferView = pkgBuffer.buffer.slice(
    pkgBuffer.byteOffset,
    pkgBuffer.byteOffset + pkgBuffer.byteLength
  ) as ArrayBuffer;

  const { meta, contents } = parseOnestarPackage(arrayBufferView) as {
    meta: OnestarPackageMetaV1;
    contents: Buffer;
  };

  if (meta.version !== 1) {
    throw new Error('Unsupported Onestar package version: ' + meta.version);
  }

  // 3. Decode crypto parameters from base64
  const salt = Buffer.from(meta.saltB64, 'base64');
  const iv = Buffer.from(meta.ivB64, 'base64');
  const authTag = Buffer.from(meta.authTagB64, 'base64');

  // 4. Decrypt ciphertext into raw media bytes
  const decrypted = await decryptMedia(contents, password, iv, authTag, salt);

  // 5. Decide whether to keep this as protected vs downloadable in local library.
  const protectedFlag = !options.downloadable;

  // Generate a unique license ID for the accepted share
  const { randomUUID } = await import('crypto');
  const licenseId = `license-${randomUUID()}`;

  // 6. Register in local library.
  //    This uses your existing mediaStore logic and writes to:
  //      - PROTECTED_MEDIA_DIR when protectedFlag === true
  //      - MEDIA_DIR when protectedFlag === false
  const newItem = await addMedia({
    title: meta.title ?? meta.fileName,
    type: meta.type,
    sizeBytes: decrypted.byteLength,
    originalName: meta.fileName,
    contents: decrypted,
    protected: protectedFlag,
    licenseId,
  });

  return newItem;
}

