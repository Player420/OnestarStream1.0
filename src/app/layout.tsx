import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import NavBar from '@/components/NavBar';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'OnestarStream',
  description: 'Local serverless-style streaming & file sharing MVP.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {/* Global nav (auth-aware, lives in client NavBar) */}
        <NavBar />

        {/* Page content */}
        <div style={{ maxWidth: 900, margin: '0 auto', padding: 16 }}>
          {children}
        </div>

        {/* Simple footer with TOS link */}
        <footer
          style={{
            width: '100%',
            borderTop: '1px solid #ddd',
            marginTop: 32,
            padding: '12px 16px',
            fontSize: 12,
            textAlign: 'center',
            opacity: 0.75,
          }}
        >
          <span>OnestarStream © {new Date().getFullYear()}</span>{' '}
          <span>•</span>{' '}
          <a href="/tos" style={{ textDecoration: 'underline' }}>
            Terms of Service
          </a>
        </footer>
      </body>
    </html>
  );
}
