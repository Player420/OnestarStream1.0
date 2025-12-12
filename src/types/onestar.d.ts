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
    };
  }
}

export {};
