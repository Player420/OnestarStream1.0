'use client';

import { useEffect, useRef } from 'react';

export default function EulaPage() {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 8;

      if (atBottom && typeof window !== 'undefined') {
        try {
          // Notify parent (the /setup iframe) that user scrolled to bottom.
          window.parent?.postMessage(
            { type: 'onestar_eula_scrolled_bottom' },
            window.location.origin,
          );
        } catch {
          // Fail silently; standalone /eula view will still work fine.
        }
      }
    };

    el.addEventListener('scroll', handleScroll);
    // Trigger once in case content already fits / starts at bottom
    handleScroll();

    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
  }, []);

  return (
    <main
      style={{
        maxWidth: 800,
        margin: '0 auto',
        padding: 24,
        lineHeight: 1.6,
        fontFamily:
          'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <h1 style={{ marginBottom: 16 }}>
        OnestarStream – End User License Agreement (EULA)
      </h1>

      <div
        ref={scrollRef}
        style={{
          maxHeight: '70vh',
          overflowY: 'auto',
          paddingRight: 8,
          border: '1px solid #ddd',
          borderRadius: 4,
        }}
      >
        <p>
          This End User License Agreement (&quot;EULA&quot;) is a legal agreement
          between you and the developer of OnestarStream (&quot;Developer&quot;)
          governing your use of the OnestarStream software application and
          related components (collectively, the &quot;Software&quot;). By installing
          or using the Software, you agree to be bound by the terms of this
          EULA. If you do not agree to these terms, do not install or use the
          Software.
        </p>

        <h2 style={{ marginTop: 24 }}>1. License Grant</h2>
        <p>
          Subject to your compliance with this EULA and any applicable license
          activation requirements, the Developer grants you a limited,
          non-exclusive, non-transferable, non-sublicensable, revocable license
          to install and use one copy of the Software on a single device that
          you own or control, solely for your personal or internal business use.
        </p>

        <h2 style={{ marginTop: 24 }}>2. Ownership</h2>
        <p>
          The Software is licensed, not sold. The Developer and its licensors
          own all rights, title, and interest in and to the Software, including
          all intellectual property rights. This EULA does not grant you any
          rights to the Software except for the limited license expressly set
          forth herein.
        </p>

        <h2 style={{ marginTop: 24 }}>3. Restrictions</h2>
        <p>You shall not, and shall not permit any third party to:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li>
            Copy, modify, adapt, translate, or create derivative works of the
            Software, except as expressly permitted by this EULA or mandatory
            law;
          </li>
          <li>
            Reverse engineer, decompile, disassemble, or otherwise attempt to
            derive the source code of the Software, except to the extent that
            such activity is expressly permitted by applicable law
            notwithstanding this restriction;
          </li>
          <li>
            Remove, alter, or obscure any proprietary notices or labels on the
            Software;
          </li>
          <li>
            Rent, lease, lend, sell, sublicense, assign, distribute, or
            otherwise transfer the Software or any license rights to any third
            party;
          </li>
          <li>Use the Software to develop a competing product or service; or</li>
          <li>
            Circumvent or attempt to circumvent any technical protection
            measures (including license enforcement, encryption, or
            authentication).
          </li>
        </ul>

        <h2 style={{ marginTop: 24 }}>4. Prohibited and Illegal Use</h2>
        <p>
          You may not use the Software, and you agree not to permit any third
          party to use the Software, in any manner that:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li>
            Violates any applicable law, regulation, or court order in any
            jurisdiction;
          </li>
          <li>
            Involves the creation, storage, transmission, or distribution of
            illegal content, including but not limited to child sexual abuse
            material (CSAM), non-consensual intimate imagery, or content that
            incites or facilitates violence or terrorism;
          </li>
          <li>
            Infringes any intellectual property rights, including unauthorized
            sharing or distribution of copyrighted works (such as films, music,
            or software) without permission;
          </li>
          <li>
            Constitutes harassment, threats, defamation, or other unlawful
            attacks on individuals or groups;
          </li>
          <li>
            Promotes or disseminates hate speech, or content intended to incite
            discrimination or hostility against individuals or groups on the
            basis of race, ethnicity, nationality, religion, gender, sexual
            orientation, disability, or any other protected characteristic;
          </li>
          <li>
            Attempts to exploit security vulnerabilities, compromise other
            systems or networks, or distribute malware or malicious code.
          </li>
        </ul>
        <p>
          The Developer reserves the right to revoke licenses and disable access
          to the Software where it has a reasonable basis to believe that the
          Software is being used in connection with illegal acts or serious
          violations of this EULA, without prejudice to any other legal or
          equitable remedies.
        </p>

        <h2 style={{ marginTop: 24 }}>5. License Activation &amp; Term</h2>
        <p>
          Use of the Software may require activation via a license key or other
          mechanism. Licenses may be time-limited or feature-limited. The
          Developer reserves the right to revoke or suspend a license if it
          believes, in good faith, that you have violated this EULA, applicable
          law, or any associated Terms of Service.
        </p>
        <p>
          This EULA is effective from the date you first install or use the
          Software and continues until terminated. Upon termination of this EULA
          for any reason, you must cease all use of the Software and destroy all
          copies in your possession or control.
        </p>

        <h2 style={{ marginTop: 24 }}>6. Local-Only Operation &amp; Data</h2>
        <p>
          The Software is designed primarily for local operation on your device.
          The Developer does not maintain a hosted copy of your media or a
          central user database. You are solely responsible for securing,
          backing up, and managing any data that you process or store using the
          Software.
        </p>

        <h2 style={{ marginTop: 24 }}>7. Third-Party Components</h2>
        <p>
          The Software may incorporate or rely on third-party libraries,
          open-source components, or services that are licensed under separate
          terms. To the extent required, those terms are incorporated by
          reference and will govern your use of the respective components in
          addition to this EULA.
        </p>

        <h2 style={{ marginTop: 24 }}>8. Disclaimer of Warranties</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE IS
          PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITH ALL FAULTS AND WITHOUT ANY
          WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY,
          INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
        </p>

        <h2 style={{ marginTop: 24 }}>9. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL
          THE DEVELOPER BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL,
          SPECIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS,
          REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR
          USE OF OR INABILITY TO USE THE SOFTWARE, EVEN IF THE DEVELOPER HAS
          BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p>
          TO THE EXTENT ANY LIABILITY CANNOT BE LAWFULLY EXCLUDED, THE
          DEVELOPER&apos;S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THIS
          EULA OR THE SOFTWARE SHALL NOT EXCEED THE AMOUNT YOU PAID (IF ANY) FOR
          THE LICENSE DURING THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING
          RISE TO THE CLAIM.
        </p>

        <h2 style={{ marginTop: 24 }}>10. Indemnification</h2>
        <p>
          You agree to indemnify, defend, and hold harmless the Developer and
          its affiliates, officers, employees, and agents from and against any
          claims, liabilities, damages, losses, and expenses (including
          reasonable attorneys&apos; fees) arising out of or in connection with your
          use of the Software, your violation of this EULA, or your violation of
          any applicable law or third-party rights.
        </p>

        <h2 style={{ marginTop: 24 }}>11. Governing Law &amp; Dispute Resolution</h2>
        <p>
          Unless otherwise required by mandatory law, this EULA shall be
          governed by and construed in accordance with the laws of the
          jurisdiction in which the Developer is established, without regard to
          conflict-of-law principles. Any dispute arising out of or relating to
          this EULA or the Software shall be subject to the exclusive
          jurisdiction of the courts located in that jurisdiction, and you
          consent to the personal jurisdiction of such courts.
        </p>

        <h2 style={{ marginTop: 24 }}>12. Entire Agreement &amp; Severability</h2>
        <p>
          This EULA, together with any applicable Terms of Service and
          documentation, constitutes the entire agreement between you and the
          Developer regarding the Software and supersedes all prior or
          contemporaneous understandings. If any provision of this EULA is held
          to be invalid or unenforceable, that provision shall be enforced to
          the maximum extent permissible and the remaining provisions shall
          remain in full force and effect.
        </p>

        <p style={{ marginTop: 24, opacity: 0.7, fontSize: 13 }}>
          Last updated: December 2, 2025. 
        </p>
      </div>
    </main>
  );
}
