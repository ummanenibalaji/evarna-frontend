// Chat.tsx — S09 First Conversation and S14 Chat.
// (S12 Voice Call lives in VoiceCall.tsx.)
//
// Both screens share one engine (useChat) and one thread (ChatThread):
// messages are updated by id, a reply that fails says so under the message
// instead of in the companion's voice, and a crisis response keeps the user in
// their conversation with support shown inline.
//
// What keeps the chat smooth however long the conversation:
//   - the composer keeps its own text, so a keystroke re-renders only the
//     composer (the screen hears only whether the box is empty or holds a
//     starter)
//   - the reply being written streams into LiveReply, read by its own row, so
//     a token re-renders one bubble; the message list changes once per reply
//   - the thread is a virtualized list of memoized rows (ChatThread)
//   - history comes from the newest end, a screenful at a time, and a refresh
//     fetches only what is new (lib/chatHistory)

import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { endSession, getMemories, startSession } from '../api';
import {
  ApiError, getAuthToken, isNetworkError, limitMessage, streamConversation, subscribeAuthExpired, type SseErrorInfo,
} from '../api/client';
import { announce } from '../hooks/useAccessibilityPrefs';
import { aiNoticeText } from '../lib/aiNotice';
import { readCache, writeCache } from '../lib/cache';
import { createChatHistory, fetchSessionTurns, type ChatHistory } from '../lib/chatHistory';
import {
  confirmedExchanges, historyFromSessions, matchSince, mergeHistory, patchMsg, restoreDraft, settledThread, type ChatMsg,
} from '../lib/chatTurns';
import { haptic } from '../lib/haptics';
import { addPushReceivedListener, addPushTapListener, setForegroundThread } from '../lib/notifications';
import { runAfterTransitions, useSceneArrived, useSceneFocusEffect } from '../navigation/sceneContext';
import { enter, exit, timing, usePressFeedback } from '../theme/motion';
import { ELEV, GRAD, HIT, MOTION, R, SP, W } from '../theme/theme';
import { Avatar } from '../components/Avatar';
import { AuroraLine, BackButton, InlineNotice, PrimaryButton, minTarget } from '../components/Atoms';
import {
  AiNotice, CapHitCard, ChatInput, SuggestionChip, useAiNoticeRepeat, type ChatInputHandle,
} from '../components/ChatBits';
import { ChatThread, SkeletonBubbles, createLiveReply, type ThreadActions } from '../components/ChatThread';
import { Screen, TopBar } from '../components/Chrome';
import { NavIcon } from '../components/NavIcon';
import { ReportSheet } from '../components/ReportSheet';
import { Txt } from '../components/Txt';
import { ARCHETYPE_LABEL, Companion, QUICK_REPLIES } from '../data/config';
import { Go } from '../navigation/types';

/**
 * Hitting the daily message cap is not a failure to reach the server, and it
 * must not be rendered as one. It used to arrive as the string "HTTP 429" and
 * come out of the companion's mouth as "(Couldn't reach the server — please
 * try again.)" — the companion apologising for a product limit.
 */
export const messageLimitOf = (
  info?: SseErrorInfo,
): { message?: string; planCap: boolean } | null => {
  if (info?.code === 'DAILY_MESSAGE_CAP') return { planCap: true };
  // The server's abuse ceilings (a burst per minute, a rolling day) land here.
  // They are not a plan limit, so no upsell — but they are still a limit, and
  // must not come out of the companion's mouth either.
  if (info?.code === 'USAGE_LIMIT_REACHED') {
    return info.serverMessage ? { message: info.serverMessage, planCap: false } : { planCap: false };
  }
  return null;
};

type Refusal = { message?: string; planCap: boolean };

/** A limit, from either a refused stream or a refused session start. */
function refusalOf(e: unknown, info?: SseErrorInfo): Refusal | null {
  if (info) return messageLimitOf(info);
  if (e instanceof ApiError) {
    const limited = messageLimitOf({ code: e.code, serverMessage: e.serverMessage });
    if (limited) return limited;
  }
  const worded = limitMessage(e);
  return worded ? { message: worded, planCap: false } : null;
}

/** What to say under a message the server never took. */
function unsentNote(e: unknown, info?: SseErrorInfo): string {
  if (isNetworkError(info ?? e)) return 'Not sent. Check your connection.';
  const status = info?.status ?? (e instanceof ApiError ? e.status : undefined);
  if (status === 429) {
    const wait = info?.retryAfter ?? (e instanceof ApiError ? e.retryAfter : undefined);
    if (!wait) return 'Not sent. Too many messages at once.';
    return `Not sent. Try again in ${wait < 60 ? `${wait} seconds` : `${Math.ceil(wait / 60)} min`}.`;
  }
  return 'Not sent.';
}

/**
 * Whether the server had the message when the stream failed. `accepted` is
 * the client's word for it (headers received) where it gives one; without it,
 * an early close after the headers is the only certain sign.
 */
type StreamFailure = SseErrorInfo & { accepted?: boolean };

// Turns kept in memory per companion, so coming back paints at once.
const MEMORY_KEEP = 300;
// Turns kept in the on-device copy that paints before the network answers.
const CACHE_KEEP = 60;
const threadKey = (characterId: string) => `chat-thread:${characterId}`;
// Coming back to the app refetches at most this often (sooner when a reply is
// unaccounted for).
const RESYNC_MS = 30_000;
// Coming back to this screen (from the profile, a call) refetches unless it
// synced moments ago.
const FOCUS_RESYNC_MS = 5_000;
// Messages drawn while the screen slides in; the rest (older, off screen
// anyway at the latest end) join once it has arrived.
const ARRIVAL_MSGS = 14;
// A dropped reply is looked for once by itself, after the server has had time
// to finish it.
const AUTO_CHECK_MS = 15_000;
// The memory count waits until the screen has arrived and the thread loaded;
// a count read this recently is reused.
const MEMORY_DEFER_MS = 900;
const MEMORY_FRESH_MS = 2 * 60_000;

// Per account and companion, for this app run: the unsent draft, the last
// thread shown, its history loader and the memory count, so leaving for a
// call or the profile loses nothing and returning is instant.
const drafts = new Map<string, string>();
const threads = new Map<string, ChatMsg[]>();
const histories = new Map<string, ChatHistory>();
const memoryCounts = new Map<string, { n: number; at: number }>();
// Bumped when an account is torn down, so a chat still on its way out can't
// write the old account's thread back.
let accountEpoch = 0;

