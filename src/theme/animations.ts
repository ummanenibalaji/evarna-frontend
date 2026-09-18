// animations.ts — RN Animated hooks for the original design's keyframes
// (orbBreathe, orbSpin, dotPulse, wave, slideUp, meetIn…). They return
// styles for Animated.View and run on the native driver.
//
// Every loop is one native timing that never calls back into JS, so it keeps
// moving while the JS thread is busy and staggered siblings stay in phase.
// Loops hold still under Reduce Motion and pause, keeping their phase, once
// their screen has been covered or its tab hidden for a moment, or the app
// goes inactive (useSceneActive).
// New components should prefer the Reanimated primitives in ./motion.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, type GestureResponderEvent } from 'react-native';

import { haptic, type HapticKind } from '../lib/haptics';
import { isPressRelease, useReducedMotion, useSceneActive } from './motion';
import { MOTION } from './theme';

type Bezier = readonly [number, number, number, number];
const bezier = ([x1, y1, x2, y2]: Bezier) => Easing.bezier(x1, y1, x2, y2);
const DECEL = bezier(MOTION.easing.decel);
const STANDARD = bezier(MOTION.easing.standard);
const D = MOTION.duration;

/**
 * A native clock that runs `from → from + 1` every `duration` ms; read it
 * through `modulo(value, 1)` for the phase. Pausing records the phase and
 * resuming carries on from it, so nothing jumps.
 */
class LoopClock {
  readonly value: Animated.Value;
  duration: number;
  private from: number;
  private loop: Animated.CompositeAnimation | null = null;
  private settling = false;
  private wanted = false;
  private disposed = false;

  constructor(duration: number, phase: number) {
    this.duration = duration;
    this.from = phase;
    this.value = new Animated.Value(phase);
  }

  run() {
    this.wanted = true;
    if (this.loop || this.settling || this.disposed) return;
    // The native driver starts a timing from the node's current value, so the
    // target is relative to where the clock stands.
    this.loop = Animated.loop(
      Animated.timing(this.value, { toValue: this.from + 1, duration: this.duration, easing: Easing.linear, useNativeDriver: true }),
    );
    this.loop.start();
  }

  pause() {
    this.wanted = false;
    if (!this.loop) return;
    this.loop.stop();
    this.loop = null;
    if (this.disposed) return;
    this.settling = true;
    this.value.stopAnimation(at => {
      this.settling = false;
      // After unmount the native node is gone; writing to it would recreate one.
      if (this.disposed) return;
      this.from = at % 1;
      this.value.setValue(this.from);
      if (this.wanted) this.run();
    });
  }

  // A remount after dispose (StrictMode) finds the node wherever the loop was
  // stopped; put it back where the clock thinks it is.
  revive() {
    if (!this.disposed) return;
    this.disposed = false;
    this.value.setValue(this.from);
  }

  dispose() {
    this.disposed = true;
    this.pause();
  }
}

// 0→1→0 with zero speed at both turnarounds (a raised cosine), centred on 0
// so a gate can fade it to its midpoint. 24 segments read as a smooth curve.
const PHASE = Array.from({ length: 25 }, (_, i) => i / 24);
const SWING = PHASE.map(t => -Math.cos(2 * Math.PI * t) / 2);

type LoopOptions = {
  yoyo?: boolean;
  /** Milliseconds this loop trails its siblings by (stagger). */
  delay?: number;
  /** False settles a yoyo at its midpoint and freezes a sawtooth in place. */
  enabled?: boolean;
};

type Loop = { clock: LoopClock; gate: Animated.Value | null; output: Animated.AnimatedInterpolation<number> };

function createLoop(durationMs: number, delayMs: number, yoyo: boolean, moving: boolean): Loop {
  const lag = (((delayMs % durationMs) + durationMs) % durationMs) / durationMs;
  const clock = new LoopClock(durationMs, lag === 0 ? 0 : 1 - lag);
  const phase = Animated.modulo<number>(clock.value, 1);
  if (!yoyo) return { clock, gate: null, output: phase };
  const gate = new Animated.Value(moving ? 1 : 0);
  const swing = phase.interpolate({ inputRange: PHASE, outputRange: SWING });
  return { clock, gate, output: Animated.add<number>(Animated.multiply(swing, gate), 0.5) };
}

