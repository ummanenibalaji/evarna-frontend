// Atoms.tsx — Pill, PrimaryButton, Card, GlassPill, Toggle, ProgressDots,
// StatusPill, MemoryBadge, MemoryRef, Sparkles. Ported from system.jsx.
// backdrop-filter: blur() -> expo-blur BlurView wrappers.

import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, Easing, StyleProp, ViewStyle, TextStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from './Txt';
import { NavIcon } from './NavIcon';
import { W, GRAD, alpha, rgba } from '../theme/theme';

// ─── Pill ───────────────────────────────────────────────────────────────
interface PillProps {
  children: React.ReactNode;
  active?: boolean;
  accent?: string;
  color?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}
export function Pill({ children, active, accent, color, onPress, style, textStyle }: PillProps) {
  const ac = accent || W.primary;
  const press = useRef(new Animated.Value(0)).current;
  const onPressIn = () => Animated.spring(press, { toValue: 1, useNativeDriver: true, tension: 200, friction: 14 }).start();
  const onPressOut = () => Animated.spring(press, { toValue: 0, useNativeDriver: true, tension: 200, friction: 12 }).start();
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.965] });
  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPress ? onPressIn : undefined}
        onPressOut={onPress ? onPressOut : undefined}
        android_ripple={{ color: alpha(ac, '22') }}
        style={{
          height: 46, paddingHorizontal: 20, borderRadius: 23, width: '100%',
          alignItems: 'center', justifyContent: 'center',
          backgroundColor: active ? ac : 'rgba(30,21,25,0.55)',
          borderWidth: 1,
          borderColor: active ? ac : 'rgba(255,255,255,0.07)',
          overflow: 'hidden',
          shadowColor: active ? ac : '#000',
          shadowOpacity: active ? 0.45 : 0.2,
          shadowRadius: active ? 18 : 12,
          shadowOffset: { width: 0, height: active ? 8 : 4 },
        }}
      >
        {!active ? (
          <BlurView pointerEvents="none" intensity={30} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        ) : null}
        {active ? (
          <LinearGradient
            pointerEvents="none"
            // An accent-tinted pill keeps its own color; the default active
            // pill gets the aurora.
            colors={accent ? [alpha(ac, 'FF'), alpha(ac, 'FF')] : [...GRAD.aurora]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
        ) : null}
        {/* Top specular highlight on active state */}
        {active ? (
          <View pointerEvents="none" style={{
            position: 'absolute', left: 1, top: 1, right: 1, height: 18,
            borderTopLeftRadius: 22, borderTopRightRadius: 22,
            backgroundColor: 'rgba(255,255,255,0.18)',
          }} />
        ) : null}
        <Txt font="user" weight={active ? 600 : 500} style={[{ fontSize: 14, color: active ? '#fff' : color || W.text, letterSpacing: 0.2 }, textStyle]}>
          {children}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

// ─── PrimaryButton ──────────────────────────────────────────────────────
// Refined: softer gradient, optional trailing chevron, deep tonal shadow,
// inner specular for that "premium product" finish.
type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';
interface PrimaryButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: ButtonVariant;
  /** Show a subtle trailing arrow indicator (primary variant only) */
  trailingArrow?: boolean;
}
export function PrimaryButton({ children, onPress, disabled, style, variant = 'primary', trailingArrow = false }: PrimaryButtonProps) {
  const press = useRef(new Animated.Value(0)).current;
  const onPressIn  = () => Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 0 }).start();
  const onPressOut = () => Animated.spring(press, { toValue: 0, useNativeDriver: true, speed: 28, bounciness: 6 }).start();
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] });

  // Softer, more refined gradient stops (less neon, more material)
  // Primary is the aurora itself — coral → rose → violet on the diagonal.
  const palette: Record<ButtonVariant, { bg: string; grad: readonly string[]; color: string; border?: string; shadow?: string }> = {
    primary:   { bg: W.primary, grad: GRAD.aurora, color: '#FFFFFF', shadow: W.rose },
    secondary: { bg: 'transparent', grad: ['transparent', 'transparent'], color: W.cream, border: 'rgba(255,255,255,0.10)' },
    text:      { bg: 'transparent', grad: ['transparent', 'transparent'], color: W.text2 },
    danger:    { bg: W.danger, grad: GRAD.danger, color: '#FFFFFF', shadow: W.danger },
  };
  const s = palette[variant];
  const isFilled = variant === 'primary' || variant === 'danger';
  const isGlass  = variant === 'secondary';

  return (
    <Animated.View style={[{ width: '100%', transform: [{ scale }] }, style]}>
      <Pressable
        onPress={disabled ? undefined : onPress}
        onPressIn={disabled ? undefined : onPressIn}
        onPressOut={disabled ? undefined : onPressOut}
        style={{
          height: 56,
          paddingHorizontal: 24,
          borderRadius: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: isGlass ? 'rgba(30,21,25,0.55)' : (isFilled ? s.bg : 'transparent'),
          borderWidth: s.border ? 1 : 0,
          borderColor: s.border,
          overflow: 'hidden',
          opacity: disabled ? 0.36 : 1,
          shadowColor: s.shadow || '#000',
          shadowOpacity: isFilled && !disabled ? 0.45 : (isGlass ? 0.25 : 0),
          shadowRadius: isFilled ? 24 : 12,
          shadowOffset: { width: 0, height: isFilled ? 12 : 4 },
          elevation: isFilled && !disabled ? 10 : (isGlass ? 4 : 0),
        }}
      >
        {/* Glass blur layer */}
        {isGlass ? (
          <BlurView pointerEvents="none" intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        ) : null}
        {/* Gradient fill */}
        {isFilled ? (
          <LinearGradient
            pointerEvents="none"
            colors={s.grad as unknown as readonly [string, string, ...string[]]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
        ) : null}
        {/* Top specular highlight — half-height arc */}
        {isFilled ? (
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.22)', 'rgba(255,255,255,0)']}
            style={{ position: 'absolute', left: 1, top: 1, right: 1, height: 28, borderTopLeftRadius: 17, borderTopRightRadius: 17 }}
          />
        ) : null}
        {/* Bottom inner shadow line */}
        {isFilled ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: 'rgba(0,0,0,0.20)' }} />
        ) : null}

        <Txt font="user" weight={600} style={{ fontSize: 15, color: s.color, letterSpacing: 0.4 }}>{children}</Txt>
        {trailingArrow && isFilled ? (
          <View style={{ marginLeft: 10, opacity: 0.9 }}>
            <NavIcon name="right" color={s.color} size={16} />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

// ─── Card (premium frosted glass) ───────────────────────────────────────
// Multi-layer composition:
//   1. Outer container with dark translucent fill + soft shadow
//   2. BlurView heavy frost
//   3. Linear gradient overlay (top brighter, bottom darker) — subtle depth
//   4. 1px white top highlight ("lit from above")
//   5. 1px inset bottom shadow ("settled in")
interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  border?: string | null;
  bg?: string;
  glass?: boolean;
  borderRadius?: number;
}
export function Card({ children, onPress, style, padding = 18, border, bg, glass = true, borderRadius = 20 }: CardProps) {
  const content = (
    <View
      style={[
        {
          borderRadius, padding,
          borderWidth: 1,
          borderColor: border || (glass ? 'rgba(255,255,255,0.06)' : 'transparent'),
          backgroundColor: glass ? bg || 'rgba(30,21,25,0.55)' : bg || W.surface1,
          overflow: 'hidden',
        },
        glass ? { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 28, shadowOffset: { width: 0, height: 12 } } : undefined,
        style,
      ]}
    >
      {/* Decorations sit absolutely behind children — pointerEvents none */}
      {glass && (
        <>
          <BlurView pointerEvents="none" intensity={40} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius }} />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(255,255,255,0.04)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.10)']}
            locations={[0, 0.5, 1]}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
        </>
      )}
      <View pointerEvents="none" style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: 1,
        backgroundColor: 'rgba(255,255,255,0.12)',
      }} />
      <View pointerEvents="none" style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, height: 1,
        backgroundColor: 'rgba(0,0,0,0.25)',
      }} />
      {/* Children render in the outer flex container — inherits flexDirection from style */}
      {children}
    </View>
  );
  if (onPress) return <Pressable onPress={onPress}>{content}</Pressable>;
  return content;
}

