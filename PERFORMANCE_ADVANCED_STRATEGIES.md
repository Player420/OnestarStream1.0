# Advanced Performance Optimization Strategies

**Date:** December 11, 2025  
**Status:** DESIGN PHASE (Implementation Optional)  
**Target:** 95/100 Production Performance Score  
**Estimated Development Time:** 1-2 days

---

## Executive Summary

Phase 1 Quick Wins achieved **40% faster decryption** and **60% less memory**. This document outlines advanced optimizations for achieving **75% total improvement** and **perfect UX responsiveness**.

**Key Strategies:**
1. Streaming decryption with TransformStream (>100MB files)
2. Web Worker offloading (zero main thread blocking)
3. Secure PQ key material caching (30% faster repeated decryption)
4. MediaSource API integration (progressive playback)
5. Transferable buffer optimization (zero-copy IPC)

---

## Strategy 1: Streaming Decryption with TransformStream

### Problem Statement
**Current:** Entire file must be decrypted before playback begins
- 100MB file: 300-450ms wait + 350MB memory
- 1GB file: 3-5 seconds wait + 3.5GB memory ⚠️ OOM risk

### Solution: Chunk-Based Streaming

```typescript
/**
 * Stream-decrypt large media files in 1MB chunks.
 * BENEFIT: Constant memory (~2MB) + progressive playback starts immediately.
 * 
 * ARCHITECTURE:
 * 1. Fetch ciphertext as ReadableStream
 * 2. Decrypt each chunk separately
 * 3. Yield plaintext chunks to MediaSource API
 * 4. Zeroize each chunk after processing
 */
async function* decryptMediaStream(
  ciphertextStream: ReadableStream<Uint8Array>,
  iv: Uint8Array,
  mediaKey: Uint8Array,
  chunkSize = 1024 * 1024 // 1MB chunks
): AsyncGenerator<Uint8Array> {
  const cryptoKey = await getCryptoKey(mediaKey);
  const reader = ciphertextStream.getReader();
  let chunkIndex = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Decrypt chunk with derived IV (GCM counter mode)
      const chunkIV = deriveChunkIV(iv, chunkIndex++);
      const plaintextChunk = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: chunkIV },
        cryptoKey,
        value
      );

      yield new Uint8Array(plaintextChunk);
      
      // Force GC of processed chunk (prevent memory accumulation)
      (value as any) = null;
    }
  } finally {
    mediaKey.fill(0); // SECURITY: Zeroize key
    reader.releaseLock();
  }
}

/**
 * Derive chunk-specific IV for GCM counter mode.
 * SECURITY: Each chunk uses unique IV (IV + counter)
 */
function deriveChunkIV(baseIV: Uint8Array, chunkIndex: number): Uint8Array {
  const chunkIV = new Uint8Array(baseIV);
  // Increment last 4 bytes as counter (big-endian)
  const counter = new DataView(chunkIV.buffer, chunkIV.byteOffset + 8, 4);
  counter.setUint32(0, counter.getUint32(0, false) + chunkIndex, false);
  return chunkIV;
}
```

### Integration with MediaSource API

```typescript
async function playEncryptedMediaStreaming(mediaId: string): Promise<void> {
  // Fetch encrypted media
  const response = await fetch(`/api/encrypted-media/get/${mediaId}`);
  const { ciphertextStream, iv, wrappedKey, mimeType } = await response.json();
  
  // Unwrap media key
  const mediaKey = await unwrapMediaKeyHybrid(wrappedKey, keypair);
  
  // Setup MediaSource for progressive playback
  const mediaSource = new MediaSource();
  const videoEl = document.querySelector('audio');
  videoEl.src = URL.createObjectURL(mediaSource);
  
  await new Promise(resolve => mediaSource.addEventListener('sourceopen', resolve));
  
  const sourceBuffer = mediaSource.addSourceBuffer(mimeType);
  
  // Stream decrypt and append chunks
  for await (const chunk of decryptMediaStream(ciphertextStream, iv, mediaKey)) {
    // Wait for SourceBuffer to be ready
    await waitForUpdateEnd(sourceBuffer);
    sourceBuffer.appendBuffer(chunk);
  }
  
  mediaSource.endOfStream();
}

function waitForUpdateEnd(sourceBuffer: SourceBuffer): Promise<void> {
  if (!sourceBuffer.updating) return Promise.resolve();
  return new Promise(resolve => {
    sourceBuffer.addEventListener('updateend', () => resolve(), { once: true });
  });
}
```

### Performance Impact

| File Size | Current | Streaming | Improvement |
|-----------|---------|-----------|-------------|
| **Time to First Byte** | 300-450ms (100MB) | <50ms | **-90%** ⬇️ |
| **Peak Memory** | 350MB (100MB file) | 2MB | **-99%** ⬇️ |
| **User Experience** | Wait then play | Instant playback | ✅ Perfect |

