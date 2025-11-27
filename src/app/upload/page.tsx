'use client';

import { FormEvent, useState, useEffect } from 'react';
import { redirect } from 'next/navigation';

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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    setStatus('Uploading…');
    setUploading(true);

    try {
      const res = await fetch('/api/media', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        console.error('Upload failed. Status:', res.status, 'Body:', text);
        setStatus('Upload failed');
        return;
      }

      setStatus('Uploaded!');
      form.reset();
    } catch (err) {
      console.error('Upload failed:', err);
      setStatus('Upload failed');
    } finally {
      setUploading(false);
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
  // ORIGINAL UPLOAD UI (UNCHANGED)
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

      {/* Magenta progress bar while uploading */}
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
              width: '100%',
              height: '100%',
              background: '#6833c5ff',
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
