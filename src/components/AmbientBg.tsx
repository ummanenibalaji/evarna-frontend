// AmbientBg.tsx — the "Ember Dusk" atmosphere. Soft aurora glows (coral,
// violet, gold) at low opacity over a warm obsidian gradient. The point is
// to add *depth*, not decoration.
//
// Still by default. Any movement under a BlurView makes iOS re-blur every
// frame, and the glows read the same at rest, so only glass-free hero
// screens (splash, meet, call) should pass `drift`. Drift and pulse run on
// the UI thread, ease to zero speed at each turn, hold still under Reduce
// Motion and pause while their screen is covered.
//
// Every screen mounts one of these, so the still version is built to be
// cheap: the three glows share one small SVG canvas drawn once at mount and
// scaled up by Core Animation (a radial falloff has no detail to lose), with
// no animation hooks at all. The component is memoized; its props are
// primitives, so a screen's own re-renders never reach it.

import React, { memo, useId, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { RadialGlow, type GlowStop } from './RadialGlow';
import { GRAD, W, rgba } from '../theme/theme';
import { useBreath } from '../theme/motion';
import { useReduceTransparency } from '../hooks/useAccessibilityPrefs';

interface AmbientBgProps {
  intensity?: number;
  /** A slow violet swell behind the centre of the screen. */
  includePulse?: boolean;
  /** Let the glows wander. Only for screens without glass above them. */
  drift?: boolean;
}

// Periods of a full there-and-back, in ms. They differ so the two glows
// drift in and out of step rather than moving as one.
const DRIFT_A = 48000;
const DRIFT_B = 56000;
const PULSE = 12000;

// Reduce Transparency users are asking for steadier backdrops behind text,
// so the glows dim rather than disappear.
const QUIET = 0.6;

// The still canvas is drawn at this fraction of the screen and scaled up.
const DOWNSCALE = 4;

const PAGE = [...GRAD.page] as const;
const PAGE_AT = [0, 0.55, 1] as const;
const VIGNETTE = [rgba(W.shadow, 0), rgba(W.shadow, 0.32)] as const;
const VIGNETTE_START = { x: 0.5, y: 0.45 } as const;
const VIGNETTE_END = { x: 0.5, y: 1 } as const;

const lerp = (from: number, to: number, t: number) => {
  'worklet';
  return from + (to - from) * t;
};

function glowStops(k: number) {
  return {
    coral: [
      { offset: 0, color: W.primary, opacity: 0.16 * k },
      { offset: 0.55, color: W.primary, opacity: 0.03 * k },
      { offset: 0.7, color: W.primary, opacity: 0 },
    ],
    violet: [
      { offset: 0, color: W.violet, opacity: 0.12 * k },
      { offset: 0.62, color: W.violet, opacity: 0 },
    ],
    gold: [
      { offset: 0, color: W.gold, opacity: 0.09 * k },
      { offset: 0.6, color: W.gold, opacity: 0 },
    ],
    pulse: [
      { offset: 0, color: W.secondary, opacity: 0.06 * k },
      { offset: 0.6, color: W.secondary, opacity: 0 },
    ],
  } satisfies Record<string, GlowStop[]>;
}
type Stops = ReturnType<typeof glowStops>;

// Where the drift transforms leave each glow at breath 0, as fractions of the
// window. The still canvas draws the glows there.
const DRIFT_REST = {
  coral: { x: -0.2, y: 0.15 },
  violet: { x: 0.2, y: -0.18 },
} as const;

// Sizes and places are fractions of the window (drawn at 390pt wide), so the
// composition is the same on every phone and follows resizes. These are the
// anchors the drift moves from; at rest (breath 0) coral and violet sit
// offset from them by DRIFT_REST.
function geometry(width: number, height: number) {
  const coral = width * 1.23;
  const violet = width * 1.18;
  const gold = width * 1.08;
  const pulse = width * 1.44;
  return {
    coral: { size: coral, left: -width * 0.35, top: -height * 0.14 },
    violet: { size: violet, left: width * 1.42 - violet, top: height * 0.22 },
    gold: { size: gold, left: -width * 0.3, top: height * 1.18 - gold },
    pulse: { size: pulse, left: (width - pulse) / 2, top: height * 0.4 - pulse / 2 },
  };
}

function AmbientBgImpl({ intensity = 1, includePulse = false, drift = false }: AmbientBgProps) {
  const { width, height } = useWindowDimensions();
  const reduceTransparency = useReduceTransparency();
  const k = reduceTransparency ? intensity * QUIET : intensity;
  const stops = useMemo(() => glowStops(k), [k]);

  return (
    <View pointerEvents="none" style={styles.fill}>
      {/* Base graduated warmth — obsidian, warmed through the middle */}
      <LinearGradient colors={PAGE} locations={PAGE_AT} style={StyleSheet.absoluteFill} />

      {drift
        ? <DriftGlows width={width} height={height} stops={stops} />
        : <StillGlows width={width} height={height} stops={stops} />}

      {includePulse ? <PulseGlow width={width} height={height} stops={stops} /> : null}

      {/* Vignette — gently darkens the lower edge */}
      <LinearGradient colors={VIGNETTE} start={VIGNETTE_START} end={VIGNETTE_END} style={StyleSheet.absoluteFill} />
    </View>
  );
}

export const AmbientBg = memo(AmbientBgImpl);
AmbientBg.displayName = 'AmbientBg';

interface GlowsProps {
  width: number;
  height: number;
  stops: Stops;
}

const pct = (n: number) => `${n * 100}%`;

/** Coral (top-left, the warmest note), violet (right) and a faint gold ember
 *  (bottom-left), drawn together once. */
function StillGlows({ width, height, stops }: GlowsProps) {
  const id = `ab${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const g = geometry(width, height);
  const w = width / DOWNSCALE;
  const h = height / DOWNSCALE;
  const atRest = (place: { size: number; left: number; top: number }, shift?: { x: number; y: number }) =>
    shift ? { size: place.size, left: place.left + width * shift.x, top: place.top + height * shift.y } : place;
  const glows = [
    { key: 'coral', place: atRest(g.coral, DRIFT_REST.coral), stops: stops.coral },
    { key: 'violet', place: atRest(g.violet, DRIFT_REST.violet), stops: stops.violet },
    { key: 'gold', place: g.gold, stops: stops.gold },
  ] as const;

  return (
    // Transforms scale about the centre, so centre the small canvas.
    <View
      accessibilityIgnoresInvertColors
      style={[styles.canvas, { left: (width - w) / 2, top: (height - h) / 2, width: w, height: h }]}
    >
      <Svg width={w} height={h}>
        <Defs>
          {glows.map(glow => (
            <RadialGradient key={glow.key} id={`${id}${glow.key}`} cx="50%" cy="50%" rx="50%" ry="50%">
              {glow.stops.map((s, i) => (
                <Stop key={i} offset={pct(s.offset)} stopColor={s.color} stopOpacity={s.opacity} />
              ))}
            </RadialGradient>
          ))}
        </Defs>
        {glows.map(glow => (
          <Rect
            key={glow.key}
            x={glow.place.left / DOWNSCALE}
            y={glow.place.top / DOWNSCALE}
            width={glow.place.size / DOWNSCALE}
            height={glow.place.size / DOWNSCALE}
            fill={`url(#${id}${glow.key})`}
          />
        ))}
      </Svg>
    </View>
  );
}

