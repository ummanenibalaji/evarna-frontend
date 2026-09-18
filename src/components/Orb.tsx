// Orb.tsx — the glowing product identity.
// Ported from system.jsx Orb(). CSS radial-gradient layers → SVG RadialGlow;
// breathing, spin, orbit and embers → Reanimated values on the UI thread.
// blur() filters are approximated by soft SVG gradients (RN has no per-view
// blur on arbitrary content).
//
// Nothing here re-renders while the orb moves: every layer is drawn once and
// only its transform and opacity animate. A change of state cross-fades the
// tint and eases the size; nothing restarts, so the orb never jumps.

import React, { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { scheduleOnUI } from 'react-native-worklets';
import { LinearGradient } from 'expo-linear-gradient';
import { RadialGlow, type GlowStop } from './RadialGlow';
import { timing, useAppActive, useBreath, useReducedMotion } from '../theme/motion';
import { ELEV, GRAD, MOTION, W } from '../theme/theme';
import type { OrbState } from '../lib/voiceCall';

export type { OrbState };

interface OrbProps {
  state?: OrbState;
  size?: number;
  accent?: string;
  intensity?: number;
  /** The companion's live voice level, 0–1. While speaking it drives the
   *  orb's pulse; without it the pulse is timed. */
  level?: SharedValue<number>;
  /** Steps the orb back: the mic is muted, or the call is over. */
  dimmed?: boolean;
  /** Layout box as a multiple of `size`. The glow always overflows it.
   *  Default 2, the original footprint; the call screen uses 1.2. */
  box?: number;
}

const D = MOTION.duration;

// Colour cross-fades are the calm alternative to movement, so they play
// under Reduce Motion too.
const fade = (ms: number): WithTimingConfig => ({ ...timing(ms), reduceMotion: ReduceMotion.Never });

const SCALE: Record<OrbState, number> = { speaking: 1.12, idle: 1, listening: 0.92, paused: 0.9, thinking: 0.85 };

// Listening leans violet (the cool end of the aurora); a reconnecting call
// greys out. Everything else wears the companion's accent.
type Tint = 'accent' | 'violet' | 'rest';
const TINT: Record<OrbState, Tint> = { speaking: 'accent', idle: 'accent', thinking: 'accent', listening: 'violet', paused: 'rest' };
const TINT_FADE = 400;

const SPEAKING_PULSE = 1300;
const RING_PERIOD = 7000;
const ORBIT_PERIOD = 2400;
const EMBER_PERIOD = 1600;
const DIMMED = 0.5;
const RING_PAUSED = 0.35;

// Sideways drift of each ember at size 200. A fixed pool on staggered phases
// replaces the old per-ember React state, which re-rendered the whole orb
// several times a second while the companion spoke.
const EMBER_DRIFT = [-24, 16, -8, 27, -17, 6];

const RING = [...GRAD.aurora, W.coral] as const;
const MID: GlowStop[] = [
  { offset: 0, color: W.cream, opacity: 0.8 },
  { offset: 0.28, color: W.secondary, opacity: 0.73 },
  { offset: 0.6, color: W.secondary, opacity: 0.2 },
  { offset: 0.85, color: W.secondary, opacity: 0 },
];
const CORE: GlowStop[] = [
  { offset: 0, color: W.cream, opacity: 1 },
  { offset: 0.18, color: W.primarySoft, opacity: 1 },
  { offset: 0.44, color: W.primary, opacity: 1 },
  { offset: 0.72, color: W.violet, opacity: 0.75 },
  { offset: 1, color: W.violet, opacity: 0 },
];

/** A 0→1 sawtooth on the UI thread. Stopping (or Reduce Motion, or the app
 *  going to the background) leaves it where it is; starting again carries on
 *  from there. */
function useCycle(periodMs: number, running: boolean): SharedValue<number> {
  const reduced = useReducedMotion();
  const active = useAppActive();
  const t = useSharedValue(0);
  const go = running && active && !reduced;

  useEffect(() => {
    if (!go) return;
    scheduleOnUI(() => {
      'worklet';
      const from = t.value % 1;
      t.value = from;
      t.value = withRepeat(
        withTiming(from + 1, { duration: periodMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
        -1, false, undefined, ReduceMotion.Never,
      );
    });
    return () => cancelAnimation(t);
  }, [go, periodMs, t]);

  return t;
}

/** Style that centres a `s`-point square inside the orb's `box`-point layout box. */
const centred = (box: number, s: number): ViewStyle => ({
  position: 'absolute', width: s, height: s, left: (box - s) / 2, top: (box - s) / 2,
});

function OrbImpl({ state = 'idle', size = 180, accent = W.primary, intensity = 1, level, dimmed = false, box = 2 }: OrbProps) {
  const reduced = useReducedMotion();
  const isSpeaking = state === 'speaking';
  const isThinking = state === 'thinking';
  const isPaused = state === 'paused';
  const tint = TINT[state];
  const boxPx = size * box;

  const scale = useSharedValue(SCALE[state]);
  const accentOn = useSharedValue(tint === 'accent' ? 1 : 0);
  const violetOn = useSharedValue(tint === 'violet' ? 1 : 0);
  const restOn = useSharedValue(tint === 'rest' ? 1 : 0);
  const speaking = useSharedValue(isSpeaking ? 1 : 0);
  const thinking = useSharedValue(isThinking ? 1 : 0);
  const ringLit = useSharedValue(isPaused ? RING_PAUSED : 1);
  const presence = useSharedValue(dimmed ? DIMMED : 1);

  useEffect(() => {
    // Size follows the motion setting (it jumps under Reduce Motion); colour
    // always cross-fades.
    scale.value = withTiming(SCALE[state], timing(D.slower, 'decel'));
    accentOn.value = withTiming(tint === 'accent' ? 1 : 0, fade(TINT_FADE));
    violetOn.value = withTiming(tint === 'violet' ? 1 : 0, fade(TINT_FADE));
    restOn.value = withTiming(tint === 'rest' ? 1 : 0, fade(TINT_FADE));
    speaking.value = withTiming(isSpeaking ? 1 : 0, fade(TINT_FADE));
    thinking.value = withTiming(isThinking ? 1 : 0, fade(D.base));
    ringLit.value = withTiming(isPaused ? RING_PAUSED : 1, fade(TINT_FADE));
  }, [state, tint, isSpeaking, isThinking, isPaused, scale, accentOn, violetOn, restOn, speaking, thinking, ringLit]);

  useEffect(() => {
    presence.value = withTiming(dimmed ? DIMMED : 1, fade(D.slow));
  }, [dimmed, presence]);

  // One slow breath always, plus a quicker pulse blended in while speaking —
  // the old version swapped one loop for the other and snapped mid-breath.
  const breath = useBreath(D.ambient, { rest: 0.5 });
  const pulse = useBreath(SPEAKING_PULSE, { paused: !isSpeaking });
  const fallbackLevel = useSharedValue(0);
  const voice = level ?? fallbackLevel;
  const ring = useCycle(RING_PERIOD, !isPaused);
  const orbit = useCycle(ORBIT_PERIOD, isThinking);
  const emberClock = useCycle(EMBER_PERIOD, isSpeaking);

  // How hard the orb is talking, 0–1: the live voice when there is one (with
  // the timed pulse as a floor between words). Still under Reduce Motion.
  const energy = useDerivedValue(() => {
    if (reduced) return 0;
    return speaking.value * Math.max(pulse.value * 0.35, voice.value);
  });

  const orbStyle = useAnimatedStyle(() => ({ opacity: presence.value, transform: [{ scale: scale.value }] }));
  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.95 + breath.value * 0.05,
    transform: [{ scale: 0.95 + breath.value * 0.1 + energy.value * 0.1 }],
  }));
  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.95 + breath.value * 0.1 + energy.value * 0.16 }],
  }));
  const midStyle = useAnimatedStyle(() => ({ opacity: 0.85 + speaking.value * 0.15 }));
  const coreStyle = useAnimatedStyle(() => ({ opacity: (0.95 + breath.value * 0.05) * (1 - thinking.value * 0.4) }));
  const accentStyle = useAnimatedStyle(() => ({ opacity: accentOn.value }));
  const violetStyle = useAnimatedStyle(() => ({ opacity: violetOn.value }));
  const restStyle = useAnimatedStyle(() => ({ opacity: restOn.value }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringLit.value, transform: [{ rotate: `${ring.value * 360}deg` }] }));
  const orbitStyle = useAnimatedStyle(() => ({ opacity: thinking.value, transform: [{ rotate: `${orbit.value * 360}deg` }] }));
  const emberGate = useDerivedValue(() => (reduced ? 0 : speaking.value));

  const layout = useMemo(() => {
    const disc = size - 14;
    const orbitBox = size * 1.5;
    return {
      root: { width: boxPx, height: boxPx },
      ring: [centred(boxPx, size), { borderRadius: size / 2, overflow: 'hidden' as const }],
      disc: [centred(boxPx, disc), { borderRadius: disc / 2, backgroundColor: W.bg }],
      mid: centred(boxPx, size * 1.15),
      core: centred(boxPx, size * 0.62),
      orbit: centred(boxPx, orbitBox),
      dots: [0, 120, 240].map(deg => {
        const rad = (deg * Math.PI) / 180;
        const r = size * 0.75;
        return { left: orbitBox / 2 + Math.sin(rad) * r - 3.5, top: orbitBox / 2 - Math.cos(rad) * r - 3.5 };
      }),
    };
  }, [size, boxPx]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[layout.root, orbStyle]}
    >
      {/* Aurora ring — a slowly rotating coral→rose→violet band with a dark
          disc punched out of the middle. RN has no conic gradient, so this is
          a linear gradient on a spinning square, clipped to a circle. */}
      <Animated.View style={[layout.ring, ringStyle]}>
        <LinearGradient colors={RING} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill} />
      </Animated.View>
      <View style={layout.disc} />

      {/* The tinted blooms, one set per tint, cross-faded rather than recoloured. */}
      <Animated.View style={[StyleSheet.absoluteFill, haloStyle]}>
        <TintBloom color={accent} size={size} box={boxPx} intensity={intensity} style={accentStyle} />
        <TintBloom color={W.violet} size={size} box={boxPx} intensity={intensity} style={violetStyle} />
        <TintBloom color={W.textMuted} size={size} box={boxPx} intensity={intensity} style={restStyle} />
      </Animated.View>

      {/* Body: the lit middle and the hot core. The core used to carry a
          40pt shadow, re-rendered offscreen on every breathing frame; the
          blooms above already give it its glow. */}
      <Animated.View style={[StyleSheet.absoluteFill, bodyStyle]}>
        <Animated.View style={[layout.mid, midStyle]}>
          <RadialGlow width={size * 1.15} height={size * 1.15} borderRadius={size * 0.575} cx={0.45} cy={0.4} stops={MID} />
        </Animated.View>
        <Animated.View style={[layout.core, coreStyle]}>
          <RadialGlow width={size * 0.62} height={size * 0.62} borderRadius={size * 0.31} cx={0.38} cy={0.32} stops={CORE} />
        </Animated.View>
      </Animated.View>

      {/* Thinking: three dots orbiting. They fade rather than mount, so the
          orbit doesn't pop in and out between turns. */}
      <Animated.View style={[layout.orbit, orbitStyle]}>
        {layout.dots.map((d, i) => <View key={i} style={[styles.dot, d]} />)}
      </Animated.View>

      {/* Speaking: embers rising off the orb. */}
      {EMBER_DRIFT.map((drift, i) => (
        <Ember key={i} index={i} drift={drift} size={size} box={boxPx} tint={accent} clock={emberClock} gate={emberGate} />
      ))}
    </Animated.View>
  );
}

