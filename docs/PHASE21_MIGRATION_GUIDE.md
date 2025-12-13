# Phase 21: Keystore v3 → v4 Migration Guide

## Overview

Keystore v4 adds device metadata and sync history to enable cross-device synchronization. Migration from v3 to v4 is **automatic**, **zero-data-loss**, and **idempotent**.

---

## Migration Trigger

Migration happens automatically on first app launch after Phase 21 deployment when:
1. Keystore file exists (`encryptedKeystore.json`)
2. Keystore version is `v3`
3. User unlocks vault (provides password)

**No user action required** - migration is transparent.

---

## What Changes

### Fields Added (v4)
- `deviceId`: Unique persistent device identifier
- `deviceName`: Device hostname/name
- `platform`: OS platform (darwin, win32, linux)
- `deviceCreatedAt`: Timestamp when device first used OneStar
- `lastSyncedAt`: Timestamp of last sync operation (initially = deviceCreatedAt)
- `syncHistory`: Array of sync records (initially empty)

### Fields Preserved (v3 → v4)
- `version`: Updated from `'v3'` to `'v4'`
- `userId`: Unchanged
- `encryptedIdentity`: Unchanged
- `encryptedCurrentKeypair`: Unchanged (structure preserved)
- `encryptedPreviousKeypairs`: Unchanged (structure preserved)
- `rotationHistory`: Unchanged (all entries preserved)
- `salt`: Unchanged (device-local, never synced)
- `biometricProfile`: Unchanged (device-local, never synced)
- `vaultSettings`: Unchanged (device-local, never synced)

### Fields Removed
None - v4 is **additive only**, zero data loss.

---

## Migration Process (Technical)

### Step 1: Detect v3 Keystore
```typescript
const keystore = await loadEncryptedKeystore();
if (keystore.version === 'v3') {
  // Trigger migration
}
```

### Step 2: Generate Device Metadata
```typescript
const deviceId = await getOrCreateDeviceId(); // Persistent UUID
const deviceName = os.hostname(); // e.g., "MacBook-Pro"
const platform = process.platform; // e.g., "darwin"
const now = Date.now();
```

### Step 3: Detect Biometrics (if not already detected)
```typescript
let biometricProfile = keystore.biometricProfile;
if (!biometricProfile) {
  biometricProfile = await detectBiometricCapabilities();
}
```

### Step 4: Build v4 Keystore
```typescript
const v4Keystore: EncryptedKeystoreV4 = {
  version: 'v4',
  userId: v3Keystore.userId,
  encryptedIdentity: v3Keystore.encryptedIdentity,
  
  // Serialize v3 keypair objects to strings
  encryptedCurrentKeypair: JSON.stringify(v3Keystore.currentKeypair),
  encryptedPreviousKeypairs: v3Keystore.previousKeypairs.length > 0
    ? JSON.stringify(v3Keystore.previousKeypairs)
    : undefined,
  
  rotationHistory: v3Keystore.rotationHistory || [],
  
  // New v4 fields
  deviceId,
  deviceName,
  platform,
  deviceCreatedAt: now,
  lastSyncedAt: now, // No syncs yet
  syncHistory: [],
  
  // Device-local fields
  salt: v3Keystore.salt,
  biometricProfile,
  vaultSettings: v3Keystore.vaultSettings,
};
```

### Step 5: Save v4 Keystore
```typescript
await saveEncryptedKeystore(v4Keystore);
console.log('Migration v3 → v4 complete');
```

### Step 6: Backup v3 (Optional)
```typescript
const backupPath = `${keystorePath}.v3.backup`;
await fs.writeFile(backupPath, JSON.stringify(v3Keystore, null, 2));
```

---

## Pre-Migration Checklist

### For Users
- [ ] **Backup keystore**: Copy `encryptedKeystore.json` to safe location
- [ ] **Test vault unlock**: Ensure you know your vault password
- [ ] **Close app**: Quit OneStar before upgrading
- [ ] **Check disk space**: Ensure 10MB+ free space

