export default function SignupPage() {
  return (
    <main style={{ maxWidth: 600, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 16 }}>Sign up for OnestarStream</h1>
      <p style={{ opacity: 0.7 }}>
        The actual sign up flow isn&apos;t wired yet, but this route exists so
        you don&apos;t see a 404. We&apos;ll hook this up to the encrypted
        user store and auth API next.
      </p>
    </main>
  );
}
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, username, password }),
    });

    if (res.ok) {
      router.push('/auth/signin');
    } else {
      const data = await res.json();
      setError(data.error || 'An error occurred');
    }
  };

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: 16 }}>
      <h1>Sign Up</h1>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button type="submit">Sign Up</button>
      </form>
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </main>
  );
}