// ─── GlassPill ──────────────────────────────────────────────────────────
export function GlassPill({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
          paddingVertical: 10, paddingHorizontal: 14,
          flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden',
          backgroundColor: 'rgba(32,22,26,0.5)',
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 32, shadowOffset: { width: 0, height: 8 },
        },
        style,
      ]}
    >
      <BlurView intensity={32} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      {children}
    </View>
  );
}

// ─── Toggle ─────────────────────────────────────────────────────────────
// Springy iOS-style switch with a glow when on. Thumb scales briefly on press.
// Two animated values:
//  - vNative drives transform (translateX + scale) → native driver, 60fps
//  - vColor drives backgroundColor + opacity        → JS driver
export function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const vNative = useRef(new Animated.Value(value ? 1 : 0)).current;
  const vColor  = useRef(new Animated.Value(value ? 1 : 0)).current;
  const press   = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.spring(vNative, { toValue: value ? 1 : 0, useNativeDriver: true,  tension: 110, friction: 16 }),
      Animated.timing(vColor,  { toValue: value ? 1 : 0, duration: 220, easing: Easing.out(Easing.ease), useNativeDriver: false }),
    ]).start();
  }, [value]);
  const translateX = vNative.interpolate({ inputRange: [0, 1], outputRange: [0, 18] });
  // Track fades to rose; the aurora gradient overlay on top supplies the coral
  // end, so the "on" state reads as the same warm ramp as every other CTA.
  const bg          = vColor.interpolate({ inputRange: [0, 1], outputRange: [W.surface2, W.rose] });
  const gradOpacity = vColor;
  const glowOpacity = vColor.interpolate({ inputRange: [0, 1], outputRange: [0, 0.45] });
  const thumbScale  = press.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  return (
    <Pressable
      onPress={() => onChange(!value)}
      onPressIn={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, tension: 200, friction: 12 }).start()}
      onPressOut={() => Animated.spring(press, { toValue: 0, useNativeDriver: true, tension: 200, friction: 12 }).start()}
      hitSlop={6}
    >
      <View style={{ width: 46, height: 28 }}>
        {/* glow halo — color/opacity driven by vColor (JS driver) */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', left: -4, top: -4, right: -4, bottom: -4, borderRadius: 18,
            backgroundColor: W.rose, opacity: glowOpacity,
          }}
        />
        {/* track — backgroundColor needs JS driver */}
        <Animated.View style={{ width: 46, height: 28, borderRadius: 14, backgroundColor: bg, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: gradOpacity }}>
            <LinearGradient
              colors={[...GRAD.auroraShort]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ flex: 1 }}
            />
          </Animated.View>
        </Animated.View>
        {/* thumb — transform only, native driver compatible */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 2.5, left: 2.5, width: 23, height: 23, borderRadius: 12,
            backgroundColor: '#fff',
            shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
            transform: [{ translateX }, { scale: thumbScale }],
          }}
        />
      </View>
    </Pressable>
  );
}