/**
 * Forgets every conversation held in memory. Runs here when the server
 * rejects the session; the router should call it on sign-out and account
 * deletion too. (Nothing is written to disk after sign-out either way: a
 * leaving chat checks the account is still signed in.)
 */
export function clearChatMemory(): void {
  drafts.clear();
  threads.clear();
  histories.clear();
  memoryCounts.clear();
  accountEpoch++;
}

// A session the server rejected is torn down by the router; what this module
// holds of it goes too.
subscribeAuthExpired(clearChatMemory);

let pairSeq = 0;
const newPair = () => `l${Date.now().toString(36)}${(pairSeq++).toString(36)}`;
const userId_ = (pair: string) => `${pair}:u`;
const replyId = (pair: string) => `${pair}:r`;

/** An exchange whose fate the server knows and the screen doesn't yet. */
const unresolved = (m: ChatMsg) => !!m.local && (m.failed === 'dropped' || (m.failed === 'unsent' && !!m.unsure));

// Conversation starters by archetype. The backend doesn't suggest replies yet.
const STARTERS: Record<string, string[]> = {
  mentor: ['Help me think something through', 'What should I focus on this week?', 'Give me honest feedback'],
  friend: ['I just need to vent', 'Guess what happened today', 'Distract me for a bit'],
  partner: ['I missed you', 'Can I tell you about my day?', 'I could use some reassurance'],
  challenger: ['Push me harder', 'Run a mock round', 'Call me out on something'],
};

const D = MOTION.duration;
const fade = (ms: number) => ({ ...timing(ms), reduceMotion: ReduceMotion.Never });

/** Resolves once no screen is sliding, so a big update doesn't land mid-move. */
const afterTransitions = () => new Promise<void>(resolve => { runAfterTransitions(resolve); });

/** A stable function that always runs the latest `fn` (as the router's useEvent). */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

// ─── The engine ──────────────────────────────────────────────────────────
/** What a look at the server's thread found: whether it worked, and the
 *  exchanges it accounted for, with the reply's words where known. */
export interface VerifyResult {
  ok: boolean;
  found: Map<string, string | null>;
}

const NOTHING_FOUND: VerifyResult = { ok: false, found: new Map() };

interface ChatOptions {
  characterId?: string;
  name: string;
  initial: () => ChatMsg[];
  onQuotaRefused?: () => void;
  /** Fetches the saved thread and merges it in. Without it, Reload and the
   *  check before resending an unsure message are skipped. */
  verify?: () => Promise<VerifyResult>;
}

/**
 * Sending and receiving for one conversation.
 *
 * The text session starts on the first send, not on open: an empty session
 * per visit used to push real history out of view, and spent the hourly
 * session budget. One reply is in flight at a time; the draft (held by the
 * composer, reached through `inputRef`) stays editable meanwhile.
 */
