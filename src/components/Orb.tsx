// Orb.tsx — the glowing product identity.
// Ported from system.jsx Orb(). CSS radial-gradient layers -> SVG RadialGlow;
// orbBreathe -> useBreathe; ember particles -> Animated particles; thinking
// orbit dots -> rotating ring. blur() filters are approximated by soft SVG
// gradients (RN has no per-view blur on arbitrary content).

import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { RadialGlow } from './RadialGlow';
import { useBreathe, useSpin } from '../theme/animations';
import { W, withAlphaByte, alpha } from '../theme/theme';

export type OrbState = 'idle' | 'listening' | 'speaking' | 'thinking' | 'memory';

interface OrbProps {
  state?: OrbState;
  size?: number;
  accent?: string;
  intensity?: number;
}

interface Ember { id: number; dx: number; }

export function Orb({ state = 'idle', size = 180, accent = W.primary, intensity = 1 }: OrbProps) {
  const tint = state === 'listening' || state === 'memory' ? W.accent : accent;
  const isSpeaking = state === 'speaking';
  const isThinking = state === 'thinking';
  const isListening = state === 'listening';

  const breatheFast = useBreathe(isSpeaking ? 1300 : 4200);
  const spin = useSpin(2400);

  const scaleMul = isSpeaking ? 1.12 : isListening ? 0.92 : isThinking ? 0.85 : 1;
  const containerScale = useRef(new Animated.Value(scaleMul)).current;
  useEffect(() => {
    Animated.timing(containerScale, {
      toValue: scaleMul, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: true,
    }).start();
  }, [scaleMul]);

  // Ember particles while speaking
  const [embers, setEmbers] = useState<Ember[]>([]);
  useEffect(() => {
    if (!isSpeaking) { setEmbers([]); return; }
    let alive = true;
    let n = 0;
    const tick = () => {
      if (!alive) return;
      setEmbers(es => [...es.slice(-8), { id: n++, dx: (Math.random() - 0.5) * 60 }]);
      setTimeout(tick, 280 + Math.random() * 200);
    };
    tick();
    return () => { alive = false; };
  }, [isSpeaking]);

  const container = size * 2;

  return (
    <Animated.View
      style={{
        width: container, height: container, alignItems: 'center', justifyContent: 'center',
        transform: [{ scale: containerScale }],
      }}
    >
      {/* widest halo bloom */}
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, breatheFast]}>
        <RadialGlow
          width={container} height={container}
          stops={[
            { offset: 0, color: tint, opacity: 0.31 * intensity },
            { offset: 0.55, color: tint, opacity: 0 },
          ]}
        />
      </Animated.View>

      {/* outer glow ring */}
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, breatheFast]}>
        <RadialGlow
          width={size * 1.4} height={size * 1.4} borderRadius={size * 0.7}
          stops={[
            { offset: 0, color: tint, opacity: 0.25 },
            { offset: 0.5, color: tint, opacity: 0.06 },
            { offset: 0.75, color: tint, opacity: 0 },
          ]}
        />
      </Animated.View>

      {/* mid layer */}
      <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, breatheFast]}>
        <RadialGlow
          width={size * 1.15} height={size * 1.15} borderRadius={size * 0.575}
          cx={0.45} cy={0.4}
          stops={[
            { offset: 0, color: '#ffffff', opacity: isSpeaking ? 0.87 : 0.67 },
            { offset: 0.28, color: W.secondary, opacity: 0.73 },
            { offset: 0.6, color: tint, opacity: 0.33 },
            { offset: 0.85, color: tint, opacity: 0 },
          ]}
        />
      </Animated.View>

      {/* core */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { alignItems: 'center', justifyContent: 'center' },
          breatheFast,
          { opacity: isThinking ? 0.6 : breatheFast.opacity },
        ]}
      >
        <View
          style={{
            shadowColor: tint,
            shadowOpacity: isSpeaking ? 0.8 : 0.4,
            shadowRadius: isSpeaking ? 40 : 20,
            shadowOffset: { width: 0, height: 0 },
          }}
        >
          <RadialGlow
            width={size * 0.62} height={size * 0.62} borderRadius={size * 0.31}
            cx={0.38} cy={0.32}
            stops={[
              { offset: 0, color: '#ffffff', opacity: 1 },
              { offset: 0.32, color: W.secondary, opacity: 1 },
              { offset: 0.72, color: tint, opacity: 1 },
              { offset: 1, color: tint, opacity: 0 },
            ]}
          />
        </View>
      </Animated.View>

      {/* thinking dots orbit */}
      {isThinking && (
        <Animated.View
          style={[
            { position: 'absolute', width: size * 1.5, height: size * 1.5 },
            spin,
          ]}
        >
          {[0, 120, 240].map(d => {
            const rad = (d * Math.PI) / 180;
            const r = size * 0.75;
            const cx = size * 0.75 + Math.sin(rad) * r - 3.5;
            const cy = size * 0.75 - Math.cos(rad) * r - 3.5;
            return (
              <View
                key={d}
                style={{
                  position: 'absolute', left: cx, top: cy,
                  width: 7, height: 7, borderRadius: 3.5, backgroundColor: W.secondary,
                  shadowColor: W.secondary, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
                }}
              />
            );
          })}
        </Animated.View>
      )}

      {/* memory teal ripple */}
      {state === 'memory' && <MemoryRipple size={size} />}

      {/* speaking ember particles */}
      {isSpeaking && embers.map(e => <EmberParticle key={e.id} dx={e.dx} tint={tint} />)}
    </Animated.View>
  );
}

function MemoryRipple({ size }: { size: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, []);
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.8] });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] });
  return (
    <Animated.View
      style={{
        position: 'absolute', width: size, height: size, borderRadius: size / 2,
        borderWidth: 2, borderColor: W.accent,
        shadowColor: W.accent, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 0 },
        transform: [{ scale }], opacity,
      }}
    />
  );
}

function EmberParticle({ dx, tint }: { dx: number; tint: string }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, []);
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, -50] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  const opacity = v.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 0.8, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: 4, height: 4, borderRadius: 2, backgroundColor: '#fff',
        shadowColor: tint, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
        transform: [{ translateX }, { translateY }, { scale }], opacity,
      }}
    />
  );
}
