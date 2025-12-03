// src/app/api/license/status/route.ts

import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

type LicenseStatus = 'none' | 'pending' | 'active' | 'revoked';

interface LicenseRecord {
  licenseKey: string;
  licenseStatus: LicenseStatus;
  updatedAt?: string;
}

type LicenseStore = Record<string, LicenseRecord>;

const LICENSES_FILE = path.join(process.cwd(), 'localdata', 'licenses.json');

async function readLicenseStore(): Promise<LicenseStore> {
  try {
    const data = await fs.readFile(LICENSES_FILE, 'utf8');
    const parsed = JSON.parse(data);
    // We expect an object keyed by identifier, but we guard anyway.
    if (parsed && typeof parsed === 'object') {
      return parsed as LicenseStore;
    }
    return {};
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      // File does not exist yet → treat as empty store
      return {};
    }
    throw err;
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const identifier = (url.searchParams.get('identifier') || '').trim();

    if (!identifier) {
      return NextResponse.json(
        {
          ok: true,
          status: 'none' as LicenseStatus,
        },
        { status: 200 },
      );
    }

    const store = await readLicenseStore();
    const record = store[identifier];

    if (!record) {
      return NextResponse.json(
        {
          ok: true,
          status: 'none' as LicenseStatus,
        },
        { status: 200 },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        status: (record.licenseStatus || 'none') as LicenseStatus,
        licenseKey: record.licenseKey,
        updatedAt: record.updatedAt,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in /api/license/status:', err);
    return NextResponse.json(
      {
        ok: false,
        status: 'none' as LicenseStatus,
        error: 'Failed to read license status.',
      },
      { status: 500 },
    );
  }
}
