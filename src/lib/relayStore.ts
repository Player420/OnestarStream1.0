'use server';

import fs from 'fs/promises';
import path from 'path';

const RELAY_OUTBOX_DIR = path.join(process.cwd(), 'localdata', 'relay_outbox');
const RELAY_INBOX_DIR = path.join(process.cwd(), 'localdata', 'relay_inbox');
const METADATA_DIR = path.join(process.cwd(), 'localdata', 'metadata');

async function ensureDirectories() {
  await fs.mkdir(RELAY_OUTBOX_DIR, { recursive: true });
  await fs.mkdir(RELAY_INBOX_DIR, { recursive: true });
  await fs.mkdir(METADATA_DIR, { recursive: true });
}

export async function uploadEncryptedTrack(id: string, encrypted: Uint8Array) {
  await ensureDirectories();
  const filePath = path.join(RELAY_OUTBOX_DIR, `${id}.onestar`);
  await fs.writeFile(filePath, encrypted);
}

export async function downloadEncryptedTrack(id: string): Promise<Buffer | null> {
  await ensureDirectories();
  const filePath = path.join(RELAY_INBOX_DIR, `${id}.onestar`);
  try {
    return await fs.readFile(filePath);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

export async function saveMetadata(id: string, metadata: any) {
  await ensureDirectories();
  const filePath = path.join(METADATA_DIR, `${id}.json`);
  await fs.writeFile(filePath, JSON.stringify(metadata, null, 2));
}

export async function loadMetadata(id: string): Promise<object | null> {
  await ensureDirectories();
  const filePath = path.join(METADATA_DIR, `${id}.json`);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}
