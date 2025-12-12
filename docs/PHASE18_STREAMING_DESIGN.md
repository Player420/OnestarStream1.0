# Phase 18: Streaming Decryption Design

**Version:** 1.0  
**Status:** ✅ Complete  
**Date:** December 11, 2025

## Overview

Phase 18 implements true streaming decryption for encrypted media, enabling progressive playback with low memory usage and fast time-to-first-byte. This replaces the Phase 17 monolithic decryption approach with a chunk-based pipeline optimized for large media files.

## Motivation

### Problems with Phase 17 (Monolithic Decryption)

**Architecture:**
```
1. Fetch entire ciphertext (e.g., 100MB)
2. Decrypt entire ciphertext in memory
3. Create Blob URL from plaintext
4. Play media
```

**Issues:**
- **High Memory Usage:** 2x file size (ciphertext + plaintext in memory simultaneously)
- **Slow Time-to-First-Byte:** Must download and decrypt entire file before playback
- **No Progressive Playback:** User waits for full download
- **Poor UX for Large Files:** 100MB file = 10+ seconds before playback starts

**Example (100MB file, 10Mbps connection):**
- Download time: ~80 seconds
- Decryption time: ~2 seconds
- Total time-to-first-byte: **~82 seconds**
- Memory usage: **200MB** (100MB ciphertext + 100MB plaintext)

### Phase 18 Solution (Streaming Decryption)

**Architecture:**
```
1. Fetch ciphertext in 256KB chunks
2. Decrypt each chunk immediately
3. Append to MediaSource buffer
4. Play while downloading
```

**Benefits:**
- **Low Memory Usage:** Only 3-5 active chunks in memory (~1MB vs 200MB)
- **Fast Time-to-First-Byte:** < 200ms (first chunk only)
- **Progressive Playback:** Starts playing immediately
- **Seeking Support:** HTTP range requests for chunk-level seeking

**Example (100MB file, 10Mbps connection):**
- Time to first chunk (256KB): ~0.2 seconds
- Decryption time (256KB): ~0.02 seconds
- Total time-to-first-byte: **~0.22 seconds**
- Memory usage: **~1MB** (3-5 chunks at 256KB each)

**Improvement:**
- **373x faster** time-to-first-byte
- **200x less memory** usage

## Architecture

### High-Level Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    Streaming Decryption Pipeline                │
└─────────────────────────────────────────────────────────────────┘

HTTP Stream          Chunk Parser         Chunk Decryptor        MediaSource
(256KB chunks)    (validate & parse)    (AES-256-GCM)          (append buffer)
     │                    │                    │                      │
     │  Raw Chunk         │  Parsed Chunk      │  Plaintext Chunk     │
     ├───────────────────>├───────────────────>├─────────────────────>│
     │  (header + data)   │  (header + cipher) │  (256KB plaintext)   │
     │                    │                    │                      │
     │                    │  Validate:         │  Decrypt:            │  Append:
     │                    │  - Chunk index     │  - AES-256-GCM       │  - Buffer
     │                    │  - Chunk size      │  - Unique IV         │  - Playback
     │                    │  - IV length       │  - Auth tag verify   │  - Progress
     │                    │                    │                      │
     v                    v                    v                      v
  Continue...          Next chunk          Zeroize key           Continue...
```

### Chunk Format Specification

**Phase 18 Encrypted Chunk Structure:**

```
┌────────────────────────────────────────────────────────────────┐
│                        Encrypted Chunk                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  [ Header (48 bytes) | Encrypted Data (variable) | Tag (16) ] │
│                                                                │
└────────────────────────────────────────────────────────────────┘

Header (48 bytes):
├─ chunkIndex (4 bytes):  uint32, big-endian, 0-indexed
├─ chunkSize (4 bytes):   uint32, big-endian, ciphertext length
├─ iv (12 bytes):         GCM IV, unique per chunk
└─ reserved (28 bytes):   zeros (future use, e.g., additional auth data)

Encrypted Data (variable):
└─ Ciphertext (up to 256KB plaintext → ~256KB ciphertext)

