# Phase 21: Sync API Reference

## Overview

Cross-device keystore sync APIs enable secure synchronization of keypairs across multiple devices without cloud storage. All sync operations are password-protected, tamper-resistant, and preserve device-local secrets.

---

## API: `window.onestar.sync.exportKeystore()`

### Signature
```typescript
exportKeystore(
  password: string,
  confirmPassword: string,
  outputPath?: string
): Promise<ExportResult>
```

### Parameters
- `password` (string, required): Export encryption password (min 12 characters)
- `confirmPassword` (string, required): Password confirmation (must match `password`)
- `outputPath` (string, optional): Custom export file path. Default: Downloads directory with auto-generated filename

### Returns
```typescript
interface ExportResult {
  success: boolean;
  filePath?: string;        // Absolute path to exported file
  fileSize?: number;        // File size in bytes
  exportedAt?: number;      // Unix timestamp (ms)
  error?: string;           // Error message if success=false
}
```

### Behavior
1. Validates vault is unlocked
2. Confirms password match
3. Loads keystore v4
4. Builds export payload (syncable fields only)
5. Computes HMAC-SHA256 signature
6. Encrypts with AES-256-GCM + PBKDF2-SHA512 (100k iterations)
7. Writes file: `onestar-keystore-export-v1-[deviceId]-[timestamp].json.enc`
8. Records export in sync history
9. Emits `sync:complete` event

### Security
- **Encryption**: AES-256-GCM (authenticated encryption)
- **KDF**: PBKDF2-SHA512 with 100,000 iterations (~1 second per password guess)
- **Signature**: HMAC-SHA256 for tamper detection
- **Device-local exclusions**: Salt, biometric profile, vault settings NEVER exported

### Error Codes
- `Vault must be unlocked`: Attempted sync while vault locked
- `Passwords do not match`: Password confirmation mismatch
- `Password must be at least 12 characters`: Too short
- `Failed to load keystore`: Keystore file missing or corrupted
- `Export failed: [reason]`: Encryption or file write error

### Example
```javascript
const result = await window.onestar.sync.exportKeystore(
  'MySecurePassword123!',
  'MySecurePassword123!'
);

if (result.success) {
  console.log(`Exported to: ${result.filePath}`);
  console.log(`File size: ${result.fileSize} bytes`);
} else {
  console.error(`Export failed: ${result.error}`);
}
```

---

## API: `window.onestar.sync.importKeystore()`

### Signature
```typescript
importKeystore(
  filePath: string,
  password: string
): Promise<ImportResult>
```

### Parameters
- `filePath` (string, required): Absolute path to encrypted export file
- `password` (string, required): Export decryption password

### Returns
```typescript
interface ImportResult {
  success: boolean;
  sourceDevice?: string;            // Source device name
  sourceDeviceId?: string;          // Source device ID
  keypairsUpdated?: boolean;        // True if current keypair changed
  previousKeypairsMerged?: number;  // Count of previous keypairs merged
  rotationHistoryMerged?: number;   // Count of rotation history entries merged
  conflictsResolved?: number;       // Count of conflicts resolved
  error?: string;                   // Error message if success=false
}
```

### Behavior
1. Validates vault is unlocked
2. Reads encrypted export file
3. Decrypts with AES-256-GCM (password-based)
4. Verifies HMAC-SHA256 signature (constant-time comparison)
5. Verifies SHA-256 checksum
6. Validates rotation chain integrity
7. Loads current keystore v4
8. Validates identity match (same userId)
9. Detects attacks (downgrade, replay)
10. Merges keystores (conflict resolution)
11. Saves merged keystore atomically
12. Emits `sync:complete` event with stats

### Conflict Resolution
- **Current keypair**: Newest by rotation timestamp wins
- **Previous keypairs**: Deduplicated by public key, limit 10 newest
- **Rotation history**: Merged chronologically, deduplicated by rotation ID
- **Device-local state**: Always preserved from local keystore

### Attack Prevention
- **Downgrade detection**: Validates rotation chain completeness (no missing rotations)
- **Replay detection**: Tracks signature deduplication (same export not imported twice)
- **Tampering detection**: HMAC signature verification before merge

### Error Codes
- `Vault must be unlocked`: Attempted sync while vault locked
- `Export file not found`: File path invalid
- `Decryption failed: Invalid password`: Wrong password
- `Invalid export format`: File corrupted or not a valid export
- `HMAC signature verification failed`: Export was tampered with
- `Checksum mismatch`: File corrupted during transfer
- `Identity mismatch: cannot merge keystores from different users`: Export from different user
- `Downgrade attack detected`: Export missing rotation history entries
- `Replay attack detected`: Export was already imported
- `Import failed: [reason]`: Other merge or save error

