'use server';

export async function encryptMediaAction(
  buffer: Uint8Array,
  password: string
) {
  const { encryptMedia } = await import('../server/encryption');
  // encryptMedia already accepts Uint8Array in your implementation
  return encryptMedia(buffer, password);
}

/**
 * Decrypt media using the same parameters as ../server/encryption.decryptMedia:
 *   decryptMedia(encrypted: Buffer, password: string, iv: Buffer, authTag: Buffer, salt: Buffer)
 *
 * We accept encrypted bytes as Uint8Array (from the client) and convert to Buffer here.
 */
export async function decryptMediaAction(
  encryptedBytes: Uint8Array,
  password: string,
  iv: Buffer,
  authTag: Buffer,
  salt: Buffer
) {
  const { decryptMedia } = await import('../server/encryption');
  // Ensure we pass a Buffer to the decryption function
  return decryptMedia(Buffer.from(encryptedBytes), password, iv, authTag, salt);
}

/**
 * Wrap encrypted media + metadata into a single .onestar package.
 * createOnestarPackage(meta: object, encryptedBytes: Buffer): Buffer
 *
 * We accept Uint8Array and convert to Buffer before calling.
 */
export async function exportPackageAction(
  meta: any,
  encryptedBytes: Uint8Array
): Promise<Buffer> {
  const { createOnestarPackage } = await import('../server/encryption');
  return createOnestarPackage(meta, Buffer.from(encryptedBytes));
}

export async function importPackageAction(
  buffer: ArrayBuffer
): Promise<{ meta: any; contents: Buffer }> {
  const { parseOnestarPackage } = await import('../server/encryption');
  return parseOnestarPackage(buffer);
}

export async function uploadEncryptedTrackAction(
  id: string,
  encrypted: Uint8Array
) {
  const { uploadEncryptedTrack } = await import('../server/relayStore');
  return uploadEncryptedTrack(id, encrypted);
}

export async function downloadEncryptedTrackAction(
  id: string
): Promise<Buffer | null> {
  const { downloadEncryptedTrack } = await import('../server/relayStore');
  return downloadEncryptedTrack(id);
}

export async function saveMetadataAction(id: string, metadata: any) {
  const { saveMetadata } = await import('../server/relayStore');
  return saveMetadata(id, metadata);
}

export async function loadMetadataAction(
  id: string
): Promise<object | null> {
  const { loadMetadata } = await import('../server/relayStore');
  return loadMetadata(id);
}
