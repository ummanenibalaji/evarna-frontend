// Chat.tsx — S09 First Conversation and S14 Chat.
// (S12 Voice Call lives in VoiceCall.tsx.)
//
// Both screens share one engine (useChat) and one thread (ChatThread):
// messages are updated by id, a reply that fails says so under the message
// instead of in the companion's voice, and a crisis response keeps the user in
// their conversation with support shown inline.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { endSession, getCharacterSessions, getConversationTurns, getMemories, startSession } from '../api';
import { ApiError, isNetworkError, limitMessage, streamConversation, type SseErrorInfo } from '../api/client';
import { announce } from '../hooks/useAccessibilityPrefs';
import { aiNoticeText } from '../lib/aiNotice';
import { readCache, writeCache } from '../lib/cache';
import {
  buildRows, historyFromSessions, mergeHistory, patchMsg, restoreDraft, settledThread, type ChatMsg,
} from '../lib/chatTurns';
import { haptic } from '../lib/haptics';
import { addPushReceivedListener, setForegroundThread } from '../lib/notifications';
import { enter, exit, timing, usePressFeedback } from '../theme/motion';
import { ELEV, GRAD, HIT, MOTION, R, SP, W } from '../theme/theme';
import { Avatar } from '../components/Avatar';
import { AuroraLine, BackButton, InlineNotice, PrimaryButton, Skeleton, minTarget } from '../components/Atoms';
import {
  AiNotice, BubbleMem, CapHitCard, ChatInput, DayDivider, JumpToLatest, MessageNote, RecallIndicator,
  SuggestionChip, TypingDots, useAiNoticeRepeat, useStickToBottom,
} from '../components/ChatBits';
import { Screen, TopBar } from '../components/Chrome';
import { CrisisResourceCard } from '../components/CrisisResourceCard';
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

// Newest turns kept on screen; a thread longer than this starts partway in.
const HISTORY_CAP = 150;
// Turns kept in the on-device copy that paints before the network answers.
const CACHE_KEEP = 60;
const threadKey = (characterId: string) => `chat-thread:${characterId}`;

// Per companion, for this app run: the unsent draft and the last thread shown,
// so leaving for a call or the profile loses nothing and returning is instant.
const drafts = new Map<string, string>();
const threads = new Map<string, ChatMsg[]>();

let pairSeq = 0;
const newPair = () => `l${Date.now().toString(36)}${(pairSeq++).toString(36)}`;
const userId_ = (pair: string) => `${pair}:u`;
const replyId = (pair: string) => `${pair}:r`;

// Conversation starters by archetype. The backend doesn't suggest replies yet.
const STARTERS: Record<string, string[]> = {
  mentor: ['Help me think something through', 'What should I focus on this week?', 'Give me honest feedback'],
  friend: ['I just need to vent', 'Guess what happened today', 'Distract me for a bit'],
  partner: ['I missed you', 'Can I tell you about my day?', 'I could use some reassurance'],
  challenger: ['Push me harder', 'Run a mock round', 'Call me out on something'],
};

const D = MOTION.duration;
const fade = (ms: number) => ({ ...timing(ms), reduceMotion: ReduceMotion.Never });

// ─── The engine ──────────────────────────────────────────────────────────
interface ChatOptions {
  userId?: string;
  characterId?: string;
  name: string;
  initial: () => ChatMsg[];
  /** Keeps this companion's unsent draft across visits. */
  draftKey?: string;
  /** Text handed in by the router (a notification reply that failed, a mood). */
  initialDraft?: string;
  onQuotaRefused?: () => void;
}

/**
 * Sending and receiving for one conversation.
 *
 * The text session starts on the first send, not on open: an empty session
 * per visit used to push real history out of the ten the history lookup reads,
 * and spent the hourly session budget. One reply is in flight at a time;
 * the draft stays editable meanwhile.
 */
