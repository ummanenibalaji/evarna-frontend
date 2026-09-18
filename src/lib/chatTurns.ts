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
 *   unsent       a user message the server didn't take (or, with `unsure`,
 *                may have taken); Retry sends it again, checking first when
 *                unsure
 *   dropped      the connection went after the server had the message; the
 *                server finishes and saves the reply anyway, so Reload fetches
 *                it (and, once a Reload comes back empty, Retry asks again)
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
  /** Unsent, but the server may have it after all (the answer never came
   *  back): Retry checks the history before sending it again. */
  unsure?: boolean;
  /** A Reload or a Retry's check is under way for this exchange. */
  checking?: boolean;
  /** A Reload came back without this reply, so Retry is offered beside it. */
  missing?: boolean;
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
  /** Set by the server's moderation on the user turn; the reply after a
   *  crisis turn is the server's crisis response. */
  safety_flags?: { is_crisis?: boolean } | null;
}

export interface HistorySession {
  id: string;
  voice: boolean;
  turns: HistoryTurn[];
}

/**
 * Every session's turns as one chronological thread, newest `cap` kept. The
 * backend writes a user turn and its reply in one insert, so they can share a
 * timestamp; the question still goes first. The reply to a turn the server
 * flagged as a crisis is marked, so its support card survives a reload.
 */
export function historyFromSessions(sessions: HistorySession[], cap = Infinity): ChatMsg[] {
  const rows: { msg: ChatMsg; order: number }[] = [];
  let order = 0;
  for (const s of sessions) {
    let crisisNext = false;
    for (const t of s.turns) {
      const at = Date.parse(t.created_at);
      const comp = t.role === 'assistant';
      const crisis = comp && crisisNext;
      crisisNext = comp ? false : !!t.safety_flags?.is_crisis;
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
          ...(crisis ? { crisis: true } : null),
        },
      });
    }
  }
  rows.sort((a, b) =>
    a.msg.at - b.msg.at
    || (a.msg.session === b.msg.session && a.msg.from !== b.msg.from ? (a.msg.from === 'user' ? -1 : 1) : 0)
    || a.order - b.order);
  return (rows.length > cap ? rows.slice(-cap) : rows).map(r => r.msg);
}

/**
 * Device and server clocks disagree a little. A message sent during this
 * visit is looked for among server turns from this long before its send.
 */
export const CLOCK_SKEW_MS = 2 * 60 * 1000;

/**
 * Where matching by words may start: after the newest turn already merged
 * (server time), or, before any history has loaded this visit, a little
 * before the visit's first send (device time). Null matches nothing.
 */
export function matchSince(knownUntil: number | null, firstSendAt: number | null): number | null {
  if (knownUntil != null) return knownUntil;
  return firstSendAt != null ? firstSendAt - CLOCK_SKEW_MS : null;
}

/**
 * Which of this visit's exchanges the server history already holds. By id
 * when the reply reported one; otherwise by the user's words, among user turns
 * after `since` that nothing on screen accounts for yet.
 */
export function confirmedExchanges(
  history: ChatMsg[], current: ChatMsg[], since: number | null,
): { confirmed: Set<string>; crisisAfter: Set<string> } {
  const ids = new Set(history.map(m => m.id));
  const confirmed = new Set<string>();
  const crisisAfter = new Set<string>();

  const shownTurns = new Set<string>();
  for (const m of current) {
    if (m.turnId) shownTurns.add(m.turnId);
    if (!m.local) shownTurns.add(m.id);
    if (m.local && m.pair && m.from === 'comp' && m.turnId && ids.has(m.turnId)) confirmed.add(m.pair);
  }

  if (since == null) return { confirmed, crisisAfter };

  // A server user turn is already accounted for when it is on screen itself,
  // or its reply is (by turn id): "ok" answered earlier must not be taken for
  // a later "ok" whose reply dropped.
  const claimed = new Set<string>();
  const askedIn = new Map<string, string>();
  for (const h of history) {
    const session = h.session ?? '';
    if (h.from === 'user') {
      askedIn.set(session, h.id);
      if (shownTurns.has(h.id)) claimed.add(h.id);
    } else if (h.from === 'comp') {
      const asked = askedIn.get(session);
      if (asked && shownTurns.has(h.id)) claimed.add(asked);
      askedIn.delete(session);
    }
  }

  // Exchanges the server surely took are matched first, in order; a message
  // that may not have gone (`unsure`) only gets a server turn left over, so a
  // repeated "hey" can't take the copy of the one that did go. A message the
  // server refused is never matched.
  const waves = [
    current.filter(m => m.from === 'user' && !m.failed),
    current.filter(m => m.from === 'user' && m.failed === 'unsent' && m.unsure),
  ];
  for (const wave of waves) {
    for (const m of wave) {
      if (!m.local || !m.pair || confirmed.has(m.pair)) continue;
      // The server saves the question and its reply together once the reply
      // is finished, so a match for an exchange still marked streaming means
      // the server finished it: its stream is gone quiet (the phone slept, the
      // app was in the background) and the saved copy is the whole reply.
      const reply = current.find(x => x.pair === m.pair && x.from === 'comp');
      const text = m.text.trim();
      const match = history.find(h => h.from === 'user' && h.at > since && !claimed.has(h.id) && h.text.trim() === text);
      if (!match) continue;
      claimed.add(match.id);
      confirmed.add(m.pair);
      if (reply?.crisis) crisisAfter.add(match.id);
    }
  }
  return { confirmed, crisisAfter };
}