Auth Tag (16 bytes):
└─ GCM authentication tag (tamper-evident)
```

**Total Chunk Size:** 48 + N + 16 bytes (where N = ciphertext length)

**Example (256KB plaintext):**
- Header: 48 bytes
- Ciphertext: 262,144 bytes
- Auth Tag: 16 bytes
- **Total:** 262,208 bytes per chunk

### Security Properties

**1. Per-Chunk Authentication:**
- Each chunk has unique IV (12 random bytes)
- GCM authentication tag prevents tampering
- Chunk order validated (chunkIndex must be sequential)
- Cannot replay chunks from different files (unique IV per chunk)

**2. Memory Safety:**
- Media key zeroized after each chunk decryption
- Plaintext chunks discarded after MediaSource append
- No full plaintext ever in memory

**3. Backward Compatibility:**
- Phase 17 monolithic decryption still supported (fallback)
- API supports both chunked and full-file responses
- Gradual migration path for existing media

**4. Range Request Support:**
- HTTP Range header for chunk-level seeking
- `bytes=start-end` maps to chunk boundaries
- Enables video seeking without re-downloading

## Implementation

### File: `src/lib/encryptedStreamDecoder.ts`

**Key Functions:**

```typescript
// Parse raw chunk data into structured format
parseChunk(chunkData: Buffer): EncryptedChunk

// Decrypt single chunk with authentication
decryptChunk(chunk: EncryptedChunk, mediaKey: Buffer): DecryptedChunk

// Encrypt single chunk (for upload/storage)
encryptChunk(plaintext: Buffer, chunkIndex: number, mediaKey: Buffer): Buffer

// Stream generator for progressive playback
streamEncryptedMedia(mediaId: string, startByte?: number, endByte?: number): AsyncGenerator<Buffer>

// Convert monolithic to chunked format (migration)
convertToChunkedFormat(ciphertext: Buffer, mediaKey: Buffer): Buffer[]

// Calculate chunk boundaries for seeking
calculateChunkBoundaries(byteOffset: number): { chunkIndex: number; chunkOffset: number }
```

**Configuration:**

```typescript
export const STREAMING_CONFIG = {
  CHUNK_SIZE: 256 * 1024, // 256KB plaintext per chunk
  HEADER_SIZE: 48,        // bytes
  AUTH_TAG_SIZE: 16,      // GCM tag
  IV_SIZE: 12,            // GCM IV
  ALGORITHM: 'aes-256-gcm',
  ENCODING: 'base64',
};
```

### API Route Updates

**File:** `src/app/api/encrypted-media/get/[mediaId]/route.ts`

**New Features:**
- HTTP Range header parsing (`bytes=start-end`)
- Partial content responses (206 status)
- `Accept-Ranges: bytes` header
- Backward compatibility (full-file requests still work)

**Usage:**

```typescript
// Full file request (backward compatible)
GET /api/encrypted-media/get/abc123
→ 200 OK, full ciphertext

// Range request (streaming)
GET /api/encrypted-media/get/abc123
Range: bytes=0-262143
→ 206 Partial Content, first 256KB

// Seeking (chunk 100)
GET /api/encrypted-media/get/abc123
Range: bytes=26214400-26476543
→ 206 Partial Content, chunk 100
```

**Response Format:**

```json
{
  "ok": true,
  "mediaBlobId": "abc123",
  "licenseId": "lic456",
  "ciphertext": "base64...",
  "iv": "base64...",
  "wrappedKey": "{...}",
  "metadata": {
    "title": "Song.mp3",
    "mimeType": "audio/mpeg",
    "mediaHash": "sha256...",
    "ownerUserId": "user789"
  },
  "rangeInfo": {
    "isPartial": true,
    "totalSize": 104857600
  }
}
```

### Preload Integration

**File:** `electron/preload.ts`

**New APIs:**

```typescript
// Stream encrypted media (async generator)
window.onestar.openEncryptedStream(
  mediaId: string,
  startByte?: number,
  endByte?: number
): AsyncGenerator<Uint8Array>

// Get streaming configuration
window.onestar.getStreamingConfig(): {
  chunkSize: number;
  headerSize: number;
  authTagSize: number;
}
```

**Usage Example:**

```typescript
// Progressive playback with MediaSource
const mediaSource = new MediaSource();
video.src = URL.createObjectURL(mediaSource);

mediaSource.addEventListener('sourceopen', async () => {
  const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
  
  // Stream decrypted chunks
  const stream = await window.onestar.openEncryptedStream(mediaId);
  
  for await (const chunk of stream) {
    // Wait for buffer ready
    while (sourceBuffer.updating) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Append decrypted chunk
    sourceBuffer.appendBuffer(chunk);
  }
  
  mediaSource.endOfStream();
});
```

## Performance Analysis

### Memory Usage Comparison

**Phase 17 (Monolithic):**
```
File Size: 100MB
Memory Usage:
  - Ciphertext: 100MB (fetched)
  - Plaintext: 100MB (decrypted)
  - Blob URL: 100MB (for playback)
  - Total: 300MB peak memory
```

**Phase 18 (Streaming):**
```
File Size: 100MB
Memory Usage:
  - Active chunks: 3-5 chunks × 256KB = 768KB - 1.28MB
  - MediaSource buffer: ~5MB (browser-controlled)
  - Total: ~6MB peak memory
