// Base URL driven by EXPO_PUBLIC_API_URL. Set it in your .env file:
//   iOS simulator  → EXPO_PUBLIC_API_URL=http://localhost:3000
//   Android emu    → EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
//   Physical device→ EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000
//   Staging / prod → EXPO_PUBLIC_API_URL=https://api.evarna.app
// Falls back to localhost:3000 if the variable is unset (simulator dev).
import AsyncStorage from '@react-native-async-storage/async-storage';

export const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
export const API_BASE = `${BASE_URL}/api/v1`;

// localtunnel.me shows a browser-friendly warning page on first visit unless this
// header is sent. Safe to send always — backends ignore it.
const TUNNEL_HEADERS = { 'bypass-tunnel-reminder': 'true' };

type ApiResponse<T> = { success: boolean; data: T };

// ── Auth token ─────────────────────────────────────────────────────────────
// Kept in memory (every request reads it synchronously) and mirrored to
// AsyncStorage so a relaunch stays signed in. loadAuthToken() rehydrates it.
const TOKEN_KEY = 'whisper_auth_token';
let authToken: string | null = null;

/** Non-2xx that isn't a 401. Carries the backend's `code` so callers can tell
 *  ALREADY_ONBOARDED / UNDER_MINIMUM_AGE apart from a generic failure. */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly serverMessage?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thrown on any 401 so the UI can route back to login instead of showing a generic failure. */
export class AuthExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(t: string | null) {
  authToken = t;
  // Fire-and-forget: the in-memory copy is what requests use, so a failed
  // write only costs the user a re-login after a cold start.
  (t ? AsyncStorage.setItem(TOKEN_KEY, t) : AsyncStorage.removeItem(TOKEN_KEY)).catch(() => {});
}

/** Read the persisted token into memory. Call once on app start, before any API call. */
export async function loadAuthToken(): Promise<string | null> {
  authToken = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  return authToken;
}

const authHeaders = (): Record<string, string> =>
  authToken ? { Authorization: `Bearer ${authToken}` } : {};

// 401 → the token is dead; drop it so nothing retries with it. Anything else
// non-2xx surfaces the backend's error code alongside the status.
async function assertOk(res: Response, label: string) {
  if (res.ok) return;
  if (res.status === 401) {
    setAuthToken(null);
    throw new AuthExpiredError(`${label} → 401`);
  }
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
  throw new ApiError(`${label} → ${res.status}${body?.code ? ` ${body.code}` : ''}`, res.status, body?.code, body?.error);
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { ...TUNNEL_HEADERS, ...authHeaders() } });
  await assertOk(res, `GET ${path}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS, ...authHeaders() },
    body: JSON.stringify(body),
  });
  await assertOk(res, `POST ${path}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS, ...authHeaders() },
    body: JSON.stringify(body),
  });
  await assertOk(res, `PUT ${path}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...TUNNEL_HEADERS, ...authHeaders() },
    body: JSON.stringify(body),
  });
  await assertOk(res, `PATCH ${path}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

// `body` is only sent when given — DELETE /users/me requires { confirm: 'DELETE' }.
export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: { ...TUNNEL_HEADERS, ...authHeaders(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  await assertOk(res, `DELETE ${path}`);
  const json = (await res.json()) as ApiResponse<T>;
  return json.data;
}

// Refusals the server words for the user. Everything else stays a generic
// "couldn't reach the server", because raw status text means nothing to anyone.
const LIMIT_CODES = new Set(['USAGE_LIMIT_REACHED', 'COMPANION_LIMIT_REACHED', 'STUDIO_LIMIT_REACHED']);
const LIMIT_PREFIX = 'LIMIT: ';

/** The server's own message when `e` is a usage limit, otherwise null. */
export function limitMessage(e: unknown): string | null {
  if (e instanceof ApiError) return e.code && LIMIT_CODES.has(e.code) ? e.serverMessage ?? null : null;
  if (typeof e === 'string' && e.startsWith(LIMIT_PREFIX)) return e.slice(LIMIT_PREFIX.length);
  return null;
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
  payload: { session_id: string; message: string },
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
          ...authHeaders(),
        },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
    } catch (e: unknown) {
      if ((e as Error)?.name !== 'AbortError') handlers.onError(String(e));
      return;
    }

    // ponytail: SSE reports auth failure as a plain message rather than AuthExpiredError
    // (handlers only take strings). Widen SseHandlers if chat needs to auto-route to login.
    if (res.status === 401) { setAuthToken(null); handlers.onError('UNAUTHENTICATED'); return; }
    if (!res.ok) {
      // A limit is refused as JSON before the stream starts; pass its wording on.
      const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
      handlers.onError(body?.code && LIMIT_CODES.has(body.code) && body.error ? `${LIMIT_PREFIX}${body.error}` : `HTTP ${res.status}`);
      return;
    }

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
