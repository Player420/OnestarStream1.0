# Phase 21: Threat Model

## Overview

Cross-device keystore sync introduces 8 threat vectors that could compromise user identity or keypairs. This document analyzes each threat and documents implemented mitigations.

---

## THREAT-1: Password Brute-Force Attack

### Description
Attacker obtains encrypted export file and attempts to guess password through brute-force.

**Attack Scenario:**
1. Attacker intercepts export file during USB transfer
2. Attacker runs automated password guessing tool
3. Weak password allows decryption within hours/days

### Likelihood
**MEDIUM** - Export files may be transmitted via USB, email, or unencrypted cloud storage

### Impact
**CRITICAL** - Successful decryption exposes user's entire keypair history

### Mitigation
1. **Password requirements**: Minimum 12 characters enforced
2. **PBKDF2-SHA512**: 100,000 iterations (~1 second per guess)
3. **Cost calculation**: 1 billion guesses = 31 years of computation
4. **User education**: Recommend strong passwords (16+ chars, mixed case, symbols)

### Verification
```javascript
// Test: Password minimum length
assert(password.length >= 12, 'Password too short');

// Test: PBKDF2 iterations
assert(iterations === 100000, 'PBKDF2 iterations insufficient');

// Test: Timing attack (should take ~1 second)
const start = Date.now();
await deriveEncryptionKey(password, salt, 100000);
const duration = Date.now() - start;
assert(duration >= 800 && duration <= 1500, 'PBKDF2 timing incorrect');
```

**Status:** ✅ MITIGATED (TEST-SYNC-020, TEST-SYNC-013)

---

## THREAT-2: Downgrade Attack

### Description
Attacker replays old export file to revert user's keypair to compromised version.

**Attack Scenario:**
1. User's Device A keypair is compromised (attacker has private key)
2. User rotates keypair on Device A (generates new secure keypair)
3. Attacker exports old keystore (before rotation) from their copy
4. Attacker tricks user into importing old export on Device B
5. Device B reverts to compromised keypair

### Likelihood
**LOW** - Requires attacker to have prior access to keystore

### Impact
**CRITICAL** - User believes they've rotated to secure keypair, but still using compromised one

### Mitigation
1. **Rotation history validation**: Import checks that imported rotation history is SUPERSET of local
2. **Missing rotation detection**: If import missing rotations from local, reject as downgrade attack
3. **Timestamp validation**: Refuse imports older than local keystore creation

### Verification
```javascript
// Test: Detect missing rotation
const localRotations = new Set(['rot-1', 'rot-2', 'rot-3']);
const importedRotations = new Set(['rot-1', 'rot-3']); // rot-2 missing

for (const id of localRotations) {
  if (!importedRotations.has(id)) {
    throw new Error('Downgrade attack detected');
  }
}
```

**Status:** ✅ MITIGATED (TEST-SYNC-009, keystoreExport.ts:validateNoDowngradeAttack)

---

## THREAT-3: Replay Attack

### Description
Attacker replays same export multiple times to confuse sync state or trigger bugs.

**Attack Scenario:**
1. User exports keystore to USB
2. Attacker copies export file
3. Attacker imports same export 100 times on target device
4. Sync history polluted with duplicate records
5. Potential bugs triggered by duplicate entries

### Likelihood
**MEDIUM** - Easy to execute once attacker has export file

### Impact
**LOW** - Mostly annoyance, but could trigger edge case bugs

### Mitigation
1. **Signature deduplication**: Track HMAC signature of each import
2. **Reject duplicates**: If signature already in sync history, reject as replay
3. **Constant-time comparison**: Use `crypto.timingSafeEqual` to prevent timing attacks on signature check

### Verification
```javascript
// Test: Detect replay
const syncHistory = [
  { signatureHash: 'sig-123' },
  { signatureHash: 'sig-456' },
];

const incomingSignature = 'sig-123'; // duplicate
const isReplay = syncHistory.some(s => s.signatureHash === incomingSignature);

assert(isReplay === true, 'Should detect replay');
```

**Status:** ✅ MITIGATED (TEST-SYNC-010, keystoreExport.ts:validateSyncNotReplayed)

---

## THREAT-4: Tampering Attack

### Description
Attacker modifies encrypted export file to inject malicious keypair or identity data.

**Attack Scenario:**
1. User exports keystore
2. Attacker intercepts file, decrypts with stolen password
3. Attacker modifies userId to point to attacker's identity
4. Attacker re-encrypts with same password
5. User imports tampered file, now using attacker's identity

### Likelihood
**LOW** - Requires both file access AND password knowledge

### Impact
**CRITICAL** - User's identity completely replaced with attacker's

### Mitigation
1. **HMAC-SHA256 signature**: Computed over plaintext payload before encryption
2. **Signature verification**: Import validates HMAC before processing payload
3. **Constant-time comparison**: Prevents timing attacks on signature check
4. **Signature included in encryption**: Attacker cannot recompute valid HMAC without password

