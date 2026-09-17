// Base URL driven by EXPO_PUBLIC_API_URL. Set it in your .env file:
//   iOS simulator  → EXPO_PUBLIC_API_URL=http://localhost:3000
//   Android emu    → EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
//   Physical device→ EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3000
//   Staging / prod → EXPO_PUBLIC_API_URL=https://api.evarna.app
// Development builds fall back to localhost:3000 when it is unset. Release
// builds never do: see API_MISCONFIGURED.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as streamingFetch } from 'expo/fetch';

// Inlined at bundle time: a build carries whatever was set when it was made.
const CONFIGURED_URL = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || undefined;

// Plain http can only work on the local network (the iOS app allows local
// networking and nothing else), so a Release build pointed at a dev machine is
// deliberate; public http never is. Keep in sync with src/checks/apiUrl.check.ts.
const USABLE_RELEASE_URL = /^(https:\/\/|http:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|[^/:]+\.local(:|\/|$)))/;

/**
 * True when a release build shipped without a usable API URL. The fallback to
 * localhost used to point every request at the phone itself, and the user only
 * ever saw "Couldn't sign you in". The shell checks this at startup and shows a
 * plain "this version can't connect" screen instead.
 */
export const API_MISCONFIGURED = !__DEV__ && !(CONFIGURED_URL && USABLE_RELEASE_URL.test(CONFIGURED_URL));
if (API_MISCONFIGURED) {
  console.warn(`[api] Release builds need EXPO_PUBLIC_API_URL set to an https URL (got ${CONFIGURED_URL ?? 'nothing'}).`);
}

export const BASE_URL = CONFIGURED_URL ?? (__DEV__ ? 'http://localhost:3000' : '');
export const API_BASE = `${BASE_URL}/api/v1`;

// localtunnel.me shows a browser-friendly warning page on first visit unless this
// header is sent. Safe to send always — backends ignore it.
const TUNNEL_HEADERS = { 'bypass-tunnel-reminder': 'true' };

// Long enough for a slow cellular round trip, short enough that a dead
// connection turns into "can't reach Evarna" instead of an endless spinner.
const REQUEST_TIMEOUT_MS = 20_000;
// Once a reply has started, this much silence means the connection is gone even
// if nothing said so. Android's native client has no read timeout of its own.
const STREAM_IDLE_MS = 45_000;

type ApiResponse<T> = { success: boolean; data: T };

// ── Auth token ─────────────────────────────────────────────────────────────
// Kept in memory (every request reads it synchronously) and mirrored to
// AsyncStorage so a relaunch stays signed in. loadAuthToken() rehydrates it.
const TOKEN_KEY = 'evarna_auth_token';
let authToken: string | null = null;
// Bumped on every setAuthToken, so a slow loadAuthToken() cannot overwrite a
// token that was set or cleared while it was reading storage.
let tokenEpoch = 0;

/** Non-2xx that isn't a session expiry. Carries the backend's `code` so callers
 *  can tell ALREADY_ONBOARDED / UNDER_MINIMUM_AGE apart from a generic failure. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    /**
     * The backend's own `error` string — a sentence written for the user. It
     * used to be parsed and thrown away, which is why `message` (a synthetic
     * "POST /x → 402 CODE" label) is the only thing screens could show.
     */
    readonly serverMessage?: string,
    /**
     * Which ceiling refused, when the server named one (usage.service.ts sends
     * `limit`). Concurrency is the only one a retry can fix, so the call screen
     * needs to tell it apart from the rest.
     */
    readonly limit?: string,
    /** Seconds until a retry can succeed, from the Retry-After header. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Thrown on a 401 that means the session is gone, so the UI can route back to
 * login. A wrong sign-in code (401 AUTH_FAILED) is an ApiError instead.
 */
export class AuthExpiredError extends Error {
  constructor(message = 'Session expired') {
    super(message);
    this.name = 'AuthExpiredError';
  }
}

/** The request never got an answer: offline, DNS, TLS, a dropped connection, or no reply in time. */
export class NetworkError extends Error {
  constructor(message: string, readonly timedOut = false, cause?: unknown) {
    super(message, { cause });
    this.name = 'NetworkError';
  }
}

/**
 * True for a failure that says nothing about the request itself, only that the
 * server could not be reached. Also accepts the SseErrorInfo a stream reports,
 * so chat can use the same test.
 */
