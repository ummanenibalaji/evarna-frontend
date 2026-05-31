// Base URL for the Whisper backend (http://localhost:3000).
// All API calls go through /api/v1 — this is the single place to update
// if the backend address changes (e.g. staging, production).

// Point this at the running backend:
//   • iOS simulator on this Mac → 'http://localhost:3000'
//   • Android emulator          → 'http://10.0.2.2:3000'
//   • Physical device on LAN    → 'http://<this-mac-LAN-IP>:3000' (currently 192.168.1.24)
export const BASE_URL = 'http://192.168.1.23:3000';
export const API_BASE = `${BASE_URL}/api/v1`;

// localtunnel.me shows a browser-friendly warning page on first visit unless this
// header is sent. Safe to send always — backends ignore it.
const TUNNEL_HEADERS = { 'bypass-tunnel-reminder': 'true' };

type ApiResponse<T> = { success: boolean; data: T };

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...TUNNEL_HEADERS } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE', headers: { ...TUNNEL_HEADERS } });
  if (!res.ok) throw new Error(`DELETE ${path} → ${res.status}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export interface SseHandlers {
  onChunk: (content: string) => void;
  onDone: (turnId: string) => void;
  onCrisis: (content: string) => void;
  onError: (message: string) => void;
}

/**
 * Stream a chat turn via SSE.
 * Returns an AbortController — call abort() to cancel mid-stream.
 *
 * The backend emits named SSE events:
 *   event: chunk\ndata: {"content":"..."}\n\n
 *   event: done\ndata: {"turn_id":"..."}\n\n
 *   event: crisis\ndata: {"content":"..."}\n\n
 *   event: error\ndata: {"message":"..."}\n\n
 */
export function streamConversation(
  payload: { session_id: string; character_id: string; user_id: string; message: string },
  handlers: SseHandlers,
): AbortController {
  const ctrl = new AbortController();

  (async () => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/conversations/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...TUNNEL_HEADERS,
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') handlers.onError(String(e));
      return;
    }

    if (!res.ok) { handlers.onError(`HTTP ${res.status}`); return; }

    const parseBlock = (text: string) => {
      const lines = text.split('\n');
      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const raw = line.slice(6).trim();
          if (!raw || !eventType) continue;
          try {
            const d = JSON.parse(raw) as Record<string, string>;
            if (eventType === 'chunk') handlers.onChunk(d.content ?? '');
            else if (eventType === 'done') handlers.onDone(d.turn_id ?? '');
            else if (eventType === 'crisis') handlers.onCrisis(d.content ?? '');
            else if (eventType === 'error') handlers.onError(d.message ?? 'stream error');
          } catch { /* skip malformed line */ }
          eventType = '';
        } else if (line === '') {
          eventType = '';
        }
      }
    };

    const reader = res.body?.getReader();
    if (!reader) {
      // No streaming body (older RN) — read whole response at once
      const text = await res.text();
      parseBlock(text);
      return;
    }

    const decoder = new TextDecoder();
    let buf = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lastNl = buf.lastIndexOf('\n');
        if (lastNl >= 0) {
          parseBlock(buf.slice(0, lastNl + 1));
          buf = buf.slice(lastNl + 1);
        }
      }
      if (buf) parseBlock(buf);
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') handlers.onError(String(e));
    }
  })();

  return ctrl;
}
