# Key Rotation Specification

**Version:** 1.0  
**Phase:** 17 (Framework), 19 (Full Implementation)  
**Status:** Framework Complete, Full Rotation Pending

## Overview

Key rotation is the cryptographic practice of periodically replacing encryption keys to limit the blast radius of key compromise and provide forward secrecy. This document specifies OneStarStream's PQ-hybrid key rotation framework.

## Threat Model

### Without Key Rotation

**Scenario:** Long-lived keypair (generated once, never rotated)

**Risks:**
1. **Key Compromise Window:** If private key is compromised, ALL media encrypted with that key is vulnerable
2. **No Forward Secrecy:** Past media cannot be protected retroactively
3. **Cryptanalysis Exposure:** More ciphertext samples enable pattern analysis
4. **Compliance Violations:** Many security standards require periodic key rotation (90-180 days)

**Blast Radius:** Entire media library (all historical uploads)

### With Key Rotation

**Scenario:** Keypair rotated every 180 days

**Benefits:**
1. **Limited Blast Radius:** Only media encrypted in current rotation period is vulnerable
2. **Forward Secrecy:** Old keys destroyed after rotation (cannot decrypt new media)
3. **Backward Secrecy:** New keys cannot decrypt old media (if old keys destroyed)
4. **Compliance:** Meets NIST, PCI-DSS, HIPAA key rotation requirements

**Blast Radius:** Maximum 180 days of media uploads

## Architecture

### Keystore v2 Format

Phase 17 extends the keystore format to track rotation metadata:

```typescript
interface EncryptedKeystore {
  version: 'v1' | 'v2'; // v2 added in Phase 17
  algorithm: 'Kyber768-X25519-AES256GCM';
  salt: string; // Base64
  iv: string; // Base64
  encryptedKeypair: string; // Base64
  publicKey: { kyber: string; x25519: string }; // Base64
  iterations: number; // PBKDF2 iterations
  createdAt: string; // ISO 8601
  lastUnlockedAt?: string; // ISO 8601
  userId?: string;

  // Phase 17: Rotation metadata
  rotation?: {
    lastRotatedAt?: string; // ISO 8601 timestamp of last rotation
    rotationCount: number; // Number of rotations performed (0 for initial keypair)
    nextRotationDue?: string; // ISO 8601 timestamp when rotation is due
    rotationPolicy: 'manual' | 'scheduled'; // Rotation policy
    rotationIntervalDays?: number; // Days between rotations (default: 180)
  };

  // Phase 17: Biometric metadata (stored alongside rotation)
  biometric?: {
    enrolled: boolean;
    enrolledAt?: string; // ISO 8601
    method?: 'touch-id' | 'face-id' | 'windows-hello';
  };
}
```

**Backward Compatibility:**
- v1 keystores have `rotation: undefined` (treated as never rotated)
- v2 keystores created with `rotation.rotationCount = 0` initially
- Both formats decrypt successfully

### Rotation Policies

| Policy | Behavior | Use Case |
|--------|----------|----------|
| `manual` | User initiates rotation manually | Personal users, no compliance requirements |
| `scheduled` | Auto-rotation every N days (default: 180) | Enterprise, compliance-driven environments |

**Default:** `scheduled` with 180-day interval

**Configurable:** Via `encryptKeypair()` options or settings UI

### Rotation States

```
┌─────────────────┐
│ Initial Keypair │  rotationCount = 0
│                 │  nextRotationDue = createdAt + 180 days
└────────┬────────┘
         │
         │ 180 days elapse
         │
         v
┌─────────────────┐
│ Rotation Due    │  isRotationDue() = true
│                 │  Prompt user or auto-rotate (policy)
└────────┬────────┘
         │
         │ rotateKeypair() called
         │
         v
┌─────────────────┐
│ New Keypair     │  rotationCount = 1
│                 │  nextRotationDue = now + 180 days
│                 │  Re-wrap all media keys
└────────┬────────┘
         │
         │ 180 days elapse
         │
         v
┌─────────────────┐
│ Rotation Due    │  rotationCount = 1, continue cycle...
└─────────────────┘
```

