'use client';

import { FormEvent, useState, useEffect, useRef } from 'react';
import { redirect } from 'next/navigation';

type MediaType = 'audio' | 'video' | 'image';


export default function UploadPage() {
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setAuth(!!d.user))
      .catch(() => setAuth(false));
  }, []);

  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const fakeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!uploading) return;

    let frame: number;

    const animate = () => {
      setDisplayProgress(prev => {
        const diff = progress - prev;
        if (Math.abs(diff) < 0.1) return progress;
        return prev + diff * 0.2;
      });

      frame = requestAnimationFrame(animate);
    };

    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [uploading, progress]);

  useEffect(() => {
    return () => {
      if (fakeTimerRef.current !== null) clearInterval(fakeTimerRef.current);
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

    setUploading(true);
    setStatus('Uploading…');
    setProgress(0);
    setDisplayProgress(0);

    const stopFake = () => {
      if (fakeTimerRef.current !== null) {
        clearInterval(fakeTimerRef.current);
        fakeTimerRef.current = null;
      }
    };

    try {
      const w = window as any;

      if (
        w.onestar?.startChunkedSave &&
        w.onestar?.appendChunk &&
        w.onestar?.finishChunkedSave
      ) {
        stopFake();
        fakeTimerRef.current = window.setInterval(() => {
          setProgress(prev => (prev < 90 ? prev + 1 : prev));
        }, 150);

        // FIXED ARGUMENT SHAPE — DO NOT SEND File OBJECT
        const start = await w.onestar.startChunkedSave({
          originalName: file.name, // REQUIRED by main.ts
          title,
          type,
          downloadable,
        });

        if (!start?.ok || !start.data?.sessionId) {
          stopFake();
          setStatus('Upload failed (start)');
          setUploading(false);
          return;
        }

        const sessionId = start.data.sessionId;

        // Chunking loop
        const chunkSize = 1024 * 1024 * 2; // 2MB
        let offset = 0;

        while (offset < file.size) {
          const slice = file.slice(offset, offset + chunkSize);
          const chunk = new Uint8Array(await slice.arrayBuffer());

          const res = await w.onestar.appendChunk({ sessionId, chunk });
          if (!res?.ok) {
            stopFake();
            setStatus('Upload failed (append)');
            setUploading(false);
            return;
          }

          offset += chunkSize;
          setProgress((offset / file.size) * 100);
        }

        const finish = await w.onestar.finishChunkedSave({ sessionId });
        stopFake();
        setProgress(100);

        if (!finish?.ok) {
          setStatus('Upload failed (finish)');
          return;
        }

        setStatus('Uploaded!');
        form.reset();
        return;
      }

      // Fallback XHR (unchanged)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/media');

        xhr.upload.onprogress = evt => {
          if (evt.lengthComputable) {
            setProgress((evt.loaded / evt.total) * 100);
          }
        };

        xhr.onerror = () => reject(new Error('XHR error'));

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            setProgress(100);
            resolve();
          } else {
            reject(new Error(xhr.responseText));
          }
        };

        xhr.send(formData);
      });

      setStatus('Uploaded!');
      form.reset();
    } catch (err) {
      console.error(err);
      setStatus('Upload failed');
    } finally {
      setTimeout(() => {
        setUploading(false);
        setProgress(0);
        setDisplayProgress(0);
      }, 400);
    }
  }

  if (auth === null) return <main style={{ padding: 24 }}>Checking session…</main>;
  if (auth === false) redirect('/auth/signin');

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

      {uploading && (
        <div
          style={{
            marginTop: 12,
            width: '100%',
            height: 6,
            borderRadius: 999,
            background: '#f3e0f7',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(displayProgress, 5))}%`,
              height: '100%',
              background: '#6833c5ff',
              transition: 'width 120ms linear'
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
