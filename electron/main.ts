/***************************************************************************************************
 * main.ts — ARCH D (FINAL)
 **************************************************************************************************/

import {
  app,
  BrowserWindow,
  protocol,
  ipcMain,
} from "electron";

import * as path from "path";
import * as fs from "fs";
import mime from "mime";
import * as crypto from "crypto";

/***************************************************************************************************
 * PROTOCOL
 **************************************************************************************************/
protocol.registerSchemesAsPrivileged([
  {
    scheme: "onestar",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
]);

/***************************************************************************************************
 * USER DATA PATHS
 **************************************************************************************************/
app.setName("onestarstream");
if (process.platform === "darwin") {
  const home = app.getPath("home");
  app.setPath(
    "userData",
    path.join(home, "Library", "Application Support", "onestarstream")
  );
}

const APP_URL = process.env.ONESTAR_APP_URL || "http://localhost:3000";

/***************************************************************************************************
 * MEDIA STRUCTURE
 **************************************************************************************************/
function ensureDirs() {
  const root = path.join(app.getPath("userData"), "media");
  const publicDir = path.join(root, "public");
  const protectedDir = path.join(root, "protected");
  const indexPath = path.join(root, "media-index.json");

  [root, publicDir, protectedDir].forEach((d) => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });

  if (!fs.existsSync(indexPath)) fs.writeFileSync(indexPath, "[]");

  return { root, publicDir, protectedDir, indexPath };
}

const dirs = ensureDirs();

const loadIndex = () =>
  JSON.parse(fs.readFileSync(dirs.indexPath, "utf8"));
const saveIndex = (x: any) =>
  fs.writeFileSync(dirs.indexPath, JSON.stringify(x, null, 2));

/***************************************************************************************************
 * onestar:// STREAMING
 **************************************************************************************************/
function registerProtocol() {
  protocol.registerStreamProtocol("onestar", (req, cb) => {
    try {
      const u = new URL(req.url);
      const parts = u.pathname.replace(/^\/+/, "").split("/");
      const visibility = parts[0];
      const filename = decodeURIComponent(parts.slice(1).join("/"));

      const base =
        visibility === "protected" ? dirs.protectedDir : dirs.publicDir;

      const filePath = path.join(base, filename);
      if (!fs.existsSync(filePath)) return cb({ statusCode: 404 });

      const stat = fs.statSync(filePath);
      const total = stat.size;

      let mimeType = mime.getType(filePath) || "application/octet-stream";
      const range = req.headers["range"];

      if (!range) {
        return cb({
          statusCode: 200,
          headers: {
            "Content-Type": mimeType,
            "Content-Length": String(total),
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
          },
          data: fs.createReadStream(filePath),
        });
      }

      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m) return cb({ statusCode: 416 });

      let start = m[1] ? parseInt(m[1], 10) : 0;
      let end = m[2] ? parseInt(m[2], 10) : total - 1;
      start = Math.max(0, start);
      end = Math.min(end, total - 1);
      const len = end - start + 1;

      cb({
        statusCode: 206,
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(len),
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "no-store",
        },
        data: fs.createReadStream(filePath, { start, end }),
      });
    } catch (err) {
      cb({ statusCode: 500 });
    }
  });
}

/***************************************************************************************************
 * LIST + DELETE IPC
 **************************************************************************************************/
ipcMain.handle("onestar:listMedia", () => loadIndex());

ipcMain.handle("onestar:deleteMedia", (_, { id }) => {
  const items = loadIndex();
  const idx = items.findIndex((x) => x.id === id);
  if (idx < 0) return { ok: false };

  const item = items[idx];
  items.splice(idx, 1);
  saveIndex(items);

  const base = item.protected ? dirs.protectedDir : dirs.publicDir;
  try {
    fs.unlinkSync(path.join(base, item.fileName));
  } catch {}

  return { ok: true };
});

/***************************************************************************************************
 * FILE PATH
 **************************************************************************************************/
ipcMain.handle("onestar:getFilePath", (_, { id }) => {
  const items = loadIndex();
  const item = items.find((i) => i.id === id);
  if (!item) return { ok: false };

  const base = item.protected ? dirs.protectedDir : dirs.publicDir;
  return { ok: true, absPath: path.join(base, item.fileName) };
});

/***************************************************************************************************
 * CHUNKED UPLOAD
 **************************************************************************************************/
const active = new Map();