/** The same three glows, coral and violet wandering against each other. */
function DriftGlows({ width, height, stops }: GlowsProps) {
  const g = geometry(width, height);
  const a = useBreath(DRIFT_A);
  const b = useBreath(DRIFT_B);

  const coralStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: lerp(width * DRIFT_REST.coral.x, width * 0.15, a.value) },
      { translateY: lerp(height * DRIFT_REST.coral.y, -height * 0.1, a.value) },
      { scale: lerp(1, 1.08, a.value) },
    ],
  }));
  const violetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: lerp(width * DRIFT_REST.violet.x, -width * 0.18, b.value) },
      { translateY: lerp(height * DRIFT_REST.violet.y, height * 0.18, b.value) },
      { scale: lerp(1, 1.12, b.value) },
    ],
  }));

  return (
    <>
      <Animated.View style={[styles.abs, { left: g.coral.left, top: g.coral.top }, coralStyle]}>
        <RadialGlow width={g.coral.size} height={g.coral.size} stops={stops.coral} />
      </Animated.View>
      <Animated.View style={[styles.abs, { left: g.violet.left, top: g.violet.top }, violetStyle]}>
        <RadialGlow width={g.violet.size} height={g.violet.size} stops={stops.violet} />
      </Animated.View>
      {/* The gold ember is always still and very faint. */}
      <View style={[styles.abs, { left: g.gold.left, top: g.gold.top }]}>
        <RadialGlow width={g.gold.size} height={g.gold.size} stops={stops.gold} />
      </View>
    </>
  );
}

/** A slow violet swell behind the centre. */
function PulseGlow({ width, height, stops }: GlowsProps) {
  const { pulse } = geometry(width, height);
  const p = useBreath(PULSE, { rest: 0.5 });
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: lerp(0.5, 0.9, p.value),
    transform: [{ scale: lerp(0.92, 1.08, p.value) }],
  }));

  return (
    <Animated.View style={[styles.abs, { left: pulse.left, top: pulse.top }, pulseStyle]}>
      <RadialGlow width={pulse.size} height={pulse.size} stops={stops.pulse} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  abs: { position: 'absolute' },
  canvas: { position: 'absolute', transform: [{ scale: DOWNSCALE }] },
});
