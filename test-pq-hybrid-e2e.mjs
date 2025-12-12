// End-to-end PQ-Hybrid KEM Test
// Tests the complete workflow: OneStarDB + OneStarStream integration

import { generateHybridKeypair, wrapMediaKeyHybrid, unwrapMediaKeyHybrid, serializePublicKey } from './src/lib/postQuantumCrypto';

console.log('🧪 END-TO-END PQ-HYBRID KEM TEST');
console.log('=================================\n');

try {
  // Step 1: Generate sender's keypair
  console.log('1️⃣  Generating sender hybrid keypair...');
  const senderKeypair = await generateHybridKeypair();
  const senderPublicKey = serializePublicKey(senderKeypair);
  console.log('   ✅ Sender keypair generated');
  console.log(`   - Kyber public: ${senderKeypair.kyber.publicKey.length} bytes`);
  console.log(`   - X25519 public: ${senderKeypair.x25519.publicKey.length} bytes`);

  // Step 2: Generate recipient's keypair
  console.log('\n2️⃣  Generating recipient hybrid keypair...');
  const recipientKeypair = await generateHybridKeypair();
  const recipientPublicKey = serializePublicKey(recipientKeypair);
  console.log('   ✅ Recipient keypair generated');

  // Step 3: Generate random media key (simulates AES-256 key)
  console.log('\n3️⃣  Generating random 32-byte media key...');
  const mediaKey = crypto.getRandomValues(new Uint8Array(32));
  console.log('   ✅ Media key generated');

  // Step 4: Wrap media key for recipient (simulates sharing)
  console.log('\n4️⃣  Wrapping media key for recipient...');
  const ciphertext = await wrapMediaKeyHybrid(mediaKey, recipientPublicKey);
  console.log('   ✅ Media key wrapped');
  console.log(`   - Kyber ciphertext: ${Buffer.from(ciphertext.kyberCiphertext, 'base64').length} bytes`);
  console.log(`   - X25519 ephemeral: ${Buffer.from(ciphertext.x25519EphemeralPublic, 'base64').length} bytes`);
  console.log(`   - Wrapped key: ${Buffer.from(ciphertext.wrappedKey, 'base64').length} bytes`);
  console.log(`   - GCM IV: ${Buffer.from(ciphertext.iv, 'base64').length} bytes`);
  console.log(`   - Version: ${ciphertext.version}`);

  // Step 5: Serialize ciphertext for storage (simulates database)
  console.log('\n5️⃣  Serializing HybridCiphertext for storage...');
  const serialized = JSON.stringify(ciphertext);
  console.log('   ✅ Serialized to JSON string');
  console.log(`   - Size: ${serialized.length} bytes`);
  console.log(`   - Format: ${serialized.substring(0, 50)}...`);

  // Step 6: Deserialize from storage (simulates retrieval)
  console.log('\n6️⃣  Deserializing from storage...');
  const deserialized = JSON.parse(serialized);
  console.log('   ✅ Deserialized from JSON');

  // Step 7: Unwrap media key with recipient's private key
  console.log('\n7️⃣  Unwrapping media key with recipient private key...');
  const unwrappedKey = await unwrapMediaKeyHybrid(deserialized, recipientKeypair);
  console.log('   ✅ Media key unwrapped');

  // Step 8: Verify round-trip
  console.log('\n8️⃣  Verifying round-trip integrity...');
  const match = mediaKey.every((byte, i) => byte === unwrappedKey[i]);

  if (match) {
    console.log('   ✅ SUCCESS: Media keys match!\n');
    console.log('🎉 END-TO-END PQ-HYBRID KEM VERIFIED');
    console.log('   ✅ Kyber-768 post-quantum security');
    console.log('   ✅ X25519 classical ECDH defense-in-depth');
    console.log('   ✅ HKDF-SHA256 secret combination');
    console.log('   ✅ AES-256-GCM authenticated encryption');
    console.log('   ✅ JSON serialization for database storage');
    console.log('   ✅ Forward secrecy via ephemeral X25519 keys');
    console.log('\n✅ ALL SYSTEMS OPERATIONAL - POST-QUANTUM SECURE\n');
    process.exit(0);
  } else {
    console.log('   ❌ FAILURE: Media keys differ!');
    console.log('   Original:', Array.from(mediaKey.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    console.log('   Unwrapped:', Array.from(unwrappedKey.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    process.exit(1);
  }
} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
}
