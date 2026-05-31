// RadialGlow.tsx — RN has no CSS radial-gradient. This reproduces the common
// `radial-gradient(circle at cx cy, stop0, stop1, ...)` pattern used heavily by
// the prototype (orb layers, ambient orbs, accent halos, avatars) using SVG.

import React from 'react';
import { View, StyleProp, ViewStyle } from 'react-native';
import Svg, { Defs, RadialGradient as SvgRadialGradient, Stop, Rect } from 'react-native-svg';

export interface GlowStop {
  /** 0..1 offset */
  offset: number;
  color: string;
  opacity?: number;
}

interface RadialGlowProps {
  width: number;
  height: number;
  stops: GlowStop[];
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

let gid = 0;

export function RadialGlow({
  width, height, stops, cx = 0.5, cy = 0.5, rx = 0.5, ry = 0.5, borderRadius, style,
}: RadialGlowProps) {
  const id = React.useMemo(() => `rg${gid++}`, []);
  return (
    <View
      pointerEvents="none"
      style={[
        { width, height, overflow: 'hidden', borderRadius },
        style,
      ]}
    >
      <Svg width={width} height={height}>
        <Defs>
          <SvgRadialGradient id={id} cx={`${cx * 100}%`} cy={`${cy * 100}%`} rx={`${rx * 100}%`} ry={`${ry * 100}%`}>
            {stops.map((s, i) => (
              <Stop key={i} offset={`${s.offset * 100}%`} stopColor={s.color} stopOpacity={s.opacity ?? 1} />
            ))}
          </SvgRadialGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} rx={borderRadius} ry={borderRadius} />
      </Svg>
    </View>
  );
}
