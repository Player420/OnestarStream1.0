# Phase 19 Integration Plan

## A. File-by-File Patch Plan

### 1. Database Layer (`src/lib/db/mediaLicenses.table.ts`)
**Purpose:** Add functions for rotation engine to query/update wrapped keys

**New Functions:**
- `listAllEncryptedMediaMetadata(userId)` - Return all media with wrapped keys
- `updateWrappedKey(licenseId, userId, newWrappedKey, newPublicKey)` - Update wrapped key after rotation
- `countEncryptedMedia(userId)` - Count user's media for progress tracking
- `getPublicKeyForMedia(licenseId, userId)` - Get the public key used to wrap media

**Why:** MediaKeyReWrapper needs to fetch all media, re-wrap keys, and update database atomically.

---

### 2. Preload Integration (`electron/preload.ts`)
**Purpose:** Wire rotation APIs to engine, emit lifecycle events

**Changes:**
- Implement `rotateKeypair()` - Call rotation engine with database integration
- Implement `getRotationStatus()` - Load keystore v3, return status
- Implement `needsRotation()` - Check rotation due date
- Implement `getRotationHistory()` - Load keystore v3, return history
- Add rotation event emitters (rotation-start, rotation-progress, rotation-finished, rotation-error)

**Why:** Renderer needs complete API surface to trigger rotations and display status.

---

### 3. Upload Flow (`src/app/api/encrypted-media/upload/route.ts`)
**Purpose:** Always use current public key from keystore v3

**Changes:**
- Load keystore v3 on upload
- Extract `currentKeypair.publicKey`
- Store `wrappedToPublicKey` metadata in license
- Maintain backward compatibility (v2 → v3 migration)

**Why:** New uploads must use current public key for forward secrecy.

---

### 4. Share Flow (`src/app/api/encrypted-media/share/route.ts`)
**Purpose:** Re-wrap with recipient's current public key

**Changes:**
- Load recipient's keystore v3
- Extract `currentKeypair.publicKey`
- Re-wrap media key with recipient's current public key
- Store `wrappedToPublicKey` metadata

**Why:** Shares must use recipient's current public key for forward secrecy.

---

### 5. Streaming Decryptor (`src/lib/encryptedStreamDecoder.ts`)
**Purpose:** Support backward compatibility with fallback unwrapping

**Changes:**
- Replace direct `unwrapMediaKeyHybrid()` with `unwrapMediaKeyWithFallback()`
- Try current keypair first
- Fallback to previous keypairs if unwrap fails
- Log which keypair succeeded (for debugging)

**Why:** Media wrapped with old keys must still play after rotation.

---

### 6. MediaDatabase Implementation (`src/lib/mediaDatabase.ts` - NEW)
**Purpose:** Implement MediaDatabase interface for MediaKeyReWrapper

**Creates:**
- `OneStarMediaDatabase` class implementing `MediaDatabase`
- `fetchUserMedia()` - Query all user's media from database
- `updateMediaKey()` - Update wrapped key atomically

**Why:** Rotation engine needs concrete implementation of abstract database interface.

---

### 7. Preload Rotation Helpers (`src/lib/preloadRotationHelpers.ts` - NEW)
**Purpose:** Helper functions for preload rotation implementation

**Creates:**
- `performRotation()` - Full rotation workflow with events
- `loadRotationStatus()` - Load and parse rotation status
- `emitRotationEvent()` - Emit IPC events to renderer

**Why:** Keep preload.ts clean, separate concerns.

---

## B. Integration Test Plan

### Pre-Rotation Behavior
1. Upload media with current public key
2. Verify `wrappedToPublicKey` matches `currentKeypair.keyId`
3. Verify playback works

### Rotation with 0 Media
1. Call `rotateKeypair(password, 'test rotation')`
2. Verify new keystore has:
   - New `currentKeypair` with different keyId
   - Old keypair in `previousKeypairs[]`
   - New entry in `rotationHistory[]`
3. Verify `mediaReWrapped: 0`

### Rotation with N Media
1. Upload 10 media items
2. Call `rotateKeypair(password, 'test rotation', { reWrapMedia: true })`
3. Verify progress events emitted (0%, 10%, 20%, ..., 100%)
4. Verify `mediaReWrapped: 10`
5. Verify all media have `wrappedToPublicKey` updated to new keyId

### Backward Compatibility Playback Test
1. Upload media with key A (keyId: aaa)
2. Rotate to key B (keyId: bbb)
3. Upload new media with key B
4. Play old media → should unwrap with key A (from previousKeypairs[])
5. Play new media → should unwrap with key B (from currentKeypair)
6. Verify both play successfully

### Out-of-Date Key Recovery
1. Media uploaded with key A
2. Rotate to key B
3. Media re-wrapped with key B
4. Rotate to key C
5. Play media → should unwrap with key C (currentKeypair)
6. If unwrap fails, try key B (previousKeypairs[0])
7. If unwrap fails, try key A (previousKeypairs[1])

---

## C. Security Verification Checklist

### ✅ No Private Key Leaves Preload/Lib
- [ ] Verify `rotateKeypair()` never sends private key to renderer
- [ ] Verify preload only exposes public keys
- [ ] Verify IPC events contain no key material
- [ ] Audit all `ipcRenderer.send()` calls

### ✅ All Old Keys Remain Decrypt-Only
- [ ] Verify upload always uses `currentKeypair.publicKey`
- [ ] Verify share always uses `currentKeypair.publicKey`
- [ ] Verify previousKeypairs[] never used for encryption
- [ ] Test: Upload after rotation uses new key

### ✅ Zero Downtime During Rotation
- [ ] Media playback continues during rotation
- [ ] Upload/share blocked during rotation (return 503)
- [ ] Rotation progress shown in UI
- [ ] User can cancel rotation (rollback)

### ✅ Atomic Rollback on Failure
- [ ] If re-wrapping fails, keystore not updated
- [ ] If keystore update fails, media keys not updated
- [ ] Verify temp keystore backup exists
- [ ] Test: Simulate failure at 50% re-wrap, verify rollback

---

## D. Implementation Order

1. **Database Layer** (1-2 hours)
   - Add `listAllEncryptedMediaMetadata()`
   - Add `updateWrappedKey()`
   - Add `countEncryptedMedia()`

2. **MediaDatabase Implementation** (1 hour)
   - Create `src/lib/mediaDatabase.ts`
   - Implement `OneStarMediaDatabase` class

3. **Preload Helpers** (2 hours)
   - Create `src/lib/preloadRotationHelpers.ts`
   - Implement `performRotation()`
   - Implement event emitters

4. **Preload Integration** (2 hours)
   - Wire `rotateKeypair()` to helpers
   - Implement `getRotationStatus()`
   - Implement `needsRotation()`
   - Implement `getRotationHistory()`

5. **Upload/Share Flows** (2 hours)
   - Update upload route to use current public key
   - Update share route to use current public key
   - Add metadata storage

6. **Streaming Decryptor** (1 hour)
   - Replace unwrap with fallback function
   - Add logging for keypair selection

7. **Testing** (3-4 hours)
   - Integration tests
   - Backward compatibility tests
   - Security audit

**Total Estimated Time:** 12-15 hours
