'use client';

import { useEffect, useState } from 'react';
import { useBackgroundSync } from '@/lib/BackgroundSyncProvider';
import { formatRelativeTime } from '@/lib/timeUtils';

export function NavBar() {
  const [auth, setAuth] = useState<boolean | null>(null);
  const { syncStatus, nextRun, healthReport } = useBackgroundSync();

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

  // Determine badge color and text
  const getBadgeStyle = () => {
    switch (syncStatus) {
      case 'up-to-date':
        return { backgroundColor: '#10b981', color: 'white', text: '✓' };
      case 'needs-sync':
        return { backgroundColor: '#ef4444', color: 'white', text: '!' };
      case 'syncing':
        return { backgroundColor: '#f59e0b', color: 'white', text: '↻' };
      case 'error':
        return { backgroundColor: '#dc2626', color: 'white', text: '✕' };
      default:
        return { backgroundColor: '#6b7280', color: 'white', text: '·' };
    }
  };

  const badgeStyle = getBadgeStyle();

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
          <a href="/settings/sync" style={{ display: 'flex', alignItems: 'center', gap: 8, position: 'relative' }}>
            Settings
            {/* Phase 23 Sync Badge */}
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                borderRadius: '50%',
                fontSize: 12,
                fontWeight: 'bold',
                ...badgeStyle,
              }}
              title={`Sync status: ${syncStatus}${nextRun ? ` • Next run: ${formatRelativeTime(nextRun)}` : ''}`}
            >
              {badgeStyle.text}
            </span>
            {healthReport?.warnings && healthReport.warnings.length > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  backgroundColor: '#dc2626',
                  color: 'white',
                  borderRadius: '50%',
                  width: 12,
                  height: 12,
                  fontSize: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {healthReport.warnings.length}
              </span>
            )}
          </a>
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
