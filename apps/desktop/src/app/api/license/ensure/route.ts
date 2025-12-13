// src/app/api/license/ensure/route.ts

import { NextRequest, NextResponse } from 'next/server';

const ADMIN_KEY = process.env.ONESTAR_ADMIN_KEY;
// Where to call the internal dev license issue endpoint.
// In dev and on your DO droplet, this will usually be the same host.
const INTERNAL_BASE =
  process.env.LICENSE_INTERNAL_BASE || 'http://127.0.0.1:3000';

export async function POST(req: NextRequest) {
  // If there is no admin key on this server, auto-issue is disabled.
  if (!ADMIN_KEY) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Automatic license activation is disabled on this server (missing ONESTAR_ADMIN_KEY).',
      },
      { status: 503 },
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

  const identifier = (body?.identifier ?? '').trim();
  if (!identifier) {
    return NextResponse.json(
      { ok: false, error: 'Missing identifier.' },
      { status: 400 },
    );
  }

  try {
    // Call your existing dev license issue endpoint on the same server.
    const res = await fetch(`${INTERNAL_BASE}/api/dev/license/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-key': ADMIN_KEY,
      },
      body: JSON.stringify({ identifier }),
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok || !data?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: data?.error || 'Failed to issue license.',
        },
        { status: 500 },
      );
    }

    // Normalize the response shape for the client wizard.
    return NextResponse.json({
      ok: true,
      identifier: data.identifier || identifier,
      licenseKey: data.licenseKey,
      licenseStatus: data.licenseStatus,
    });
  } catch (err) {
    console.error('Error in /api/license/ensure:', err);
    return NextResponse.json(
      { ok: false, error: 'Internal license service error.' },
      { status: 500 },
    );
  }
}

