'use client';

import { useEffect, useState, FormEvent } from 'react';
import { redirect } from 'next/navigation';
import { CurrentUserBadge } from '@/components/CurrentUserBadge';

function HamburgerMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)}>☰</button>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            background: 'white',
            border: '1px solid #ddd',
            borderRadius: 4,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            zIndex: 1,
          }}
        >
          <button
            onClick={() => {
              if (
                window.confirm(
                  'Delete this media file from your OnestarStream? This only affects your local app.'
                )
              ) {
                onDelete();
              }
              setOpen(false);
            }}
            style={{ display: 'block', width: '100%', padding: 8, textAlign: 'left' }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

type MediaType = 'audio' | 'video' | 'image';

interface MediaItem {
  id: string;
  title: string;
  fileName: string;
  type: MediaType;
  sizeBytes: number;
  createdAt: string;
  protected: boolean;
}

export default function AppPage() {
  // -------------------------------
  // AUTH STATE — ALWAYS FIRST
  // -------------------------------
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setAuth(!!data.user))
      .catch(() => setAuth(false));
  }, []);

  // -------------------------------
  // ORIGINAL APP STATE
  // -------------------------------
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // SHARE UI STATE
  const [shareItem, setShareItem] = useState<MediaItem | null>(null);
  const [shareRecipient, setShareRecipient] = useState('');
  const [shareDownloadable, setShareDownloadable] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);

  // Only load media AFTER we know they're authenticated
  useEffect(() => {
    if (auth !== true) return;

    async function load() {
      const res = await fetch('/api/media');
      if (!res.ok) {
        console.error('Failed to load media');
        setItems([]);
        setLoading(false);
        return;
      }
      const data = (await res.json()) as MediaItem[];
      setItems(data);
      setLoading(false);
    }

    void load();
  }, [auth]);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Error logging out:', err);
    } finally {
      window.location.href = '/auth/signin';
    }
  };

  function openShare(item: MediaItem) {
    setShareItem(item);
    setShareRecipient('');
    setShareDownloadable(true);
    setShareError(null);
    setShareSubmitting(false);
  }

  function closeShare() {
    setShareItem(null);
    setShareRecipient('');
    setShareError(null);
    setShareSubmitting(false);
  }

  async function handleShareSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!shareItem) return;

    setShareError(null);
    setShareSubmitting(true);

    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mediaId: shareItem.id,
          recipient: shareRecipient,
          downloadable: shareDownloadable,
        }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok || !data.ok) {
        setShareError(data.error || 'Failed to share track.');
        return;
      }

      // Success – close modal + reset fields
      setShareItem(null);
      setShareRecipient('');
      setShareDownloadable(true);
      setShareError(null);
    } catch (err) {
      console.error('Share submit error:', err);
      setShareError('Failed to share track.');
    } finally {
      setShareSubmitting(false);
    }
  }

  // -------------------------------
  // AUTH-BASED RENDER BRANCHES
  // -------------------------------
  if (auth === null) {
    return <main style={{ padding: 24 }}>Checking session…</main>;
  }

  if (auth === false) {
    redirect('/auth/signin');
  }

  // -------------------------------
  // MAIN PLAYER UI (WITH DOWNLOAD + SHARE)
  // -------------------------------
  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
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
          <p style={{ opacity: 0.7 }}>
            Local serverless-style streaming & file sharing MVP.
          </p>
        </div>
        <nav style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/upload">Upload</a>
          <a href="/library">Library</a>
          <a href="/inbox">Inbox</a>
          <CurrentUserBadge />
          <button
            type="button"
            onClick={handleLogout}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              padding: 0,
              margin: 0,
              font: 'inherit',
              color: '#0070f3',
            }}
          >
            Logout
          </button>
        </nav>
      </header>

      {loading && <p>Loading…</p>}

      {!loading && items.length === 0 && (
        <p>No media yet. Go upload something on the upload page.</p>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {items
            .slice()
            .reverse()
            .map((item) => {
              const prettySize =
                item.sizeBytes > 0
                  ? (item.sizeBytes / (1024 * 1024)).toFixed(2)
                  : '0.00';

              const mediaUrl = item.protected
                ? `/api/protected-stream/${item.id}`
                : `/media/${item.fileName}`;

              // ---------- NEW: nice download name ----------
              const ext = item.fileName.includes('.')
                ? item.fileName.slice(item.fileName.lastIndexOf('.'))
                : '';

              const rawTitle = item.title || 'track';

              // Strip characters that are illegal in filenames on common OSes
              const safeTitle =
                rawTitle.replace(/[\\/:*?"<>|]/g, '') || 'track';

              const downloadName = `${safeTitle}${ext}`;
              // ------------------------------------------------

              const handleDelete = async () => {
                try {
                  const res = await fetch(`/api/media/${item.id}`, {
                    method: 'DELETE',
                  });
                  if (res.ok) {
                    setItems((prev) => prev.filter((i) => i.id !== item.id));
                  } else {
                    alert('Failed to delete media.');
                  }
                } catch (error) {
                  console.error('Error deleting media:', error);
                  alert('Failed to delete media.');
                }
              };

              const handleShareClick = () => {
                openShare(item);
              };

              return (
                <div
                  key={item.id}
                  style={{
                    border: '1px solid #ddd',
                    padding: 12,
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <h2 style={{ marginBottom: 4 }}>{item.title}</h2>
                    <HamburgerMenu onDelete={handleDelete} />
                  </div>
                  <p
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      marginBottom: 8,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>Type: {item.type}</span>
                    <span>•</span>
                    <span>{prettySize} MB</span>
                    <span>•</span>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                  </p>

                  {item.type === 'audio' && (
                    <audio
                      controls
                      src={mediaUrl}
                      style={{ width: '100%', marginBottom: 8 }}
                    />
                  )}

                  {item.type === 'video' && (
                    <video
                      controls
                      src={mediaUrl}
                      style={{ width: '100%', maxHeight: 400, marginBottom: 8 }}
                    />
                  )}

                  {item.type === 'image' && (
                    <img
                      src={mediaUrl}
                      alt={item.title}
                      style={{
                        maxWidth: '100%',
                        height: 'auto',
                        display: 'block',
                        marginBottom: 8,
                      }}
                    />
                  )}

                  {/* Non-protected: Download + Share link button */}
                  {!item.protected && (
                    <>
                      <a href={mediaUrl} download={downloadName}>
                        ⬇ Download file
                      </a>
                      <button
                        type="button"
                        onClick={handleShareClick}
                        style={{
                          marginLeft: 8,
                          padding: 0,
                          border: 'none',
                          background: 'none',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        Share
                      </button>
                    </>
                  )}

                  {/* Protected: unchanged */}
                  {item.protected && (
                    <span style={{ fontSize: 12, color: 'red' }}>
                      Protected / play-only
                    </span>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* SHARE MODAL – dark / night mode */}
      {shareItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: '#111',
              color: '#f5f5f5',
              borderRadius: 8,
              padding: 16,
              maxWidth: 380,
              width: '100%',
              boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
              border: '1px solid #333',
            }}
          >
            <h2
              style={{
                margin: 0,
                marginBottom: 8,
                color: '#ff80c8',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
              }}
            >
              Share “{shareItem.title || '(untitled)'}”
            </h2>
            <p
              style={{
                margin: 0,
                marginBottom: 12,
                fontSize: 13,
                color: '#bbbbbb',
              }}
            >
              Enter a recipient&apos;s username or email. Only valid registered
              accounts can receive this track.
            </p>

            <form onSubmit={handleShareSubmit} style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 13, color: '#dddddd' }}>
                Recipient
                <input
                  type="text"
                  value={shareRecipient}
                  onChange={(e) => setShareRecipient(e.target.value)}
                  required
                  placeholder="@handle or user@example.com"
                  style={{
                    width: '100%',
                    marginTop: 4,
                    padding: 6,
                    borderRadius: 4,
                    border: '1px solid #444',
                    background: '#1d1d1d',
                    color: '#f5f5f5',
                    fontSize: 13,
                  }}
                />
              </label>

              <label
                style={{
                  fontSize: 13,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 4,
                  color: '#dddddd',
                }}
              >
                <input
                  type="checkbox"
                  checked={shareDownloadable}
                  onChange={(e) => setShareDownloadable(e.target.checked)}
                />
                Downloadable for recipient
              </label>

              {shareError && (
                <p
                  style={{
                    color: '#ff6b6b',
                    fontSize: 12,
                    margin: 0,
                    marginTop: 4,
                  }}
                >
                  {shareError}
                </p>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 8,
                  marginTop: 12,
                }}
              >
                <button
                  type="button"
                  onClick={closeShare}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #444',
                    background: '#222',
                    color: '#f0f0f0',
                    fontSize: 13,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={shareSubmitting}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 4,
                    border: '1px solid #666',
                    background: shareSubmitting ? '#444' : '#2e7d32',
                    color: '#fefefe',
                    fontSize: 13,
                    cursor: shareSubmitting ? 'default' : 'pointer',
                  }}
                >
                  {shareSubmitting ? 'Sharing…' : 'Confirm recipient'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