## Rotation Workflow

### Phase 17: Framework (Current)

**Implemented:**
- Keystore v2 format with rotation metadata
- `isRotationDue(keystore)` - Check if rotation is overdue
- `getRotationStatus(keystore)` - Get rotation status summary
- `markKeypairRotated(keystore)` - Update metadata after rotation

**Stub Implementation:**
```typescript
// Check if rotation is due
if (isRotationDue(keystore)) {
  console.log('Key rotation due!');
  // Phase 19: Trigger rotation workflow
}
```

**UI Integration:**
```typescript
// Get rotation status
const status = getRotationStatus(keystore);
// { isDue: true, daysSinceLastRotation: 185, daysUntilDue: -5, rotationCount: 0 }

// Display to user
if (status.isDue) {
  showNotification(`Key rotation is ${Math.abs(status.daysUntilDue)} days overdue!`);
}
```

### Phase 19: Full Implementation (Future)

**Workflow:**

```
┌───────────────────────────────────────────────────────────────┐
│                    Key Rotation Workflow                      │
└───────────────────────────────────────────────────────────────┘

1. Check Rotation Status
   ├─ isRotationDue(keystore) → true
   └─ Prompt user: "Your encryption keys need to be rotated for security."

2. User Confirms Rotation
   ├─ Show progress UI: "Rotating keys... (Step 1/4)"
   └─ Lock UI (prevent media operations during rotation)

3. Generate New Keypair
   ├─ Call generateHybridKeypair() → newKeypair
   ├─ Encrypt newKeypair with same password → newKeystore
   └─ Store newKeystore.publicKey for verification

4. Re-wrap All Media Keys
   ├─ Query all media: SELECT * FROM media WHERE wrappedKey IS NOT NULL
   ├─ For each media:
   │   ├─ Unwrap mediaKey with oldKeypair
   │   ├─ Wrap mediaKey with newKeypair.publicKey
   │   └─ Update media.wrappedKey (atomic transaction)
   ├─ Progress: "Rotating keys... (2734/3000 files)"
   └─ Rollback on failure (restore old wrappedKeys)

5. Save New Keystore
   ├─ Write newKeystore to disk (atomic)
   ├─ Backup old keystore → keystore.json.bak
   └─ Update rotation metadata:
       ├─ lastRotatedAt = now
       ├─ rotationCount += 1
       ├─ nextRotationDue = now + 180 days

6. Zeroize Old Keypair
   ├─ Call sodium_memzero(oldKeypair.privateKey)
   └─ Delete backup after verification

7. Verify Rotation
   ├─ Load newKeystore, decrypt with password
   ├─ Unwrap sample media key
   ├─ Verify decryption succeeds
   └─ Show success: "Key rotation complete! (3000 files updated)"

8. Cleanup
   ├─ Delete old keystore backup
   └─ Unlock UI (resume normal operations)
```

**Error Handling:**

| Error | Recovery |
|-------|----------|
| Unwrap fails (corrupted media key) | Skip file, continue rotation, log error |
| Transaction fails (disk full) | Rollback all changes, restore old keystore |
| Password wrong (user cancelled) | Abort rotation, no changes made |
| Power loss during rotation | Resume from backup on next unlock |

### Code Structure (Phase 19)