### Example
```javascript
const result = await window.onestar.sync.importKeystore(
  '/path/to/onestar-keystore-export-v1-device-a-1234567890.json.enc',
  'MySecurePassword123!'
);

if (result.success) {
  console.log(`Imported from: ${result.sourceDevice}`);
  console.log(`Keypairs updated: ${result.keypairsUpdated}`);
  console.log(`Previous keypairs merged: ${result.previousKeypairsMerged}`);
  console.log(`Conflicts resolved: ${result.conflictsResolved}`);
} else {
  console.error(`Import failed: ${result.error}`);
}
```

---

## API: `window.onestar.sync.getSyncStatus()`

### Signature
```typescript
getSyncStatus(): Promise<SyncStatus>
```

### Parameters
None

### Returns
```typescript
interface SyncStatus {
  lastSyncedAt: number;              // Unix timestamp (ms) of last sync
  totalSyncOperations: number;       // Total import operations performed
  deviceId: string;                  // This device's unique ID
  deviceName: string;                // This device's name
  currentKeypairRotatedAt?: number;  // Unix timestamp (ms) of current keypair
  previousKeypairsCount: number;     // Count of previous keypairs stored
  needsSync: boolean;                // True if sync recommended
}
```

### Behavior
1. Loads keystore v4
2. Extracts sync metadata
3. Counts previous keypairs
4. Calls `detectSyncNeeded()` from keystoreSyncStatus
5. Returns comprehensive sync status

### Example
```javascript
const status = await window.onestar.sync.getSyncStatus();

console.log(`Last sync: ${new Date(status.lastSyncedAt).toLocaleString()}`);
console.log(`Device: ${status.deviceName} (${status.deviceId})`);
console.log(`Needs sync: ${status.needsSync}`);
```

---

## API: `window.onestar.sync.getDeviceInfo()`

### Signature
```typescript
getDeviceInfo(): Promise<DeviceInfo>
```

### Parameters
None

### Returns
```typescript
interface DeviceInfo {
  deviceId: string;                  // Persistent device ID
  deviceName: string;                // Device name (hostname)
  platform: string;                  // OS platform (darwin, win32, linux)
  deviceCreatedAt: number;           // Unix timestamp (ms) of device creation
  lastSyncedAt: number;              // Unix timestamp (ms) of last sync
  currentKeypairRotatedAt?: number;  // Unix timestamp (ms) of current keypair
  previousKeypairsCount: number;     // Count of previous keypairs stored
  biometricProfile?: BiometricProfile;
  vaultSettings?: VaultSettings;
}

interface BiometricProfile {
  enabled: boolean;
  platform: string;
  biometricType?: 'TouchID' | 'FaceID' | 'WindowsHello' | 'Fingerprint' | 'None';
  enrolledAt?: number;
  lastUsedAt?: number;
}

interface VaultSettings {
  autoLockEnabled: boolean;
  autoLockTimeoutMinutes: number;
  requireBiometricForUnlock: boolean;
  requirePasswordForRotation: boolean;
  requirePasswordForExport: boolean;
}
```

### Behavior
1. Loads keystore v4
2. Extracts device metadata
3. Returns comprehensive device info (including device-local settings)

### Example
```javascript
const info = await window.onestar.sync.getDeviceInfo();

console.log(`Device: ${info.deviceName} (${info.platform})`);
console.log(`Biometrics: ${info.biometricProfile?.biometricType || 'None'}`);
console.log(`Auto-lock: ${info.vaultSettings?.autoLockEnabled}`);
```

---

## API: `window.onestar.sync.listSyncedDevices()`

### Signature
```typescript
listSyncedDevices(): Promise<DeviceRecord[]>
```

### Parameters
None

### Returns
```typescript
interface DeviceRecord {
  deviceId: string;           // Unique device ID
  deviceName: string;         // Device name
  platform: string;           // OS platform
  firstSeen: number;          // Unix timestamp (ms) of first activity
  lastActivity: number;       // Unix timestamp (ms) of last activity
  rotationCount: number;      // Count of rotations from this device
  syncCount: number;          // Count of syncs from this device
}
```

### Behavior
1. Loads keystore v4
2. Scans rotation history for device IDs
3. Scans sync history for device IDs
4. Builds device map with activity tracking
5. Sorts by last activity (newest first)
6. Returns array of device records

### Example
```javascript
const devices = await window.onestar.sync.listSyncedDevices();

console.log(`Synced with ${devices.length} devices:`);
devices.forEach(device => {
  console.log(`- ${device.deviceName} (${device.platform})`);
  console.log(`  Rotations: ${device.rotationCount}, Syncs: ${device.syncCount}`);
  console.log(`  Last activity: ${new Date(device.lastActivity).toLocaleString()}`);
});
```

