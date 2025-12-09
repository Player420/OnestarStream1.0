/***************************************************************************************************
 * preload.ts — ARCHITECTURE D
 * Renderer <-> Main audio IPC bridge.
 **************************************************************************************************/

import { contextBridge, ipcRenderer } from "electron";

const audio = {
  load: (absPath: string) =>
    ipcRenderer.invoke("onestar:loadMedia", { absPath }),

  play: () => ipcRenderer.invoke("onestar:playHD"),

  pause: () => ipcRenderer.invoke("onestar:pauseHD"),

  seek: (seconds: number) =>
    ipcRenderer.invoke("onestar:seekHD", { seconds }),

  getTime: () => ipcRenderer.invoke("onestar:getAudioTime"),
};

const media = {
  startChunkedSave: (opts: any) =>
    ipcRenderer.invoke("onestar:startSave", opts),

  appendChunk: (opts: any) =>
    ipcRenderer.invoke("onestar:appendSave", {
      sessionId: opts.sessionId,
      chunk: Buffer.from(opts.chunk),
    }),

  finishChunkedSave: (opts: any) =>
    ipcRenderer.invoke("onestar:finishSave", opts),

  listMedia: () => ipcRenderer.invoke("onestar:listMedia"),

  deleteMedia: (id: string) =>
    ipcRenderer.invoke("onestar:deleteMedia", { id }),

  getShareFile: (id: string) =>
    ipcRenderer.invoke("onestar:getShareFile", { id }),

  getFileBytes: (absPath: string) =>
    ipcRenderer.invoke("onestar:getFileBytes", { absPath }),

  getFilePath: (id: string) =>
    ipcRenderer.invoke("onestar:getFilePath", { id }),
};

contextBridge.exposeInMainWorld("onestar", { audio, media });

declare global {
  interface Window {
    onestar: {
      audio: typeof audio;
      media: typeof media;
    };
  }
}