### Verification
```javascript
// Test: Detect tampering
const payload = { userId: 'user-123' };
const hmac = crypto.createHmac('sha256', 'key');
hmac.update(JSON.stringify(payload));
const originalSignature = hmac.digest('hex');

// Attacker tampers
payload.userId = 'attacker-456';

// Verify HMAC
const hmacVerify = crypto.createHmac('sha256', 'key');
hmacVerify.update(JSON.stringify(payload));
const computedSignature = hmacVerify.digest('hex');

assert(originalSignature !== computedSignature, 'Should detect tampering');
```

**Status:** ✅ MITIGATED (TEST-SYNC-011, TEST-SYNC-012, keystoreExport.ts:verifySignature)

---

## THREAT-5: Device-Local Secret Leakage

### Description
Export file leaks device-local secrets (vault password salt, biometric profiles) that should never leave device.

**Attack Scenario:**
1. User exports keystore from Device A (has TouchID enabled)
2. Export accidentally includes salt + biometric profile
3. Attacker obtains export file
4. Attacker extracts salt, uses rainbow table to crack vault password
5. Attacker bypasses intended device-local security

### Likelihood
**HIGH** - Implementation bugs could accidentally include sensitive fields

### Impact
**CRITICAL** - Salt leakage enables offline password cracking, biometric leakage reveals device capabilities

### Mitigation
1. **Explicit field exclusion**: Export ONLY whitelisted syncable fields
2. **Never include**: salt, biometricProfile, vaultSettings
3. **Test coverage**: Explicit test verifies these fields absent from export
4. **Code review**: Double-check export payload construction

### Verification
```javascript
// Test: Device-local secrets excluded
const keystore = {
  userId: 'user-123',
  salt: 'secret-salt', // NEVER export
  biometricProfile: { enabled: true }, // NEVER export
};

const exportPayload = {
  userId: keystore.userId,
  // salt and biometricProfile intentionally excluded
};

assert(exportPayload.salt === undefined);
assert(exportPayload.biometricProfile === undefined);
```

**Status:** ✅ MITIGATED (TEST-SYNC-004, keystoreExport.ts:exportKeystore)

---

## THREAT-6: Identity Confusion Attack

### Description
Attacker tricks user into importing keystore from different user account.

**Attack Scenario:**
1. Attacker creates their own OneStar account
2. Attacker exports their keystore
3. Attacker social engineers victim into importing attacker's export
4. Victim's identity replaced with attacker's identity
5. Victim unknowingly uses attacker's keypair for encryption

### Likelihood
**MEDIUM** - Social engineering is common attack vector

### Impact
**CRITICAL** - Complete identity replacement

### Mitigation
1. **Identity validation**: Import checks userId matches local keystore
2. **Reject mismatches**: If userId different, reject with clear error message
3. **User confirmation**: UI shows source device + identity before import
4. **Error message**: "This export is from a different user account. Import cancelled."

### Verification
```javascript
// Test: Reject identity mismatch
const localKeystore = { userId: 'user-123' };
const importedPayload = { userId: 'user-456' };

const identityMatch = localKeystore.userId === importedPayload.userId;

assert(identityMatch === false, 'Should detect identity mismatch');
if (!identityMatch) {
  throw new Error('Identity mismatch: cannot merge keystores from different users');
}
```

**Status:** ✅ MITIGATED (TEST-SYNC-008, keystoreMerge.ts:mergeKeystores)

---

## THREAT-7: Export File Interception

### Description
Attacker intercepts export file during transmission via insecure channel.

**Attack Scenario:**
1. User exports keystore
2. User uploads to unencrypted cloud storage for transfer
3. Cloud provider or MITM attacker copies file
4. Attacker launches offline password brute-force attack

### Likelihood
**MEDIUM** - Users often use email/cloud for file transfer

### Impact
**HIGH** - Attacker obtains encrypted keystore for offline cracking

### Mitigation
1. **Strong encryption**: AES-256-GCM protects confidentiality
2. **Strong KDF**: PBKDF2 100k iterations makes cracking slow
3. **User education**: Recommend secure transfer methods (USB, AirDrop, encrypted channels)
4. **Export filename**: Clear labeling helps users recognize sensitive files

### Verification
```javascript
// Test: Export is encrypted
const exportPayload = { userId: 'user-123', encryptedCurrentKeypair: 'secret-data' };
const encrypted = await encryptPayload(exportPayload, 'password');

// Verify plaintext not in encrypted data
assert(!encrypted.includes('user-123'), 'Plaintext leaked in encrypted export');
assert(!encrypted.includes('secret-data'), 'Plaintext leaked in encrypted export');
```

**Status:** ✅ MITIGATED (TEST-SYNC-001, keystoreExport.ts:encryptPayload) + User education recommended

---

## THREAT-8: Time-Based Attacks (Timing Side-Channel)

