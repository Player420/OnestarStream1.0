'use client';

import { useEffect, useState } from 'react';

interface MeUser {
  id: string;
  email: string;
  username: string;
  createdAt: string;
}

interface MeResponse {
  authenticated: boolean;
  user: MeUser | null;
}

export function CurrentUserBadge() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMe() {
      try {
        const res = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) setError('Auth check failed');
          return;
        }
        const data = (await res.json()) as MeResponse;
        if (!cancelled) setMe(data);
      } catch (err) {
        console.error('Error fetching /api/auth/me:', err);
        if (!cancelled) setError('Auth check failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || error) {
    return null;
  }

  if (!me || !me.authenticated || !me.user) {
    return (
      <a
        href="/auth/signin"
        style={{
          fontSize: 12,
          textDecoration: 'none',
          border: '1px solid #555',
          borderRadius: 4,
          padding: '4px 8px',
        }}
      >
        Sign in
      </a>
    );
  }

  const username = me.user.username || me.user.email;

  // Minimal: JUST the username — no logout button
  return (
    <span
      style={{
        fontWeight: 500,
        fontSize: 12,
      }}
    >
      {username}
    </span>
  );
}
