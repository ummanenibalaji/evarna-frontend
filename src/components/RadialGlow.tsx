// RadialGlow.tsx — RN has no CSS radial-gradient. This reproduces the common
// `radial-gradient(circle at cx cy, stop0, stop1, ...)` pattern used heavily by
// the prototype (orb layers, ambient orbs, accent halos, avatars) using SVG.
//
// react-native-svg rasterises into a CPU backing store at full screen scale,
// so a 600pt glow costs ~13 MB. A radial falloff has no detail to lose, so big
// glows are drawn small and scaled up by Core Animation instead; the clip
// (and any rounded edge) stays on the full-size view, so edges stay crisp.

import React, { memo, useId } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, Rect, RadialGradient as SvgRadialGradient, Stop } from 'react-native-svg';

export interface GlowStop {
  /** 0..1 offset */
  offset: number;
  color: string;
  opacity?: number;
}

interface RadialGlowProps {
  width: number;
  height: number;
  stops: readonly GlowStop[];
  /** center x as fraction 0..1 (default 0.5) */
  cx?: number;
  /** center y as fraction 0..1 (default 0.5) */
  cy?: number;
  /** radius as fraction of half-extent (default 0.5 => reaches edge) */
  rx?: number;
  ry?: number;
  borderRadius?: number;
  style?: StyleProp<ViewStyle>;
}

// Glows up to this size render 1:1; larger ones shrink to it, at most 4x.
const FULL_RES_MAX = 120;
const MAX_DOWNSCALE = 4;

function RadialGlowImpl({
  width, height, stops, cx = 0.5, cy = 0.5, rx = 0.5, ry = 0.5, borderRadius, style,
}: RadialGlowProps) {
  const id = `rg${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const k = Math.min(MAX_DOWNSCALE, Math.max(1, Math.max(width, height) / FULL_RES_MAX));
  const w = width / k;
  const h = height / k;

  return (
    <View
      pointerEvents="none"
      accessibilityIgnoresInvertColors
      style={[{ width, height, overflow: 'hidden', borderRadius }, style]}
    >
      {/* Transforms scale about the centre, so centre the small canvas. */}
      <View style={{ position: 'absolute', left: (width - w) / 2, top: (height - h) / 2, width: w, height: h, transform: [{ scale: k }] }}>
        <Svg width={w} height={h}>
          <Defs>
            <SvgRadialGradient id={id} cx={`${cx * 100}%`} cy={`${cy * 100}%`} rx={`${rx * 100}%`} ry={`${ry * 100}%`}>
              {stops.map((s, i) => (
                <Stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
              ))}
            </SvgRadialGradient>
          </Defs>
          <Rect x={0} y={0} width={w} height={h} fill={`url(#${id})`} />
        </Svg>
      </View>
    </View>
  );
}

const sameStops = (a: readonly GlowStop[], b: readonly GlowStop[]) =>
  a === b || (a.length === b.length && a.every((s, i) => {
    const t = b[i];
    return s.offset === t.offset && s.color === t.color && s.opacity === t.opacity;
  }));

// Callers build `stops` inline, so compare them by value; a changed opacity
// (the orb's speaking state) still re-renders.
export const RadialGlow = memo(RadialGlowImpl, (prev, next) => {
  const { stops: a, ...restPrev } = prev;
  const { stops: b, ...restNext } = next;
  if (!sameStops(a, b)) return false;
  const keys = Object.keys(restNext) as (keyof typeof restNext)[];
  return keys.length === Object.keys(restPrev).length && keys.every(key => restPrev[key] === restNext[key]);
});
