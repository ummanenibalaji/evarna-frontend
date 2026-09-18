/**
 * A companion's saved conversation, fetched newest first and only as far back
 * as someone reads.
 *
 * The backend keeps turns per session: sessions come newest first, a session's
 * turns oldest first in pages of at most 100. The thread used to ask for ten
 * sessions and every one's first page at once — eleven requests and up to a
 * thousand turns to show 150, and, because the first page of a session is its
 * OLDEST, a long session came back without its end. Here:
 *
 *   initial()   the session list, then the newest sessions (a few at a time,
 *               in parallel) until a screenful of turns is in hand; a session
 *               longer than a page is read from its last page
 *   older()     the next screenful back, when the reader scrolls up there
 *   refresh()   only what is new: the newest session again, and any session
 *               started since, in one round trip in the usual case
 *
 * The thread it hands out is always contiguous: a session is only shown once
 * every newer session is complete, and a session's pages only from its end
 * back without holes. A request that fails leaves the thread as it was up to
 * that point, and the next call tries it again.
 *
 * Uses the existing endpoints (`page`/`limit` are already accepted); no React.
 */

import { apiGet } from '../api/client';
import { historyFromSessions, type ChatMsg, type HistorySession, type HistoryTurn } from './chatTurns';

/** The largest page the turns endpoint serves. */
const TURN_PAGE = 100;
/** Sessions per list request; an empty or check-in-only session is cheap. */
const SESSION_PAGE = 10;
/** Sessions fetched together while filling a screen. */
const WAVE = 3;
/** Rounds of requests one fill may take, so a run of empty sessions can't loop on. */
const MAX_ROUNDS = 4;
/** Turns worth having: the first screen plus a little scrolling. */
export const SCREENFUL = 40;
/** A session that appeared since the last look is read whole; past this many
 *  pages the thread is simply reloaded from the newest end instead. */
const MAX_NEW_PAGES = 5;

interface Paging { total?: number; has_more?: boolean }
interface SessionDoc { _id: string; session_type?: string; status?: string; ended_at?: string | null }

/** Still taking turns when last listed (or never listed: a session named by a push). */
const isOpen = (s: SessionDoc) => s.status === 'active' || (!s.status && !s.ended_at);
/** Known sessions re-read by one refresh, newest first. */
const MAX_GROWING = 4;

interface Loaded {
  id: string;
  voice: boolean;
  /** Turns the server reported for this session. */
  total: number;
  /** Fetched pages (1 = oldest). */
  pages: Map<number, HistoryTurn[]>;
  /** The lowest page shown; every page from here to the last is loaded. */
  low: number;
}

export interface HistoryResult {
  ok: boolean;
  /** What went wrong, when not ok (for isNetworkError). */
  error?: unknown;
  /** Something the thread shows changed. */
  changed: boolean;
}

export interface ChatHistory {
  /** The loaded thread, oldest first. */
  thread(): ChatMsg[];
  /** True once a load has succeeded, so later visits can refresh instead. */
  loaded(): boolean;
  /** Older turns remain on the server. */
  hasOlder(): boolean;
  initial(): Promise<HistoryResult>;
  older(): Promise<HistoryResult>;
  /** `hint`: a session likely to hold what's new (one a push named, or this
   *  visit's own), fetched alongside the list when it isn't known yet. */
  refresh(hint?: string): Promise<HistoryResult>;
}

const lastPage = (total: number) => Math.max(1, Math.ceil(total / TURN_PAGE));
const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

async function sessionsPage(characterId: string, page: number): Promise<{ sessions: SessionDoc[]; more: boolean }> {
  const r = await apiGet<{ sessions?: SessionDoc[]; pagination?: Paging }>(
    `/sessions/character/${characterId}?limit=${SESSION_PAGE}&page=${page}`,
  );
  const sessions = r.sessions ?? [];
  return { sessions, more: r.pagination?.has_more ?? sessions.length === SESSION_PAGE };
}

async function turnsPage(sessionId: string, page: number): Promise<{ turns: HistoryTurn[]; total: number }> {
  const r = await apiGet<{ turns?: HistoryTurn[]; pagination?: Paging }>(
    `/conversations/${sessionId}?limit=${TURN_PAGE}&page=${page}`,
  );
  const turns = r.turns ?? [];
  return { turns, total: r.pagination?.total ?? (page - 1) * TURN_PAGE + turns.length };
}

