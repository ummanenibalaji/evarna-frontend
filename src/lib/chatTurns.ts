/**
 * Pure chat-thread logic: undoing refused turns, merging server history with
 * what was sent during this visit, and laying a thread out with time stamps.
 *
 * No React and no network here, so check scripts can import it under plain
 * node.
 */

// ─── Undoing an optimistically-shown turn ─────────────────────────────────
/**
 * When the server refuses a message (the daily cap), the two bubbles the screen
 * already added have to come off: the streaming placeholder and the user's own
 * line. Removing them by matching TEXT deletes every earlier bubble that
 * happens to say the same thing — and "ok", "hey" and "thanks" get said a lot,
 * in a transcript loaded from the backend. So pop from the end instead.
 */
export interface OptimisticTurn {
  from: string;
  text?: string;
  streaming?: boolean;
}

export function dropRefusedTurn<T extends OptimisticTurn>(msgs: T[], sentText: string): T[] {
  const out = [...msgs];
  if (out[out.length - 1]?.streaming) out.pop();
  const last = out[out.length - 1];
  if (last && last.from === 'user' && last.text === sentText) out.pop();
  return out;
}

/**
 * Hand back what they typed — but never over the top of something newer. Losing
 * a sentence someone wrote is the worst way to tell them about a limit, and
 * overwriting the sentence they wrote while waiting is a close second.
 */
export const restoreDraft = (current: string, sentText: string): string =>
  current.trim() ? current : sentText;

// ─── Thread messages ──────────────────────────────────────────────────────
export type ChatFrom = 'user' | 'comp' | 'notice';

/**
 * Why a line did not complete.
 *   unsent       a user message the server never took; Retry sends it again
 *   dropped      the connection went mid-reply; the server finishes and saves
 *                the reply anyway, so Reload fetches it
 *   interrupted  the server itself failed mid-reply and saved nothing; Retry
 */
export type ChatFailure = 'unsent' | 'dropped' | 'interrupted';

export interface ChatMsg {
  /** Stable key: the backend turn id for history, a client id for this visit.
   *  It never changes once rendered, so a bubble never remounts. */
  id: string;
  from: ChatFrom;
  text: string;
  /** Epoch ms: server time for history, device time for this visit. */
  at: number;
  /** Backend assistant turn id — what a content report points at. */
  turnId?: string;
  /** Sent during this visit. Animates in, and survives a history refresh
   *  until the server is known to have it. */
  local?: boolean;
  /** Links a user message to the reply it asked for. */
  pair?: string;
  streaming?: boolean;
  failed?: ChatFailure;
  /** Plain words for a failed send ("you're offline"), shown under it. */
  note?: string;
  /** The server's crisis response; support resources are shown after it. */
  crisis?: boolean;
  /** History only: the session this turn belongs to, and whether it was a call. */
  session?: string;
  voice?: boolean;
  memoryRefs?: string[];
}

/** Returns a new list with message `id` changed, or the same list if it is gone. */
export function patchMsg(msgs: ChatMsg[], id: string, patch: Partial<ChatMsg> | ((m: ChatMsg) => ChatMsg)): ChatMsg[] {
  const i = msgs.findIndex(m => m.id === id);
  if (i < 0) return msgs;
  const out = [...msgs];
  out[i] = typeof patch === 'function' ? patch(out[i]) : { ...out[i], ...patch };
  return out;
}

// ─── History ──────────────────────────────────────────────────────────────
export interface HistoryTurn {
  _id: string;
  role: 'user' | 'assistant';
  content_text: string;
  created_at: string;
}

export interface HistorySession {
  id: string;
  voice: boolean;
  turns: HistoryTurn[];
}

/**
 * Every session's turns as one chronological thread, newest `cap` kept. The
 * backend writes a user turn and its reply in one insert, so they can share a
 * timestamp; the question still goes first.
 */
export function historyFromSessions(sessions: HistorySession[], cap: number): ChatMsg[] {
  const rows: { msg: ChatMsg; order: number }[] = [];
  let order = 0;
  for (const s of sessions) {
    for (const t of s.turns) {
      const at = Date.parse(t.created_at);
      const comp = t.role === 'assistant';
      rows.push({
        order: order++,
        msg: {
          id: t._id,
          from: comp ? 'comp' : 'user',
          text: t.content_text,
          at: Number.isNaN(at) ? 0 : at,
          ...(comp ? { turnId: t._id } : null),
          session: s.id,
          ...(s.voice ? { voice: true } : null),
        },
      });
    }
  }
  rows.sort((a, b) =>
    a.msg.at - b.msg.at
    || (a.msg.session === b.msg.session && a.msg.from !== b.msg.from ? (a.msg.from === 'user' ? -1 : 1) : 0)
    || a.order - b.order);
  return rows.slice(-cap).map(r => r.msg);
}

