'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ResetPasswordPage() {
  const router = useRouter();

  // Token from URL (read client-side to avoid useSearchParams + Suspense issues)
  const [tokenFromUrl, setTokenFromUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const t = params.get('token');
      setTokenFromUrl(t);
    }
  }, []);

  // Token we might get back from the forgot-password API when no token is in the URL.
  const [localToken, setLocalToken] = useState<string | null>(null);

  // Effective token: either from the URL or from the API response.
  const token = tokenFromUrl || localToken;

  // Mode A: requesting reset link (no token yet)
  const [email, setEmail] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestSubmitted, setRequestSubmitted] = useState(false);

  // Mode B: setting new password (token present)
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRequestError(null);
    setRequestLoading(true);

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data: any = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setRequestError(data.error || 'Failed to request password reset.');
        return;
      }

      // If the backend generated a token (user exists), use it directly so
      // we can proceed without relying on email delivery.
      if (data.token) {
        setLocalToken(data.token);
      }

      setRequestSubmitted(true);
    } catch (err) {
      console.error('Reset request error:', err);
      setRequestError('Failed to request password reset.');
    } finally {
      setRequestLoading(false);
    }
  };

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetError(null);

    if (!token) {
      setResetError('Missing reset token.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    if (newPassword.length < 8) {
      setResetError('Password must be at least 8 characters long.');
      return;
    }

    setResetLoading(true);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });

      const data: any = await res.json().catch(() => ({}));

      if (!res.ok || !data.ok) {
        setResetError(data.error || 'Failed to reset password.');
        return;
      }

      setResetSuccess(true);

      // Optional: redirect back to sign-in after a short delay.
      setTimeout(() => {
        router.push('/auth/signin');
      }, 2000);
    } catch (err) {
      console.error('Reset password error:', err);
      setResetError('Failed to reset password.');
    } finally {
      setResetLoading(false);
    }
  };

  const renderRequestForm = () => (
    <>
      <p style={{ marginBottom: 16 }}>
        Enter the email associated with your account. If we find a matching
        account, we&apos;ll generate a secure reset token and let you choose a
        new password right here.
      </p>

      {!requestSubmitted ? (
        <form onSubmit={handleRequestSubmit} style={{ display: 'grid', gap: 12 }}>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <button type="submit" disabled={requestLoading}>
            {requestLoading ? 'Processing…' : 'Continue'}
          </button>
        </form>
      ) : (
        <p style={{ marginTop: 16 }}>
          If we found an account for <strong>{email}</strong>, we generated a
          reset token. You can now set a new password below. If email delivery
          is configured, a reset link may also be sent to you, but it&apos;s not
          required to finish this step.
        </p>
      )}

      {requestError && (
        <p style={{ color: 'red', marginTop: 10 }}>{requestError}</p>
      )}
    </>
  );

  const renderResetForm = () => (
    <>
      <p style={{ marginBottom: 16 }}>
        Choose a new password for your account.
      </p>

      {!resetSuccess ? (
        <form onSubmit={handleResetSubmit} style={{ display: 'grid', gap: 12 }}>
          <input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />

          <button type="submit" disabled={resetLoading}>
            {resetLoading ? 'Updating…' : 'Reset password'}
          </button>
        </form>
      ) : (
        <p style={{ marginTop: 16 }}>
          Your password has been reset. Redirecting you to the login page…
        </p>
      )}

      {resetError && (
        <p style={{ color: 'red', marginTop: 10 }}>{resetError}</p>
      )}
    </>
  );

  const hasToken = !!token;

  return (
    <main style={{ maxWidth: 400, margin: '0 auto', padding: 16 }}>
      <h1>Reset your password</h1>

      {hasToken ? renderResetForm() : renderRequestForm()}

      <p style={{ marginTop: 24 }}>
        Remembered your password? <a href="/auth/signin">Back to login</a>
      </p>
    </main>
  );
}