---

## Events

### `sync:start`
Emitted when sync operation begins (export or import).

**Payload:**
```typescript
{
  operation: 'export' | 'import';
}
```

### `sync:complete`
Emitted when sync operation completes successfully.

**Payload (export):**
```typescript
{
  operation: 'export';
  filePath: string;
  fileSize: number;
  exportedAt: number;
}
```

**Payload (import):**
```typescript
{
  operation: 'import';
  sourceDevice: string;
  sourceDeviceId: string;
  keypairsUpdated: boolean;
  previousKeypairsMerged: number;
  rotationHistoryMerged: number;
  conflictsResolved: number;
}
```

### `sync:error`
Emitted when sync operation fails.

**Payload:**
```typescript
{
  operation: 'export' | 'import';
  error: string;
}
```

### Example Event Listener
```javascript
ipcRenderer.on('sync:complete', (event, data) => {
  if (data.operation === 'export') {
    console.log(`Export complete: ${data.filePath}`);
  } else {
    console.log(`Import complete from ${data.sourceDevice}`);
  }
});
```

---

## Security Considerations

### Encryption Strength
- **AES-256-GCM**: Industry-standard authenticated encryption
- **PBKDF2-SHA512**: 100,000 iterations (OWASP recommended)
- **Password requirements**: Minimum 12 characters

### Attack Resistance
- **Downgrade attacks**: Rotation chain validation
- **Replay attacks**: Signature deduplication
- **Tampering**: HMAC-SHA256 verification
- **Password guessing**: ~1 second per attempt (PBKDF2 iterations)

### Device-Local Isolation
Never synced across devices:
- Vault password salt (device-specific)
- Biometric profile (device-specific hardware)
- Vault settings (user preferences per device)

### Offline-First
- No cloud storage required
- No network transmission
- Manual file transfer (USB, AirDrop, local network)

---

## Typical Sync Workflow

### Initial Setup (Device A)
```javascript
// 1. Export from Device A
const exportResult = await window.onestar.sync.exportKeystore(
  'SecurePassword123!',
  'SecurePassword123!'
);

// 2. Transfer file to Device B via USB/AirDrop
console.log(`Transfer file: ${exportResult.filePath}`);
```

### Import on Device B
```javascript
// 3. Import on Device B
const importResult = await window.onestar.sync.importKeystore(
  '/path/to/transferred/export.json.enc',
  'SecurePassword123!'
);

console.log(`Sync complete! Devices now in sync.`);
```

### Check Sync Status
```javascript
// 4. Verify sync status
const status = await window.onestar.sync.getSyncStatus();
console.log(`Last synced: ${new Date(status.lastSyncedAt).toLocaleString()}`);
console.log(`Needs sync: ${status.needsSync}`);
```

### List All Devices
```javascript
// 5. View all synced devices
const devices = await window.onestar.sync.listSyncedDevices();
console.log(`Total devices: ${devices.length}`);
```

---

## Error Handling Best Practices

```javascript
try {
  const result = await window.onestar.sync.importKeystore(filePath, password);
  
  if (!result.success) {
    // Handle specific errors
    if (result.error.includes('Invalid password')) {
      alert('Incorrect password. Please try again.');
    } else if (result.error.includes('Identity mismatch')) {
      alert('This export is from a different user account.');
    } else if (result.error.includes('Downgrade attack')) {
      alert('Security warning: Export may be malicious.');
    } else {
      alert(`Import failed: ${result.error}`);
    }
    return;
  }
  
  // Success
  alert(`Imported ${result.previousKeypairsMerged} keypairs from ${result.sourceDevice}`);
  
} catch (err) {
  console.error('Unexpected error:', err);
  alert('An unexpected error occurred during import.');
}
```

---

## Performance Characteristics

| Operation | Typical Duration | Notes |
|-----------|------------------|-------|
| Export | 1-2 seconds | PBKDF2 dominates (intentionally slow) |
| Import | 2-3 seconds | PBKDF2 + merge logic |
| getSyncStatus | < 10ms | Read-only metadata query |
| getDeviceInfo | < 10ms | Read-only metadata query |
| listSyncedDevices | < 50ms | Scans rotation + sync history |

---

## Version History

- **v1** (Phase 21): Initial implementation
  - AES-256-GCM encryption
  - PBKDF2-SHA512 KDF (100k iterations)
  - HMAC-SHA256 signatures
  - Downgrade/replay attack prevention
  - Device-local secret isolation