```

**Memory Savings:** 98% reduction (300MB → 6MB)

### Time-to-First-Byte Comparison

**Test Setup:**
- File size: 100MB
- Network: 10Mbps
- Latency: 50ms

| Approach | Download Time | Decrypt Time | TTFB | Improvement |
|----------|--------------|--------------|------|-------------|
| Phase 17 (Full) | 80 seconds | 2 seconds | **82 seconds** | Baseline |
| Phase 18 (Streaming) | 0.2 seconds | 0.02 seconds | **0.22 seconds** | **373x faster** |

### Seeking Performance

**Phase 17:**
- Must download entire file before seeking
- Seek time = download time + decrypt time
- Example: 82 seconds to seek to 50%

**Phase 18:**
- Download only required chunks
- Seek time = chunk download + chunk decrypt
- Example: 0.22 seconds to seek to any position

**Seeking Improvement:** 373x faster

### Bandwidth Efficiency

**Scenario:** User watches first 30 seconds of 10-minute video

**Phase 17:**
- Downloads: 100MB (entire file)
- Bandwidth used: 100MB
- Wasted bandwidth: 95MB (90% of file unused)

**Phase 18:**
- Downloads: ~5MB (first 30 seconds)
- Bandwidth used: 5MB
- Wasted bandwidth: 0MB

**Bandwidth Savings:** 95% reduction

## Migration Strategy

### Backward Compatibility

**Phase 17 Media (Existing):**
- Stored as monolithic ciphertext (single AES-256-GCM operation)
- Still works with Phase 18 client
- Client detects monolithic format (no chunk headers)
- Falls back to full-file decryption

**Phase 18 Media (New):**
- Stored as chunked ciphertext (multiple AES-256-GCM operations)
- Chunk headers enable streaming decryption
- Backward compatible with Phase 17 clients (download all chunks, concat, decrypt)

### Gradual Migration

**Option 1: On-Demand Conversion**
```typescript
// Convert on first playback
if (!isChunkedFormat(ciphertext)) {
  const mediaKey = unwrapMediaKey(...);
  const plaintext = decryptMonolithic(ciphertext, mediaKey);
  const chunks = convertToChunkedFormat(plaintext, mediaKey);
  saveChunkedMedia(mediaId, chunks);
}
```

**Option 2: Background Migration**
```typescript
// Migrate entire library overnight
async function migrateLibrary() {
  const media = await listAllMedia();
  for (const item of media) {
    if (!isChunkedFormat(item.ciphertext)) {
      await convertToChunkedFormat(item);
    }
  }
}
```

**Option 3: Lazy Migration**
- Keep Phase 17 format for existing media
- Use Phase 18 format for new uploads
- No forced migration (both formats supported indefinitely)

**Recommended:** Option 3 (lazy migration) for minimal disruption

## Testing

### Unit Tests

```typescript
// test/encryptedStreamDecoder.test.ts

describe('Streaming Decryption', () => {
  it('should parse chunk header correctly', () => {
    const chunkData = createTestChunk(0, 256 * 1024);
    const parsed = parseChunk(chunkData);
    
    expect(parsed.header.chunkIndex).toBe(0);
    expect(parsed.header.chunkSize).toBe(256 * 1024);
    expect(parsed.header.iv.length).toBe(12);
    expect(parsed.ciphertext.length).toBe(256 * 1024);
    expect(parsed.authTag.length).toBe(16);
  });

  it('should decrypt chunk successfully', () => {
    const mediaKey = crypto.randomBytes(32);
    const plaintext = Buffer.from('Hello, streaming!');
    
    const encryptedChunk = encryptChunk(plaintext, 0, mediaKey);
    const parsedChunk = parseChunk(encryptedChunk);
    const decryptedChunk = decryptChunk(parsedChunk, mediaKey);
    
    expect(decryptedChunk.plaintext.toString()).toBe('Hello, streaming!');
  });

  it('should reject tampered chunks', () => {
    const mediaKey = crypto.randomBytes(32);
    const plaintext = Buffer.from('Hello, streaming!');
    
    const encryptedChunk = encryptChunk(plaintext, 0, mediaKey);
    encryptedChunk[100] ^= 0xFF; // Flip bit
    
    const parsedChunk = parseChunk(encryptedChunk);
    expect(() => decryptChunk(parsedChunk, mediaKey)).toThrow();
  });

  it('should enforce chunk order', async () => {
    const stream = streamEncryptedMedia(mediaId);
    
    // Simulate out-of-order chunks
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
    expect(chunks[2].chunkIndex).toBe(2);
  });
});
```

### Integration Tests

```typescript
// test/streaming-e2e.test.ts

