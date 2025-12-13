/***************************************************************************************************
 * hdAudioEngine.ts — FINAL FOR ARCHITECTURE D
 * Mirror exactly what preload exposes.
 * No decoding. No WebAudio in renderer.
 * Everything proxied to Electron main process.
 **************************************************************************************************/

function api() {
  if (typeof window === "undefined") return null;
  return (window as any).onestar || null;
}

/***************************************************************************************************
 * LOAD FILE INTO MAIN PROCESS
 **************************************************************************************************/
export async function loadMedia(absPath: string) {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.loadMedia(absPath);
}

/***************************************************************************************************
 * PLAY
 **************************************************************************************************/
export async function playHD() {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.playHD();
}

/***************************************************************************************************
 * PAUSE
 **************************************************************************************************/
export async function pauseHD() {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.pauseHD();
}

/***************************************************************************************************
 * SEEK
 **************************************************************************************************/
export async function seekHD(seconds: number) {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.seekHD(seconds);
}

/***************************************************************************************************
 * GET CLOCK (RAF)
 **************************************************************************************************/
export async function getAudioTime() {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.getAudioTime();
}

// Media management / chunked save wrappers
export async function listMedia() {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.listMedia();
}

export async function deleteMedia(id: string) {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.deleteMedia(id);
}

export async function startChunkedSave(opts: any) {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.startChunkedSave(opts);
}

export async function appendChunk(opts: any) {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.appendChunk(opts);
}

export async function finishChunkedSave(opts: any) {
  const o = api();
  if (!o) return { ok: false, error: 'unavailable' };
  return o.finishChunkedSave(opts);
}

// Backwards compatible aliases for existing UI that imports old names
export { loadMedia as loadHD };
export { getAudioTime as getHDAudioTime };