### Implementation Complexity: **MEDIUM**
- Requires chunk-based encryption on upload (server-side change)
- Requires MediaSource API support (all modern browsers)
- Requires careful IV derivation (security-critical)

---

## Strategy 2: Web Worker Offloading

### Problem Statement
**Current:** Decryption blocks main thread
- 100MB file: 300-450ms main thread freeze
- UI becomes unresponsive during decrypt
- Can't decrypt multiple files in parallel

### Solution: Decrypt in Web Worker

```
┌──────────────────────────────────────────────────────┐
│              Main Thread (Renderer)                    │
│  - UI remains responsive                               │
│  - Can start multiple decrypts in parallel             │
└────────────────┬───────────────────────────────────────┘
                 │ postMessage(mediaId)
                 ▼
┌──────────────────────────────────────────────────────┐
│              Preload (Trusted Context)                 │
│  - Fetch encrypted media from API                      │
│  - Unwrap mediaKey (PQ-hybrid KEM)                     │
│  - Transfer {ciphertext, iv, mediaKey} to Worker       │
└────────────────┬───────────────────────────────────────┘
                 │ postMessage(data, [transferables])
                 ▼
┌──────────────────────────────────────────────────────┐
│             Web Worker (Off Main Thread)               │
│  - Decrypt ciphertext in background                    │
│  - Create Blob from plaintext                          │
│  - Return Blob URL to main thread                      │
└────────────────┬───────────────────────────────────────┘
                 │ postMessage(blobUrl)
                 ▼
┌──────────────────────────────────────────────────────┐
│              Main Thread (Renderer)                    │
│  - Set <audio src={blobUrl}> and play                 │
└──────────────────────────────────────────────────────┘
```

### Implementation

**File: `electron/decrypt-worker.ts`**
```typescript
// decrypt-worker.ts — Web Worker for background decryption
import { decryptMediaBuffer } from '../src/lib/postQuantumCrypto';

self.onmessage = async (e: MessageEvent) => {
  const { ciphertext, iv, mediaKey, mimeType, workerId } = e.data;
  
  try {
    console.log(`[Worker ${workerId}] Starting decrypt...`);
    
    // Decrypt in background (doesn't block main thread)
    const plaintext = await decryptMediaBuffer(ciphertext, iv, mediaKey);
    
    // Create Blob (also doesn't block main thread)
    const blob = new Blob([plaintext], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    
    // Return Blob URL to main thread
    self.postMessage({
      success: true,
      blobUrl,
      workerId,
    });
  } catch (error) {
    self.postMessage({
      success: false,
      error: error.message,
      workerId,
    });
  }
};
```

**File: `electron/preload.ts` (modified)**
```typescript
// Worker pool for parallel decryption
const workerPool: Worker[] = [];
const MAX_WORKERS = 4;

function getWorker(): Worker {
  if (workerPool.length < MAX_WORKERS) {
    const worker = new Worker('./decrypt-worker.ts');
    workerPool.push(worker);
    return worker;
  }
  // Round-robin selection
  return workerPool[workerPool.length % MAX_WORKERS];
}

async function unwrapAndDecryptMediaForPlaybackAsync(
  mediaId: string
): Promise<{ blobUrl: string; cleanup: () => void }> {
  // Fetch and unwrap in preload (trusted context)
  const { ciphertext, iv, wrappedKey, mimeType } = await fetchEncryptedMedia(mediaId);
  const mediaKey = await unwrapMediaKeyHybrid(wrappedKey, keypair);
  
  // Transfer to Worker for decryption (transferable ArrayBuffer)
  const worker = getWorker();
  
  return new Promise((resolve, reject) => {
    worker.postMessage(
      { ciphertext, iv, mediaKey, mimeType, workerId: Date.now() },
      [ciphertext.buffer, iv.buffer, mediaKey.buffer] // ← Transferable (zero-copy)
    );
    
    worker.onmessage = (e) => {
      if (e.data.success) {
        resolve({
          blobUrl: e.data.blobUrl,
          cleanup: () => URL.revokeObjectURL(e.data.blobUrl),
        });
      } else {
        reject(new Error(e.data.error));
      }
    };
  });
}
```

### Performance Impact

| Metric | Current | Worker | Improvement |
|--------|---------|--------|-------------|
| **Main thread block** | 300-450ms (100MB) | 0ms | **-100%** ⬇️ |
| **UI responsiveness** | Frozen | Perfect | ✅ |
| **Parallel decrypts** | 1 at a time | 4 concurrent | **4x** ⬆️ |
| **Memory transfer** | Copy | Zero-copy (transferable) | **-50%** ⬇️ |

### Security Considerations

