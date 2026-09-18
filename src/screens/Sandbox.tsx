// Sandbox.tsx — S19 Sandbox Home, S20 Sandbox Session. Ported from sandbox.jsx.
//
// Sandbox is not open yet (CONFIG.sandboxComingSoon). Home previews the modes
// under an honest "coming soon" card, and a session only runs when it is given
// a real turn source (`sendTurn`). The session used to answer with canned
// lines on a timer, presented as the companion; nothing here invents a reply.
//
// The diagonal "different rules" grid is drawn with react-native-svg's Pattern;
// the colour bleed behind a pressed card is a RadialGlow faded on the UI thread.

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  AccessibilityInfo, Keyboard, Pressable, ScrollView, StyleSheet, View, useWindowDimensions,
  type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';

import { isNetworkError, limitMessage, type SseErrorInfo, type SseHandlers } from '../api/client';
import { BackButton, EmptyState, GlassFill, IconButton, InlineNotice, PrimaryButton } from '../components/Atoms';
import { useTabBarHeight } from '../components/BottomNav';
import {
  AiNotice, BubbleMem, ChatInput, JumpToLatest, MessageNote, TypingDots, useAiNoticeRepeat,
} from '../components/ChatBits';
import { Screen, TopBar } from '../components/Chrome';
import { CrisisResourceCard } from '../components/CrisisResourceCard';
import { NavIcon, type IconName } from '../components/NavIcon';
import { RadialGlow, type GlowStop } from '../components/RadialGlow';
import { Sheet, useSheet } from '../components/Sheet';
import { Txt } from '../components/Txt';
import { SANDBOX_MODES, type SandboxMode, type SandboxModeId } from '../data/config';
import { announce } from '../hooks/useAccessibilityPrefs';
import { aiNoticeText } from '../lib/aiNotice';
import { restoreDraft } from '../lib/chatTurns';
import { haptic } from '../lib/haptics';
import { Go } from '../navigation/types';
import { enter, exit, layout, timing, usePressFeedback } from '../theme/motion';
import { HIT, MOTION, R, rgba, SP, W } from '../theme/theme';

// Captured by worklets as plain numbers (a captured object is frozen in dev).
const FAST = MOTION.duration.fast;
const BASE = MOTION.duration.base;

// How long the "adults only" note stays after a tap on a locked card.
const LOCK_NOTE_MS = 4000;

// The enter/exit getters build a new animation on every read; read one per mount.
const useOnMount = <T,>(read: () => T): T => useState(read)[0];

