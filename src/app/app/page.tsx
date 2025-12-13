"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import {
  playHD,
  pauseHD,
  seekHD,
  getHDAudioTime,
  loadHD,
} from "@/lib/hdAudioEngine";
import { attachPlayerUsageTracking } from "@/lib/onestardb";

import { CurrentUserBadge } from "@/components/CurrentUserBadge";
import { redirect } from "next/navigation";

export interface MediaItem {
  id: string;
  title: string;
  fileName: string;
  type: string;
  sizeBytes: number;
  createdAt: string;
  protected: boolean;
  ownerId?: string;
  licenseId: string; // Required: every media item has a license
}

/***************************************************************************************************
 * ATTACH ELEMENT (REQUIRED)
 **************************************************************************************************/
function attachElement(el: HTMLAudioElement) {
  const w = window as any;
  if (w.onestar?.audio?.attachElement) {
    w.onestar.audio.attachElement(el);
  }
}

/***************************************************************************************************
 * MEDIA PLAYER (Phase 18: Streaming Decryption)
 **************************************************************************************************/
function MediaPlayer({
  item,
  currentUser,
}: {
  item: MediaItem;
  currentUser: { id: string } | null;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [encryptedBlobUrl, setEncryptedBlobUrl] = useState<string | null>(null);
  const [streamingMode, setStreamingMode] = useState<boolean>(false);
  const cleanupRef = useRef<(() => void) | null>(null);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);

  const visibility = item.protected ? "protected" : "public";
  const encoded = encodeURIComponent(item.fileName);
  const src = `onestar://media/${visibility}/${encoded}`;

  /***************************************************************************************************
   * Phase 18: Streaming decryption with MediaSource API
   **************************************************************************************************/
  const loadStreamingMedia = async () => {
    const w = window as any;
    if (!w.onestar?.openEncryptedStream) {
      console.warn('[MediaPlayer] openEncryptedStream not available, falling back to monolithic');
      await loadEncryptedMedia();
      return;
    }

    // Check MediaSource support
    if (typeof MediaSource === 'undefined') {
      console.warn('[MediaPlayer] MediaSource API not supported, falling back to monolithic');
      await loadEncryptedMedia();
      return;
    }

    try {
      console.log('[MediaPlayer] Starting streaming decryption:', item.id);
      
      // Fetch metadata to get MIME type
      const response = await fetch(`/api/encrypted-media/get/${item.id}`);
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error('Failed to fetch media metadata');
      }

      const mimeType = data.metadata?.mimeType || 'audio/mpeg';
      const codecs = mimeType.includes('audio') ? 'mp3' : '';
      const fullMimeType = codecs ? `${mimeType}; codecs="${codecs}"` : mimeType;

      // Check if MIME type is supported
      if (!MediaSource.isTypeSupported(fullMimeType)) {
        console.warn(`[MediaPlayer] MIME type ${fullMimeType} not supported, falling back`);
        await loadEncryptedMedia();
        return;
      }

      // Create MediaSource
      const mediaSource = new MediaSource();
      mediaSourceRef.current = mediaSource;
      const objectUrl = URL.createObjectURL(mediaSource);
      
      setStreamingMode(true);
      setEncryptedBlobUrl(objectUrl);

      // Wait for MediaSource to open
      await new Promise<void>((resolve, reject) => {
        mediaSource.addEventListener('sourceopen', () => resolve(), { once: true });
        mediaSource.addEventListener('error', (e) => reject(e), { once: true });
        
        // Set audio source to trigger sourceopen
        if (audioRef.current) {
          audioRef.current.src = objectUrl;
        }
      });

      console.log('[MediaPlayer] MediaSource opened, creating SourceBuffer');

      // Create SourceBuffer
      const sourceBuffer = mediaSource.addSourceBuffer(fullMimeType);
      sourceBufferRef.current = sourceBuffer;

      // Stream and append chunks
      const stream = await w.onestar.openEncryptedStream(item.id);
      let chunkCount = 0;

      for await (const chunk of stream) {
        // Wait for SourceBuffer to be ready
        while (sourceBuffer.updating) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Append decrypted chunk
        sourceBuffer.appendBuffer(chunk);
        chunkCount++;

        // Backpressure: wait for append to complete
        await new Promise<void>((resolve) => {
          sourceBuffer.addEventListener('updateend', () => resolve(), { once: true });
        });

        // Log progress
        if (chunkCount % 10 === 0) {
          console.log(`[MediaPlayer] Streamed ${chunkCount} chunks`);
        }
      }

      console.log(`[MediaPlayer] Streaming complete: ${chunkCount} chunks`);

      // Signal end of stream
      if (mediaSource.readyState === 'open') {
        mediaSource.endOfStream();
      }

      // Cleanup function
      cleanupRef.current = () => {
        if (sourceBufferRef.current && mediaSourceRef.current) {
          try {
            if (mediaSourceRef.current.readyState === 'open') {
              mediaSourceRef.current.endOfStream();
            }
          } catch (e) {
            console.warn('[MediaPlayer] MediaSource cleanup error:', e);
          }
        }
        sourceBufferRef.current = null;
        mediaSourceRef.current = null;
      };

    } catch (error) {
      console.error('[MediaPlayer] Streaming decryption failed:', error);
      console.warn('[MediaPlayer] Falling back to monolithic decryption');
      
      // Cleanup failed MediaSource
      if (mediaSourceRef.current) {
        try {
          if (mediaSourceRef.current.readyState === 'open') {
            mediaSourceRef.current.endOfStream();
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        mediaSourceRef.current = null;
      }
      
      // Fallback to monolithic decryption
      setStreamingMode(false);
      await loadEncryptedMedia();
    }
  };

  /***************************************************************************************************
   * Phase 17: Monolithic decryption (fallback for unsupported formats)
   **************************************************************************************************/
  const loadEncryptedMedia = async () => {
    const w = window as any;
    if (!w.onestar?.unwrapAndDecryptMedia) {
      console.warn('[MediaPlayer] unwrapAndDecryptMedia not available');
      return;
    }

    try {
      console.log('[MediaPlayer] Loading encrypted media (monolithic):', item.id);
      const result = await w.onestar.unwrapAndDecryptMedia(item.id);
      
      console.log('[MediaPlayer] Decryption successful:', {
        mimeType: result.mimeType,
        title: result.title,
      });

      // Set Blob URL for playback
      setEncryptedBlobUrl(result.blobUrl);
      setStreamingMode(false);
      
      // Store cleanup function
      cleanupRef.current = result.cleanup;
    } catch (error) {
      console.error('[MediaPlayer] Failed to decrypt media:', error);
      alert(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  /***************************************************************************************************
   * Load main-process HD buffer (legacy path for unencrypted media)
   **************************************************************************************************/
  const doLoadHD = async () => {
    const w = window as any;
    if (!w.onestar?.getFilePath) return;

    const fp = await w.onestar.getFilePath(item.id);
    if (!fp?.ok || !fp.data?.absPath) return;

    await loadHD(fp.data.absPath);
  };

  /***************************************************************************************************
   * Sync UI scrubber with HD engine
   **************************************************************************************************/
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    attachElement(el);
    
    // Phase 18: Try streaming decryption first, fallback to monolithic
    const initPlayback = async () => {
      // Check if this is encrypted media (has licenseId in database)
      if (item.licenseId && item.protected) {
        // Try streaming first (Phase 18)
        await loadStreamingMedia();
      } else {
        // Legacy HD buffer loading for unencrypted media
        await doLoadHD();
      }
    };
    
    void initPlayback();

    // Attach usage tracking (licenseId is now always present)
    let cleanupTracking: (() => void) | null = null;

    if (item.id && currentUser) {
      try {
        const { detach } = attachPlayerUsageTracking(el, {
          attachmentId: item.id,
          licenseId: item.licenseId, // Required field - always present
          principal: currentUser.id, // currentUser is guaranteed non-null here
          onQuotaExceeded: () => {
            alert("Usage quota exceeded. Playback stopped.");
          },
        });

        cleanupTracking = detach;
      } catch (err) {
        console.error("[MediaPlayer] attachPlayerUsageTracking failed:", err);
      }
    }

    let raf: number;

    const tick = async () => {
      const res = await getHDAudioTime();
      if (res?.ok && res.data?.currentTime != null) el.currentTime = res.data.currentTime;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (cleanupTracking) cleanupTracking();
      pauseHD();
      
      // SECURITY: Cleanup encrypted media (both streaming and monolithic)
      if (cleanupRef.current) {
        console.log('[MediaPlayer] Cleaning up encrypted media');
        cleanupRef.current();
        cleanupRef.current = null;
      }
      if (encryptedBlobUrl) {
        URL.revokeObjectURL(encryptedBlobUrl);
        setEncryptedBlobUrl(null);
      }
      
      // Cleanup MediaSource if streaming
      if (mediaSourceRef.current) {
        try {
          if (mediaSourceRef.current.readyState === 'open') {
            mediaSourceRef.current.endOfStream();
          }
        } catch (e) {
          console.warn('[MediaPlayer] MediaSource cleanup error:', e);
        }
        mediaSourceRef.current = null;
      }
      sourceBufferRef.current = null;
    };
  }, [item.id, currentUser?.id, encryptedBlobUrl]);

  const handleLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el) return;

    const dur = el.duration;
    if (!isNaN(dur) && dur > 0) {
      const w = window as any;
      w.onestar?.audio?.setAudioDuration?.(dur);
      
      console.log('[MediaPlayer] Loaded metadata:', {
        duration: dur,
        streaming: streamingMode,
        mediaId: item.id,
      });
    }
  };

  // Use encrypted Blob URL if available, otherwise use onestar:// protocol
  const audioSrc = encryptedBlobUrl || src;

  return (
    <div style={{ width: "100%", marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        {item.title || "Untitled"}
        {streamingMode && (
          <span style={{ fontSize: 11, color: 'green', marginLeft: 8 }}>
            [Streaming ⚡]
          </span>
        )}
      </div>

      <audio
        ref={audioRef}
        src={audioSrc}
        controls
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        style={{ width: "100%" }}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => playHD()}
        onPause={() => pauseHD()}
        onSeeking={() => {
          const el = audioRef.current;
          if (el) {
            seekHD(el.currentTime);
            console.log('[MediaPlayer] Seeking:', {
              time: el.currentTime,
              streaming: streamingMode,
            });
          }
        }}
        onError={(e) => {
          const a = e.currentTarget;
          console.error("[MediaPlayer ERROR]", {
            err: a.error,
            src: audioSrc,
            encrypted: !!encryptedBlobUrl,
            streaming: streamingMode,
            networkState: a.networkState,
            readyState: a.readyState,
          });
        }}
      />
    </div>
  );
}

/***************************************************************************************************
 * HAMBURGER MENU
 **************************************************************************************************/
function HamburgerMenu({ onDelete }: { onDelete: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)}>☰</button>

      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            background: "white",
            border: "1px solid #ddd",
            borderRadius: 4,
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
            zIndex: 1,
          }}
        >
          <button
            onClick={() => {
              if (window.confirm("Delete this media file?")) onDelete();
              setOpen(false);
            }}
            style={{
              display: "block",
              width: "100%",
              padding: 8,
              textAlign: "left",
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

/***************************************************************************************************
 * MAIN PAGE
 **************************************************************************************************/
export default function AppPage() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [shareItem, setShareItem] = useState<MediaItem | null>(null);
  const [shareRecipient, setShareRecipient] = useState("");
  const [shareDownloadable, setShareDownloadable] = useState(true);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareSubmitting, setShareSubmitting] = useState(false);

  /***************************************************************************************************
   * AUTH CHECK
   **************************************************************************************************/
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAuth(!!d.user))
      .catch(() => setAuth(false));
  }, []);

  /***************************************************************************************************
   * FETCH CURRENT USER
   **************************************************************************************************/
  useEffect(() => {
    if (auth !== true) return;

    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setCurrentUser(d.user || null))
      .catch(() => setCurrentUser(null));
  }, [auth]);

  /***************************************************************************************************
   * LOAD MEDIA LIST
   **************************************************************************************************/
  useEffect(() => {
    if (auth !== true) return;

    async function load() {
      try {
        const w = window as any;
        if (w.onestar?.listMedia) {
          const resp = await w.onestar.listMedia();
          if (resp?.ok && Array.isArray(resp.data)) setItems(resp.data);
          else setItems([]);
        } else {
          const resp = await fetch("/api/media");
          if (resp.ok) setItems(await resp.json());
        }
      } catch {
        setItems([]);
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [auth]);

  if (auth === null) return <main style={{ padding: 24 }}>Checking session…</main>;
  if (auth === false) redirect("/auth/signin");

  /***************************************************************************************************
   * MAIN UI
   **************************************************************************************************/
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 16 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 24,
        }}
      >
        <div>
          <h1 style={{ marginBottom: 4 }}>OnestarStream</h1>
          <p style={{ opacity: 0.7 }}>Local serverless streaming & storage MVP.</p>
        </div>

        <nav style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <a href="/upload">Upload</a>
          <a href="/library">Library</a>
          <a href="/inbox">Inbox</a>
          <CurrentUserBadge />
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/auth/signin";
            }}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "#0070f3",
            }}
          >
            Logout
          </button>
        </nav>
      </header>

      {loading && <p>Loading…</p>}
      {!loading && items.length === 0 && <p>No media yet. Upload something.</p>}

      {!loading &&
        items.length > 0 &&
        items
          .slice()
          .reverse()
          .map((item) => {
            const prettySize = (item.sizeBytes / (1024 * 1024)).toFixed(2);

            const ext = item.fileName.includes(".")
              ? item.fileName.slice(item.fileName.lastIndexOf("."))
              : "";

            const safeTitle = (item.title || "track").replace(/[\\/:*?"<>|]/g, "");
            const downloadName = `${safeTitle}${ext}`;

            const deleteItem = async () => {
              const w = window as any;
              if (w.onestar?.deleteMedia) {
                const res = await w.onestar.deleteMedia(item.id);
                if (res?.ok) {
                  setItems((p) => p.filter((x) => x.id !== item.id));
                  return;
                }
              }
              await fetch(`/api/media/${item.id}`, { method: "DELETE" });
              setItems((p) => p.filter((x) => x.id !== item.id));
            };

            return (
              <div
                key={item.id}
                style={{ border: "1px solid #ddd", padding: 12, borderRadius: 8 }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <h2>{item.title}</h2>
                  <HamburgerMenu onDelete={deleteItem} />
                </div>

                <p
                  style={{
                    fontSize: 12,
                    opacity: 0.7,
                    marginBottom: 8,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>Type: {item.type}</span>
                  <span>•</span>
                  <span>{prettySize} MB</span>
                  <span>•</span>
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </p>

                <MediaPlayer item={item} currentUser={currentUser} />

                {!item.protected && (
                  <>
                    <a href={`/media/${item.fileName}`} download={downloadName}>
                      ⬇ Download file
                    </a>
                    <button
                      style={{ marginLeft: 8, fontSize: 12 }}
                      onClick={() => {
                        setShareItem(item);
                        setShareRecipient("");
                        setShareDownloadable(true);
                        setShareError(null);
                        setShareSubmitting(false);
                      }}
                    >
                      Share
                    </button>
                  </>
                )}

                {item.protected && (
                  <span style={{ fontSize: 12, color: "red" }}>Protected / play-only</span>
                )}
              </div>
            );
          })}
    </main>
  );
}
