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

/* Using authoritative types from `src/types/onestar.d.ts` */

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
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // LOAD LIBRARY AFTER AUTH (Phase 18: Use local index for instant loading)
  useEffect(() => {
    if (auth !== true) return;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        if (
          typeof window === 'undefined' ||
          !window.onestar
        ) {
          setError(
            'Local media bridge not available. This page must run inside the Electron app.'
          );
          setItems([]);
          return;
        }

        // Phase 18: Try local media index first (instant)
        if (typeof window.onestar.getLocalMediaIndex === 'function') {
          console.log('[Library] Loading from local index...');
          const localMedia = await window.onestar.getLocalMediaIndex();
          
          if (localMedia && Array.isArray(localMedia)) {
            // Convert from local index format to MediaItem format
            const converted = localMedia.map((item: any) => ({
              id: item.id,
              title: item.title || 'Untitled',
              fileName: item.title || 'unknown',
              type: item.mimeType?.startsWith('audio/') ? 'audio' as MediaType 
                    : item.mimeType?.startsWith('video/') ? 'video' as MediaType 
                    : 'image' as MediaType,
              sizeBytes: item.fileSize || 0,
              createdAt: item.createdAt,
              protected: true, // Local index only stores encrypted media
            }));
            
            converted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            setItems(converted);
            console.log(`[Library] Loaded ${converted.length} items from local index`);
            
            // Get last sync time
            if (typeof window.onestar.getMediaIndexStats === 'function') {
              const stats = await window.onestar.getMediaIndexStats();
              setLastSyncTime(stats.lastUpdated);
            }
            
            setLoading(false);
            
            // Background sync to keep index fresh (don't block UI)
            backgroundSync();
            return;
          }
        }

        // Fallback: Use listMedia API (legacy path)
        console.log('[Library] Local index not available, using listMedia...');
        if (typeof window.onestar.listMedia !== 'function') {
          setError('Media listing not available');
          setItems([]);
          return;
        }

        const resp = await window.onestar.listMedia();
        if (resp?.ok && Array.isArray(resp.data)) {
          const list = resp.data;
          list.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
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

  // Background sync function (Phase 18)
  const backgroundSync = async () => {
    if (syncing) return;
    
    setSyncing(true);
    try {
      if (window.onestar?.refreshLocalMediaIndex) {
        console.log('[Library] Background sync started...');
        const count = await window.onestar.refreshLocalMediaIndex();
        console.log(`[Library] Background sync complete: ${count} items`);
        
        // Reload from index after sync
        if (window.onestar.getLocalMediaIndex) {
          const localMedia = await window.onestar.getLocalMediaIndex();
          if (localMedia && Array.isArray(localMedia)) {
            const converted = localMedia.map((item: any) => ({
              id: item.id,
              title: item.title || 'Untitled',
              fileName: item.title || 'unknown',
              type: item.mimeType?.startsWith('audio/') ? 'audio' as MediaType 
                    : item.mimeType?.startsWith('video/') ? 'video' as MediaType 
                    : 'image' as MediaType,
              sizeBytes: item.fileSize || 0,
              createdAt: item.createdAt,
              protected: true,
            }));
            
            converted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            setItems(converted);
            setLastSyncTime(new Date().toISOString());
          }
        }
      }
    } catch (err) {
      console.warn('[Library] Background sync failed:', err);
    } finally {
      setSyncing(false);
    }
  };

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
          <p style={{ opacity: 0.7 }}>
            Library – your local media
            {lastSyncTime && (
              <span style={{ fontSize: 11, marginLeft: 8 }}>
                (synced: {new Date(lastSyncTime).toLocaleTimeString()})
              </span>
            )}
          </p>
        </div>

        <nav style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <a href="/upload">Upload</a>
          <a href="/library">Library</a>
          <a href="/app">Player</a>
          {!loading && (
            <button
              onClick={backgroundSync}
              disabled={syncing}
              style={{
                fontSize: 12,
                padding: '4px 8px',
                cursor: syncing ? 'wait' : 'pointer',
                opacity: syncing ? 0.5 : 1,
              }}
            >
              {syncing ? 'Syncing...' : '🔄 Sync'}
            </button>
          )}
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
