# Phase 19: Key Rotation Engine - Architecture Design

**Version:** 1.0  
**Date:** December 12, 2025  
**Status:** 🚧 DESIGN PHASE

## Overview

Phase 19 implements **automated key rotation** for the user's persistent PQ-hybrid keypair, enabling:

- **Time-based rotation** (default: 180 days)
- **Manual rotation** ("Rotate Now" button)
- **Forced rotation** (security event response)
- **Backward compatibility** (old keys retained for decrypting legacy media)
- **Forward secrecy** (new keys used for all future operations)

## Architecture Principles

### 1. Multi-Keypair Model

**Previous (Phase 17-18):**
```
Keystore v2:
- Single keypair (currentKeypair)
- Rotation metadata (lastRotatedAt, rotationCount)
```

**New (Phase 19):**
```
Keystore v3:
- Current keypair (active, used for new media)
- Previous keypairs[] (retired, used only for decryption)
- Rotation history[] (audit trail)
```

### 2. Rotation Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│                    Key Rotation Lifecycle                       │
└─────────────────────────────────────────────────────────────────┘

Trigger         →    Generate New Key    →    Re-wrap Media    →    Update Keystore
(Time/Manual)        (Kyber+X25519)          (Old→New)              (Atomic)

     │                    │                       │                      │
     │                    │                       │                      │
     v                    v                       v                      v
180 days elapsed    New currentKeypair     Batch re-wrap all      Mark old as retired
Manual button       Ephemeral in memory    user's media keys      Persist v3 keystore
Security event      Zeroize after use      Update DB records      Emit rotation event
```

### 3. Backward Compatibility Strategy

**Decryption Priority:**
1. Try current keypair (most recent, fastest path)
2. Try previous keypairs in reverse chronological order
3. Fail if no keypair can unwrap

**Encryption Strategy:**
- Always use current keypair for new media
- Never use retired keypairs for encryption

## Keystore v3 Schema

```typescript
interface EncryptedKeystoreV3 {
  version: 'v3';
  algorithm: 'Kyber768-X25519-AES256GCM';
  
  // Key derivation (unchanged from v2)
  salt: string;
  iterations: number;
  
  // Current keypair (active)
  currentKeypair: {
    encryptedKeypair: string; // AES-GCM encrypted HybridKeypair
    iv: string;
    publicKey: {
      kyber: string;
      x25519: string;
    };
    createdAt: string;
    keyId: string; // Unique identifier (UUIDv4)
  };
  
  // Previous keypairs (retired, decryption-only)
  previousKeypairs: Array<{
    encryptedKeypair: string;
    iv: string;
    publicKey: {
      kyber: string;
      x25519: string;
    };
    createdAt: string;
    retiredAt: string;
    keyId: string;
    reason: string; // "rotation" | "compromised" | "manual"
  }>;
  
  // Rotation history (audit trail)
  rotationHistory: Array<{
    timestamp: string;
    oldKeyId: string;
    newKeyId: string;
    reason: string;
    mediaReWrapped: number; // Count of media keys re-wrapped
    duration: number; // ms
    triggeredBy: 'automatic' | 'manual' | 'security-event';
  }>;
  
  // Rotation policy
  rotationPolicy: {
    mode: 'manual' | 'scheduled';
    intervalDays: number; // Default: 180
    nextRotationDue?: string; // ISO 8601
    autoRotateEnabled: boolean;
  };
  
  // Metadata
  createdAt: string;
  lastUnlockedAt?: string;
  userId?: string;
  