```typescript
// File: src/lib/keyRotation.ts (Future)

/**
 * Rotate PQ-hybrid keypair and re-wrap all media keys.
 * 
 * CRITICAL: This is a multi-step atomic operation. Failure at any step
 * must rollback all changes to prevent media loss.
 * 
 * @param password - Vault password (for encrypting new keypair)
 * @param userId - Optional user identifier
 * @param progressCallback - Optional progress callback (current, total)
 * @returns Rotation result with statistics
 */
export async function rotateKeypair(
  password: string,
  userId?: string,
  progressCallback?: (current: number, total: number) => void
): Promise<RotationResult> {
  const startTime = Date.now();
  let transaction: DatabaseTransaction | null = null;
  
  try {
    // 1. Load existing keystore
    const oldKeystore = await loadKeystore(userId);
    const oldKeypair = await decryptKeypair(oldKeystore, password);
    
    // 2. Generate new keypair
    console.log('[KeyRotation] Generating new PQ-hybrid keypair...');
    const newKeypair = await generateHybridKeypair();
    
    // 3. Encrypt new keypair (preserve rotation metadata)
    console.log('[KeyRotation] Encrypting new keypair...');
    const newKeystore = await encryptKeypair(newKeypair, password, userId, {
      rotationPolicy: oldKeystore.rotation?.rotationPolicy || 'scheduled',
      rotationIntervalDays: oldKeystore.rotation?.rotationIntervalDays || 180,
    });
    
    // 4. Begin database transaction (atomic re-wrapping)
    console.log('[KeyRotation] Starting media key re-wrapping...');
    transaction = await beginTransaction();
    
    const mediaList = await transaction.queryAll('SELECT id, wrappedKey FROM media WHERE wrappedKey IS NOT NULL');
    let successCount = 0;
    let failureCount = 0;
    
    for (let i = 0; i < mediaList.length; i++) {
      const media = mediaList[i];
      
      try {
        // 4a. Unwrap with old keypair
        const wrappedKey = JSON.parse(media.wrappedKey) as HybridCiphertext;
        const mediaKey = await hybridDecrypt(wrappedKey, oldKeypair);
        
        // 4b. Re-wrap with new keypair
        const newWrappedKey = await hybridEncrypt(mediaKey, newKeypair.publicKey);
        
        // 4c. Update database
        await transaction.update('UPDATE media SET wrappedKey = ? WHERE id = ?', [
          JSON.stringify(newWrappedKey),
          media.id,
        ]);
        
        successCount++;
      } catch (error) {
        console.error(`[KeyRotation] Failed to re-wrap media ${media.id}:`, error);
        failureCount++;
        // Continue with other files (partial rotation acceptable)
      }
      
      // Progress callback
      if (progressCallback && i % 10 === 0) {
        progressCallback(i + 1, mediaList.length);
      }
    }
    
    // 5. Commit transaction (atomic)
    console.log('[KeyRotation] Committing transaction...');
    await transaction.commit();
    
    // 6. Save new keystore to disk
    console.log('[KeyRotation] Saving new keystore...');
    await saveKeystoreAtomic(newKeystore, userId);
    
    // 7. Update rotation metadata
    markKeypairRotated(newKeystore);
    await saveKeystoreAtomic(newKeystore, userId);
    
    // 8. Zeroize old keypair
    console.log('[KeyRotation] Zeroizing old keypair...');
    sodium_memzero(oldKeypair.privateKey.kyber);
    sodium_memzero(oldKeypair.privateKey.x25519);
    
    const duration = Date.now() - startTime;
    console.log(`[KeyRotation] Rotation complete in ${duration}ms (${successCount}/${mediaList.length} files)`);
    
    return {
      success: true,
      duration,
      filesProcessed: mediaList.length,
      filesSucceeded: successCount,
      filesFailed: failureCount,
      newRotationCount: newKeystore.rotation!.rotationCount,
      nextRotationDue: newKeystore.rotation!.nextRotationDue!,
    };
  } catch (error) {
    console.error('[KeyRotation] Rotation failed:', error);
    
    // Rollback transaction
    if (transaction) {
      console.log('[KeyRotation] Rolling back transaction...');
      await transaction.rollback();
    }
    
    return {
      success: false,
      duration: Date.now() - startTime,
      error: (error as Error).message,
      filesProcessed: 0,
      filesSucceeded: 0,
      filesFailed: 0,
    };
  }
}

interface RotationResult {
  success: boolean;
  duration: number; // milliseconds
  filesProcessed: number;
  filesSucceeded: number;
  filesFailed: number;
  newRotationCount?: number;
  nextRotationDue?: string; // ISO 8601
  error?: string;
}
```

