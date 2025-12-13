'use client';

import { useEffect, useState } from 'react';

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
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            zIndex: 1,
          }}
        >
          <button
            onClick={() => {
              if (window.confirm('Delete this media file from your OnestarStream? This only affects your local app.')) {
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

export default function HomePage() {
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    load();
  }, []);

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
        <a href="/upload">Upload</a>
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

              const handleDelete = async () => {
                try {
                  const res = await fetch(`/api/media/${item.id}`, { method: 'DELETE' });
                  if (res.ok) {
                    setItems((prevItems) => prevItems.filter((i) => i.id !== item.id));
                  } else {
                    alert('Failed to delete media.');
                  }
                } catch (error) {
                  console.error('Error deleting media:', error);
                  alert('Failed to delete media.');
                }
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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

                  {!item.protected && (
                    <a href={mediaUrl} download>
                      ⬇ Download file
                    </a>
                  )}
                  {item.protected && (
                    <span style={{ fontSize: 12, color: 'red' }}>Protected / play-only</span>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </main>
  );
}
