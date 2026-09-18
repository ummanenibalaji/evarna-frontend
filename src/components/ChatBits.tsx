// ChatBits.tsx — shared chat UI: BubbleMem (with inline memory refs),
// ChatInput, TypingDots, time stamps, the AI notice, the daily-cap card, and
// the small pieces a thread needs (suggestion chips, failed-send notes, the
// jump-to-latest button).
// Ported from home.jsx + chat.jsx.

import React, { memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Animated as RNAnimated, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions,
  type AccessibilityActionEvent, type AccessibilityActionInfo, type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { announce } from '../hooks/useAccessibilityPrefs';
import { aiNoticeDue } from '../lib/aiNotice';
import { haptic } from '../lib/haptics';
import { useDotPulse, useLoop } from '../theme/animations';
import { enter, exit, PRESS_DELAY, timing, usePressFeedback } from '../theme/motion';
import { ELEV, GRAD, HIT, MOTION, R, resolveFont, rgba, SP, TYPE, W } from '../theme/theme';
import { GlassFill, MemoryRef, minTarget } from './Atoms';
import { NavIcon, type IconName } from './NavIcon';
import { Txt } from './Txt';

const D = MOTION.duration;
const FILL = StyleSheet.absoluteFillObject;

/** The backend refuses longer messages (conversation.routes: max 2000). */
export const MESSAGE_MAX_LENGTH = 2000;

// Cross-fades are the calm alternative to movement, so they play under Reduce Motion too.
const fade = (ms: number) => ({ ...timing(ms), reduceMotion: ReduceMotion.Never });

// ─── BubbleSkin ──────────────────────────────────────────────────────────
// The two bubble treatments, in one place:
//   companion — near-transparent glass with a coral edge-lit left border,
//               tail on the bottom-left
//   user      — warm dark fill, tail on the bottom-right
// Both keep the same corner family so a thread reads as one material. Solid
// fills and no clipping: a clipped view with mixed corner radii gets a mask
// layer, which every bubble on screen would re-render on each scroll frame.
function BubbleSkin({ isUser, accent, children }: { isUser: boolean; accent: string; children: React.ReactNode }) {
  return (
    <View style={[styles.bubble, isUser ? styles.bubbleUser : [styles.bubbleComp, { borderLeftColor: rgba(accent, 0.55) }]]}>
      {children}
    </View>
  );
}

// Body text, with memory-reference substrings in gold.
function RefText({
  text, memoryRefs, isUser, onMemoryClick,
}: {
  text: string; memoryRefs: string[]; isUser: boolean; onMemoryClick?: (ref: string) => void;
}) {
  // The companion speaks in Manrope at a looser line height — its text is
  // meant to be read; the user's is meant to be scanned.
  const variant = isUser ? 'body' : 'bodyComp';
  const weight = isUser ? 400 : 500;

  const parts = useMemo(() => {
    let out: (string | { ref: string })[] = [text];
    memoryRefs.forEach(ref => {
      out = out.flatMap(p => {
        if (typeof p !== 'string') return [p];
        const chunks = p.split(ref);
        return chunks.flatMap((chunk, i) => (i < chunks.length - 1 ? [chunk, { ref }] : [chunk]));
      });
    });
    return out;
  }, [text, memoryRefs]);

  return (
    <Txt variant={variant} weight={weight} style={styles.bubbleText}>
      {parts.map((p, i) =>
        typeof p === 'string'
          ? p
          : onMemoryClick
            ? <MemoryRef key={i} onPress={() => onMemoryClick(p.ref)}>{p.ref}</MemoryRef>
            : <Txt key={i} variant={variant} weight={500} color={W.gold}>{p.ref}</Txt>
      )}
    </Txt>
  );
}

// ─── BubbleMem ───────────────────────────────────────────────────────────
const NO_REFS: string[] = [];
// On iOS (Fabric) VoiceOver speaks an action's `name` and ignores its label,
// so there the name is the words; Android reads the label of the standard
// long-press action.
const REPORT_LABEL = 'Report this reply';
const REPORT_ACTIONS: AccessibilityActionInfo[] = Platform.OS === 'ios'
  ? [{ name: REPORT_LABEL }]
  : [{ name: 'longpress', label: REPORT_LABEL }];

interface BubbleProps {
  from: string;
  text: string;
  memoryRefs?: string[];
  accent?: string;
  onMemoryClick?: (ref: string) => void;
  /** Long-press (and the VoiceOver action) opens the report sheet. */
  onLongPress?: () => void;
  /** Stable alternative to onLongPress, so a memoised thread doesn't re-render
   *  every bubble: called with `reportId`, and the bubble itself, for the
   *  report sheet to hand VoiceOver focus back to. */
  onReport?: (reportId: string, from: RefObject<View | null>) => void;
  reportId?: string;
  streaming?: boolean;
  /** Who is speaking, for VoiceOver ("Nova: …"). */
  speaker?: string;
  /** Rise into place on mount. False for history, so a thread opens still. */
  animateIn?: boolean;
}

export const BubbleMem = memo(function BubbleMem({
  from, text, memoryRefs = NO_REFS, accent = W.primary, onMemoryClick, onLongPress, onReport, reportId,
  streaming = false, speaker, animateIn = true,
}: BubbleProps) {
  const isUser = from === 'user';
  const [entering] = useState(() => (animateIn ? enter.fadeUp : undefined));
  const self = useRef<View>(null);
  const report = useCallback(() => {
    if (onReport && reportId) onReport(reportId, self);
    else onLongPress?.();
  }, [onReport, reportId, onLongPress]);
  const reportable = !!onLongPress || !!(onReport && reportId);
  const onAction = useCallback((e: AccessibilityActionEvent) => {
    const action = e.nativeEvent.actionName;
    if (action === 'longpress' || action === REPORT_LABEL) report();
  }, [report]);

  // Tappable memory phrases must stay reachable, so such a bubble isn't
  // collapsed into one VoiceOver element.
  const hasLinks = memoryRefs.length > 0 && !!onMemoryClick;
  const label = `${isUser ? 'You' : speaker ?? 'Reply'}: ${text}`;
  const skin = (
    <BubbleSkin isUser={isUser} accent={accent}>
      <View style={styles.bubbleRow}>
        <View style={styles.shrink}>
          <RefText text={text} memoryRefs={memoryRefs} isUser={isUser} onMemoryClick={onMemoryClick} />
        </View>
        {streaming ? <StreamCaret /> : null}
      </View>
    </BubbleSkin>
  );

  const body = reportable ? (
    // App Store Guideline 1.2: a way to report generated content, by
    // long-press or, for VoiceOver, the "Report this reply" action.
    <Pressable
      ref={self}
      onLongPress={report}
      delayLongPress={400}
      // Every scroll of the thread starts on a bubble; it shouldn't dim for it.
      unstable_pressDelay={PRESS_DELAY}
      accessible={!hasLinks}
      accessibilityLabel={hasLinks ? undefined : label}
      accessibilityActions={REPORT_ACTIONS}
      onAccessibilityAction={onAction}
      style={({ pressed }) => (pressed ? styles.held : null)}
    >
      {skin}
    </Pressable>
  ) : (
    <View accessible={!hasLinks} accessibilityLabel={hasLinks ? undefined : label}>{skin}</View>
  );

  // History opens still, so it needs no animated wrapper (nor its cost,
  // repeated for every bubble on screen). `entering` is fixed at mount, so a
  // bubble never switches between the two.
  const wrap = isUser ? styles.wrapEnd : styles.wrapStart;
  return entering
    ? <Animated.View entering={entering} style={wrap}>{body}</Animated.View>
    : <View style={wrap}>{body}</View>;
});

// Blinking caret at the end of a reply while it streams in. Under Reduce
// Motion it holds still at half strength.
function StreamCaret() {
  const v = useLoop(900, { yoyo: true });
  const opacity = useMemo(() => v.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1] }), [v]);
  return <RNAnimated.View style={[styles.caret, { opacity }]} />;
}

