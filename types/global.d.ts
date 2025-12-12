export {};
declare global {
  interface Window {
    onestar?: {
      // Audio API
      loadMedia?: (absPath: string) => Promise<{ ok: boolean; error?: string }>;
      playHD?: () => Promise<{ ok: boolean }>;
      pauseHD?: () => Promise<{ ok: boolean }>;
      seekHD?: (seconds: number) => Promise<{ ok: boolean }>;
      getAudioTime?: () => Promise<{ currentTime: number; duration: number }>;
      
      // File operations
      getFileBytes?: (filePath: string) => Promise<Uint8Array>;
      saveReceivedShare?: (payload: unknown) => Promise<{ ok: boolean }>;
      
      // Encrypted Media Playback API (PQ-Hybrid Secure)
      /**
       * Decrypt and play encrypted media from database.
       * SECURITY: All decryption happens in preload (keys never reach renderer).
       * 
       * @param mediaId - Media blob ID from database
       * @returns Object with Blob URL and cleanup function
       */
      unwrapAndDecryptMedia?: (mediaId: string) => Promise<{
        blobUrl: string;
        mimeType: string;
        title?: string;
        cleanup: () => void;
      }>;
    };
  }
}

