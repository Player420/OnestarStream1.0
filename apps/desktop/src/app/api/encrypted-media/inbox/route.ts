// src/app/api/encrypted-media/inbox/route.ts
// SECURITY: Server returns inbox entries with wrapped keys (NEVER unwraps)

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/authSession';
import { MediaInbox, MediaLicenses, initializeDB } from '@/lib/db';

/**
 * Get user's inbox (pending shares).
 */
export async function GET(req: NextRequest) {
  try {
    await initializeDB();
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const entries = await MediaInbox.listForUser(user.id);
    const unreadCount = await MediaInbox.getUnreadCount(user.id);

    // Enrich with license metadata
    const enriched = await Promise.all(
      entries.map(async (entry) => {
        const license = await MediaLicenses.get(entry.licenseId);
        return {
          ...entry,
          mediaTitle: license?.metadata.title,
          mimeType: license?.metadata.mimeType,
          ownerUserId: license?.ownerUserId,
        };
      })
    );

    return NextResponse.json(
      {
        ok: true,
        inbox: enriched,
        unreadCount,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[GET /api/encrypted-media/inbox] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to get inbox' },
      { status: 500 }
    );
  }
}

/**
 * Mark inbox entry as read.
 */
export async function PATCH(req: NextRequest) {
  try {
    await initializeDB();
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const body = await req.json();
    const { inboxEntryId, markAllAsRead } = body;

    if (!inboxEntryId && !markAllAsRead) {
      return NextResponse.json(
        { ok: false, error: 'Missing inboxEntryId or markAllAsRead' },
        { status: 400 }
      );
    }

    if (markAllAsRead) {
      await MediaInbox.markAllAsRead(user.id);
      return NextResponse.json(
        {
          ok: true,
          message: 'All inbox entries marked as read',
        },
        { status: 200 }
      );
    }

    // Verify entry belongs to user
    const entry = await MediaInbox.get(inboxEntryId);
    if (!entry || entry.userId !== user.id) {
      return NextResponse.json(
        { ok: false, error: 'Inbox entry not found' },
        { status: 404 }
      );
    }

    await MediaInbox.markAsRead(inboxEntryId);

    return NextResponse.json(
      {
        ok: true,
        inboxEntryId,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error('[PATCH /api/encrypted-media/inbox] error:', err);
    return NextResponse.json(
      { ok: false, error: 'Failed to update inbox status' },
      { status: 500 }
    );
  }
}