function useChat(o: ChatOptions) {
  const opts = useRef(o);
  opts.current = o;
  const [msgs, setMsgs] = useState<ChatMsg[]>(o.initial);
  const [draft, setDraft] = useState(() =>
    o.initialDraft?.trim() ? o.initialDraft : (o.draftKey && drafts.get(o.draftKey)) || '');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [offline, setOffline] = useState(false);
  const [replies, setReplies] = useState(0);
  const [failures, setFailures] = useState(0);
  // Replies in the current session — what a recap would have to show.
  const [sessionReplies, setSessionReplies] = useState(0);
  const session = useRef<Promise<string> | null>(null);
  const sessionId = useRef<string | null>(null);
  const stream = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const busy = msgs.some(m => m.streaming);

  useEffect(() => {
    if (!o.draftKey) return;
    if (draft) drafts.set(o.draftKey, draft);
    else drafts.delete(o.draftKey);
  }, [draft, o.draftKey]);

  // A draft handed over after mount fills an empty box; it never replaces
  // something the user is writing.
  useEffect(() => {
    const given = o.initialDraft;
    if (given?.trim()) setDraft(d => restoreDraft(d, given));
  }, [o.initialDraft]);

  useEffect(() => () => {
    alive.current = false;
    stream.current?.abort();
    // End the session this visit started — now, or when a slow start lands.
    session.current?.then(id => endSession(id)).catch(() => {});
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
  const endVisit = () => {
    const started = session.current;
    session.current = null;
    sessionId.current = null;
    setSessionReplies(0);
    started?.then(id => endSession(id)).catch(() => {});
  };

  const refuse = (limited: Refusal, pair: string, text: string) => {
    // Take back the two bubbles this send added, and hand the text back so
    // nothing anyone typed is lost.
    setMsgs(m => m.filter(x => x.pair !== pair));
    setDraft(d => restoreDraft(d, text));
    setRefusal(limited);
    opts.current.onQuotaRefused?.();
    haptic.warning();
  };

  const fail = (pair: string, e: unknown, info: SseErrorInfo | undefined, partial: string) => {
    if (isNetworkError(info ?? e)) setOffline(true);
    // The session is gone server-side; the next try starts a new one.
    if (info?.status === 404) {
      session.current = null;
      sessionId.current = null;
    }
    setFailures(n => n + 1);
    haptic.error();
    if (partial) {
      // Part of the reply arrived. A dropped connection doesn't stop the
      // server, which finishes and saves the reply; a server failure saves
      // nothing, so that one is asked again.
      const failed = info?.code === 'STREAM_ERROR' ? 'interrupted' : 'dropped';
      setMsgs(m => patchMsg(m, replyId(pair), { streaming: false, failed }));
      announce(failed === 'dropped' ? 'The connection dropped before the reply finished.' : 'The reply was interrupted.');
      return;
    }
    const note = unsentNote(e, info);
    setMsgs(m => patchMsg(m.filter(x => x.id !== replyId(pair)), userId_(pair), { failed: 'unsent', note }));
    announce(note);
  };

  const deliver = (pair: string, text: string) => {
    ensureSession().then(sid => {
      if (!alive.current) return;
      setOffline(false);
      let acc = '';
      stream.current = streamConversation({ session_id: sid, message: text }, {
        onChunk: chunk => {
          acc += chunk;
          setMsgs(m => patchMsg(m, replyId(pair), x => ({ ...x, text: x.text + chunk })));
        },
        onDone: turnId => {
          setMsgs(m => patchMsg(m, replyId(pair), { streaming: false, ...(turnId ? { turnId } : null) }));
          setReplies(n => n + 1);
          // A reply that lands after the visit's session was ended belongs to that one.
          if (sessionId.current === sid) setSessionReplies(n => n + 1);
          if (acc.trim()) announce(`${opts.current.name}: ${acc.trim()}`);
        },
        // The server's crisis response replaces the reply. It is what the
        // server saved as the companion's turn; support follows it inline.
        onCrisis: content => {
          setMsgs(m => patchMsg(m, replyId(pair), x => ({ ...x, text: content || x.text, streaming: false, crisis: true })));
          setReplies(n => n + 1);
          if (sessionId.current === sid) setSessionReplies(n => n + 1);
          if (content) announce(`${opts.current.name}: ${content}`);
        },
        onError: (message, info) => {
          const limited = refusalOf(message, info);
          if (limited) refuse(limited, pair, text);
          else fail(pair, message, info, acc);
        },
      });
    }, e => {
      if (!alive.current) return;
      const limited = refusalOf(e);
      if (limited) refuse(limited, pair, text);
      else fail(pair, e, undefined, '');
    });
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    // A new attempt clears the last refusal: the cap resets at midnight, and a
    // card that never goes away would outlive the limit it describes.
    setRefusal(null);
    const pair = newPair();
    const at = Date.now();
    setMsgs(m => [
      ...m,
      { id: userId_(pair), from: 'user', text, at, local: true, pair },
      { id: replyId(pair), from: 'comp', text: '', at, local: true, pair, streaming: true },
    ]);
    setDraft('');
    deliver(pair, text);
  };

  const retry = (pair: string) => {
    const user = msgs.find(x => x.id === userId_(pair));
    if (!user || busy) return;
    setRefusal(null);
    const at = Date.now();
    // Sent again, it moves to the end, so the thread reads in the order
    // things happened.
    setMsgs(m => [
      ...m.filter(x => x.pair !== pair),
      { ...user, failed: undefined, note: undefined, at },
      { id: replyId(pair), from: 'comp', text: '', at, local: true, pair, streaming: true },
    ]);
    deliver(pair, user.text);
  };

  const currentSession = useCallback(() => sessionId.current, []);

  return {
    msgs, setMsgs, draft, setDraft, send, retry, busy,
    refusal, offline, setOffline, replies, failures, sessionReplies, endVisit, currentSession,
  };
}

// ─── The thread ──────────────────────────────────────────────────────────
interface ThreadProps {
  msgs: ChatMsg[];
  name: string;
  accent: string;
  /** "recalling your memories…" while a reply is composed — only when there are memories. */
  recall: boolean;
  loading?: boolean;
  top?: React.ReactNode;
  bottom?: React.ReactNode;
  onReport: (turnId: string) => void;
  onRetry: (pair: string) => void;
  onReload?: () => void;
  onMemoryClick?: (ref: string) => void;
  onMoreSupport: () => void;
}

function ChatThread({
  msgs, name, accent, recall, loading = false, top, bottom, onReport, onRetry, onReload, onMemoryClick, onMoreSupport,
}: ThreadProps) {
  const stick = useStickToBottom();
  const { pin, arrived } = stick;
  const rows = useMemo(() => buildRows(msgs, Date.now()), [msgs]);

  // A send always brings the thread to its end; a reply that lands while the
  // reader is up in the history earns the "New message" button instead.
  const last = msgs[msgs.length - 1];
  const lastKey = last ? `${last.id}|${last.text ? 1 : 0}|${last.streaming ? 1 : 0}` : '';
  const seen = useRef(lastKey);
  useEffect(() => {
    if (lastKey === seen.current) return;
    seen.current = lastKey;
    if (!last || last.from !== 'comp') return;
    if (last.local && last.streaming && !last.text) pin();
    else if (last.text) arrived();
  }, [lastKey, last, pin, arrived]);

  return (
    <View style={styles.thread}>
      <ScrollView ref={stick.scrollRef} style={styles.thread} contentContainerStyle={styles.threadContent} {...stick.scrollProps}>
        {top}
        {loading ? <SkeletonBubbles /> : null}
        {rows.map(row => {
          if (row.kind === 'stamp') return <DayDivider key={row.key} label={row.label} />;
          if (row.kind === 'voice') return <DayDivider key={row.key} label="Voice call" icon="phone" />;
          const m = row.msg;
          const gap = row.grouped ? styles.grouped : styles.spaced;
          if (m.from === 'notice') return <View key={row.key} style={styles.spaced}><AiNotice text={m.text} /></View>;
          if (m.streaming && !m.text) {
            return (
              <Animated.View key={row.key} entering={enter.fade} style={[gap, styles.pending]}>
                {recall ? <RecallIndicator /> : null}
                <TypingDots name={name} />
              </Animated.View>
            );
          }
          return (
            <View key={row.key} style={gap}>
              {m.text ? <BubbleMem
                from={m.from}
                text={m.text}
                memoryRefs={m.memoryRefs}
                accent={accent}
                speaker={name}
                streaming={m.streaming}
                animateIn={!!m.local}
                onMemoryClick={onMemoryClick}
                // Only a reply the backend has saved can be reported.
                reportId={m.from === 'comp' ? m.turnId : undefined}
                onReport={onReport}
              /> : null}
              {m.failed === 'unsent' && m.pair ? (
                <MessageNote align="end" text={m.note ?? 'Not sent.'} actionLabel="Retry" actionHint="Sends it again" onAction={() => onRetry(m.pair!)} />
              ) : null}
              {m.failed === 'dropped' ? (
                <MessageNote
                  text="The connection dropped before the reply finished."
                  actionLabel={onReload ? 'Reload' : undefined}
                  actionHint="Loads the whole reply"
                  onAction={onReload}
                />
              ) : null}
              {m.failed === 'interrupted' && m.pair ? (
                <MessageNote text="The reply was interrupted." actionLabel="Retry" actionHint="Asks again" onAction={() => onRetry(m.pair!)} />
              ) : null}
              {m.crisis ? <CrisisResourceCard onMore={onMoreSupport} /> : null}
            </View>
          );
        })}
        {bottom}
      </ScrollView>
      {/* Always mounted, so the button can animate out. */}
      <View pointerEvents="box-none" style={styles.jumpDock}>
        {stick.showJump ? <JumpToLatest unseen={stick.unseen} onPress={stick.jump} /> : null}
      </View>
    </View>
  );
}

// Placeholder bubbles while history loads — shaped like a thread, never like
// "typing", which would claim the companion is writing.
const SKELETON_ROWS: { w: `${number}%`; mine?: boolean }[] = [{ w: '62%' }, { w: '42%', mine: true }, { w: '70%' }];

function SkeletonBubbles() {
  return (
    <View accessible accessibilityLabel="Loading your conversation" accessibilityState={{ busy: true }} style={styles.skeleton}>
      {SKELETON_ROWS.map((r, i) => (
        <Skeleton key={i} width={r.w} height={HIT} radius={R.bubble} style={r.mine ? styles.end : styles.start} />
      ))}
    </View>
  );
}

// ─── Starters ────────────────────────────────────────────────────────────
// Offered when a visit begins, until the first send. The row keeps its place
// while the user types, so the thread above never jumps; it only fades.
function StarterRow({ starters, draft, visible, onPick }: {
  starters: string[]; draft: string; visible: boolean; onPick: (s: string) => void;
}) {
  const v = useSharedValue(visible ? 1 : 0);
  useEffect(() => { v.value = withTiming(visible ? 1 : 0, fade(D.fast)); }, [visible, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  const [entering] = useState(() => enter.fade);
  const [exiting] = useState(() => exit.fade);
  const chosen = draft.trim();

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
}

// ─── S09 FIRST CONVERSATION ──────────────────────────────────────────────
export function S09_FirstChat({ go, companion, userId, characterId, isMinor = false, textRemainingToday = null, textDailyCap = null, textResetsAt = null, textUpsell = true, onQuotaRefused, onCapUpgrade }: {
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
  const chat = useChat({ userId, characterId, name, initial: () => [greeting], onQuotaRefused });
  const { setMsgs } = chat;
  useAiNoticeRepeat(() => setMsgs(m => [...m, { id: `notice-${Date.now()}`, from: 'notice', text: aiNoticeText(name, isMinor, true), at: 0, local: true }]));

  const capHit = chat.refusal != null || (textRemainingToday != null && textRemainingToday <= 0);
  // The way on appears after a reply lands — or when talking isn't working,
  // so nobody is stuck here — and the composer stays either way.
  const canContinue = chat.replies > 0 || chat.failures >= 2 || capHit;

  const [reportTurn, setReportTurn] = useState<string | null>(null);
  const onReport = useCallback((turnId: string) => { haptic.medium(); setReportTurn(turnId); }, []);
  const closeReport = useCallback(() => setReportTurn(null), []);
  const [continueEntering] = useState(() => enter.fadeUp);

  // A dropped reply: this session's turns, which the server finished saving.
  const { currentSession, setOffline } = chat;
  const reload = useCallback(async () => {
    const sid = currentSession();
    if (!sid) return;
    try {
      const { turns } = await getConversationTurns(sid);
      const saved = historyFromSessions([{ id: sid, voice: false, turns }], HISTORY_CAP);
      // Every turn in this session is new since the chat opened.
      setMsgs(m => mergeHistory([greeting, ...saved], m, 0));
      setOffline(false);
    } catch (e) {
      if (isNetworkError(e)) setOffline(true);
      announce("Couldn't reload. Check your connection.");
    }
  }, [currentSession, setMsgs, setOffline, greeting]);

  return (
    <Screen>
      <TopBar
        glass
        border
        center={
          <View accessible accessibilityRole="header" accessibilityLabel={`${name}, guided first chat`} style={styles.s09Title}>
            <Txt variant="headline" maxScale={1.3} numberOfLines={1} style={{ color: W.cream }}>{name}</Txt>
            <Txt variant="caption" maxScale={1.3} numberOfLines={1} style={{ color: W.text2 }}>Guided first chat</Txt>
          </View>
        }
        right={canContinue ? null : (
          <Pressable
            onPress={() => go('home')}
            accessibilityRole="button"
            accessibilityHint="Goes to your home screen"
            style={({ pressed }) => [styles.skip, pressed ? styles.pressed : null]}
          >
            <Txt variant="subhead" weight={600} maxScale={1.3} style={{ color: W.primarySoft }}>Skip</Txt>
          </Pressable>
        )}
      />
      <ChatThread
        msgs={chat.msgs}
        name={name}
        accent={W.primary}
        recall={false}
        top={<AiNotice text={aiNoticeText(name, isMinor, false)} />}
        bottom={capHit ? (
          <CapHitCard
            onUpgrade={() => { onCapUpgrade?.(); go('paywall'); }}
            dailyCap={textDailyCap}
            resetsAt={textResetsAt}
            upsell={textUpsell && (chat.refusal?.planCap ?? true)}
            message={chat.refusal?.message ?? null}
          />
        ) : null}
        onReport={onReport}
        onRetry={chat.retry}
        onReload={reload}
        onMoreSupport={() => go('crisis')}
      />
      {canContinue ? (
        <Animated.View entering={continueEntering} style={styles.continue}>
          <PrimaryButton onPress={() => go('home')} trailingArrow>Continue to home</PrimaryButton>
        </Animated.View>
      ) : null}
      <ChatInput draft={chat.draft} setDraft={chat.setDraft} onSend={chat.send} companionName={name} busy={chat.busy} />
      <ReportSheet turnId={reportTurn} onClose={closeReport} />
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

type Status = { text: string; tone: 'typing' | 'offline' | 'memory' | 'plain' };
const STATUS_COLOR: Record<Status['tone'], string> = {
  typing: W.primarySoft, offline: W.text2, memory: W.gold, plain: W.text2,
};

export function S14_Chat({
  go, companion, accent = W.primary, openMemorySheet, textRemainingToday = null, textDailyCap = null,
  textResetsAt = null, textUpsell = true, onQuotaRefused, onCapUpgrade, userId, characterId, isMinor = false,
  initialDraft, onCall,
}: ChatProps) {
  const name = companion.name;
  const { width } = useWindowDimensions();
  const [cached] = useState(() => (characterId ? threads.get(characterId) : undefined));
  const chat = useChat({
    userId, characterId, name, initial: () => cached ?? [], draftKey: String(companion.id), initialDraft, onQuotaRefused,
  });
  const { msgs, setMsgs, setOffline } = chat;
  useAiNoticeRepeat(() => setMsgs(m => [...m, { id: `notice-${Date.now()}`, from: 'notice', text: aiNoticeText(name, isMinor, true), at: 0, local: true }]));

  // ── History: the saved thread paints first, the server's answer replaces it.
  const [history, setHistory] = useState<'loading' | 'ready' | 'error'>(cached || !characterId ? 'ready' : 'loading');
  const [historyIssue, setHistoryIssue] = useState<'offline' | 'failed' | null>(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const knownUntil = useRef<number | null>(null);
  const loaded = useRef(false);
  const loadSeq = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const loadHistory = useCallback(async () => {
    if (!characterId) return;
    const seq = ++loadSeq.current;
    const known = knownUntil.current;
    try {
      const { sessions } = await getCharacterSessions(characterId);
      const lists = await Promise.all(sessions.map(async s => ({
        id: s._id,
        voice: s.session_type === 'voice_call',
        turns: (await getConversationTurns(s._id)).turns,
      })));
      if (!alive.current || seq !== loadSeq.current) return;
      const saved = historyFromSessions(lists, HISTORY_CAP);
      knownUntil.current = saved.length ? saved[saved.length - 1].at : known ?? 0;
      loaded.current = true;
      setMsgs(m => mergeHistory(saved, m, known));
      setHistory('ready');
      setHistoryIssue(null);
      setOffline(false);
      threads.set(characterId, saved);
      if (userId) void writeCache(userId, threadKey(characterId), saved.slice(-CACHE_KEEP));
    } catch (e) {
      if (!alive.current || seq !== loadSeq.current) return;
      const offline = isNetworkError(e);
      if (offline) setOffline(true);
      setHistoryIssue(offline ? 'offline' : 'failed');
      setHistory(h => (h === 'loading' ? 'error' : h));
    }
  }, [characterId, userId, setMsgs, setOffline]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  // Cold start: the copy saved on this phone, while the network answers.
  useEffect(() => {
    if (cached || !characterId || !userId) return;
    let live = true;
    readCache<ChatMsg[]>(userId, threadKey(characterId)).then(saved => {
      if (!live || !saved?.length || loaded.current) return;
      setMsgs(m => [...saved, ...m.filter(x => x.local)]);
      setHistory('ready');
    });
    return () => { live = false; };
  }, [cached, characterId, userId, setMsgs]);

  const retryHistory = useCallback(() => {
    setHistory(h => (h === 'error' ? 'loading' : h));
    setHistoryIssue(null);
    void loadHistory();
  }, [loadHistory]);

  // Back online (a send got through): fetch what couldn't load while offline.
  const offlineBefore = useRef(chat.offline);
  useEffect(() => {
    const cameBack = offlineBefore.current && !chat.offline;
    offlineBefore.current = chat.offline;
    if (cameBack && historyIssue === 'offline') retryHistory();
  }, [chat.offline, historyIssue, retryHistory]);

  // Leaving keeps the thread, so coming back paints at once.
  const msgsRef = useRef(msgs);
  msgsRef.current = msgs;
  useEffect(() => () => {
    if (!characterId || historyRef.current !== 'ready') return;
    const settled = settledThread(msgsRef.current);
    threads.set(characterId, settled);
    if (userId) void writeCache(userId, threadKey(characterId), settled.slice(-CACHE_KEEP));
  }, [characterId, userId]);

  // While this chat is open its pushes arrive silently, and the message they
  // carry is fetched into the thread instead.
  useEffect(() => {
    if (!characterId) return;
    setForegroundThread(characterId);
    const off = addPushReceivedListener(d => { if (d.character_id === characterId) void loadHistory(); });
    return () => {
      off();
      setForegroundThread(null);
    };
  }, [characterId, loadHistory]);

  // How much of the user this companion holds — the header's gold line, and
  // whether a pause before a reply is memory recall.
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  useEffect(() => {
    if (!characterId) return;
    let live = true;
    getMemories(characterId).then(ms => { if (live) setMemoryCount(ms.length); }, () => {});
    return () => { live = false; };
  }, [characterId]);

  const [reportTurn, setReportTurn] = useState<string | null>(null);
  const onReport = useCallback((turnId: string) => { haptic.medium(); setReportTurn(turnId); }, []);
  const closeReport = useCallback(() => setReportTurn(null), []);

  const capHit = chat.refusal != null || (textRemainingToday != null && textRemainingToday <= 0);
  const talked = msgs.some(m => m.local && m.from === 'user');
  const starters = STARTERS[companion.archetype] ?? QUICK_REPLIES;
  const typed = chat.draft.trim();
  const offerStarters = history === 'ready' && !historyIssue && !capHit && !talked && !chat.busy;
  const startersVisible = offerStarters && (!typed || starters.includes(typed));
  const pickStarter = useCallback((s: string) => chat.setDraft(d => (d.trim() === s ? '' : s)), [chat.setDraft]);

  const nothingShown = !msgs.some(m => m.from !== 'notice');
  const empty = history === 'ready' && !historyIssue && nothingShown;

  const status: Status = chat.busy
    ? { text: 'typing…', tone: 'typing' }
    : chat.offline
      ? { text: 'Offline', tone: 'offline' }
      : memoryCount
        ? { text: `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}`, tone: 'memory' }
        : { text: ARCHETYPE_LABEL[companion.archetype] ?? '', tone: 'plain' };

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
      {/* Presence first: who you're talking to, and how much of you they hold. */}
      <View style={styles.header}>
        <AuroraLine height={1} style={styles.headerEdge} />
        {/* Back from a conversation shows its recap; with nothing said, home.
            The recap may open over this screen, so the session ends here
            rather than on unmount: its summary is only written once it ends. */}
        <BackButton
          onPress={() => {
            if (chat.sessionReplies === 0) { go('home'); return; }
            chat.endVisit();
            go('recap');
          }}
        />
        <Pressable
          onPress={() => go('profile')}
          accessibilityRole="button"
          accessibilityLabel={`${name}, profile`}
          accessibilityValue={status.text ? { text: status.text } : undefined}
          accessibilityHint="Opens their profile"
          style={({ pressed }) => [styles.who, pressed ? styles.pressed : null]}
        >
          <Avatar name={name} color={accent} size={40} image={companion.image} breathe={false} />
          <View style={styles.whoText}>
            <Txt variant="headline" maxScale={1.3} numberOfLines={1} ellipsizeMode="tail" style={{ color: W.cream }}>{name}</Txt>
            {status.text ? (
              <View style={styles.statusRow}>
                {status.tone === 'offline' ? <View style={styles.offlineDot} /> : null}
                <Txt variant="caption" maxScale={1.3} numberOfLines={1} style={[styles.statusText, { color: STATUS_COLOR[status.tone] }]}>
                  {status.text}
                </Txt>
              </View>
            ) : null}
          </View>
        </Pressable>
        <CallButton name={name} compact={width < 360} onPress={onCall ?? (() => go('call'))} />
      </View>
      {notice}
      <ChatThread
        msgs={msgs}
        name={name}
        accent={accent}
        recall={!!memoryCount}
        loading={history === 'loading'}
        top={
          <>
            <AiNotice text={aiNoticeText(name, isMinor, false)} />
            {empty ? <ThreadIntro name={name} accent={accent} image={companion.image} /> : null}
          </>
        }
        bottom={capHit ? (
          <CapHitCard
            onUpgrade={() => { onCapUpgrade?.(); go('paywall'); }}
            dailyCap={textDailyCap}
            resetsAt={textResetsAt}
            upsell={textUpsell && (chat.refusal?.planCap ?? true)}
            message={chat.refusal?.message ?? null}
          />
        ) : null}
        onReport={onReport}
        onRetry={chat.retry}
        onReload={retryHistory}
        onMemoryClick={openMemorySheet}
        onMoreSupport={() => go('crisis')}
      />
      {offerStarters ? <StarterRow starters={starters} draft={chat.draft} visible={startersVisible} onPick={pickStarter} /> : null}
      <ChatInput draft={chat.draft} setDraft={chat.setDraft} onSend={chat.send} companionName={name} busy={chat.busy} />
      <ReportSheet turnId={reportTurn} onClose={closeReport} />
    </Screen>
  );
}

// A thread with nothing in it yet. Said by the app, not put in the
// companion's mouth, and it claims nothing about the past: the history
// lookup only reads the newest sessions.
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
        {compact ? null : <Txt variant="footnote" weight={700} maxScale={1.2} style={{ color: W.onAccent }}>Call</Txt>}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  end: { alignSelf: 'flex-end' },
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

  thread: { flex: 1 },
  threadContent: { paddingHorizontal: SP.base, paddingTop: SP.sm, paddingBottom: SP.md },
  grouped: { marginTop: SP.xxs },
  spaced: { marginTop: SP.sm },
  pending: { gap: SP.xs2 },
  skeleton: { gap: SP.sm2, paddingTop: SP.sm },
  jumpDock: { position: 'absolute', left: 0, right: 0, bottom: SP.sm, alignItems: 'center' },

  intro: { alignItems: 'center', gap: SP.sm, paddingTop: SP.xl, paddingBottom: SP.base, paddingHorizontal: SP.xl },
  introTitle: { color: W.cream, textAlign: 'center', marginTop: SP.xs },
  introBody: { color: W.text2, textAlign: 'center' },

  starters: { flexGrow: 0 },
  startersContent: { paddingHorizontal: SP.base, paddingTop: SP.xs, paddingBottom: SP.sm, gap: SP.sm },

  s09Title: { alignItems: 'center', maxWidth: '100%' },
  skip: { minHeight: HIT, minWidth: HIT, paddingHorizontal: SP.xs2, alignItems: 'center', justifyContent: 'center' },
  continue: { paddingHorizontal: SP.base, paddingTop: SP.xs, paddingBottom: SP.sm },
});