  // Biometric (unchanged from v2)
  biometric?: {
    enrolled: boolean;
    enrolledAt?: string;
    method?: 'touch-id' | 'face-id' | 'windows-hello';
    encryptedPasswordHash?: string;
  };
}
```

## Migration Path: v2 → v3

### Migration Strategy

**Backward Compatibility:**
- Read v2 keystore ✅
- Migrate to v3 on first unlock after upgrade ✅
- Keep v2 file as backup (.v2.backup) ✅
- Atomic migration (all-or-nothing) ✅

**Migration Steps:**
```typescript
async function migrateKeystoreV2ToV3(v2Keystore: EncryptedKeystoreV2): Promise<EncryptedKeystoreV3> {
  // 1. Extract current keypair from v2
  const currentKeypair = {
    encryptedKeypair: v2Keystore.encryptedKeypair,
    iv: v2Keystore.iv,
    publicKey: v2Keystore.publicKey,
    createdAt: v2Keystore.createdAt,
    keyId: generateUUID(), // Assign ID to existing keypair
  };
  
  // 2. Initialize empty previous keypairs (none before v3)
  const previousKeypairs = [];
  
  // 3. Initialize rotation history
  const rotationHistory = [
    {
      timestamp: new Date().toISOString(),
      oldKeyId: 'migration',
      newKeyId: currentKeypair.keyId,
      reason: 'Migrated from keystore v2',
      mediaReWrapped: 0,
      duration: 0,
      triggeredBy: 'automatic',
    },
  ];
  
  // 4. Copy rotation policy from v2
  const rotationPolicy = {
    mode: v2Keystore.rotation?.rotationPolicy || 'manual',
    intervalDays: v2Keystore.rotation?.rotationIntervalDays || 180,
    nextRotationDue: v2Keystore.rotation?.nextRotationDue,
    autoRotateEnabled: v2Keystore.rotation?.rotationPolicy === 'scheduled',
  };
  
  // 5. Build v3 keystore
  return {
    version: 'v3',
    algorithm: v2Keystore.algorithm,
    salt: v2Keystore.salt,
    iterations: v2Keystore.iterations,
    currentKeypair,
    previousKeypairs,
    rotationHistory,
    rotationPolicy,
    createdAt: v2Keystore.createdAt,
    lastUnlockedAt: v2Keystore.lastUnlockedAt,
    userId: v2Keystore.userId,
    biometric: v2Keystore.biometric,
  };
}
```

## Key Rotation Engine

### Core Rotation Function

```typescript
interface RotationResult {
  success: boolean;
  newKeyId: string;
  oldKeyId: string;
  mediaReWrapped: number;
  duration: number;
  error?: string;
}

