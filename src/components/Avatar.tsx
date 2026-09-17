// Avatar.tsx + Waveform — ported from system.jsx Avatar() and onboarding.jsx Waveform().
// Premium treatment: outer halo glow + gradient ring + inner radial light.

import React, { useId } from 'react';
import { Animated, Image, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';

import { useRingBreathe, useWave } from '../theme/animations';
import { ELEV, rgba, W } from '../theme/theme';
import { RadialGlow } from './RadialGlow';
import { Txt } from './Txt';

interface AvatarProps {
  name?: string;
  size?: number;
  color?: string;
  image?: string;
  /** Pulse a soft halo and draw the gradient ring (a companion that is live or pending). */
  breathe?: boolean;
  /** What fills an avatar without an image: the voice mark (companions) or
   *  the name's initials (custom characters, people). */
  glyph?: 'voice' | 'initials';
  /** Set when the avatar stands alone; otherwise it is decorative and hidden
   *  from VoiceOver because the name is shown beside it. */
  accessibilityLabel?: string;
}

// Accent tokens an avatar may take when nothing else picks its colour.
const AVATAR_TINTS = [W.coral, W.rose, W.violet, W.mentor, W.friend, W.partner, W.challenger, W.secondary] as const;

/** A stable accent for an id or name, so a character keeps its colour everywhere. */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_TINTS[Math.abs(h) % AVATAR_TINTS.length];
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return (first + last).toUpperCase();
}

const BARS = [0.4, 0.7, 1, 0.7, 0.4];
const RING_STROKE = 1.5;
const ABSOLUTE = { position: 'absolute' } as const;
const SPECULAR = rgba(W.text, 0.18);

export function Avatar({ name, size = 48, color = W.primary, image, breathe = true, glyph = 'voice', accessibilityLabel }: AvatarProps) {
  // The halo breathes 0.10 ↔ 0.22 and rests at 0.16 under Reduce Motion.
  const haloPulse = useRingBreathe(breathe, [0.1, 0.22]);
  const ringOffset = Math.max(4, size * 0.07);
  const ringSize = size + ringOffset * 2;
  const haloSize = size + ringOffset * 4.8;
  const gid = `av${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const };

  const initials = glyph === 'initials' && name ? initialsOf(name) : '';

  return (
    <View
      {...a11y}
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      {breathe ? (
        <>
          {/* Soft accent bloom that fades out past the ring. */}
          <Animated.View
            pointerEvents="none"
            style={[{ position: 'absolute', width: haloSize, height: haloSize }, haloPulse]}
          >
            <RadialGlow
              width={haloSize} height={haloSize}
              stops={[
                { offset: (size / haloSize) * 0.9, color, opacity: 1 },
                { offset: 1, color, opacity: 0 },
              ]}
            />
          </Animated.View>
          {/* A stroked circle: no background-coloured cutout, so it sits on any surface. */}
          <Svg pointerEvents="none" width={ringSize} height={ringSize} style={ABSOLUTE}>
            <Defs>
              <SvgLinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={color} stopOpacity={1} />
                <Stop offset="0.5" stopColor={color} stopOpacity={0.33} />
                <Stop offset="1" stopColor={color} stopOpacity={0.8} />
              </SvgLinearGradient>
            </Defs>
            <Circle
              cx={ringSize / 2} cy={ringSize / 2} r={(ringSize - RING_STROKE) / 2}
              stroke={`url(#${gid})`} strokeWidth={RING_STROKE} fill="none"
            />
          </Svg>
        </>
      ) : null}

      {image ? (
        <Image source={{ uri: image }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        // The glow sits on an unclipped, opaque wrapper so iOS can draw it;
        // the inner view clips the light and the highlight.
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: W.surface1, ...ELEV.glow(color, 18, 0.35) }}>
          <View
            style={{
              flex: 1, borderRadius: size / 2, overflow: 'hidden',
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
            }}
          >
            <RadialGlow
              width={size} height={size} borderRadius={size / 2}
              cx={0.35} cy={0.3}
              style={ABSOLUTE}
              stops={[
                { offset: 0, color, opacity: 0.45 },
                { offset: 0.75, color: W.surface1, opacity: 0.8 },
              ]}
            />
            {/* Top specular highlight on the orb */}
            <View pointerEvents="none" style={{ position: 'absolute', left: size * 0.18, top: size * 0.10, width: size * 0.35, height: size * 0.18, borderRadius: size * 0.18, backgroundColor: SPECULAR, transform: [{ rotate: '-20deg' }] }} />
            {initials ? (
              <Txt
                font="display" weight={600} maxScale={1}
                style={{ fontSize: Math.max(11, Math.round(size * 0.36)), lineHeight: Math.round(size * 0.46), color, letterSpacing: 0.3 }}
              >
                {initials}
              </Txt>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                {BARS.map((h, i) => (
                  <View key={i} style={{ width: 2, height: h * (size * 0.4), backgroundColor: color, borderRadius: 1, opacity: 0.9 }} />
                ))}
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

interface WaveformProps {
  color: string;
  animate?: boolean;
  size?: number;
}

const WAVE = [0.4, 0.7, 1, 0.85, 0.5, 0.75];

export function Waveform({ color, animate = false, size = 40 }: WaveformProps) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 }}
    >
      {WAVE.map((h, i) => (
        <WaveBar key={i} color={color} height={size * h} animate={animate} delay={i * 100} />
      ))}
    </View>
  );
}

function WaveBar({ color, height, animate, delay }: { color: string; height: number; animate: boolean; delay: number }) {
  // Idle bars don't run a loop at all.
  const wave = useWave(delay, animate);
  return (
    <Animated.View
      style={[
        { width: 3, height, backgroundColor: color, borderRadius: 2, opacity: 0.8 },
        animate ? wave : undefined,
      ]}
    />
  );
}