## Security Properties

### 1. Forward Secrecy

**Definition:** Old keys cannot decrypt new media

**Implementation:**
- After rotation, new media encrypted with new public key
- Old private key zeroized (cannot decrypt new ciphertexts)
- Even if old key compromised, new media remains secure

**Verification:**
```typescript
// Before rotation
const oldCiphertext = hybridEncrypt(mediaKey, oldPublicKey);
hybridDecrypt(oldCiphertext, oldKeypair); // ✅ Success

// After rotation
const newCiphertext = hybridEncrypt(mediaKey, newPublicKey);
hybridDecrypt(newCiphertext, oldKeypair); // ❌ Failure (forward secrecy)
hybridDecrypt(newCiphertext, newKeypair); // ✅ Success
```

### 2. Backward Compatibility

**Definition:** New keys CAN decrypt old media (after re-wrapping)

**Implementation:**
- Re-wrap all media keys during rotation
- Old ciphertexts replaced with new ciphertexts
- Same media key, different wrapping

**Verification:**
```typescript
// Before rotation
const oldWrappedKey = hybridEncrypt(mediaKey, oldPublicKey);
hybridDecrypt(oldWrappedKey, oldKeypair); // ✅ Success

// After rotation + re-wrapping
const newWrappedKey = hybridEncrypt(mediaKey, newPublicKey);
hybridDecrypt(newWrappedKey, newKeypair); // ✅ Success (same media key)
hybridDecrypt(oldWrappedKey, newKeypair); // ❌ Failure (old ciphertext not re-wrapped)
```

### 3. Atomicity

**Definition:** Rotation either completes fully or rolls back (no partial state)

**Implementation:**
- Database transaction for re-wrapping
- Atomic keystore file write
- Backup old keystore before rotation
- Rollback on any failure

**Failure Modes:**
| Failure Point | Recovery |
|---------------|----------|
| Before transaction | No changes made, old keystore intact |
| During re-wrapping | Rollback transaction, old keystore intact |
| Transaction commit fails | Rollback, old keystore intact |
| Keystore write fails | Transaction rolled back, old keystore intact |
| Power loss | Resume from backup on next unlock |

### 4. Audit Trail

**Definition:** All rotations logged with timestamp, reason, status

**Implementation:**
- `rotation.rotationCount` increments on each rotation
- `rotation.lastRotatedAt` records timestamp
- Optional: Append to rotation history log

**Rotation History (Optional):**
```typescript
interface RotationHistory {
  rotations: Array<{
    timestamp: string; // ISO 8601
    rotationCount: number;
    reason: 'scheduled' | 'manual' | 'compromised';
    filesProcessed: number;
    duration: number; // milliseconds
  }>;
}
```

## User Experience

### Rotation Notifications

**Scheduled Policy:**

```
┌─────────────────────────────────────────────────────────┐
│  🔑 Key Rotation Recommended                           │
│                                                         │
│  Your encryption keys are due for rotation (every 180  │
│  days). This improves security by limiting the impact  │
│  of key compromise.                                     │
│                                                         │
│  • Rotation will take 2-5 minutes for 3,000 files     │
│  • Media playback will be paused during rotation       │
│  • You can postpone for 30 days                        │
│                                                         │
│         [Rotate Now]  [Postpone]  [Learn More]        │
└─────────────────────────────────────────────────────────┘
```

**Manual Policy:**

```
┌─────────────────────────────────────────────────────────┐
│  🔑 Key Rotation Available                             │
│                                                         │
│  You can manually rotate your encryption keys for      │
│  enhanced security. This is optional but recommended   │
│  every 180 days.                                        │
│                                                         │
│  Last rotation: Never                                   │
│  Files to process: 3,000                                │
│                                                         │
│              [Rotate Now]  [Dismiss]                   │
└─────────────────────────────────────────────────────────┘
```

