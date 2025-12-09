// src/types/onestar.d.ts

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

declare global {
  interface Window {
    onestar?: {
      startChunkedSave: (opts: {
        originalName: string;
        title: string;
        type: MediaType;
        downloadable: boolean;
      }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;

      appendChunk: (opts: {
        sessionId: string;
        chunk: Uint8Array;
      }) => Promise<{ ok: boolean; error?: string }>;

      finishChunkedSave: (opts: {
        sessionId: string;
      }) => Promise<{
        ok: boolean;
        id?: string;
        fileName?: string;
        error?: string;
      }>;

      listMedia: () => Promise<MediaItem[]>;

      deleteMedia: (id: string) => Promise<{ ok: boolean }>;

      getShareFile: (id: string) => Promise<{
        filePath: string;
        fileName: string;
        mimeType: string;
        blob?: Blob;
      }>;

      readFileBytes: (filePath: string) => Promise<Uint8Array>;
    };
  }
}

export {};