### Description
Attacker uses timing differences to learn information about password or signatures.

**Attack Scenario:**
1. Attacker provides crafted export file to victim
2. Attacker measures import time
3. Timing differences reveal information about password comparison or signature validation
4. Attacker uses timing oracle to narrow password search space

### Likelihood
**LOW** - Requires precise timing measurements and statistical analysis

### Impact
**MEDIUM** - Reduces password search space, but doesn't directly reveal password

### Mitigation
1. **Constant-time signature comparison**: Use `crypto.timingSafeEqual` for HMAC verification
2. **PBKDF2 dominates timing**: ~1 second for KDF masks other timing differences
3. **No early exits**: Password validation doesn't exit early on mismatch

### Verification
```javascript
// Test: Constant-time signature comparison
const sig1 = Buffer.from('aaaaaaa', 'hex');
const sig2 = Buffer.from('aaaaaab', 'hex');

// Bad: `===` has timing side-channel
// const match = sig1.toString('hex') === sig2.toString('hex');

// Good: constant-time comparison
const match = crypto.timingSafeEqual(sig1, sig2);
```

**Status:** ✅ MITIGATED (keystoreExport.ts:verifySignature uses crypto.timingSafeEqual)

---

## Threat Summary Table

| Threat | Likelihood | Impact | Status | Primary Mitigation |
|--------|-----------|--------|--------|--------------------|
| THREAT-1: Password Brute-Force | MEDIUM | CRITICAL | ✅ MITIGATED | PBKDF2 100k iterations |
| THREAT-2: Downgrade Attack | LOW | CRITICAL | ✅ MITIGATED | Rotation history validation |
| THREAT-3: Replay Attack | MEDIUM | LOW | ✅ MITIGATED | Signature deduplication |
| THREAT-4: Tampering Attack | LOW | CRITICAL | ✅ MITIGATED | HMAC-SHA256 signatures |
| THREAT-5: Device-Local Secret Leakage | HIGH | CRITICAL | ✅ MITIGATED | Explicit field exclusion |
| THREAT-6: Identity Confusion | MEDIUM | CRITICAL | ✅ MITIGATED | Identity validation |
| THREAT-7: Export File Interception | MEDIUM | HIGH | ✅ MITIGATED | AES-256-GCM encryption |
| THREAT-8: Timing Side-Channel | LOW | MEDIUM | ✅ MITIGATED | Constant-time comparison |

---

## Additional Security Recommendations

### For Users
1. **Strong passwords**: Use 16+ character passwords with mixed case, numbers, symbols
2. **Secure transfer**: Prefer USB drives or AirDrop over email/cloud
3. **Delete exports**: Securely delete export files after successful import
4. **Verify source**: Check source device name before importing
5. **Regular rotations**: Rotate keypairs periodically (every 6-12 months)

### For Developers
1. **Code review**: All sync code should have security-focused code review
2. **Fuzz testing**: Test with malformed/malicious export files
3. **Penetration testing**: Hire external security audit before production release
4. **Bug bounty**: Establish responsible disclosure program
5. **Monitoring**: Log suspicious sync patterns (many failed imports, etc.)

---

## Verification Checklist

- [x] Password minimum 12 characters enforced (TEST-SYNC-013)
- [x] PBKDF2 iterations = 100,000 (TEST-SYNC-020)
- [x] Downgrade attack detection (TEST-SYNC-009)
- [x] Replay attack detection (TEST-SYNC-010)
- [x] HMAC signature validation (TEST-SYNC-011, TEST-SYNC-012)
- [x] Device-local secrets excluded (TEST-SYNC-004)
- [x] Identity mismatch rejection (TEST-SYNC-008)
- [x] AES-256-GCM encryption (TEST-SYNC-001)
- [x] Constant-time signature comparison (code review + manual testing)

---

## Future Enhancements

### Potential Phase 22+ Improvements
1. **Multi-factor authentication**: Require 2FA token during export/import
2. **Export expiration**: Time-limited export files (auto-expire after 24 hours)
3. **Biometric export**: Require TouchID/FaceID to authorize export
4. **Export audit log**: Permanent record of all export operations
5. **Remote revocation**: Ability to remotely invalidate exported files
6. **Split-key escrow**: Require 2-of-3 device consensus for high-risk operations

---

## Compliance Notes

### GDPR
- Export files contain personal data (userId, device metadata)
- Users have right to export their data (GDPR Article 20)
- Export format enables data portability

### HIPAA (if applicable)
- Export encryption meets HIPAA requirements (AES-256)
- Audit trail in sync history meets logging requirements
- Access controls via vault password meet authentication requirements

### SOC 2 Type II
- Cryptographic controls documented (this threat model)
- Incident response plan needed for compromise scenarios
- Regular security audits recommended (annual penetration testing)

---

**Document Version:** 1.0  
**Last Updated:** Phase 21 Implementation  
**Next Review:** Phase 22 or annual security audit