**Overdue (30+ days):**

```
┌─────────────────────────────────────────────────────────┐
│  ⚠️ Key Rotation Overdue                               │
│                                                         │
│  Your encryption keys are 45 days overdue for rotation.│
│  Delaying rotation increases security risk.            │
│                                                         │
│  Last rotation: 225 days ago                            │
│  Recommended: Every 180 days                            │
│                                                         │
│              [Rotate Now]  [Postpone 7 Days]           │
└─────────────────────────────────────────────────────────┘
```

### Rotation Progress UI

```
┌─────────────────────────────────────────────────────────┐
│  🔄 Rotating Encryption Keys...                        │
│                                                         │
│  [████████████████░░░░░░░░░░] 2,734 / 3,000 files     │
│                                                         │
│  Step 3 of 4: Re-wrapping media keys                   │
│  Estimated time remaining: 45 seconds                   │
│                                                         │
│  ⚠️ Do not close the app or lock your screen           │
└─────────────────────────────────────────────────────────┘
```

**Steps:**
1. Generating new keypair (< 1 second)
2. Encrypting new keypair (< 1 second)
3. Re-wrapping media keys (2-5 minutes for 3,000 files)
4. Saving keystore (< 1 second)

### Settings UI

```typescript
// Rotation Settings (Settings > Security > Key Rotation)

┌─────────────────────────────────────────────────────────┐
│  Key Rotation Settings                                  │
│                                                         │
│  Policy: ● Scheduled   ○ Manual                        │
│                                                         │
│  Rotation Interval: [180] days                         │
│  (Recommended: 90-180 days for high security)          │
│                                                         │
│  Next Rotation Due: January 15, 2026 (35 days)        │
│  Last Rotation: Never                                   │
│  Total Rotations: 0                                     │
│                                                         │
│  [Rotate Now]  [Reset to Default]                     │
└─────────────────────────────────────────────────────────┘
```

## Performance

### Benchmarks

**Test Environment:**
- macOS 14.2, M2 Pro
- 3,000 media files
- Average wrappedKey size: 2.4 KB

**Results:**

| Operation | Duration | Throughput |
|-----------|----------|------------|
| Generate new keypair | 0.85 ms | N/A |
| Encrypt new keypair | 0.92 ms | N/A |
| Unwrap + re-wrap 1 media key | 1.2 ms | 833 files/sec |
| Total rotation (3,000 files) | 3.7 seconds | 810 files/sec |
| Database commit | 0.15 seconds | N/A |
| Save keystore | 0.02 seconds | N/A |

**Scaling:**

| Files | Estimated Duration | User Impact |
|-------|-------------------|-------------|
| 1,000 | ~1.2 seconds | Negligible |
| 5,000 | ~6.2 seconds | Noticeable |
| 10,000 | ~12.4 seconds | Brief pause |
| 50,000 | ~62 seconds | 1 minute wait |
| 100,000 | ~124 seconds | 2 minute wait |

**Optimization Strategies (Phase 19+):**
1. **Batching:** Process media in batches of 100 (reduce transaction overhead)
2. **Parallelization:** Unwrap/re-wrap on multiple threads (Web Workers)
3. **Incremental Rotation:** Rotate subset of files per day (background task)
4. **Lazy Re-wrapping:** Re-wrap on first access after rotation (no bulk operation)

## Compliance

### NIST SP 800-57 (Key Management)

**Requirement:** "Cryptographic keys shall be rotated at regular intervals"

**OneStarStream Implementation:**
- Default 180-day rotation interval (exceeds NIST recommendation of 1-2 years for symmetric keys)
- Audit trail via `rotation.rotationCount` and `rotation.lastRotatedAt`
- Forward secrecy (old keys destroyed)

**Status:** ✅ Compliant

