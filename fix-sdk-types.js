#!/usr/bin/env node

/**
 * Quick-fix script for SDK type errors
 * 
 * Fixes the most critical TypeScript compilation errors
 * in packages/onestar-db-sdk/src/
 */

const fs = require('fs');
const path = require('path');

const SDK_DIR = path.join(__dirname, 'packages/onestar-db-sdk/src');

console.log('🔧 Applying quick fixes to SDK package...\n');

// ============================================================================
// FIX 1: Update index.ts to remove non-existent exports
// ============================================================================

const indexPath = path.join(SDK_DIR, 'index.ts');
let indexContent = fs.readFileSync(indexPath, 'utf8');

console.log('✅ Fix 1: Removing non-existent type exports from index.ts');

// Remove HybridSignature (doesn't exist)
indexContent = indexContent.replace(
  /export type \{[^}]+HybridSignature[^}]+\} from '\.\/postQuantumCrypto';/,
  `export type {
  HybridKeypair,
  HybridPublicKey,
  HybridCiphertext,
} from './postQuantumCrypto';`
);

// Remove EncryptedKeypair (doesn't exist as type)
indexContent = indexContent.replace(
  /export type \{ DecryptedKeypair, EncryptedKeypair \} from '\.\/hybridKeypairStore';/,
  `export type { DecryptedKeypair } from './hybridKeypairStore';`
);

// Remove problematic type re-exports from keystoreV4
indexContent = indexContent.replace(
  /export type \{[^}]*DeviceRecord[^}]*\} from '\.\/keystoreV4';/,
  ''
);

// Remove problematic type re-exports from keystoreSyncStatus
indexContent = indexContent.replace(
  /export type \{[^}]*SyncAlignment[^}]*\} from '\.\/keystoreSyncStatus';/,
  ''
);

fs.writeFileSync(indexPath, indexContent);
console.log('   ✓ Updated index.ts\n');

// ============================================================================
// FIX 2: Fix naming conflicts with explicit exports
// ============================================================================

console.log('✅ Fix 2: Resolving naming conflicts');

// Replace export * with explicit exports for keypairRotation
indexContent = indexContent.replace(
  /export \* from '\.\/keypairRotation';/,
  `export {
  performRotation,
  loadRotationStatus,
  loadRotationHistory,
  checkRotationNeeded,
} from './keypairRotation';`
);

// Replace export * with explicit exports for keystoreExport to avoid KeystoreExportV1 conflict
indexContent = indexContent.replace(
  /export \* from '\.\/keystoreExport';/,
  `export {
  exportKeystore,
  importKeystore,
  extractPublicKeyFromEncrypted,
} from './keystoreExport';`
);

fs.writeFileSync(indexPath, indexContent);
console.log('   ✓ Fixed naming conflicts in index.ts\n');

// ============================================================================
// FIX 3: Add CryptoKey type reference to postQuantumCrypto.ts
// ============================================================================

console.log('✅ Fix 3: Adding Node crypto types to postQuantumCrypto.ts');

const pqCryptoPath = path.join(SDK_DIR, 'postQuantumCrypto.ts');
let pqCryptoContent = fs.readFileSync(pqCryptoPath, 'utf8');

// Add reference at top of file if not already present
if (!pqCryptoContent.includes('/// <reference types="node"')) {
  pqCryptoContent = `/// <reference types="node" />\n${pqCryptoContent}`;
}

// Replace CryptoKey with crypto.webcrypto.CryptoKey
if (pqCryptoContent.includes('CryptoKey') && !pqCryptoContent.includes('webcrypto')) {
  // Add import at top
  if (!pqCryptoContent.includes("import { webcrypto } from 'crypto'")) {
    const firstImportIndex = pqCryptoContent.indexOf("import");
    if (firstImportIndex !== -1) {
      pqCryptoContent = 
        pqCryptoContent.slice(0, firstImportIndex) +
        "import { webcrypto } from 'crypto';\n" +
        pqCryptoContent.slice(firstImportIndex);
    }
  }
  
  // Replace CryptoKey references
  pqCryptoContent = pqCryptoContent.replace(/: CryptoKey/g, ': webcrypto.CryptoKey');
}

fs.writeFileSync(pqCryptoPath, pqCryptoContent);
console.log('   ✓ Updated postQuantumCrypto.ts\n');

// ============================================================================
// FIX 4: Add type guards for 'unknown' data
// ============================================================================

console.log('✅ Fix 4: Adding type guards for unknown data types');

// Fix encryptedStreamDecoder.ts
const decoderPath = path.join(SDK_DIR, 'encryptedStreamDecoder.ts');
let decoderContent = fs.readFileSync(decoderPath, 'utf8');

// Add type guard helper at top of file
if (!decoderContent.includes('function isMessageWithData')) {
  const firstFunctionIndex = decoderContent.indexOf('export ');
  if (firstFunctionIndex !== -1) {
    const typeGuard = `
/**
 * Type guard for message data objects
 */
function isMessageWithData(data: unknown): data is { ok?: boolean; chunk?: Uint8Array; byteLength?: number } {
  return typeof data === 'object' && data !== null;
}

`;
    decoderContent = 
      decoderContent.slice(0, firstFunctionIndex) +
      typeGuard +
      decoderContent.slice(firstFunctionIndex);
  }
}

// Replace problematic data checks
decoderContent = decoderContent.replace(
  /if \(data\) \{[\s\S]*?data\.ok/g,
  (match) => match.replace('if (data)', 'if (isMessageWithData(data))')
);

fs.writeFileSync(decoderPath, decoderContent);
console.log('   ✓ Updated encryptedStreamDecoder.ts');

// Fix localMediaIndex.ts
const mediaIndexPath = path.join(SDK_DIR, 'localMediaIndex.ts');
let mediaIndexContent = fs.readFileSync(mediaIndexPath, 'utf8');

// Add same type guard
if (!mediaIndexContent.includes('function isMessageWithData')) {
  const firstFunctionIndex = mediaIndexContent.indexOf('export ');
  if (firstFunctionIndex !== -1) {
    const typeGuard = `
/**
 * Type guard for message data objects
 */
function isMessageWithData(data: unknown): data is { ok?: boolean; chunk?: Uint8Array } {
  return typeof data === 'object' && data !== null;
}

`;
    mediaIndexContent = 
      mediaIndexContent.slice(0, firstFunctionIndex) +
      typeGuard +
      mediaIndexContent.slice(firstFunctionIndex);
  }
}

// Replace problematic data checks
mediaIndexContent = mediaIndexContent.replace(
  /if \(data\) \{[\s\S]*?data\.ok/g,
  (match) => match.replace('if (data)', 'if (isMessageWithData(data))')
);

fs.writeFileSync(mediaIndexPath, mediaIndexContent);
console.log('   ✓ Updated localMediaIndex.ts\n');

// ============================================================================
// SUMMARY
// ============================================================================

console.log('✨ Quick fixes applied!\n');
console.log('Next steps:');
console.log('  1. cd packages/onestar-db-sdk');
console.log('  2. npm run build');
console.log('  3. Review remaining errors and fix manually\n');
console.log('Note: Some errors (missing properties on interfaces) require');
console.log('      manual review of the type definitions.\n');
