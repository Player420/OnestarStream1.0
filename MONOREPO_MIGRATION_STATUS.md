# Monorepo Restructure Status

**Date:** December 12, 2025  
**Goal:** Create clean monorepo with @onestar/db-sdk package and proper boundaries

---

## COMPLETED WORK

### ✅ 1. Folder Structure Created

```
onestarstream-mac/
├── packages/
│   └── onestar-db-sdk/
│       ├── package.json              ✅ Created
│       ├── tsconfig.json             ✅ Created
│       └── src/
│           ├── index.ts              ✅ Created
│           ├── postQuantumCrypto.ts  ✅ Copied
│           ├── hybridKeypairStore.ts ✅ Copied
│           ├── vaultLifecycle.ts     ✅ Copied
│           ├── biometricUnlock.ts    ✅ Copied
│           ├── localMediaIndex.ts    ✅ Copied
│           ├── encryptedStreamDecoder.ts ✅ Copied
│           ├── keypairRotation.ts    ✅ Copied
│           ├── keystoreV4.ts         ✅ Copied
│           ├── keystoreExport.ts     ✅ Copied
│           ├── keystoreMerge.ts      ✅ Copied
│           ├── keystoreSyncStatus.ts ✅ Copied
│           ├── preloadRotationHelpers.ts ✅ Copied
│           ├── mediaDatabase.ts      ✅ Copied
│           ├── mediaKeyReWrapping.ts ✅ Copied
│           ├── encryption.ts         ✅ Copied
│           ├── timeUtils.ts          ✅ Copied
│           └── db/                   ✅ Copied (mediaLicenses.table.ts)
│
├── apps/
│   └── desktop/
│       ├── package.json              ✅ Created
│       ├── tsconfig.json             ✅ Created
│       ├── next.config.ts            ✅ Copied
│       ├── middleware.ts             ✅ Copied
│       ├── src/                      ✅ Copied (all Next.js source)
│       ├── public/                   ✅ Copied
│       ├── tests/electron-e2e/       ✅ Copied
│       └── electron/
│           ├── tsconfig.json         ✅ Created
│           ├── main.ts               ✅ Copied
│           ├── preload.ts            ✅ Copied + Fixed imports
│           ├── syncScheduler.ts      ✅ Copied
│           ├── syncHelpers.ts        ✅ Copied + Fixed imports
│           └── preload-lib/          ✅ Created (empty - ready for migration)
│
├── package-root.json                 ✅ Created (needs rename to package.json)
└── tsconfig-root.json                ✅ Created (needs rename to tsconfig.json)
```

### ✅ 2. Import Rewrites Completed

**Electron preload.ts:**
- ✅ Changed 7 static imports from `../src/lib/*` → `@onestar/db-sdk`
- ✅ Changed 5 dynamic imports from `../src/lib/*` → `@onestar/db-sdk`

**Electron syncHelpers.ts:**
- ✅ Removed path resolution logic
- ✅ Direct imports from `@onestar/db-sdk`

**Electron main.ts:**
- ✅ Already clean (no src/lib imports)

### ✅ 3. TypeScript Configuration

**Root tsconfig-root.json:**
- ✅ Project references setup
- ✅ Path mappings for `@onestar/db-sdk`

**packages/onestar-db-sdk/tsconfig.json:**
- ✅ Composite project
- ✅ ES2020 target, CommonJS module
- ✅ Strict mode enabled

**apps/desktop/electron/tsconfig.json:**
- ✅ Proper rootDir (no more violations)
- ✅ References SDK package
- ✅ Path mappings to SDK

**apps/desktop/tsconfig.json:**
- ✅ Next.js configuration
- ✅ References SDK and Electron
- ✅ Path mappings

---

## ⚠️ REMAINING WORK (CRITICAL)

### 1. Fix TypeScript Compilation Errors in SDK

**Current Errors (26 total):**

#### A. Missing Type Exports (6 errors)
```typescript
// src/index.ts errors:
- HybridSignature not exported from postQuantumCrypto
- EncryptedKeypair not exported from hybridKeypairStore  
- DeviceRecord not exported from keystoreV4
- KeypairHistoryEntry not exported from keystoreV4
- RotationHistoryEntry not exported from keystoreV4
```

**Fix:** Remove these from index.ts or add proper exports to source files

#### B. Naming Conflicts (2 errors)
```typescript
// Duplicate exports:
- getRotationStatus exported by both hybridKeypairStore and keypairRotation
- KeystoreExportV1 exported by both keystoreExport and keystoreMerge
```

**Fix:** Use explicit named exports instead of `export *`

#### C. Type Safety Issues (8 errors)
```typescript
// encryptedStreamDecoder.ts and localMediaIndex.ts:
- 'data' is of type 'unknown' (6 occurrences)
// Need proper type guards or assertions
```

