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

/***************************************************************************************************
 * GLOBAL TYPE FIX — ensure TypeScript knows preload APIs exist
 **************************************************************************************************/
declare global {
  interface Window {
    onestar?: {
      listMedia: () => Promise<MediaItem[]>;
      deleteMedia: (id: string) => Promise<{ ok: boolean }>;
      getShareFile: (id: string) => Promise<any>;
      getFileBytes: (absPath: string) => Promise<Uint8Array>;
      getFilePath: (id: string) => Promise<{ ok: boolean; path: string }>;
    };
  }
}

/***************************************************************************************************
 * PAGE IMPLEMENTATION — NO PLAYBACK, NO UI MODIFICATIONS
 **************************************************************************************************/

export default function LibraryPage() {
  // AUTH
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => setAuth(!!data.user))
      .catch(() => setAuth(false));
  }, []);

  // MEDIA LIST STATE
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // LOAD LIBRARY AFTER AUTH
  useEffect(() => {
    if (auth !== true) return;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        if (
          typeof window === 'undefined' ||
          !window.onestar ||
          typeof window.onestar.listMedia !== 'function'
        ) {
          setError(
            'Local media bridge not available. This page must run inside the Electron app.'
          );
          setItems([]);
          return;
        }

        const list = await window.onestar.listMedia();
        if (Array.isArray(list)) {
          list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          setItems(list);
        } else {
          setItems([]);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(`Error loading media: ${message}`);
        setItems([]);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [auth]);

  // AUTH ROUTING
  if (auth === null) return <main style={{ padding: 24 }}>Checking session…</main>;
  if (auth === false) redirect('/auth/signin');

  /***************************************************************************************************
   * RENDER — NO PLAY BUTTON, NO PLAYBACK
   **************************************************************************************************/
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
          <p style={{ opacity: 0.7 }}>Library – your local media</p>
        </div>

        <nav style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/upload">Upload</a>
          <a href="/library">Library</a>
          <a href="/app">Player</a>
        </nav>
      </header>

      {error && (
        <p style={{ marginBottom: 12, color: 'red', fontSize: 13 }}>{error}</p>
      )}

      {loading && <p>Loading…</p>}

      {!loading && items.length === 0 && !error && (
        <p>No media yet. Upload something first.</p>
      )}

      {!loading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map(item => {
            const prettySize =
              item.sizeBytes > 0
                ? (item.sizeBytes / (1024 * 1024)).toFixed(2)
                : '0.00';

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
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 600 }}>
                      {item.title || '(untitled)'}
                    </span>

                    <span
                      style={{
                        fontSize: 12,
                        opacity: 0.7,
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

                      {item.protected && (
                        <>
                          <span>•</span>
                          <span style={{ color: 'red' }}>
                            Protected / play-only
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                    }}
                  >
                    {/* REMOVED BUTTON — PERMANENTLY */}
                    <a
                      href="/app"
                      style={{
                        fontSize: 12,
                        textDecoration: 'underline',
                      }}
                    >
                      Open in player
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
