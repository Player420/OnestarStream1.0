
// Minimal type shim so TypeScript accepts imports from 'electron' in this project.
// This is only for type-checking on the server; the real Electron types/runtime
// are used in the actual desktop build.
declare module 'electron' {
  export const app: any;
  export const BrowserWindow: any;
  export const ipcMain: any;
  export const contextBridge: any;
  export const ipcRenderer: any;
}
