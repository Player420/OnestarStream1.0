
import { contextBridge, ipcRenderer } from 'electron';
import fs from 'fs';

type MediaType = 'audio' | 'video' | 'image';

export interface MediaItem {
  id: string;
  title: string;
  fileName: string;
  type: MediaType;
  sizeBytes: number;
  createdAt: string;
  protected: boolean;
}

const api = {
  /**
   * Save a new media file into the user's local public/protected folders.
   * This is called from src/app/upload/page.tsx when (window as any).onestar.saveMedia exists.
   */
  saveMedia: async (opts: {
    file: File;
    title: string;
    type: MediaType;
    downloadable: boolean;
  }): Promise<{ ok: boolean; id?: string; fileName?: string }> => {
    const { file, title, type, downloadable } = opts;

    // In Electron, <input type="file"> gives us a real filesystem path on the File object.
    const anyFile = file as any;
    const filePath: string | undefined = anyFile.path;
    const originalName: string = file.name || 'track';

    if (!filePath) {
      throw new Error(
        'File path is not available. saveMedia must be used from the Electron app, not plain browser.'
      );
    }

    return ipcRenderer.invoke('onestar:saveMedia', {
      filePath,
      originalName,
      title,
      type,
      downloadable,
    });
  },

  /**
   * List all media from the local media index.
   * Used by src/app/app/page.tsx and src/app/library/page.tsx when available.
   */
  listMedia: async (): Promise<MediaItem[]> => {
    const result = await ipcRenderer.invoke('onestar:listMedia');
    return Array.isArray(result) ? (result as MediaItem[]) : [];
  },

  /**
   * Delete a media item and remove its local file.
   */
  deleteMedia: async (
    id: string
  ): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('onestar:deleteMedia', { id });
  },

  /**
   * Return a Blob + name for a media item so the sender can P2P it.
   * Used by src/app/app/page.tsx (Share → P2P sender path).
   */
  getShareFile: async (
    id: string
  ): Promise<{ blob: Blob; name?: string }> => {
    const {
      filePath,
      fileName,
      mimeType,
    }: { filePath: string; fileName: string; mimeType?: string } =
      await ipcRenderer.invoke('onestar:getShareFile', { id });

    // Read bytes from disk and wrap in a Blob for the browser-side P2P layer.
    const data = await fs.promises.readFile(filePath);
    const blob = new Blob([data], {
      type: mimeType || 'application/octet-stream',
    });

    return { blob, name: fileName };
  },

  /**
   * Save a P2P-received share into local media folders and index.
   * Called from src/app/inbox/page.tsx via (window as any).onestar.saveReceivedShare.
   */
  saveReceivedShare: async (opts: {
    shareId: string;
    mediaId: string;
    title: string;
    type: MediaType;
    downloadable: boolean;
    blob: Blob;
    fileName?: string;
  }): Promise<{ ok: boolean; id?: string; fileName?: string }> => {
    const {
      shareId,
      mediaId,
      title,
      type,
      downloadable,
      blob,
      fileName,
    } = opts;

    const arrayBuffer = await blob.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return ipcRenderer.invoke('onestar:saveReceivedShare', {
      shareId,
      mediaId,
      title,
      type,
      downloadable,
      fileName,
      buffer,
    });
  },
};

contextBridge.exposeInMainWorld('onestar', api);

// Make this a module
export {};
