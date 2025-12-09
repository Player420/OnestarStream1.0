export {};

declare global {
  type MediaType = 'audio' | 'video' | 'image';

  interface OnestarMediaItem {
    id: string;
    title: string;
    fileName: string;
    type: MediaType;
    sizeBytes: number;
    createdAt: string;
    protected: boolean;
  }

  interface Window {
    onestar?: {
      saveMedia?: (opts: {
        file: File;
        title: string;
        type: MediaType;
        downloadable: boolean;
      }) => Promise<{ ok: boolean; id?: string; fileName?: string; error?: string }>;
      listMedia?: () => Promise<OnestarMediaItem[]>;
      deleteMedia?: (id: string) => Promise<{ ok: boolean }>;
      getShareFile?: (id: string) => Promise<{ blob: Blob; name?: string }>;
      saveReceivedShare?: (payload: unknown) => Promise<{ ok: boolean }>;
    };
  }
}

