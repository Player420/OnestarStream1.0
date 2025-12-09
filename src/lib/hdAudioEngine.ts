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
export async function loadHD(absPath: string) {
  const o = api();
  if (!o) return { ok: false };
  return o.audio.load(absPath);
}

/***************************************************************************************************
 * PLAY
 **************************************************************************************************/
export async function playHD() {
  const o = api();
  if (!o) return { ok: false };
  return o.audio.play();
}

/***************************************************************************************************
 * PAUSE
 **************************************************************************************************/
export async function pauseHD() {
  const o = api();
  if (!o) return { ok: false };
  return o.audio.pause();
}

/***************************************************************************************************
 * SEEK
 **************************************************************************************************/
export async function seekHD(seconds: number) {
  const o = api();
  if (!o) return { ok: false };
  return o.audio.seek(seconds);
}

/***************************************************************************************************
 * GET CLOCK (RAF)
 **************************************************************************************************/
export async function getHDAudioTime() {
  const o = api();
  if (!o) return { ok: false, currentTime: 0, duration: 0 };
  return o.audio.getTime();
}
