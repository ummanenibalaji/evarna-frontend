// AmbientBg.tsx — the "Ember Dusk" atmosphere. Soft aurora glows (coral,
// violet, gold) at low opacity over a warm obsidian gradient. The point is
// to add *depth*, not decoration.
//
// Still by default. Any movement under a BlurView makes iOS re-blur every
// frame, and the glows read the same at rest, so only glass-free hero
// screens (splash, meet, call) should pass `drift`. Drift and pulse run on
// the UI thread, ease to zero speed at each turn, hold still under Reduce
// Motion and pause while the app is in the background.

import React, { useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
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

const lerp = (from: number, to: number, t: number) => {
  'worklet';
  return from + (to - from) * t;
};

export function AmbientBg({ intensity = 1, includePulse = false, drift = false }: AmbientBgProps) {
  const { width, height } = useWindowDimensions();
  const reduceTransparency = useReduceTransparency();
  const k = reduceTransparency ? intensity * QUIET : intensity;

  const a = useBreath(DRIFT_A, { paused: !drift });
  const b = useBreath(DRIFT_B, { paused: !drift });
  const p = useBreath(PULSE, { rest: 0.5, paused: !includePulse });

  // Sizes and paths are fractions of the window (drawn at 390pt wide), so
  // the composition is the same on every phone and follows resizes.
  const coralSize = width * 1.23;
  const violetSize = width * 1.18;
  const goldSize = width * 1.08;
  const pulseSize = width * 1.44;

  const coralStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: lerp(-width * 0.2, width * 0.15, a.value) },
      { translateY: lerp(height * 0.15, -height * 0.1, a.value) },
      { scale: lerp(1, 1.08, a.value) },
    ],
  }));
  const violetStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: lerp(width * 0.2, -width * 0.18, b.value) },
      { translateY: lerp(-height * 0.18, height * 0.18, b.value) },
      { scale: lerp(1, 1.12, b.value) },
    ],
  }));
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: lerp(0.5, 0.9, p.value),
    transform: [{ scale: lerp(0.92, 1.08, p.value) }],
  }));

  const stops = useMemo(() => ({
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
  } satisfies Record<string, GlowStop[]>), [k]);

  return (
    <View pointerEvents="none" style={styles.fill}>
      {/* Base graduated warmth — obsidian, warmed through the middle */}
      <LinearGradient colors={[...GRAD.page]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />

      {/* Coral — top-left, the warmest note */}
      <Animated.View style={[{ position: 'absolute', left: -width * 0.35, top: -height * 0.14 }, coralStyle]}>
        <RadialGlow width={coralSize} height={coralSize} stops={stops.coral} />
      </Animated.View>

      {/* Violet — right, drifting against the coral */}
      <Animated.View style={[{ position: 'absolute', right: -width * 0.42, top: height * 0.22 }, violetStyle]}>
        <RadialGlow width={violetSize} height={violetSize} stops={stops.violet} />
      </Animated.View>

      {/* Gold ember — bottom-left, always still and very faint */}
      <View style={{ position: 'absolute', left: -width * 0.3, bottom: -height * 0.18 }}>
        <RadialGlow width={goldSize} height={goldSize} stops={stops.gold} />
      </View>

      {includePulse && (
        <Animated.View
          style={[
            { position: 'absolute', left: (width - pulseSize) / 2, top: height * 0.4 - pulseSize / 2 },
            pulseStyle,
          ]}
        >
          <RadialGlow width={pulseSize} height={pulseSize} stops={stops.pulse} />
        </Animated.View>
      )}

      {/* Vignette — gently darkens the lower edge */}
      <LinearGradient
        colors={VIGNETTE}
        start={{ x: 0.5, y: 0.45 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const VIGNETTE = [rgba(W.shadow, 0), rgba(W.shadow, 0.32)] as const;

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
});