/**
 * Lays fresh server history under what this visit added.
 *
 * Everything that came from the server before is replaced. A local exchange is
 * dropped once the server has it (see confirmedExchanges; `since` comes from
 * matchSince). Anything still in flight or failed stays, as do notices.
 */
export function mergeHistory(history: ChatMsg[], current: ChatMsg[], since: number | null): ChatMsg[] {
  const ids = new Set(history.map(m => m.id));
  const { confirmed, crisisAfter } = confirmedExchanges(history, current, since);

  // A crisis reply keeps its resources when the server's copy replaces it.
  let base = history;
  if (crisisAfter.size) {
    base = history.map((m, i) => {
      const prev = history[i - 1];
      return m.from === 'comp' && !m.crisis && prev && crisisAfter.has(prev.id) ? { ...m, crisis: true } : m;
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
    const {
      local: _local, pair: _pair, note: _note, unsure: _unsure, checking: _checking, missing: _missing, ...rest
    } = m;
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

// Formatting a date is one of the costlier things JS can ask of iOS: every
// toLocale*String call with options builds a new formatter. These are built
// once, on first use, and every label and day boundary is remembered, so a
// thread re-laid out after a send formats only the stamps it hasn't seen.
let timeFmt: Intl.DateTimeFormat | null = null;
let weekdayFmt: Intl.DateTimeFormat | null = null;
let dateFmt: Intl.DateTimeFormat | null = null;
let dateYearFmt: Intl.DateTimeFormat | null = null;
const fmtTime = (d: Date) => (timeFmt ??= new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })).format(d);
const fmtWeekday = (d: Date) => (weekdayFmt ??= new Intl.DateTimeFormat(undefined, { weekday: 'long' })).format(d);
const fmtDate = (d: Date, withYear: boolean) => (withYear
  ? (dateYearFmt ??= new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))
  : (dateFmt ??= new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))
).format(d);

// Bounded, so a long session can't grow them without limit.
const CACHE_MAX = 4000;
const dayStarts = new Map<number, number>();
const labels = new Map<string, string>();

const startOfDay = (t: number) => {
  const hit = dayStarts.get(t);
  if (hit !== undefined) return hit;
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  if (dayStarts.size >= CACHE_MAX) dayStarts.clear();
  dayStarts.set(t, d.getTime());
  return d.getTime();
};

/** "Today 9:41 PM", "Yesterday 8:02 PM", "Monday 7:15 PM", "Mon 12 Sep, 7:15 PM". */
export function stampLabel(at: number, now: number): string {
  const today = startOfDay(now);
  const key = `${at}|${today}`;
  const hit = labels.get(key);
  if (hit !== undefined) return hit;
  const d = new Date(at);
  const time = fmtTime(d);
  const days = Math.round((today - startOfDay(at)) / DAY_MS);
  let label: string;
  if (days <= 0) label = `Today ${time}`;
  else if (days === 1) label = `Yesterday ${time}`;
  else if (days < 7) label = `${fmtWeekday(d)} ${time}`;
  else label = `${fmtDate(d, d.getFullYear() !== new Date(now).getFullYear())}, ${time}`;
  if (labels.size >= CACHE_MAX) labels.clear();
  labels.set(key, label);
  return label;
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
      if (!timed || m.at - timed.at >= STAMP_GAP_MS || startOfDay(timed.at) !== startOfDay(m.at)) {
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