async function rotateKeypair(
  password: string,
  reason: string = 'manual',
  options?: {
    force?: boolean; // Skip confirmation prompts
    reWrapMedia?: boolean; // Default: true
  }
): Promise<RotationResult> {
  const startTime = Date.now();
  
  // 1. Verify vault is unlocked
  if (!isPersistentKeypairUnlocked()) {
    throw new Error('Vault must be unlocked to rotate keypair');
  }
  
  // 2. Load current keystore
  const currentKeystore = await loadKeystore();
  if (currentKeystore.version !== 'v3') {
    throw new Error('Must migrate to v3 before rotation');
  }
  
  // 3. Decrypt current keypair (for re-wrapping media)
  const currentKeypair = await decryptCurrentKeypair(currentKeystore, password);
  
  // 4. Generate new keypair
  const newKeypair = await generateHybridKeypair();
  const newKeyId = generateUUID();
  
  // 5. Re-wrap all user's media keys (if enabled)
  let mediaReWrapped = 0;
  if (options?.reWrapMedia !== false) {
    mediaReWrapped = await reWrapAllMediaKeys(currentKeypair, newKeypair);
  }
  
  // 6. Prepare v3 keystore with new structure
  const newKeystore: EncryptedKeystoreV3 = {
    ...currentKeystore,
    
    // Move current to previous
    previousKeypairs: [
      ...currentKeystore.previousKeypairs,
      {
        ...currentKeystore.currentKeypair,
        retiredAt: new Date().toISOString(),
        reason,
      },
    ],
    
    // Set new as current
    currentKeypair: {
      encryptedKeypair: await encryptKeypairData(newKeypair, password),
      iv: generateIV(),
      publicKey: serializePublicKey(newKeypair),
      createdAt: new Date().toISOString(),
      keyId: newKeyId,
    },
    
    // Append to rotation history
    rotationHistory: [
      ...currentKeystore.rotationHistory,
      {
        timestamp: new Date().toISOString(),
        oldKeyId: currentKeystore.currentKeypair.keyId,
        newKeyId,
        reason,
        mediaReWrapped,
        duration: Date.now() - startTime,
        triggeredBy: options?.force ? 'security-event' : 'manual',
      },
    ],
    
    // Update rotation policy
    rotationPolicy: {
      ...currentKeystore.rotationPolicy,
      nextRotationDue: calculateNextRotation(currentKeystore.rotationPolicy.intervalDays),
    },
  };
  
  // 7. Atomically save new keystore
  await saveKeystoreAtomic(newKeystore);
  
  // 8. Zeroize old keypair
  zeroizeKeypair(currentKeypair);
  zeroizeKeypair(newKeypair);
  
  // 9. Emit rotation event
  vaultLifecycleManager.emit('keypair-rotated', {
    oldKeyId: currentKeystore.currentKeypair.keyId,
    newKeyId,
    timestamp: new Date(),
    mediaReWrapped,
  });
  
  return {
    success: true,
    newKeyId,
    oldKeyId: currentKeystore.currentKeypair.keyId,
    mediaReWrapped,
    duration: Date.now() - startTime,
  };
}
```

### Media Key Re-Wrapping

```typescript
async function reWrapAllMediaKeys(
  oldKeypair: HybridKeypair,
  newKeypair: HybridKeypair
): Promise<number> {
  // 1. Fetch all user's media from database
  const allMedia = await fetchUserMedia();
  
  let reWrappedCount = 0;
  const batchSize = 10; // Process in batches to avoid memory issues
  
  // 2. Process in batches
  for (let i = 0; i < allMedia.length; i += batchSize) {
    const batch = allMedia.slice(i, i + batchSize);
    
    await Promise.all(
      batch.map(async (media) => {
        try {
          // Unwrap with old keypair
          const mediaKey = await unwrapMediaKeyHybrid(media.wrappedKey, oldKeypair);
          
          // Re-wrap with new keypair
          const newWrappedKey = await wrapMediaKeyHybrid(
            mediaKey,
            serializePublicKey(newKeypair)
          );
          
          // Update database
          await updateMediaWrappedKey(media.id, newWrappedKey);
          
          // Zeroize media key
          mediaKey.fill(0);
          
          reWrappedCount++;
        } catch (error) {
          console.error(`Failed to re-wrap media ${media.id}:`, error);
          // Continue with other media (non-fatal)
        }
      })
    );
    
    // Progress callback for UI
    vaultLifecycleManager.emit('rotation-progress', {
      completed: i + batch.length,
      total: allMedia.length,
    });
  }
  
  return reWrappedCount;
}
```

## Rotation Scheduler

### Time-Based Rotation

```typescript
class RotationScheduler {
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL_MS = 60 * 60 * 1000; // Check hourly
  
  start() {
    if (this.checkInterval) return;
    
    // Check immediately on start
    this.checkRotationDue();
    
    // Then check every hour
    this.checkInterval = setInterval(() => {
      this.checkRotationDue();
    }, this.CHECK_INTERVAL_MS);
  }
  
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
  
