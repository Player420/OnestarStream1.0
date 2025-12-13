// src/lib/mail.ts

// Use CommonJS require so TypeScript doesn't need type declarations for nodemailer.
const nodemailer = require('nodemailer') as any;

/**
 * Send a password reset email if SMTP is configured.
 * If not configured, falls back to logging the reset URL.
 */
export async function sendPasswordResetEmail(
  toEmail: string,
  resetUrl: string
): Promise<void> {
  const host = process.env.SMTP_HOST;
  const portStr = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || 'no-reply@onestarstream.local';

  // If SMTP is not configured, don't break the app – just log.
  if (!host || !portStr || !user || !pass) {
    console.warn(
      '[mail] SMTP not fully configured. Logging reset link instead of sending email.'
    );
    console.log('[mail] Password reset link for', toEmail, '=>', resetUrl);
    return;
  }

  const port = Number(portStr) || 587;
  const secure = port === 465;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const subject = 'Reset your OnestarStream password';
  const textBody = [
    'You requested a password reset for your OnestarStream account.',
    '',
    'Click the link below to set a new password:',
    resetUrl,
    '',
    'If you did not request this, you can safely ignore this email.',
  ].join('\n');

  const htmlBody = `
    <p>You requested a password reset for your OnestarStream account.</p>
    <p>
      Click the link below to set a new password:<br/>
      <a href="${resetUrl}">${resetUrl}</a>
    </p>
    <p>If you did not request this, you can safely ignore this email.</p>
  `;

  try {
    await transporter.sendMail({
      from,
      to: toEmail,
      subject,
      text: textBody,
      html: htmlBody,
    });

    console.log('[mail] Sent password reset email to', toEmail);
  } catch (err: any) {
    console.error('[mail] Error sending password reset email:', err);
    // Fallback: at least log the URL.
    console.log('[mail] Password reset link for', toEmail, '=>', resetUrl);
  }
}