// Faint diagonal hatch behind the whole sandbox surface. The pattern id is
// unique per instance: during a route change both screens are mounted.
function DiagonalGrid({ color, spacing = 16, opacity = 0.7 }: { color: string; spacing?: number; opacity?: number }) {
  const id = `diag${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity }]}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id={id} patternUnits="userSpaceOnUse" width={spacing} height={spacing} patternTransform="rotate(45)">
            <Line x1="0" y1="0" x2="0" y2={spacing} stroke={color} strokeWidth="1" />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

// The mode's icon on a tile tinted with its accent.
function ModeTile({ mode, size = HIT }: { mode: SandboxMode; size?: number }) {
  return (
    <View
      style={[
        styles.tile,
        { width: size, height: size, backgroundColor: rgba(mode.accent, 0.12), borderColor: rgba(mode.accent, 0.24) },
      ]}
    >
      <NavIcon name={mode.icon} color={mode.accent} size={Math.round(size / 2)} />
    </View>
  );
}

// ─── S19 SANDBOX HOME ────────────────────────────────────────────────────
type CardState = 'open' | 'locked' | 'soon';

export function S19_SandboxHome({ go, comingSoon, isMinor, openMode }: {
  go: Go; comingSoon: boolean; isMinor: boolean; openMode: (m: SandboxMode) => void;
}) {
  const tabBarH = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const viewport = useRef({ y: 0, h: 0 });
  const [aboutOpen, setAboutOpen] = useState(false);
  const [lockNote, setLockNote] = useState<SandboxModeId | null>(null);
  // The card under the finger, read on the UI thread by the colour bleed, so
  // a touch never re-renders the list.
  const pressed = useSharedValue<string>('');

  useEffect(() => {
    if (!lockNote) return;
    const id = setTimeout(() => setLockNote(null), LOCK_NOTE_MS);
    return () => clearTimeout(id);
  }, [lockNote]);

  const toggleAbout = () => {
    if (!aboutOpen) scrollRef.current?.scrollTo({ y: 0, animated: true });
    setAboutOpen(open => !open);
  };

  const pick = (m: SandboxMode, state: CardState) => {
    if (state === 'locked') {
      haptic.warning();
      setLockNote(m.id);
      announce(`${m.name} is for adults 18 and over.`);
      return;
    }
    haptic.medium();
    openMode(m);
  };

  // The note opens under the card that was tapped, which may be the last one:
  // bring it up from behind the floating tab bar.
  const revealNote = (e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    const visibleBottom = viewport.current.y + viewport.current.h - tabBarH;
    const overflow = y + height + SP.base - visibleBottom;
    if (overflow > 0) scrollRef.current?.scrollTo({ y: viewport.current.y + overflow, animated: true });
  };

  const glow = Math.min(width * 1.1, 440);

  return (
    <Screen tabBar>
      <DiagonalGrid color={rgba(W.primary, 0.05)} />
      <View
        pointerEvents="none"
        style={[styles.bleed, { width: glow, height: glow, marginLeft: -glow / 2, marginTop: -glow / 2 }]}
      >
        {SANDBOX_MODES.map(m => <Bleed key={m.id} mode={m} size={glow} pressed={pressed} />)}
      </View>

      <TopBar
        left={<Txt variant="title2" weight={700} heading>Sandbox</Txt>}
        right={
          <IconButton
            icon="info"
            label="About Sandbox"
            accessibilityHint={aboutOpen ? 'Hides the explanation' : 'Explains what Sandbox is'}
            onPress={toggleAbout}
            selected={aboutOpen}
            variant="glass"
            size={36}
            iconSize={18}
            tint={W.text2}
            haptic="selection"
          />
        }
      />

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.list, { paddingBottom: tabBarH + SP.base }]}
        scrollIndicatorInsets={{ bottom: Math.max(0, tabBarH - insets.bottom) }}
        onLayout={e => { viewport.current.h = e.nativeEvent.layout.height; }}
        onScroll={e => { viewport.current.y = e.nativeEvent.contentOffset.y; }}
        scrollEventThrottle={64}
      >
        {aboutOpen ? <AboutPanel comingSoon={comingSoon} /> : null}

        {comingSoon ? (
          <>
            <ComingSoonCard onStudio={() => go('studio')} />
            <Animated.View layout={layout}>
              <Txt variant="eyebrow" heading style={styles.sectionLabel}>What's coming</Txt>
            </Animated.View>
          </>
        ) : (
          <Animated.View layout={layout} style={styles.note}>
            <GlassFill intensity={20} solid={W.surface1} />
            <NavIcon name="shield" color={W.secondary} size={16} />
            <Txt variant="subhead" style={styles.noteText}>
              Sandbox sessions stay out of your companion's long-term memory.
            </Txt>
          </Animated.View>
        )}

        {SANDBOX_MODES.map(m => {
          const state: CardState = m.adultsOnly && isMinor ? 'locked' : comingSoon ? 'soon' : 'open';
          return (
            <React.Fragment key={m.id}>
              <ModeCard mode={m} state={state} pressed={pressed} onPress={() => pick(m, state)} />
              {lockNote === m.id ? (
                <View onLayout={revealNote}>
                  <InlineNotice tone="info" text={`${m.name} is for adults 18 and over.`} />
                </View>
              ) : null}
            </React.Fragment>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

// The accent that bleeds into the page while a card is held. One glow per mode
// stays mounted and fades, instead of an SVG mounting on every touch.
function Bleed({ mode, size, pressed }: { mode: SandboxMode; size: number; pressed: SharedValue<string> }) {
  const id = mode.id;
  const style = useAnimatedStyle(() => {
    const on = pressed.value === id;
    return { opacity: withTiming(on ? 1 : 0, timing(on ? FAST : BASE)) };
  });
  const stops: GlowStop[] = [
    { offset: 0, color: mode.accent, opacity: 0.15 },
    { offset: 0.7, color: mode.accent, opacity: 0 },
  ];
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <RadialGlow width={size} height={size} stops={stops} />
    </Animated.View>
  );
}

function ModeCard({ mode, state, pressed, onPress }: {
  mode: SandboxMode; state: CardState; pressed: SharedValue<string>; onPress: () => void;
}) {
  // Cards sit in a scroll view: a touch that becomes a scroll must not tap,
  // so the haptic fires on the commit in onPress instead of on touch-down.
  const press = usePressFeedback({ haptic: false });
  const open = state === 'open';

  const onPressIn = () => {
    press.onPressIn();
    pressed.value = mode.id;
  };
  const onPressOut = () => {
    press.onPressOut();
    pressed.value = '';
  };

  const label = [mode.name, mode.adultsOnly ? 'Adults only' : null, mode.tagline, mode.desc].filter(Boolean).join('. ');
  const hint = state === 'locked' ? 'Only for adults 18 and over' : state === 'soon' ? 'Coming soon' : 'Starts a session';

  return (
    <Animated.View
      layout={layout}
      style={[
        styles.cardOuter,
        state === 'soon' ? styles.dimSoon : state === 'locked' ? styles.dimLocked : null,
        press.animatedStyle,
      ]}
    >
      <Pressable
        onPress={state === 'soon' ? undefined : onPress}
        onPressIn={open ? onPressIn : undefined}
        onPressOut={open ? onPressOut : undefined}
        disabled={state === 'soon'}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: !open }}
        style={[styles.card, { borderColor: rgba(mode.accent, 0.14) }]}
      >
        <GlassFill intensity={24} solid={W.surface1} />
        <View style={styles.cardRow}>
          <ModeTile mode={mode} />
          <View style={styles.titles}>
            <View style={styles.nameRow}>
              <Txt variant="headline" style={styles.shrink}>{mode.name}</Txt>
              {mode.badge ? (
                <View style={styles.badge}>
                  <Txt variant="caption" weight={600} style={styles.badgeText}>{mode.badge}</Txt>
                </View>
              ) : null}
            </View>
            {mode.tagline ? <Txt variant="footnote" style={{ color: mode.accent }}>{mode.tagline}</Txt> : null}
          </View>
          {state === 'locked' ? <NavIcon name="lock" color={W.text2} size={18} />
            : state === 'soon' ? (
              <View style={styles.soonChip}>
                <Txt variant="eyebrow" style={styles.soonText}>Soon</Txt>
              </View>
            ) : <NavIcon name="right" color={W.text3} size={18} />}
        </View>
        <Txt variant="subhead" style={styles.desc}>{mode.desc}</Txt>
      </Pressable>
    </Animated.View>
  );
}

const HERO_GLOW: GlowStop[] = [
  { offset: 0, color: W.primary, opacity: 0.22 },
  { offset: 0.7, color: W.rose, opacity: 0 },
];

// Replaces a "Notify me" button that notified no one: there is no way yet to
// tell people when Sandbox opens, so the card offers what is open instead.
function ComingSoonCard({ onStudio }: { onStudio: () => void }) {
  return (
    <Animated.View layout={layout} style={styles.hero}>
      <GlassFill intensity={30} solid={W.surface1} />
      <RadialGlow width={280} height={280} stops={HERO_GLOW} style={styles.heroGlow} />
      <View style={styles.heroIcon}>
        <NavIcon name="mask" color={W.primary} size={26} />
      </View>
      <Txt variant="eyebrow" style={styles.heroEyebrow}>Coming soon</Txt>
      <Txt variant="title3" heading style={styles.center}>Sandbox isn't open yet</Txt>
      <Txt variant="subhead" style={styles.heroBody}>
        Different rules for different moods. We're making sure it's done right before it opens.
        Studio's practice scenarios are ready now.
      </Txt>
      <PrimaryButton variant="secondary" onPress={onStudio} style={styles.heroAction} accessibilityHint="Opens the Studio tab">
        Open Studio
      </PrimaryButton>
    </Animated.View>
  );
}

// The "i" in the header opens this in place. A sheet on a tab screen would sit
// under the floating tab bar, which the screen can't cover.
function AboutPanel({ comingSoon }: { comingSoon: boolean }) {
  const entering = useOnMount(() => enter.fadeDown);
  const exiting = useOnMount(() => exit.fade);
  const heading = useRef<View>(null);

  // Give VoiceOver the new text once it has arrived.
  useEffect(() => {
    const id = setTimeout(() => {
      if (heading.current) AccessibilityInfo.sendAccessibilityEvent(heading.current, 'focus');
    }, BASE);
    return () => clearTimeout(id);
  }, []);

  return (
    <Animated.View entering={entering} exiting={exiting} layout={layout} style={styles.about}>
      <GlassFill intensity={30} solid={W.surface1} />
      <View ref={heading} accessible accessibilityRole="header">
        <Txt variant="headline">{comingSoon ? 'What Sandbox will be' : 'About Sandbox'}</Txt>
      </View>
      <AboutPoint icon="mask" text="A separate space to talk with your companion under different rules: blunter, more private or more personal." />
      <AboutPoint icon="chat" text="Your companion stays the same in your everyday chats." />
      <AboutPoint icon="eye-off" text="Sandbox sessions stay out of your companion's long-term memory." />
      <AboutPoint icon="lock" text="Intimate is only for adults 18 and over." />
      <AboutPoint icon="sparkle" text="In every mode you're talking with an AI, not a person." />
    </Animated.View>
  );
}

function AboutPoint({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.aboutRow}>
      <View style={styles.aboutIcon}>
        <NavIcon name={icon} color={W.secondary} size={16} />
      </View>
      <Txt variant="subhead" style={styles.aboutText}>{text}</Txt>
    </View>
  );
}

// ─── S20 SANDBOX SESSION ─────────────────────────────────────────────────

/**
 * Sends one message and streams the reply through the same handlers as
 * streamConversation — the turn model Chat and Studio use. The backend has no
 * sandbox session type yet, so there is nothing to pass until it does; without
 * one the screen says Sandbox isn't open rather than making replies up.
 */
export type SandboxTurn = (message: string, handlers: SseHandlers) => AbortController;

interface SandboxSessionProps {
  go: Go;
  mode: SandboxMode;
  /** Called once the session closes, however the user leaves it. */
  onEnd?: () => void;
  /** Known minors get California's break reminder. Adults-only modes stay
   *  locked unless this is explicitly false. */
  isMinor?: boolean;
  /** The companion's name, for the AI notice and the composer. */
  companionName?: string;
  sendTurn?: SandboxTurn;
}

export function S20_SandboxSession({ go, mode, onEnd, isMinor, companionName, sendTurn }: SandboxSessionProps) {
  const locked = !!mode.adultsOnly && isMinor !== false;
  const leave = useCallback(() => go('sandbox'), [go]);

  if (locked || !sendTurn) {
    return (
      <Screen>
        <DiagonalGrid color={rgba(W.surface2, 0.1)} spacing={14} opacity={0.5} />
        <TopBar glass border left={<BackButton onPress={leave} />} center={<SessionTitle mode={mode} />} />
        <View style={styles.unavailable}>
          <EmptyState
            icon={locked ? 'lock' : 'mask'}
            title={locked ? `${mode.name} is for adults` : "Sandbox isn't open yet"}
            body={locked ? 'This mode is only available to people 18 and over.' : 'Sessions will start here once it opens.'}
            actionLabel="Back to Sandbox"
            onAction={leave}
          />
        </View>
      </Screen>
    );
  }

  return (
    <SandboxThread
      mode={mode}
      speaker={companionName?.trim() || mode.name}
      companionName={companionName?.trim() || undefined}
      isMinor={isMinor === true}
      sendTurn={sendTurn}
      onEnd={onEnd}
      onLeave={leave}
      onCrisis={() => go('crisis')}
    />
  );
}

function SessionTitle({ mode }: { mode: SandboxMode }) {
  return (
    <View style={styles.sessionTitle} accessible accessibilityRole="header" accessibilityLabel={mode.name}>
      <NavIcon name={mode.icon} color={mode.accent} size={18} />
      <Txt variant="headline" numberOfLines={1} style={styles.shrink}>{mode.name}</Txt>
    </View>
  );
}

type SbMsg = {
  id: number;
  from: 'user' | 'comp' | 'notice';
  text: string;
  streaming?: boolean;
  /** Why this line didn't complete, shown under it. */
  note?: string;
  /** A user line the server never took: Retry sends it again. */
  unsent?: boolean;
  /** The server's crisis response: support follows it in the thread. */
  crisis?: boolean;
};

// Within this many points of the end counts as reading the latest message.
const NEAR_BOTTOM = 72;

function rateLimitText(info?: SseErrorInfo): string | null {
  if (info?.status !== 429) return null;
  if (info.serverMessage) return info.serverMessage;
  return info.retryAfter
    ? `You're sending messages quickly. Try again in ${info.retryAfter} seconds.`
    : "You're sending messages quickly. Try again in a moment.";
}

