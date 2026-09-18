// Helpers shared by the voice call hook and screen.
// Kept free of React Native imports so the timing and state rules can be
// checked offline (src/checks/voiceCall.check.ts).

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking';

/**
 * What the orb shows. The first four mirror the backend's agent state;
 * 'paused' is the screen's own, for a call that is reconnecting.
 */
export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'paused';

export type CallPhase =
  | 'permission'   // waiting for the user to allow the microphone; nothing started yet
  | 'connecting'   // starting the session, joining the room, waiting for the companion
  | 'connected'    // the companion is in the room
  | 'reconnecting' // transient network drop, LiveKit auto-recovers
  | 'ended'        // the user hung up
  | 'error';       // the call is over or never started; the screen offers a way on

export type CallErrorKind =
  | 'mic-permission'
  /** No connection when starting. */
  | 'offline'
  | 'connect'
  /** Joined the room, but the companion never did. */
  | 'agent-timeout'
  /** Connected, then the connection or the companion went away. */
  | 'lost'
  /**
   * The plan is spent: no voice minutes left this period. Retrying cannot fix
   * it, but buying can — this is the one that opens the paywall.
   */
  | 'quota-exhausted'
  /** A call is already live on this account. Retrying CAN fix this one. */
  | 'call-in-progress'
  /** Refused by an abuse ceiling; the server's message says which. */
  | 'limit'
  /** The server closed the call at the daily voice ceiling. */
  | 'daily-limit'
  /** Too many attempts in a short time; `retryAfter` says how long to wait. */
  | 'rate-limited'
  /** Nothing to call: no signed-in user or no saved companion. */
  | 'unavailable';

export interface CallError {
  kind: CallErrorKind;
  /** The backend's own sentence, when it sent one. The screen has copy for the rest. */
  message?: string;
  /** Seconds before a retry can succeed. */
  retryAfter?: number;
}

// Backend agent-state messages arrive on DataChannel topic "ui":
//   { kind: "agent_state", state: "listening" | "thinking" | "speaking" | "idle" }
interface AgentStatePayload {
  kind: 'agent_state';
  state: AgentState;
}

export function decodeAgentState(payload: Uint8Array): AgentState | null {
  try {
    const text = new TextDecoder().decode(payload);
    const json = JSON.parse(text) as Partial<AgentStatePayload>;
    if (json.kind !== 'agent_state') return null;
    const s = json.state;
    if (s === 'idle' || s === 'listening' || s === 'thinking' || s === 'speaking') return s;
    return null;
  } catch {
    return null;
  }
}

/**
 * The orb's guess from LiveKit's speaker list, used only until the backend's
 * own state messages arrive. Anything but the companion talking is the
 * user's turn: the guess can't know the companion is thinking, and saying so
 * at every pause is what made the orb flicker.
 */
export function orbFromSpeakers(agentSpeaking: boolean): OrbState {
  return agentSpeaking ? 'speaking' : 'listening';
}

// After Room.connect — if the companion hasn't joined by then, the worker is
// likely down. Surface a recoverable error rather than leaving the orb
// spinning forever.
export const AGENT_JOIN_TIMEOUT_MS = 8000;

/** How long a new orb state must hold before it shows. */
export const ORB_SETTLE_MS = 300;

/**
 * When the companion leaves, how long to wait for the room itself to close.
 * At the daily limit the server removes the room right after the companion's
 * goodbye, and the room's own disconnect is what says why.
 */
export const AGENT_LEFT_GRACE_MS = 1500;

/** The "Call ended · 4:12" beat before the screen leaves. */
export const ENDED_BEAT_MS = 1200;
/** A call that never connected has nothing to show, so it leaves sooner. */
export const ENDED_BEAT_SHORT_MS = 500;

/** Shorter calls have nothing for the recap to summarise. */
export const RECAP_MIN_SECONDS = 30;

type Schedule = (fn: () => void, ms: number) => unknown;
type Cancel = (handle: unknown) => void;

export interface OrbSettler {
  /** Offer a new state; it shows once it has held for ORB_SETTLE_MS. */
  propose(next: OrbState): void;
  /** Drop anything pending. */
  dispose(): void;
}

/**
 * Debounces orb states so a breath between sentences doesn't flip the orb.
 * Speech starting shows at once, so the orb moves with the voice; every other
 * change waits to see whether it holds.
 */
export function createOrbSettler(
  initial: OrbState,
  commit: (next: OrbState, prev: OrbState) => void,
  schedule: Schedule = setTimeout,
  cancel: Cancel = handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
): OrbSettler {
  let shown = initial;
  let pending: { state: OrbState; handle: unknown } | null = null;

  const show = (next: OrbState) => {
    const prev = shown;
    shown = next;
    commit(next, prev);
  };
  const clear = () => {
    if (pending) cancel(pending.handle);
    pending = null;
  };

  return {
    propose(next) {
      if (pending?.state === next) return;
      clear();
      if (next === shown) return;
      if (next === 'speaking') {
        show(next);
        return;
      }
      pending = {
        state: next,
        handle: schedule(() => {
          pending = null;
          show(next);
        }, ORB_SETTLE_MS),
      };
    },
    dispose: clear,
  };
}

/** "4:12", "12:05", or "1:02:09" past an hour. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The same length, the way VoiceOver should say it: "4 minutes, 12 seconds". */
export function spokenDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (h) parts.push(unit(h, 'hour'));
  if (m) parts.push(unit(m, 'minute'));
  if (sec || parts.length === 0) parts.push(unit(sec, 'second'));
  return parts.join(', ');
}

/**
 * The balance left right now, counted down from the balance at the start of
 * the call. Null when the balance is unknown.
 */
export function liveBalance(atStart: number | null, billedSince: number | null, now: number): number | null {
  if (atStart == null) return null;
  if (billedSince == null) return atStart;
  return atStart - Math.max(0, now - billedSince) / 1000;
}

/**
 * The balance a call's countdown starts from, or null when unknown.
 *
 * `known` is the first balance the screen learned, with what its own closed
 * sessions had spent by then; `spent` is what they have spent now (a dropped
 * call, then "Call again"). `latest` is the server's newest figure, which
 * counts only closed sessions and may not have caught up with the last one.
 * The lower of the two wins, so a figure that is behind can never make the
 * last-minute warning late.
 */
export function balanceAtStart(
  known: { balance: number; spent: number } | null,
  spent: number,
  latest: number | null,
): number | null {
  const counted = known ? known.balance - Math.max(0, spent - known.spent) : null;
  if (counted == null) return latest;
  if (latest == null) return counted;
  return Math.min(counted, latest);
}

/**
 * A 0–1 loudness from a linear RMS level (what LiveKit's volume processor
 * reports). Speech sits between about -50 and -10 dBFS, so that range is
 * spread across 0–1; anything quieter is silence.
 */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 50) / 40));
}
