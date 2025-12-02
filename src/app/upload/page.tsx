'use client';

import { FormEvent, useState, useEffect, useRef } from 'react';
import { redirect } from 'next/navigation';

type MediaType = 'audio' | 'video' | 'image';

declare global {
  interface Window {
    onestar?: {
      saveMedia?: (opts: {
        file: File;
        title: string;
        type: MediaType;
        downloadable: boolean;
      }) => Promise<{ ok: boolean; id?: string; fileName?: string }>;
    };
  }
}

export default function UploadPage() {
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
  // OTHER LOCAL STATE HOOKS
  // -------------------------------
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Raw progress target (0–100)
  const [progress, setProgress] = useState(0);
  // Smoothed visual progress for the bar
  const [displayProgress, setDisplayProgress] = useState(0);
  // For fake progress when using Electron bridge
  const fakeTimerRef = useRef<number | null>(null);

  // Smoothly animate `displayProgress` toward `progress`
  useEffect(() => {
    if (!uploading) return;

    let frameId: number;

    const animate = () => {
      setDisplayProgress((prev) => {
        const target = progress;
        const diff = target - prev;
        if (Math.abs(diff) < 0.1) {
          return target;
        }
        // Ease toward target
        return prev + diff * 0.2;
      });

      frameId = window.requestAnimationFrame(animate);
    };

    frameId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [uploading, progress]);

  // Cleanup fake timer on unmount
  useEffect(() => {
    return () => {
      if (fakeTimerRef.current !== null) {
        window.clearInterval(fakeTimerRef.current);
        fakeTimerRef.current = null;
      }
    };
  }, []);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    const file = formData.get('file') as File | null;
    if (!file) {
      setStatus('No file selected');
      return;
    }

    const title = (formData.get('title') as string) || '';
    const type = (formData.get('type') as MediaType) || 'audio';
    const downloadable = formData.get('downloadable') === 'on';

    setStatus('Uploading…');
    setUploading(true);
    setProgress(0);
    setDisplayProgress(0);

    // Helper to stop any fake progress timer
    const stopFakeTimer = () => {
      if (fakeTimerRef.current !== null) {
        window.clearInterval(fakeTimerRef.current);
        fakeTimerRef.current = null;
      }
    };

    try {
      // -------------------------------------------
      // PATH 1: Electron (serverless local storage)
      // -------------------------------------------
      if (typeof window !== 'undefined' && window.onestar?.saveMedia) {
        // Start a fake progress timer that slowly approaches ~90%
        stopFakeTimer();
        fakeTimerRef.current = window.setInterval(() => {
          setProgress((prev) => {
            if (prev >= 90) return prev;
            return prev + 1;
          });
        }, 150);

        const result = await window.onestar.saveMedia({
          file,
          title,
          type,
          downloadable,
        });

        stopFakeTimer();
        setProgress(100);

        if (!result?.ok) {
          setStatus('Upload failed');
          return;
        }

        setStatus('Uploaded!');
        form.reset();
        return;
      }

      // -------------------------------------------
      // PATH 2: Fallback – upload to droplet via XHR
      // -------------------------------------------
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/media');

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = (event.loaded / event.total) * 100;
            setProgress(percent);
          }
        };

        xhr.onerror = () => {
          reject(new Error('XHR upload error'));
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            resolve();
          } else {
            reject(
              new Error(
                `Upload failed with status ${xhr.status}: ${xhr.responseText || ''}`
              )
            );
          }
        };

        xhr.send(formData);
      });

      setStatus('Uploaded!');
      form.reset();
    } catch (err) {
      console.error('Upload failed:', err);
      setStatus('Upload failed');
    } finally {
      stopFakeTimer();
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        setDisplayProgress(0);
      }, 400); // small delay so bar can finish nicely
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
  // UPLOAD UI (UNCHANGED STYLING)
  // -------------------------------
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: 16 }}>
      <h1>OnestarStream – Upload</h1>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <label>
          File
          <input
            name="file"
            type="file"
            required
            accept=".wav,.wave,.flac,.mp3,.m4a,.alac,.aiff,.aif,audio/*"
          />
        </label>

        <label>
          Title
          <input name="title" type="text" placeholder="Optional title" />
        </label>

        <label>
          Type
          <select name="type" defaultValue="audio">
            <option value="audio">Audio</option>
            <option value="video">Video</option>
            <option value="image">Image</option>
          </select>
        </label>

        <label>
          <input type="checkbox" name="downloadable" defaultChecked />
          Downloadable
        </label>

        <button type="submit" disabled={uploading}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {/* Magenta progress bar with smooth width animation */}
      {uploading && (
        <div
          style={{
            marginTop: 12,
            width: '100%',
            height: 6,
            borderRadius: 999,
            background: '#f3e0f7',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              // Ensure it never shows as 0 when uploading; and clamp at 100
              width: `${Math.min(
                100,
                Math.max(displayProgress, 5)
              )}%`,
              height: '100%',
              background: '#6833c5ff',
              transition: 'width 120ms linear',
            }}
          />
        </div>
      )}

      {status && <p style={{ marginTop: 12 }}>{status}</p>}

      <p style={{ marginTop: 24 }}>
        <a href="/app">← Back to library</a>
      </p>
    </main>
  );
}