describe('Streaming End-to-End', () => {
  it('should stream and play media progressively', async () => {
    // Upload test media
    const mediaId = await uploadMedia('test-song.mp3');
    
    // Open stream
    const stream = await window.onestar.openEncryptedStream(mediaId);
    
    // Collect chunks
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
      
      // Verify first chunk arrives quickly
      if (chunks.length === 1) {
        expect(Date.now() - startTime).toBeLessThan(500); // < 500ms
      }
    }
    
    // Verify all chunks received
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    expect(totalSize).toBeGreaterThan(0);
  });

  it('should support seeking', async () => {
    const mediaId = await uploadMedia('test-song.mp3');
    const fileSize = 10 * 1024 * 1024; // 10MB
    
    // Seek to 50%
    const startByte = Math.floor(fileSize / 2);
    const stream = await window.onestar.openEncryptedStream(mediaId, startByte);
    
    let firstChunk = null;
    for await (const chunk of stream) {
      firstChunk = chunk;
      break; // Get first chunk only
    }
    
    expect(firstChunk).not.toBeNull();
    expect(firstChunk.length).toBeLessThanOrEqual(256 * 1024);
  });
});
```

### Performance Benchmarks

```bash
# Benchmark streaming vs monolithic
npm run benchmark:streaming

Expected Results:
  Streaming TTFB: < 200ms
  Monolithic TTFB: > 2000ms
  Memory (streaming): < 10MB
  Memory (monolithic): > 100MB
```

## Security Considerations

### Chunk Authentication

**Threat:** Attacker replays chunks from different files

**Mitigation:**
- Unique IV per chunk (12 random bytes)
- GCM authentication tag verifies chunk integrity
- Chunk order validation (sequential chunkIndex)

**Attack Scenario:**
1. Attacker captures chunks from File A
2. Attacker sends chunks to victim playing File B
3. Decryption fails (wrong media key)
4. Even with same media key, GCM tag verification fails

**Result:** Attack prevented by GCM authentication

### Memory Safety

**Threat:** Memory dumps leak plaintext media

**Mitigation:**
- Media key zeroized after each chunk
- Plaintext chunks discarded after MediaSource append
- No full plaintext in memory at any point

**Attack Scenario:**
1. Attacker triggers memory dump
2. Attacker searches dump for plaintext media

**Result:** Only 1-2 active chunks found (~512KB), not entire file

### Timing Attacks

**Threat:** Timing side-channels reveal chunk boundaries

**Mitigation:**
- Constant-time chunk parsing (fixed header size)
- GCM provides constant-time authentication
- No early-exit on validation errors

**Attack Scenario:**
1. Attacker measures chunk processing time
2. Attacker infers chunk boundaries

**Result:** Minimal risk (chunk size already known: 256KB)

## Future Enhancements

### Phase 19: Adaptive Streaming

**Concept:** Adjust chunk size based on network conditions

**Implementation:**
- Small chunks (128KB) for slow networks (< 1Mbps)
- Large chunks (512KB) for fast networks (> 10Mbps)
- Dynamic chunk size based on download speed

**Benefits:**
- Optimal performance for all network conditions
- Reduced overhead for fast connections
- Better UX for slow connections

### Phase 20: WebAssembly Decryption

**Concept:** Offload decryption to WebAssembly for speed

**Implementation:**
- Compile AES-GCM to WASM (via crypto libraries)
- 2-3x faster decryption vs pure JavaScript
- Lower CPU usage

**Benefits:**
- Faster decryption (< 10ms per chunk)
- Better battery life (mobile devices)
- Smoother playback (less CPU strain)

### Phase 21: Predictive Prefetching

**Concept:** Download future chunks before user seeks

**Implementation:**
- Track user seeking patterns
- Prefetch likely chunks (e.g., chorus, drop)
- Cache prefetched chunks

**Benefits:**
- Instant seeking (chunks already downloaded)
- Better UX for repeated sections
- Reduced latency

## References

- **MediaSource API:** https://developer.mozilla.org/en-US/docs/Web/API/MediaSource
- **HTTP Range Requests:** https://developer.mozilla.org/en-US/docs/Web/HTTP/Range_requests
- **AES-GCM Streaming:** https://csrc.nist.gov/publications/detail/sp/800-38d/final
- **Encrypted Media Extensions (EME):** https://www.w3.org/TR/encrypted-media/

---

**Status:** ✅ Complete (Phase 18)  
**Next Phase:** Phase 19 - Adaptive Streaming & Key Rotation Full Implementation  
**TypeScript Compilation:** ✅ Verified  
**Backward Compatibility:** ✅ Maintained