// ─── ChatInput ───────────────────────────────────────────────────────────
const SEND = 40;
const FIELD_R = HIT / 2;
const CAPSULE_PAD = SP.xs2;
// Characters left when the counter appears, and when it turns amber.
const COUNT_FROM = 200;
const COUNT_WARN = 50;
const INPUT_LINES = 5;

/** What a screen can do with a composer that keeps its own text. */
export interface ChatInputHandle {
  /** The text in the box now. */
  get(): string;
  /** Replaces it: a starter picked, a refused message handed back. */
  set(next: string | ((current: string) => string)): void;
  focus(): void;
}

interface ChatInputProps {
  companionName: string;
  /** A reply is on its way: the draft stays editable, sending waits. */
  busy?: boolean;
  maxLength?: number;
  /** Controlled: the screen holds the text. Every keystroke then re-renders
   *  the screen, so a long thread should use the props below instead. */
  draft?: string;
  setDraft?: (v: string) => void;
  /** Controlled send: the screen reads and clears its own draft. */
  onSend?: () => void;
  /** Uncontrolled: the text the box starts with. */
  defaultDraft?: string;
  /** Uncontrolled: every change, for the screen to keep (it must stay cheap
   *  and only set state when something it shows changes). */
  onDraftChange?: (text: string) => void;
  /** Uncontrolled send, with the trimmed text. Return false to keep the text
   *  in the box (nothing was sent); anything else clears it. */
  onSubmit?: (text: string) => boolean | void;
  ref?: React.Ref<ChatInputHandle>;
}

