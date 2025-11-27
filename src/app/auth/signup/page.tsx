'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignupPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
      });

      let data: any = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        setError(data.error || 'An unexpected error occurred');
        return;
      }

      // User is created and session cookie set → go straight to /app
      router.push('/app');
    } catch (err) {
      console.error('Signup error:', err);
      setError('Failed to sign up.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: 16 }}>
      <h1>Sign Up</h1>

      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
        <input
          type="email"
          placeholder="Email address"
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

        <button type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Sign Up'}
        </button>
      </form>

      {error && (
        <p style={{ color: 'red', marginTop: 10 }}>
          {error}
        </p>
      )}

      <p style={{ marginTop: 20 }}>
        Already have an account? <a href="/auth/signin">Log in</a>
      </p>
    </main>
  );
}