/** A looping 0→1→0 (yoyo) or 0→1 driver value on the native thread. */
export function useLoop(durationMs: number, opts?: LoopOptions): Animated.AnimatedInterpolation<number> {
  const reduced = useReducedMotion();
  const focused = useSceneActive();
  const moving = (opts?.enabled ?? true) && !reduced;

  // `yoyo` and `delay` shape the node graph, so they are read once.
  const loop = useRef<Loop | null>(null);
  loop.current ??= createLoop(durationMs, opts?.delay ?? 0, opts?.yoyo ?? false, moving);
  const { clock, gate, output } = loop.current;

  useEffect(() => {
    clock.revive();
    return () => clock.dispose();
  }, [clock]);

  // A covered screen's (or inactive app's) loop stops where it is, the gate
  // left open, so it carries on from the same phase when it is back.
  useEffect(() => {
    if (!moving || !focused) return;
    clock.duration = durationMs;
    clock.run();
    return () => clock.pause();
  }, [clock, moving, focused, durationMs]);

  // A yoyo eases to and from its midpoint when a caller toggles it; Reduce
  // Motion cuts straight there. A new timing or setValue replaces any fade
  // still running, and unmounting stops it, so no cleanup is needed.
  const gateOpen = useRef(moving);
  useEffect(() => {
    if (!gate || gateOpen.current === moving) return;
    gateOpen.current = moving;
    if (reduced) gate.setValue(0);
    else Animated.timing(gate, { toValue: moving ? 1 : 0, duration: D.base, easing: STANDARD, useNativeDriver: true }).start();
  }, [gate, moving, reduced]);

  return output;
}

const lerp = (v: Animated.AnimatedInterpolation<number>, from: number, to: number) =>
  v.interpolate({ inputRange: [0, 1], outputRange: [from, to] });

/** orbBreathe: scale 0.95↔1.05, opacity 0.95↔1. Returns animated style.
 *  Changing the duration keeps the breath's phase, only its speed changes. */
export function useBreathe(durationMs = 4000, enabled = true) {
  const v = useLoop(durationMs, { yoyo: true, enabled });
  return useMemo(() => ({ transform: [{ scale: lerp(v, 0.95, 1.05) }], opacity: lerp(v, 0.95, 1) }), [v]);
}

/** orbSpin: 0 → 360deg linear. Stops where it is when disabled. */
export function useSpin(durationMs = 2400, enabled = true) {
  const v = useLoop(durationMs, { enabled });
  return useMemo(() => ({ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }), [v]);
}

/** dotPulse: opacity 0.3↔1, translateY 0↔-2. Accepts a stagger delay. */
export function useDotPulse(delayMs = 0, enabled = true) {
  const v = useLoop(1200, { yoyo: true, delay: delayMs, enabled });
  return useMemo(() => ({ opacity: lerp(v, 0.3, 1), transform: [{ translateY: lerp(v, 0, -2) }] }), [v]);
}

/** wave: scaleY 0.4↔1. Accepts a stagger delay. */
export function useWave(delayMs = 0, enabled = true) {
  const v = useLoop(800, { yoyo: true, delay: delayMs, enabled });
  return useMemo(() => ({ transform: [{ scaleY: lerp(v, 0.4, 1) }] }), [v]);
}

/** pulse: the "something is live here" dot — opacity 0.45↔1 with a scale
 *  swell. Used for pending companions and the speaking indicator. */
export function usePulse(durationMs = 1800, enabled = true) {
  const v = useLoop(durationMs, { yoyo: true, enabled });
  return useMemo(() => ({ opacity: lerp(v, 0.45, 1), transform: [{ scale: lerp(v, 0.85, 1.15) }] }), [v]);
}

/** ringBreathe: opacity across `range` (default 0.3↔0.7). */
export function useRingBreathe(enabled = true, range: readonly [number, number] = [0.3, 0.7]) {
  const v = useLoop(3000, { yoyo: true, enabled });
  const [lo, hi] = range;
  return useMemo(() => ({ opacity: lerp(v, lo, hi) }), [v, lo, hi]);
}

// ctaHalo timeline: the first 80% expands on an ease-out, the rest holds
// invisible until the next ring.
const HALO_IN = [...Array.from({ length: 13 }, (_, i) => (i / 12) * 0.8), 1];
const haloEase = Easing.out(Easing.ease);
const HALO_OUT = HALO_IN.map(t => (t >= 0.8 ? 1 : haloEase(t / 0.8)));
const HALO_HIDDEN = { transform: [{ scale: 1 }], opacity: 0 };

/** ctaHalo: scale 1→1.6, opacity 0.45→0, then a pause. Hidden when disabled
 *  or under Reduce Motion. */