/** A session read from its end: one request, or two when it is longer than a page. */
async function fetchTail(s: SessionDoc): Promise<Loaded> {
  const first = await turnsPage(s._id, 1);
  const rec: Loaded = {
    id: s._id, voice: s.session_type === 'voice_call', total: first.total, pages: new Map([[1, first.turns]]), low: 1,
  };
  const tail = lastPage(first.total);
  if (tail > 1) {
    // Page 1 is the session's start; the thread wants its end. Page 1 is kept
    // for when scrolling reaches it.
    const t = await turnsPage(s._id, tail);
    rec.pages.set(tail, t.turns);
    rec.total = Math.max(rec.total, t.total);
    rec.low = tail;
  }
  return rec;
}

/** A session read whole (one that appeared since the last look). */
async function fetchWhole(s: SessionDoc): Promise<Loaded> {
  const first = await turnsPage(s._id, 1);
  const tail = lastPage(first.total);
  if (tail > MAX_NEW_PAGES) throw new TooMuchNew();
  const rest = await Promise.all(range(2, tail).map(p => turnsPage(s._id, p)));
  const pages = new Map([[1, first.turns]]);
  rest.forEach((r, i) => pages.set(i + 2, r.turns));
  return { id: s._id, voice: s.session_type === 'voice_call', total: first.total, pages, low: 1 };
}

/** A known session's newest turns again: its last page, and any page it grew into. */
async function fetchGrowth(rec: Loaded): Promise<Loaded> {
  const start = lastPage(rec.total);
  const first = await turnsPage(rec.id, start);
  const pages = new Map(rec.pages);
  pages.set(start, first.turns);
  const tail = lastPage(first.total);
  if (tail - start > MAX_NEW_PAGES) throw new TooMuchNew();
  const rest = await Promise.all(range(start + 1, tail).map(p => turnsPage(rec.id, p)));
  rest.forEach((r, i) => pages.set(start + 1 + i, r.turns));
  return { ...rec, total: Math.max(first.total, ...rest.map(r => r.total)), pages };
}

class TooMuchNew extends Error {
  constructor() { super('too much new history'); }
}

const turnsShown = (rec: Loaded) => {
  let n = 0;
  for (let p = rec.low; p <= lastPage(rec.total); p++) n += rec.pages.get(p)?.length ?? 0;
  return n;
};

/** Pages already fetched just below the shown ones join the thread at once. */
const absorbHeld = (rec: Loaded) => {
  while (rec.low > 1 && rec.pages.has(rec.low - 1)) rec.low--;
};

