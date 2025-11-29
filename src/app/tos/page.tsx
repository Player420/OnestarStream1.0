'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const TOS_STORAGE_KEY = 'onestar_tos_v1_accepted';

export default function TosPage() {
  const router = useRouter();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const accepted = localStorage.getItem(TOS_STORAGE_KEY);
    if (accepted === 'true') {
      router.replace('/app');
      return;
    }
    setInitializing(false);
  }, [router]);

  if (initializing) {
    return <main style={{ padding: 24 }}>Loading…</main>;
  }

  function handleAccept() {
    localStorage.setItem(TOS_STORAGE_KEY, 'true');
    router.replace('/app');
  }

  return (
    <main
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: 24,
        lineHeight: 1.5,
      }}
    >
      <h1>OnestarStream Terms of Service</h1>

      <p>
        Please read these Terms of Service (&quot;Terms&quot;) carefully before
        using the OnestarStream software and related services (collectively, the
        &quot;Service&quot;).
      </p>

      <h2>1. License</h2>
      <p>
        OnestarStream is licensed, not sold. Subject to your compliance with
        these Terms, you are granted a personal, non-exclusive,
        non-transferable, revocable license to install and use the software for
        your own lawful purposes.
      </p>

      <h2>2. Ownership</h2>
      <p>
        OnestarStream, including all code, assets, designs, and branding, is
        owned by the developer. No ownership rights are transferred to you. You
        may not claim the software as your own or misrepresent its origin.
      </p>

      <h2>3. Restrictions</h2>
      <ul>
        <li>No resale, sublicensing, or commercial exploitation of the app
            without prior written permission.</li>
        <li>No redistribution of the app or any modified version of it.</li>
        <li>No reverse engineering, decompiling, or attempting to extract source
            code, except where required by applicable law.</li>
        <li>No removal or alteration of copyright notices, trademarks, or other
            proprietary markings.</li>
      </ul>

      <h2>4. User Content</h2>
      <p>
        You are responsible for any content you upload, stream, or share using
        OnestarStream. You must only upload or share content that you have the
        legal right to use and distribute. The developer is not responsible for
        any infringement arising from your use of the software.
      </p>

      <h2>5. No Warranty</h2>
      <p>
        THE SOFTWARE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot;,
        WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING
        BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
      </p>

      <h2>6. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, the developer shall not be
        liable for any indirect, incidental, special, consequential, or punitive
        damages, or any loss of data, revenue, or profits, arising from or
        relating to your use of the software.
      </p>

      <h2>7. Termination</h2>
      <p>
        Your license to use OnestarStream automatically terminates if you violate
        these Terms. Upon termination, you must stop using the software and
        uninstall it from your devices.
      </p>

      <h2>8. Changes to the Terms</h2>
      <p>
        The Terms may be updated from time to time. Continued use of the
        software after changes become effective constitutes acceptance of the
        revised Terms.
      </p>

      <h2>9. Governing Law</h2>
      <p>
        These Terms shall be governed by and construed in accordance with the
        laws of your local jurisdiction, without regard to conflict-of-laws
        principles.
      </p>

      <p style={{ marginTop: 24, fontSize: 13, opacity: 0.75 }}>
        By clicking &quot;I Agree&quot; below, you acknowledge that you have read
        and understood these Terms and agree to be bound by them.
      </p>

      <button
        onClick={handleAccept}
        style={{
          marginTop: 16,
          padding: '8px 16px',
          borderRadius: 4,
          border: '1px solid #333',
          background: '#111',
          color: '#fff',
          cursor: 'pointer',
        }}
      >
        I Agree
      </button>
    </main>
  );
}
