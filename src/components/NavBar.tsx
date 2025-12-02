'use client';

import { useEffect, useState } from 'react';

export function NavBar() {
  const [auth, setAuth] = useState<boolean | null>(null);

  // Check login state
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(res => res.json())
      .then(data => setAuth(!!data.user))
      .catch(() => setAuth(false));
  }, []);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/auth/signin';
  }

  return (
    <header
      style={{
        width: '100%',
        padding: '12px 24px',
        borderBottom: '1px solid #ddd',
        marginBottom: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <a href="/" style={{ fontSize: 20, fontWeight: 600, textDecoration: 'none' }}>
        OnestarStream
      </a>

      {/* While auth is loading */}
      {auth === null && <nav>Loading…</nav>}

      {/* Logged out */}
      {auth === false && (
        <nav style={{ display: 'flex', gap: 16 }}>
          <a href="/auth/signup">Sign Up</a>
          <a href="/auth/signin">Sign In</a>
        </nav>
      )}

      {/* Logged in */}
      {auth === true && (
      <nav style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <a href="/app">Player</a>
          <a href="/upload">Upload</a>
          <a href="/library">Library</a>
          <a href="/inbox">Inbox</a>
          <button
            onClick={handleLogout}
            style={{
              border: 'none',
              background: 'none',
              cursor: 'pointer',
              color: '#0070f3',
            }}
          >
            Logout
          </button>
        </nav>
      )}
    </header>
  );
}