function SandboxThread({ mode, speaker, companionName, isMinor, sendTurn, onEnd, onLeave, onCrisis }: {
  mode: SandboxMode; speaker: string; companionName?: string; isMinor: boolean; sendTurn: SandboxTurn;
  onEnd?: () => void; onLeave: () => void; onCrisis: () => void;
}) {
  const [msgs, setMsgs] = useState<SbMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [limit, setLimit] = useState<string | null>(null);
  // Reading further up the thread, and whether a reply has landed out of sight.
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(false);
  const confirmEnd = useSheet();

  const scrollRef = useRef<ScrollView>(null);
  const nearBottom = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const idRef = useRef(0);
  const nextId = () => ++idRef.current;

  // However the screen goes away, the session closes and a reply still
  // streaming is dropped.
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  useEffect(() => () => {
    abortRef.current?.abort();
    onEndRef.current?.();
  }, []);

  useAiNoticeRepeat(() => {
    const id = nextId();
    setMsgs(list => [...list, { id, from: 'notice', text: aiNoticeText(speaker, isMinor, true) }]);
  });

  const busy = msgs.some(m => m.streaming);
  const hasConversation = msgs.some(m => m.from === 'user');

  // ── Staying with the latest message ────────────────────────────────────
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const near = contentSize.height - (contentOffset.y + layoutMeasurement.height) < NEAR_BOTTOM;
    nearBottom.current = near;
    if (near === away) setAway(!near);
    if (near && unseen) setUnseen(false);
  };
  // Content growing (a streamed word) or the viewport shrinking (the keyboard)
  // keeps the end in view only for someone already reading it.
  const pin = () => {
    if (nearBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
  };
  const jumpToLatest = () => {
    nearBottom.current = true;
    setAway(false);
    setUnseen(false);
    scrollRef.current?.scrollToEnd({ animated: true });
  };
  const followNewReply = () => {
    if (!nearBottom.current) setUnseen(true);
  };

  // ── A turn ─────────────────────────────────────────────────────────────
  const runTurn = (text: string, userId: number, replyId: number) => {
    let reply = '';
    const update = (fn: (m: SbMsg) => SbMsg) => setMsgs(list => list.map(m => (m.id === replyId ? fn(m) : m)));

    abortRef.current = sendTurn(text, {
      onChunk: content => {
        if (!reply) {
          haptic.selection();
          followNewReply();
        }
        reply += content;
        update(m => ({ ...m, text: m.text + content }));
      },
      onDone: () => {
        update(m => ({ ...m, streaming: false }));
        if (reply) announce(`${speaker}: ${reply}`);
      },
      // The server's own words replace the reply, and support follows it in
      // the thread. Nothing navigates away unless the user asks.
      onCrisis: content => {
        update(m => ({ ...m, text: content, streaming: false, crisis: true }));
        announce(content);
        followNewReply();
      },
      onError: (message, info) => {
        const refusal = limitMessage(message) ?? rateLimitText(info);
        if (refusal) {
          // A refused turn never happened: both lines come off and the words
          // go back in the composer.
          setMsgs(list => list.filter(m => m.id !== userId && m.id !== replyId));
          setDraft(d => restoreDraft(d, text));
          setLimit(refusal);
          haptic.warning();
          return;
        }
        haptic.error();
        if (reply) {
          // Keep what arrived. Sending again would ask the same thing twice.
          update(m => ({ ...m, streaming: false, note: 'The reply stopped partway.' }));
          announce('The reply stopped partway.');
          return;
        }
        const note = isNetworkError(info) ? 'Not sent. Check your connection.' : 'Not sent.';
        setMsgs(list => list
          .filter(m => m.id !== replyId)
          .map(m => (m.id === userId ? { ...m, unsent: true, note } : m)));
        announce(note);
      },
    });
  };

  // The line and its reply go to the end of the thread, in the order the
  // server will see them.
  const startTurn = (text: string, userId: number) => {
    setLimit(null);
    nearBottom.current = true;
    const replyId = nextId();
    setMsgs(list => [
      ...list.filter(m => m.id !== userId),
      { id: userId, from: 'user', text },
      { id: replyId, from: 'comp', text: '', streaming: true },
    ]);
    runTurn(text, userId, replyId);
  };

  // ChatInput plays the send haptic and holds the button while a reply is due.
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    startTurn(text, nextId());
  };
  const retry = (m: SbMsg) => {
    if (!busy) startTurn(m.text, m.id);
  };

  // ── Leaving ────────────────────────────────────────────────────────────
  // Nothing from a session is kept, so leaving one with a conversation in it
  // asks first; an empty one just closes.
  const requestLeave = () => {
    if (!hasConversation) return onLeave();
    Keyboard.dismiss();
    confirmEnd.open();
  };
  const endSession = () => {
    announce('Session ended');
    onLeave();
  };

  return (
    <Screen>
      <DiagonalGrid color={rgba(W.surface2, 0.1)} spacing={14} opacity={0.5} />
      <TopBar
        glass
        border
        left={<BackButton onPress={requestLeave} />}
        center={<SessionTitle mode={mode} />}
        right={
          <Pressable
            onPress={requestLeave}
            accessibilityRole="button"
            accessibilityLabel="End session"
            style={({ pressed }) => [styles.endButton, pressed ? styles.pressed : null]}
          >
            <Txt variant="callout" weight={600} style={styles.endText}>End</Txt>
          </Pressable>
        }
      />

      <View style={styles.flex}>
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.thread}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={32}
          onContentSizeChange={pin}
          onLayout={pin}
        >
          <ModeIntro mode={mode} />
          <AiNotice text={aiNoticeText(speaker, isMinor, false)} />
          {msgs.map(m => {
            if (m.from === 'notice') return <AiNotice key={m.id} text={m.text} />;
            if (m.streaming && !m.text) return <TypingDots key={m.id} name={speaker} />;
            return (
              <React.Fragment key={m.id}>
                <BubbleMem from={m.from} text={m.text} accent={mode.accent} streaming={m.streaming} speaker={speaker} />
                {m.note ? (
                  <MessageNote
                    text={m.note}
                    align={m.from === 'user' ? 'end' : 'start'}
                    actionLabel={m.unsent ? 'Retry' : undefined}
                    actionHint="Sends the message again"
                    onAction={m.unsent ? () => retry(m) : undefined}
                  />
                ) : null}
                {m.crisis ? <CrisisResourceCard onMore={onCrisis} /> : null}
              </React.Fragment>
            );
          })}
        </ScrollView>
        {/* Always mounted, so the chip can play its exit before it goes. */}
        <View pointerEvents="box-none" style={styles.jumpWrap}>
          {away ? <JumpToLatest unseen={unseen} onPress={jumpToLatest} /> : null}
        </View>
      </View>

      {limit ? <InlineNotice tone="warning" text={limit} style={styles.limit} /> : null}

      {/* ChatInput builds "Talk to …" from this, so it gets a person, never a mode name. */}
      <ChatInput
        draft={draft}
        setDraft={setDraft}
        onSend={send}
        busy={busy}
        companionName={companionName ?? 'your companion'}
      />

      <Sheet
        visible={confirmEnd.visible}
        onClose={confirmEnd.close}
        title="End this session?"
        footer={
          <>
            <PrimaryButton variant="danger" haptic="heavy" onPress={endSession}>End session</PrimaryButton>
            <PrimaryButton variant="secondary" onPress={confirmEnd.close}>Keep talking</PrimaryButton>
          </>
        }
      >
        <Txt variant="body" style={styles.sheetBody}>This conversation will be cleared when you leave.</Txt>
      </Sheet>
    </Screen>
  );
}

