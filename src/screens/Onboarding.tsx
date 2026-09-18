// Onboarding.tsx — S01 Splash → S02 Age → S03 Disclosure → S05 Pronouns →
// S06 Comm → Handoff → S04 Archetype → S07 Voice → S08 Name → Meet.
//
// Progress is counted within two phases: "About you" (age, disclosure,
// pronouns, comm) and "Your companion" (archetype, voice, name). Adding a
// second companion enters at the archetype step, so its "1 of 3" stays true
// without the screens knowing which flow they are in.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions,
  type AccessibilityActionEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle,
} from 'react-native';
import Animated, {
  Extrapolation, interpolate, ReduceMotion, scrollTo, useAnimatedRef, useAnimatedScrollHandler,
  useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Line } from 'react-native-svg';

import { Screen, TopBar } from '../components/Chrome';
import { Txt } from '../components/Txt';
import { NavIcon, type IconName } from '../components/NavIcon';
import {
  BackButton, Card, EmptyState, ErrorState, GlassFill, IconButton, InlineNotice, Pill, PrimaryButton,
  ProgressDots, Skeleton,
} from '../components/Atoms';
import { Orb } from '../components/Orb';
import { Waveform } from '../components/Avatar';
import { RadialGlow } from '../components/RadialGlow';
import { announce, useScreenReader } from '../hooks/useAccessibilityPrefs';
import { haptic } from '../lib/haptics';
import { GREETING_TEXT, hasVoicePreview, useVoicePreview } from '../lib/voicePreview';
import { canOpenCrisisResource, crisisResources, openCrisisResource, type CrisisResource } from '../data/crisis';
import { enter, spring, timing, useBreath, usePressFeedback, useReducedMotion } from '../theme/motion';
import { HIT, MOTION, R, resolveFont, rgba, SP, TYPE, W } from '../theme/theme';
import type { Archetype, Go, ScreenName } from '../navigation/types';
import { useBlockSwipeBack, useSceneFocused } from '../navigation/sceneContext';
import { ARCHETYPE_COLORS, NAME_SUGGESTIONS } from '../data/config';
import type { ApiVoice } from '../api';

const D = MOTION.duration;
const FILL = StyleSheet.absoluteFillObject;

// Typed text grows with Dynamic Type like the labels around it, up to a cap
// that keeps each field on one line.
const INPUT_MAX_SCALE = 1.6;

// ─── Shared step chrome ────────────────────────────────────────────────────

const PHASES = {
  about: { label: 'About you', steps: 4 },
  companion: { label: 'Your companion', steps: 3 },
} as const;
type Phase = keyof typeof PHASES;

function StepProgress({ phase, step }: { phase: Phase; step: number }) {
  const { label, steps } = PHASES[phase];
  return (
    <View accessible accessibilityLabel={`${label}, step ${step} of ${steps}`}>
      <ProgressDots total={steps} current={step} />
    </View>
  );
}

/** Top bar for a numbered step: Back (when there is somewhere to go) and progress.
 *  `backDisabled` keeps Back in place but dimmed and inert, and says so to
 *  VoiceOver, e.g. while the step waits on the server. */
function StepBar({ onBack, backDisabled = false, phase, step }: {
  onBack?: () => void; backDisabled?: boolean; phase: Phase; step: number;
}) {
  let back: React.ReactNode;
  if (onBack && backDisabled) {
    // BackButton has no disabled state; this is the same control with one.
    back = <IconButton icon="back" label="Back" onPress={onBack} size={HIT} iconSize={24} haptic={false} disabled style={styles.backInert} />;
  } else if (onBack) {
    back = <BackButton onPress={onBack} />;
  }
  return <TopBar left={back} center={<StepProgress phase={phase} step={step} />} />;
}

// ScreenStack keeps covered screens mounted, and their UI-thread loops keep
// running under the screen in front (its freeze only stops React renders).
// A screen with ambient loops stops them once the screen over it has fully
// arrived, not as soon as it starts to, because until then it is still in
// view; it starts them again the moment it is uncovered.
const COVER_SETTLE_MS = D.slower;

function useInView(): boolean {
  const focused = useSceneFocused();
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (focused) {
      setHidden(false);
      return;
    }
    const t = setTimeout(() => setHidden(true), COVER_SETTLE_MS);
    return () => clearTimeout(t);
  }, [focused]);
  return focused || !hidden;
}

/** The one heading recipe every step uses. */
function StepHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <View>
      <Txt variant="eyebrow" style={styles.eyebrow}>{eyebrow}</Txt>
      <Txt variant="title1" heading style={styles.title}>{title}</Txt>
      {body ? <Txt variant="callout" style={styles.lede}>{body}</Txt> : null}
    </View>
  );
}

/** Arrives once on mount: a short rise and fade, or a plain fade (always,
 *  under Reduce Motion). */
function Reveal({ delay = 0, rise = true, style, children }: {
  delay?: number; rise?: boolean; style?: StyleProp<ViewStyle>; children: React.ReactNode;
}) {
  // The presets hand out a fresh builder per read and .delay() mutates it,
  // so read one per mount.
  const [entering] = useState(() => (rise ? enter.fadeUp.delay(delay) : enter.fade.delay(delay)));
  return <Animated.View entering={entering} style={style}>{children}</Animated.View>;
}

// Picking an answer moves on by itself after a beat, so the choice is seen
// landing. The timer dies with the screen (Back inside the beat wins), and a
// second pick restarts it instead of navigating twice. With VoiceOver on,
// nothing moves on its own: the screen shows a Continue button instead.
const ADVANCE_MS = 280;

function useAutoAdvance(go: Go) {
  const screenReader = useScreenReader();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const advance = useCallback((to: ScreenName) => {
    if (screenReader) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(to), ADVANCE_MS);
  }, [go, screenReader]);
  return { advance, manual: screenReader };
}

/** Full-width single-choice pills. Stacked, so long labels ("They / Them",
 *  "Direct & honest") never wrap inside a pill, even at 320pt. */
function ChoiceGroup({ label, options, picked, onPick, hint, dimmed = false }: {
  label: string;
  options: readonly string[];
  picked: string | null;
  onPick: (option: string) => void;
  hint?: string;
  dimmed?: boolean;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.choices, dimmed ? styles.dimmed : null]}>
      {options.map(o => (
        <Pill key={o} selected={picked === o} onPress={() => onPick(o)} accessibilityHint={hint}>
          {o}
        </Pill>
      ))}
    </View>
  );
}

// ─── S01 SPLASH ──────────────────────────────────────────────────────────
// A single luminous frosted disc holding the wordmark, a line of copy and a
// quiet hint. While the router is still deciding where a returning user goes
// (`booting`), nothing here can be tapped and the hint says it is getting
// ready — and only after a beat, so a fast boot never flashes it.
const WAIT_HINT_DELAY = 600;

const HALO_STOPS = [
  { offset: 0, color: W.primary, opacity: 0.5 },
  { offset: 0.5, color: W.primary, opacity: 0.2 },
  { offset: 1, color: W.primary, opacity: 0 },
] as const;
const BURST_STOPS = [
  { offset: 0.35, color: W.primary, opacity: 0.8 },
  { offset: 1, color: W.primary, opacity: 0 },
] as const;
const DISC_SHADE = [rgba(W.text, 0.06), rgba(W.shadow, 0.1)] as const;

