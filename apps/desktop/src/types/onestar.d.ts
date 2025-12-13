// Authoritative onestar preload/IPC types

type MediaType = 'audio' | 'video' | 'image';

interface MediaItem {
  id: string;
  title: string;
  fileName: string;
  type: MediaType;
  sizeBytes: number;
  createdAt: string;
  protected: boolean;
}

// Phase 18: Local Media Index types
interface LocalMediaItem {
  id: string;
  title: string;
  mimeType: string;
  duration?: number;
  fileSize?: number;
  createdAt: string;
  hasDownloadPermission: boolean;
  licenseId: string;
  ownerUserId: string;
  mediaHash?: string;
}

interface MediaIndexStats {
  mediaCount: number;
  totalSize: number;
  lastUpdated: string;
  oldestMedia?: string;
  newestMedia?: string;
}

interface StreamingConfig {
  chunkSize: number;
  headerSize: number;
  authTagSize: number;
}

type IPCSuccess<T> = { ok: true; data: T };
type IPCError = { ok: false; error: string };
type IPCResult<T> = IPCSuccess<T> | IPCError;

declare global {
  interface Window {
    onestar?: {
      // Audio API
      loadMedia: (absPath: string) => Promise<IPCResult<{ duration: number }>>;
      playHD: () => Promise<IPCResult<boolean>>;
      pauseHD: () => Promise<IPCResult<boolean>>;
      seekHD: (seconds: number) => Promise<IPCResult<boolean>>;
      getAudioTime: () => Promise<IPCResult<{ currentTime: number; duration: number }>>;

      // Chunked save
      startChunkedSave: (opts: {
        originalName: string;
        title?: string;
        type?: MediaType;
        downloadable?: boolean;
      }) => Promise<IPCResult<{ sessionId: string }>>;

      appendChunk: (opts: { sessionId: string; chunk: Uint8Array }) => Promise<IPCResult<boolean>>;

      finishChunkedSave: (opts: { sessionId: string }) => Promise<IPCResult<boolean>>;

      // Media management
      listMedia: () => Promise<IPCResult<MediaItem[]>>;
      deleteMedia: (id: string) => Promise<IPCResult<boolean>>;

      // Helpers
      getFilePath: (id: string) => Promise<IPCResult<{ absPath: string }>>;
      getShareFile: (id: string) => Promise<IPCResult<{ filePath: string; fileName: string; mimeType: string }>>;
      getFileBytes: (absPath: string) => Promise<IPCResult<Uint8Array>>;

      // Phase 18: Local Media Index APIs
      getLocalMediaIndex: () => Promise<LocalMediaItem[]>;
      refreshLocalMediaIndex: () => Promise<number>;
      getMediaFromIndex: (mediaId: string) => Promise<LocalMediaItem | null>;
      addMediaToIndex: (item: LocalMediaItem) => Promise<void>;
      removeMediaFromIndex: (mediaId: string) => Promise<boolean>;
      clearLocalMediaIndex: () => Promise<void>;
      getMediaIndexStats: () => Promise<MediaIndexStats>;

      // Phase 18: Streaming Decryption APIs
      openEncryptedStream: (
        mediaId: string,
        startByte?: number,
        endByte?: number
      ) => Promise<AsyncGenerator<Uint8Array, void, unknown>>;
      getStreamingConfig: () => StreamingConfig;

      // Phase 17: Monolithic Decryption (backward compatibility)
      unwrapAndDecryptMedia?: (mediaId: string) => Promise<{
        blobUrl: string;
        mimeType: string;
        title: string;
        cleanup: () => void;
      }>;
    };
  }
}

export {};