// ─── ProgressDots ───────────────────────────────────────────────────────
export function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <View key={i} style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: i < current ? W.primary : W.surface2 }} />
      ))}
    </View>
  );
}

// ─── StatusPill ─────────────────────────────────────────────────────────
export function StatusPill({ children, accent = W.text2, bg = W.surface1 }: { children: React.ReactNode; accent?: string; bg?: string }) {
  return (
    <View style={{ height: 28, paddingHorizontal: 12, backgroundColor: bg, borderRadius: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Txt font="user" weight={500} style={{ fontSize: 12, color: accent }}>{children}</Txt>
    </View>
  );
}

// ─── MemoryBadge ────────────────────────────────────────────────────────
export function MemoryBadge({ show, text = 'Memory saved · tap to view' }: { show: boolean; text?: string }) {
  const v = useRef(new Animated.Value(show ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: show ? 1 : 0, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [show]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return (
    <Animated.View
      style={{
        backgroundColor: rgba(W.gold, 0.10),
        borderWidth: 1, borderColor: rgba(W.gold, 0.25),
        borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12,
        flexDirection: 'row', alignItems: 'center', gap: 6, opacity: v, transform: [{ translateY }],
      }}
    >
      <NavIcon name="check" color={W.gold} size={13} />
      <Txt font="user" weight={500} style={{ fontSize: 11.5, color: W.gold }}>{text}</Txt>
    </Animated.View>
  );
}

// ─── Sparkles ───────────────────────────────────────────────────────────
export function Sparkles({ count = 4 }: { count?: number }) {
  return (
    <View style={{ position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 }} pointerEvents="none">
      {Array.from({ length: count }).map((_, i) => {
        const dx = Math.cos(i * 1.4) * 18;
        const dy = Math.sin(i * 1.4) * 14 - 6;
        return <Sparkle key={i} dx={dx} dy={dy} delay={i * 70} />;
      })}
    </View>
  );
}
function Sparkle({ dx, dy, delay }: { dx: number; dy: number; delay: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(v, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    }, delay);
    return () => clearTimeout(t);
  }, []);
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [0, dx] });
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [0, dy] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });
  const opacity = v.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 0] });
  return (
    <Animated.View
      style={{
        position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: W.accent,
        shadowColor: W.accent, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
        transform: [{ translateX }, { translateY }, { scale }], opacity,
      }}
    />
  );
}

