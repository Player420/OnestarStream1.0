'use client';

import { useEffect, useState } from 'react';
import { redirect } from 'next/navigation';

export default function RootPage() {
  const [auth, setAuth] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        // Logged in
        if (data?.user) {
          setAuth(true);
        } else {
          setAuth(false);
        }
      })
      .catch(() => setAuth(false));
  }, []);

  // Still checking auth
  if (auth === null) {
    return <main style={{ padding: 24 }}>Loading...</main>;
  }

  // LOGGED IN → Go to /app
  if (auth === true) {
    redirect('/app');
  }

  // LOGGED OUT → Show landing page
  return (
    <main style={{ padding: 24 }}>
      <h1>OnestarStream</h1>
      <p>Local serverless-style streaming & file sharing MVP.</p>

      <div style={{ marginTop: 20 }}>
        <a href="/auth/signup" style={{ marginRight: 16 }}>Sign up</a>
        <a href="/auth/signin">Sign in</a>
      </div>
    </main>
  );
}