/**
 * The message box. With `onSubmit` it keeps its own text, so typing
 * re-renders only the composer, never the thread above it; the screen hears
 * about changes through `onDraftChange` and drives it through `ref`.
 */
export const ChatInput = memo(function ChatInput({
  companionName, busy = false, maxLength = MESSAGE_MAX_LENGTH,
  draft, setDraft, onSend, defaultDraft, onDraftChange, onSubmit, ref,
}: ChatInputProps) {
  const { fontScale } = useWindowDimensions();
  const controlled = draft !== undefined && !!setDraft;
  const [own, setOwn] = useState(() => defaultDraft ?? '');
  const text = controlled ? draft : own;

  // The latest of everything the stable handlers below need.
  const live = useRef({ text, controlled, setDraft, onDraftChange, onSubmit, onSend });
  live.current = { text, controlled, setDraft, onDraftChange, onSubmit, onSend };
  const inputRef = useRef<TextInput>(null);

  const apply = useCallback((next: string) => {
    const l = live.current;
    l.text = next;
    if (l.controlled) l.setDraft?.(next);
    else setOwn(next);
    l.onDraftChange?.(next);
  }, []);

  useImperativeHandle(ref, () => ({
    get: () => live.current.text,
    set: next => apply(typeof next === 'function' ? next(live.current.text) : next),
    focus: () => inputRef.current?.focus(),
  }), [apply]);

  const hasDraft = text.trim().length > 0;
  const canSend = hasDraft && !busy;
  const canSendRef = useRef(canSend);
  canSendRef.current = canSend;

  const focus = useSharedValue(0);
  const focusStyle = useAnimatedStyle(() => ({ opacity: focus.value }));
  const onFocus = useCallback(() => { focus.value = withTiming(1, fade(D.base)); }, [focus]);
  const onBlur = useCallback(() => { focus.value = withTiming(0, fade(D.base)); }, [focus]);

  // About five lines at the reader's text size, then the field scrolls.
  const scale = Math.min(fontScale, TYPE.body.maxScale);
  const maxHeight = Math.round(TYPE.body.lineHeight * INPUT_LINES * scale) + SP.sm2 * 2;
  const inputStyle = useMemo(() => [styles.input, { maxHeight }], [maxHeight]);
  const left = maxLength - text.length;

  const send = useCallback(() => {
    if (!canSendRef.current) return;
    haptic.medium();
    const l = live.current;
    if (l.onSubmit) {
      if (l.onSubmit(l.text.trim()) !== false) apply('');
    } else {
      l.onSend?.();
    }
  }, [apply]);

  return (
    <View style={styles.composer}>
      {left <= COUNT_FROM ? (
        <Txt
          variant="caption"
          maxScale={1.2}
          accessibilityLabel={`${left} characters left`}
          color={left <= COUNT_WARN ? W.warning : W.text3}
          style={styles.counter}
        >
          {left}
        </Txt>
      ) : null}
      <View style={styles.capsule}>
        <CapsuleGlass />

        <View style={styles.field}>
          <View pointerEvents="none" style={[styles.fieldBorder, { borderColor: W.hairline }]} />
          <Animated.View pointerEvents="none" style={[styles.fieldBorder, styles.fieldFocused, focusStyle]} />
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={apply}
            onFocus={onFocus}
            onBlur={onBlur}
            placeholder={`Talk to ${companionName}…`}
            placeholderTextColor={W.placeholder}
            selectionColor={W.primary}
            cursorColor={W.primary}
            maxLength={maxLength}
            maxFontSizeMultiplier={TYPE.body.maxScale}
            accessibilityLabel={`Message ${companionName}`}
            multiline
            style={inputStyle}
          />
        </View>

        <SendButton
          canSend={canSend}
          hint={busy && hasDraft ? `Available once ${companionName} has replied` : undefined}
          onPress={send}
        />
      </View>
    </View>
  );
});