  private async checkRotationDue() {
    try {
      const keystore = await loadKeystore();
      
      if (keystore.version !== 'v3') return;
      if (!keystore.rotationPolicy.autoRotateEnabled) return;
      
      const nextRotationDue = keystore.rotationPolicy.nextRotationDue;
      if (!nextRotationDue) return;
      
      const dueDate = new Date(nextRotationDue);
      const now = new Date();
      
      if (now >= dueDate) {
        // Rotation due - notify user
        vaultLifecycleManager.emit('rotation-due', {
          dueDate,
          intervalDays: keystore.rotationPolicy.intervalDays,
          currentKeyAge: calculateKeyAge(keystore.currentKeypair.createdAt),
        });
        
        // If auto-rotate enabled, perform rotation (requires vault unlocked)
        if (isPersistentKeypairUnlocked()) {
          // Auto-rotate in background (requires password or biometric)
          // This should prompt user for confirmation first
          console.log('[RotationScheduler] Auto-rotation due - prompting user');
        }
      }
    } catch (error) {
      console.error('[RotationScheduler] Check failed:', error);
    }
  }
}
```

## Security Analysis

### Threat Model

**Threat 1: Compromised Old Key**

**Attack:** Attacker obtains old retired keypair from backup/memory dump

**Mitigation:**
- Old keys zeroized from memory after rotation
- Old keys only stored encrypted-at-rest
- Cannot decrypt NEW media (forward secrecy)
- Can decrypt OLD media (required for backward compat)

**Result:** Partial compromise (old media only)

---

**Threat 2: Rotation Interrupted**

**Attack:** App crashes during rotation, keystore corrupted

**Mitigation:**
- Atomic keystore writes (temp file + rename)
- Keep v2 backup during migration
- Transaction-like rotation (all-or-nothing)
- Rollback mechanism if rotation fails

**Result:** No data loss, graceful recovery

---

**Threat 3: Forced Rotation Bypass**

**Attack:** Attacker prevents rotation to keep compromised key active

**Mitigation:**
- Rotation history audit trail
- UI warnings if rotation overdue
- Admin can force rotation remotely
- Keystore version prevents downgrade attacks

**Result:** Rotation cannot be silently bypassed

---

**Threat 4: Key Confusion Attack**

**Attack:** Attacker substitutes old key as current during rotation

**Mitigation:**
- Unique keyId per keypair (UUIDv4)
- Rotation history tracks oldKeyId → newKeyId
- Timestamps prevent replay attacks
- Cryptographic binding in keystore structure

**Result:** Key substitution detectable

---

**Threat 5: Brute Force During Rotation**

**Attack:** Attacker targets re-wrapped media keys

**Mitigation:**
- Media keys remain 256-bit random (not weakened)
- Re-wrapping uses fresh ephemeral keys (X25519)
- New Kyber encapsulation per wrap
- No timing side-channels in batch processing

**Result:** Re-wrapped keys as strong as originals

## Performance Estimates

### Rotation Duration

**Components:**
- Generate new keypair: ~1ms
- Re-wrap 100 media keys: ~800ms (8ms per key)
- Re-wrap 1000 media keys: ~8 seconds
- Keystore encryption: ~500ms (PBKDF2)
- Database updates: ~50ms per batch (10 keys)

**Total (1000 media items):** ~10-12 seconds

### Memory Usage

**Peak:**
- Current keypair: ~5KB
- New keypair: ~5KB
- Media keys in batch (10): ~320 bytes
- Total: <20KB additional (minimal overhead)

### Storage Growth

**Keystore v3:**
- Current keypair: ~8KB
- Previous keypair: ~8KB per rotation
- Rotation history: ~500 bytes per rotation
- Total per rotation: ~8.5KB

**After 10 rotations:** ~85KB (negligible)

## Implementation Checklist

### Phase 19.1: Core Rotation Engine
- [ ] Design keystore v3 schema
- [ ] Implement migration v2 → v3
- [ ] Create `rotateKeypair()` function
- [ ] Implement `reWrapAllMediaKeys()`
- [ ] Add atomic keystore updates
- [ ] Zeroization on rotation

### Phase 19.2: Scheduler & Triggers
- [ ] Build RotationScheduler class
- [ ] Implement time-based checks
- [ ] Add manual rotation button
- [ ] Create forced rotation API
- [ ] Emit rotation events

### Phase 19.3: API Integration
- [ ] Update preload APIs
- [ ] Add `window.onestar.rotateKeypair()`
- [ ] Add `window.onestar.getRotationStatus()`
- [ ] Add `window.onestar.needsRotation()`
- [ ] Update TypeScript definitions

### Phase 19.4: Upload/Share Flows
- [ ] Modify upload to use currentKeypair
- [ ] Modify share to use currentKeypair
- [ ] Update unwrap to try previousKeypairs[]
- [ ] Maintain backward compatibility

### Phase 19.5: UI & UX
- [ ] Rotation status badge
- [ ] Manual rotation button
- [ ] Rotation history view
- [ ] Progress indicator
- [ ] Confirmation dialogs

### Phase 19.6: Testing & Documentation
- [ ] Unit tests for rotation engine
- [ ] Integration tests for re-wrapping
- [ ] Migration tests v2 → v3
- [ ] Performance benchmarks
- [ ] Create documentation

## Next Steps

1. Implement keystore v3 schema (`hybridKeypairStore.ts`)
2. Create migration function v2 → v3
3. Build core rotation engine
4. Update preload APIs
5. Test with real encrypted media
6. Document threat model

---

**Status:** 🚧 DESIGN COMPLETE  
**Next:** Begin implementation of keystore v3 schema