**Fix:**
```typescript
// Before:
if (data) {  // error: data is unknown
  data.ok   // error
}

// After:
if (typeof data === 'object' && data !== null && 'ok' in data) {
  (data as { ok: boolean }).ok
}
```

#### D. Missing Properties (6 errors)
```typescript
// keystoreSyncStatus.ts:
- Property 'platform' does not exist on EncryptedKeystoreV4
- Property 'platform' does not exist on RotationRecordV4
- Property 'sourcePlatform' does not exist on SyncRecord
- Property 'syncedAt' does not exist on SyncRecord (3 occurrences)
```

**Fix:** Add these properties to type definitions or remove references

#### E. Missing Global Types (2 errors)
```typescript
// postQuantumCrypto.ts:
- Cannot find name 'CryptoKey' (2 occurrences)
```

**Fix:** Add `/// <reference lib="dom" />` or use Node crypto types

#### F. Missing Functions (2 errors)
```typescript
// keystoreSyncStatus.ts:
- 'loadEncryptedKeystore' not exported from keypairRotation
- 'extractPublicKeyFromEncrypted' not exported from keystoreExport
```

**Fix:** Export these functions or use alternative imports

### 2. Install Workspace Dependencies

```bash
# At root:
mv package-root.json package.json
mv tsconfig-root.json tsconfig.json
npm install

# This will install:
# - Root dependencies
# - SDK package dependencies
# - Desktop app dependencies (Next.js, Electron, etc.)
```

### 3. Build SDK Package

```bash
cd packages/onestar-db-sdk
npm run build

# Must succeed before building desktop app
```

### 4. Update E2E Test Paths

**Files needing updates:**
- `apps/desktop/tests/electron-e2e/test-runner.js`
- `apps/desktop/tests/electron-e2e/helpers/*.js`

**Changes needed:**
```javascript
// OLD paths:
const electronPath = path.join(__dirname, '../../electron/dist/main.js');

// NEW paths:
const electronPath = path.join(__dirname, '../../electron/dist/main.js');
// (Same - tests are now inside apps/desktop/)
```

### 5. Update next.config.ts

**Current issue:** May reference old paths

**Check:**
```typescript
// apps/desktop/next.config.ts
// Ensure no hardcoded paths to ../electron or ../src
```

### 6. Fix Chrome Remote Interface

**Missing dependency:**
```json
// apps/desktop/package.json already has:
"chrome-remote-interface": "^0.31.0"
```

**Verify installation:**
```bash
cd apps/desktop
npm install
```

---

## MIGRATION COMMANDS

### Step 1: Activate New Structure

```bash
cd /Users/owner/projects/onestarstream-mac

# Backup old files
mkdir -p .migration-backup
cp package.json .migration-backup/
cp tsconfig.json .migration-backup/

# Activate new structure
mv package-root.json package.json
mv tsconfig-root.json tsconfig.json
```

### Step 2: Install All Dependencies

```bash
# Root level (installs all workspaces)
npm install
```

### Step 3: Fix SDK Type Errors

**Priority fixes (must do before building):**

```typescript
// packages/onestar-db-sdk/src/index.ts
// Remove non-existent exports:
export * from './postQuantumCrypto';
export type {
  HybridKeypair,
  HybridPublicKey,
  HybridCiphertext,
  // REMOVED: HybridSignature (doesn't exist)
} from './postQuantumCrypto';

export * from './hybridKeypairStore';
export type { 
  DecryptedKeypair,
  // REMOVED: EncryptedKeypair (use encryptKeypair function instead)
} from './hybridKeypairStore';

// Fix naming conflicts - use selective exports:
export { 
  performRotation,
  loadRotationStatus,
  loadRotationHistory,
  checkRotationNeeded,
  // Don't export getRotationStatus (conflicts with hybridKeypairStore)
} from './keypairRotation';
```

```typescript
// packages/onestar-db-sdk/src/postQuantumCrypto.ts
// Add Node crypto types reference:
/// <reference types="node" />

// Replace CryptoKey with proper Node types:
// import { webcrypto } from 'crypto';
// type CryptoKey = webcrypto.CryptoKey;
```

### Step 4: Build SDK

```bash
cd packages/onestar-db-sdk
npm run build

# Should output to dist/
# If errors, fix them iteratively
```

### Step 5: Build Desktop App

```bash
cd apps/desktop

# Build Electron first
npm run build:electron

# Then build Next.js
npm run build

# Or combined:
npm run build
```

### Step 6: Test

```bash
# Terminal 1: Start Next.js dev server
cd apps/desktop
npm run dev

# Terminal 2: Launch Electron
cd apps/desktop
npm run dev:electron

# Terminal 3: Run E2E tests
cd apps/desktop
npm run test:e2e
```