function useChat(o: ChatOptions) {
  const opts = useRef(o);
  opts.current = o;
  const [msgs, setMsgs] = useState<ChatMsg[]>(o.initial);
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  const inputRef = useRef<ChatInputHandle>(null);
  const [live] = useState(createLiveReply);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [offline, setOffline] = useState(false);
  const [replies, setReplies] = useState(0);
  const [failures, setFailures] = useState(0);
  // Replies in the current session — what a recap would have to show.
  const [sessionReplies, setSessionReplies] = useState(0);
  const session = useRef<Promise<string> | null>(null);
  const sessionId = useRef<string | null>(null);
  const stream = useRef<AbortController | null>(null);
  // The exchange whose reply is streaming now, and its session.
  const streaming = useRef<{ pair: string; sid: string } | null>(null);
  // Exchanges the server's history has been seen to hold. Kept apart from the
  // message list, whose merge may still be pending, so a Retry never resends
  // one of them.
  const confirmed = useRef(new Set<string>());
  const alive = useRef(true);
  const firstSendAt = useRef<number | null>(null);
  const busy = msgs.some(m => m.streaming);
  // Also set at send, so two taps in one frame can't send twice.
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stream.current?.abort();
      // End the session this visit started — now, or when a slow start lands.
      session.current?.then(id => endSession(id)).catch(() => {});
    };
  }, []);

  const ensureSession = (): Promise<string> => {
    const { characterId } = opts.current;
    if (!characterId) return Promise.reject(new Error('No companion to talk to'));
    if (!session.current) {
      const started = startSession(characterId, 'text').then(r => {
        sessionId.current = r.session_id;
        return r.session_id;
      });
      // A failed start is forgotten, so the next send tries again.
      started.catch(() => { if (session.current === started) session.current = null; });
      session.current = started;
    }
    return session.current;
  };

  /** Ends this visit's session now (its summary and memories are written
   *  after it ends); a later send starts a fresh one. */
  const endVisit = useEvent(() => {
    const started = session.current;
    session.current = null;
    sessionId.current = null;
    setSessionReplies(0);
    started?.then(id => endSession(id)).catch(() => {});
  });

  const refuse = (limited: Refusal, pair: string, text: string) => {
    // Take back the two bubbles this send added, and hand the text back so
    // nothing anyone typed is lost.
    setMsgs(m => m.filter(x => x.pair !== pair));
    inputRef.current?.set(d => restoreDraft(d, text));
    setRefusal(limited);
    opts.current.onQuotaRefused?.();
    haptic.warning();
  };

  const fail = (pair: string, e: unknown, info: StreamFailure | undefined, partial: string) => {
    if (isNetworkError(info ?? e)) setOffline(true);
    // The session is gone server-side; the next try starts a new one.
    if (info?.status === 404) {
      session.current = null;
      sessionId.current = null;
    }
    setFailures(n => n + 1);
    haptic.error();
    const code = info?.code;

    // The server failed mid-reply and saved nothing: asking again is the way.
    if (code === 'STREAM_ERROR') {
      setMsgs(m => patchMsg(m, replyId(pair), { text: partial, streaming: false, failed: 'interrupted' }));
      announce('The reply was interrupted.');
      return;
    }

    // The server had the message: it keeps going after the connection goes,
    // saves both turns and pushes the reply. Offering to send it again would
    // send it twice, so the way on is Reload. That holds when part of the
    // reply arrived, when the stream closed early after its headers, when the
    // client says the headers came, and when the first byte never came in
    // time (the server may be answering still).
    const unanswered = !partial && code === 'DELIVERY_UNKNOWN';
    if (partial || code === 'STREAM_INCOMPLETE' || unanswered || info?.accepted === true) {
      const note = unanswered ? 'No reply yet. It may still be on its way.' : undefined;
      setMsgs(m => patchMsg(m, replyId(pair), { text: partial, streaming: false, failed: 'dropped', note }));
      announce(note ?? (partial ? 'The connection dropped before the reply finished.' : 'The connection dropped before the reply arrived.'));
      return;
    }

    // Otherwise the server most likely never took it. A lost connection with
    // no word on the headers could still have reached it, so Retry looks
    // before it sends again.
    const unsure = code === 'NETWORK' && info?.accepted === undefined;
    const note = unsure ? 'May not have sent. Check your connection.' : unsentNote(e, info);
    setMsgs(m => patchMsg(m.filter(x => x.id !== replyId(pair)), userId_(pair), {
      failed: 'unsent', note, ...(unsure ? { unsure: true } : null),
    }));
    announce(note);
  };

  const deliver = (pair: string, text: string) => {
    const rid = replyId(pair);
    ensureSession().then(sid => {
      if (!alive.current) return;
      setOffline(false);
      let acc = '';
      const ended = () => {
        live.end(rid);
        if (streaming.current?.pair === pair) streaming.current = null;
      };
      streaming.current = { pair, sid };
      stream.current = streamConversation({ session_id: sid, message: text }, {
        onChunk: chunk => {
          acc += chunk;
          live.push(rid, chunk);
        },
        onDone: turnId => {
          ended();
          setMsgs(m => patchMsg(m, rid, { text: acc, streaming: false, ...(turnId ? { turnId } : null) }));
          setReplies(n => n + 1);
          // A reply that lands after the visit's session was ended belongs to that one.
          if (sessionId.current === sid) setSessionReplies(n => n + 1);
          if (acc.trim()) announce(`${opts.current.name}: ${acc.trim()}`);
        },
        // The server's crisis response replaces the reply. It is what the
        // server saved as the companion's turn; support follows it inline.
        onCrisis: content => {
          ended();
          setMsgs(m => patchMsg(m, rid, { text: content || acc, streaming: false, crisis: true }));
          setReplies(n => n + 1);
          if (sessionId.current === sid) setSessionReplies(n => n + 1);
          if (content) announce(`${opts.current.name}: ${content}`);
        },
        onError: (message, info) => {
          ended();
          const limited = refusalOf(message, info);
          if (limited) refuse(limited, pair, text);
          else fail(pair, message, info, acc);
        },
      });
    }, e => {
      live.end(rid);
      if (!alive.current) return;
      const limited = refusalOf(e);
      if (limited) refuse(limited, pair, text);
      else fail(pair, e, undefined, '');
    });
  };

  /** Sends what the composer holds. False when it can't go yet (a reply is on its way). */
  const send = useEvent((raw: string): boolean => {
    const text = raw.trim();
    if (!text || busyRef.current) return false;
    // A new attempt clears the last refusal: the cap resets at midnight, and a
    // card that never goes away would outlive the limit it describes.
    setRefusal(null);
    const pair = newPair();
    const at = Date.now();
    firstSendAt.current ??= at;
    live.start(replyId(pair));
    busyRef.current = true;
    setMsgs(m => [
      ...m,
      { id: userId_(pair), from: 'user', text, at, local: true, pair },
      { id: replyId(pair), from: 'comp', text: '', at, local: true, pair, streaming: true },
    ]);
    deliver(pair, text);
    return true;
  });

  const resend = (pair: string) => {
    const user = msgsRef.current.find(x => x.id === userId_(pair));
    if (!user || busyRef.current) return;
    setRefusal(null);
    const at = Date.now();
    firstSendAt.current ??= at;
    live.start(replyId(pair));
    busyRef.current = true;
    // Sent again, it moves to the end, so the thread reads in the order
    // things happened.
    setMsgs(m => [
      ...m.filter(x => x.pair !== pair),
      { ...user, failed: undefined, note: undefined, unsure: undefined, checking: undefined, at },
      { id: replyId(pair), from: 'comp', text: '', at, local: true, pair, streaming: true },
    ]);
    deliver(pair, user.text);
  };

  /** Retry under a failed exchange. An unsure message is looked for first:
   *  if the server has it, its copy replaces this one and nothing is resent. */
  const retry = useEvent(async (pair: string) => {
    const user = msgsRef.current.find(x => x.id === userId_(pair));
    const reply = msgsRef.current.find(x => x.id === replyId(pair));
    // Not while a Reload is looking for this exchange, and never for one the
    // server is known to have.
    if (!user || busyRef.current || user.checking || reply?.checking || confirmed.current.has(pair)) return;
    const { verify, name } = opts.current;
    if (user.failed === 'unsent' && user.unsure && verify) {
      const at = user.at;
      setMsgs(m => patchMsg(m, user.id, { checking: true }));
      const r = await verify();
      if (!alive.current) return;
      if (r.found.has(pair) || confirmed.current.has(pair)) {
        const text = r.found.get(pair);
        announce(text ? `It was sent. ${name}: ${text}` : 'It was sent.');
        return;
      }
      setMsgs(m => patchMsg(m, user.id, x => (x.at === at ? { ...x, checking: undefined } : x)));
      if (!r.ok) {
        announce("Couldn't check whether it was sent. Try again in a moment.");
        return;
      }
    }
    resend(pair);
  });

  /** Reload under a dropped reply: looks for the saved reply, and says what it found. */
  const reload = useEvent(async (pair: string) => {
    const { verify, name } = opts.current;
    const reply = msgsRef.current.find(x => x.id === replyId(pair));
    if (!verify || !reply || reply.checking || reply.streaming) return;
    // The attempt this Reload is about: if it is sent again meanwhile (same
    // ids), the new attempt isn't marked with this one's outcome.
    const at = reply.at;
    setMsgs(m => patchMsg(m, reply.id, { checking: true }));
    const r = await verify();
    if (!alive.current) return;
    if (r.found.has(pair) || confirmed.current.has(pair)) {
      const text = r.found.get(pair);
      announce(text ? `${name}: ${text}` : 'The reply is here.');
      return;
    }
    setMsgs(m => patchMsg(m, reply.id, x => (x.at !== at ? x : r.ok
      ? { ...x, checking: undefined, missing: true }
      : { ...x, checking: undefined })));
    announce(r.ok ? 'Still finishing. Try again in a moment.' : "Couldn't reload. Check your connection.");
  });

  /**
   * The server's history holds these exchanges. Remembered, so no Retry
   * sends them again; and a reply still marked streaming that the server has
   * finished (its stream went quiet) is ended here, its saved copy standing in.
   */
  const settleFound = useEvent((found: Map<string, string | null>) => {
    for (const pair of found.keys()) confirmed.current.add(pair);
    const s = streaming.current;
    if (!s || !found.has(s.pair)) return;
    streaming.current = null;
    stream.current?.abort();
    live.end(replyId(s.pair));
    setReplies(n => n + 1);
    if (sessionId.current === s.sid) setSessionReplies(n => n + 1);
  });

  const currentSession = useCallback(() => sessionId.current, []);
  const sentSince = useCallback(() => firstSendAt.current, []);

  return {
    msgs, setMsgs, msgsRef, inputRef, live, send, retry, reload, settleFound, busy,
    refusal, offline, setOffline, replies, failures, sessionReplies, endVisit, currentSession, sentSince,
  };
}