### For Developers
- [ ] **Test migration code**: Run migration on test keystore
- [ ] **Verify idempotence**: Migrate same keystore twice, verify no changes second time
- [ ] **Check error handling**: Test with corrupted v3 keystores
- [ ] **Backup strategy**: Document rollback procedure

---

## Post-Migration Validation

### Automatic Checks (in code)
```typescript
// Validate v4 structure
assert(migratedKeystore.version === 'v4');
assert(migratedKeystore.deviceId);
assert(migratedKeystore.deviceName);
assert(migratedKeystore.syncHistory.length === 0);

// Validate v3 data preserved
assert(migratedKeystore.userId === originalV3.userId);
assert(migratedKeystore.encryptedIdentity === originalV3.encryptedIdentity);
assert(migratedKeystore.rotationHistory.length === originalV3.rotationHistory.length);
```

### Manual User Validation
After migration, users should:
1. **Unlock vault**: Verify password still works
2. **Check identity**: Visit Settings → Identity, verify userId displayed
3. **Test encryption**: Upload new file, verify it encrypts successfully
4. **Test decryption**: Download existing file, verify it decrypts successfully
5. **Check rotation history**: Visit Settings → Security, verify rotation history intact

If any check fails → Rollback immediately

---

## Rollback Procedure

### Scenario: Migration Failed or Corrupted

#### Option 1: Restore from Backup (Recommended)
```bash
# 1. Quit OneStar app
killall OneStar

# 2. Restore v3 backup
cp encryptedKeystore.json.v3.backup encryptedKeystore.json

# 3. Relaunch app
open -a OneStar
```

#### Option 2: Manual Downgrade (v4 → v3)
```typescript
// If v4 keystore exists but migration failed
const v4Keystore = await loadEncryptedKeystore();

const v3Keystore: EncryptedKeystoreV3 = {
  version: 'v3',
  userId: v4Keystore.userId,
  encryptedIdentity: v4Keystore.encryptedIdentity,
  
  // Deserialize v4 strings back to objects
  currentKeypair: JSON.parse(v4Keystore.encryptedCurrentKeypair),
  previousKeypairs: v4Keystore.encryptedPreviousKeypairs
    ? JSON.parse(v4Keystore.encryptedPreviousKeypairs)
    : [],
  
  rotationHistory: v4Keystore.rotationHistory,
  salt: v4Keystore.salt,
  biometricProfile: v4Keystore.biometricProfile,
  vaultSettings: v4Keystore.vaultSettings,
};

await saveEncryptedKeystore(v3Keystore);
```

---

## Troubleshooting

### Issue: Migration Loop (keeps migrating on each restart)

**Symptoms:** App logs "Migration v3 → v4 complete" every time it launches

**Cause:** Migration not saving v4 keystore properly

**Solution:**
```typescript
// Check keystore after migration
const keystore = await loadEncryptedKeystore();
console.log('Keystore version:', keystore.version); // Should be 'v4'

if (keystore.version === 'v3') {
  console.error('Migration failed: keystore still v3');
  // Check file permissions, disk space, etc.
}
```

---

### Issue: Device ID Changes on Each Restart

**Symptoms:** `deviceId` different after each app restart

**Cause:** Device ID not persisted to disk

**Solution:**
```typescript
// Device ID should be saved to userData directory
const deviceIdPath = path.join(app.getPath('userData'), 'device-id.txt');

// Check if file exists
if (!fs.existsSync(deviceIdPath)) {
  console.error('Device ID file not found:', deviceIdPath);
  // Regenerate and save
  const deviceId = crypto.randomUUID();
  await fs.writeFile(deviceIdPath, deviceId);
}
```

---

### Issue: Keypair Decryption Fails After Migration

**Symptoms:** User can unlock vault, but media decryption fails with "Invalid keypair" error

**Cause:** v3 keypair structure not properly serialized to v4 format