// The capsule's glass and its lit top edge never change, so a keystroke
// doesn't redraw them.
const CapsuleGlass = memo(function CapsuleGlass() {
  return (
    <>
      <View pointerEvents="none" style={styles.capsuleGlass}>
        <GlassFill intensity={50} solid={W.surface1} />
      </View>
      {/* inset top highlight — the capsule catching light */}
      <View pointerEvents="none" style={styles.capsuleHighlight} />
    </>
  );
});

// Re-renders only when it turns ready or resting, not on every keystroke.
const SendButton = memo(function SendButton({ canSend, hint, onPress }: {
  canSend: boolean; hint?: string; onPress: () => void;
}) {
  // The send button keeps its slot, so the field never reflows; it only
  // cross-fades between resting and ready, on the UI thread.
  const ready = useSharedValue(canSend ? 1 : 0);
  useEffect(() => {
    ready.value = withTiming(canSend ? 1 : 0, fade(D.fast));
  }, [canSend, ready]);
  const readyStyle = useAnimatedStyle(() => ({ opacity: ready.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: 1 - ready.value }));
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall, haptic: false });

  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={!canSend}
      accessibilityRole="button"
      accessibilityLabel="Send message"
      accessibilityState={{ disabled: !canSend }}
      accessibilityHint={hint}
      style={styles.sendSlot}
    >
      <Animated.View style={[styles.send, press.animatedStyle]}>
        <Animated.View style={[styles.sendRest, restStyle]} />
        {/* The glow sits on an opaque, unclipped layer so iOS draws it. */}
        <Animated.View style={[styles.sendReady, readyStyle]}>
          <View style={styles.sendClip}>
            <LinearGradient colors={GRAD.aurora} locations={[0, 0.6, 1]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={FILL} />
          </View>
        </Animated.View>
        <Animated.View style={[styles.sendIcon, restStyle]}>
          <NavIcon name="send" color={W.text3} size={17} />
        </Animated.View>
        <Animated.View style={[styles.sendIcon, readyStyle]}>
          <NavIcon name="send" color={W.onAccent} size={17} />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
});

// ─── TypingDots ──────────────────────────────────────────────────────────
/** The companion is composing. The dots hold still under Reduce Motion, so
 *  the label is what carries the meaning there and for VoiceOver. */
export const TypingDots = memo(function TypingDots({ name }: { name?: string }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={name ? `${name} is typing` : 'Typing'}
      style={styles.typing}
    >
      {[0, 1, 2].map(i => <TypingDot key={i} delay={i * 150} />)}
    </View>
  );
});

function TypingDot({ delay }: { delay: number }) {
  const pulse = useDotPulse(delay);
  return <RNAnimated.View style={[styles.dot, pulse]} />;
}

// ─── DayDivider ──────────────────────────────────────────────────────────
/** Centered chip that stamps the thread with a time ("Today 9:41 PM") or
 *  marks where something else begins ("Voice call"). */
export const DayDivider = memo(function DayDivider({ label, icon }: { label: string; icon?: IconName }) {
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} style={styles.divider}>
      {icon ? <NavIcon name={icon} color={W.text3} size={12} /> : null}
      <Txt variant="caption" weight={500} maxScale={1.3} style={styles.dividerText}>{label}</Txt>
    </View>
  );
});

// ─── AiNotice ────────────────────────────────────────────────────────────
// The legally required "you're talking with an AI" line (see lib/aiNotice).
// Quiet like the day divider, but readable: it has to be clear, not decorative.
export const AiNotice = memo(function AiNotice({ text }: { text: string }) {
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={text} style={styles.notice}>
      <NavIcon name="sparkle" color={W.text3} size={12} />
      <Txt variant="caption" weight={500} style={styles.noticeText}>{text}</Txt>
    </View>
  );
});

/**
 * Calls onDue every 3 hours the screen stays open. Checked each minute rather
 * than one long timeout, which Android can defer while the app is backgrounded.
 */
