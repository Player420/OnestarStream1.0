"use client";

import { useEffect, useRef, useState, FormEvent } from "react";
import {
  playHD,
  pauseHD,
  seekHD,
  getHDAudioTime,
  loadHD,
} from "@/lib/hdAudioEngine";

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
 * MEDIA PLAYER
 **************************************************************************************************/
function MediaPlayer({ item }: { item: MediaItem }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const visibility = item.protected ? "protected" : "public";
  const encoded = encodeURIComponent(item.fileName);
  const src = `onestar://media/${visibility}/${encoded}`;

  /***************************************************************************************************
   * Load main-process HD buffer
   **************************************************************************************************/
  const doLoadHD = async () => {
    const w = window as any;
    if (!w.onestar?.getFilePath) return;

    const fp = await w.onestar.getFilePath(item.id);
    if (!fp?.ok) return;

    await loadHD(fp.absPath);
  };

  /***************************************************************************************************
   * Sync UI scrubber with HD engine
   **************************************************************************************************/
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;

    attachElement(el);
    void doLoadHD();

    let raf: number;

    const tick = async () => {
      const res = await getHDAudioTime();
      if (res?.currentTime != null) el.currentTime = res.currentTime;
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      stopHD();
    };
  }, []);

  const handleLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el) return;

    const dur = el.duration;
    if (!isNaN(dur) && dur > 0) {
      const w = window as any;
      w.onestar?.audio?.setAudioDuration?.(dur);
    }
  };

  return (
    <div style={{ width: "100%", marginBottom: 20 }}>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
        {item.title || "Untitled"}
      </div>

      <audio
        ref={audioRef}
        src={src}
        controls
        preload="metadata"
        controlsList="nodownload noplaybackrate"
        style={{ width: "100%" }}
        onLoadedMetadata={handleLoadedMetadata}
        onPlay={() => playHD()}
        onPause={() => pauseHD()}
        onSeeking={() => {
          const el = audioRef.current;
          if (el) seekHD(el.currentTime);
        }}
        onError={(e) => {
          const a = e.currentTarget;
          console.error("[MediaPlayer ERROR]", {
            err: a.error,
            src,
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
   * LOAD MEDIA LIST
   **************************************************************************************************/
  useEffect(() => {
    if (auth !== true) return;

    async function load() {
      try {
        const w = window as any;
        if (w.onestar?.listMedia) {
          const list = await w.onestar.listMedia();
          setItems(list);
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

                <MediaPlayer item={item} />

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
