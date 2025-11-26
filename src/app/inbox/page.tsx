'use client';

import { useEffect, useState } from 'react';
import { CurrentUserBadge } from '@/components/CurrentUserBadge';

type MediaType = 'audio' | 'video' | 'image';

interface ShareRecord {
  id: string;
  mediaId: string;
  packageId: string;
  sender: string | null;
  recipient: string;
  downloadable: boolean;
  mediaTitle: string;
  mediaType: MediaType;
  createdAt: string;
  status: 'pending' | 'accepted' | 'rejected';
}

interface MeResponse {
  authenticated: boolean;
  user: {
    id: string;
    email: string;
    username: string;
    createdAt: string;
  } | null;
}

export default function InboxPage() {
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loadingUser, setLoadingUser] = useState(true);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [currentRecipient, setCurrentRecipient] = useState<string | null>(null);

  // Load logged-in user & inbox
  useEffect(() => {
    async function init() {
      setError(null);
      setStatusMsg(null);
      setShares([]);
      setLoadingUser(true);

      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) {
          setError('Could not determine current user. Please sign in again.');
          return;
        }

        const data: MeResponse = await res.json();

        if (!data.authenticated || !data.user) {
          setError('You are not signed in. Go to Sign in to view your inbox.');
          return;
        }

        const recipientAddress = data.user.username || data.user.email;
        setCurrentRecipient(recipientAddress);

        await loadInboxForRecipient(recipientAddress);
      } catch (err) {
        console.error('Error loading current user for inbox:', err);
        setError('Failed to load your inbox. Please try again.');
      } finally {
        setLoadingUser(false);
      }
    }

    async function loadInboxForRecipient(recipient: string) {
      setLoadingInbox(true);
      setShares([]);

      try {
        const res = await fetch(
          `/api/inbox?recipient=${encodeURIComponent(recipient)}`,
          { cache: 'no-store' }
        );
        const data = await res.json();

        if (!res.ok || !data.ok) {
          setError(data.error || 'Failed to load inbox.');
          return;
        }

        const list = (data.shares as ShareRecord[]) || [];
        setShares(list);
        if (list.length === 0) {
          setStatusMsg('No pending shares for your account yet.');
        }
      } catch (err) {
        console.error('Error loading inbox:', err);
        setError('Failed to load inbox.');
      } finally {
        setLoadingInbox(false);
      }
    }

    void init();
  }, []);

  // Accept handler
  async function handleAccept(share: ShareRecord) {
    setError(null);
    setStatusMsg(null);
    setAcceptingId(share.id);

    try {
      const res = await fetch('/api/inbox/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          packageId: share.packageId,
          shareId: share.id,
          downloadable: share.downloadable,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error || 'Failed to accept share.');
        return;
      }

      setShares((prev) => prev.filter((s) => s.id !== share.id));
      setStatusMsg(`Accepted "${share.mediaTitle || '(untitled)'}". It is now in your library.`);
    } catch (err) {
      console.error('Error accepting share:', err);
      setError('Failed to accept share.');
    } finally {
      setAcceptingId(null);
    }
  }

  // Dismiss handler
  async function handleDismiss(share: ShareRecord) {
    setError(null);
    setStatusMsg(null);
    setDismissId(share.id);

    try {
      const res = await fetch('/api/inbox/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shareId: share.id }),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error || 'Failed to dismiss share.');
        return;
      }

      setShares((prev) => prev.filter((s) => s.id !== share.id));
    } catch (err) {
      console.error('Error dismissing share:', err);
      setError('Failed to dismiss share.');
    } finally {
      setDismissId(null);
    }
  }

  const loading = loadingUser || loadingInbox;

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
      {/* HEADER */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ marginBottom: 4 }}>OnestarStream</h1>
          <p style={{ opacity: 0.7 }}>Inbox – tracks shared with you</p>
        </div>

        <nav style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/app">Player</a>
          <a href="/upload">Upload</a>
          <a href="/library">Library</a>
          <a href="/inbox">Inbox</a>
          <CurrentUserBadge />
        </nav>
      </header>

      {/* STATUS PANEL */}
      <section
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        {currentRecipient && (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
            Viewing inbox for <strong>{currentRecipient}</strong>.
          </p>
        )}
        {error && <p style={{ marginTop: 8, fontSize: 12, color: '#b00020' }}>{error}</p>}
        {statusMsg && !error && <p style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>{statusMsg}</p>}
      </section>

      {/* LIST */}
      <section>
        {loading && <p style={{ opacity: 0.7 }}>Loading your inbox…</p>}

        {!loading && !error && shares.length === 0 && (
          <p style={{ opacity: 0.7 }}>
            No pending shares for your account yet. When someone shares a track with you, it will show up here.
          </p>
        )}

        {!loading && shares.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {shares.map((share) => (
              <div
                key={`${share.id}-${share.packageId}-${share.createdAt}`}
                style={{
                  border: '1px solid #ddd',
                  borderRadius: 8,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                {/* TITLE + BUTTONS */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div>
                    <h2 style={{ margin: 0, fontSize: 16 }}>
                      {share.mediaTitle || '(untitled)'}
                    </h2>
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        opacity: 0.7,
                      }}
                    >
                      From: {share.sender ?? 'Unknown'}
                    </p>
                  </div>

                  {/* BUTTON ROW */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {/* Accept (unchanged) */}
                    <button
                      type="button"
                      onClick={() => handleAccept(share)}
                      disabled={acceptingId === share.id}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 4,
                        border: '1px solid #333',
                        background: '#222',
                        color: 'white',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {acceptingId === share.id ? 'Accepting…' : 'Accept'}
                    </button>

                    {/* Dismiss (identical styling) */}
                    <button
                      type="button"
                      onClick={() => handleDismiss(share)}
                      disabled={dismissId === share.id}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 4,
                        border: '1px solid #333',
                        background: '#222',
                        color: 'white',
                        fontSize: 12,
                        cursor: 'pointer',
                      }}
                    >
                      {dismissId === share.id ? 'Dismissing…' : 'Dismiss'}
                    </button>
                  </div>
                </div>

                {/* DETAILS */}
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    opacity: 0.7,
                    display: 'flex',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  <span>Type: {share.mediaType}</span>
                  <span>•</span>
                  <span>{new Date(share.createdAt).toLocaleString()}</span>
                  <span>•</span>
                  <span>{share.downloadable ? 'Downloadable' : 'Protected / play-only'}</span>
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
