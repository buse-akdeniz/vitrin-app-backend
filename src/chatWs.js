import { randomUUID } from 'crypto';
import { WebSocketServer } from 'ws';
import { getUserIdFromToken } from './store.js';
import { ChatWsSchema, handleChatWsPayload } from './aiChat.js';

const WS_PATH = '/ws/chat';
const MAX_MESSAGES_PER_MINUTE = 20;

function resolveAuthToken(req) {
  const header = String(req.headers.authorization || '').trim();
  if (header.startsWith('Bearer ')) return header.slice(7);
  try {
    const url = new URL(req.url || '', 'http://localhost');
    return String(url.searchParams.get('token') || '').trim();
  } catch {
    return '';
  }
}

function isAuthorized(token) {
  const uploadToken = String(process.env.UPLOAD_API_TOKEN || '').trim();
  if (uploadToken && token === uploadToken) return true;
  if (token && getUserIdFromToken(token)) return true;
  if (!uploadToken) return true;
  return false;
}

function sendJson(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachChatWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  const buckets = new WeakMap();

  server.on('upgrade', (req, socket, head) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname !== WS_PATH) return;

    const token = resolveAuthToken(req);
    if (!isAuthorized(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = token ? getUserIdFromToken(token) : null;
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws) => {
    buckets.set(ws, []);
    sendJson(ws, { type: 'ready', path: WS_PATH });

    ws.on('message', async (raw) => {
      let body;
      try {
        body = JSON.parse(String(raw));
      } catch {
        sendJson(ws, { type: 'error', message: 'Geçersiz JSON' });
        return;
      }

      if (body?.type === 'ping') {
        sendJson(ws, { type: 'pong' });
        return;
      }

      const parsed = ChatWsSchema.safeParse(body);
      if (!parsed.success) {
        sendJson(ws, {
          type: 'error',
          requestId: body?.requestId,
          message: 'Geçersiz istek',
        });
        return;
      }

      const requestId = parsed.data.requestId || randomUUID();
      const now = Date.now();
      const hits = (buckets.get(ws) || []).filter((t) => now - t < 60_000);
      if (hits.length >= MAX_MESSAGES_PER_MINUTE) {
        sendJson(ws, {
          type: 'error',
          requestId,
          message: 'Çok fazla istek. Lütfen kısa süre sonra tekrar deneyin.',
        });
        return;
      }
      hits.push(now);
      buckets.set(ws, hits);

      sendJson(ws, { type: 'ack', requestId });

      try {
        const result = await handleChatWsPayload(parsed.data);
        sendJson(ws, {
          type: 'done',
          requestId,
          success: true,
          reply: result.reply,
          suggestions: result.suggestions,
        });
      } catch (error) {
        sendJson(ws, {
          type: 'error',
          requestId,
          success: false,
          message: 'AI yanıtı alınamadı',
          error: error?.message || 'unknown_error',
        });
      }
    });
  });

  return wss;
}

export { WS_PATH };