// ─── MemoryRef ──────────────────────────────────────────────────────────
export function MemoryRef({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  return (
    <Txt
      font="user" weight={500}
      onPress={onPress}
      style={{ color: W.accent, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: 'rgba(255,201,96,0.4)' }}
    >
      {children}
    </Txt>
  );
}

// ─── MinuteWarningBanner ─────────────────────────────────────────────────
// Ported from extras.jsx; used by the voice call + depleted flows. Lives here
// (shared) so both Chat and Extras screens can import without a cycle.
export function MinuteWarningBanner({ minutes, onUpgrade }: { minutes: number | null; onUpgrade?: () => void }) {
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 1000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, []);
  if (minutes == null) return null;

  let dotColor: string = W.accent;
  let urgency: 'low' | 'mid' | 'high' = 'low';
  if (minutes <= 5) { dotColor = W.secondary; urgency = 'mid'; }
  if (minutes <= 1) { dotColor = W.challenger; urgency = 'high'; }

  const dotScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });

  return (
    <View
      style={{
        marginHorizontal: 16, marginTop: 8,
        borderRadius: 12, paddingVertical: 8, paddingHorizontal: 14,
        flexDirection: 'row', alignItems: 'center', gap: 10, overflow: 'hidden',
        borderWidth: 1,
        borderColor: urgency === 'high' ? alpha(W.challenger, '26') : 'rgba(255,138,118,0.10)',
        backgroundColor: 'rgba(32,22,26,0.6)',
      }}
    >
      <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <Animated.View
        style={{
          width: 8, height: 8, borderRadius: 4, backgroundColor: dotColor,
          transform: [{ scale: dotScale }],
          shadowColor: dotColor, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
        }}
      />
      <Txt font="user" style={{ flex: 1, fontSize: 12, color: W.text2 }}>
        {minutes} {minutes === 1 ? 'minute' : 'minutes'} remaining{urgency === 'high' ? '. See plans to keep talking.' : ' this month'}
      </Txt>
      {urgency === 'high' && (
        <Pressable onPress={onUpgrade}>
          <Txt font="user" weight={500} style={{ fontSize: 12, color: W.accent }}>See plans</Txt>
        </Pressable>
      )}
    </View>
  );
}

// ═══ Ember Dusk atoms ═══════════════════════════════════════════════════