export function isNetworkError(e: unknown): boolean {
  if (e instanceof NetworkError) return true;
  // Raw fetch failures from code that bypasses this client: RN's fetch rejects
  // with TypeError('Network request failed'), expo/fetch with 'fetch failed: …'.
  if (e instanceof Error) return /network request|^fetch failed/i.test(e.message);
  return (e as SseErrorInfo | null | undefined)?.code === 'NETWORK';
}

export function getAuthToken(): string | null {
  return authToken;
}

export function setAuthToken(t: string | null) {
  authToken = t;
  tokenEpoch++;
  // Fire-and-forget: the in-memory copy is what requests use, so a failed
  // write only costs the user a re-login after a cold start.
  (t ? AsyncStorage.setItem(TOKEN_KEY, t) : AsyncStorage.removeItem(TOKEN_KEY)).catch(() => {});
}

/** Read the persisted token into memory. Call once on app start, before any API call. */
export async function loadAuthToken(): Promise<string | null> {
  const epoch = tokenEpoch;
  const stored = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (epoch === tokenEpoch) authToken = stored;
  return authToken;
}

const authExpiredListeners = new Set<() => void>();

/**
 * Called when the signed-in session is rejected by the server (expired, or
 * revoked by signing out on another device). The router uses it to tear down
 * locally and show login. Returns an unsubscribe.
 */
export function subscribeAuthExpired(cb: () => void): () => void {
  authExpiredListeners.add(cb);
  return () => { authExpiredListeners.delete(cb); };
}

// Only the token a request actually carried can be declared dead, and only while
// it is still the current one. A request sent before sign-in finished (no
// token) used to wipe the token the boot check had just loaded; a late 401 for
// a previous account must not sign out the next one. Parallel 401s collapse
// into one notification, because the first clears the token.
function sessionExpired(sentToken: string | null) {
  if (!sentToken || sentToken !== authToken) return;
  setAuthToken(null);
  for (const cb of [...authExpiredListeners]) {
    try { cb(); } catch (e) { console.warn('[api] auth-expired listener threw:', e); }
  }
}

interface RefusalBody {
  error?: string;
  code?: string;
  /** Set by the usage ceilings: which one was hit. */
  limit?: string;
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

// Only the server saying the session is gone counts as expiry. The email-code
// route answers a wrong code with 401 AUTH_FAILED and a sentence for the user,
// which is not a reason to sign anyone out. A 401 without a readable body (a
// proxy) is treated as expiry only when a token was sent.
function refusal(res: Response, body: RefusalBody | null, label: string, sentToken: string | null): Error {
  if (res.status === 401 && (body?.code === 'UNAUTHENTICATED' || (!body?.code && sentToken))) {
    sessionExpired(sentToken);
    return new AuthExpiredError(`${label} → 401`);
  }
  return new ApiError(
    `${label} → ${res.status}${body?.code ? ` ${body.code}` : ''}`,
    res.status,
    body?.code,
    body?.error,
    body?.limit,
    retryAfterSeconds(res.headers.get('retry-after')),
  );
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const label = `${method} ${path}`;
  // Captured up front: the 401 rule needs the token this request carried, not
  // whichever one is current by the time the answer lands.
  const sentToken = authToken;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        ...TUNNEL_HEADERS,
        ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: ctrl.signal,
    });
    text = await res.text();
  } catch (e) {
    const timedOut = ctrl.signal.aborted;
    throw new NetworkError(`${label} ${timedOut ? 'timed out' : 'failed'}`, timedOut, e);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw refusal(res, parseJson(text) as RefusalBody | null, label, sentToken);
  if (!text) return undefined as T;
  const json = parseJson(text) as ApiResponse<T> | null;
  // A 2xx that isn't our JSON is a captive portal or a proxy page, not Evarna.
  if (!json || typeof json !== 'object') throw new NetworkError(`${label} → unreadable response`);
  return json.data;
}

export const apiGet = <T>(path: string): Promise<T> => request<T>('GET', path);

export const apiPost = <T>(path: string, body: unknown): Promise<T> => request<T>('POST', path, body);

export const apiPut = <T>(path: string, body: unknown): Promise<T> => request<T>('PUT', path, body);

export const apiPatch = <T>(path: string, body: unknown): Promise<T> => request<T>('PATCH', path, body);