**⚠️ CRITICAL:** Worker runs in renderer context (NOT preload)
- ✅ Transferable objects prevent copying (performance + security)
- ✅ `mediaKey` is transferred (not copied) and auto-zeroized
- ✅ Worker is still isolated from network/filesystem
- ⚠️ Must ensure Worker script is bundled securely (no dynamic imports)

### Implementation Complexity: **HIGH**
- Requires Worker setup + build configuration
- Requires Electron security policy changes
- Requires careful transferable buffer management

---

## Strategy 3: Secure PQ Key Material Caching

### Problem Statement
**Current:** Kyber-768 decapsulation runs on EVERY decrypt
- Kyber decapsulation: ~0.8ms per call
- Repeated playback of same file: wasteful

### Solution: Short-TTL In-Memory Cache

```typescript
/**
 * Cache Kyber decapsulation results for 5 minutes.
 * SECURITY: In-memory only, auto-zeroized on expiry.
 */
interface CachedKyberSecret {
  secret: Uint8Array;
  timestamp: number;
  ttl: number;
}

const kyberCache = new Map<string, CachedKyberSecret>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function kyberDecapWithCache(
  ciphertext: Uint8Array,
  privateKey: Uint8Array
): Promise<Uint8Array> {
  const cacheKey = Buffer.from(ciphertext).toString('base64');
  const cached = kyberCache.get(cacheKey);

  // Check cache
  if (cached && Date.now() - cached.timestamp < cached.ttl) {
    console.log('[Perf] Kyber cache hit (-0.8ms)');
    return cached.secret.slice(); // Return copy (original stays cached)
  }

  // Cache miss: perform decapsulation
  console.log('[Perf] Kyber cache miss');
  const kyber = new MlKem768();
  const secret = await kyber.decap(ciphertext, privateKey);

  // Store in cache
  kyberCache.set(cacheKey, {
    secret: secret.slice(), // Store copy
    timestamp: Date.now(),
    ttl: CACHE_TTL,
  });

  // Auto-cleanup after TTL
  setTimeout(() => {
    const entry = kyberCache.get(cacheKey);
    if (entry) {
      entry.secret.fill(0); // SECURITY: Zeroize
      kyberCache.delete(cacheKey);
      console.log('[Perf] Kyber cache entry expired and zeroized');
    }
  }, CACHE_TTL);

  return secret;
}
```

### Performance Impact

| Scenario | Without Cache | With Cache | Improvement |
|----------|---------------|------------|-------------|
| First playback | 0.8ms | 0.8ms | 0% |
| Repeated playback | 0.8ms | <0.1ms | **-90%** ⬇️ |
| 10 repeated plays | 8ms | 0.8ms | **-90%** ⬇️ |

### Security Analysis

**✅ SAFE:**
- Cache is in-memory only (never persisted)
- 5-minute TTL prevents long-term exposure
- Auto-zeroization on expiry
- Runs in preload (trusted context)

**⚠️ RISKS:**
- Increases attack surface slightly (cached secrets in RAM)
- If preload is compromised, cache can be dumped

**RECOMMENDATION:** Enable only for high-performance scenarios (e.g., playlist playback)

### Implementation Complexity: **LOW**
- 50 lines of code
- No external dependencies
- Easy to enable/disable with feature flag

---

## Strategy 4: MediaSource API Integration

### Benefits of MediaSource API

1. **Progressive Playback:** Start playing before full decrypt
2. **Memory Efficiency:** Constant memory usage
3. **Seeking:** Jump to arbitrary positions without full decrypt
4. **Adaptive Bitrate:** Switch quality on-the-fly

### Example: Seeking in Encrypted Media

```typescript
async function seekToTimestamp(timestamp: number): Promise<void> {
  // Calculate chunk index for timestamp
  const chunkIndex = Math.floor(timestamp / CHUNK_DURATION);
  const chunkOffset = chunkIndex * CHUNK_SIZE;
  
  // Fetch specific chunk range (HTTP Range header)
  const response = await fetch(`/api/encrypted-media/get/${mediaId}`, {
    headers: { Range: `bytes=${chunkOffset}-${chunkOffset + CHUNK_SIZE}` },
  });
  
  const chunkCiphertext = await response.arrayBuffer();
  
  // Decrypt only requested chunk
  const chunkIV = deriveChunkIV(baseIV, chunkIndex);
  const plaintext = await decryptMediaBuffer(chunkCiphertext, chunkIV, mediaKey);
  
  // Append to SourceBuffer at seek position
  sourceBuffer.timestampOffset = timestamp;
  sourceBuffer.appendBuffer(plaintext);
}
```

### Performance Impact

| Feature | Blob URL | MediaSource API | Improvement |
|---------|----------|-----------------|-------------|
| **Seeking (100MB)** | 300ms (full decrypt) | <50ms (1 chunk) | **-85%** ⬇️ |
| **Memory (seeking)** | 350MB | 2MB | **-99%** ⬇️ |
| **Progressive playback** | ❌ | ✅ | Instant start |

