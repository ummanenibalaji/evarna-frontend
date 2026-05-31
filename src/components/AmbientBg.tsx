// AmbientBg.tsx — extremely subtle ambient atmosphere. Two slow-drifting
// orbs at very low opacity over a deep obsidian backdrop. The point is to add
// *depth*, not decoration — the eye should barely register the movement.

import React, { useEffect, useRef } from 'react';
import { View, Animated, Easing, StyleSheet, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { RadialGlow } from './RadialGlow';
import { W } from '../theme/theme';

interface AmbientBgProps {
  intensity?: number;
  includePulse?: boolean;
}

function useDrift(
  duration: number,
  keyframes: { x: number[]; y: number[]; scale: number[] }
) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
    );
    anim.start();
    return () => anim.stop();
  }, [duration]);
  const translateX = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: keyframes.x });
  const translateY = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: keyframes.y });
  const scale = v.interpolate({ inputRange: [0, 0.5, 1], outputRange: keyframes.scale });
  return { transform: [{ translateX }, { translateY }, { scale }] };
}

export function AmbientBg({ intensity = 1, includePulse = false }: AmbientBgProps) {
  const { width, height } = Dimensions.get('window');

  const drift1 = useDrift(48000, {
    x: [-width * 0.2, width * 0.15, -width * 0.2],
    y: [height * 0.15, -height * 0.1, height * 0.15],
    scale: [1, 1.08, 1],
  });
  const drift2 = useDrift(56000, {
    x: [width * 0.2, -width * 0.18, width * 0.2],
    y: [-height * 0.18, height * 0.18, -height * 0.18],
    scale: [1, 1.12, 1],
  });

  // Gentle center pulse — only when explicitly requested (splash, meet, etc)
  const pulseV = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!includePulse) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseV, { toValue: 1, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulseV, { toValue: 0, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [includePulse]);
  const pulseScale = pulseV.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const pulseOpacity = pulseV.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.9] });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
      {/* Base graduated darkness — very subtle vertical gradient adds depth */}
      <LinearGradient
        colors={[W.bg, W.bgSoft, W.bg]}
        start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      {/* Purple atmosphere — much fainter than before */}
      <Animated.View style={[{ position: 'absolute', left: -width * 0.25, bottom: -height * 0.2 }, drift1]}>
        <RadialGlow
          width={520} height={520}
          stops={[
            { offset: 0, color: W.primary, opacity: 0.10 * intensity },
            { offset: 0.55, color: W.primary, opacity: 0.02 * intensity },
            { offset: 1, color: W.primary, opacity: 0 },
          ]}
        />
      </Animated.View>

      {/* Teal atmosphere */}
      <Animated.View style={[{ position: 'absolute', right: -width * 0.2, top: -height * 0.15 }, drift2]}>
        <RadialGlow
          width={420} height={420}
          stops={[
            { offset: 0, color: W.accent, opacity: 0.05 * intensity },
            { offset: 0.6, color: W.accent, opacity: 0 },
          ]}
        />
      </Animated.View>

      {includePulse && (
        <Animated.View
          style={{
            position: 'absolute', left: width / 2 - 280, top: height * 0.4 - 280,
            transform: [{ scale: pulseScale }], opacity: pulseOpacity,
          }}
        >
          <RadialGlow
            width={560} height={560}
            stops={[
              { offset: 0, color: W.secondary, opacity: 0.06 * intensity },
              { offset: 0.6, color: W.secondary, opacity: 0 },
            ]}
          />
        </Animated.View>
      )}

      {/* Vignette — gently darkens the edges for that "premium HDR" feel */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)']}
        start={{ x: 0.5, y: 0.4 }} end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}