// `body` is only sent when given — DELETE /users/me requires { confirm: 'DELETE' }.
export const apiDelete = <T>(path: string, body?: unknown): Promise<T> => request<T>('DELETE', path, body);

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

/**
 * Detail about a failed turn, as a second argument rather than a new handler so
 * the existing `(err) => …` implementations keep compiling: they simply ignore
 * it. The message string still carries the LIMIT: prefix above, so a caller can
 * use either — `limitMessage()` for wording, this for the code a screen needs
 * to branch on (the plan cap opens the paywall; an abuse ceiling does not).
 */
export interface SseErrorInfo {
  status?: number;
  /**
   * The server's refusal code, or one the client assigns:
   * 'UNAUTHENTICATED' (session gone; subscribeAuthExpired has fired),
   * 'NETWORK' (no connection, or no reply in time — see isNetworkError),
   * 'STREAM_ERROR' (the server failed mid-reply),
   * 'STREAM_INCOMPLETE' (the connection closed before the reply finished).
   */
  code?: string;
  /** The backend's user-facing sentence, when it sent one. */
  serverMessage?: string;
  /** Which usage ceiling refused, when the server named one. */
  limit?: string;
  /** Seconds until a retry can succeed, from the Retry-After header. */
  retryAfter?: number;
}

export interface SseHandlers {
  onChunk: (content: string) => void;
  onDone: (turnId: string) => void;
  /** The server's crisis response, which replaces the reply. */
  onCrisis: (content: string) => void;
  onError: (message: string, info?: SseErrorInfo) => void;
}

// Incremental parser for the named events the backend writes. Lines may arrive
// split across network reads, so the partial line and the pending event type
// survive between pushes; an event is dispatched on its terminating blank line.
function createSseParser(dispatch: (event: string, data: string) => void) {
  let partial = '';
  let event = '';
  let data: string[] = [];

  const line = (raw: string) => {
    const l = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (l === '') {
      if (data.length) dispatch(event, data.join('\n'));
      event = '';
      data = [];
      return;
    }
    const colon = l.indexOf(':');
    if (colon === 0) return; // comment / keep-alive
    const field = colon < 0 ? l : l.slice(0, colon);
    const value = colon < 0 ? '' : l.slice(colon + (l[colon + 1] === ' ' ? 2 : 1));
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  };

  return {
    push(text: string) {
      const lines = (partial + text).split('\n');
      partial = lines.pop() ?? '';
      lines.forEach(line);
    },
    // Lenient about a missing final blank line, so a `done` the server did send
    // still counts.
    end() {
      if (partial) line(partial);
      partial = '';
      line('');
    },
  };
}

const LF = 0x0a;

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/**
 * Stream a chat turn via SSE.
 * Returns an AbortController — call abort() to cancel mid-stream; an aborted
 * stream calls no further handlers.
 *
 * The backend emits named SSE events:
 *   event: chunk\ndata: {"content":"..."}\n\n
 *   event: done\ndata: {"turn_id":"..."}\n\n
 *   event: crisis\ndata: {"content":"..."}\n\n
 *   event: error\ndata: {"message":"..."}\n\n
 *
 * Every stream that is not aborted ends in exactly one of onDone, onCrisis or
 * onError. Chunks are coalesced to at most one onChunk per frame, and any
 * pending text is delivered before the terminal handler.
 */