/** The exchanges `history` accounts for, with each reply's words where found. */
function foundIn(history: ChatMsg[], current: ChatMsg[], since: number | null): Map<string, string | null> {
  const { confirmed } = confirmedExchanges(history, current, since);
  const found = new Map<string, string | null>();
  if (!confirmed.size) return found;
  for (const pair of confirmed) {
    const user = current.find(m => m.id === userId_(pair));
    const text = user?.text.trim();
    // The server copy of the question, then the reply after it.
    const i = text ? history.findIndex(h => h.from === 'user' && (since == null || h.at > since) && h.text.trim() === text) : -1;
    const reply = i >= 0 ? history.slice(i + 1).find(h => h.from === 'comp' && h.session === history[i].session) : undefined;
    found.set(pair, reply?.text.trim() || null);
  }
  return found;
}

/** The report sheet's state: which reply, and the bubble that asked, where
 *  VoiceOver focus returns when the sheet closes. */
function useReportSheet() {
  const [state, setState] = useState<{ turnId: string | null; from?: RefObject<View | null> }>({ turnId: null });
  const open = useCallback((turnId: string, from?: RefObject<View | null>) => {
    haptic.medium();
    setState({ turnId, from });
  }, []);
  // The bubble is kept, so focus can go back to it after the sheet has left.
  const close = useCallback(() => setState(s => ({ ...s, turnId: null })), []);
  return { turnId: state.turnId, from: state.from, open, close };
}