export function S01_Splash({ go, goNew, booting = false }: { go: Go; goNew?: () => void; booting?: boolean }) {
  const { width, height } = useWindowDimensions();
  const disc = Math.round(Math.min(220, width * 0.58, height * 0.3));
  const stage = Math.round(disc * 1.27);
  const halo = Math.round(disc * 1.9);
  const roomy = height >= 700;

  const [waitHint, setWaitHint] = useState(false);
  useEffect(() => {
    if (!booting) return;
    const t = setTimeout(() => setWaitHint(true), WAIT_HINT_DELAY);
    return () => clearTimeout(t);
  }, [booting]);

  // Ambient loops: both hold still under Reduce Motion and in the background.
  const breath = useBreath(9600, { rest: 0.5 });
  const cursor = useBreath(booting ? 2400 : 1200, { rest: 1, paused: booting && !waitHint });

  const pressScale = useSharedValue(1);
  const burst = useSharedValue(0);
  const leave = useSharedValue(1);
  const leaving = useRef(false);
  const enterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (enterTimer.current) clearTimeout(enterTimer.current); }, []);

  const enterApp = () => (goNew ? goNew() : go('login'));
  const handleEnter = () => {
    // A second tap would restart the fade and cut the first one short.
    if (booting || leaving.current) return;
    leaving.current = true;
    haptic.light();
    pressScale.value = withSequence(withSpring(1.08, spring('snappy')), withSpring(1, spring('gentle')));
    burst.value = withTiming(1, timing(D.base));
    // The press lands for a beat, then sign-in starts arriving while this
    // fades: the router's cross-fade overlaps the fade instead of following it.
    leave.value = withDelay(D.fast, withTiming(0, timing(D.base, 'accel')));
    enterTimer.current = setTimeout(enterApp, D.fast);
  };

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + breath.value * 0.45,
    transform: [{ scale: 0.98 + breath.value * 0.08 }],
  }));
  const burstStyle = useAnimatedStyle(() => ({ opacity: burst.value * 0.6 }));
  const discStyle = useAnimatedStyle(() => ({ transform: [{ scale: pressScale.value }] }));
  const leaveStyle = useAnimatedStyle(() => ({ opacity: leave.value }));
  const cursorStyle = useAnimatedStyle(() => ({ opacity: 0.2 + cursor.value * 0.8 }));

  return (
    <Screen ambientIntensity={1.4} ambientPulse>
      <Animated.View style={[styles.grow, leaveStyle]}>
        {/* The disc carries the name for VoiceOver; this row is decoration. */}
        <View style={styles.brandRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.brandDot} />
          <Txt variant="eyebrow" style={styles.brandText}>Evarna</Txt>
        </View>

        <View style={styles.splashCenter}>
          <View style={{ width: stage, height: stage, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View pointerEvents="none" style={[styles.centered, haloStyle]}>
              <RadialGlow width={halo} height={halo} stops={HALO_STOPS} />
            </Animated.View>
            <View
              pointerEvents="none"
              style={[styles.discRing, { width: disc * 1.09, height: disc * 1.09, borderRadius: disc }]}
            />
            <Animated.View pointerEvents="none" style={[styles.centered, burstStyle]}>
              <RadialGlow width={stage} height={stage} stops={BURST_STOPS} />
            </Animated.View>

            <Pressable
              onPress={handleEnter}
              disabled={booting}
              hitSlop={SP.lg}
              accessibilityRole={booting ? 'image' : 'button'}
              accessibilityLabel={booting ? 'Evarna' : 'Enter Evarna'}
            >
              <Animated.View style={discStyle}>
                <View style={[styles.disc, { width: disc, height: disc, borderRadius: disc / 2 }]}>
                  <GlassFill intensity={50} />
                  <View
                    pointerEvents="none"
                    style={[styles.discHighlight, { height: disc * 0.45, borderTopLeftRadius: disc / 2, borderTopRightRadius: disc / 2 }]}
                  />
                  <LinearGradient pointerEvents="none" colors={DISC_SHADE} style={FILL} />
                  {/* A logo: it stays its size whatever the text setting. */}
                  <Txt font="comp" weight={500} maxScale={1} style={{ fontSize: Math.round(disc * 0.18), color: W.cream, letterSpacing: -disc * 0.008 }}>
                    evarna
                  </Txt>
                  <View style={styles.discDot} />
                </View>
              </Animated.View>
            </Pressable>
          </View>

          <Reveal delay={120} style={{ marginTop: roomy ? SP.xxxl : SP.xl }}>
            <Txt font="comp" weight={400} maxScale={1.3} style={styles.tagline}>
              A quieter space{'\n'}for the things you carry.
            </Txt>
          </Reveal>

          <View style={[styles.splashHint, { marginTop: roomy ? SP.xxxl : SP.xl }]}>
            {booting ? (
              waitHint ? (
                <Reveal key="wait" rise={false}>
                  <View accessible accessibilityLabel="Getting ready" accessibilityState={{ busy: true }} style={styles.hintRow}>
                    <Animated.View style={[styles.cursor, cursorStyle]} />
                    <Txt variant="eyebrow" style={styles.hintText}>Getting ready</Txt>
                  </View>
                </Reveal>
              ) : null
            ) : (
              // Arrives with the tagline: the disc can be tapped from the
              // start, so the hint shouldn't lag behind it.
              <Reveal key="enter" rise={false} delay={120}>
                {/* A bigger target for the same action; VoiceOver uses the disc. */}
                <Pressable
                  onPress={handleEnter}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={styles.hintRow}
                >
                  <Animated.View style={[styles.cursor, cursorStyle]} />
                  <Txt variant="eyebrow" style={styles.hintText}>Tap to enter</Txt>
                </Pressable>
              </Reveal>
            )}
          </View>
        </View>
      </Animated.View>
    </Screen>
  );
}

// ─── DateWheel ───────────────────────────────────────────────────────────
// A drum picker. The scroll view scrolls natively; each row's fade and scale
// follow the scroll position on the UI thread, so nothing re-renders while it
// spins. It reports a value only when it comes to rest, ticks a selection
// haptic at every row, and is one adjustable element for VoiceOver.
//
// Only the rows around the centre are mounted (the year wheel has over a
// hundred, each with its own UI-thread style). The window follows the wheel
// in steps and reaches a few rows past what can be seen, so a fast spin
// never runs off its edge.
const WHEEL_MAX_SCALE = 1.35;
const WHEEL_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];
const WHEEL_FADE_TOP = [rgba(W.bg, 0.95), rgba(W.bg, 0)] as const;
const WHEEL_FADE_BOTTOM = [rgba(W.bg, 0), rgba(W.bg, 0.95)] as const;
/** Rows the wheel turns before the window re-centres on it. */
const WINDOW_STEP = 3;
/** Extra rows mounted beyond the visible ones, for the moment JS takes to catch up. */
const WINDOW_SLACK = 3;

interface WheelProps {
  /** Spoken name, e.g. "Birth month". */
  label: string;
  /** Row labels. Row 0 is the "not set" placeholder. */
  options: readonly string[];
  /** What VoiceOver says for each row, when it differs from the label. */
  spoken?: readonly string[];
  value: number;
  onChange: (index: number) => void;
  rowH: number;
  rows: number;
  style?: StyleProp<ViewStyle>;
}

const WheelRow = memo(function WheelRow({ text, index, y, rowH, top, placeholder }: {
  text: string; index: number; y: SharedValue<number>; rowH: number; top: number; placeholder: boolean;
}) {
  // One family and size throughout; emphasis comes from scale and fade.
  const style = useAnimatedStyle(() => {
    const d = Math.abs(y.value / rowH - index);
    return {
      opacity: interpolate(d, [0, 1, 2, 3], [1, 0.5, 0.25, 0.12], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(d, [0, 1, 2], [1, 0.86, 0.76], Extrapolation.CLAMP) }],
    };
  });
  return (
    <Animated.View style={[styles.wheelRow, { top, height: rowH }, style]}>
      <Txt variant="title3" maxScale={WHEEL_MAX_SCALE} numberOfLines={1} style={{ color: placeholder ? W.text3 : W.cream }}>
        {text}
      </Txt>
    </Animated.View>
  );
});

type ScrollEvent = NativeSyntheticEvent<NativeScrollEvent>;