export function streamConversation(
  payload: { session_id: string; message: string },
  handlers: SseHandlers,
): AbortController {
  const ctrl = new AbortController();
  // The network request has its own controller so a timeout can cancel it
  // without making the caller's controller look aborted.
  const net = new AbortController();
  const sentToken = authToken;

  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;
  let pending = '';
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  // A throw inside a screen's handler is that screen's bug: surface it as an
  // uncaught error instead of letting it read as a failed stream.
  const safely = (fn: () => void) => {
    try { fn(); } catch (e) { setTimeout(() => { throw e; }); }
  };

  const flushChunks = () => {
    if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
    if (!pending) return;
    const text = pending;
    pending = '';
    safely(() => handlers.onChunk(text));
  };

  // Real streaming delivers a token at a time; one render per frame is plenty.
  const chunk = (text: string) => {
    if (settled || !text) return;
    pending += text;
    if (frame === null) frame = requestAnimationFrame(() => { frame = null; flushChunks(); });
  };

  const stopNetwork = () => {
    net.abort();
    reader?.cancel().catch(() => {});
  };

  const settle = (report: () => void) => {
    if (settled) return;
    settled = true;
    if (timer) { clearTimeout(timer); timer = null; }
    if (ctrl.signal.aborted) {
      if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
      return;
    }
    flushChunks();
    safely(report);
  };

  const fail = (message: string, info: SseErrorInfo) => settle(() => handlers.onError(message, info));

  const armTimer = (ms: number) => {
    if (settled) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fail('timed out', { code: 'NETWORK' });
      stopNetwork();
    }, ms);
  };

  ctrl.signal.addEventListener('abort', () => {
    settle(() => {});
    stopNetwork();
  });

  const parser = createSseParser((event, raw) => {
    const d = parseJson(raw) as { content?: unknown; turn_id?: unknown; message?: unknown } | null;
    if (!d || typeof d !== 'object') return;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    if (event === 'chunk') chunk(str(d.content));
    else if (event === 'done') settle(() => handlers.onDone(str(d.turn_id)));
    else if (event === 'crisis') settle(() => handlers.onCrisis(str(d.content)));
    // The event's message can be a raw server exception, so it is not passed on
    // as serverMessage.
    else if (event === 'error') fail(str(d.message) || 'stream error', { code: 'STREAM_ERROR' });
  });

  (async () => {
    armTimer(REQUEST_TIMEOUT_MS);
    // RN's global fetch (whatwg-fetch) buffers the whole body and has no
    // `body` stream, so replies only appeared once fully generated.
    // expo/fetch streams natively.
    const res = await streamingFetch(`${API_BASE}/conversations/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...TUNNEL_HEADERS,
        ...(sentToken ? { Authorization: `Bearer ${sentToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: net.signal,
    });

    if (!res.ok) {
      const body = parseJson(await res.text()) as RefusalBody | null;
      if (res.status === 401) {
        sessionExpired(sentToken);
        fail('UNAUTHENTICATED', {
          status: 401,
          code: 'UNAUTHENTICATED',
          ...(body?.error ? { serverMessage: body.error } : {}),
        });
        return;
      }
      // The body used to be dropped entirely, so a refusal the server had
      // explained in words reached the screen as "HTTP 429" and was rendered as
      // a message from the companion. Both forms go out now: the prefixed
      // wording for callers that only take a string, and the code alongside it.
      const worded = body?.code && LIMIT_CODES.has(body.code) && body.error
        ? `${LIMIT_PREFIX}${body.error}`
        : `HTTP ${res.status}`;
      const retryAfter = retryAfterSeconds(res.headers.get('retry-after'));
      fail(worded, {
        status: res.status,
        ...(body?.code ? { code: body.code } : {}),
        ...(body?.error ? { serverMessage: body.error } : {}),
        ...(body?.limit ? { limit: body.limit } : {}),
        ...(retryAfter !== undefined ? { retryAfter } : {}),
      });
      return;
    }

    const body = res.body;
    if (!body) {
      // No stream to read (e.g. web). The whole reply arrives at once, and it
      // may legitimately take longer than the idle limit to generate.
      if (timer) { clearTimeout(timer); timer = null; }
      parser.push(await res.text());
    } else {
      reader = body.getReader();
      // TextDecoder comes from Expo's runtime (Hermes has none). Decoding only
      // up to the last newline byte keeps multi-byte characters whole: 0x0A
      // never occurs inside a UTF-8 sequence, and the SSE framing is by line.
      const decoder = new TextDecoder();
      let carry: Uint8Array | null = null;
      armTimer(STREAM_IDLE_MS);
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        armTimer(STREAM_IDLE_MS);
        const bytes: Uint8Array = carry ? concatBytes(carry, value) : value;
        const end = bytes.lastIndexOf(LF);
        if (end < 0) { carry = bytes; continue; }
        parser.push(decoder.decode(bytes.subarray(0, end + 1)));
        carry = end + 1 < bytes.length ? bytes.slice(end + 1) : null;
      }
      if (carry) parser.push(decoder.decode(carry));
    }
    parser.end();
    // A proxy cut or a server crash after the headers: without this the reply
    // would spin forever.
    fail('stream ended early', { code: 'STREAM_INCOMPLETE' });
  })().catch((e: unknown) => fail(String(e), { code: 'NETWORK' }));

  return ctrl;
}
