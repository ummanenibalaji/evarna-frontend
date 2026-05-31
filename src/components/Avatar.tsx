// Avatar.tsx + Waveform — ported from system.jsx Avatar() and onboarding.jsx Waveform().
// Premium treatment: outer halo glow + gradient ring + inner radial light.

import React from 'react';
import { View, Image, Animated } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RadialGlow } from './RadialGlow';
import { useRingBreathe, useWave } from '../theme/animations';
import { W, alpha } from '../theme/theme';

interface AvatarProps {
  name?: string;
  size?: number;
  color?: string;
  image?: string;
  breathe?: boolean;
}

export function Avatar({ size = 48, color = W.primary, image, breathe = true }: AvatarProps) {
  const ring = useRingBreathe();
  const ringOffset = Math.max(4, size * 0.07);
  const ringSize = size + ringOffset * 2;

  // Halo glow — a soft accent bloom behind everything, breathes with the ring.
  const halo = breathe ? (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: -ringOffset * 2.4, top: -ringOffset * 2.4,
          right: -ringOffset * 2.4, bottom: -ringOffset * 2.4,
          borderRadius: (ringSize + ringOffset * 2.4) / 2,
          backgroundColor: color, opacity: 0.16,
        },
        ring,
      ]}
    />
  ) : null;

  // Gradient ring — replaces the flat border with a richer two-tone arc.
  const gradientRing = (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -ringOffset, top: -ringOffset, right: -ringOffset, bottom: -ringOffset,
        borderRadius: ringSize / 2, overflow: 'hidden',
        padding: 1.5,
      }}
    >
      <LinearGradient
        colors={[alpha(color, 'ff'), alpha(color, '55'), alpha(color, 'cc')]}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ flex: 1, borderRadius: ringSize / 2 }}
      />
      {/* Inner cutout — fills the center with bg so ring looks like a stroke */}
      <View style={{ position: 'absolute', left: 1.5, top: 1.5, right: 1.5, bottom: 1.5, borderRadius: (ringSize - 3) / 2, backgroundColor: W.bg }} />
    </View>
  );

  if (image) {
    return (
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {halo}
        {breathe && gradientRing}
        <Image source={{ uri: image }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      </View>
    );
  }

  const heights = [0.4, 0.7, 1, 0.7, 0.4];
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {halo}
      {breathe && gradientRing}
      <View
        style={{
          width: size, height: size, borderRadius: size / 2,
          alignItems: 'center', justifyContent: 'center', flexDirection: 'row', overflow: 'hidden',
          shadowColor: color, shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 0 },
          backgroundColor: W.surface1,
        }}
      >
        <RadialGlow
          width={size} height={size} borderRadius={size / 2}
          cx={0.35} cy={0.3}
          style={{ position: 'absolute' }}
          stops={[
            { offset: 0, color, opacity: 0.45 },
            { offset: 0.75, color: W.surface1, opacity: 0.8 },
          ]}
        />
        {/* Top specular highlight on the orb */}
        <View pointerEvents="none" style={{ position: 'absolute', left: size * 0.18, top: size * 0.10, width: size * 0.35, height: size * 0.18, borderRadius: size * 0.18, backgroundColor: 'rgba(255,255,255,0.18)', transform: [{ rotate: '-20deg' }] }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          {heights.map((h, i) => (
            <View key={i} style={{ width: 2, height: h * (size * 0.4), backgroundColor: color, borderRadius: 1, opacity: 0.9 }} />
          ))}
        </View>
      </View>
    </View>
  );
}

interface WaveformProps {
  color: string;
  animate?: boolean;
  size?: number;
}

export function Waveform({ color, animate = false, size = 40 }: WaveformProps) {
  const heights = [0.4, 0.7, 1, 0.85, 0.5, 0.75];
  return (
    <View style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      {heights.map((h, i) => (
        <WaveBar key={i} color={color} height={size * h} animate={animate} delay={i * 100} />
      ))}
    </View>
  );
}

function WaveBar({ color, height, animate, delay }: { color: string; height: number; animate: boolean; delay: number }) {
  const wave = useWave(delay);
  return (
    <Animated.View
      style={[
        { width: 3, height, backgroundColor: color, borderRadius: 2, opacity: 0.8 },
        animate ? wave : undefined,
      ]}
    />
  );
}