/**
 * Lays fresh server history under what this visit added.
 *
 * Everything that came from the server before is replaced. A local exchange is
 * dropped once the server has it: its reply's turn id is in the history, or —
 * for a reply that never reported an id (the connection dropped, or it was a
 * crisis response) — a user turn with the same words appeared since the last
 * load (`knownUntil`, server time; null on the first load, when nothing is
 * matched by words). Anything still in flight or failed stays, as do notices.
 */
export function mergeHistory(history: ChatMsg[], current: ChatMsg[], knownUntil: number | null): ChatMsg[] {
  const ids = new Set(history.map(m => m.id));
  const confirmed = new Set<string>();
  const crisisAfter = new Set<string>();

  for (const m of current) {
    if (m.local && m.pair && m.from === 'comp' && m.turnId && ids.has(m.turnId)) confirmed.add(m.pair);
  }

  if (knownUntil != null) {
    const claimed = new Set<string>();
    for (const m of current) {
      if (!m.local || !m.pair || m.from !== 'user' || m.failed || confirmed.has(m.pair)) continue;
      // The server writes the question and its reply together, at the end, so
      // an exchange still streaming cannot be in the history yet.
      const reply = current.find(x => x.pair === m.pair && x.from === 'comp');
      if (reply?.streaming) continue;
      const text = m.text.trim();
      const match = history.find(h => h.from === 'user' && h.at > knownUntil && !claimed.has(h.id) && h.text.trim() === text);
      if (!match) continue;
      claimed.add(match.id);
      confirmed.add(m.pair);
      if (reply?.crisis) crisisAfter.add(match.id);
    }
  }

  // A crisis reply keeps its resources when the server's copy replaces it.
  let base = history;
  if (crisisAfter.size) {
    base = history.map((m, i) => {
      const prev = history[i - 1];
      return m.from === 'comp' && prev && crisisAfter.has(prev.id) ? { ...m, crisis: true } : m;
    });
  }

  const kept = current.filter(m =>
    m.local
    && !(m.pair && confirmed.has(m.pair))
    && !(m.from === 'comp' && m.turnId && ids.has(m.turnId)));
  return kept.length ? [...base, ...kept] : base;
}

/** The server-known part of a thread, for the cache: nothing in flight or failed. */
export function settledThread(msgs: ChatMsg[]): ChatMsg[] {
  const out: ChatMsg[] = [];
  for (const m of msgs) {
    if (m.from === 'notice' || m.streaming || m.failed) continue;
    const { local: _local, pair: _pair, note: _note, ...rest } = m;
    out.push(rest);
  }
  return out;
}

// ─── Layout ───────────────────────────────────────────────────────────────
export type ThreadRow =
  | { kind: 'stamp'; key: string; label: string }
  | { kind: 'voice'; key: string }
  | { kind: 'msg'; key: string; msg: ChatMsg; grouped: boolean };

/** A new time stamp opens the thread, each new day, and any gap this long. */
const STAMP_GAP_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today 9:41 PM", "Yesterday 8:02 PM", "Monday 7:15 PM", "Mon 12 Sep, 7:15 PM". */
export function stampLabel(at: number, now: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY_MS);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} ${time}`;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  const date = d.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? null : { year: 'numeric' }),
  });
  return `${date}, ${time}`;
}

/**
 * The thread as rows: a stamp wherever the day changes or an hour has passed,
 * a "voice call" marker where a call's transcript begins, and each message
 * flagged `grouped` when it continues the same speaker's run.
 */
export function buildRows(msgs: ChatMsg[], now: number): ThreadRow[] {
  const rows: ThreadRow[] = [];
  // The last message that carried a time (notices don't), and the row above.
  let timed: ChatMsg | null = null;
  let above: ChatMsg | null = null;
  for (const m of msgs) {
    let broke = false;
    if (m.from !== 'notice' && m.at > 0) {
      if (!timed || startOfDay(timed.at) !== startOfDay(m.at) || m.at - timed.at >= STAMP_GAP_MS) {
        rows.push({ kind: 'stamp', key: `stamp-${m.id}`, label: stampLabel(m.at, now) });
        broke = true;
      }
      if (m.voice && m.session && timed?.session !== m.session) {
        rows.push({ kind: 'voice', key: `voice-${m.id}` });
        broke = true;
      }
      timed = m;
    }
    const grouped = !broke && above?.from === m.from && m.from !== 'notice';
    rows.push({ kind: 'msg', key: m.id, msg: m, grouped });
    above = m;
  }
  return rows;
}