export function useAiNoticeRepeat(onDue: () => void): void {
  const lastShown = useRef(Date.now());
  const callback = useRef(onDue);
  callback.current = onDue;
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      if (aiNoticeDue(lastShown.current, now)) {
        lastShown.current = now;
        callback.current();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);
}

// ─── RecallIndicator ─────────────────────────────────────────────────────
// Shown while a reply is being composed but before the first token lands, and
// only for a companion that holds memories: every turn pulls from them, so
// that is what the pause is. Quiet gold: it explains the wait, not fills it.
export const RecallIndicator = memo(function RecallIndicator() {
  const pulse = useDotPulse(0);
  return (
    <RNAnimated.View style={[styles.recall, pulse]}>
      <NavIcon name="sparkle-solid" color={W.gold} size={12} />
      <Txt variant="caption" weight={500} color={W.recall}>recalling your memories…</Txt>
    </RNAnimated.View>
  );
});

// ─── CapHitCard ──────────────────────────────────────────────────────────
/**
 * The daily message cap, said plainly. It replaces what used to appear in its
 * place: a message from the companion apologising for not reaching the server.
 *
 * A paid subscriber is told the limit and nothing else — offering them Plus
 * when they already pay more than Plus is worse than saying nothing.
 */
export function CapHitCard({ onUpgrade, dailyCap, resetsAt, upsell = true, message }: {
  onUpgrade: () => void;
  /** Messages a day on this plan, when known. */
  dailyCap?: number | null;
  /** ISO instant the cap resets — the user's own next midnight. */
  resetsAt?: string | null;
  upsell?: boolean;
  /**
   * The server's own wording, for a refusal this card does not know the shape
   * of — the per-minute abuse ceiling, say. Shown instead of the copy below.
   */
  message?: string | null;
}) {
  // Usually the user's own local midnight, so say "midnight" rather than
  // "12:00 AM". An account with no timezone stored resets at UTC midnight,
  // which really is a wall-clock time for them — so show it.
  const reset = resetsAt ? new Date(resetsAt) : null;
  const when = !reset || Number.isNaN(reset.getTime())
    ? null
    : reset.getHours() === 0 && reset.getMinutes() === 0
      ? 'midnight'
      : reset.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const copy = message ?? [
    dailyCap ? `You've sent today's ${dailyCap} messages.` : "You've reached today's message limit.",
    when ? `They reset at ${when}.` : '',
    upsell ? 'Plus raises the daily limit.' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => { announce(copy); }, [copy]);
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall });
  const [entering] = useState(() => enter.fadeUp);

  return (
    <Animated.View entering={entering} style={styles.cap}>
      <Txt variant="subhead" color={W.text}>{copy}</Txt>
      {upsell ? (
        <Animated.View style={press.animatedStyle}>
          <Pressable
            onPress={onUpgrade}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            unstable_pressDelay={PRESS_DELAY}
            hitSlop={minTarget(HIT, CAP_BUTTON_H)}
            accessibilityRole="button"
            accessibilityHint="Opens plans"
            style={({ pressed }) => [styles.capButton, pressed ? styles.pressed : null]}
          >
            <Txt variant="footnote" weight={600} maxScale={1.3} color={W.onAccent}>See plans</Txt>
          </Pressable>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
const CAP_BUTTON_H = 36;

// ─── SuggestionChip ──────────────────────────────────────────────────────
// A conversation starter above the composer. Tapping puts it in the message
// box (to send or edit); the chosen one stays lit while it is the draft.
const CHIP_SLOP = { top: SP.xs, bottom: SP.xs };

export function SuggestionChip({ children, selected = false, onPress }: {
  children: string; selected?: boolean; onPress: () => void;
}) {
  // No haptic on touch-down: the row scrolls sideways, and a touch that turns
  // into a scroll shouldn't tick.
  const press = usePressFeedback({ haptic: false });
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={() => { haptic.selection(); onPress(); }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        unstable_pressDelay={PRESS_DELAY}
        hitSlop={CHIP_SLOP}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityHint={selected ? 'In your message' : 'Puts this in your message'}
        style={({ pressed }) => [styles.chip, selected ? styles.chipSelected : null, pressed ? styles.chipPressed : null]}
      >
        <Txt variant="subhead" weight={500} numberOfLines={1} maxScale={1.3} color={selected ? W.cream : W.primarySoft}>
          {children}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

// ─── MessageNote ─────────────────────────────────────────────────────────
// The line under a message that didn't make it: "Not sent · Retry".
export interface NoteAction {
  label: string;
  hint?: string;
  onPress: () => void;
  /** Can't run right now (another reply is on its way); says why in `disabledHint`. */
  disabled?: boolean;
  disabledHint?: string;
  /** Running now: shown as busy and not pressable. */
  busy?: boolean;
  busyLabel?: string;
}

export const MessageNote = memo(function MessageNote({ text, actionLabel, actionHint, onAction, actions, align = 'start', animateIn = true }: {
  text: string;
  actionLabel?: string;
  actionHint?: string;
  onAction?: () => void;
  /** Several actions (Reload and Retry); used instead of actionLabel/onAction. */
  actions?: NoteAction[];
  align?: 'start' | 'end';
  /** Fade in on mount; off when a thread re-mounts a note it already showed. */
  animateIn?: boolean;
}) {
  const [entering] = useState(() => (animateIn ? enter.fade : undefined));
  const list = actions ?? (actionLabel && onAction ? [{ label: actionLabel, hint: actionHint, onPress: onAction }] : []);
  return (
    <Animated.View entering={entering} style={[styles.msgNote, align === 'end' ? styles.end : styles.start]}>
      <NavIcon name="alert" color={W.dangerText} size={13} />
      <Txt variant="footnote" style={styles.msgNoteText}>{text}</Txt>
      {list.map(a => <NoteButton key={a.label} action={a} />)}
    </Animated.View>
  );
});

function NoteButton({ action: a }: { action: NoteAction }) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall, haptic: a.disabled || a.busy ? false : 'light' });
  const inert = !!(a.disabled || a.busy);
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={a.onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        unstable_pressDelay={PRESS_DELAY}
        disabled={inert}
        hitSlop={minTarget(HIT, NOTE_ACTION_H)}
        accessibilityRole="button"
        accessibilityLabel={a.busy ? a.busyLabel ?? a.label : a.label}
        accessibilityState={{ disabled: inert, busy: !!a.busy }}
        accessibilityHint={a.disabled ? a.disabledHint : a.hint}
        style={({ pressed }) => [styles.msgNoteAction, pressed ? styles.pressed : null]}
      >
        <Txt variant="footnote" weight={600} color={inert ? W.text3 : W.primarySoft}>
          {a.busy ? a.busyLabel ?? a.label : a.label}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}
const NOTE_ACTION_H = 28;

// ─── useStickToBottom ────────────────────────────────────────────────────
// Within this distance of the end a thread follows new content; past the
// second it offers the way back.
const NEAR_END = 80;
const FAR_FROM_END = 320;

/** The scrolling part of a ScrollView or FlatList this hook drives. */
interface Scroller {
  scrollToEnd?: (o?: { animated?: boolean }) => void;
  scrollToOffset?: (o: { offset: number; animated?: boolean }) => void;
}

/**
 * Keeps a chat thread on its latest message without hijacking a reader who
 * has scrolled up. Spread `scrollProps` on the list, call `pin()` when the
 * user sends and `arrived()` when the other side adds something, and render
 * <JumpToLatest unseen={unseen} onPress={jump} /> while `showJump`.
 *
 * `inverted`: for an inverted FlatList, whose latest end is offset 0. There
 * the list itself stays at the end as content grows (with
 * maintainVisibleContentPosition), so nothing follows content size.
 */
export function useStickToBottom<T = ScrollView>(opts?: { inverted?: boolean }) {
  const inverted = !!opts?.inverted;
  const scrollRef = useRef<T>(null);
  // Unanimated when following: an animated scroll restarted on every token jitters.
  const nearEnd = useRef(true);
  const awayRef = useRef(false);
  const [away, setAway] = useState(false);
  // Rendered form of nearEnd, for lists that behave differently at the end.
  const [atEnd, setAtEnd] = useState(true);
  const [unseen, setUnseen] = useState(false);

  const toEnd = useCallback((animated: boolean) => {
    const list = scrollRef.current as unknown as Scroller | null;
    if (inverted) list?.scrollToOffset?.({ offset: 0, animated });
    else list?.scrollToEnd?.({ animated });
  }, [inverted]);
  const follow = useCallback(() => { if (nearEnd.current) toEnd(false); }, [toEnd]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const gap = inverted
      ? contentOffset.y
      : contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const near = gap < NEAR_END;
    if (near !== nearEnd.current) setAtEnd(near);
    nearEnd.current = near;
    const far = gap > FAR_FROM_END;
    if (far !== awayRef.current) {
      awayRef.current = far;
      setAway(far);
    }
    if (nearEnd.current) setUnseen(false);
  }, [inverted]);

  /** The user sent something: bring the thread to its end. */
  const pin = useCallback(() => {
    nearEnd.current = true;
    requestAnimationFrame(() => toEnd(true));
  }, [toEnd]);

  /** Something new arrived: out of sight, it earns the "New message" button. */
  const arrived = useCallback(() => {
    if (!nearEnd.current) setUnseen(true);
  }, []);

  const jump = useCallback(() => {
    nearEnd.current = true;
    setUnseen(false);
    toEnd(true);
  }, [toEnd]);

  const scrollProps = useMemo(() => ({
    onScroll,
    // The keyboard shrinking the viewport doesn't change the content size, so
    // without onLayout the latest message would slip under it. An inverted
    // list is anchored at its latest end already, and a FlatList needs every
    // scroll event to mount rows in time, so it keeps its own throttle.
    ...(inverted ? null : { scrollEventThrottle: 100, onContentSizeChange: follow, onLayout: follow }),
    keyboardShouldPersistTaps: 'handled' as const,
    keyboardDismissMode: Platform.OS === 'ios' ? ('interactive' as const) : ('on-drag' as const),
  }), [onScroll, follow, inverted]);

  return { scrollRef, scrollProps, showJump: away || unseen, unseen, atEnd, pin, arrived, jump };
}

// ─── JumpToLatest ────────────────────────────────────────────────────────
// Floats above the composer while the reader is up in the history. It says
// "New message" when a reply has landed out of sight.
export function JumpToLatest({ unseen, onPress }: { unseen: boolean; onPress: () => void }) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall });
  const [entering] = useState(() => enter.scaleIn);
  const [exiting] = useState(() => exit.scaleOut);
  return (
    <Animated.View entering={entering} exiting={exiting} style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={minTarget(JUMP_H)}
        accessibilityRole="button"
        accessibilityLabel={unseen ? 'New message. Jump to latest' : 'Jump to latest message'}
        style={[styles.jump, unseen ? styles.jumpUnseen : null]}
      >
        {unseen ? <Txt variant="footnote" weight={600} maxScale={1.2} color={W.onAccent}>New message</Txt> : null}
        <NavIcon name="down" color={unseen ? W.onAccent : W.text} size={16} />
      </Pressable>
    </Animated.View>
  );
}
const JUMP_H = 36;