**Diagnosis:**
```typescript
// Check v4 keypair format
const currentKeypair = JSON.parse(keystore.encryptedCurrentKeypair);
console.log('Current keypair structure:', currentKeypair);

// Should have: { publicKey, encryptedPrivateKey, rotatedAt }
assert(currentKeypair.publicKey);
assert(currentKeypair.encryptedPrivateKey);
```

**Solution:** Rollback to v3, fix migration code, re-migrate.

---

### Issue: Rotation History Lost

**Symptoms:** Rotation history empty after migration

**Cause:** v3 keystore had `rotationHistory` but migration didn't preserve it

**Solution:**
```typescript
// Check v3 backup
const v3Backup = JSON.parse(await fs.readFile('encryptedKeystore.json.v3.backup'));
console.log('v3 rotation history:', v3Backup.rotationHistory);

// Restore rotation history to v4
const v4Keystore = await loadEncryptedKeystore();
v4Keystore.rotationHistory = v3Backup.rotationHistory;
await saveEncryptedKeystore(v4Keystore);
```

---

## Migration Testing Strategy

### Unit Tests
```typescript
test('Migration preserves all v3 data', async () => {
  const v3Keystore = createMockV3Keystore();
  const v4Keystore = await migrateKeystoreV3ToV4(v3Keystore);
  
  assert.equal(v4Keystore.userId, v3Keystore.userId);
  assert.equal(v4Keystore.encryptedIdentity, v3Keystore.encryptedIdentity);
  
  const v4Current = JSON.parse(v4Keystore.encryptedCurrentKeypair);
  assert.equal(v4Current.publicKey, v3Keystore.currentKeypair.publicKey);
});

test('Migration is idempotent', async () => {
  const v3Keystore = createMockV3Keystore();
  const v4First = await migrateKeystoreV3ToV4(v3Keystore);
  const v4Second = await migrateKeystoreV3ToV4(v4First); // Migrate v4 (no-op)
  
  assert.deepEqual(v4First, v4Second);
});
```

### Integration Tests
1. **Fresh install**: Test first-time v3 creation, then migrate to v4
2. **Existing user**: Test real v3 keystore migration
3. **Multi-device**: Migrate v3 on Device A, sync to Device B
4. **Rotation after migration**: Rotate keypair on v4, verify sync works

---

## Deployment Strategy

### Phase 21 Rollout Plan
1. **Week 1**: Internal dogfooding (developers test on own devices)
2. **Week 2**: Beta testers (10-20 users)
3. **Week 3**: Staged rollout (10% of users)
4. **Week 4**: Full rollout (100% of users)

### Monitoring
- Log migration success/failure rates
- Track average migration time
- Alert on > 1% migration failures
- Monitor support tickets for migration issues

### Rollback Plan
If migration failure rate > 5%:
1. Pause rollout
2. Analyze failure logs
3. Fix migration code
4. Resume rollout after fix validated

---

## FAQ

### Q: Will migration delete my data?
**A:** No, migration is additive only. All v3 data is preserved.

### Q: Can I skip migration and stay on v3?
**A:** No, v4 is required for Phase 21+. However, v3 keystores continue to work for single-device use (no sync).

### Q: What if migration fails?
**A:** App will keep retrying on next vault unlock. If repeated failures, restore from backup or contact support.

### Q: Can I migrate back from v4 to v3?
**A:** Yes (see Rollback Procedure), but you'll lose sync history. Device metadata is discarded.

### Q: Will synced devices auto-migrate?
**A:** Yes, each device migrates independently when upgraded to Phase 21.

### Q: What if I import v3 export into v4 keystore?
**A:** Import will auto-upgrade v3 export to v4 format during merge.

---

## Support Contacts

- **Migration issues**: support@onestar.app
- **Data recovery**: emergency@onestar.app
- **Bug reports**: github.com/onestar/issues

---

**Document Version:** 1.0  
**Last Updated:** Phase 21 Implementation  
**Next Review:** After Phase 21 deployment (monitor for issues)
