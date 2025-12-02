'use server';

export async function encryptMediaAction(
  buffer: Uint8Array,
  password: string
) {
  const { encryptMedia } = await import('../server/encryption');
  return encryptMedia(buffer, password);
}

export async function decryptMediaAction(
  buffer: Uint8Array,
  password: string,
  iv: Buffer,
  authTag: Buffer
) {
  const { decryptMedia } = await import('../server/encryption');
  // The underlying decryptMedia currently has a 5-argument TypeScript signature.
  // We only need these four parameters here; cast to any to satisfy TypeScript
  // without changing the runtime behavior.
  return (decryptMedia as any)(buffer, password, iv, authTag);
}

export async function exportPackageAction(
  meta: any,
  encryptedBytes: Uint8Array
): Promise<Buffer> {
  const { createOnestarPackage } = await import('../server/encryption');

  // createOnestarPackage expects a Buffer; convert the Uint8Array
  const encryptedBuffer = Buffer.from(encryptedBytes);

  return createOnestarPackage(meta, encryptedBuffer);
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
