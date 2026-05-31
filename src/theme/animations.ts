// animations.ts — RN Animated hooks reproducing the CSS @keyframes from
// index.html (orbBreathe, orbSpin, dotPulse, wave, slideUp, weightIn, etc.).
// All use the JS driver where interpolating non-transform/opacity props.

import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/** A looping 0->1->0 (or 0->1) driver value. */
export function useLoop(durationMs: number, opts?: { yoyo?: boolean; delay?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const seq = opts?.yoyo
      ? Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: durationMs / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: durationMs / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ])
      : Animated.timing(v, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true });
    const anim = Animated.loop(seq);
    const t = setTimeout(() => anim.start(), opts?.delay ?? 0);
    return () => { clearTimeout(t); anim.stop(); };
  }, [durationMs, opts?.yoyo, opts?.delay]);
  return v;
}

/** orbBreathe: scale 0.95<->1.05, opacity 0.95<->1. Returns animated style. */
export function useBreathe(durationMs = 4000) {
  const v = useLoop(durationMs, { yoyo: true });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] });
  return { transform: [{ scale }], opacity };
}

/** orbSpin: 0 -> 360deg linear. */
export function useSpin(durationMs = 2400) {
  const v = useLoop(durationMs);
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return { transform: [{ rotate }] };
}

/** dotPulse: opacity 0.3<->1, translateY 0<->-2. Accepts a stagger delay. */
export function useDotPulse(delayMs = 0) {
  const v = useLoop(1200, { yoyo: true, delay: delayMs });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  return { opacity, transform: [{ translateY }] };
}

/** wave: scaleY 0.4<->1. Accepts a stagger delay. */
export function useWave(delayMs = 0) {
  const v = useLoop(800, { yoyo: true, delay: delayMs });
  const scaleY = v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  return { transform: [{ scaleY }] };
}

/** ringBreathe: opacity 0.3<->0.7. */
export function useRingBreathe() {
  const v = useLoop(3000, { yoyo: true });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });
  return { opacity };
}

/** ctaHalo: scale 1->1.6, opacity 0.45->0 (one-shot per loop, then holds). */
export function useCtaHalo(durationMs = 3500) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: durationMs, easing: Easing.out(Easing.ease), useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, [durationMs]);
  // 0..0.8 of the timeline does the visible motion, then it's invisible until reset.
  const scale = v.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1.6, 1.6] });
  const opacity = v.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.45, 0, 0] });
  return { transform: [{ scale }], opacity };
}

/** A one-shot entrance: fade+translateY. Mirrors weightIn / slideUp / bubbleRise.
 *  Uses a soft "snap" easing (cubic-out bezier) for buttery feel. */
export function useEntrance(opts?: { fromTranslateY?: number; durationMs?: number; delayMs?: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(v, {
        toValue: 1,
        duration: opts?.durationMs ?? 600,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: true,
      }).start();
    }, opts?.delayMs ?? 0);
    return () => clearTimeout(t);
  }, []);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [opts?.fromTranslateY ?? 20, 0] });
  const opacity = v;
  return { opacity, transform: [{ translateY }] };
}

/** Animate a number counting up from 0 to `to` over `duration` ms. Returns the current rounded value. */
export function useCountUp(to: number, duration = 1200, delay = 0): number {
  const v = useRef(new Animated.Value(0)).current;
  const [n, setN] = useState(0);
  useEffect(() => {
    v.setValue(0);
    const sub = v.addListener(({ value }) => setN(Math.round(value * to)));
    const t = setTimeout(() => {
      Animated.timing(v, { toValue: 1, duration, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: false }).start();
    }, delay);
    return () => { clearTimeout(t); v.removeListener(sub); };
  }, [to, duration, delay]);
  return n;
}

/** A pressable scale-down spring for tap feedback. Returns animated style + handlers. */
export function usePressScale(scaleTo = 0.96) {
  const v = useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    Animated.spring(v, { toValue: scaleTo, useNativeDriver: true, speed: 50, bounciness: 0 }).start();
  };
  const onPressOut = () => {
    Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 8 }).start();
  };
  return { style: { transform: [{ scale: v }] }, onPressIn, onPressOut };
}

/** greetingGlow proxy — a brief fade-in (text-shadow can't animate in RN). */
export function useGreetingGlow() {
  return useEntrance({ fromTranslateY: 0, durationMs: 800 });
}

/** floatY: translateY 0<->-4. */
export function useFloat() {
  const v = useLoop(5000, { yoyo: true });
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -4] });
  return { transform: [{ translateY }] };
}

/** meetIn: scale 0.2->1, opacity 0->1 (blur omitted — unsupported in RN). */
export function useMeetIn() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 1200,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, []);
  const scale = v.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.2, 1, 1] });
  return { opacity: v, transform: [{ scale }] };
}
