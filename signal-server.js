
// signal-server.js
// Simple WebSocket signaling server for WebRTC P2P
// Run with: node signal-server.js  (or via pm2)

const http = require('http');
const { WebSocketServer } = require('ws');
const cookie = require('cookie');

const PORT = 4000;

// Map userId -> Set<WebSocket>
/** @type {Map<string, Set<any>>} */
const clientsByUserId = new Map();

/**
 * Very simple "auth" for now:
 * - Reads ONESTAR_SESSION from cookies
 * - Uses its value as userId (you can replace this with real lookup later)
 *
 * @param {string | undefined} cookieHeader
 * @returns {{ id: string } | null}
 */
function getUserFromCookies(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = cookie.parse(cookieHeader);
  const session = cookies['ONESTAR_SESSION'];
  if (!session) return null;

  // TODO: replace this with real session validation.
  // For now, treat the session token string as the user id.
  return { id: session };
}

const server = http.createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  try {
    const user = getUserFromCookies(req.headers.cookie);
    if (!user) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    const userId = user.id;

    if (!clientsByUserId.has(userId)) {
      clientsByUserId.set(userId, new Set());
    }
    clientsByUserId.get(userId).add(ws);

    ws.on('message', (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }

      const { toUserId, fromUserId } = msg || {};

      // Enforce fromUserId matches this socket's user
      if (!fromUserId || fromUserId !== userId) return;
      if (!toUserId) return;

      const targets = clientsByUserId.get(toUserId);
      if (!targets || targets.size === 0) return;

      const payload = JSON.stringify(msg);
      for (const target of targets) {
        if (target.readyState === target.OPEN) {
          target.send(payload);
        }
      }
    });

    ws.on('close', () => {
      const set = clientsByUserId.get(userId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) {
        clientsByUserId.delete(userId);
      }
    });
  } catch {
    try {
      ws.close(1011, 'Internal error');
    } catch {
      // ignore
    }
  }
});

server.listen(PORT, () => {
  console.log(`Signal server listening on port ${PORT}`);
});