ipcMain.handle("onestar:startSave", (_, opts) => {
  const sessionId = crypto.randomUUID();
  const ext = path.extname(opts.originalName);
  const finalName = `${sessionId}${ext}`;

  const temp = path.join(dirs.root, "tmp");
  if (!fs.existsSync(temp)) fs.mkdirSync(temp);

  const tempPath = path.join(temp, `${sessionId}.part`);
  fs.writeFileSync(tempPath, Buffer.alloc(0));

  active.set(sessionId, {
    tempPath,
    finalName,
    title: opts.title,
    type: opts.type,
    protected: !opts.downloadable,
    sizeBytes: 0,
    createdAt: new Date().toISOString(),
  });

  return { ok: true, sessionId };
});

ipcMain.handle("onestar:appendSave", (_, { sessionId, chunk }) => {
  const s = active.get(sessionId);
  if (!s) return { ok: false };

  fs.appendFileSync(s.tempPath, chunk);
  s.sizeBytes += chunk.length;
  return { ok: true };
});

ipcMain.handle("onestar:finishSave", (_, { sessionId }) => {
  const s = active.get(sessionId);
  if (!s) return { ok: false };

  const targetDir = s.protected ? dirs.protectedDir : dirs.publicDir;
  const finalPath = path.join(targetDir, s.finalName);

  fs.renameSync(s.tempPath, finalPath);

  const items = loadIndex();
  items.push({
    id: sessionId,
    title: s.title,
    fileName: s.finalName,
    type: s.type,
    sizeBytes: s.sizeBytes,
    createdAt: s.createdAt,
    protected: s.protected,
  });
  saveIndex(items);

  active.delete(sessionId);
  return { ok: true };
});

/***************************************************************************************************
 * AUDIO ENGINE (MAIN PROCESS)
 **************************************************************************************************/
const audioCtx = new (globalThis.AudioContext || require("web-audio-api").AudioContext)();

let state = {
  buffer: null as AudioBuffer | null,
  duration: 0,
  currentTime: 0,
  lastSeek: 0,
  lastStart: 0,
  isPlaying: false,
};

let node: AudioBufferSourceNode | null = null;

function stop() {
  if (node) {
    try {
      node.stop();
    } catch {}
    node.disconnect();
    node = null;
  }
  state.isPlaying = false;
}

ipcMain.handle("onestar:loadMedia", async (_, { absPath }) => {
  try {
    stop();
    const data = await fs.promises.readFile(absPath);
    const buf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const decoded = await audioCtx.decodeAudioData(buf);

    state.buffer = decoded;
    state.duration = decoded.duration;
    state.currentTime = 0;
    state.lastSeek = 0;
    state.isPlaying = false;

    return { ok: true, duration: decoded.duration };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("onestar:playHD", () => {
  if (!state.buffer) return { ok: false };

  stop();

  node = audioCtx.createBufferSource();
  node.buffer = state.buffer;
  node.connect(audioCtx.destination);
  node.start(0, state.lastSeek);

  state.lastStart = audioCtx.currentTime;
  state.isPlaying = true;

  return { ok: true };
});

ipcMain.handle("onestar:pauseHD", () => {
  if (!state.buffer) return { ok: false };

  if (state.isPlaying) {
    state.lastSeek += audioCtx.currentTime - state.lastStart;
  }

  stop();
  return { ok: true };
});

ipcMain.handle("onestar:seekHD", (_, { seconds }) => {
  if (!state.buffer) return { ok: false };

  state.lastSeek = Math.max(0, Math.min(seconds, state.duration));

  if (state.isPlaying) {
    stop();
    node = audioCtx.createBufferSource();
    node.buffer = state.buffer;
    node.connect(audioCtx.destination);
    node.start(0, state.lastSeek);
    state.lastStart = audioCtx.currentTime;
  }

  return { ok: true };
});

ipcMain.handle("onestar:getAudioTime", () => {
  if (state.isPlaying) {
    state.currentTime =
      state.lastSeek + (audioCtx.currentTime - state.lastStart);

    if (state.currentTime >= state.duration) {
      state.currentTime = state.duration;
      stop();
    }
  }

  return {
    ok: true,
    currentTime: state.currentTime,
    duration: state.duration,
  };
});

/***************************************************************************************************
 * WINDOW
 **************************************************************************************************/
let win: BrowserWindow | null = null;

function create() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
  });

  win.loadURL(APP_URL);
  win.on("closed", () => (win = null));
}

app.whenReady().then(() => {
  registerProtocol();
  create();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) create();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
