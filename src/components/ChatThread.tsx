// ChatThread.tsx — the conversation list shared by the first chat (S09) and
// the chat (S14), and the live store the reply being written streams into.
//
// Built so a long thread costs the same as a short one:
//   - an inverted FlatList: only the rows near the screen are mounted, the
//     newest paint first, and the list rests on its latest message without
//     scrolling there after every change
//   - rows are memoized and receive only stable props, so a send, a reply
//     landing or a history refresh re-renders just the rows that changed
//   - the reply being streamed is read from LiveReply by its own row, so a
//     token re-renders one bubble instead of the screen

import React, {
  createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { FlatList, StyleSheet, View, type ListRenderItemInfo } from 'react-native';
import Animated from 'react-native-reanimated';

import { buildRows, type ChatMsg, type ThreadRow } from '../lib/chatTurns';
import { enter } from '../theme/motion';
import { HIT, R, SP } from '../theme/theme';
import { Skeleton } from './Atoms';
import {
  AiNotice, BubbleMem, DayDivider, JumpToLatest, MessageNote, RecallIndicator, TypingDots, useStickToBottom,
  type NoteAction,
} from './ChatBits';
import { CrisisResourceCard } from './CrisisResourceCard';

// ─── LiveReply ───────────────────────────────────────────────────────────
/**
 * The text of the one reply being streamed, outside React state. The screen
 * pushes chunks in and commits the final text to its message list once;
 * only the row showing that reply subscribes.
 */
export interface LiveReply {
  subscribe(listener: () => void): () => void;
  /** What has streamed so far for message `id` ('' unless it is the one streaming). */
  text(id: string): string;
  /** The message streaming now, and what of it is shown. */
  current(): { id: string | null; text: string };
  /** A new reply begins: nothing shown yet (the typing dots). */
  start(id: string): void;
  push(id: string, chunk: string): void;
  /** Stops publishing. What was shown stays readable, so the bubble doesn't
   *  blink back to the dots before the committed message replaces it. */
  end(id: string): void;
}

// The first words replace the typing dots at once; after that the bubble
// catches up about 20 times a second instead of on every frame, which reads
// just as smoothly and leaves the JS thread free for typing and scrolling.
const PUBLISH_MS = 50;

export function createLiveReply(): LiveReply {
  let id: string | null = null;
  let received = '';
  let shown = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach(l => l());
  const publish = () => {
    timer = null;
    if (shown === received) return;
    shown = received;
    emit();
  };
  const stopTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    text: key => (key === id ? shown : ''),
    current: () => ({ id, text: shown }),
    start(key) {
      stopTimer();
      id = key;
      received = '';
      shown = '';
      emit();
    },
    push(key, chunk) {
      if (key !== id || !chunk) return;
      received += chunk;
      if (!shown) publish();
      else if (!timer) timer = setTimeout(publish, PUBLISH_MS);
    },
    end(key) {
      if (key === id) stopTimer();
    },
  };
}

const noSubscribe = () => () => {};

/** The streamed text for `id`, re-rendering only the caller; '' for null. */
function useLiveText(live: LiveReply, id: string | null): string {
  return useSyncExternalStore(id ? live.subscribe : noSubscribe, () => (id ? live.text(id) : ''));
}

// ─── Thread ──────────────────────────────────────────────────────────────
/** What the rows can ask of the screen. Pass a memoized object: a new one
 *  re-renders every row. */
export interface ThreadActions {
  /** Opens the report sheet; `from` is the bubble, for VoiceOver focus to return to. */
  onReport: (turnId: string, from: React.RefObject<View | null>) => void;
  /** Sends an exchange's message again (after checking, when unsure). */
  onRetry: (pair: string) => void;
  /** Looks for a dropped reply on the server. */
  onReload?: (pair: string) => void;
  onMemoryClick?: (ref: string) => void;
  onMoreSupport: () => void;
}

// What only a few rows need and changes a few times per message: kept out of
// row props so the rest don't re-render when it does.
const ThreadState = createContext({ busy: false, recall: false });

// Messages that have already played their entrance this app run. A windowed
// list unmounts rows far out of view; coming back to them isn't an arrival.
const entered = new Set<string>();

const keyOf = (r: ThreadRow) => r.key;

// While the reader is up in the history, what they're looking at stays put as
// rows are added or grow at the latest end. At the end it's left off: the
// inverted list then simply shows the new row, where keeping position would
// shift the render window and mount the newest rows a few frames late.
const KEEP_POSITION = { minIndexForVisible: 0 };