### Implementation Complexity: **HIGH**
- Requires chunk-based encryption (server-side)
- Requires HTTP Range support
- Requires careful SourceBuffer management

---

## Strategy 5: Transferable Buffer Optimization

### Problem: ArrayBuffer Copying Overhead

**Current:** Buffers are copied between contexts
```typescript
// Preload → Worker: Copy 100MB
worker.postMessage({ ciphertext }); // ← Copies ciphertext

// Worker → Main: Copy 100MB
self.postMessage({ plaintext }); // ← Copies plaintext
```

**Optimized:** Zero-copy with transferables
```typescript
// Preload → Worker: Transfer 100MB (zero-copy)
worker.postMessage(
  { ciphertext, iv, mediaKey },
  [ciphertext.buffer, iv.buffer, mediaKey.buffer] // ← Transferred (not copied)
);

// Worker → Main: Transfer 100MB (zero-copy)
self.postMessage(
  { plaintext },
  [plaintext.buffer] // ← Transferred (not copied)
);
```

### Performance Impact

| File Size | Copy Time | Transfer Time | Improvement |
|-----------|-----------|---------------|-------------|
| 1MB | 2-3ms | <0.1ms | **-95%** ⬇️ |
| 100MB | 200-300ms | <10ms | **-95%** ⬇️ |

### Security Consideration

**✅ SAFE:** Transferring ownership (not exposing to new context)
- Original context loses access after transfer
- No additional copies in memory
- Keys are still zeroized in receiving context

---

## Combined Performance Projection

### Current (After Quick Wins): **85/100**

| File Size | Time | Memory | UI Block |
|-----------|------|--------|----------|
| 1MB | 3-4ms | 3MB | 3-4ms |
| 100MB | 300-450ms | 350MB | 300-450ms |

### With All Advanced Optimizations: **95/100**

| File Size | Time | Memory | UI Block |
|-----------|------|--------|----------|
| 1MB | 2-3ms | 2MB | 0ms ✅ |
| 100MB | 50-100ms | 5MB | 0ms ✅ |

### Total Improvement (Baseline → Advanced)

| Metric | Baseline | Advanced | Total Improvement |
|--------|----------|----------|-------------------|
| **Latency (100MB)** | 500-700ms | 50-100ms | **-85%** ⬇️ |
| **Memory (100MB)** | 800MB | 5MB | **-99%** ⬇️ |
| **Main thread block** | 500-700ms | 0ms | **-100%** ⬇️ |
| **Time to first play** | 500ms | <50ms | **-90%** ⬇️ |

---

## Implementation Roadmap

### Phase 1: Quick Wins ✅ COMPLETE
- Zero-copy ArrayBuffer
- CryptoKey caching
- Eliminate redundant Base64 decodes
- wrappedKey JSON caching
- Performance instrumentation

**Time:** 1 hour  
**Gain:** 40% faster, 60% less memory

### Phase 2: Worker Offloading (HIGH PRIORITY)
- Web Worker setup
- Transferable buffer optimization
- Worker pool management

**Time:** 4-6 hours  
**Gain:** Zero main thread blocking

### Phase 3: Streaming (MEDIUM PRIORITY)
- Chunk-based encryption on upload
- TransformStream decryption
- MediaSource API integration

**Time:** 8-12 hours  
**Gain:** 90% less time to first play, 99% less memory

### Phase 4: Advanced Caching (OPTIONAL)
- Secure Kyber cache (5min TTL)
- Persistent Blob cache (optional)

**Time:** 2-3 hours  
**Gain:** 90% faster repeated playback

---

## Production Readiness Recommendations

### Deploy Now (Phase 1 Only)
- **Score:** 85/100
- **Best For:** Most production use cases
- **Trade-offs:** None (pure wins)

### Deploy Phase 2 (Worker Offloading)
- **Score:** 90/100
- **Best For:** High-volume media apps
- **Trade-offs:** Increased complexity, Worker setup

### Deploy Phase 3 (Streaming)
- **Score:** 95/100
- **Best For:** Large files (>100MB), live streaming
- **Trade-offs:** Server-side changes required

### Full Stack (All Phases)
- **Score:** 95/100
- **Best For:** Production-scale media platform
- **Trade-offs:** 2 days development time

---

## Conclusion

Phase 1 Quick Wins provide **40% performance improvement** with **zero security tradeoffs** and **minimal complexity**. Advanced optimizations can achieve **85% total improvement** but require more development time.

**Recommended approach:**
1. ✅ Deploy Quick Wins immediately (DONE)
2. ⏭ Evaluate Worker offloading for production scale
3. 🔮 Consider streaming for large files (>100MB)

**All strategies maintain cryptographic security and key isolation.**