export function useCtaHalo(durationMs = 3500, enabled = true) {
  const reduced = useReducedMotion();
  const v = useLoop(durationMs, { enabled });
  const ring = useMemo(() => {
    const t = v.interpolate({ inputRange: HALO_IN, outputRange: HALO_OUT });
    return { transform: [{ scale: lerp(t, 1, 1.6) }], opacity: lerp(t, 0.45, 0) };
  }, [v]);
  return enabled && !reduced ? ring : HALO_HIDDEN;
}

/** A one-shot entrance on mount: fade + rise. Under Reduce Motion it is a
 *  short cross-fade with no travel. */
export function useEntrance(opts?: { fromTranslateY?: number; durationMs?: number; delayMs?: number }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  // Runs once: an entrance never replays.
  useEffect(() => {
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: reduced ? D.fast : opts?.durationMs ?? 600,
      delay: opts?.delayMs ?? 0,
      easing: reduced ? STANDARD : DECEL,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, []);
  const from = reduced ? 0 : opts?.fromTranslateY ?? 20;
  return useMemo(() => ({ opacity: v, transform: [{ translateY: lerp(v, from, 0) }] }), [v, from]);
}

// A count redraws whoever reads it, so it ticks at most this often (~12 a
// second) rather than every frame; the eye reads a rolling numeral the same.
const COUNT_TICK = 80;

/** Counts from the number on screen to `to` over `duration` ms and returns
 *  the rounded value. Text can't be driven natively, so this one ticks on
 *  the JS thread — on a timer, only when the shown number changes, and never
 *  more than ~12 times a second, so the component reading it re-renders a
 *  handful of times rather than every frame. Under Reduce Motion it returns
 *  `to` straight away. */
export function useCountUp(to: number, duration = 1200, delay = 0): number {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? to : 0);
  const shown = useRef(n);

  useEffect(() => {
    const show = (value: number) => {
      if (value === shown.current) return;
      shown.current = value;
      setN(value);
    };
    if (reduced || duration <= 0) {
      show(to);
      return;
    }
    const from = shown.current;
    if (from === to) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      const t0 = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - t0) / duration);
        show(Math.round(from + (to - from) * DECEL(t)));
        if (t >= 1) clearInterval(interval);
      };
      interval = setInterval(tick, COUNT_TICK);
      tick();
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [to, duration, delay, reduced]);

  return reduced ? to : n;
}

const PRESS_IN = { ...MOTION.spring.snappy, useNativeDriver: true };
const PRESS_OUT = { ...MOTION.spring.bouncy, useNativeDriver: true };

/** A pressable scale-down spring for tap feedback, with a light haptic when
 *  the press lands (on release, never on touch-down, so a scroll that starts
 *  on the control doesn't tick) unless `haptic` says otherwise. It answers
 *  the user's own touch, so it plays under Reduce Motion too. Returns
 *  animated style + handlers. */
export function usePressScale(scaleTo: number = MOTION.press.scale, opts?: { haptic?: HapticKind | false }) {
  const v = useRef(new Animated.Value(1)).current;
  const kind = opts?.haptic ?? 'light';

  const onPressIn = useCallback(() => {
    Animated.spring(v, { toValue: scaleTo, ...PRESS_IN }).start();
  }, [v, scaleTo]);

  const onPressOut = useCallback((e?: GestureResponderEvent) => {
    Animated.spring(v, { toValue: 1, ...PRESS_OUT }).start();
    if (kind && isPressRelease(e)) haptic[kind]();
  }, [v, kind]);

  const style = useMemo(() => ({ transform: [{ scale: v }] }), [v]);
  return { style, onPressIn, onPressOut };
}

/** greetingGlow proxy — a brief fade-in (text-shadow can't animate in RN). */
export function useGreetingGlow() {
  return useEntrance({ fromTranslateY: 0, durationMs: 800 });
}

/** floatY: translateY 0↔-4. */
export function useFloat(enabled = true) {
  const v = useLoop(5000, { yoyo: true, enabled });
  return useMemo(() => ({ transform: [{ translateY: lerp(v, 0, -4) }] }), [v]);
}

/** meetIn: scale 0.2→1 with a fade (blur omitted — unsupported in RN).
 *  Under Reduce Motion it only fades. */
export function useMeetIn() {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  // Runs once: an entrance never replays.
  useEffect(() => {
    const anim = Animated.timing(v, { toValue: 1, duration: reduced ? D.slow : 1200, easing: DECEL, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, []);
  return useMemo(() => {
    const scale = reduced ? 1 : v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.2, 1, 1] });
    return { opacity: v, transform: [{ scale }] };
  }, [v, reduced]);
}