const styles = StyleSheet.create({
  start: { alignSelf: 'flex-start' },
  end: { alignSelf: 'flex-end' },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.75 },

  wrapStart: { maxWidth: '80%', alignSelf: 'flex-start' },
  wrapEnd: { maxWidth: '80%', alignSelf: 'flex-end' },
  bubble: {
    borderRadius: R.bubble, paddingVertical: SP.sm2 + 1, paddingHorizontal: SP.md2 + 1, borderWidth: 1,
  },
  bubbleUser: {
    borderBottomRightRadius: R.xs, backgroundColor: GRAD.userBubble[0], borderColor: W.hairline,
  },
  bubbleComp: {
    borderBottomLeftRadius: R.xs, backgroundColor: rgba(W.text, 0.06), borderColor: W.hairlineStrong, borderLeftWidth: 2,
  },
  bubbleRow: { flexDirection: 'row', alignItems: 'flex-end' },
  bubbleText: { color: W.cream },
  // A held bubble dims while the long-press counts down to the report sheet.
  held: { opacity: 0.7 },
  caret: { width: 2, height: 14, borderRadius: 1, marginLeft: 3, marginBottom: 4, backgroundColor: W.primarySoft },

  composer: { marginHorizontal: SP.md, marginBottom: SP.sm2 },
  counter: { position: 'absolute', right: SP.base, top: -SP.lg, fontVariant: ['tabular-nums'] },
  capsule: {
    padding: CAPSULE_PAD, borderRadius: FIELD_R + CAPSULE_PAD,
    flexDirection: 'row', alignItems: 'flex-end', gap: SP.xs2,
    backgroundColor: W.glassBar, borderWidth: 1, borderColor: W.hairlineStrong,
  },
  capsuleGlass: { ...FILL, borderRadius: FIELD_R + CAPSULE_PAD, overflow: 'hidden' },
  capsuleHighlight: {
    position: 'absolute', left: FIELD_R, right: FIELD_R, top: 0, height: 1, backgroundColor: W.hairline,
  },
  field: { flex: 1, minHeight: HIT, justifyContent: 'center', borderRadius: FIELD_R },
  fieldBorder: { ...FILL, borderRadius: FIELD_R, borderWidth: 1 },
  fieldFocused: { borderColor: rgba(W.primary, 0.45) },
  input: {
    color: W.text, fontFamily: resolveFont('user', 400), fontSize: TYPE.body.size,
    paddingHorizontal: SP.md2, paddingTop: SP.sm2 + 1, paddingBottom: SP.sm2 + 1,
  },
  sendSlot: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  send: { width: SEND, height: SEND },
  sendRest: { ...FILL, borderRadius: SEND / 2, backgroundColor: W.surface3, borderWidth: 1, borderColor: W.hairline },
  sendReady: { ...FILL, borderRadius: SEND / 2, backgroundColor: W.rose, ...ELEV.glow(W.rose, 14, 0.45) },
  sendClip: { ...FILL, borderRadius: SEND / 2, overflow: 'hidden' },
  sendIcon: { ...FILL, alignItems: 'center', justifyContent: 'center' },

  typing: {
    alignSelf: 'flex-start', flexDirection: 'row', gap: SP.xs,
    paddingVertical: SP.md2, paddingHorizontal: SP.md2,
    borderRadius: R.bubble, borderBottomLeftRadius: R.xs, borderWidth: 1, borderLeftWidth: 2,
    backgroundColor: rgba(W.text, 0.06), borderColor: W.hairlineStrong, borderLeftColor: rgba(W.primary, 0.55),
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: W.primary },

  divider: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: SP.xs2,
    marginTop: SP.base, marginBottom: SP.xs, paddingVertical: SP.xs, paddingHorizontal: SP.md,
    borderRadius: R.md, backgroundColor: W.hairlineFaint,
  },
  dividerText: { color: W.text3, letterSpacing: 0.3 },

  notice: {
    alignSelf: 'center', maxWidth: '88%', marginVertical: SP.xs2,
    paddingVertical: SP.xs2, paddingHorizontal: SP.md, borderRadius: R.md,
    backgroundColor: W.hairlineFaint, flexDirection: 'row', alignItems: 'center', gap: SP.xs2,
  },
  noticeText: { color: W.text2, textAlign: 'center', flexShrink: 1 },

  recall: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: SP.xs2, paddingLeft: SP.xs },

  cap: {
    alignSelf: 'center', maxWidth: '88%', marginTop: SP.md, padding: SP.md2, gap: SP.sm2,
    alignItems: 'flex-start', borderRadius: R.lg, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glass,
  },
  capButton: {
    minHeight: CAP_BUTTON_H, justifyContent: 'center', paddingHorizontal: SP.base,
    borderRadius: R.md, backgroundColor: W.primary,
  },

  chip: {
    minHeight: 36, justifyContent: 'center', paddingHorizontal: SP.md2, borderRadius: R.pill, borderWidth: 1,
    backgroundColor: rgba(W.primary, 0.08), borderColor: rgba(W.primary, 0.28),
  },
  chipSelected: { backgroundColor: rgba(W.primary, 0.22), borderColor: rgba(W.primary, 0.6) },
  chipPressed: { backgroundColor: rgba(W.primary, 0.16) },

  msgNote: { flexDirection: 'row', alignItems: 'center', gap: SP.xs2, marginTop: SP.xs2, maxWidth: '90%' },
  msgNoteText: { color: W.dangerText, flexShrink: 1 },
  msgNoteAction: { minHeight: NOTE_ACTION_H, justifyContent: 'center', paddingHorizontal: SP.xs2 },

  jump: {
    minWidth: JUMP_H, minHeight: JUMP_H, paddingHorizontal: SP.sm2, borderRadius: R.pill,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xs2,
    backgroundColor: W.surface2, borderWidth: 1, borderColor: W.hairlineStrong, ...ELEV.mid,
  },
  jumpUnseen: { backgroundColor: W.primary, borderColor: W.primary },
});
