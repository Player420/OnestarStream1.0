import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <section style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>OnestarStream</h1>
        <p style={{ opacity: 0.8, maxWidth: 620 }}>
          Local-first, serverless-style streaming and file sharing between trusted
          users. Your media stays on your machines; the app only coordinates
          accounts, sharing, and permissions.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 16, flexWrap: 'wrap' }}>
          <Link
            href="/auth/signup"
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              border: '1px solid #111',
              background: '#111',
              color: 'white',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            Create account
          </Link>
          <Link
            href="/auth/signin"
            style={{
              padding: '8px 16px',
              borderRadius: 4,
              border: '1px solid #ccc',
              textDecoration: 'none',
              fontSize: 14,
            }}
          >
            Log in
          </Link>
        </div>

        <p style={{ marginTop: 16, fontSize: 12, opacity: 0.75 }}>
          By creating an account or using this app, you agree to the{' '}
          <Link href="/tos" style={{ textDecoration: 'underline' }}>
            Terms of Service
          </Link>
          .
        </p>
      </section>

      <section style={{ fontSize: 13, opacity: 0.85 }}>
        <h2 style={{ fontSize: 18, marginBottom: 8 }}>How it works</h2>
        <ul style={{ paddingLeft: 20, margin: 0 }}>
          <li>Upload your own audio/video/image files into your local library.</li>
          <li>Share tracks with other registered OnestarStream users via their username or email.</li>
          <li>
            If a share is <strong>downloadable</strong>, the recipient can download a copy
            to their local media folder.
          </li>
          <li>
            If a share is <strong>protected</strong>, they can stream it in-app only and cannot
            redistribute it via the app.
          </li>
        </ul>
      </section>
    </main>
  );
}