function DateWheel({ label, options, spoken, value, onChange, rowH, rows, style }: WheelProps) {
  const ref = useAnimatedRef<Animated.ScrollView>();
  const y = useSharedValue(value * rowH);
  const detent = useSharedValue(value);
  const last = options.length - 1;
  const pad = rowH * Math.floor(rows / 2);

  // The rows mounted: those within `reach` of `windowAt`, which follows the
  // wheel whenever it has turned WINDOW_STEP rows away.
  const [windowAt, setWindowAt] = useState(value);
  const reach = Math.floor(rows / 2) + WINDOW_STEP + WINDOW_SLACK;
  const firstRow = Math.max(0, windowAt - reach);
  const lastRow = Math.min(last, windowAt + reach);

  // Snap points as offsets rather than an interval: Android truncates the
  // interval to whole pixels and the error adds up row by row (with large
  // text, enough by the far end of the year wheel to snap to the wrong
  // year); each offset is truncated on its own, so it stays within a pixel.
  const snaps = useMemo(() => Array.from({ length: last + 1 }, (_, i) => i * rowH), [last, rowH]);
  // Where the wheel starts. Only read on mount: a changed contentOffset makes
  // the native view jump there, and the effect below scrolls instead.
  const [startOffset] = useState(() => ({ x: 0, y: value * rowH }));

  // The native handlers call into these stable functions, which read the
  // latest props.
  const latest = useRef({ value, onChange, rowH, last });
  useEffect(() => { latest.current = { value, onChange, rowH, last }; });
  const resting = useRef(value);
  const [onDetent] = useState(() => (i: number) => {
    haptic.selection();
    setWindowAt(w => (Math.abs(i - w) >= WINDOW_STEP ? i : w));
  });

  // A value is reported only where the wheel comes to rest, and only after
  // the user moved it: 'dragging' from the first touch, 'coasting' once the
  // finger lifts, back to 'idle' when the wheel settles. Scrolls the wheel
  // makes itself (following `value`) end while idle and report nothing.
  const gesture = useRef<'idle' | 'dragging' | 'coasting'>('idle');
  const [handlers] = useState(() => {
    const rowAt = (offset: number) => {
      const { rowH: h, last: end } = latest.current;
      return Math.min(end, Math.max(0, Math.round(offset / h)));
    };
    const settle = (offset: number) => {
      gesture.current = 'idle';
      const index = rowAt(offset);
      resting.current = index;
      if (index !== latest.current.value) latest.current.onChange(index);
    };
    return {
      onScrollBeginDrag: () => { gesture.current = 'dragging'; },
      onScrollEndDrag: (e: ScrollEvent) => {
        gesture.current = 'coasting';
        // iOS says where the snap will land (Android doesn't, and always
        // reports a momentum end after its snap). Settle now only when
        // nothing more will move: let go with no speed, iOS stops on the
        // nearest row. Otherwise wait for the momentum end, so a row the
        // wheel merely passes is never reported (a month passed on the way
        // would clamp the day).
        const { contentOffset, targetContentOffset, velocity } = e.nativeEvent;
        if (!targetContentOffset) return;
        const coasts = (velocity?.y ?? 0) !== 0 && Math.abs(targetContentOffset.y - contentOffset.y) >= 0.5;
        if (!coasts) settle(targetContentOffset.y);
      },
      onMomentumScrollEnd: (e: ScrollEvent) => {
        if (gesture.current === 'coasting') settle(e.nativeEvent.contentOffset.y);
      },
    };
  });

  const onScroll = useAnimatedScrollHandler({
    onScroll: e => {
      y.value = e.contentOffset.y;
      const i = Math.min(last, Math.max(0, Math.round(e.contentOffset.y / rowH)));
      if (i !== detent.value) {
        detent.value = i;
        scheduleOnRN(onDetent, i);
      }
    },
  });

  // Follow a value set from outside: a day clamped by a shorter month, a
  // VoiceOver adjustment, or new row heights after a text-size change.
  const laidOutAt = useRef(rowH);
  useEffect(() => {
    const resized = laidOutAt.current !== rowH;
    if (resting.current === value && !resized) return;
    resting.current = value;
    laidOutAt.current = rowH;
    setWindowAt(value);
    const to = value * rowH;
    scheduleOnUI(() => {
      'worklet';
      scrollTo(ref, 0, to, !resized);
    });
  }, [value, rowH, ref]);

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const next = value + (e.nativeEvent.actionName === 'increment' ? 1 : -1);
    if (next >= 0 && next <= last) onChange(next);
  };

  const visibleRows: React.ReactNode[] = [];
  for (let i = firstRow; i <= lastRow; i++) {
    visibleRows.push(
      <WheelRow key={i} text={options[i]} index={i} y={y} rowH={rowH} top={pad + i * rowH} placeholder={i === 0} />,
    );
  }

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value === 0 ? 'Not set' : (spoken ?? options)[value] }}
      accessibilityActions={WHEEL_ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
      style={[styles.wheel, { height: rowH * rows }, style]}
    >
      <View pointerEvents="none" style={[styles.wheelBand, { top: pad, height: rowH }]} />
      <Animated.ScrollView
        ref={ref}
        onScroll={onScroll}
        onScrollBeginDrag={handlers.onScrollBeginDrag}
        onScrollEndDrag={handlers.onScrollEndDrag}
        // Also what makes Android send momentum events at all.
        onMomentumScrollEnd={handlers.onMomentumScrollEnd}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        snapToOffsets={snaps}
        decelerationRate="fast"
        contentOffset={startOffset}
        contentContainerStyle={{ height: pad * 2 + options.length * rowH }}
        importantForAccessibility="no-hide-descendants"
      >
        {visibleRows}
      </Animated.ScrollView>
      <LinearGradient pointerEvents="none" colors={WHEEL_FADE_TOP} style={[styles.wheelFade, { top: 0, height: pad }]} />
      <LinearGradient pointerEvents="none" colors={WHEEL_FADE_BOTTOM} style={[styles.wheelFade, { bottom: 0, height: pad }]} />
    </View>
  );
}

// ─── S02 AGE ─────────────────────────────────────────────────────────────
// A neutral age screen: nothing is preselected, every year back from this
// one can be picked (so it doesn't hint at the cut-off), and the age is
// checked here rather than six screens later. The backend checks again.
const MIN_AGE = 15; // the backend's MIN_AGE_YEARS
const YEARS_BACK = 100;
const UNSET = '—';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTH_ROWS = [UNSET, ...MONTHS.map(m => m.slice(0, 3))];
const MONTH_SPOKEN = ['Not set', ...MONTHS];
const WHEEL_FLEX = { month: 1.15, day: 0.8, year: 1 } as const;
const WHEEL_HEAD = { month: 'Month', day: 'Day', year: 'Year' } as const;
type WheelKey = keyof typeof WHEEL_FLEX;

/** Days in a 1-based month; 31 while the month is unknown, and 29 for
 *  February until the year says otherwise. */
function daysInMonth(month: number, year: number | null): number {
  if (!month) return 31;
  return new Date(year ?? 2000, month, 0).getDate();
}

function ageOn(today: Date, year: number, month: number, day: number): number {
  const m = today.getMonth() + 1;
  const beforeBirthday = m < month || (m === month && today.getDate() < day);
  return today.getFullYear() - year - (beforeBirthday ? 1 : 0);
}

function parseDob(s?: string): { year: number; month: number; day: number } | null {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) return null;
  return { year, month, day };
}