/** The two tinted glow layers (wide halo and outer ring) in one colour. */
const TintBloom = memo(function TintBloom({ color, size, box, intensity, style }: {
  color: string; size: number; box: number; intensity: number; style: ViewStyle;
}) {
  const halo = useMemo<GlowStop[]>(() => [
    { offset: 0, color, opacity: 0.31 * intensity },
    { offset: 0.55, color, opacity: 0 },
  ], [color, intensity]);
  const outer = useMemo<GlowStop[]>(() => [
    { offset: 0, color, opacity: 0.28 },
    { offset: 0.5, color, opacity: 0.08 },
    { offset: 0.75, color, opacity: 0 },
  ], [color]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      <View style={centred(box, size * 2)}>
        <RadialGlow width={size * 2} height={size * 2} stops={halo} />
      </View>
      <View style={centred(box, size * 1.4)}>
        <RadialGlow width={size * 1.4} height={size * 1.4} borderRadius={size * 0.7} stops={outer} />
      </View>
    </Animated.View>
  );
});

function Ember({ index, drift, size, box, tint, clock, gate }: {
  index: number; drift: number; size: number; box: number; tint: string;
  clock: SharedValue<number>; gate: SharedValue<number>;
}) {
  const dx = (drift * size) / 200;
  const rise = size * 0.25;
  const offset = index / EMBER_DRIFT.length;
  const style = useAnimatedStyle(() => {
    const p = (clock.value + offset) % 1;
    const eased = 1 - (1 - p) * (1 - p);
    const glow = p < 0.2 ? p * 4 : 1 - p;
    return {
      opacity: gate.value * glow * 0.8,
      transform: [{ translateX: dx * eased }, { translateY: -rise * eased }, { scale: 0.6 * (1 - p) }],
    };
  });
  const place = useMemo(() => [styles.ember, { left: box / 2 - 2, top: box / 2 - 2 }, ELEV.glow(tint, 6, 1)], [box, tint]);
  return <Animated.View style={[place, style]} />;
}

export const Orb = memo(OrbImpl);

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dot: {
    position: 'absolute', width: 7, height: 7, borderRadius: 3.5, backgroundColor: W.secondary,
    ...ELEV.glow(W.secondary, 8, 1),
  },
  ember: { position: 'absolute', width: 4, height: 4, borderRadius: 2, backgroundColor: W.cream },
});