// ─── AuroraLine ─────────────────────────────────────────────────────────
// The 1–1.5px gradient hairline that sits on the top edge of a "live" card
// (tonight's check-in, chat header). Fades out at both ends so it reads as
// light catching an edge rather than a border.
export function AuroraLine({ height = 1.5, style }: { height?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient
      pointerEvents="none"
      colors={[...GRAD.auroraLine]}
      locations={[0, 0.3, 0.55, 0.85, 1]}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      style={[{ position: 'absolute', left: 0, right: 0, top: 0, height }, style]}
    />
  );
}

// ─── SectionLabel ───────────────────────────────────────────────────────
// Settings-style group heading: colored dot, uppercase label, hairline rule
// running to the right edge.
export function SectionLabel({ children, dot = W.primary, rule = true }: { children: React.ReactNode; dot?: string; rule?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingBottom: 9 }}>
      <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dot, opacity: 0.8 }} />
      <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 1.4, textTransform: 'uppercase' }}>
        {children}
      </Txt>
      {rule && <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />}
    </View>
  );
}

// ─── StreakPill ─────────────────────────────────────────────────────────
// Gold flame + day count, with a specular sweep crossing it every few
// seconds. The sweep is what makes the streak feel *alive* — it's the one
// piece of chrome allowed to move on the home header.
export function StreakPill({ days, onPress }: { days: number; onPress?: () => void }) {
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(3100),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);
  const translateX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-70, 90] });

  return (
    <Pressable onPress={onPress} hitSlop={6}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingVertical: 7, paddingHorizontal: 12, borderRadius: 18,
        backgroundColor: rgba(W.gold, 0.10),
        borderWidth: 1, borderColor: rgba(W.gold, 0.28),
        overflow: 'hidden',
      }}>
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', top: 0, bottom: 0, width: 26,
            backgroundColor: 'rgba(255,255,255,0.14)',
            transform: [{ translateX }, { skewX: '-20deg' }],
          }}
        />
        <NavIcon name="flame-solid" color={W.gold} size={14} />
        <Txt font="display" weight={700} style={{ fontSize: 13, color: W.gold }}>{days}</Txt>
      </View>
    </Pressable>
  );
}

// ─── MemoryChip ─────────────────────────────────────────────────────────
// Gold-on-dark inline chip. Used for "Memory saved · tap to view" in chat
// and for memory counts elsewhere. Gold is reserved for memory + streaks.
export function MemoryChip({ children, icon = 'check', onPress }: { children: React.ReactNode; icon?: 'check' | 'sparkle-solid'; onPress?: () => void }) {
  const body = (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingVertical: 6, paddingHorizontal: 12, borderRadius: 14,
      backgroundColor: rgba(W.gold, 0.10),
      borderWidth: 1, borderColor: rgba(W.gold, 0.25),
    }}>
      <NavIcon name={icon} color={W.gold} size={13} />
      <Txt font="user" weight={500} style={{ fontSize: 11.5, color: W.gold }}>{children}</Txt>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{body}</Pressable> : body;
}

// ─── QuickReply ─────────────────────────────────────────────────────────
// Coral-outlined suggestion chip above the composer.
export function QuickReply({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 8, paddingHorizontal: 14, borderRadius: 17,
        backgroundColor: rgba(W.primary, 0.08),
        borderWidth: 1, borderColor: rgba(W.primary, 0.28),
      }}
    >
      <Txt font="user" weight={500} style={{ fontSize: 12.5, color: W.primarySoft }} numberOfLines={1}>
        {children}
      </Txt>
    </Pressable>
  );
}

// ─── MeterBar ───────────────────────────────────────────────────────────
// Thin aurora-filled progress track — voice minutes, usage caps.
export function MeterBar({ pct, height = 6 }: { pct: number; height?: number }) {
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
      <LinearGradient
        colors={[...GRAD.aurora]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ height: '100%', width: `${clamped * 100}%`, borderRadius: height / 2 }}
      />
    </View>
  );
}