// ─── Starters ────────────────────────────────────────────────────────────
// Offered when a visit begins, until the first send. The row keeps its place
// while the user types, so the thread above never jumps; it only fades.
const StarterRow = memo(function StarterRow({ starters, chosen, visible, onPick }: {
  starters: readonly string[]; chosen: string; visible: boolean; onPick: (s: string) => void;
}) {
  const v = useSharedValue(visible ? 1 : 0);
  useEffect(() => { v.value = withTiming(visible ? 1 : 0, fade(D.fast)); }, [visible, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  const [entering] = useState(() => enter.fade);
  const [exiting] = useState(() => exit.fade);

  return (
    <Animated.View entering={entering} exiting={exiting}>
      <Animated.View
        style={style}
        pointerEvents={visible ? 'box-none' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          // Horizontal scroll views grow by default and would take half the screen.
          style={styles.starters}
          contentContainerStyle={styles.startersContent}
        >
          {starters.map(s => (
            <SuggestionChip key={s} selected={chosen === s} onPress={() => onPick(s)}>{s}</SuggestionChip>
          ))}
        </ScrollView>
      </Animated.View>
    </Animated.View>
  );
});

// ─── S09 FIRST CONVERSATION ──────────────────────────────────────────────
export function S09_FirstChat({ go, companion, characterId, isMinor = false, textRemainingToday = null, textDailyCap = null, textResetsAt = null, textUpsell = true, onQuotaRefused, onCapUpgrade }: {
  go: Go; companion: Companion; userId?: string; characterId?: string;
  /** Known minors get the break reminder California requires. */
  isMinor?: boolean;
  textRemainingToday?: number | null;
  textDailyCap?: number | null;
  textResetsAt?: string | null;
  textUpsell?: boolean;
  onQuotaRefused?: () => void;
  onCapUpgrade?: () => void;
}) {
  const name = companion.name;
  // The guided chat opens on the companion's own introduction.
  const [greeting] = useState<ChatMsg>(() => ({
    id: 'greeting',
    from: 'comp',
    text: `Hey, this is ${name}. Thanks for choosing me. I'd love to get to know you — what's been on your mind today?`,
    at: Date.now(),
  }));

  // A dropped reply: this visit's session, which the server finished saving.
  // Every turn in it is new since the chat opened, so words match from 0.
  const verify = useEvent(async (): Promise<VerifyResult> => {
    const sid = chat.currentSession();
    if (!sid) return NOTHING_FOUND;
    try {
      const turns = await fetchSessionTurns(sid);
      const saved = [greeting, ...historyFromSessions([{ id: sid, voice: false, turns }])];
      const found = foundIn(saved, chat.msgsRef.current, 0);
      chat.settleFound(found);
      chat.setMsgs(m => mergeHistory(saved, m, 0));
      chat.setOffline(false);
      return { ok: true, found };
    } catch (e) {
      if (isNetworkError(e)) chat.setOffline(true);
      return NOTHING_FOUND;
    }
  });

  const chat = useChat({ characterId, name, initial: () => [greeting], onQuotaRefused, verify });
  const { setMsgs } = chat;
  useAiNoticeRepeat(() => setMsgs(m => [...m, { id: `notice-${Date.now()}`, from: 'notice', text: aiNoticeText(name, isMinor, true), at: 0, local: true }]));

  const capHit = chat.refusal != null || (textRemainingToday != null && textRemainingToday <= 0);
  // The way on appears after a reply lands — or when talking isn't working,
  // so nobody is stuck here — and the composer stays either way.
  const canContinue = chat.replies > 0 || chat.failures >= 2 || capHit;

  const report = useReportSheet();
  const [continueEntering] = useState(() => enter.fadeUp);

  const onMoreSupport = useCallback(() => go('crisis'), [go]);
  const actions = useMemo<ThreadActions>(() => ({
    onReport: report.open, onRetry: chat.retry, onReload: chat.reload, onMoreSupport,
  }), [report.open, chat.retry, chat.reload, onMoreSupport]);

  const top = useMemo(() => <AiNotice text={aiNoticeText(name, isMinor, false)} />, [name, isMinor]);
  const onUpgrade = useEvent(() => { onCapUpgrade?.(); go('paywall'); });
  const upsell = textUpsell && (chat.refusal?.planCap ?? true);
  const capMessage = chat.refusal?.message ?? null;
  const bottom = useMemo(() => (capHit ? (
    <CapHitCard onUpgrade={onUpgrade} dailyCap={textDailyCap} resetsAt={textResetsAt} upsell={upsell} message={capMessage} />
  ) : null), [capHit, onUpgrade, textDailyCap, textResetsAt, upsell, capMessage]);

  return (
    <Screen>
      <TopBar
        glass
        border
        center={
          <View accessible accessibilityRole="header" accessibilityLabel={`${name}, guided first chat`} style={styles.s09Title}>
            <Txt variant="headline" maxScale={1.3} numberOfLines={1} color={W.cream}>{name}</Txt>
            <Txt variant="caption" maxScale={1.3} numberOfLines={1} color={W.text2}>Guided first chat</Txt>
          </View>
        }
        right={canContinue ? null : (
          <Pressable
            onPress={() => go('home')}
            accessibilityRole="button"
            accessibilityHint="Goes to your home screen"
            style={({ pressed }) => [styles.skip, pressed ? styles.pressed : null]}
          >
            <Txt variant="subhead" weight={600} maxScale={1.3} color={W.primarySoft}>Skip</Txt>
          </Pressable>
        )}
      />
      <ChatThread
        msgs={chat.msgs}
        live={chat.live}
        name={name}
        accent={W.primary}
        recall={false}
        busy={chat.busy}
        actions={actions}
        top={top}
        bottom={bottom}
      />
      {canContinue ? (
        <Animated.View entering={continueEntering} style={styles.continue}>
          <PrimaryButton onPress={() => go('home')} trailingArrow>Continue to home</PrimaryButton>
        </Animated.View>
      ) : null}
      <ChatInput ref={chat.inputRef} onSubmit={chat.send} companionName={name} busy={chat.busy} />
      <ReportSheet turnId={report.turnId} onClose={report.close} returnFocusRef={report.from} />
    </Screen>
  );
}

// ─── S14 CHAT ────────────────────────────────────────────────────────────
interface ChatProps {
  go: Go;
  companion: Companion;
  accent?: string;
  openMemorySheet?: (ref: string) => void;
  /** Messages left today, or null while unknown. Replaces a dev-config flag. */
  textRemainingToday?: number | null;
  textDailyCap?: number | null;
  textResetsAt?: string | null;
  /** False on a paid plan: there is nothing left to sell them. */
  textUpsell?: boolean;
  /** Re-read the entitlement after the server refuses a turn. */
  onQuotaRefused?: () => void;
  /** Tells App why the paywall is opening, so it shows the right headline. */
  onCapUpgrade?: () => void;
  /** @deprecated No longer shown: the empty thread doesn't put words in the
   *  companion's mouth. Still accepted so the router keeps compiling. */
  userName?: string;
  userId?: string;
  characterId?: string;
  /** Known minors get the break reminder California requires. */
  isMinor?: boolean;
  /** Text to start the composer with (a failed notification reply, a mood from Home). */
  initialDraft?: string;
  /** Starts a call, with the router's balance check. Without it the call screen opens directly. */
  onCall?: () => void;
}

type StatusTone = 'typing' | 'offline' | 'memory' | 'plain';
const STATUS_COLOR: Record<StatusTone, string> = {
  typing: W.primarySoft, offline: W.text2, memory: W.gold, plain: W.text2,
};

export function S14_Chat({
  go, companion, accent = W.primary, openMemorySheet, textRemainingToday = null, textDailyCap = null,
  textResetsAt = null, textUpsell = true, onQuotaRefused, onCapUpgrade, userId, characterId, isMinor = false,
  initialDraft, onCall,
}: ChatProps) {
  const name = companion.name;
  const { width } = useWindowDimensions();
  // Everything held in memory is per account, so another account signing in
  // on this phone never sees it.
  const memKey = `${userId ?? ''}:${characterId ?? companion.id}`;
  const draftKey = `${userId ?? ''}:${companion.id}`;
  const [epoch] = useState(() => accountEpoch);
  const [cached] = useState(() => (characterId ? threads.get(memKey) : undefined));
  const [loader] = useState(() => (characterId ? histories.get(memKey) ?? createChatHistory(characterId) : null));

  // ── The draft. A saved one wins over text handed in (a mood from Home, a
  // failed notification reply): losing what someone wrote is worse than not
  // prefilling. The handed text is then offered as the first starter instead.
  const [draftStart] = useState(() => {
    const saved = drafts.get(draftKey) ?? '';
    const given = initialDraft?.trim() ?? '';
    const text = restoreDraft(saved, initialDraft ?? '');
    const handed = given && saved.trim() && saved.trim() !== given ? given : null;
    return { text, handed };
  });

  // ── History: the saved thread paints first, the server's answer replaces it.
  const [history, setHistory] = useState<'loading' | 'ready' | 'error'>(cached || !characterId ? 'ready' : 'loading');
  const [historyIssue, setHistoryIssue] = useState<'offline' | 'failed' | null>(null);
  // Known once this visit's first load has landed.
  const [hasOlder, setHasOlder] = useState(false);
  const [olderState, setOlderState] = useState<'idle' | 'loading' | 'error'>('idle');
  const historyRef = useRef(history);
  historyRef.current = history;
  const knownUntil = useRef<number | null>(null);
  const applied = useRef(false);
  const lastSync = useRef(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  // The account this screen opened under is still the one signed in.
  const sameAccount = () => epoch === accountEpoch && !!getAuthToken();

  const sync = useEvent(async (kind: 'initial' | 'refresh' | 'older', hint?: string): Promise<VerifyResult> => {
    if (!loader || !characterId) return NOTHING_FOUND;
    // Where matching by words starts, as of now: another sync finishing
    // meanwhile moves knownUntil past the very turns this one is looking for.
    const since = matchSince(knownUntil.current, chat.sentSince());
    // What's new is most likely in this visit's own session, which the loader
    // may not know yet: it's fetched alongside the session list.
    const r = kind === 'initial'
      ? await loader.initial()
      : kind === 'older' ? await loader.older() : await loader.refresh(hint ?? chat.currentSession() ?? undefined);
    // An answer that arrives while the screen is sliding in waits for the end
    // of the slide: re-laying the thread mid-move would make it stutter.
    await afterTransitions();
    if (!alive.current || !sameAccount()) return NOTHING_FOUND;

    if (!r.ok) {
      const offline = isNetworkError(r.error);
      if (kind === 'older') {
        setOlderState('error');
      } else {
        if (offline) chat.setOffline(true);
        setHistoryIssue(offline ? 'offline' : 'failed');
        setHistory(h => (h === 'loading' ? 'error' : h));
      }
      return NOTHING_FOUND;
    }

    lastSync.current = Date.now();
    histories.set(memKey, loader);
    const saved = loader.thread();
    const found = foundIn(saved, chat.msgsRef.current, since);
    chat.settleFound(found);
    const first = !applied.current;
    applied.current = true;
    const more = loader.hasOlder();
    // The swap from the cached copy, and every later change, is a transition:
    // React can pause it for a keystroke or a scroll.
    startTransition(() => {
      if (first || r.changed) setMsgs(m => mergeHistory(saved, m, since));
      setHistory('ready');
      setHistoryIssue(null);
      setHasOlder(more);
      setOlderState('idle');
    });
    chat.setOffline(false);
    const newest = saved.length ? saved[saved.length - 1].at : null;
    knownUntil.current = newest != null ? Math.max(newest, knownUntil.current ?? 0) : knownUntil.current ?? 0;
    if (first || r.changed) {
      threads.set(memKey, saved.slice(-MEMORY_KEEP));
      if (userId && kind !== 'older') void writeCache(userId, threadKey(characterId), saved.slice(-CACHE_KEEP));
    }
    return { ok: true, found };
  });

  const verify = useCallback(() => sync('refresh'), [sync]);
  const chat = useChat({
    characterId, name, initial: () => cached ?? [], onQuotaRefused, verify,
  });
  const { msgs, setMsgs } = chat;
  useAiNoticeRepeat(() => setMsgs(m => [...m, { id: `notice-${Date.now()}`, from: 'notice', text: aiNoticeText(name, isMinor, true), at: 0, local: true }]));

  // Opening: only what's new when this thread was loaded earlier this run
  // (one round trip, and what's in memory painted meanwhile); otherwise the
  // newest screenful. Never skipped: a push tapped on the way here has
  // already fired before this screen could listen for it.
  useEffect(() => {
    if (loader) void sync(loader.loaded() ? 'refresh' : 'initial');
  }, [loader, sync]);

  // Cold start: the copy saved on this phone, while the network answers.
  useEffect(() => {
    if (cached || !characterId || !userId) return;
    let live = true;
    readCache<ChatMsg[]>(userId, threadKey(characterId)).then(async saved => {
      if (!live || !saved?.length || applied.current) return;
      await afterTransitions();
      if (!live || applied.current) return;
      startTransition(() => {
        setMsgs(m => [...saved, ...m.filter(x => x.local)]);
        setHistory('ready');
      });
    });
    return () => { live = false; };
  }, [cached, characterId, userId, setMsgs]);

  const retryHistory = useCallback(() => {
    setHistory(h => (h === 'error' ? 'loading' : h));
    setHistoryIssue(null);
    void sync(loader?.loaded() ? 'refresh' : 'initial');
  }, [sync, loader]);

  const loadOlder = useCallback(() => {
    if (!applied.current) return;
    setOlderState('loading');
    void sync('older');
  }, [sync]);

  // Back online (a send got through): fetch what couldn't load while offline.
  const offlineBefore = useRef(chat.offline);
  useEffect(() => {
    const cameBack = offlineBefore.current && !chat.offline;
    offlineBefore.current = chat.offline;
    if (cameBack && historyIssue === 'offline') retryHistory();
  }, [chat.offline, historyIssue, retryHistory]);

  // Back in the app: a reply that finished while it was away (a dropped one,
  // or a check-in) is fetched into the thread.
  useEffect(() => {
    if (!characterId) return;
    const sub = AppState.addEventListener('change', s => {
      if (s !== 'active') return;
      if (Date.now() - lastSync.current < RESYNC_MS && !chat.msgsRef.current.some(unresolved)) return;
      void sync('refresh');
    });
    return () => sub.remove();
  }, [characterId, sync, chat.msgsRef]);

  // A reply that dropped is looked for once by itself, after the server has
  // had time to finish and save it.
  const autoChecked = useRef(new Set<string>());
  // Keyed by attempt (a resend reuses the exchange's ids with a new time), so
  // a second drop is looked for too.
  const pending = useMemo(() => msgs.filter(unresolved).map(m => `${m.pair}@${m.at}`).join(' '), [msgs]);
  useEffect(() => {
    const pairs = pending ? pending.split(' ').filter(p => !autoChecked.current.has(p)) : [];
    if (!pairs.length) return;
    const t = setTimeout(() => {
      pairs.forEach(p => autoChecked.current.add(p));
      void sync('refresh');
    }, AUTO_CHECK_MS);
    return () => clearTimeout(t);
  }, [pending, sync]);

  // Leaving keeps the thread, so coming back paints at once — unless the
  // account was signed out meanwhile, when nothing of it may stay.
  useEffect(() => () => {
    if (!characterId || historyRef.current !== 'ready' || !sameAccount()) return;
    const settled = settledThread(chat.msgsRef.current);
    threads.set(memKey, settled.slice(-MEMORY_KEEP));
    if (userId) void writeCache(userId, threadKey(characterId), settled.slice(-CACHE_KEEP));
  }, [characterId, userId, memKey]);

  // While this chat is the screen in front its pushes arrive silently, and
  // the message they carry is fetched into the thread instead. The claim is
  // released only if it is still this chat's, so a chat sliding out can't
  // clear the one that replaced it; covered and uncovered, it lets go and
  // claims again. Coming back to the front (from the profile, a call) fetches
  // what's new, such as the call's transcript. None of this re-renders the
  // screen as it is covered or uncovered.
  const wasInFront = useRef(false);
  useSceneFocusEffect(() => {
    if (!characterId) return;
    if (wasInFront.current && Date.now() - lastSync.current > FOCUS_RESYNC_MS) void sync('refresh');
    wasInFront.current = true;
    return setForegroundThread(characterId);
  });

  // A push for this companion — received in the foreground, or tapped while
  // this chat is already open (the router keeps the chat as it is then).
  useEffect(() => {
    if (!characterId) return;
    const mine = (d: { character_id?: string; session_id?: string }) => {
      if (d.character_id === characterId) void sync('refresh', d.session_id);
    };
    const offReceived = addPushReceivedListener(mine);
    const offTapped = addPushTapListener(mine);
    return () => {
      offReceived();
      offTapped();
    };
  }, [characterId, sync]);

  // How much of the user this companion holds — the header's gold line, and
  // whether a pause before a reply is memory recall. Read after the screen
  // has arrived: the list is every memory, and only its length is shown.
  const [memoryCount, setMemoryCount] = useState<number | null>(() => memoryCounts.get(memKey)?.n ?? null);
  useEffect(() => {
    if (!characterId) return;
    const known = memoryCounts.get(memKey);
    if (known && Date.now() - known.at < MEMORY_FRESH_MS) return;
    let live = true;
    const t = setTimeout(() => {
      getMemories(characterId).then(ms => {
        memoryCounts.set(memKey, { n: ms.length, at: Date.now() });
        if (live) setMemoryCount(ms.length);
      }, () => {});
    }, MEMORY_DEFER_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [characterId, memKey]);

  const report = useReportSheet();

  // ── Composer. The screen only hears whether the box is empty and which
  // starter (if any) it holds, so typing doesn't re-render the thread.
  const baseStarters = STARTERS[companion.archetype] ?? QUICK_REPLIES;
  const starters = useMemo(
    () => (draftStart.handed ? [draftStart.handed, ...baseStarters.filter(s => s !== draftStart.handed)] : baseStarters),
    [draftStart.handed, baseStarters],
  );
  const matchStarter = (text: string) => {
    const t = text.trim();
    return t && starters.includes(t) ? t : null;
  };
  const [draftEmpty, setDraftEmpty] = useState(() => !draftStart.text.trim());
  const [draftStarter, setDraftStarter] = useState<string | null>(() => matchStarter(draftStart.text));
  // The handed-in text stays on offer until the draft is touched.
  const [handedOffer, setHandedOffer] = useState(!!draftStart.handed);
  const onDraftChange = useEvent((text: string) => {
    if (text) drafts.set(draftKey, text);
    else drafts.delete(draftKey);
    setDraftEmpty(!text.trim());
    setDraftStarter(matchStarter(text));
    setHandedOffer(false);
  });
  // A draft handed over after mount fills an empty box; it never replaces
  // something the user is writing.
  const handedAtMount = useRef(initialDraft);
  useEffect(() => {
    if (initialDraft === handedAtMount.current) return;
    handedAtMount.current = initialDraft;
    const given = initialDraft;
    if (given?.trim()) chat.inputRef.current?.set(d => restoreDraft(d, given));
  }, [initialDraft, chat.inputRef]);
  const pickStarter = useCallback((s: string) => {
    chat.inputRef.current?.set(d => (d.trim() === s ? '' : s));
  }, [chat.inputRef]);

  const capHit = chat.refusal != null || (textRemainingToday != null && textRemainingToday <= 0);
  const talked = msgs.some(m => m.local && m.from === 'user');
  const offerStarters = history === 'ready' && !historyIssue && !capHit && !talked && !chat.busy;
  const startersVisible = offerStarters && (draftEmpty || draftStarter != null || handedOffer);

  const nothingShown = !msgs.some(m => m.from !== 'notice');
  const empty = history === 'ready' && !historyIssue && nothingShown;
  const loadingHistory = history === 'loading';

  const statusTone: StatusTone = chat.busy ? 'typing' : chat.offline ? 'offline' : memoryCount ? 'memory' : 'plain';
  const statusText = chat.busy
    ? 'typing…'
    : chat.offline
      ? 'Offline'
      : memoryCount
        ? `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}`
        : ARCHETYPE_LABEL[companion.archetype] ?? '';

  // Stable handlers, so the header, the thread and its rows don't re-render
  // when the screen does.
  const onBack = useEvent(() => {
    // Back from a conversation shows its recap; with nothing said, home. The
    // recap may open over this screen, so the session ends here rather than
    // on unmount: its summary is only written once it ends.
    if (chat.sessionReplies === 0) { go('home'); return; }
    chat.endVisit();
    go('recap');
  });
  const onProfile = useEvent(() => go('profile'));
  const onCallPress = useEvent(() => (onCall ? onCall() : go('call')));
  const onMoreSupport = useCallback(() => go('crisis'), [go]);
  const onUpgrade = useEvent(() => { onCapUpgrade?.(); go('paywall'); });

  const actions = useMemo<ThreadActions>(() => ({
    onReport: report.open, onRetry: chat.retry, onReload: chat.reload, onMemoryClick: openMemorySheet, onMoreSupport,
  }), [report.open, chat.retry, chat.reload, openMemorySheet, onMoreSupport]);

  // While the screen slides in, only the newest messages are drawn (all that
  // shows at the latest end); the older ones join once it has arrived, so the
  // list doesn't mount rows in batches during the slide.
  const arrived = useSceneArrived();
  const threadMsgs = useMemo(
    () => (arrived || msgs.length <= ARRIVAL_MSGS ? msgs : msgs.slice(-ARRIVAL_MSGS)),
    [arrived, msgs],
  );
  const cut = threadMsgs !== msgs;

  const top = useMemo(() => (cut ? null : (
    <>
      <AiNotice text={aiNoticeText(name, isMinor, false)} />
      {empty ? <ThreadIntro name={name} accent={accent} image={companion.image} /> : null}
      {loadingHistory ? <SkeletonBubbles /> : null}
    </>
  )), [cut, name, isMinor, empty, accent, companion.image, loadingHistory]);

  const upsell = textUpsell && (chat.refusal?.planCap ?? true);
  const capMessage = chat.refusal?.message ?? null;
  const bottom = useMemo(() => (capHit ? (
    <CapHitCard onUpgrade={onUpgrade} dailyCap={textDailyCap} resetsAt={textResetsAt} upsell={upsell} message={capMessage} />
  ) : null), [capHit, onUpgrade, textDailyCap, textResetsAt, upsell, capMessage]);

  let notice: React.ReactNode = null;
  if (history === 'error' || (historyIssue && nothingShown)) {
    notice = (
      <InlineNotice
        tone="error"
        text={historyIssue === 'offline' ? "You're offline, so your conversation can't load yet." : "Couldn't load your conversation."}
        actionLabel="Retry"
        onAction={retryHistory}
        style={styles.historyNotice}
      />
    );
  } else if (historyIssue) {
    notice = (
      <InlineNotice
        tone="warning"
        text={historyIssue === 'offline' ? "You're offline. Showing saved messages." : "Couldn't refresh. Showing saved messages."}
        actionLabel="Retry"
        onAction={retryHistory}
        style={styles.historyNotice}
      />
    );
  }

  return (
    <Screen>
      <ChatHeader
        name={name}
        accent={accent}
        image={companion.image}
        statusText={statusText}
        statusTone={statusTone}
        compact={width < 360}
        onBack={onBack}
        onProfile={onProfile}
        onCall={onCallPress}
      />
      {notice}
      <ChatThread
        msgs={threadMsgs}
        live={chat.live}
        name={name}
        accent={accent}
        recall={!!memoryCount}
        busy={chat.busy}
        actions={actions}
        top={top}
        bottom={bottom}
        hasOlder={arrived && history === 'ready' && hasOlder}
        olderState={olderState}
        onOlder={loadOlder}
      />
      {offerStarters ? (
        <StarterRow starters={starters} chosen={draftStarter ?? ''} visible={startersVisible} onPick={pickStarter} />
      ) : null}
      <ChatInput
        ref={chat.inputRef}
        defaultDraft={draftStart.text}
        onDraftChange={onDraftChange}
        onSubmit={chat.send}
        companionName={name}
        busy={chat.busy}
      />
      <ReportSheet turnId={report.turnId} onClose={report.close} returnFocusRef={report.from} />
    </Screen>
  );
}

// Presence first: who you're talking to, and how much of you they hold.
// Memoized: it changes with the status line, not with the thread.
const ChatHeader = memo(function ChatHeader({
  name, accent, image, statusText, statusTone, compact, onBack, onProfile, onCall,
}: {
  name: string; accent: string; image?: string; statusText: string; statusTone: StatusTone; compact: boolean;
  onBack: () => void; onProfile: () => void; onCall: () => void;
}) {
  return (
    <View style={styles.header}>
      <AuroraLine height={1} style={styles.headerEdge} />
      <BackButton onPress={onBack} />
      <Pressable
        onPress={onProfile}
        accessibilityRole="button"
        accessibilityLabel={`${name}, profile`}
        accessibilityValue={statusText ? { text: statusText } : undefined}
        accessibilityHint="Opens their profile"
        style={({ pressed }) => [styles.who, pressed ? styles.pressed : null]}
      >
        <Avatar name={name} color={accent} size={40} image={image} breathe={false} />
        <View style={styles.whoText}>
          <Txt variant="headline" maxScale={1.3} numberOfLines={1} ellipsizeMode="tail" color={W.cream}>{name}</Txt>
          {statusText ? (
            <View style={styles.statusRow}>
              {statusTone === 'offline' ? <View style={styles.offlineDot} /> : null}
              <Txt variant="caption" maxScale={1.3} numberOfLines={1} color={STATUS_COLOR[statusTone]} style={styles.statusText}>
                {statusText}
              </Txt>
            </View>
          ) : null}
        </View>
      </Pressable>
      <CallButton name={name} compact={compact} onPress={onCall} />
    </View>
  );
});

// A thread with nothing in it yet. Said by the app, not put in the
// companion's mouth, and it claims nothing about the past.
function ThreadIntro({ name, accent, image }: { name: string; accent: string; image?: string }) {
  const [entering] = useState(() => enter.fadeUp);
  return (
    <Animated.View entering={entering} style={styles.intro}>
      <Avatar name={name} color={accent} size={64} image={image} breathe={false} />
      <Txt variant="title3" heading numberOfLines={2} style={styles.introTitle}>{name}</Txt>
      <Txt variant="subhead" style={styles.introBody}>Say hello, or whatever's on your mind.</Txt>
    </Animated.View>
  );
}

const CALL_H = 36;

// Aurora "Call" pill. Its glow sits on an opaque, unclipped layer so iOS
// draws it; the gradient is clipped inside.
function CallButton({ name, compact, onPress }: { name: string; compact: boolean; onPress: () => void }) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall, haptic: 'medium' });
  return (
    <Animated.View style={[styles.callOuter, press.animatedStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={compact ? minTarget(CALL_H) : minTarget(HIT, CALL_H)}
        accessibilityRole="button"
        accessibilityLabel={`Voice call ${name}`}
        style={[styles.call, compact ? styles.callCompact : null]}
      >
        <LinearGradient colors={GRAD.aurora} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <NavIcon name="phone" color={W.onAccent} size={15} />
        {compact ? null : <Txt variant="footnote" weight={700} maxScale={1.2} color={W.onAccent}>Call</Txt>}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },

  header: {
    paddingHorizontal: SP.base, paddingTop: SP.xs2, paddingBottom: SP.md,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
  },
  headerEdge: { top: undefined, bottom: 0, opacity: 0.5 },
  who: { flex: 1, minWidth: 0, minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: SP.sm2 },
  whoText: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs2, marginTop: 1 },
  statusText: { flexShrink: 1 },
  offlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: W.textMuted },

  callOuter: { borderRadius: R.pill, backgroundColor: W.rose, ...ELEV.glow(W.rose, 16, 0.35), shadowOffset: { width: 0, height: 6 } },
  call: {
    minHeight: CALL_H, paddingHorizontal: SP.base, borderRadius: R.pill, overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs2,
  },
  callCompact: { width: CALL_H, paddingHorizontal: 0 },

  historyNotice: { marginHorizontal: SP.base, marginBottom: SP.sm },

  intro: { alignItems: 'center', gap: SP.sm, paddingTop: SP.xl, paddingBottom: SP.base, paddingHorizontal: SP.xl },
  introTitle: { color: W.cream, textAlign: 'center', marginTop: SP.xs },
  introBody: { color: W.text2, textAlign: 'center' },

  starters: { flexGrow: 0 },
  startersContent: { paddingHorizontal: SP.base, paddingTop: SP.xs, paddingBottom: SP.sm, gap: SP.sm },

  s09Title: { alignItems: 'center', maxWidth: '100%' },
  skip: { minHeight: HIT, minWidth: HIT, paddingHorizontal: SP.xs2, alignItems: 'center', justifyContent: 'center' },
  continue: { paddingHorizontal: SP.base, paddingTop: SP.xs, paddingBottom: SP.sm },
});
