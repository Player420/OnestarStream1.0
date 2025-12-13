'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Step = 'welcome' | 'account' | 'tos' | 'eula' | 'waiting' | 'done';
type LicenseStatus = 'none' | 'pending' | 'active' | 'revoked';

interface LicenseStatusResponse {
  ok: boolean;
  status: LicenseStatus;
  licenseKey?: string;
}

interface EnsureLicenseResponse {
  ok: boolean;
  identifier?: string;
  licenseKey?: string;
  licenseStatus?: LicenseStatus;
  error?: string;
}

// Optional remote base; if not set, we use same-origin (/api/...)
const LICENSE_API_BASE = process.env.NEXT_PUBLIC_LICENSE_API_BASE || '';

export default function SetupPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('welcome');

  // Account form – ONLY kept in memory until final step.
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [accountError, setAccountError] = useState<string | null>(null);

  // Identifier used for license (email preferred)
  const [licenseIdentifier, setLicenseIdentifier] = useState('');

  // TOS / legal state
  const [tosAccepted, setTosAccepted] = useState(false);
  const [tosError, setTosError] = useState<string | null>(null);
  const [hasScrolledTosToBottom, setHasScrolledTosToBottom] =
    useState(false);

  // EULA state
  const [eulaAccepted, setEulaAccepted] = useState(false);
  const [eulaError, setEulaError] = useState<string | null>(null);
  const [hasScrolledEulaToBottom, setHasScrolledEulaToBottom] =
    useState(false);

  // License state
  const [license, setLicense] = useState<LicenseStatusResponse | null>(null);
  const [licenseError, setLicenseError] = useState<string | null>(null);

  // Finalization
  const [finishLoading, setFinishLoading] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // Listen for scroll-to-bottom message from /tos and /eula iframes
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (typeof window === 'undefined') return;
      if (event.origin !== window.location.origin) return;

      if (
        event.data &&
        typeof event.data === 'object' &&
        event.data.type === 'onestar_tos_scrolled_bottom'
      ) {
        setHasScrolledTosToBottom(true);
      }

      if (
        event.data &&
        typeof event.data === 'object' &&
        event.data.type === 'onestar_eula_scrolled_bottom'
      ) {
        setHasScrolledEulaToBottom(true);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  /**
   * STEP 4: License activation
   *
   * Behaviour:
   * - Requires an internet connection.
   * - First tries to auto-issue a license via POST {BASE}/api/license/ensure.
   *   (This runs on YOUR license server that has ONESTAR_ADMIN_KEY.)
   * - If that works and licenseStatus === 'active', go straight to 'done'.
   * - If auto-issue is not available (503) or fails, fall back to polling
   *   {BASE}/api/license/status until an admin activates.
   */
  useEffect(() => {
    if (step !== 'waiting') return;
    if (!licenseIdentifier) {
      setLicenseError(
        'No license identifier set. Please restart setup and enter your account details.',
      );
      return;
    }

    let cancelled = false;
    const base = LICENSE_API_BASE || '';

    const pollStatus = async () => {
      try {
        const url = `${base}/api/license/status?identifier=${encodeURIComponent(
          licenseIdentifier,
        )}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: LicenseStatusResponse = await res.json();
        if (cancelled) return;

        setLicense(data);

        if (data.status === 'active') {
          setStep('done');
        } else if (!cancelled) {
          setTimeout(pollStatus, 5000);
        }
      } catch {
        if (!cancelled) {
          setLicenseError('Error checking license status. Retrying…');
          setTimeout(pollStatus, 5000);
        }
      }
    };

    const ensureLicense = async () => {
      setLicenseError(null);

      // Must be online to activate
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setLicenseError(
          'You must be online to complete license activation. Please connect to the internet and try again.',
        );
        return;
      }

      try {
        const url = `${base}/api/license/ensure`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: licenseIdentifier }),
        });

        // If auto-issue is not available (e.g. license server without admin key),
        // fall back to polling.
        if (res.status === 503) {
          if (!cancelled) {
            setLicenseError(
              'Automatic license activation is not available for this build. Waiting for admin activation…',
            );
            void pollStatus();
          }
          return;
        }

        let data: EnsureLicenseResponse | null = null;
        try {
          data = await res.json();
        } catch {
          data = null;
        }

        if (cancelled) return;

        if (!res.ok || !data || !data.ok || !data.licenseStatus) {
          setLicenseError(
            (data && data.error) ||
              'Automatic license activation failed. Waiting for admin activation…',
          );
          void pollStatus();
          return;
        }

        const status: LicenseStatus = data.licenseStatus || 'none';
        const licensePayload: LicenseStatusResponse = {
          ok: data.ok,
          status,
          licenseKey: data.licenseKey,
        };
        setLicense(licensePayload);

        if (status === 'active') {
          setStep('done');
        } else {
          void pollStatus();
        }
      } catch {
        if (!cancelled) {
          setLicenseError(
            'Automatic license activation failed. Waiting for admin activation…',
          );
          void pollStatus();
        }
      }
    };

    void ensureLicense();

    return () => {
      cancelled = true;
    };
  }, [step, licenseIdentifier]);

  // STEP 2: Account – validate only, no signup call.
  const handleAccountContinue = (e: FormEvent) => {
    e.preventDefault();
    setAccountError(null);

    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    // Level 0 email validation – basic "looks like an email" check.
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!trimmedEmail) {
      setAccountError('Email is required.');
      return;
    }
    if (!emailPattern.test(trimmedEmail)) {
      setAccountError('Please enter a valid email address.');
      return;
    }
    if (!trimmedUsername) {
      setAccountError('Username is required.');
      return;
    }

    if (password.length < 8) {
      setAccountError('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setAccountError('Passwords do not match.');
      return;
    }

    // For licensing, we primarily use the email as the identifier.
    const identifier = trimmedEmail;
    setLicenseIdentifier(identifier);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('onestar_license_identifier', identifier);
    }

    setStep('tos');
  };

  // STEP 3: TOS – set flags, go to EULA; still no user created.
  const handleTosContinue = () => {
    setTosError(null);

    if (!hasScrolledTosToBottom) {
      setTosError('Please scroll to the bottom of the Terms of Service.');
      return;
    }
    if (!tosAccepted) {
      setTosError('You must agree to the Terms to continue.');
      return;
    }

    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();
    const id = licenseIdentifier || trimmedEmail || trimmedUsername;

    if (!id) {
      setTosError(
        'No identifier found. Please go back and enter your email and username.',
      );
      return;
    }

    setLicenseIdentifier(id);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('onestar_tos_accepted', 'yes');
      window.localStorage.setItem('onestar_license_identifier', id);
    }

    setStep('eula');
  };

  // STEP 4: EULA – must scroll + check the box
  const handleEulaContinue = () => {
    setEulaError(null);

    if (!hasScrolledEulaToBottom) {
      setEulaError('Please scroll to the bottom of the EULA.');
      return;
    }

    if (!eulaAccepted) {
      setEulaError('You must agree to the EULA to continue.');
      return;
    }

    // Move to license activation step
    setStep('waiting');
  };

  // STEP 5: Only here do we create/sign in the user.
  // This is the *only* place we call /api/auth/signup and /api/auth/signin.
  const handleFinish = async () => {
    setFinishError(null);

    const trimmedEmail = email.trim();
    const trimmedUsername = username.trim();

    if (!trimmedEmail || !trimmedUsername) {
      setFinishError(
        'Missing credentials. Please restart setup and enter your email and username.',
      );
      return;
    }

    if (!password) {
      setFinishError(
        'Missing password. Please restart setup and enter your account details.',
      );
      return;
    }

    setFinishLoading(true);

    try {
      // 1) Try to create a new user
      let canProceedToSignin = true;

      try {
        const signupRes = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: trimmedEmail,
            username: trimmedUsername,
            password,
          }),
        });

        let signupData: any = null;
        try {
          signupData = await signupRes.json();
        } catch {
          // ignore
        }

        if (!signupRes.ok || !signupData?.ok) {
          const msg =
            (signupData && (signupData.error || signupData.message)) || '';

          const looksLikeExists =
            signupRes.status === 409 ||
            /already exists/i.test(msg) ||
            /already in use/i.test(msg) ||
            /user exists/i.test(msg);

          // If it's not "already exists", fail here.
          if (!looksLikeExists) {
            setFinishError(
              signupData?.error ||
                'Failed to create account. Please try again or choose a different email/username.',
            );
            canProceedToSignin = false;
          }
        }
      } catch {
        // If signup network fails, we still *attempt* signin:
        // maybe the user already exists from a previous run.
      }

      if (!canProceedToSignin) {
        setFinishLoading(false);
        return;
      }

      // 2) Sign in with the same credentials (fresh or existing user)
      try {
        const signinRes = await fetch('/api/auth/signin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: trimmedEmail,
            username: trimmedUsername,
            password,
          }),
        });

        let signinData: any = null;
        try {
          signinData = await signinRes.json();
        } catch {
          // ignore
        }

        if (!signinRes.ok || !signinData?.ok) {
          setFinishError(
            signinData?.error ||
              'Account exists but sign-in failed. Please check your password.',
          );
          setFinishLoading(false);
          return;
        }
      } catch {
        setFinishError('Sign-in failed due to a network or server error.');
        setFinishLoading(false);
        return;
      }

      // 3) All green → enter the app
      router.push('/app');
    } catch {
      setFinishError('Unexpected error during finalization.');
    } finally {
      setFinishLoading(false);
    }
  };

  // --- Render helpers ---

  const renderWelcome = () => (
    <section style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1>Welcome to OnestarStream</h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        This setup will collect your account details, capture your agreement to
        the legal terms, and activate your license. Your account is only created
        after you complete the entire flow.
      </p>
      <p style={{ opacity: 0.7, fontSize: 13 }}>
        You must be online to complete license activation.
      </p>
      <button
        type="button"
        onClick={() => setStep('account')}
        style={{
          padding: '8px 16px',
          borderRadius: 4,
          border: '1px solid #333',
          background: '#111',
          color: '#f5f5f5',
          cursor: 'pointer',
          marginTop: 12,
        }}
      >
        Begin setup
      </button>
    </section>
  );

  const renderAccount = () => (
    <section style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1>Account details</h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        Enter the credentials you will use to sign in. Your account will only be
        created once you have accepted the Terms and your license is active.
        Both email and username are required.
      </p>

      <form
        onSubmit={handleAccountContinue}
        style={{ display: 'grid', gap: 12, maxWidth: 400 }}
      >
        <label style={{ display: 'grid', gap: 4 }}>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              padding: 6,
              borderRadius: 4,
              border: '1px solid #ccc',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          Username
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{
              padding: 6,
              borderRadius: 4,
              border: '1px solid #ccc',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          Password
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              padding: 6,
              borderRadius: 4,
              border: '1px solid #ccc',
            }}
          />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          Confirm password
          <input
            type="password"
            required
            minLength={8}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            style={{
              padding: 6,
              borderRadius: 4,
              border: '1px solid #ccc',
            }}
          />
        </label>

        {accountError && (
          <p style={{ color: '#b00020', fontSize: 13 }}>{accountError}</p>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            onClick={() => setStep('welcome')}
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #999',
              background: '#f2f2f2',
              cursor: 'pointer',
            }}
          >
            Back
          </button>
          <button
            type="submit"
            style={{
              padding: '6px 12px',
              borderRadius: 4,
              border: '1px solid #333',
              background: '#111',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Continue
          </button>
        </div>
      </form>
    </section>
  );

  const renderTos = () => (
    <section style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1>Legal Agreements</h1>
      <p style={{ opacity: 0.8, marginBottom: 12 }}>
        Please review the Terms of Service. You must scroll to the bottom and
        agree before continuing. By agreeing, you also accept the Privacy
        Policy and End User License Agreement (EULA).
      </p>

      <div
        style={{
          border: '1px solid #ccc',
          borderRadius: 4,
          height: 260,
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        <iframe
          src="/tos"
          title="OnestarStream Terms of Service"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>

      <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        Scroll to the bottom of the Terms window to enable the checkbox.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          opacity: hasScrolledTosToBottom ? 1 : 0.6,
        }}
      >
        <input
          type="checkbox"
          checked={tosAccepted}
          disabled={!hasScrolledTosToBottom}
          onChange={(e) => setTosAccepted(e.target.checked)}
        />
        <span>
          I have read and agree to the Terms of Service, Privacy Policy, and End
          User License Agreement (EULA).
        </span>
      </label>

      <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
        You can review these documents at any time:{' '}
        <a href="/tos" target="_blank" rel="noreferrer">
          Terms of Service
        </a>
        {' · '}
        <a href="/privacy" target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        {' · '}
        <a href="/eula" target="_blank" rel="noreferrer">
          EULA
        </a>
        .
      </p>

      {tosError && (
        <p style={{ color: '#b00020', fontSize: 13 }}>{tosError}</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => setStep('account')}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid #999',
            background: '#f2f2f2',
            cursor: 'pointer',
          }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleTosContinue}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid #333',
            background: '#111',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Continue
        </button>
      </div>
    </section>
  );

  const renderEula = () => (
    <section style={{ maxWidth: 800, margin: '0 auto' }}>
      <h1>End User License Agreement (EULA)</h1>
      <p style={{ opacity: 0.8, marginBottom: 12 }}>
        Please review the EULA. You must scroll to the bottom and agree before
        continuing.
      </p>

      <div
        style={{
          border: '1px solid #ccc',
          borderRadius: 4,
          height: 260,
          overflow: 'hidden',
          marginBottom: 12,
        }}
      >
        <iframe
          src="/eula"
          title="OnestarStream End User License Agreement"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      </div>

      <p style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
        Scroll to the bottom of the EULA window to enable the checkbox.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
          opacity: hasScrolledEulaToBottom ? 1 : 0.6,
        }}
      >
        <input
          type="checkbox"
          checked={eulaAccepted}
          disabled={!hasScrolledEulaToBottom}
          onChange={(e) => setEulaAccepted(e.target.checked)}
        />
        <span>
          I have read and agree to the End User License Agreement (EULA).
        </span>
      </label>

      {eulaError && (
        <p style={{ color: '#b00020', fontSize: 13 }}>{eulaError}</p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => setStep('tos')}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid #999',
            background: '#f2f2f2',
            cursor: 'pointer',
          }}
        >
          Back
        </button>

        <button
          type="button"
          onClick={handleEulaContinue}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid #333',
            background: '#111',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Continue
        </button>
      </div>
    </section>
  );

  const renderWaiting = () => (
    <section style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1>License activation</h1>
      <p style={{ opacity: 0.8, marginBottom: 12 }}>
        Your installation requires a license to activate. We are contacting the
        license service to activate your license for this identifier:
      </p>

      <p style={{ fontSize: 13 }}>
        <strong>Identifier:</strong> {licenseIdentifier || '–'}
      </p>

      <p style={{ fontSize: 13, opacity: 0.8 }}>
        You must be online to complete license activation. On builds where
        automatic activation is not available, this screen will wait for an
        administrator to activate the license.
      </p>

      {licenseError && (
        <p style={{ color: '#b00020', fontSize: 13, marginTop: 8 }}>
          {licenseError}
        </p>
      )}

      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 4,
          border: '1px dashed #aaa',
          fontSize: 13,
        }}
      >
        <p style={{ margin: 0, marginBottom: 4 }}>
          Current status:{' '}
          <strong>{license?.status ?? 'pending'}</strong>
        </p>
        {license?.licenseKey && (
          <p style={{ margin: 0 }}>
            License key: <code>{license.licenseKey}</code>
          </p>
        )}
      </div>
    </section>
  );

  const renderDone = () => (
    <section style={{ maxWidth: 600, margin: '0 auto' }}>
      <h1>Setup complete</h1>
      <p style={{ opacity: 0.8, marginBottom: 12 }}>
        Your license is active. Your OnestarStream account will be created and
        signed in when you continue.
      </p>

      {license?.licenseKey && (
        <p style={{ fontSize: 13 }}>
          Your license key:{' '}
          <code style={{ fontSize: 13 }}>{license.licenseKey}</code>
        </p>
      )}

      {finishError && (
        <p style={{ color: '#b00020', fontSize: 13, marginTop: 8 }}>
          {finishError}</p>
      )}

      <button
        type="button"
        onClick={handleFinish}
        disabled={finishLoading}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          borderRadius: 4,
          border: '1px solid #333',
          background: finishLoading ? '#777' : '#111',
          color: '#fff',
          cursor: finishLoading ? 'default' : 'pointer',
        }}
      >
        {finishLoading ? 'Finalizing account…' : 'Launch OnestarStream'}
      </button>
    </section>
  );

  const stepLabel =
    step === 'welcome'
      ? '1 of 6 – Welcome'
      : step === 'account'
      ? '2 of 6 – Account'
      : step === 'tos'
      ? '3 of 6 – Terms of Service'
      : step === 'eula'
      ? '4 of 6 – End User License Agreement'
      : step === 'waiting'
      ? '5 of 6 – License Activation'
      : '6 of 6 – Complete';

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <header style={{ marginBottom: 24 }}>
        <h2 style={{ marginBottom: 4 }}>OnestarStream Setup</h2>
        <p style={{ opacity: 0.7, fontSize: 13 }}>Step {stepLabel}</p>
      </header>

      {step === 'welcome' && renderWelcome()}
      {step === 'account' && renderAccount()}
      {step === 'tos' && renderTos()}
      {step === 'eula' && renderEula()}
      {step === 'waiting' && renderWaiting()}
      {step === 'done' && renderDone()}
    </main>
  );
}
