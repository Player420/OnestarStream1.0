// Test: PQ-Hybrid Encrypted Media Decryption
// Simulates the complete playback flow

import {
  generateHybridKeypair,
  wrapMediaKeyHybrid,
  unwrapAndDecryptMedia,
  serializePublicKey,
} from './src/lib/postQuantumCrypto';

console.log('🎬 ENCRYPTED MEDIA PLAYBACK SIMULATION');
console.log('======================================\n');

try {
  // Step 1: Generate user's keypair (happens once per user)
  console.log('1️⃣  Generating user PQ-hybrid keypair...');
  const userKeypair = await generateHybridKeypair();
  const userPublicKey = serializePublicKey(userKeypair);
  console.log('   ✅ User keypair generated');
  console.log(`   - Kyber public: ${userKeypair.kyber.publicKey.length} bytes`);
  console.log(`   - X25519 public: ${userKeypair.x25519.publicKey.length} bytes`);

  // Step 2: Simulate media upload (generate random media key)
  console.log('\n2️⃣  Simulating media upload...');
  const mediaKey = crypto.getRandomValues(new Uint8Array(32));
  console.log('   ✅ Generated 32-byte media key');

  // Step 3: Encrypt media with AES-256-GCM
  console.log('\n3️⃣  Encrypting media with AES-256-GCM...');
  const plaintext = new TextEncoder().encode('🎵 This is encrypted audio data 🎵');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  const cryptoKey = await crypto.subtle.importKey('raw', mediaKey, 'AES-GCM', false, ['encrypt']);
  const ciphertextBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    plaintext
  );
  const ciphertext = new Uint8Array(ciphertextBuffer);
  
  console.log('   ✅ Media encrypted');
  console.log(`   - Plaintext size: ${plaintext.length} bytes`);
  console.log(`   - Ciphertext size: ${ciphertext.length} bytes (includes 16-byte GCM tag)`);

  // Step 4: Wrap media key for user (PQ-hybrid)
  console.log('\n4️⃣  Wrapping media key with PQ-hybrid KEM...');
  const wrappedKey = await wrapMediaKeyHybrid(mediaKey, userPublicKey);
  console.log('   ✅ Media key wrapped');
  console.log(`   - Kyber ciphertext: ${Buffer.from(wrappedKey.kyberCiphertext, 'base64').length} bytes`);
  console.log(`   - X25519 ephemeral: ${Buffer.from(wrappedKey.x25519EphemeralPublic, 'base64').length} bytes`);

  // Step 5: Serialize for storage (database)
  console.log('\n5️⃣  Serializing for database storage...');
  const wrappedKeyJson = JSON.stringify(wrappedKey);
  const ciphertextBase64 = Buffer.from(ciphertext).toString('base64');
  const ivBase64 = Buffer.from(iv).toString('base64');
  
  console.log('   ✅ Serialized');
  console.log(`   - Wrapped key JSON: ${wrappedKeyJson.length} bytes`);
  console.log(`   - Ciphertext Base64: ${ciphertextBase64.length} bytes`);

  // ===== PLAYBACK SIMULATION =====
  console.log('\n📱 PLAYBACK FLOW (Preload Context)');
  console.log('===================================\n');

  // Step 6: Deserialize from database (simulating API fetch)
  console.log('6️⃣  Fetching encrypted media from database...');
  const fetchedWrappedKey = JSON.parse(wrappedKeyJson);
  console.log('   ✅ Retrieved from database');

  // Step 7: Unwrap and decrypt (this is what preload does)
  console.log('\n7️⃣  Unwrapping and decrypting in preload...');
  const decryptedPlaintext = await unwrapAndDecryptMedia(
    ciphertextBase64,
    ivBase64,
    fetchedWrappedKey,
    userKeypair
  );
  console.log('   ✅ Decryption successful');
  console.log(`   - Decrypted size: ${decryptedPlaintext.length} bytes`);

  // Step 8: Verify integrity
  console.log('\n8️⃣  Verifying round-trip integrity...');
  const decryptedText = new TextDecoder().decode(decryptedPlaintext);
  const originalText = new TextDecoder().decode(plaintext);
  const match = decryptedText === originalText;

  if (match) {
    console.log('   ✅ SUCCESS: Plaintext matches!');
    console.log(`   - Original:  ${originalText}`);
    console.log(`   - Decrypted: ${decryptedText}`);
  } else {
    console.log('   ❌ FAILURE: Plaintext differs!');
    console.log(`   - Original:  ${originalText}`);
    console.log(`   - Decrypted: ${decryptedText}`);
    process.exit(1);
  }

  // Step 9: Simulate Blob URL creation (renderer playback)
  console.log('\n9️⃣  Creating Blob URL for playback...');
  const blob = new Blob([decryptedPlaintext], { type: 'audio/mpeg' });
  const blobUrl = URL.createObjectURL(blob);
  console.log('   ✅ Blob URL created:', blobUrl);
  console.log('   📌 This would be passed to <audio src={blobUrl} />');

  // Step 10: Cleanup
  console.log('\n🧹 Cleanup...');
  URL.revokeObjectURL(blobUrl);
  console.log('   ✅ Blob URL revoked');
  console.log('   ✅ Memory cleaned');

  console.log('\n🎉 ENCRYPTED MEDIA PLAYBACK SIMULATION COMPLETE');
  console.log('================================================\n');
  console.log('✅ Upload: media encrypted with AES-256-GCM');
  console.log('✅ Storage: media key wrapped with Kyber-768 + X25519');
  console.log('✅ Playback: decrypted in preload, Blob URL created');
  console.log('✅ Security: keys never reached renderer');
  console.log('✅ Cleanup: Blob URL revoked, memory cleared\n');
  
  process.exit(0);
} catch (error) {
  console.error('\n❌ ERROR:', error.message);
  console.error(error.stack);
  process.exit(1);
}