// Month-first only where people write dates that way; India, the UK and most
// of the world put the day first.
function monthFirstLocale(): boolean {
  try {
    return /[-_]US(?![a-z])/i.test(Intl.DateTimeFormat().resolvedOptions().locale ?? '');
  } catch {
    return false;
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function S02_Age({ go, onDob, onBack, onSignOut, initialDob }: {
  go: Go;
  onDob?: (dob: string) => void;
  /** Hidden when undefined: right after sign-in there is nowhere to go back to. */
  onBack?: () => void;
  /** Shows "Wrong account? Sign out" when provided. */
  onSignOut?: () => void;
  /** A birthday the user already chose (YYYY-MM-DD), e.g. when they come back from S03. */
  initialDob?: string;
}) {
  const { height, fontScale } = useWindowDimensions();
  const [today] = useState(() => new Date());
  const thisYear = today.getFullYear();
  const [monthFirst] = useState(monthFirstLocale);

  const [initial] = useState(() => parseDob(initialDob));
  const [month, setMonth] = useState(initial?.month ?? 0);
  const [day, setDay] = useState(initial?.day ?? 0);
  const [yearRow, setYearRow] = useState(() => {
    const row = initial ? thisYear - initial.year + 1 : 0;
    return row >= 1 && row <= YEARS_BACK + 1 ? row : 0;
  });
  const year = yearRow ? thisYear - (yearRow - 1) : null;

  const dayCount = daysInMonth(month, year);
  const dayRows = useMemo(() => [UNSET, ...Array.from({ length: dayCount }, (_, i) => String(i + 1))], [dayCount]);
  const yearRows = useMemo(() => [UNSET, ...Array.from({ length: YEARS_BACK + 1 }, (_, i) => String(thisYear - i))], [thisYear]);

  // A shorter month or a non-leap year pulls the day back into range.
  const pickMonth = (m: number) => {
    setMonth(m);
    setDay(d => Math.min(d, daysInMonth(m, year)));
  };
  const pickYear = (row: number) => {
    setYearRow(row);
    setDay(d => Math.min(d, daysInMonth(month, row ? thisYear - (row - 1) : null)));
  };

  const complete = month > 0 && day > 0 && year != null;
  const age = complete ? ageOn(today, year, month, day) : null;
  const future = age != null && age < 0;
  const tooYoung = age != null && age >= 0 && age < MIN_AGE;
  const valid = complete && !future && !tooYoung;
  const readout = complete
    ? (monthFirst ? `${MONTHS[month - 1]} ${day}, ${year}` : `${day} ${MONTHS[month - 1]} ${year}`)
    : '';

  const rowH = Math.round(HIT * Math.min(Math.max(fontScale, 1), WHEEL_MAX_SCALE));
  const rows = height < 640 ? 3 : 5;
  const order: WheelKey[] = monthFirst ? ['month', 'day', 'year'] : ['day', 'month', 'year'];
  const wheels: Record<WheelKey, React.ReactNode> = {
    month: (
      <DateWheel key="month" label="Birth month" options={MONTH_ROWS} spoken={MONTH_SPOKEN}
        value={month} onChange={pickMonth} rowH={rowH} rows={rows} style={{ flex: WHEEL_FLEX.month }} />
    ),
    day: (
      <DateWheel key="day" label="Birth day" options={dayRows}
        value={day} onChange={setDay} rowH={rowH} rows={rows} style={{ flex: WHEEL_FLEX.day }} />
    ),
    year: (
      <DateWheel key="year" label="Birth year" options={yearRows}
        value={yearRow} onChange={pickYear} rowH={rowH} rows={rows} style={{ flex: WHEEL_FLEX.year }} />
    ),
  };

  const handleContinue = () => {
    if (!valid) return;
    onDob?.(`${year}-${pad2(month)}-${pad2(day)}`);
    go('disclosure');
  };

  return (
    <Screen>
      <StepBar onBack={onBack} phase="about" step={1} />
      <ScrollView style={styles.grow} contentContainerStyle={styles.stepScroll} alwaysBounceVertical={false} showsVerticalScrollIndicator={false}>
        <StepHeader
          eyebrow="About you"
          title="When were you born?"
          body="We use this to keep everyone safe. Your birthday stays private."
        />

        <View style={styles.dobBody}>
          <View style={styles.wheels}>
            <View style={styles.wheelHeads} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {order.map(k => (
                <Txt key={k} variant="eyebrow" style={[styles.wheelHead, { flex: WHEEL_FLEX[k] }]}>{WHEEL_HEAD[k]}</Txt>
              ))}
            </View>
            <View style={styles.wheelRowGroup}>{order.map(k => wheels[k])}</View>
          </View>

          <View style={styles.dobStatus}>
            {future ? (
              <InlineNotice tone="warning" text="That date hasn't happened yet." />
            ) : tooYoung ? (
              <InlineNotice tone="warning" text={`You need to be ${MIN_AGE} or older to use Evarna.`} />
            ) : complete ? (
              <View style={styles.readout}>
                <Txt variant="subhead" weight={500} style={{ color: W.text }}>{readout}</Txt>
              </View>
            ) : (
              <Txt variant="footnote" style={styles.dobHint}>Choose your month, day and year.</Txt>
            )}
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <PrimaryButton trailingArrow disabled={!valid} onPress={handleContinue}>Continue</PrimaryButton>
        {onSignOut ? (
          <Pressable
            onPress={onSignOut}
            accessibilityRole="button"
            accessibilityLabel="Wrong account? Sign out"
            accessibilityHint="Signs you out so you can use a different account"
            style={({ pressed }) => [styles.textLink, pressed ? styles.pressed : null]}
          >
            <Txt variant="subhead" style={{ color: W.text2 }}>
              Wrong account? <Txt variant="subhead" weight={600} style={{ color: W.primarySoft }}>Sign out</Txt>
            </Txt>
          </Pressable>
        ) : null}
      </View>
    </Screen>
  );
}

// ─── S03 DISCLOSURE ──────────────────────────────────────────────────────
const CRISIS_ICON: Record<CrisisResource['kind'], IconName> = { call: 'phone', text: 'chat', web: 'globe' };
const CRISIS_HINT: Record<CrisisResource['kind'], string> = {
  call: 'Opens your phone app',
  text: 'Opens Messages',
  web: 'Opens in your browser',
};
const CRISIS_FAILED: Record<CrisisResource['kind'], string> = {
  call: "This device couldn't start the call. The number is above.",
  text: "This device couldn't open Messages. The number is above.",
  web: "Couldn't open the link on this device.",
};

function CrisisLine({ resource }: { resource: CrisisResource }) {
  const [failed, setFailed] = useState(false);
  const detail = resource.hours ? `${resource.detail} · ${resource.hours}` : resource.detail;
  const openable = canOpenCrisisResource(resource);

  const open = async () => {
    haptic.light();
    const ok = await openCrisisResource(resource);
    setFailed(!ok);
    if (!ok) announce(CRISIS_FAILED[resource.kind]);
  };

  const body = (
    <>
      <View style={styles.crisisIcon}>
        <NavIcon name={CRISIS_ICON[resource.kind]} color={W.primarySoft} size={16} />
      </View>
      <View style={styles.flexText}>
        <Txt variant="subhead" weight={600} style={{ color: W.cream }}>{resource.name}</Txt>
        <Txt variant="footnote" style={{ marginTop: SP.xxs, color: W.text2 }}>{detail}</Txt>
        {failed ? <Txt variant="footnote" style={{ marginTop: SP.xs, color: W.dangerText }}>{CRISIS_FAILED[resource.kind]}</Txt> : null}
      </View>
    </>
  );

  // "Call your local emergency number" has nothing to dial: plain text, no chevron.
  if (!openable) {
    return <View accessible accessibilityLabel={`${resource.name}. ${detail}`} style={styles.crisisRow}>{body}</View>;
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`${resource.name}. ${detail}`}
      accessibilityHint={CRISIS_HINT[resource.kind]}
      style={({ pressed }) => [styles.crisisRow, pressed ? styles.crisisRowPressed : null]}
    >
      {body}
      <NavIcon name={resource.kind === 'web' ? 'external' : 'right'} color={W.text3} size={16} />
    </Pressable>
  );
}

function InfoCard({ icon, tint, title, body }: { icon: IconName; tint: string; title: string; body: string }) {
  return (
    <Card padding={SP.base2} accessibilityLabel={`${title}. ${body}`}>
      <View style={styles.infoRow}>
        <View style={[styles.infoIcon, { backgroundColor: rgba(tint, 0.15) }]}>
          <NavIcon name={icon} color={tint} size={14} />
        </View>
        <View style={styles.flexText}>
          <Txt variant="headline" style={{ color: W.cream }}>{title}</Txt>
          <Txt variant="subhead" style={{ marginTop: SP.xs, color: W.text2 }}>{body}</Txt>
        </View>
      </View>
    </Card>
  );
}

export function S03_Disclosure({ go }: { go: Go }) {
  // Numbers for where the phone is (India first); a helpline directory and
  // "your local emergency number" wherever that can't be placed.
  const [crisis] = useState(() => crisisResources());
  const lines = [crisis.resources[0], crisis.emergency].filter((r): r is CrisisResource => !!r);

  return (
    <Screen>
      <StepBar onBack={() => go('age')} phase="about" step={2} />
      <ScrollView style={styles.grow} contentContainerStyle={styles.stepScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.shieldTile} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <NavIcon name="shield" color={W.primary} size={32} />
        </View>
        <StepHeader eyebrow="Before we begin" title="A few things to know first." />

        <View style={styles.infoCards}>
          <InfoCard
            icon="sparkle" tint={W.primary} title="This is AI"
            body="Everything is AI-generated. You're talking with artificial intelligence, not a human. Companion chatbots may not be suitable for some minors."
          />
          <InfoCard
            icon="heart" tint={W.rose} title="Not a replacement"
            body="Your companion can make mistakes. They're not a therapist, doctor or counselor."
          />
          <Card padding={SP.base2} border={rgba(W.primary, 0.28)}>
            <View style={styles.infoRow}>
              <View style={[styles.infoIcon, { backgroundColor: rgba(W.primary, 0.18) }]}>
                <NavIcon name="phone" color={W.primary} size={14} />
              </View>
              <View style={styles.flexText}>
                <Txt variant="headline" heading style={{ color: W.cream }}>If you're in crisis</Txt>
                <Txt variant="subhead" style={{ marginTop: SP.xs, color: W.text2 }}>
                  You don't have to face it alone. These people can help right now.
                </Txt>
              </View>
            </View>
            <View style={styles.crisisLines}>
              {lines.map(r => <CrisisLine key={r.id} resource={r} />)}
            </View>
          </Card>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton trailingArrow onPress={() => go('pronouns')}>I understand</PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S05 PRONOUNS ────────────────────────────────────────────────────────
// Collects the user's name AND pronouns. The name is required: it becomes
// User.display_name and is what the companion actually calls the user in every
// prompt. Onboarding previously never asked, so the backend received a hardcoded
// config constant and every user in the database was named "Aria".
const PRONOUNS = ['He / Him', 'She / Her', 'They / Them'] as const;
const PRONOUN_GENDER: Record<string, string> = {
  'He / Him': 'male',
  'She / Her': 'female',
  'They / Them': 'non-binary',
};

export function S05_Pronouns({ go, onGender, onName, initialName }: {
  go: Go;
  onGender?: (g: string) => void;
  onName?: (n: string) => void;
  /** The name already given, e.g. when coming back from the next step. */
  initialName?: string;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState(initialName ?? '');
  const nameRef = useRef<TextInput>(null);
  const trimmed = name.trim();
  const { advance, manual } = useAutoAdvance(go);

  const commit = (pronoun: string) => {
    onName?.(trimmed);
    onGender?.(PRONOUN_GENDER[pronoun] ?? 'non-binary');
  };

  const pick = (pronoun: string) => {
    // No name, no moving on: the companion needs something real to call them.
    if (!trimmed) {
      nameRef.current?.focus();
      return;
    }
    Keyboard.dismiss();
    setPicked(pronoun);
    commit(pronoun);
    advance('comm');
  };

  return (
    <Screen>
      <StepBar onBack={() => go('disclosure')} phase="about" step={3} />
      <ScrollView
        style={styles.grow}
        contentContainerStyle={styles.stepScroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <StepHeader eyebrow="About you" title="What should your companion call you?" />

        <TextInput
          ref={nameRef}
          value={name}
          onChangeText={setName}
          placeholder="Your first name"
          placeholderTextColor={W.placeholder}
          accessibilityLabel="Your first name"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="given-name"
          textContentType="givenName"
          maxLength={50}
          returnKeyType="done"
          maxFontSizeMultiplier={INPUT_MAX_SCALE}
          selectionColor={W.primary}
          style={[styles.input, trimmed ? styles.inputFilled : null]}
        />

        <Txt variant="headline" style={styles.question}>And how should they refer to you?</Txt>
        <ChoiceGroup
          label="Pronouns"
          options={PRONOUNS}
          picked={picked}
          onPick={pick}
          dimmed={!trimmed}
          hint={trimmed ? undefined : 'Enter your name first'}
        />
        <Txt variant="subhead" style={styles.helper}>
          {trimmed ? 'This helps your companion talk naturally with you.' : 'Enter your name to continue.'}
        </Txt>
      </ScrollView>
      {manual ? (
        <View style={styles.footer}>
          <PrimaryButton
            disabled={!picked || !trimmed}
            onPress={() => { if (picked && trimmed) { commit(picked); go('comm'); } }}
          >
            Continue
          </PrimaryButton>
        </View>
      ) : null}
    </Screen>
  );
}

const COMM_STYLES = ['Warm & gentle', 'Direct & honest', 'Funny & light', 'Calm & slow'] as const;
const COMM_STYLE_MAP: Record<string, string> = {
  'Warm & gentle': 'warm',
  'Direct & honest': 'direct',
  'Funny & light': 'funny',
  'Calm & slow': 'calm',
};

// ─── S06 COMM STYLE ──────────────────────────────────────────────────────
export function S06_Comm({ go, onCommStyle }: { go: Go; onCommStyle?: (s: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const { advance, manual } = useAutoAdvance(go);

  const pick = (option: string) => {
    setPicked(option);
    onCommStyle?.(COMM_STYLE_MAP[option] ?? 'warm');
    advance('handoff');
  };

  return (
    <Screen>
      <StepBar onBack={() => go('pronouns')} phase="about" step={4} />
      <ScrollView style={styles.grow} contentContainerStyle={styles.stepScroll} showsVerticalScrollIndicator={false}>
        <StepHeader eyebrow="About you" title="How do you like conversations?" />
        <ChoiceGroup label="Conversation style" options={COMM_STYLES} picked={picked} onPick={pick} />
      </ScrollView>
      {manual ? (
        <View style={styles.footer}>
          <PrimaryButton disabled={!picked} onPress={() => go('handoff')}>Continue</PrimaryButton>
        </View>
      ) : null}
    </Screen>
  );
}

// ─── HANDOFF ─────────────────────────────────────────────────────────────
// The seam between the two phases: "About you" is done, "Your companion" is next.
const COMING_UP: { label: string; desc: string; icon: IconName; color: string }[] = [
  { label: 'Presence', desc: 'Mentor, friend, partner or challenger', icon: 'compass', color: W.primary },
  { label: 'Voice', desc: 'How they sound when they speak', icon: 'speaker', color: W.rose },
  { label: 'Name', desc: "What you'll call them", icon: 'sparkle', color: W.secondary },
];

export function S_Handoff({ go }: { go: Go }) {
  // Stays mounted under archetype, voice and name; still while they cover it.
  const inView = useInView();
  const pulse = useBreath(2500, { rest: 1, paused: !inView });
  const nextDot = useAnimatedStyle(() => ({ opacity: 0.6 + pulse.value * 0.4, transform: [{ scale: 0.85 + pulse.value * 0.25 }] }));

  return (
    <Screen ambientIntensity={1.4} ambientPulse={inView}>
      <TopBar left={<BackButton onPress={() => go('comm')} />} />
      <ScrollView style={styles.grow} contentContainerStyle={styles.handoffScroll} showsVerticalScrollIndicator={false}>
        <View
          accessible
          accessibilityLabel="About you: done. Your companion: up next."
          style={styles.phases}
        >
          <View style={styles.phase}>
            <View style={styles.phaseDone}>
              <NavIcon name="check" color={W.onAccent} size={9} />
            </View>
            <Txt variant="eyebrow" style={{ color: W.text2 }}>About you</Txt>
            <Txt variant="caption" style={{ color: W.text3 }}>Done</Txt>
          </View>
          <Svg width={40} height={8} viewBox="0 0 40 8">
            <Line x1={2} y1={4} x2={38} y2={4} stroke={W.text3} strokeWidth={1} strokeDasharray="2 3" />
          </Svg>
          <View style={styles.phase}>
            <Animated.View style={[styles.phaseNext, nextDot]} />
            <Txt variant="eyebrow" style={{ color: W.primarySoft }}>Your companion</Txt>
            <Txt variant="caption" style={{ color: W.text3 }}>Up next</Txt>
          </View>
        </View>

        <Reveal>
          <Txt variant="title1" heading style={[styles.title, styles.centerText]}>
            Now let's build{'\n'}your companion.
          </Txt>
        </Reveal>
        <Reveal delay={80}>
          <Txt variant="callout" style={[styles.lede, styles.centerText]}>
            Three choices: what they're like, how they sound, and what to call them.
          </Txt>
        </Reveal>

        <View style={styles.comingUp}>
          {COMING_UP.map((s, i) => (
            <Reveal key={s.label} delay={160 + i * 70}>
              <Card padding={SP.base} accessibilityLabel={`Step ${i + 1}: ${s.label}. ${s.desc}`}>
                <View style={styles.comingRow}>
                  <Txt variant="title2" maxScale={1.2} style={styles.comingNum}>{pad2(i + 1)}</Txt>
                  <View style={[styles.comingIcon, { backgroundColor: rgba(s.color, 0.12), borderColor: rgba(s.color, 0.25) }]}>
                    <NavIcon name={s.icon} color={s.color} size={18} />
                  </View>
                  <View style={styles.flexText}>
                    <Txt variant="headline" style={{ color: W.cream }}>{s.label}</Txt>
                    <Txt variant="footnote" style={{ marginTop: SP.xxs, color: W.text2 }}>{s.desc}</Txt>
                  </View>
                </View>
              </Card>
            </Reveal>
          ))}
        </View>
      </ScrollView>

      <Reveal delay={400} style={styles.footer}>
        <PrimaryButton trailingArrow onPress={() => go('archetype')}>Continue</PrimaryButton>
      </Reveal>
    </Screen>
  );
}

// ─── S04 ARCHETYPE ───────────────────────────────────────────────────────
// `backTo` lets the "add companion" flow route back to home rather than the
// onboarding handoff. Defaults preserve the original first-run behavior.
const ARCHETYPES: { id: Archetype; icon: IconName; title: string; sub: string }[] = [
  { id: 'friend', icon: 'two', title: 'Friend', sub: "A presence who's always there" },
  { id: 'mentor', icon: 'compass', title: 'Mentor', sub: 'Help thinking things through' },
  { id: 'partner', icon: 'heart', title: 'Partner', sub: 'Connection and affection' },
  { id: 'challenger', icon: 'target', title: 'Challenger', sub: 'Someone to keep you honest' },
];

function ArchetypeOption({ option, selected, onPress }: {
  option: (typeof ARCHETYPES)[number]; selected: boolean; onPress: () => void;
}) {
  // Inside a scroll view: the haptic goes on the pick, not on touch-down.
  const press = usePressFeedback({ scale: MOTION.press.scaleSubtle, haptic: false });
  const accent = ARCHETYPE_COLORS[option.id] ?? W.primary;
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={`${option.title}. ${option.sub}`}
        style={[
          styles.optionCard,
          selected ? { borderColor: rgba(accent, 0.45), backgroundColor: rgba(accent, 0.08) } : null,
        ]}
      >
        <GlassFill intensity={36} />
        <View pointerEvents="none" style={[styles.optionStripe, { backgroundColor: accent, opacity: selected ? 1 : 0.5 }]} />
        <View style={[styles.optionIcon, { backgroundColor: rgba(accent, 0.12), borderColor: rgba(accent, 0.25) }]}>
          <NavIcon name={option.icon} color={accent} size={22} />
        </View>
        <View style={styles.flexText}>
          <Txt variant="headline" style={{ color: W.cream }}>{option.title}</Txt>
          <Txt variant="subhead" style={{ marginTop: SP.xxs, color: W.text2 }}>{option.sub}</Txt>
        </View>
        <NavIcon name={selected ? 'check' : 'right'} color={selected ? accent : W.textMuted} size={18} />
      </Pressable>
    </Animated.View>
  );
}

export function S04_Archetype({ go, onPick, backTo = 'handoff' }: { go: Go; onPick: (a: Archetype) => void; backTo?: ScreenName }) {
  const [picked, setPicked] = useState<Archetype | null>(null);
  const { advance, manual } = useAutoAdvance(go);

  const pick = (id: Archetype) => {
    if (id !== picked) haptic.selection();
    setPicked(id);
    onPick(id);
    advance('voice');
  };

  return (
    <Screen>
      <StepBar onBack={() => go(backTo)} phase="companion" step={1} />
      <ScrollView style={styles.grow} contentContainerStyle={styles.stepScroll} showsVerticalScrollIndicator={false}>
        <StepHeader eyebrow="Your companion" title="What kind of presence?" body="Pick one. You can add more companions later." />
        <View accessibilityRole="radiogroup" accessibilityLabel="Kind of companion" style={styles.options}>
          {ARCHETYPES.map(c => (
            <ArchetypeOption key={c.id} option={c} selected={picked === c.id} onPress={() => pick(c.id)} />
          ))}
        </View>
      </ScrollView>
      {manual ? (
        <View style={styles.footer}>
          <PrimaryButton disabled={!picked} onPress={() => go('voice')}>Continue</PrimaryButton>
        </View>
      ) : null}
    </Screen>
  );
}

// ─── S07 VOICE ───────────────────────────────────────────────────────────
// Voices come from GET /voice/voices and nowhere else. There used to be a
// static fallback list (Atlas, Luna, Onyx…) whose "ids" were display names the
// backend has never heard of, so picking one produced a companion the API
// rejected — or worse, a voice_id that silently did not resolve.
//
// Tapping a card chooses it and plays its bundled sample (tap again to stop);
// the card's waveform moves only while that sample is actually playing.
type VoicesStatus = 'loading' | 'ready' | 'error';
const GENDERS = [{ key: 'female', label: 'Female' }, { key: 'male', label: 'Male' }] as const;
type Gender = (typeof GENDERS)[number]['key'];
const GRID_GAP = SP.sm2;
const VOICE_CARD_H = 124;

function VoiceCard({ voice, width, selected, playing, onPress }: {
  voice: ApiVoice; width: number; selected: boolean; playing: boolean; onPress: () => void;
}) {
  const press = usePressFeedback({ haptic: false });
  const canPreview = hasVoicePreview(voice.id);
  const personality = voice.personality ?? '';
  // "Warm and gentle — a close friend…": the card has room for the first part.
  const short = personality.split(/\s+—\s+/)[0];

  return (
    <Animated.View style={[{ width }, press.animatedStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="radio"
        accessibilityState={{ selected }}
        accessibilityLabel={personality ? `${voice.name}. ${personality}` : voice.name}
        accessibilityHint={canPreview ? (playing ? 'Stops the sample' : 'Plays a sample') : undefined}
        style={[styles.voiceCard, selected ? styles.voiceCardOn : null]}
      >
        <Waveform color={playing ? W.primary : selected ? W.primarySoft : W.text3} animate={playing} size={32} />
        <Txt variant="callout" weight={600} numberOfLines={1} style={{ color: W.text }}>{voice.name}</Txt>
        {short ? <Txt variant="caption" numberOfLines={2} style={styles.voiceDesc}>{short}</Txt> : null}
        {selected ? (
          <View style={styles.voiceCheck}>
            <NavIcon name="check" color={W.onAccent} size={11} />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export function S07_Voice({ go, onPickVoice, apiVoices, voicesStatus, onRetryVoices }: {
  go: Go;
  onPickVoice: (v: string) => void;
  apiVoices?: ApiVoice[];
  /** Without it, an empty list reads as still loading. */
  voicesStatus?: VoicesStatus;
  onRetryVoices?: () => void;
}) {
  const { width, fontScale } = useWindowDimensions();
  const voices = apiVoices ?? [];
  const status: VoicesStatus = voicesStatus ?? (voices.length ? 'ready' : 'loading');
  const [gender, setGender] = useState<Gender>('female');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const preview = useVoicePreview();

  // Arriving at a failed or empty catalogue is itself a reason to ask again;
  // after that, retries wait for the user.
  useEffect(() => {
    if (status === 'error' || (status === 'ready' && voices.length === 0)) onRetryVoices?.();
  }, []);

  const chosen = voices.find(v => v.id === voiceId) ?? null;
  const shown = voices.filter(v => v.gender === gender);
  const other = GENDERS.find(g => g.key !== gender) ?? GENDERS[0];
  const current = GENDERS.find(g => g.key === gender) ?? GENDERS[0];
  const cols = width < 360 || fontScale > 1.3 ? 2 : 3;
  const cardW = Math.floor((width - SP.xl * 2 - GRID_GAP * (cols - 1)) / cols);
  const allPreview = shown.length > 0 && shown.every(v => hasVoicePreview(v.id));

  const switchGender = (g: Gender) => {
    if (g === gender) return;
    preview.stop();
    setGender(g);
  };

  const choose = (v: ApiVoice) => {
    if (v.id !== voiceId) haptic.selection();
    setVoiceId(v.id);
    if (!hasVoicePreview(v.id)) return;
    if (preview.playingId === v.id) preview.stop();
    else preview.play(v.id);
  };

  const next = () => {
    if (!chosen) return;
    preview.stop();
    onPickVoice(chosen.id);
    go('name');
  };

  let body: React.ReactNode;
  if (status === 'loading') {
    body = (
      <View accessible accessibilityLabel="Loading voices" accessibilityState={{ busy: true }} style={styles.voiceGrid}>
        {Array.from({ length: cols * 2 }, (_, i) => (
          <Skeleton key={i} width={cardW} height={VOICE_CARD_H} radius={R.lg} />
        ))}
      </View>
    );
  } else if (status === 'error') {
    body = (
      <ErrorState
        title="Couldn't load voices"
        body="Check your connection and try again."
        onRetry={onRetryVoices}
      />
    );
  } else if (voices.length === 0) {
    body = (
      <EmptyState
        icon="speaker"
        title="No voices yet"
        body="Voices aren't available right now. Please try again in a little while."
        actionLabel={onRetryVoices ? 'Try again' : undefined}
        onAction={onRetryVoices}
      />
    );
  } else if (shown.length === 0) {
    body = (
      <EmptyState
        icon="speaker"
        title={`No ${current.label.toLowerCase()} voices yet`}
        body={`The ${other.label.toLowerCase()} voices are ready to hear.`}
        actionLabel={`Show ${other.label.toLowerCase()} voices`}
        onAction={() => switchGender(other.key)}
      />
    );
  } else {
    body = (
      <Reveal key={gender} rise={false}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Voices" style={styles.voiceGrid}>
          {shown.map(v => (
            <VoiceCard
              key={v.id}
              voice={v}
              width={cardW}
              selected={voiceId === v.id}
              playing={preview.playingId === v.id}
              onPress={() => choose(v)}
            />
          ))}
        </View>
      </Reveal>
    );
  }

  return (
    <Screen>
      <StepBar onBack={() => go('archetype')} phase="companion" step={2} />
      <View style={styles.voiceHead}>
        <StepHeader
          eyebrow="Your companion"
          title="How should they sound?"
          body={allPreview ? 'Tap a voice to hear it.' : 'Pick how they sound.'}
        />
        <View accessibilityRole="radiogroup" accessibilityLabel="Voice type" style={styles.genderTabs}>
          {GENDERS.map(g => (
            <Pill key={g.key} size="sm" selected={gender === g.key} onPress={() => switchGender(g.key)} style={styles.grow}>
              {`${g.label} voices`}
            </Pill>
          ))}
        </View>
      </View>
      <ScrollView style={styles.grow} contentContainerStyle={styles.voiceScroll} showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton disabled={!chosen} onPress={next}>
          {chosen ? `Continue with ${chosen.name}` : 'Continue'}
        </PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S08 NAME ────────────────────────────────────────────────────────────
// Creating the account (or, when adding one, the companion) happens here and
// is awaited: Meet only opens once it exists. The router may itself move on
// (under 15 → age, already set up → home) and resolve { ok: false } with no
// message; every real failure carries one.
export type PickNameResult = { ok: true } | { ok: false; message?: string };

export function S08_Name({ go, archetype, onPickName }: {
  go: Go;
  archetype: Archetype;
  onPickName: (name: string) => Promise<PickNameResult>;
}) {
  const suggestions = NAME_SUGGESTIONS[archetype] ?? NAME_SUGGESTIONS.mentor;
  const [name, setName] = useState(suggestions[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Nothing leaves while the account or companion is being made: going back
  // mid-request would strand one that exists, and asking again would make a
  // second. The router blocks Android back and its own swipe for the length
  // of the request; this holds the swipe from the screen's side too.
  useBlockSwipeBack(busy);

  const rename = (next: string) => {
    setName(next);
    if (error) setError(null);
  };

  const submit = async () => {
    if (!trimmed || busy) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    let result: PickNameResult;
    try {
      result = await onPickName(trimmed);
    } catch {
      result = { ok: false, message: `Couldn't create ${trimmed}. Check your connection and try again.` };
    }
    if (!mounted.current) return;
    if (result.ok) {
      haptic.success();
      go('meet');
      return;
    }
    setBusy(false);
    // No message: the router has already moved the user on (back to the
    // birthday, or Home for an account that's already set up) and said why
    // itself. Nothing failed here, so no error haptic or notice as this leaves.
    if (!result.message) return;
    haptic.error();
    setError(result.message);
  };

  return (
    <Screen>
      <StepBar onBack={() => { if (!busy) go('voice'); }} backDisabled={busy} phase="companion" step={3} />
      <ScrollView
        style={styles.grow}
        contentContainerStyle={styles.stepScroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <StepHeader eyebrow="Your companion" title="Give them a name." body="Pick one below or write your own." />
        <TextInput
          value={name}
          onChangeText={rename}
          editable={!busy}
          placeholder="Their name"
          placeholderTextColor={W.placeholder}
          accessibilityLabel="Companion name"
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          maxLength={30}
          returnKeyType="go"
          enablesReturnKeyAutomatically
          onSubmitEditing={submit}
          maxFontSizeMultiplier={1.4}
          selectionColor={W.primary}
          style={styles.nameInput}
        />
        <View accessibilityRole="radiogroup" accessibilityLabel="Suggested names" style={styles.suggestions}>
          {suggestions.map(s => (
            <Pill key={s} size="sm" selected={name === s} disabled={busy} onPress={() => rename(s)}>{s}</Pill>
          ))}
        </View>
        <Txt variant="footnote" style={[styles.helper, styles.centerText]}>You can always change this later.</Txt>
      </ScrollView>
      <View style={styles.footer}>
        {error ? <InlineNotice tone="error" text={error} style={styles.footerNotice} /> : null}
        <PrimaryButton
          disabled={!trimmed}
          loading={busy}
          onPress={submit}
          accessibilityLabel={busy ? `Creating ${trimmed}` : trimmed ? `Meet ${trimmed}` : undefined}
        >
          {trimmed ? `Meet ${trimmed}` : 'Meet them'}
        </PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── MEET ─────────────────────────────────────────────────────────────────
// The orb lands, the companion's name appears and they say hello — in the
// chosen voice when there is a clip for it, and the caption is exactly what
// that clip says. Without a voice (or without the clip) it is silent.
const ARRIVE_MS = 1200;       // the orb settles before anyone speaks
const SILENT_SPEAK_MS = 2600; // no clip: how long the greeting holds before the CTA
const CLIP_CAP_MS = 6000;     // a clip that never reports its end still moves on
const WORD_STAGGER = 180;
const GREETING_WORDS = GREETING_TEXT.split(' ');
const ORB_SIZE = 180;
const ORB_BOX = 2;            // the orb's layout box, as a multiple of its size

function MeetWord({ word, delay }: { word: string; delay: number }) {
  const [entering] = useState(() => enter.fade.delay(delay));
  return (
    <Animated.View entering={entering}>
      <Txt variant="headline" weight={500} style={{ color: W.text }}>{word}</Txt>
    </Animated.View>
  );
}

export function S_Meet({ go, companion, accent = W.primary, voiceId }: {
  go: Go;
  companion: { name: string; archetype: Archetype };
  accent?: string;
  /** The chosen voice; its greeting clip plays as the orb speaks. */
  voiceId?: string;
}) {
  const reduced = useReducedMotion();
  // Stays mounted under the notification ask and the first chat; its orb and
  // ambient loops stop while those cover it.
  const inView = useInView();
  const { playingId, play } = useVoicePreview();
  const speaks = !!voiceId && hasVoicePreview(voiceId, 'greeting');
  const [step, setStep] = useState<'arriving' | 'speaking' | 'ready'>('arriving');
  const heard = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setStep('speaking'), ARRIVE_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (step === 'ready') {
      // "Say hi" is the only way on, and it appears by itself once the
      // greeting is over: tell VoiceOver it's there.
      announce('Say hi, button');
      return;
    }
    if (step !== 'speaking') return;
    if (speaks && voiceId) {
      // Nobody tapped for this, so it follows the silent switch: a phone on
      // silent shows the captioned greeting without saying it out loud.
      play(voiceId, 'greeting', 'auto');
      const cap = setTimeout(() => setStep('ready'), CLIP_CAP_MS);
      return () => clearTimeout(cap);
    }
    // Silent: VoiceOver users get the greeting spoken instead.
    announce(`${companion.name}: ${GREETING_TEXT}`);
    const t = setTimeout(() => setStep('ready'), SILENT_SPEAK_MS);
    return () => clearTimeout(t);
  }, [step]);

  // With a clip, the greeting is over when the clip is (or when it fails).
  useEffect(() => {
    if (!speaks || step !== 'speaking') return;
    if (playingId === voiceId) heard.current = true;
    else if (heard.current) setStep('ready');
  }, [playingId, step, speaks, voiceId]);

  const arrive = useSharedValue(0);
  useEffect(() => {
    // Under Reduce Motion the orb fades in where it is, without the grow.
    arrive.value = withTiming(1, reduced ? { ...timing(D.slow), reduceMotion: ReduceMotion.Never } : timing(1200, 'decel'));
  }, []);
  const orbIn = useAnimatedStyle(() => ({
    opacity: arrive.value,
    transform: [{ scale: reduced ? 1 : interpolate(arrive.value, [0, 0.6, 1], [0.2, 1, 1]) }],
  }));

  const showCompanion = step !== 'arriving';

  return (
    <Screen ambientIntensity={2.4} ambientPulse={inView} ambientDrift={inView}>
      <View style={styles.meetStage}>
        <Animated.View style={orbIn} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {inView ? (
            <Orb state={step === 'speaking' ? 'speaking' : 'idle'} size={ORB_SIZE} box={ORB_BOX} accent={accent} />
          ) : (
            // Covered: the orb and its loops go; the space it held stays.
            <View style={styles.orbSpace} />
          )}
        </Animated.View>
        <View style={styles.meetText}>
          {showCompanion ? (
            <>
              <Reveal style={styles.meetName}>
                <View style={[styles.meetDot, { backgroundColor: accent }]} />
                <Txt variant="title1" heading numberOfLines={1} style={styles.meetNameText}>{companion.name}</Txt>
              </Reveal>
              <View accessible accessibilityLabel={GREETING_TEXT} style={styles.greeting}>
                {GREETING_WORDS.map((w, i) => (
                  <MeetWord key={i} word={w} delay={reduced ? 0 : i * WORD_STAGGER} />
                ))}
              </View>
            </>
          ) : null}
        </View>
      </View>
      <View style={styles.meetFooter}>
        {step === 'ready' ? (
          <Reveal>
            <PrimaryButton onPress={() => go('first-chat')}>Say hi</PrimaryButton>
          </Reveal>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  flexText: { flex: 1, minWidth: 0 },
  centerText: { textAlign: 'center' },
  dimmed: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  centered: { ...FILL, alignItems: 'center', justifyContent: 'center' },

  // Step chrome
  eyebrow: { color: W.text2 },
  title: { marginTop: SP.sm2, color: W.cream },
  lede: { marginTop: SP.sm2, color: W.text2, maxWidth: 360 },
  stepScroll: { flexGrow: 1, paddingHorizontal: SP.xl, paddingTop: SP.md, paddingBottom: SP.xl },
  footer: { paddingHorizontal: SP.xl, paddingTop: SP.md, paddingBottom: SP.xl },
  footerNotice: { marginBottom: SP.md },
  question: { marginTop: SP.xxl, color: W.text },
  helper: { marginTop: SP.base, color: W.text2 },
  choices: { marginTop: SP.md2, gap: SP.sm2 },
  textLink: { minHeight: HIT, marginTop: SP.xs, alignItems: 'center', justifyContent: 'center' },
  // BackButton's own offset, which lines the glyph up with the gutter.
  backInert: { marginLeft: -10 },

  // Inputs: one fill and radius across onboarding.
  input: {
    marginTop: SP.xl, minHeight: 52, paddingHorizontal: SP.base, paddingVertical: SP.md,
    backgroundColor: W.surface3, color: W.text, borderRadius: R.md, borderWidth: 1, borderColor: W.hairline,
    fontFamily: resolveFont('user', 400), fontSize: TYPE.bodyComp.size,
  },
  inputFilled: { borderColor: rgba(W.primary, 0.35) },
  nameInput: {
    marginTop: SP.xl, alignSelf: 'center', width: '100%', maxWidth: 320, minHeight: 64,
    paddingHorizontal: SP.base, paddingVertical: SP.md,
    backgroundColor: W.surface3, color: W.text, borderRadius: R.md, borderWidth: 1, borderColor: rgba(W.primary, 0.25),
    fontFamily: resolveFont('comp', 600), fontSize: TYPE.title2.size, textAlign: 'center',
  },
  suggestions: { marginTop: SP.lg, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: SP.sm },

  // S01
  brandRow: { paddingTop: SP.xl, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm },
  brandDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: W.coral },
  brandText: { color: W.text2, letterSpacing: 3 },
  splashCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  discRing: { position: 'absolute', borderWidth: 1, borderColor: rgba(W.primary, 0.18) },
  disc: {
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    backgroundColor: W.glass, borderWidth: 1, borderColor: W.hairlineStrong,
  },
  discHighlight: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: rgba(W.text, 0.05) },
  discDot: { marginTop: SP.sm2, width: 5, height: 5, borderRadius: 2.5, backgroundColor: W.coral },
  tagline: { fontSize: TYPE.title2.size, lineHeight: 30, letterSpacing: -0.3, color: W.cream, textAlign: 'center' },
  splashHint: { minHeight: HIT, justifyContent: 'center' },
  hintRow: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm2 },
  hintText: { color: W.text2, letterSpacing: 2.4 },
  cursor: { width: 2, height: 14, borderRadius: 1, backgroundColor: W.coral },

  // DateWheel
  wheel: {
    borderRadius: R.lg2, overflow: 'hidden',
    backgroundColor: W.glass, borderWidth: 1, borderColor: W.hairlineFaint,
  },
  wheelBand: {
    position: 'absolute', left: SP.xs2, right: SP.xs2, borderRadius: R.md,
    backgroundColor: rgba(W.primary, 0.12), borderTopWidth: 1, borderBottomWidth: 1, borderColor: rgba(W.primary, 0.22),
  },
  // Placed by index, so mounting and unmounting rows never moves the others.
  wheelRow: { position: 'absolute', left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },
  wheelFade: { position: 'absolute', left: 0, right: 0 },

  // S02
  dobBody: { flex: 1, justifyContent: 'center', paddingVertical: SP.xl },
  wheels: { width: '100%', maxWidth: 340, alignSelf: 'center' },
  wheelHeads: { flexDirection: 'row', gap: SP.sm2, marginBottom: SP.md },
  wheelHead: { color: W.text3, textAlign: 'center' },
  wheelRowGroup: { flexDirection: 'row', gap: SP.sm2 },
  // Children stretch so a notice gets the full width to wrap in.
  dobStatus: { marginTop: SP.xl, minHeight: HIT, justifyContent: 'center' },
  dobHint: { color: W.text3, textAlign: 'center' },
  readout: {
    alignSelf: 'center', paddingVertical: SP.sm2, paddingHorizontal: SP.base2, borderRadius: R.pill,
    borderWidth: 1, borderColor: rgba(W.primary, 0.22), backgroundColor: W.primaryDim,
  },

  // S03
  shieldTile: {
    width: 76, height: 76, borderRadius: R.xl2, marginTop: SP.base, marginBottom: SP.xl,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.primary, 0.12), borderWidth: 1, borderColor: rgba(W.primary, 0.28),
  },
  infoCards: { marginTop: SP.xl, gap: SP.md },
  infoRow: { flexDirection: 'row', gap: SP.md2, alignItems: 'flex-start' },
  infoIcon: { width: 28, height: 28, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  crisisLines: { marginTop: SP.md, gap: SP.sm },
  crisisRow: {
    minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: SP.md,
    paddingVertical: SP.sm2, paddingHorizontal: SP.md, borderRadius: R.md,
    backgroundColor: rgba(W.text, 0.04), borderWidth: 1, borderColor: W.hairline,
  },
  crisisRowPressed: { backgroundColor: rgba(W.primary, 0.12) },
  crisisIcon: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.primary, 0.12),
  },

  // Handoff
  handoffScroll: { paddingHorizontal: SP.xl, paddingTop: SP.sm, paddingBottom: SP.base },
  phases: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.md2, marginBottom: SP.xxl },
  phase: { alignItems: 'center', gap: SP.xs2 },
  phaseDone: { width: 14, height: 14, borderRadius: 7, backgroundColor: W.primary, alignItems: 'center', justifyContent: 'center' },
  phaseNext: { width: 12, height: 12, borderRadius: 6, backgroundColor: W.primary },
  comingUp: { marginTop: SP.xxl, gap: SP.md },
  comingRow: { flexDirection: 'row', alignItems: 'center', gap: SP.base },
  comingNum: { color: W.text3, minWidth: 36 },
  comingIcon: { width: 40, height: 40, borderRadius: R.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  // S04
  options: { marginTop: SP.xl, gap: SP.md },
  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: SP.base,
    paddingVertical: SP.base, paddingLeft: SP.base2, paddingRight: SP.base,
    borderRadius: R.card, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glass, overflow: 'hidden',
  },
  optionStripe: { position: 'absolute', left: 0, top: SP.md2, bottom: SP.md2, width: 2, borderRadius: 1 },
  optionIcon: { width: 48, height: 48, borderRadius: R.md2, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  // S07
  voiceHead: { paddingHorizontal: SP.xl, paddingTop: SP.md },
  genderTabs: { marginTop: SP.lg, flexDirection: 'row', gap: SP.sm },
  voiceScroll: { flexGrow: 1, paddingHorizontal: SP.xl, paddingTop: SP.lg, paddingBottom: SP.base },
  voiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  // The border is always 2pt so choosing a card doesn't nudge its contents.
  voiceCard: {
    minHeight: VOICE_CARD_H, paddingVertical: SP.md, paddingHorizontal: SP.sm2, borderRadius: R.lg,
    alignItems: 'center', justifyContent: 'center', gap: SP.xs2,
    backgroundColor: W.glass, borderWidth: 2, borderColor: W.hairline,
  },
  voiceCardOn: { backgroundColor: rgba(W.primary, 0.1), borderColor: W.primary },
  voiceDesc: { color: W.text2, textAlign: 'center' },
  voiceCheck: {
    position: 'absolute', top: SP.sm, right: SP.sm, width: 18, height: 18, borderRadius: 9,
    backgroundColor: W.primary, alignItems: 'center', justifyContent: 'center',
  },

  // Meet
  meetStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  orbSpace: { width: ORB_SIZE * ORB_BOX, height: ORB_SIZE * ORB_BOX },
  meetText: { alignItems: 'center', alignSelf: 'stretch', minHeight: 120 },
  meetName: { marginTop: -SP.lg, flexDirection: 'row', alignItems: 'center', gap: SP.sm2, maxWidth: '100%' },
  meetDot: { width: 8, height: 8, borderRadius: 4 },
  meetNameText: { flexShrink: 1, color: W.text },
  greeting: { marginTop: SP.base2, maxWidth: 300, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: SP.xs2 },
  meetFooter: { minHeight: 56 + SP.xl * 2, paddingHorizontal: SP.xl, paddingVertical: SP.xl, justifyContent: 'flex-end' },
});
