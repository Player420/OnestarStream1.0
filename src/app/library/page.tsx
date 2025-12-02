
'use client';

import { useEffect, useState } from 'react';
import { redirect } from 'next/navigation';

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

export default function LibraryPage() {
  // -------------------------------
  // AUTH GATE – ALWAYS FIRST HOOKS
  // -------------------------------
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setAuth(!!data.user))
      .catch(() => setAuth(false));
  }, []);

  // -------------------------------
  // LIBRARY STATE
  // -------------------------------
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Only load media AFTER we know they're authenticated
  useEffect(() => {
    if (auth !== true) return;

    async function load() {
      setLoading(true);
      try {
        // Native desktop path: use local device library via bridge if present
        if (
          typeof window !== 'undefined' &&
          (window as any).onestar?.listMedia
        ) {
          const data = await (window as any).onestar.listMedia();
          setItems(Array.isArray(data) ? data : []);
        } else {
          // Dev / droplet fallback: use existing API
          const res = await fetch('/api/media');
          if (!res.ok) {
            console.error('Failed to load media');
            setItems([]);
            return;
          }
          const data = (await res.json()) as MediaItem[];
          setItems(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Error loading media:', err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [auth]);

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
  // ORIGINAL LIBRARY UI (UNCHANGED)
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
          <p style={{ opacity: 0.7 }}>Library – your uploaded media</p>
        </div>
        <nav style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/upload">Upload</a>
          <a href="/library">Library</a>
          <a href="/app">Player</a>
        </nav>
      </header>

      {loading && <p>Loading…</p>}

      {!loading && items.length === 0 && (
        <p>No media yet. Go upload something on the upload page.</p>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items
            .slice()
            .reverse()
            .map((item) => {
              const prettySize =
                item.sizeBytes > 0
                  ? (item.sizeBytes / (1024 * 1024)).toFixed(2)
                  : '0.00';

              // NOTE: mediaUrl here is conceptual – in the native build
              // this should point to a local file URL. For dev on the droplet,
              // existing /media route still works as a fallback.
              const mediaUrl = item.protected
                ? `/api/protected-stream/${item.id}`
                : `/media/${item.fileName}`;

              return (
                <div
                  key={item.id}
                  style={{
                    border: '1px solid #ddd',
                    padding: 12,
                    borderRadius: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <a
                      href={mediaUrl}
                      style={{
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      {item.title || '(untitled)'}
                    </a>
                    <a
                      href="/app"
                      style={{ fontSize: 12, textDecoration: 'underline' }}
                    >
                      Open in player
                    </a>
                  </div>

                  <p
                    style={{
                      fontSize: 12,
                      opacity: 0.7,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      margin: 0,
                    }}
                  >
                    <span>Type: {item.type}</span>
                    <span>•</span>
                    <span>{prettySize} MB</span>
                    <span>•</span>
                    <span>{new Date(item.createdAt).toLocaleString()}</span>
                    {item.protected && (
                      <>
                        <span>•</span>
                        <span style={{ color: 'red' }}>
                          Protected / play-only
                        </span>
                      </>
                    )}
                  </p>
                </div>
              );
            })}
        </div>
      )}
    </main>
  );
}