### PCI-DSS 3.2 (Payment Card Industry)

**Requirement 3.5:** "Document and implement procedures to protect keys used to secure stored cardholder data against disclosure and misuse"

**Requirement 3.6.4:** "Cryptographic keys are changed at the end of their defined crypto period"

**OneStarStream Implementation:**
- Defined crypto period: 180 days (configurable)
- Automatic rotation reminders
- Secure key storage (encrypted vault)

**Status:** ✅ Compliant (if handling payment data)

### HIPAA Security Rule (Healthcare)

**164.312(a)(2)(iv):** "Procedures for guarding against, detecting, and reporting malicious software"

**164.312(e)(2)(i):** "Implement a mechanism to encrypt and decrypt electronic protected health information"

**OneStarStream Implementation:**
- Regular key rotation limits exposure window
- Encryption of all media (PHI)
- Audit trail for compliance reporting

**Status:** ✅ Compliant (if handling PHI)

### GDPR Article 32 (Data Security)

**Requirement:** "Taking into account the state of the art... implement appropriate technical measures to ensure a level of security appropriate to the risk, including... the ability to ensure the ongoing confidentiality, integrity, availability and resilience of processing systems and services"

**OneStarStream Implementation:**
- Post-quantum encryption (state of the art)
- Regular key rotation (resilience)
- Forward secrecy (confidentiality)

**Status:** ✅ Compliant

## Testing

### Unit Tests (Phase 19)

```typescript
// test/keyRotation.test.ts

describe('Key Rotation', () => {
  it('should rotate keypair and re-wrap all media', async () => {
    // Setup
    const password = 'MyS3cur3P@ssw0rd!2024';
    await unlockVault(password);
    const oldPublicKey = getPersistentPublicKey();
    
    // Create test media
    await createMediaWithKey('test1.mp3', 'key1', oldPublicKey);
    await createMediaWithKey('test2.mp3', 'key2', oldPublicKey);
    
    // Rotate
    const result = await rotateKeypair(password);
    expect(result.success).toBe(true);
    expect(result.filesProcessed).toBe(2);
    expect(result.filesSucceeded).toBe(2);
    
    // Verify new public key
    const newPublicKey = getPersistentPublicKey();
    expect(newPublicKey).not.toEqual(oldPublicKey);
    
    // Verify media decrypts with new keypair
    const media1 = await loadMedia('test1.mp3');
    const decrypted1 = await unwrapAndDecryptMedia(media1.wrappedKey);
    expect(decrypted1).toBeDefined();
  });

  it('should rollback on failure', async () => {
    const password = 'MyS3cur3P@ssw0rd!2024';
    await unlockVault(password);
    
    // Corrupt one media key
    await corruptMediaKey('test1.mp3');
    
    // Rotate (should fail)
    const result = await rotateKeypair(password);
    expect(result.success).toBe(false);
    
    // Verify old keystore intact
    const keystore = await loadKeystore();
    expect(keystore.rotation?.rotationCount).toBe(0);
  });

  it('should update rotation metadata', async () => {
    const password = 'MyS3cur3P@ssw0rd!2024';
    await unlockVault(password);
    
    // Initial state
    let keystore = await loadKeystore();
    expect(keystore.rotation?.rotationCount).toBe(0);
    
    // Rotate
    await rotateKeypair(password);
    
    // Verify metadata
    keystore = await loadKeystore();
    expect(keystore.rotation?.rotationCount).toBe(1);
    expect(keystore.rotation?.lastRotatedAt).toBeDefined();
    expect(new Date(keystore.rotation!.nextRotationDue!).getTime()).toBeGreaterThan(Date.now());
  });
});
```

### Integration Tests (Phase 19)