export function createChatHistory(characterId: string): ChatHistory {
  // Sessions seen, newest first; the first `shown` are in the thread, and only
  // the last of those may be partly loaded.
  let list: SessionDoc[] = [];
  let listPage = 0;
  let listMore = true;
  let shown = 0;
  const loaded = new Map<string, Loaded>();
  let everLoaded = false;
  let version = 0;
  let cached: { version: number; thread: ChatMsg[] } | null = null;

  // One operation at a time: each reads and writes the state above.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const run = queue.then(op, op);
    queue = run.catch(() => {});
    return run;
  };

  const reset = () => {
    list = [];
    listPage = 0;
    listMore = true;
    shown = 0;
    loaded.clear();
    version++;
  };

  const addToList = (sessions: SessionDoc[]) => {
    // A session started meanwhile shifts later pages by one; skip repeats.
    const seen = new Set(list.map(s => s._id));
    for (const s of sessions) if (!seen.has(s._id)) list.push(s);
  };

  /** Brings more of the past into the thread, about `target` turns' worth. */
  const fill = async (target: number): Promise<HistoryResult & { added: number }> => {
    let added = 0;
    let changed = false;
    let failure: unknown;
    for (let round = 0; round < MAX_ROUNDS && added < target; round++) {
      // The oldest shown session is finished first, a page at a time.
      const edge = shown ? loaded.get(list[shown - 1]._id) : undefined;
      if (edge && edge.low > 1) {
        const p = edge.low - 1;
        try {
          if (!edge.pages.has(p)) edge.pages.set(p, (await turnsPage(edge.id, p)).turns);
        } catch (e) {
          failure = e;
          break;
        }
        const before = turnsShown(edge);
        edge.low = p;
        absorbHeld(edge);
        added += turnsShown(edge) - before;
        changed = true;
        continue;
      }

      if (shown >= list.length) {
        if (!listMore) break;
        try {
          const next = await sessionsPage(characterId, listPage + 1);
          listPage++;
          listMore = next.more && next.sessions.length > 0;
          addToList(next.sessions);
        } catch (e) {
          failure = e;
          break;
        }
        continue;
      }

      const wave = list.slice(shown, shown + WAVE).filter(s => !loaded.has(s._id));
      const got = await Promise.allSettled(wave.map(fetchTail));
      got.forEach((r, i) => {
        if (r.status === 'fulfilled') loaded.set(wave[i]._id, r.value);
        else failure ??= r.reason;
      });
      // Shown in order, and only after the session before is complete: a
      // failed one stops the thread there until it loads.
      let progressed = false;
      while (shown < list.length) {
        const rec = loaded.get(list[shown]._id);
        const prev = shown ? loaded.get(list[shown - 1]._id) : undefined;
        if (!rec || (prev && prev.low > 1)) break;
        absorbHeld(rec);
        shown++;
        added += turnsShown(rec);
        progressed = true;
        changed = true;
      }
      if (!progressed) break;
    }
    if (changed) version++;
    // What arrived counts even when a later request failed; the failure only
    // matters when nothing did.
    const ok = changed || failure === undefined;
    return ok ? { ok, changed, added } : { ok, changed, added, error: failure };
  };

  const initial = () => serial(async (): Promise<HistoryResult> => {
    // A reload that fails keeps what was already there.
    const before = { list, listPage, listMore, shown, loaded: new Map(loaded) };
    const restore = () => {
      ({ list, listPage, listMore, shown } = before);
      loaded.clear();
      before.loaded.forEach((v, k) => loaded.set(k, v));
      version++;
    };
    reset();
    let first: { sessions: SessionDoc[]; more: boolean };
    try {
      first = await sessionsPage(characterId, 1);
    } catch (e) {
      restore();
      return { ok: false, changed: false, error: e };
    }
    listPage = 1;
    listMore = first.more;
    addToList(first.sessions);
    const r = await fill(SCREENFUL);
    if (!r.ok) {
      restore();
      return { ok: false, changed: false, error: r.error };
    }
    everLoaded = true;
    // A rebuilt thread always counts as changed.
    return { ok: true, changed: true };
  });

  // A run of empty sessions can end a fill with nothing to show; the list
  // only asks again when its content changes, so keep going a little.
  const older = () => serial(async (): Promise<HistoryResult> => {
    let changed = false;
    for (let i = 0; i < 3; i++) {
      const r = await fill(SCREENFUL);
      changed ||= r.changed;
      // Empty sessions change what's loaded but add nothing to see.
      if (!r.ok) return changed ? { ok: true, changed } : { ok: false, changed, error: r.error };
      if (r.added > 0 || !hasOlder()) break;
    }
    return { ok: true, changed };
  });

  const refreshNow = async (hint?: string): Promise<HistoryResult> => {
    const newest = shown ? loaded.get(list[0]._id) : undefined;
    if (!newest) return { ok: false, changed: false, error: new Error('nothing loaded') };

    // Sessions that may have grown are read again: the newest, the one named
    // (usually this visit's own), and any still open when last listed. A text
    // session stays open across a call made from it, and the call's session
    // then comes first, so the newest alone isn't enough.
    const growing = list.slice(0, shown)
      .filter((s, i) => i === 0 || s._id === hint || isOpen(s))
      .slice(0, MAX_GROWING)
      .map(s => loaded.get(s._id))
      .filter((r): r is Loaded => !!r);
    // A session named that isn't known yet is fetched alongside the list.
    const hinted = hint && !list.some(s => s._id === hint) ? hint : undefined;
    // All at once: the list, the named session and the growing ones.
    const grownP = Promise.allSettled(growing.map(fetchGrowth));
    const [head, early] = await Promise.allSettled([
      sessionsPage(characterId, 1),
      hinted ? fetchWhole({ _id: hinted }) : Promise.resolve(null),
    ]);
    const grown = await grownP;
    if (head.status === 'rejected') return { ok: false, changed: false, error: head.reason };
    for (const g of grown) {
      if (g.status === 'fulfilled') continue;
      if (g.reason instanceof TooMuchNew) throw g.reason;
      // A session left stale would hide a gap in the middle of the thread.
      return { ok: false, changed: false, error: g.reason };
    }

    // New sessions sit before the newest known one in the list.
    const known = head.value.sessions.findIndex(s => s._id === newest.id);
    if (known < 0) {
      // More new sessions than one page holds (or the newest was removed):
      // start again from the newest end.
      throw new TooMuchNew();
    }
    const fresh = head.value.sessions.slice(0, known);
    const got = await Promise.allSettled(fresh.map(s => {
      if (early.status === 'fulfilled' && early.value?.id === s._id) {
        return Promise.resolve({ ...early.value, voice: s.session_type === 'voice_call' });
      }
      return fetchWhole(s);
    }));
    if (got.some(r => r.status === 'rejected' && r.reason instanceof TooMuchNew)) throw new TooMuchNew();

    let changed = false;
    grown.forEach((g, i) => {
      if (g.status !== 'fulfilled') return;
      const before = growing[i];
      if (turnsShown(g.value) !== turnsShown(before) || lastPage(g.value.total) !== lastPage(before.total)) changed = true;
      loaded.set(before.id, g.value);
    });
    // What the list says now (open or ended) for the sessions it shows.
    const latest = new Map(head.value.sessions.map(s => [s._id, s]));
    list = list.map(s => latest.get(s._id) ?? s);

    // Added from the oldest new session forward; one that failed stops the
    // rest, which are picked up by the next refresh.
    const added: SessionDoc[] = [];
    let failure: unknown;
    for (let i = fresh.length - 1; i >= 0; i--) {
      const r = got[i];
      if (r.status === 'rejected') {
        failure = r.reason;
        break;
      }
      loaded.set(fresh[i]._id, r.value);
      added.unshift(fresh[i]);
    }
    if (added.length) {
      list = [...added, ...list];
      shown += added.length;
      changed = true;
    }
    if (changed) version++;
    return failure === undefined ? { ok: true, changed } : { ok: true, changed, error: failure };
  };

  // One refresh at a time. Asked for again while one runs (a push landing
  // during a resume refresh), one more follows it, so what the later ask was
  // about isn't answered with the earlier result.
  let running: Promise<HistoryResult> | null = null;
  let following: Promise<HistoryResult> | null = null;
  let followingHint: string | undefined;
  const runRefresh = (hint?: string): Promise<HistoryResult> => {
    const run = serial(async () => {
      if (!everLoaded || !shown) return null;
      try {
        return await refreshNow(hint);
      } catch (e) {
        if (!(e instanceof TooMuchNew)) return { ok: false, changed: false, error: e };
        return null;
      }
    }).then(r => r ?? initial());
    running = run;
    const done = () => { if (running === run) running = null; };
    run.then(done, done);
    return run;
  };
  const refresh = (hint?: string): Promise<HistoryResult> => {
    if (!running) return runRefresh(hint);
    if (hint) followingHint = hint;
    if (!following) {
      following = running.catch(() => null).then(() => {
        const h = followingHint;
        following = null;
        followingHint = undefined;
        return runRefresh(h);
      });
    }
    return following;
  };

  const thread = () => {
    if (cached?.version === version) return cached.thread;
    const sessions: HistorySession[] = [];
    for (let i = 0; i < shown; i++) {
      const rec = loaded.get(list[i]._id);
      if (!rec) break;
      const turns: HistoryTurn[] = [];
      for (let p = rec.low; p <= lastPage(rec.total); p++) turns.push(...(rec.pages.get(p) ?? []));
      sessions.push({ id: rec.id, voice: rec.voice, turns });
    }
    cached = { version, thread: historyFromSessions(sessions) };
    return cached.thread;
  };

  const hasOlder = () => {
    const edge = shown ? loaded.get(list[shown - 1]._id) : undefined;
    return (edge?.low ?? 1) > 1 || shown < list.length || listMore;
  };

  return {
    thread,
    loaded: () => everLoaded,
    hasOlder,
    initial,
    older,
    refresh,
  };
}

/** One session's turns, whole (up to a few pages), newest page last. */
export async function fetchSessionTurns(sessionId: string): Promise<HistoryTurn[]> {
  const rec = await fetchWhole({ _id: sessionId }).catch(async e => {
    if (!(e instanceof TooMuchNew)) throw e;
    return fetchTail({ _id: sessionId });
  });
  const turns: HistoryTurn[] = [];
  for (let p = rec.low; p <= lastPage(rec.total); p++) turns.push(...(rec.pages.get(p) ?? []));
  return turns;
}