// First thing in the thread: what this mode is, before anyone has spoken.
function ModeIntro({ mode }: { mode: SandboxMode }) {
  return (
    <View style={styles.intro} accessible accessibilityLabel={`${mode.name}. ${mode.desc}`}>
      <ModeTile mode={mode} size={52} />
      <Txt variant="title3" style={styles.center}>{mode.name}</Txt>
      <Txt variant="subhead" style={[styles.center, styles.desc]}>{mode.desc}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  shrink: { flexShrink: 1 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },

  // ── Home ─────────────────────────────────────────────────────────────
  bleed: { position: 'absolute', left: '50%', top: '55%' },
  list: { paddingHorizontal: SP.base, paddingTop: SP.xs, gap: SP.md },
  sectionLabel: { color: W.text3, marginTop: SP.sm, marginLeft: SP.xs },

  hero: {
    alignItems: 'center', gap: SP.sm, padding: SP.xl, overflow: 'hidden',
    borderRadius: R.card, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glass,
  },
  heroGlow: { position: 'absolute', top: -150, left: '50%', marginLeft: -140 },
  heroIcon: {
    width: 56, height: 56, borderRadius: 28, marginBottom: SP.xs, alignItems: 'center', justifyContent: 'center',
    backgroundColor: W.primaryDim, borderWidth: 1, borderColor: rgba(W.primary, 0.2),
  },
  heroEyebrow: { color: W.primarySoft },
  heroBody: { textAlign: 'center', color: W.text2, maxWidth: 320 },
  heroAction: { marginTop: SP.sm },

  note: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm2, overflow: 'hidden',
    paddingVertical: SP.sm2, paddingHorizontal: SP.md2, borderRadius: R.md,
    borderWidth: 1, borderColor: rgba(W.secondary, 0.1), borderLeftWidth: 2, borderLeftColor: W.secondary,
    backgroundColor: W.glass,
  },
  noteText: { flex: 1, color: W.text2 },

  about: {
    gap: SP.md, padding: SP.base2, overflow: 'hidden',
    borderRadius: R.card, borderWidth: 1, borderColor: rgba(W.secondary, 0.16), backgroundColor: W.glass,
  },
  aboutRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md },
  aboutIcon: { marginTop: SP.xxs },
  aboutText: { flex: 1, color: W.text2 },

  cardOuter: { borderRadius: R.lg },
  // Coming-soon cards stay readable: they are a preview of what's coming. A
  // locked card recedes further, since it won't open for this person.
  dimSoon: { opacity: 0.72 },
  dimLocked: { opacity: 0.5 },
  card: {
    gap: SP.sm2, padding: SP.base, overflow: 'hidden',
    borderRadius: R.lg, borderWidth: 1, backgroundColor: W.glass,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: SP.md },
  tile: { borderRadius: R.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  titles: { flex: 1, gap: SP.xxs },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: SP.sm, rowGap: SP.xxs },
  badge: { paddingVertical: SP.xxs, paddingHorizontal: SP.sm, borderRadius: R.sm, backgroundColor: rgba(W.danger, 0.15) },
  badgeText: { color: W.dangerText },
  soonChip: { paddingVertical: SP.xxs, paddingHorizontal: SP.sm, borderRadius: R.pill, backgroundColor: W.hairlineStrong },
  soonText: { color: W.text2 },
  desc: { color: W.text2 },

  // ── Session ──────────────────────────────────────────────────────────
  unavailable: { flex: 1, justifyContent: 'center' },
  sessionTitle: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.sm, maxWidth: '100%' },
  // The word lines up with the gutter; the target still reaches 44pt.
  endButton: {
    minWidth: HIT, minHeight: HIT, marginRight: -SP.sm, paddingHorizontal: SP.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  endText: { color: W.dangerText },
  thread: { paddingHorizontal: SP.base, paddingTop: SP.md, paddingBottom: SP.sm, gap: SP.sm },
  intro: { alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.lg, paddingTop: SP.base, paddingBottom: SP.xs },
  jumpWrap: { position: 'absolute', left: 0, right: 0, bottom: SP.sm, alignItems: 'center' },
  limit: { marginHorizontal: SP.md, marginBottom: SP.sm },
  sheetBody: { color: W.text2 },
});