export interface ChatThreadProps {
  msgs: ChatMsg[];
  live: LiveReply;
  name: string;
  accent: string;
  /** "recalling your memories…" while a reply is composed — only when there are memories. */
  recall: boolean;
  /** A reply is on its way: resending waits. */
  busy: boolean;
  actions: ThreadActions;
  /** Above the first message: the AI notice, an intro, the loading skeleton. Memoize it. */
  top?: React.ReactElement | null;
  /** Below the last message: the daily-cap card. Memoize it. */
  bottom?: React.ReactElement | null;
  /** Older turns exist on the server; `onOlder` is asked for them near the top. */
  hasOlder?: boolean;
  olderState?: 'idle' | 'loading' | 'error';
  onOlder?: () => void;
}

export const ChatThread = memo(function ChatThread({
  msgs, live, name, accent, recall, busy, actions, top = null, bottom = null,
  hasOlder = false, olderState = 'idle', onOlder,
}: ChatThreadProps) {
  const stick = useStickToBottom<FlatList<ThreadRow>>({ inverted: true });
  const { pin, arrived } = stick;
  // Newest first, for the inverted list.
  const rows = useMemo(() => buildRows(msgs, Date.now()).reverse(), [msgs]);

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

  // The first words of a streamed reply are an arrival too.
  useEffect(() => {
    let announcedFor: string | null = null;
    return live.subscribe(() => {
      const { id, text } = live.current();
      if (!id || !text || announcedFor === id) return;
      announcedFor = id;
      arrived();
    });
  }, [live, arrived]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ThreadRow>) => {
    if (item.kind === 'stamp') return <DayDivider label={item.label} />;
    if (item.kind === 'voice') return <DayDivider label="Voice call" icon="phone" />;
    return <MsgRow msg={item.msg} grouped={item.grouped} name={name} accent={accent} live={live} actions={actions} />;
  }, [name, accent, live, actions]);

  const state = useMemo(() => ({ busy, recall }), [busy, recall]);

  const olderRef = useRef({ hasOlder, olderState, onOlder });
  olderRef.current = { hasOlder, olderState, onOlder };
  const onEndReached = useCallback(() => {
    const o = olderRef.current;
    if (o.hasOlder && o.olderState === 'idle') o.onOlder?.();
  }, []);

  // In an inverted list the footer is drawn at the top.
  const footer = useMemo(() => (
    <View>
      {hasOlder && olderState !== 'idle' ? <OlderRow state={olderState} onRetry={onOlder} /> : null}
      {top}
    </View>
  ), [hasOlder, olderState, onOlder, top]);

  return (
    <ThreadState.Provider value={state}>
      <View style={styles.thread}>
        <FlatList
          ref={stick.scrollRef}
          data={rows}
          keyExtractor={keyOf}
          renderItem={renderItem}
          inverted
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          ListHeaderComponent={bottom}
          ListFooterComponent={footer}
          // A screenful of short bubbles on an iPhone on first paint; the rest
          // mount in small batches as the reader scrolls.
          initialNumToRender={14}
          maxToRenderPerBatch={8}
          updateCellsBatchingPeriod={50}
          windowSize={9}
          // iOS blanks cells of an inverted list with this on.
          removeClippedSubviews={false}
          maintainVisibleContentPosition={stick.atEnd ? undefined : KEEP_POSITION}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          {...stick.scrollProps}
        />
        {/* Always mounted, so the button can animate out. */}
        <View pointerEvents="box-none" style={styles.jumpDock}>
          {stick.showJump ? <JumpToLatest unseen={stick.unseen} onPress={stick.jump} /> : null}
        </View>
      </View>
    </ThreadState.Provider>
  );
});

// ─── Rows ────────────────────────────────────────────────────────────────
interface MsgRowProps {
  msg: ChatMsg;
  grouped: boolean;
  name: string;
  accent: string;
  live: LiveReply;
  actions: ThreadActions;
}

const MsgRow = memo(function MsgRow({ msg: m, grouped, name, accent, live, actions }: MsgRowProps) {
  const streamed = useLiveText(live, m.streaming ? m.id : null);
  // Only a message sent during this visit rises in, and only the first time.
  const [fresh] = useState(() => !!m.local && !entered.has(m.id));
  useEffect(() => { if (m.local) entered.add(m.id); }, [m.local, m.id]);

  const gap = grouped ? styles.grouped : styles.spaced;
  if (m.from === 'notice') return <View style={styles.spaced}><AiNotice text={m.text} /></View>;

  const text = m.streaming ? streamed : m.text;
  if (m.streaming && !text) return <PendingReply name={name} grouped={grouped} />;

  return (
    <View style={gap}>
      {text ? (
        <BubbleMem
          from={m.from}
          text={text}
          memoryRefs={m.memoryRefs}
          accent={accent}
          speaker={name}
          streaming={m.streaming}
          animateIn={fresh}
          onMemoryClick={actions.onMemoryClick}
          // Only a reply the backend has saved can be reported.
          reportId={m.from === 'comp' ? m.turnId : undefined}
          onReport={actions.onReport}
        />
      ) : null}
      {m.failed && m.pair ? <FailureNote msg={m} name={name} actions={actions} animateIn={fresh} /> : null}
      {m.crisis ? (
        <CrisisResourceCard onMore={actions.onMoreSupport} announceKey={m.id} animateIn={fresh} silent={!m.local} />
      ) : null}
    </View>
  );
});

