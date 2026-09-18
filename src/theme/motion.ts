// motion.ts — Reanimated motion primitives built on the MOTION tokens.
//
// Everything here runs on the UI thread and follows the live Reduce Motion
// setting. Reanimated's own ReduceMotion.System is read once at launch, so a
// switch flipped mid-session would be ignored; the configs below carry an
// explicit mode that tracks the system setting instead.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, type AppStateStatus, type GestureResponderEvent } from 'react-native';
import {
  cancelAnimation,
  Easing,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  Keyframe,
  LinearTransition,
  makeMutable,
  ReduceMotion,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useReducedMotion as useReducedMotionAtLaunch,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type EasingFunction,
  type SharedValue,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { getRuntimeKind, RuntimeKind, scheduleOnUI } from 'react-native-worklets';

import { reduceMotionPref } from '../hooks/useAccessibilityPrefs';
import { haptic, type HapticKind } from '../lib/haptics';
import { useSceneFocused } from '../navigation/sceneContext';
import { MOTION } from './theme';

type Curve = keyof typeof MOTION.easing;
type SpringKind = keyof typeof MOTION.spring;
const D = MOTION.duration;

export const ease: Record<Curve, EasingFunction> = {
  standard: Easing.bezierFn(...MOTION.easing.standard),
  decel: Easing.bezierFn(...MOTION.easing.decel),
  accel: Easing.bezierFn(...MOTION.easing.accel),
  emphasized: Easing.bezierFn(...MOTION.easing.emphasized),
};

// ── Live Reduce Motion ─────────────────────────────────────────────────
// Until the platform answers, fall back to Reanimated's launch-time reading.
const modeFor = (reduced: boolean | null): ReduceMotion =>
  reduced === null ? ReduceMotion.System : reduced ? ReduceMotion.Always : ReduceMotion.Never;

const uiMode = makeMutable<ReduceMotion>(ReduceMotion.System);

function motionMode(): ReduceMotion {
  'worklet';
  // Reading a shared value from the JS thread blocks on the UI thread, so the
  // JS side asks the store. (A worklet's captured variables are snapshots, so
  // a module-level `let` would never update here.)
  return getRuntimeKind() === RuntimeKind.ReactNative ? modeFor(reduceMotionPref.get()) : uiMode.value;
}

/** True when the system asks for reduced motion. Re-renders when it changes. */
export function useReducedMotion(): boolean {
  const atLaunch = useReducedMotionAtLaunch();
  // The snapshot is the answer itself, so the platform confirming what was
  // already assumed at launch re-renders nobody.
  return useSyncExternalStore(reduceMotionPref.subscribe, () => reduceMotionPref.get() ?? atLaunch);
}

/** withTiming config on the shared curves. Safe to call inside worklets. */
export function timing(ms: number, curve: Curve = 'standard'): WithTimingConfig {
  'worklet';
  return { duration: ms, easing: ease[curve], reduceMotion: motionMode() };
}

// Worklets capture (and, in dev, freeze) what they reference, so capture the
// spring table rather than all of MOTION.
const SPRINGS = MOTION.spring;

/** withSpring config from MOTION.spring. Safe to call inside worklets. */
export function spring(kind: SpringKind = 'snappy'): WithSpringConfig {
  'worklet';
  return { ...SPRINGS[kind], reduceMotion: motionMode() };
}

// ── Layout animations ──────────────────────────────────────────────────
// Getters hand out a fresh builder on every read: Reanimated's modifiers
// (.delay(), .duration()…) mutate the builder they're called on, so one
// shared instance would leak a caller's tweak into every other screen.
// With Reduce Motion on, arrivals and departures become short cross-fades.
const reducedNow = () => reduceMotionPref.get() === true;
const calmIn = () => FadeIn.duration(D.base).easing(ease.standard).reduceMotion(ReduceMotion.Never);
const calmOut = () => FadeOut.duration(D.fast).easing(ease.standard).reduceMotion(ReduceMotion.Never);

export const enter = {
  get fade() {
    return reducedNow() ? calmIn() : FadeIn.duration(D.base).easing(ease.decel).reduceMotion(motionMode());
  },
  /** Rises a few points into place. */
  get fadeUp() {
    return reducedNow() ? calmIn() : FadeInDown.duration(D.slow).easing(ease.decel)
      .withInitialValues({ transform: [{ translateY: 12 }] }).reduceMotion(motionMode());
  },
  /** Drops a few points into place. */
  get fadeDown() {
    return reducedNow() ? calmIn() : FadeInUp.duration(D.slow).easing(ease.decel)
      .withInitialValues({ transform: [{ translateY: -12 }] }).reduceMotion(motionMode());
  },
  get scaleIn() {
    return reducedNow() ? calmIn() : new Keyframe({
      from: { opacity: 0, transform: [{ scale: 0.94 }] },
      to: { opacity: 1, transform: [{ scale: 1 }], easing: ease.decel },
    }).duration(D.base).reduceMotion(motionMode());
  },
  /** Sheets: in from the bottom edge on a critically damped spring. */
  get slideUp() {
    const { damping, stiffness, mass } = MOTION.spring.gentle;
    return reducedNow() ? calmIn() : SlideInDown.springify().damping(damping).stiffness(stiffness).mass(mass)
      .reduceMotion(motionMode());
  },
};

export const exit = {
  get fade() {
    return reducedNow() ? calmOut() : FadeOut.duration(D.fast).easing(ease.accel).reduceMotion(motionMode());
  },
  get fadeDown() {
    return reducedNow() ? calmOut() : FadeOutDown.duration(D.fast).easing(ease.accel).reduceMotion(motionMode());
  },
  get scaleOut() {
    return reducedNow() ? calmOut() : new Keyframe({
      from: { opacity: 1, transform: [{ scale: 1 }] },
      to: { opacity: 0, transform: [{ scale: 0.96 }], easing: ease.accel },
    }).duration(D.fast).reduceMotion(motionMode());
  },
  get slideDown() {
    return reducedNow() ? calmOut() : SlideOutDown.duration(D.base).easing(ease.accel).reduceMotion(motionMode());
  },
};

/** List reflow. One shared instance so re-renders don't rebuild it — pass it
 *  as-is and don't chain modifiers onto it. Snaps under Reduce Motion. */
export const layout = LinearTransition.duration(D.base).easing(ease.standard).reduceMotion(ReduceMotion.System);

reduceMotionPref.subscribe(() => {
  const mode = modeFor(reduceMotionPref.get());
  uiMode.value = mode;
  layout.reduceMotion(mode);
});

// ── Hooks ──────────────────────────────────────────────────────────────
// Press feedback is a direct response to the user's finger, so it plays even
// under Reduce Motion (as iOS's own controls do); it is a 3% scale.
const PRESS_IN: WithSpringConfig = { ...MOTION.spring.snappy, reduceMotion: ReduceMotion.Never };
const PRESS_OUT: WithSpringConfig = { ...MOTION.spring.bouncy, reduceMotion: ReduceMotion.Never };

/**
 * Pass as `unstable_pressDelay` on a Pressable that sits in scrolling content.
 * A drag that starts on the control hands the touch to the scroll view within
 * this time, so the control never shrinks or ticks for it; a quick tap still
 * gets its press-in, on release.
 */
export const PRESS_DELAY = 80;

/**
 * True when Pressability ended the press because the finger lifted on the
 * control — a real press. It passes onPressOut the responder event that ended
 * the press: a "release", or a "terminate" when a scroll view or gesture took
 * the touch over (or a move, when the finger slid off). The name is read off
 * the event React hands every responder handler.
 */
export function isPressRelease(e: unknown): boolean {
  const config = (e as { dispatchConfig?: { registrationName?: string } } | null | undefined)?.dispatchConfig;
  return config?.registrationName === 'onResponderRelease';
}

/**
 * Press feedback: a scale on the UI thread, plus a haptic when the press
 * lands. The haptic plays on release (as iOS buttons do), never on
 * touch-down, so a scroll or pull-to-refresh that starts on the control
 * doesn't tick. Components that own their `onPress` can pass `haptic: false`
 * and play it there instead.
 */
export function usePressFeedback(opts?: { scale?: number; haptic?: HapticKind | false }) {
  const to = opts?.scale ?? MOTION.press.scale;
  const kind = opts?.haptic ?? 'light';
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const onPressIn = useCallback(() => {
    scale.value = withSpring(to, PRESS_IN);
  }, [scale, to]);

  const onPressOut = useCallback((e?: GestureResponderEvent) => {
    scale.value = withSpring(1, PRESS_OUT);
    if (kind && isPressRelease(e)) haptic[kind]();
  }, [scale, kind]);

  return { animatedStyle, onPressIn, onPressOut };
}

// ── App state ──────────────────────────────────────────────────────────
// One AppState listener for the whole app. Subscribers hear only a change of
// the answer (active or not), so active → inactive → background is one
// notification, not two.
const isActiveState = (s: AppStateStatus | null | undefined) => s !== 'background' && s !== 'inactive';
let appActive = isActiveState(AppState.currentState);
const appActiveListeners = new Set<() => void>();
try {
  AppState.addEventListener('change', next => {
    const active = isActiveState(next);
    if (active === appActive) return;
    appActive = active;
    appActiveListeners.forEach(notify => notify());
  });
} catch {
  // No AppState module (tests).
}

function subscribeAppActive(onChange: () => void) {
  appActiveListeners.add(onChange);
  return () => { appActiveListeners.delete(onChange); };
}

/** Whether the app is in front right now, without subscribing. */
export const isAppActive = (): boolean => appActive;

/** True while the app is active. Re-renders only when that flips. */
export function useAppActive(): boolean {
  return useSyncExternalStore(subscribeAppActive, isAppActive);
}

// ── Scene focus ────────────────────────────────────────────────────────
// How long a covered screen keeps its loops running. A push or tab switch
// takes D.slow (380ms); pausing only after it has finished means nothing on
// either screen changes, or re-renders, while the move is on screen.
const UNFOCUS_GRACE = 600;

const noSubscribe = () => () => {};
const alwaysActive = () => true;

/**
 * True while this screen is in front (useSceneFocused) and the app is
 * active. Stays true for a short grace after the screen is covered or its
 * tab hidden, and turns true again at once when it comes back. Ambient loops
 * run only while this is true.
 */
export function useSceneActive(): boolean {
  const focused = useSceneFocused();
  const [lingering, setLingering] = useState(focused);
  useEffect(() => {
    if (focused) {
      setLingering(true);
      return;
    }
    const id = setTimeout(() => setLingering(false), UNFOCUS_GRACE);
    return () => clearTimeout(id);
  }, [focused]);
  const inFront = focused || lingering;
  // Only a screen in front listens for the app going inactive, so covered
  // screens (already still) don't re-render when Control Center comes down.
  const appActive = useSyncExternalStore(
    inFront ? subscribeAppActive : noSubscribe,
    inFront ? isAppActive : alwaysActive,
  );
  return inFront && appActive;
}

const RISE = Easing.out(Easing.sin);
const SWING = Easing.inOut(Easing.sin);

/**
 * A 0→1→0 breathing value on the UI thread. Holds at `rest` when Reduce
 * Motion is on or `paused`, and freezes where it is once its screen has been
 * covered or its tab hidden for a moment, or the app goes inactive (see
 * useSceneActive), picking up from there as soon as it is back in front.
 */
export function useBreath(periodMs: number, opts?: { rest?: number; paused?: boolean }): SharedValue<number> {
  const rest = opts?.rest ?? 0;
  const paused = opts?.paused ?? false;
  const reduced = useReducedMotion();
  const focused = useSceneActive();
  const v = useSharedValue(rest);
  const running = focused && !paused && !reduced;
  // Where the value was last sent to rest, so returning to a screen whose
  // breath is paused doesn't replay a no-op ease (each of its frames would
  // still redraw the views that read it).
  const restedAt = useRef<number | null>(rest);

  useEffect(() => {
    if (running) {
      restedAt.current = null;
      const half = periodMs / 2;
      scheduleOnUI(() => {
        'worklet';
        // Rise from wherever the breath was left, then swing 1 → 0 → 1. The
        // explicit Never is safe: this only runs when motion is allowed.
        v.value = withSequence(
          ReduceMotion.Never,
          withTiming(1, { duration: Math.max(1, (1 - v.value) * half), easing: RISE, reduceMotion: ReduceMotion.Never }),
          withRepeat(withTiming(0, { duration: half, easing: SWING, reduceMotion: ReduceMotion.Never }), -1, true, undefined, ReduceMotion.Never),
        );
      });
      return () => cancelAnimation(v);
    }
    // Covered or inactive: the cancelled breath simply stays where it stopped.
    if (!focused || restedAt.current === rest) return;
    restedAt.current = rest;
    v.value = reduced ? rest : withTiming(rest, timing(D.slow));
  }, [running, focused, reduced, periodMs, rest, v]);

  return v;
}