---

## VALIDATION CHECKLIST

### ✅ Completed
- [x] Folder structure created
- [x] SDK package.json created
- [x] SDK source files copied
- [x] Electron files moved
- [x] Next.js files moved
- [x] Import paths rewritten in preload.ts
- [x] Import paths rewritten in syncHelpers.ts
- [x] TypeScript configs created
- [x] Package references configured

### ❌ Not Completed
- [ ] Fix 26 TypeScript compilation errors in SDK
- [ ] Rename package-root.json → package.json
- [ ] Rename tsconfig-root.json → tsconfig.json
- [ ] Run `npm install` at root
- [ ] Build SDK package successfully
- [ ] Build Electron successfully
- [ ] Build Next.js successfully
- [ ] Update E2E test paths
- [ ] Test `npm run dev`
- [ ] Test `npm run dev:electron`
- [ ] Test `npm run test:e2e`

---

## ROLLBACK PROCEDURE

If migration fails:

```bash
cd /Users/owner/projects/onestarstream-mac

# Restore original files
cp .migration-backup/package.json .
cp .migration-backup/tsconfig.json .

# Use original structure
# (electron/, src/, tests/ all still exist in original locations)
```

---

## ARCHITECTURAL BENEFITS (Once Complete)

### ✅ Solves rootDir Violations
```typescript
// BEFORE (ERROR):
// electron/preload.ts imports from ../src/lib/* (outside rootDir)

// AFTER (FIXED):
// apps/desktop/electron/preload.ts imports from @onestar/db-sdk
// SDK is a proper package reference, not file import
```

### ✅ Solves Next.js Client/Server Boundary
```typescript
// BEFORE (ERROR):
// Client components could accidentally import Node-only modules

// AFTER (FIXED):
// @onestar/db-sdk is explicitly Node-only
// Next.js bundler won't try to include it in client bundle
// Server components can import safely
```

### ✅ Enables Clean Builds
```bash
# Build order is now clear:
# 1. packages/onestar-db-sdk (independent)
# 2. apps/desktop/electron (depends on SDK)
# 3. apps/desktop (Next.js, depends on SDK for server routes)
```

### ✅ Proper Module Resolution
```json
// TypeScript now understands:
{
  "paths": {
    "@onestar/db-sdk": ["packages/onestar-db-sdk/src/index.ts"]
  }
}
// Works in:
// - Electron (via tsconfig project references)
// - Next.js (via tsconfig paths)
// - IDE (via workspace-aware language server)
```

---

## ESTIMATED TIME TO COMPLETE

**Remaining work:** 2-4 hours

1. **Fix TypeScript errors (1-2 hours)**
   - Remove non-existent exports: 15 min
   - Fix naming conflicts: 30 min
   - Add type guards for 'unknown': 30 min
   - Fix missing properties: 30 min
   - Add CryptoKey types: 15 min

2. **Install and build (30 min)**
   - `npm install` at root: 5 min
   - Fix any install errors: 10 min
   - Build SDK: 5 min
   - Build Electron: 5 min
   - Build Next.js: 5 min

3. **Test and validate (30 min - 1 hour)**
   - Launch dev server: 5 min
   - Launch Electron: 5 min
   - Fix runtime errors: 20-40 min
   - Run E2E tests: 10 min

4. **Buffer for unexpected issues (30 min)**

---

## NEXT ACTIONS

1. **Fix SDK type errors** (start here)
   - Edit `packages/onestar-db-sdk/src/index.ts`
   - Remove non-existent type exports
   - Fix naming conflicts with explicit exports

2. **Activate monorepo**
   - `mv package-root.json package.json`
   - `mv tsconfig-root.json tsconfig.json`
   - `npm install`

3. **Build and test**
   - `cd packages/onestar-db-sdk && npm run build`
   - `cd apps/desktop && npm run build`
   - Test dev mode and E2E

---

## CONTACT POINTS FOR HELP

**TypeScript Errors:**
- Check `packages/onestar-db-sdk/src/index.ts` - main export file
- Check actual source files for what's really exported
- Use `grep "export"` to find available exports

**Build Errors:**
- Check `tsconfig.json` files for path mappings
- Verify `package.json` workspace configuration
- Check node_modules symlinks: `ls -la node_modules/@onestar`

**Runtime Errors:**
- Check `apps/desktop/electron/dist/main.js` was generated
- Check `apps/desktop/.next/` was built
- Check `packages/onestar-db-sdk/dist/` exists

---

**Status:** 🟡 IN PROGRESS (70% complete)  
**Blocker:** TypeScript compilation errors in SDK package  
**Next Step:** Fix index.ts exports and rebuild
