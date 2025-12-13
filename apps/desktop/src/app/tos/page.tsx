
'use client';

import { useEffect, useRef } from 'react';

export default function TermsOfServicePage() {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 8;

      if (atBottom && typeof window !== 'undefined') {
        try {
          // Notify parent (e.g., the /setup iframe) that user scrolled to bottom.
          window.parent?.postMessage(
            { type: 'onestar_tos_scrolled_bottom' },
            window.location.origin,
          );
        } catch {
          // Fail silently; standalone /tos view will still work fine.
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
      <h1 style={{ marginBottom: 16 }}>OnestarStream – Terms of Service</h1>

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
          These Terms of Service (these &quot;Terms&quot;) govern your access to and use
          of the OnestarStream software application and any related
          documentation or components (collectively, &quot;OnestarStream&quot; or the
          &quot;Software&quot;). By installing, accessing, or using OnestarStream, you
          agree to be bound by these Terms. If you do not agree to these Terms,
          do not install or use OnestarStream.
        </p>

        <h2 style={{ marginTop: 24 }}>1. Eligibility &amp; Acceptance</h2>
        <p>
          You represent and warrant that you are of legal age and have the legal
          capacity to enter into a binding agreement in your jurisdiction. By
          clicking &quot;I agree&quot; or by using the Software, you acknowledge that you
          have read, understood, and agree to be bound by these Terms.
        </p>

        <h2 style={{ marginTop: 24 }}>2. License Grant</h2>
        <p>
          Subject to your continued compliance with these Terms and any
          applicable license activation requirements, the developer of
          OnestarStream (&quot;Developer&quot;) grants you a limited, non-exclusive,
          non-transferable, non-sublicensable, revocable license to install and
          use one copy of the Software on a single device that you own or
          control, solely for your own personal or internal business purposes.
        </p>
        <p>
          All rights not expressly granted to you under these Terms are reserved
          by the Developer.
        </p>

        <h2 style={{ marginTop: 24 }}>3. Local-Only Operation &amp; Data Storage</h2>
        <p>
          OnestarStream is designed as a local-first, serverless, peer-to-peer
          encrypted media system. Unless otherwise specified or explicitly
          enabled by you:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li>
            User accounts, media files, metadata, and configuration are stored
            on your local device.
          </li>
          <li>
            The Software does not automatically upload your media to a remote
            server controlled by the Developer.
          </li>
          <li>
            You are solely responsible for backing up and safeguarding your
            data.
          </li>
        </ul>
        <p>
          You acknowledge that deletion, corruption, or loss of local data
          (including encrypted databases and media) is at your own risk and that
          the Developer has no access to or control over your local storage.
        </p>

        <h2 style={{ marginTop: 24 }}>4. User Accounts &amp; Security</h2>
        <p>
          User accounts created within OnestarStream exist only on your device
          unless you explicitly export or transmit data. You are solely
          responsible for:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li>Maintaining the confidentiality of your credentials;</li>
          <li>Restricting access to your device and local storage; and</li>
          <li>
            All activities that occur under your local account(s), whether
            authorized by you or not.
          </li>
        </ul>
        <p>
          The Developer is not responsible for any loss or damage arising from
          unauthorized access to your device, encryption keys, or local
          accounts.
        </p>

        <h2 style={{ marginTop: 24 }}>5. P2P Encrypted Sharing</h2>
        <p>
          When you choose to share files, metadata, or messages using
          peer-to-peer (P2P) features (including WebRTC or relay mechanisms),
          OnestarStream attempts to encrypt such transmissions end-to-end so
          that only intended participants can decrypt the content.
        </p>
        <p>
          However, no security system is impenetrable, and OnestarStream cannot
          guarantee absolute security of P2P transmissions. You acknowledge and
          agree that:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li>
            You are solely responsible for the content you transmit, share, or
            make available via P2P features.
          </li>
          <li>
            You must ensure you have all necessary rights, permissions, and
            legal authority to share any content.
          </li>
          <li>
            The Developer does not decrypt, moderate, or monitor your encrypted
            transmissions and has no obligation to do so.
          </li>
        </ul>

        <h2 style={{ marginTop: 24 }}>6. License Activation &amp; Enforcement</h2>
        <p>
          The Software may require a valid license to be activated before
          certain or all features are available. Licenses may be issued manually
          by the Developer or an authorized administrator and may be associated
          with a specific user, device, or account.
        </p>
        <p>You agree that license keys:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li>Are confidential and must not be shared or resold;</li>
          <li>
            May be revoked or suspended at any time if the Developer believes,
            in good faith, that you have violated these Terms or applicable law;
            and
          </li>
          <li>
            Are a technical control to enforce the scope and duration of your
            licensed rights to use the Software.
          </li>
        </ul>
        <p>
          If your license is revoked, expires, or is otherwise disabled, you may
          lose access to some or all functionality of the Software, and the
          Developer shall have no obligation to provide refunds, data export, or
          continued access, except as required by mandatory law.
        </p>

        <h2 style={{ marginTop: 24 }}>7. Prohibited Use</h2>
        <p>You agree that you will not, and will not attempt to:</p>
        <ul style={{ paddingLeft: 20 }}>
          <li>
            Use the Software to store, distribute, or transmit any unlawful,
            infringing, defamatory, obscene, or otherwise objectionable content;
          </li>
          <li>
            Use the Software to violate the rights of others, including privacy,
            publicity, and intellectual property rights;
          </li>
          <li>
            Reverse engineer, decompile, disassemble, or otherwise attempt to
            derive the source code, underlying ideas, or algorithms of the
            Software except to the extent permitted by applicable law;
          </li>
          <li>
            Circumvent or attempt to circumvent license enforcement, encryption,
            security features, or technical restrictions;
          </li>
          <li>
            Interfere with or disrupt P2P networks, relay infrastructure, or any
            other users&apos; use of the Software; or
          </li>
          <li>
            Use the Software for any purpose that violates applicable laws or
            regulations.
          </li>
        </ul>

        <h2 style={{ marginTop: 24 }}>8. Intellectual Property</h2>
        <p>
          OnestarStream, including all code, design, logos, and other
          proprietary elements, is owned by the Developer or its licensors and
          is protected by copyright, trade secret, and other intellectual
          property laws. These Terms do not transfer to you any ownership in the
          Software or related intellectual property.
        </p>
        <p>
          You retain ownership of any content that you lawfully store or
          transmit using the Software. You grant the Developer any limited
          rights necessary to operate and update the Software on your device
          (for example, to install updates), but the Developer does not claim
          ownership of your media files or personal content.
        </p>

        <h2 style={{ marginTop: 24 }}>9. Updates &amp; Changes to the Software</h2>
        <p>
          The Developer may from time to time provide updates, patches, or new
          releases that modify, enhance, or otherwise change the Software
          (&quot;Updates&quot;). Updates may be required for continued use of the
          Software.
        </p>
        <p>
          The Developer reserves the right to add, modify, or remove features at
          any time, with or without notice, provided that such changes do not
          violate mandatory consumer protection laws in your jurisdiction. Your
          continued use of the Software after any Update constitutes your
          acceptance of the updated Software and any revised Terms.
        </p>

        <h2 style={{ marginTop: 24 }}>10. Disclaimer of Warranties</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE SOFTWARE IS
          PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE,&quot; WITH ALL FAULTS AND WITHOUT ANY
          WARRANTIES OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY,
          INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY,
          FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT.
        </p>
        <p>
          WITHOUT LIMITING THE FOREGOING, THE DEVELOPER DOES NOT WARRANT THAT
          THE SOFTWARE WILL BE UNINTERRUPTED, ERROR-FREE, SECURE, OR COMPATIBLE
          WITH ANY PARTICULAR HARDWARE OR CONFIGURATION, OR THAT DEFECTS WILL BE
          CORRECTED.
        </p>

        <h2 style={{ marginTop: 24 }}>11. Limitation of Liability</h2>
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL
          THE DEVELOPER BE LIABLE FOR ANY INDIRECT, INCIDENTAL, CONSEQUENTIAL,
          SPECIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF PROFITS,
          REVENUE, DATA, OR GOODWILL, ARISING OUT OF OR IN CONNECTION WITH YOUR
          USE OF OR INABILITY TO USE THE SOFTWARE, EVEN IF THE DEVELOPER HAS
          BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.
        </p>
        <p>
          TO THE EXTENT ANY LIABILITY IS NOT LAWFULLY EXCLUDED, THE DEVELOPER&apos;S
          TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATED TO THESE TERMS OR
          THE SOFTWARE SHALL NOT EXCEED THE AMOUNT YOU PAID (IF ANY) FOR THE
          LICENSE DURING THE TWELVE (12) MONTHS PRECEDING THE EVENT GIVING RISE
          TO THE CLAIM.
        </p>

        <h2 style={{ marginTop: 24 }}>12. Indemnification</h2>
        <p>
          You agree to indemnify, defend, and hold harmless the Developer and
          its affiliates, officers, employees, and agents from and against any
          and all claims, liabilities, damages, losses, and expenses (including
          reasonable attorneys&apos; fees) arising out of or in connection with:
          (a) your use of the Software; (b) your violation of these Terms; or
          (c) your violation of any applicable law or the rights of any third
          party.
        </p>

        <h2 style={{ marginTop: 24 }}>13. Termination</h2>
        <p>
          These Terms are effective until terminated. The Developer may
          terminate or suspend your license and access to the Software at any
          time, with or without notice, if it believes that you have violated
          these Terms or applicable law. Upon termination, you must cease all
          use of the Software, and any remaining technical measures (including
          license revocation) may be used to enforce termination.
        </p>

        <h2 style={{ marginTop: 24 }}>14. Governing Law &amp; Jurisdiction</h2>
        <p>
          Unless otherwise required by mandatory law, these Terms shall be
          governed by and construed in accordance with the laws of the
          jurisdiction in which the Developer is established, without regard to
          conflict-of-law principles. Any dispute arising out of or relating to
          these Terms or the Software shall be subject to the exclusive
          jurisdiction of the courts located in that jurisdiction, and you
          consent to the personal jurisdiction of such courts.
        </p>

        <h2 style={{ marginTop: 24 }}>15. Changes to These Terms</h2>
        <p>
          The Developer may update these Terms from time to time. Material
          changes may be communicated through the Software or other reasonable
          means. Unless a different date is stated, changes become effective
          when they are posted or presented to you. Your continued use of the
          Software after the effective date of any updated Terms constitutes
          your acceptance of those changes.
        </p>

        <h2 style={{ marginTop: 24 }}>16. Miscellaneous</h2>
        <p>
          If any provision of these Terms is held to be invalid or
          unenforceable, that provision shall be enforced to the maximum extent
          permissible and the remaining provisions shall remain in full force
          and effect. These Terms constitute the entire agreement between you
          and the Developer relating to the Software and supersede all prior or
          contemporaneous understandings regarding such subject matter.
        </p>

        <p style={{ marginTop: 24, opacity: 0.7, fontSize: 13 }}>
          Last updated: December 2, 2025. 
        </p>
      </div>
    </main>
  );
}