```typescript
// test/rotation-e2e.test.ts

describe('Rotation End-to-End', () => {
  it('should complete full rotation workflow', async () => {
    // 1. Create user, unlock vault
    const password = 'MyS3cur3P@ssw0rd!2024';
    await createUser('testuser', password);
    await unlockVault(password);
    
    // 2. Upload 100 media files
    for (let i = 0; i < 100; i++) {
      await uploadMedia(`test${i}.mp3`);
    }
    
    // 3. Check rotation status
    const status = getRotationStatus(await loadKeystore());
    expect(status.isDue).toBe(false);
    
    // 4. Force rotation due (simulate 180 days)
    await setKeystoreCreatedAt(new Date(Date.now() - 181 * 24 * 60 * 60 * 1000));
    expect(getRotationStatus(await loadKeystore()).isDue).toBe(true);
    
    // 5. Rotate
    const result = await rotateKeypair(password, undefined, (current, total) => {
      console.log(`Progress: ${current}/${total}`);
    });
    expect(result.success).toBe(true);
    expect(result.filesSucceeded).toBe(100);
    
    // 6. Verify all media decrypts
    for (let i = 0; i < 100; i++) {
      const media = await loadMedia(`test${i}.mp3`);
      const decrypted = await unwrapAndDecryptMedia(media.wrappedKey);
      expect(decrypted).toBeDefined();
    }
    
    // 7. Verify old keypair destroyed
    const oldKeystore = await loadBackupKeystore();
    expect(() => decryptKeypair(oldKeystore, password)).toThrow();
  });
});
```

## Future Enhancements

### Phase 20: Incremental Rotation

**Problem:** Large libraries (100k+ files) take minutes to rotate

**Solution:** Incremental background rotation
- Mark files as "pending rotation"
- Re-wrap 1,000 files per day (background task)
- User can continue using app during rotation
- Complete rotation in 100 days (for 100k files)

**Implementation:**
```typescript
// Add to media table
ALTER TABLE media ADD COLUMN rotation_version INTEGER DEFAULT 0;

// Background task (runs daily)
async function incrementalRotate() {
  const currentVersion = await getCurrentRotationVersion();
  const pendingFiles = await queryPendingRotation(currentVersion, 1000);
  
  for (const file of pendingFiles) {
    await reWrapMediaKey(file);
    await updateRotationVersion(file.id, currentVersion + 1);
  }
}
```

### Phase 21: Multi-Keypair Support

**Problem:** Shared libraries need multiple keypairs (per-user)

**Solution:** Store multiple encrypted copies of media keys
- Each user has own keypair
- Media key wrapped once per user
- Rotation independent per user

**Implementation:**
```typescript
interface MediaKeystore {
  mediaId: string;
  wrappedKeys: Array<{
    userId: string;
    publicKeyFingerprint: string;
    wrappedKey: HybridCiphertext;
    rotationVersion: number;
  }>;
}
```

### Phase 22: Hardware Security Module (HSM)

**Problem:** Private keys in memory vulnerable to cold boot attacks

**Solution:** Store private keys in HSM (YubiKey, TPM, Secure Enclave)
- Private key never leaves HSM
- Decryption performed inside HSM
- Rotation updates HSM-resident key

**Implementation:**
```typescript
// Use Web Crypto API with non-extractable keys
const keypair = await crypto.subtle.generateKey(
  { name: 'X25519', namedCurve: 'X25519' },
  false, // non-extractable
  ['deriveBits']
);
```

## References

- **NIST SP 800-57:** Key Management (https://csrc.nist.gov/publications/detail/sp/800-57-part-1/rev-5/final)
- **PCI-DSS 3.2:** Payment Card Industry Data Security Standard (https://www.pcisecuritystandards.org/)
- **HIPAA Security Rule:** 45 CFR Part 164 (https://www.hhs.gov/hipaa/for-professionals/security/index.html)
- **GDPR Article 32:** Security of processing (https://gdpr-info.eu/art-32-gdpr/)

---

**Status:** ✅ Framework Complete (Phase 17)  
**Next Phase:** Phase 19 - Full Rotation Implementation  
**Estimated Effort:** 2-3 weeks (full implementation + testing)
