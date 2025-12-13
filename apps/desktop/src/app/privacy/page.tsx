'use client';

export default function PrivacyPolicyPage() {
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
      <h1 style={{ marginBottom: 16 }}>OnestarStream – Privacy Policy</h1>

      <p>
        This Privacy Policy explains how OnestarStream (&quot;OnestarStream&quot; or the
        &quot;Software&quot;) handles information when you install and use the Software.
        OnestarStream is designed as a local-first, serverless application. The
        Developer does not operate a hosted cloud service for your media.
      </p>

      <h2 style={{ marginTop: 24 }}>1. Data Storage &amp; Local Processing</h2>
      <p>
        By default, OnestarStream stores user accounts, configuration, media
        metadata, and related information locally on your device. The Software
        is intended to process and store your data on your own hardware, not on
        servers controlled by the Developer.
      </p>
      <p>
        Because the Developer does not control your device, you are responsible
        for securing your system, managing backups, and restricting access to
        your local environment.
      </p>

      <h2 style={{ marginTop: 24 }}>2. Types of Information</h2>
      <p>
        Depending on how you use the Software, the following types of
        information may be stored locally on your device:
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          <strong>Account Information:</strong> Local usernames, hashed
          passwords, and related authentication data.
        </li>
        <li>
          <strong>Media Information:</strong> File paths, metadata, tags,
          playlists, and viewing history stored locally.
        </li>
        <li>
          <strong>Settings &amp; Preferences:</strong> User interface settings,
          layout, and configuration options.
        </li>
        <li>
          <strong>P2P Metadata:</strong> Data necessary to establish encrypted
          peer-to-peer connections, such as relay signaling identifiers.
        </li>
      </ul>

      <h2 style={{ marginTop: 24 }}>3. Peer-to-Peer Communication</h2>
      <p>
        When you enable peer-to-peer (P2P) features or share content with other
        users, the Software may transmit encrypted data over the internet,
        including:
      </p>
      <ul style={{ paddingLeft: 20 }}>
        <li>Encrypted media or file chunks;</li>
        <li>Encrypted messages and metadata necessary for delivery;</li>
        <li>
          Network routing data (e.g., IP addresses) required for establishing
          P2P connections.
        </li>
      </ul>
      <p>
        These transmissions are intended to be end-to-end encrypted between
        participants. The Developer does not decrypt or inspect the contents of
        your communications and does not operate a centralized storage service
        for shared media.
      </p>

      <h2 style={{ marginTop: 24 }}>4. Telemetry &amp; Analytics</h2>
      <p>
        By default, the Software is not designed to send telemetry or analytics
        data to the Developer. If optional analytics, crash reporting, or update
        checks are introduced in the future, they will be clearly described in
        the Software and, where required by law, will be subject to your consent
        or opt-out controls.
      </p>

      <h2 style={{ marginTop: 24 }}>5. Third-Party Services</h2>
      <p>
        OnestarStream may interact with third-party services if you explicitly
        configure integrations (for example, external relay or TURN servers, or
        storage locations you control). Any data shared with such services is
        governed by those third parties&apos; own terms and privacy policies.
      </p>
      <p>
        The Developer is not responsible for the privacy or security practices
        of third-party providers that you choose to use with the Software.
      </p>

      <h2 style={{ marginTop: 24 }}>6. Data Security</h2>
      <p>
        OnestarStream uses encryption and local storage practices designed to
        reduce the risk of unauthorized access. However, no system is perfectly
        secure, and the Developer cannot guarantee absolute security of your
        data.
      </p>
      <p>
        You are responsible for applying appropriate security measures on your
        device (such as disk encryption, strong passwords, and operating system
        updates) and for limiting physical and remote access to your system.
      </p>

      <h2 style={{ marginTop: 24 }}>7. Your Choices &amp; Controls</h2>
      <p>You can manage your data in the following ways:</p>
      <ul style={{ paddingLeft: 20 }}>
        <li>
          <strong>Local Deletion:</strong> You may delete media, accounts, or
          other data from within the Software. This typically removes the
          information from local storage but may not guarantee that deleted data
          is unrecoverable from the filesystem.
        </li>
        <li>
          <strong>Backups:</strong> You may create your own backups of local
          data using tools or processes you control.
        </li>
        <li>
          <strong>Network Use:</strong> You may restrict or disable P2P features
          or network access based on your own threat model and privacy
          requirements.
        </li>
      </ul>

      <h2 style={{ marginTop: 24 }}>8. Children&apos;s Privacy</h2>
      <p>
        OnestarStream is not directed to children and is intended for use by
        adults or individuals who can lawfully enter into contracts in their
        jurisdiction. The Developer does not knowingly collect or receive
        personal information from children. If you believe that a child has used
        the Software in a way that raises legal concerns, you should restrict
        access on the device and consult applicable law.
      </p>

      <h2 style={{ marginTop: 24 }}>9. International Users</h2>
      <p>
        You are responsible for ensuring that your use of OnestarStream complies
        with local laws and regulations in your jurisdiction, including but not
        limited to data protection, privacy, and content laws. The Developer
        does not operate a centralized data processing environment and does not
        control how or where you deploy the Software.
      </p>

      <h2 style={{ marginTop: 24 }}>10. Changes to this Privacy Policy</h2>
      <p>
        This Privacy Policy may be updated from time to time. Material changes
        may be communicated within the Software or by other reasonable means.
        Unless a different date is stated, changes become effective when they
        are posted or presented to you. Your continued use of the Software after
        the effective date of an updated Privacy Policy constitutes your
        acceptance of the changes.
      </p>

      <h2 style={{ marginTop: 24 }}>11. Contact &amp; Legal Notice</h2>
      <p>
        If you have questions about this Privacy Policy or your use of
        OnestarStream, you should contact the Developer through the channel
        provided with your license or distribution. Because the Software is
        distributed as a local application, the Developer may not have direct
        visibility into your deployment or data.
      </p>

      <p style={{ marginTop: 24, opacity: 0.7, fontSize: 13 }}>
        Last updated: December 2, 2025. This Privacy Policy is provided for
        general informational purposes and should be reviewed and adapted by
        your legal counsel to ensure compliance with applicable law in your
        jurisdiction.
      </p>
    </main>
  );
}
