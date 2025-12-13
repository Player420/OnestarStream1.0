// src/app/api/dev/license/revoke/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

type LicenseStatus = 'none' | 'pending' | 'active' | 'revoked';

interface LicenseRecord {
  identifier: string;
  licenseKey: string;
  status: LicenseStatus;
  updatedAt: string;
}

interface LicenseStore {
  [identifier: string]: LicenseRecord;
}

const LICENSE_FILE_PATH = path.join(process.cwd(), 'localdata', 'licenses.json');

// --- Helpers (shared logic, kept duplicated here for simplicity) ---

async function ensureLicenseStore(): Promise<LicenseStore> {
  try {
    const raw = await fs.readFile(LICENSE_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as LicenseStore;
    }
    return {};
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return {};
    }
    console.error('Error reading license store:', err);
    throw err;
  }
}

async function saveLicenseStore(store: LicenseStore): Promise<void> {
  const dir = path.dirname(LICENSE_FILE_PATH);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    LICENSE_FILE_PATH,
    JSON.stringify(store, null, 2),
    'utf8',
  );
}

async function revokeLicense(identifier: string): Promise<LicenseRecord | null> {
  const store = await ensureLicenseStore();
  const existing = store[identifier];

  if (!existing) {
    return null;
  }

  const updated: LicenseRecord = {
    ...existing,
    status: 'revoked',
    updatedAt: new Date().toISOString(),
  };

  store[identifier] = updated;
  await saveLicenseStore(store);

  return updated;
}

// --- Route ---

export async function POST(req: NextRequest) {
  const adminKeyHeader = req.headers.get('x-admin-key');
  const expectedKey = process.env.ONESTAR_ADMIN_KEY;

  if (!expectedKey) {
    console.error(
      'ONESTAR_ADMIN_KEY is not set in environment. Refusing to revoke license.',
    );
    return NextResponse.json(
      { ok: false, error: 'Admin key not configured on server.' },
      { status: 500 },
    );
  }

  if (!adminKeyHeader || adminKeyHeader !== expectedKey) {
    return NextResponse.json(
      { ok: false, error: 'Unauthorized: invalid admin key.' },
      { status: 401 },
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body.' },
      { status: 400 },
    );
  }

  const identifier = (body?.identifier || '').trim();

  if (!identifier) {
    return NextResponse.json(
      { ok: false, error: 'Missing "identifier" (email or username).' },
      { status: 400 },
    );
  }

  try {
    const record = await revokeLicense(identifier);

    if (!record) {
      return NextResponse.json(
        {
          ok: false,
          error: 'License not found for provided identifier.',
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      ok: true,
      identifier: record.identifier,
      licenseKey: record.licenseKey,
      licenseStatus: record.status,
      updatedAt: record.updatedAt,
    });
  } catch (err) {
    console.error('Error revoking license:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to revoke license.' },
      { status: 500 },
    );
  }
}