// The companion is composing: the typing dots, and the recall line when they
// hold memories.
function PendingReply({ name, grouped }: { name: string; grouped: boolean }) {
  const { recall } = useContext(ThreadState);
  const [entering] = useState(() => enter.fade);
  return (
    <Animated.View entering={entering} style={[grouped ? styles.grouped : styles.spaced, styles.pending]}>
      {recall ? <RecallIndicator /> : null}
      <TypingDots name={name} />
    </Animated.View>
  );
}

/** What went wrong with an exchange, and what can be done about it. */
function FailureNote({ msg: m, name, actions, animateIn }: {
  msg: ChatMsg; name: string; actions: ThreadActions; animateIn: boolean;
}) {
  const { busy } = useContext(ThreadState);
  const pair = m.pair!;
  // Sending again waits for the reply on its way, and says so.
  const retry = (hint: string): NoteAction => ({
    label: 'Retry',
    hint,
    onPress: () => actions.onRetry(pair),
    disabled: busy,
    disabledHint: `Available once ${name} has replied`,
  });

  if (m.failed === 'unsent') {
    const action = retry(m.unsure ? 'Checks whether it arrived, and sends it again if not' : 'Sends it again');
    return (
      <MessageNote
        align="end"
        text={m.note ?? 'Not sent.'}
        actions={[{ ...action, busy: !!m.checking, busyLabel: 'Checking…' }]}
        animateIn={animateIn}
      />
    );
  }

  if (m.failed === 'dropped') {
    const text = m.missing
      ? (m.text ? "The rest of the reply hasn't arrived." : "The reply hasn't arrived.")
      : m.note ?? (m.text ? 'The connection dropped before the reply finished.' : 'The connection dropped before the reply arrived.');
    const list: NoteAction[] = [];
    if (actions.onReload) {
      const reload = actions.onReload;
      list.push({
        label: 'Reload', hint: 'Loads the whole reply', onPress: () => reload(pair), busy: !!m.checking, busyLabel: 'Reloading…',
      });
    }
    // Once a Reload has come back without it, the server may never have kept
    // it: asking again is the way on (not while a Reload is still looking).
    if (m.missing || !actions.onReload) {
      const again = retry('Asks again');
      list.push(m.checking ? { ...again, disabled: true, disabledHint: 'Available once the reload has finished' } : again);
    }
    return <MessageNote text={text} actions={list} animateIn={animateIn} />;
  }

  return <MessageNote text="The reply was interrupted." actions={[retry('Asks again')]} animateIn={animateIn} />;
}

// The top of what's loaded, while older messages load or couldn't.
function OlderRow({ state, onRetry }: { state: 'loading' | 'error'; onRetry?: () => void }) {
  if (state === 'error') {
    return (
      <View style={styles.older}>
        <MessageNote
          text="Couldn't load earlier messages."
          actions={onRetry ? [{ label: 'Retry', hint: 'Loads earlier messages', onPress: onRetry }] : undefined}
        />
      </View>
    );
  }
  return (
    <View accessible accessibilityLabel="Loading earlier messages" accessibilityState={{ busy: true }} style={styles.older}>
      <Skeleton width="55%" height={HIT} radius={R.bubble} style={styles.start} />
      <Skeleton width="38%" height={HIT} radius={R.bubble} style={styles.end} />
    </View>
  );
}

// Placeholder bubbles while history loads — shaped like a thread, never like
// "typing", which would claim the companion is writing.
const SKELETON_ROWS: { w: `${number}%`; mine?: boolean }[] = [{ w: '62%' }, { w: '42%', mine: true }, { w: '70%' }];

export function SkeletonBubbles() {
  return (
    <View accessible accessibilityLabel="Loading your conversation" accessibilityState={{ busy: true }} style={styles.skeleton}>
      {SKELETON_ROWS.map((r, i) => (
        <Skeleton key={i} width={r.w} height={HIT} radius={R.bubble} style={r.mine ? styles.end : styles.start} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  end: { alignSelf: 'flex-end' },

  thread: { flex: 1 },
  // Inverted: paddingTop lands under the newest message, paddingBottom above
  // the oldest.
  threadContent: { paddingHorizontal: SP.base, paddingTop: SP.md, paddingBottom: SP.sm },
  grouped: { marginTop: SP.xxs },
  spaced: { marginTop: SP.sm },
  pending: { gap: SP.xs2 },
  skeleton: { gap: SP.sm2, paddingTop: SP.sm },
  older: { gap: SP.sm2, paddingTop: SP.sm, paddingBottom: SP.xs },
  jumpDock: { position: 'absolute', left: 0, right: 0, bottom: SP.sm, alignItems: 'center' },
});
