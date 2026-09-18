// Atoms.tsx — the shared controls and surfaces: buttons, pills, cards,
// switches, status atoms and the loading / empty / error states.
// Ported from system.jsx; backdrop-filter: blur() → expo-blur via GlassFill.
//
// Depth: iOS drops the shadow of a layer that clips its own bounds, so every
// atom with a shadow puts it on an unclipped outer view (opaque, so UIKit can
// use a shadow path) and clips the blur and gradients on an inner view.
// Translucent glass gets no shadow: it would be re-rendered per pixel on
// every frame the backdrop moves, and black on near-black doesn't read.

import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type Insets,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  makeMutable,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

import { announce, useReduceTransparency } from '../hooks/useAccessibilityPrefs';
import { haptic, type HapticKind } from '../lib/haptics';
import { ease, enter, exit, spring, timing, useAppActive, useBreath, usePressFeedback, useReducedMotion } from '../theme/motion';
import { ELEV, GRAD, HIT, MOTION, R, rgba, SP, W } from '../theme/theme';
import { NavIcon, type IconName } from './NavIcon';
import { RadialGlow } from './RadialGlow';
import { Txt } from './Txt';

const D = MOTION.duration;
const FILL = StyleSheet.absoluteFillObject;

/** hitSlop that grows a `width` × `height` target to at least 44 × 44pt. */
export function minTarget(width: number, height: number = width): Insets {
  const x = Math.max(0, Math.ceil((HIT - width) / 2));
  const y = Math.max(0, Math.ceil((HIT - height) / 2));
  return { top: y, bottom: y, left: x, right: x };
}

// Cross-fades are the calm alternative to movement, so they play under
// Reduce Motion too.
const fade = (ms: number): WithTimingConfig => ({ ...timing(ms), reduceMotion: ReduceMotion.Never });

// The enter/exit getters build a new animation on every read; read one per mount.
const useOnMount = <T,>(read: () => T): T => useState(read)[0];

// Keys that place a component among its siblings go on the outer (shadow,
// press-scale) view; everything else styles the inner, clipped surface.
const OUTER_KEYS = new Set<string>([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'marginStart', 'marginEnd', 'position', 'top', 'bottom', 'left', 'right', 'start', 'end', 'zIndex',
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'minWidth', 'maxWidth', 'opacity',
]);

function splitStyle(style: StyleProp<ViewStyle>): { outer: ViewStyle; inner: ViewStyle } {
  const outer: Record<string, unknown> = {};
  const inner: Record<string, unknown> = {};
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(flat)) (OUTER_KEYS.has(key) ? outer : inner)[key] = flat[key];
  return { outer: outer as ViewStyle, inner: inner as ViewStyle };
}

// Warm-white light for glossy highlights, fading out downwards or at both ends.
const SPECULAR = [rgba(W.text, 0.22), rgba(W.text, 0)] as const;
const EDGE_LIGHT = [rgba(W.text, 0), rgba(W.text, 0.12), rgba(W.text, 0)] as const;
const CARD_SHADE = [rgba(W.text, 0.04), rgba(W.text, 0), rgba(W.shadow, 0.1)] as const;
const DIAGONAL = { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } } as const;
const ACROSS = { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } as const;

// ─── GlassFill ──────────────────────────────────────────────────────────
/** The frosted backdrop of a glass surface: a live blur, or an opaque fill
 *  when the user has turned on Reduce Transparency. Fills its clipping parent. */
export function GlassFill({ intensity = 30, solid = W.surface2, style }: { intensity?: number; solid?: string; style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceTransparency();
  if (reduce) return <View pointerEvents="none" style={[FILL, { backgroundColor: solid }, style]} />;
  return <BlurView pointerEvents="none" intensity={intensity} tint="dark" style={[FILL, style]} />;
}

// ─── IconButton ─────────────────────────────────────────────────────────
type IconButtonVariant = 'plain' | 'glass' | 'tinted' | 'danger';

interface IconButtonProps {
  icon: IconName;
  /** Spoken name. Required: the button has no visible text. */
  label: string;
  onPress: () => void;
  /** Visual diameter (default 40). The touch target is always at least 44pt. */
  size?: number;
  iconSize?: number;
  /** Glyph colour, a hex token. */
  tint?: string;
  variant?: IconButtonVariant;
  disabled?: boolean;
  selected?: boolean;
  haptic?: HapticKind | false;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function iconSurface(variant: IconButtonVariant, color: string, selected: boolean) {
  switch (variant) {
    case 'plain':
      return { backgroundColor: selected ? rgba(color, 0.14) : 'transparent', borderColor: undefined };
    case 'glass':
      return selected
        ? { backgroundColor: rgba(color, 0.18), borderColor: rgba(color, 0.35) }
        : { backgroundColor: W.glass, borderColor: W.hairline };
    case 'tinted':
      return { backgroundColor: rgba(color, selected ? 0.28 : 0.14), borderColor: rgba(color, 0.24) };
    case 'danger':
      return { backgroundColor: W.dangerStrong, borderColor: undefined };
  }
}

export function IconButton({
  icon, label, onPress, size = 40, iconSize = 22, tint, variant = 'plain',
  disabled = false, selected, haptic: hapticKind, accessibilityHint, style, testID,
}: IconButtonProps) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall, haptic: hapticKind });
  const color = tint ?? (variant === 'tinted' ? W.primary : W.text);
  const surface = iconSurface(variant, variant === 'danger' ? W.danger : color, !!selected);
  const round = size / 2;

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: round },
        variant === 'danger' && !disabled ? { backgroundColor: W.dangerStrong, ...ELEV.glow(W.danger, 16, 0.4) } : null,
        disabled ? styles.disabled : null,
        style,
        press.animatedStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={disabled}
        hitSlop={minTarget(size)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled, selected }}
        testID={testID}
        style={({ pressed }) => [
          {
            flex: 1, borderRadius: round, alignItems: 'center', justifyContent: 'center',
            overflow: variant === 'glass' ? 'hidden' : 'visible',
            backgroundColor: surface.backgroundColor,
            borderWidth: surface.borderColor ? 1 : 0,
            borderColor: surface.borderColor,
          },
          pressed ? styles.pressed : null,
        ]}
      >
        {variant === 'glass' ? <GlassFill intensity={30} /> : null}
        <NavIcon name={icon} color={color} size={iconSize} />
      </Pressable>
    </Animated.View>
  );
}

// ─── BackButton ─────────────────────────────────────────────────────────
const BACK_LABEL = { back: 'Back', down: 'Close', close: 'Close' } as const;

/** The top-bar back / dismiss control. A full 44pt target, pulled left so the
 *  glyph lines up with the screen gutter. Navigation gets no haptic, as in iOS. */
export function BackButton({ onPress, label, icon = 'back', style }: {
  onPress: () => void;
  label?: string;
  icon?: 'back' | 'down' | 'close';
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <IconButton
      icon={icon} label={label ?? BACK_LABEL[icon]} onPress={onPress}
      size={HIT} iconSize={24} haptic={false}
      style={[styles.backButton, style]}
    />
  );
}

// ─── Pill ───────────────────────────────────────────────────────────────
type PillSize = 'sm' | 'md';
const PILL_HEIGHT: Record<PillSize, number> = { sm: 36, md: 46 };

interface PillProps {
  children: React.ReactNode;
  active?: boolean;
  /** Alias of `active`. */
  selected?: boolean;
  accent?: string;
  color?: string;
  onPress?: () => void;
  /** 'sm' 36pt or 'md' 46pt (default); a `height` in `style` wins. Text can
   *  still grow the pill, and the touch target stays at least 44pt. */
  size?: PillSize;
  disabled?: boolean;
  /** A pill given `active`/`selected` is a radio in a single-choice group;
   *  otherwise a button. Wrap a group in a view with accessibilityRole="radiogroup". */
  accessibilityRole?: 'radio' | 'checkbox' | 'button';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

export function Pill({
  children, active, selected, accent, color, onPress, size = 'md', disabled = false,
  accessibilityRole, accessibilityLabel, accessibilityHint, style, textStyle,
}: PillProps) {
  const on = !!(selected ?? active);
  const role = accessibilityRole ?? (selected !== undefined || active !== undefined ? 'radio' : 'button');
  const ac = accent || W.primary;
  const press = usePressFeedback({ haptic: false });
  const { outer, inner: { height: styleHeight, ...inner } } = splitStyle(style);
  const height = typeof styleHeight === 'number' ? styleHeight : PILL_HEIGHT[size];

  const handlePress = () => {
    // Re-picking the current choice changes nothing, so it doesn't tick.
    if (role !== 'radio' || !on) haptic.selection();
    onPress?.();
  };

  return (
    <Animated.View
      style={[
        { borderRadius: R.pill },
        on ? { backgroundColor: ac, ...ELEV.glow(ac, 18, 0.4), shadowOffset: { width: 0, height: 6 } } : null,
        disabled ? styles.disabled : null,
        outer,
        press.animatedStyle,
      ]}
    >
      <Pressable
        onPress={onPress ? handlePress : undefined}
        onPressIn={onPress ? press.onPressIn : undefined}
        onPressOut={onPress ? press.onPressOut : undefined}
        disabled={disabled}
        hitSlop={minTarget(HIT, height)}
        accessibilityRole={role}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{
          disabled,
          selected: role === 'radio' ? on : undefined,
          checked: role === 'checkbox' ? on : undefined,
        }}
        android_ripple={{ color: rgba(ac, 0.13) }}
        style={[
          {
            flexGrow: 1, minHeight: height, borderRadius: R.pill, overflow: 'hidden',
            paddingHorizontal: size === 'sm' ? SP.base : SP.lg, paddingVertical: SP.xs2,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: on ? ac : W.glass,
            borderWidth: 1, borderColor: on ? ac : W.hairline,
          },
          inner,
        ]}
      >
        {on && !accent ? <LinearGradient pointerEvents="none" colors={GRAD.aurora} {...DIAGONAL} style={FILL} /> : null}
        {on ? <LinearGradient pointerEvents="none" colors={SPECULAR} style={[styles.specular, { height: height / 2 }]} /> : null}
        <Txt
          variant={size === 'sm' ? 'subhead' : 'callout'}
          weight={on ? 600 : 500}
          style={[{ color: on ? W.onAccent : color || W.text, letterSpacing: 0.2, textAlign: 'center' }, textStyle]}
        >
          {children}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

// ─── PrimaryButton ──────────────────────────────────────────────────────
// Aurora fill on the diagonal, a gloss highlight, a settled bottom edge and a
// rose glow beneath. Labels on fills are dark ink: white fails contrast there.
type ButtonVariant = 'primary' | 'secondary' | 'text' | 'danger';

interface PrimaryButtonProps {
  children: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** Swaps the label for a spinner (keeping the button's size) and blocks presses. */
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  variant?: ButtonVariant;
  /** A solid fill (hex token) in place of the aurora, e.g. a scenario's colour. */
  accent?: string;
  /** Show a subtle trailing arrow indicator (filled variants only) */
  trailingArrow?: boolean;
  /** Press-in haptic; a light tap by default. */
  haptic?: HapticKind | false;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
}

const BUTTON_HEIGHT = 56;

export function PrimaryButton({
  children, onPress, disabled = false, loading = false, style, variant = 'primary', accent,
  trailingArrow = false, haptic: hapticKind, accessibilityLabel, accessibilityHint, testID,
}: PrimaryButtonProps) {
  const press = usePressFeedback({ haptic: hapticKind });
  const isFilled = variant === 'primary' || variant === 'danger';
  const isGlass = variant === 'secondary';
  const fill = accent ?? (variant === 'danger' ? W.danger : W.rose);
  const gradient = accent ? null : variant === 'danger' ? GRAD.danger : GRAD.aurora;
  const ink = isFilled ? W.onAccent : isGlass ? W.cream : W.text2;

  return (
    <Animated.View
      style={[
        { width: '100%', borderRadius: R.button },
        isFilled ? { backgroundColor: fill } : null,
        isFilled && !disabled ? { ...ELEV.glow(fill, 24, 0.45), shadowOffset: { width: 0, height: 10 } } : null,
        // The whole button dims together: fill, label and glow.
        disabled ? styles.disabledButton : null,
        style,
        press.animatedStyle,
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? (typeof children === 'string' ? children : undefined)}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled, busy: loading }}
        testID={testID}
        style={{
          minHeight: BUTTON_HEIGHT, paddingHorizontal: SP.xl, paddingVertical: SP.md,
          borderRadius: R.button, overflow: 'hidden',
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
          backgroundColor: isGlass ? W.glass : 'transparent',
          borderWidth: isGlass ? 1 : 0,
          borderColor: W.hairlineStrong,
        }}
      >
        {isGlass ? <GlassFill intensity={36} /> : null}
        {gradient && isFilled ? <LinearGradient pointerEvents="none" colors={gradient} {...DIAGONAL} style={FILL} /> : null}
        {isFilled ? (
          <>
            <LinearGradient pointerEvents="none" colors={SPECULAR} style={[styles.specular, { height: BUTTON_HEIGHT / 2 }]} />
            <View pointerEvents="none" style={styles.settledEdge} />
          </>
        ) : null}

        <View style={[styles.buttonRow, loading ? styles.invisible : null]}>
          <Txt variant="button" numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 1, color: ink, letterSpacing: 0.4 }}>
            {children}
          </Txt>
          {trailingArrow && isFilled ? (
            <View style={styles.trailingArrow}>
              <NavIcon name="right" color={ink} size={16} />
            </View>
          ) : null}
        </View>
        {loading ? <ActivityIndicator color={ink} style={styles.spinner} /> : null}
      </Pressable>
    </Animated.View>
  );
}

// ─── Card (frosted glass) ───────────────────────────────────────────────
// Layers: blur, a top-bright / bottom-dark shade, a 1px light on the top edge
// (the aurora line for 'live' cards) and a 1px settled bottom edge.
type CardTone = 'glass' | 'raised' | 'live';

interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  border?: string | null;
  bg?: string;
  /** false is the same as tone="raised". */
  glass?: boolean;
  /** 'glass' frosted (default), 'raised' opaque with a shadow, 'live' glass
   *  with the aurora edge (something happening now). */
  tone?: CardTone;
  /** R.card (20) for hero cards; R.lg (16) for rows and nested tiles. */
  borderRadius?: number;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Card({
  children, onPress, style, padding = SP.base2, border, bg, glass = true,
  tone = glass ? 'glass' : 'raised', borderRadius = R.card, accessibilityLabel, accessibilityHint,
}: CardProps) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSubtle });
  const { outer, inner } = splitStyle(style);
  const isGlass = tone !== 'raised';
  const depth = isGlass ? null : [{ borderRadius, backgroundColor: bg || W.surface1 }, ELEV.mid];

  const surface = (
    <View
      style={[
        {
          flexGrow: 1, borderRadius, padding, overflow: 'hidden',
          borderWidth: 1,
          borderColor: border || (isGlass ? W.hairline : 'transparent'),
          backgroundColor: bg || (isGlass ? W.glass : W.surface1),
        },
        inner,
      ]}
    >
      {isGlass ? (
        <>
          <GlassFill intensity={40} />
          <LinearGradient pointerEvents="none" colors={CARD_SHADE} locations={[0, 0.5, 1]} style={FILL} />
        </>
      ) : null}
      {tone === 'live'
        ? <AuroraLine />
        : <LinearGradient pointerEvents="none" colors={EDGE_LIGHT} {...ACROSS} style={styles.edgeTop} />}
      <View pointerEvents="none" style={styles.settledEdge} />
      {children}
    </View>
  );

  if (!onPress) {
    return (
      <View accessible={accessibilityLabel ? true : undefined} accessibilityLabel={accessibilityLabel} style={[depth, outer]}>
        {surface}
      </View>
    );
  }
  return (
    <Animated.View style={[depth, outer, press.animatedStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        style={styles.grow}
      >
        {surface}
      </Pressable>
    </Animated.View>
  );
}

// ─── GlassPill ──────────────────────────────────────────────────────────
export function GlassPill({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          borderRadius: R.pill, borderWidth: 1, borderColor: W.hairline,
          paddingVertical: SP.sm2, paddingHorizontal: SP.md2,
          flexDirection: 'row', alignItems: 'center', gap: SP.md, overflow: 'hidden',
          backgroundColor: W.glassSoft,
        },
        style,
      ]}
    >
      <GlassFill intensity={32} />
      {children}
    </View>
  );
}

// ─── Toggle ─────────────────────────────────────────────────────────────
// iOS-style switch. The thumb springs (and jumps under Reduce Motion); the
// aurora track and its glow cross-fade; the thumb swells while held.
const TRACK_W = 46;
const TRACK_H = 28;
const THUMB = 23;
const THUMB_INSET = (TRACK_H - THUMB) / 2;
const TRAVEL = TRACK_W - THUMB - THUMB_INSET * 2;
const GLOW_PAD = 14;
const TOGGLE_GLOW = [
  { offset: 0.5, color: W.rose, opacity: 0.4 },
  { offset: 1, color: W.rose, opacity: 0 },
] as const;
const TOGGLE_SLOP = minTarget(TRACK_W, TRACK_H);

interface ToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  /** Spoken name of the switch. */
  label: string;
  disabled?: boolean;
}

export function Toggle({ value, onChange, label, disabled = false }: ToggleProps) {
  const pos = useSharedValue(value ? 1 : 0);
  const lit = useSharedValue(value ? 1 : 0);
  const held = useSharedValue(0);

  useEffect(() => {
    pos.value = withSpring(value ? 1 : 0, spring('snappy'));
    lit.value = withTiming(value ? 1 : 0, fade(D.base));
  }, [value, pos, lit]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(pos.value, [0, 1], [0, TRAVEL], Extrapolation.CLAMP) },
      { scale: 1 + held.value * 0.08 },
    ],
  }));
  const trackStyle = useAnimatedStyle(() => ({ opacity: lit.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: lit.value }));

  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onChange(!value);
      }}
      onPressIn={() => { held.value = withTiming(1, fade(D.instant)); }}
      onPressOut={() => { held.value = withTiming(0, fade(D.fast)); }}
      disabled={disabled}
      hitSlop={TOGGLE_SLOP}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      style={[styles.toggle, disabled ? styles.disabled : null]}
    >
      <Animated.View pointerEvents="none" style={[styles.toggleGlow, glowStyle]}>
        <RadialGlow width={TRACK_W + GLOW_PAD * 2} height={TRACK_H + GLOW_PAD * 2} stops={TOGGLE_GLOW} />
      </Animated.View>
      <View style={styles.track}>
        <View style={styles.trackOff} />
        <Animated.View style={[FILL, trackStyle]}>
          <LinearGradient colors={GRAD.auroraShort} {...DIAGONAL} style={FILL} />
        </Animated.View>
      </View>
      <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
    </Pressable>
  );
}

// ─── ProgressDots ───────────────────────────────────────────────────────
// Completed steps are coral; the current one stretches into a capsule.
export function ProgressDots({ total, current }: { total: number; current: number }) {
  return (
    <View accessible accessibilityLabel={`Step ${current} of ${total}`} style={styles.dots}>
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[styles.dot, i < current ? styles.dotDone : null, i === current - 1 ? styles.dotCurrent : null]}
        />
      ))}
    </View>
  );
}

// ─── StatusPill ─────────────────────────────────────────────────────────
export function StatusPill({ children, accent = W.text2, bg = W.surface1 }: { children: React.ReactNode; accent?: string; bg?: string }) {
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Txt variant="footnote" weight={500} style={{ color: accent }}>{children}</Txt>
    </View>
  );
}

// ─── MemoryBadge ────────────────────────────────────────────────────────
// Reports a memory the backend actually saved. It keeps its place while
// hidden (so the thread doesn't jump) but leaves the accessibility tree and
// stops taking touches; appearing is announced and felt.
interface MemoryBadgeProps {
  show: boolean;
  text?: string;
  /** Opens the saved memories. Without it the badge only reports the save. */
  onPress?: () => void;
}

export function MemoryBadge({ show, text = 'Memory saved', onPress }: MemoryBadgeProps) {
  const reduced = useReducedMotion();
  const v = useSharedValue(0);
  const shown = useRef(false);

  useEffect(() => {
    v.value = withTiming(show ? 1 : 0, fade(show ? D.slow : D.base));
    if (show && !shown.current) {
      haptic.success();
      announce(text);
    }
    shown.current = show;
  }, [show, text, v]);

  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: reduced ? 0 : (1 - v.value) * 8 }],
  }));

  return (
    <Animated.View
      pointerEvents={show ? 'box-none' : 'none'}
      accessibilityElementsHidden={!show}
      importantForAccessibility={show ? 'auto' : 'no-hide-descendants'}
      style={[styles.badge, style]}
    >
      <MemoryChip onPress={onPress} accessibilityHint={onPress ? 'Opens your memories' : undefined}>{text}</MemoryChip>
    </Animated.View>
  );
}

// ─── Sparkles ───────────────────────────────────────────────────────────
// A one-shot burst of gold motes. Pure decoration, so Reduce Motion skips it.
export function Sparkles({ count = 4 }: { count?: number }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <View style={styles.sparkles} pointerEvents="none">
      {Array.from({ length: count }, (_, i) => (
        <Sparkle key={i} dx={Math.cos(i * 1.4) * 18} dy={Math.sin(i * 1.4) * 14 - 6} delay={i * 70} />
      ))}
    </View>
  );
}

function Sparkle({ dx, dy, delay }: { dx: number; dy: number; delay: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = withDelay(delay, withTiming(1, { duration: D.slower, easing: ease.decel }));
    return () => cancelAnimation(v);
  }, [delay, v]);
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.3, 1], [0, 1, 0]),
    transform: [{ translateX: v.value * dx }, { translateY: v.value * dy }, { scale: 0.5 * (1 - v.value) }],
  }));
  return <Animated.View style={[styles.sparkle, style]} />;
}

// ─── MemoryRef ──────────────────────────────────────────────────────────
// An inline memory reference inside companion text.
export function MemoryRef({ children, onPress }: { children: React.ReactNode; onPress?: () => void }) {
  return (
    <Txt
      font="user" weight={500}
      onPress={onPress}
      accessibilityRole={onPress ? 'link' : undefined}
      style={styles.memoryRef}
    >
      {children}
    </Txt>
  );
}

// ─── MinuteWarningBanner ─────────────────────────────────────────────────
// Shown during a call when talk time is running out. Amber with a few
// minutes left; red, a live countdown and a way to buy more in the last one.
interface MinuteWarningBannerProps {
  /** Whole minutes left (rounded up). The banner hides when this and `seconds` are null. */
  minutes: number | null;
  /** Live seconds left; takes precedence and counts down in the last minute. */
  seconds?: number | null;
  onUpgrade?: () => void;
}

export function MinuteWarningBanner({ minutes, seconds = null, onUpgrade }: MinuteWarningBannerProps) {
  if (seconds == null && minutes == null) return null;
  const secs = seconds == null ? null : Math.max(0, Math.floor(seconds));
  return <MinuteWarning minutes={secs == null ? (minutes as number) : Math.ceil(secs / 60)} seconds={secs} onUpgrade={onUpgrade} />;
}

// Half the ambient period: calm enough to read, quick enough to feel urgent.
const URGENT_BREATH = D.ambient / 2;

function MinuteWarning({ minutes, seconds, onUpgrade }: { minutes: number; seconds: number | null; onUpgrade?: () => void }) {
  const last = minutes <= 1;
  const tone = last ? W.dangerText : W.warning;
  const countdown = last && seconds != null && seconds < 60;

  let message: string;
  let spoken: string;
  if (seconds === 0 || minutes <= 0) {
    message = spoken = 'No minutes left';
  } else if (countdown) {
    message = `0:${String(seconds).padStart(2, '0')} left`;
    spoken = `${seconds} seconds left`;
  } else if (last) {
    message = spoken = '1 minute left';
  } else {
    message = spoken = `${minutes} minutes left this month`;
  }

  // Speak (and, for the last minute, buzz) when the banner appears and when
  // it turns urgent, not on every tick.
  const wasLast = useRef<boolean | null>(null);
  useEffect(() => {
    if (wasLast.current === last) return;
    wasLast.current = last;
    if (last) {
      haptic.warning();
      announce(onUpgrade ? 'About a minute left. See plans to keep talking.' : 'About a minute left.');
    } else {
      announce(`${minutes} minutes left this month.`);
    }
  }, [last, minutes, onUpgrade]);

  const breath = useBreath(URGENT_BREATH, { rest: 0.5 });
  const dotStyle = useAnimatedStyle(() => ({ transform: [{ scale: 0.92 + breath.value * 0.16 }] }));
  const entering = useOnMount(() => enter.fadeDown);

  return (
    <Animated.View entering={entering} style={[styles.banner, { borderColor: rgba(tone, last ? 0.35 : 0.2) }]}>
      <GlassFill intensity={20} />
      <Animated.View style={[styles.bannerDot, { backgroundColor: tone, ...ELEV.glow(tone, 8, 0.9) }, dotStyle]} />
      <Txt
        variant="footnote"
        accessibilityLabel={spoken}
        style={[{ flex: 1, color: last ? W.text : W.text2 }, countdown ? styles.tabular : null]}
      >
        {message}
      </Txt>
      {last && onUpgrade ? <SeePlans onPress={onUpgrade} /> : null}
    </Animated.View>
  );
}

const SEE_PLANS_H = 28;

function SeePlans({ onPress }: { onPress: () => void }) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall });
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={minTarget(HIT, SEE_PLANS_H)}
        accessibilityRole="button"
        accessibilityLabel="See plans to keep talking"
        style={({ pressed }) => [styles.seePlans, pressed ? styles.pressedSoft : null]}
      >
        <Txt variant="footnote" weight={600} maxScale={1.2} style={{ color: W.onAccent }}>See plans</Txt>
      </Pressable>
    </Animated.View>
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
      colors={GRAD.auroraLine}
      locations={[0, 0.3, 0.55, 0.85, 1]}
      {...ACROSS}
      style={[{ position: 'absolute', left: 0, right: 0, top: 0, height }, style]}
    />
  );
}

// ─── SectionLabel ───────────────────────────────────────────────────────
// Settings-style group heading: colored dot, uppercase label, hairline rule
// running to the right edge.
export function SectionLabel({ children, dot = W.primary, rule = true }: { children: React.ReactNode; dot?: string; rule?: boolean }) {
  return (
    <View style={styles.sectionLabel}>
      <View style={[styles.sectionDot, { backgroundColor: dot }]} />
      <Txt variant="eyebrow" heading style={{ color: W.text2 }}>{children}</Txt>
      {rule ? <View style={styles.sectionRule} /> : null}
    </View>
  );
}

// ─── StreakPill ─────────────────────────────────────────────────────────
// Gold flame + day count, with a specular sweep crossing it every few
// seconds — the one piece of chrome allowed to move on the home header.
const SWEEP_PERIOD = 4500;
const SWEEP_SHARE = 0.31; // of the period spent crossing; the rest is rest
const SWEEP_W = 26;

/** A 0→1 sawtooth on the UI thread. Rests at 0 under Reduce Motion and while
 *  the app is in the background. */
function useSawtooth(periodMs: number): SharedValue<number> {
  const reduced = useReducedMotion();
  const active = useAppActive();
  const t = useSharedValue(0);
  const running = active && !reduced;

  useEffect(() => {
    t.value = 0;
    if (!running) return;
    t.value = withRepeat(
      withTiming(1, { duration: periodMs, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
      -1, false, undefined, ReduceMotion.Never,
    );
    return () => cancelAnimation(t);
  }, [running, periodMs, t]);

  return t;
}

interface StreakPillProps {
  days: number;
  onPress?: () => void;
  /** Defaults to "N-day streak". */
  accessibilityLabel?: string;
  /** Defaults to "Opens settings" when pressable (Home's only use). */
  accessibilityHint?: string;
}

const STREAK_SLOP = minTarget(HIT, 32);

export function StreakPill({ days, onPress, accessibilityLabel, accessibilityHint }: StreakPillProps) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall });
  const clock = useSawtooth(SWEEP_PERIOD);
  const width = useSharedValue(0);

  const sweepStyle = useAnimatedStyle(() => {
    const t = ease.standard(Math.min(1, clock.value / SWEEP_SHARE));
    return {
      opacity: width.value > 0 && clock.value > 0 ? 1 : 0,
      transform: [
        { translateX: interpolate(t, [0, 1], [-SWEEP_W * 2, width.value + SWEEP_W]) },
        { skewX: '-20deg' },
      ],
    };
  });

  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={onPress ? press.onPressIn : undefined}
        onPressOut={onPress ? press.onPressOut : undefined}
        hitSlop={STREAK_SLOP}
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={accessibilityLabel ?? `${days}-day streak`}
        accessibilityHint={accessibilityHint ?? (onPress ? 'Opens settings' : undefined)}
        onLayout={e => { width.value = e.nativeEvent.layout.width; }}
        style={styles.streak}
      >
        <Animated.View pointerEvents="none" style={[styles.sweep, sweepStyle]} />
        <NavIcon name="flame-solid" color={W.gold} size={14} />
        <Txt font="display" weight={700} maxScale={1.2} style={[styles.tabular, { fontSize: 13, color: W.gold }]}>{days}</Txt>
      </Pressable>
    </Animated.View>
  );
}

// ─── MemoryChip ─────────────────────────────────────────────────────────
// Gold-on-dark inline chip for a saved memory or a memory count. Gold is
// reserved for memory + streaks. A pressable chip shows a chevron.
const CHIP_SLOP = minTarget(HIT, 30);

export function MemoryChip({ children, icon = 'check', onPress, accessibilityHint }: {
  children: React.ReactNode;
  icon?: 'check' | 'sparkle-solid';
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const press = usePressFeedback();
  const body = (
    <>
      <NavIcon name={icon} color={W.gold} size={13} />
      <Txt variant="footnote" weight={500} style={{ color: W.gold }}>{children}</Txt>
      {onPress ? <NavIcon name="right" color={W.gold} size={12} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.memoryChip}>{body}</View>;
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={CHIP_SLOP}
        accessibilityRole="button"
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.memoryChip, pressed ? styles.memoryChipPressed : null]}
      >
        {body}
      </Pressable>
    </Animated.View>
  );
}

// ─── QuickReply ─────────────────────────────────────────────────────────
// Coral-outlined suggestion chip above the composer. Its row sits at the top
// edge of a scroll view, which would swallow a top hit slop, so the chip
// grows downward only; the row should add a little top padding.
const QUICK_REPLY_SLOP = { top: 4, bottom: 4 };

export function QuickReply({ children, onPress, accessibilityHint }: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityHint?: string;
}) {
  const press = usePressFeedback({ haptic: 'selection' });
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        hitSlop={QUICK_REPLY_SLOP}
        accessibilityRole="button"
        accessibilityHint={accessibilityHint}
        style={({ pressed }) => [styles.quickReply, pressed ? styles.quickReplyPressed : null]}
      >
        <Txt variant="subhead" weight={500} numberOfLines={1} style={{ color: W.primarySoft }}>
          {children}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

// ─── MeterBar ───────────────────────────────────────────────────────────
// Thin aurora progress track — voice minutes, usage caps. The fill slides in
// from the left (a transform, so the rounded end keeps its shape) while the
// gradient stays put, and it warms to the danger ramp when running low.
interface MeterBarProps {
  pct: number;
  height?: number;
  /** Share (0–1) at or below which the fill turns to the warning ramp. */
  lowAt?: number;
  /** What is being measured, e.g. "Voice minutes left". */
  accessibilityLabel?: string;
}

export function MeterBar({ pct, height = 6, lowAt, accessibilityLabel }: MeterBarProps) {
  const clamped = Math.max(0, Math.min(1, pct));
  const low = lowAt != null && clamped <= lowAt;
  const trackW = useSharedValue(0);
  const shown = useSharedValue(0);
  const warm = useSharedValue(low ? 1 : 0);

  useEffect(() => {
    shown.value = withTiming(clamped, timing(D.slower, 'decel'));
  }, [clamped, shown]);
  useEffect(() => {
    warm.value = withTiming(low ? 1 : 0, fade(D.base));
  }, [low, warm]);

  const fillStyle = useAnimatedStyle(() => ({
    opacity: trackW.value > 0 ? 1 : 0,
    transform: [{ translateX: (shown.value - 1) * trackW.value }],
  }));
  const pinStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (1 - shown.value) * trackW.value }] }));
  const warmStyle = useAnimatedStyle(() => ({ opacity: warm.value }));
  const round = height / 2;

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      onLayout={e => { trackW.value = e.nativeEvent.layout.width; }}
      style={{ height, borderRadius: round, backgroundColor: W.hairline, overflow: 'hidden' }}
    >
      <Animated.View style={[styles.grow, { borderRadius: round, overflow: 'hidden' }, fillStyle]}>
        <Animated.View style={[FILL, pinStyle]}>
          <LinearGradient colors={GRAD.aurora} {...ACROSS} style={FILL} />
          <Animated.View style={[FILL, warmStyle]}>
            <LinearGradient colors={GRAD.danger} {...ACROSS} style={FILL} />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────
// Placeholder blocks with a soft light sweep. Every skeleton on screen reads
// one shared clock so they shimmer in step; it stops when the last one
// unmounts, and Reduce Motion or a backgrounded app leaves them still.
const SHIMMER_PERIOD = 1600;
const SHIMMER_SHARE = 0.65;
const SHIMMER_BAND = 96;
const SKELETON_FILL = rgba(W.text, 0.07);
const SHIMMER = [rgba(W.text, 0), rgba(W.text, 0.08), rgba(W.text, 0)] as const;

const shimmerClock = makeMutable(0);
let shimmerUsers = 0;

function useShimmerClock(running: boolean): SharedValue<number> {
  useEffect(() => {
    if (!running) return;
    if (shimmerUsers++ === 0) {
      shimmerClock.value = 0;
      shimmerClock.value = withRepeat(
        withTiming(1, { duration: SHIMMER_PERIOD, easing: Easing.linear, reduceMotion: ReduceMotion.Never }),
        -1, false, undefined, ReduceMotion.Never,
      );
    }
    return () => {
      if (--shimmerUsers === 0) cancelAnimation(shimmerClock);
    };
  }, [running]);
  return shimmerClock;
}

interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}

/** A placeholder block. Hidden from VoiceOver: label the loading region instead
 *  (SkeletonLines does). */
export function Skeleton({ width = '100%', height = 14, radius = R.sm, style }: SkeletonProps) {
  const reduced = useReducedMotion();
  const active = useAppActive();
  const moving = active && !reduced;
  const clock = useShimmerClock(moving);
  const w = useSharedValue(0);

  const bandStyle = useAnimatedStyle(() => {
    const t = Math.min(1, clock.value / SHIMMER_SHARE);
    return { transform: [{ translateX: -SHIMMER_BAND + t * (w.value + SHIMMER_BAND) }] };
  });

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={e => { w.value = e.nativeEvent.layout.width; }}
      style={[{ width, height, borderRadius: radius, backgroundColor: SKELETON_FILL, overflow: 'hidden' }, style]}
    >
      {moving ? (
        <Animated.View style={[styles.shimmer, bandStyle]}>
          <LinearGradient colors={SHIMMER} {...ACROSS} style={FILL} />
        </Animated.View>
      ) : null}
    </View>
  );
}

const LINE_WIDTHS: DimensionValue[] = ['100%', '92%', '84%', '96%'];

/** Paragraph placeholder; the last line runs short. Announced as "Loading". */
export function SkeletonLines({ lines = 3, style }: { lines?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View accessible accessibilityLabel="Loading" accessibilityState={{ busy: true }} style={[styles.lines, style]}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={12} width={lines > 1 && i === lines - 1 ? '60%' : LINE_WIDTHS[i % LINE_WIDTHS.length]} />
      ))}
    </View>
  );
}

// ─── EmptyState / ErrorState ────────────────────────────────────────────
interface EmptyStateProps {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon = 'sparkle', title, body, actionLabel, onAction, style }: EmptyStateProps) {
  const entering = useOnMount(() => enter.fadeUp);
  return (
    <Animated.View entering={entering} style={[styles.state, style]}>
      <View style={[styles.stateIcon, styles.stateIconEmpty]}>
        <NavIcon name={icon} color={W.primarySoft} size={26} />
      </View>
      <Txt variant="title3" heading style={styles.stateTitle}>{title}</Txt>
      {body ? <Txt variant="subhead" style={styles.stateBody}>{body}</Txt> : null}
      {actionLabel && onAction ? (
        <PrimaryButton onPress={onAction} style={styles.stateAction}>{actionLabel}</PrimaryButton>
      ) : null}
    </Animated.View>
  );
}

interface ErrorStateProps {
  title?: string;
  body?: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** Shows the retry button as busy while the retry runs. */
  retrying?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ErrorState({
  title = "Couldn't load this", body = 'Please try again in a moment.',
  onRetry, retryLabel = 'Try again', retrying = false, style,
}: ErrorStateProps) {
  const entering = useOnMount(() => enter.fadeUp);
  useEffect(() => {
    announce(body ? `${title}. ${body}` : title);
  }, [title, body]);

  return (
    <Animated.View entering={entering} style={[styles.state, style]}>
      <View style={[styles.stateIcon, styles.stateIconError]}>
        <NavIcon name="alert" color={W.text2} size={26} />
      </View>
      <Txt variant="title3" heading style={styles.stateTitle}>{title}</Txt>
      {body ? <Txt variant="subhead" style={styles.stateBody}>{body}</Txt> : null}
      {onRetry ? (
        <PrimaryButton variant="secondary" onPress={onRetry} loading={retrying} style={styles.stateAction}>
          {retryLabel}
        </PrimaryButton>
      ) : null}
    </Animated.View>
  );
}

// ─── InlineNotice ───────────────────────────────────────────────────────
type NoticeTone = 'info' | 'warning' | 'error' | 'success';
const NOTICE: Record<NoticeTone, { color: string; icon: IconName }> = {
  info: { color: W.secondary, icon: 'info' },
  warning: { color: W.warning, icon: 'alert' },
  error: { color: W.dangerText, icon: 'alert' },
  success: { color: W.success, icon: 'check' },
};

interface InlineNoticeProps {
  tone: NoticeTone;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** A one-line status inside a screen. Warnings and errors are spoken when
 *  they appear or change. */
export function InlineNotice({ tone, text, actionLabel, onAction, style }: InlineNoticeProps) {
  const { color, icon } = NOTICE[tone];
  const entering = useOnMount(() => enter.fade);
  const exiting = useOnMount(() => exit.fade);
  useEffect(() => {
    if (tone === 'warning' || tone === 'error') announce(text);
  }, [tone, text]);

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      style={[styles.notice, { backgroundColor: rgba(color, 0.1), borderColor: rgba(color, 0.28) }, style]}
    >
      <NavIcon name={icon} color={color} size={18} />
      <Txt variant="subhead" style={styles.noticeText}>{text}</Txt>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          hitSlop={NOTICE_ACTION_SLOP}
          accessibilityRole="button"
          style={({ pressed }) => [styles.noticeAction, pressed ? styles.pressed : null]}
        >
          <Txt variant="subhead" weight={600} style={{ color }}>{actionLabel}</Txt>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const NOTICE_ACTION_SLOP = minTarget(HIT, 24);

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  pressed: { opacity: 0.7 },
  pressedSoft: { opacity: 0.85 },
  disabled: { opacity: 0.4 },
  disabledButton: { opacity: 0.36 },
  invisible: { opacity: 0 },
  tabular: { fontVariant: ['tabular-nums'] },

  backButton: { marginLeft: -10 },

  specular: { position: 'absolute', left: 1, top: 1, right: 1, borderTopLeftRadius: R.pill, borderTopRightRadius: R.pill },
  settledEdge: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: rgba(W.shadow, 0.22) },
  edgeTop: { position: 'absolute', left: 0, right: 0, top: 0, height: 1 },

  buttonRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  trailingArrow: { marginLeft: SP.sm2, opacity: 0.9 },
  spinner: { position: 'absolute' },

  toggle: { width: TRACK_W, height: TRACK_H },
  toggleGlow: { position: 'absolute', left: -GLOW_PAD, top: -GLOW_PAD },
  track: { ...FILL, borderRadius: TRACK_H / 2, overflow: 'hidden' },
  // Off: a lifted fill with an outline that clears 3:1 against the row.
  trackOff: { ...FILL, borderRadius: TRACK_H / 2, backgroundColor: W.surface3, borderWidth: 1, borderColor: rgba(W.text3, 0.7) },
  thumb: {
    position: 'absolute', top: THUMB_INSET, left: THUMB_INSET, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: W.cream, ...ELEV.low,
  },

  dots: { flexDirection: 'row', gap: SP.sm, justifyContent: 'center', alignItems: 'center' },
  // text3 at 65% clears 3:1 on the page background.
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: rgba(W.text3, 0.65) },
  dotDone: { backgroundColor: W.primary },
  dotCurrent: { width: 16 },

  statusPill: {
    minHeight: 28, paddingHorizontal: SP.md, paddingVertical: SP.xs, borderRadius: R.pill,
    flexDirection: 'row', alignItems: 'center', gap: SP.xs2,
  },

  badge: { alignSelf: 'center' },
  memoryChip: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs2, alignSelf: 'flex-start',
    paddingVertical: SP.xs2, paddingHorizontal: SP.md, borderRadius: R.md2,
    backgroundColor: rgba(W.gold, 0.1), borderWidth: 1, borderColor: rgba(W.gold, 0.25),
  },
  memoryChipPressed: { backgroundColor: rgba(W.gold, 0.18) },
  memoryRef: {
    color: W.gold, textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: rgba(W.gold, 0.4),
  },

  sparkles: { position: 'absolute', left: '50%', top: '50%', width: 0, height: 0 },
  sparkle: {
    position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: W.gold,
    ...ELEV.glow(W.gold, 6, 1),
  },

  banner: {
    marginHorizontal: SP.base, marginTop: SP.sm, minHeight: HIT,
    borderRadius: R.md, paddingVertical: SP.sm, paddingLeft: SP.md2, paddingRight: SP.sm,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm2, overflow: 'hidden',
    borderWidth: 1, backgroundColor: W.glassRaised,
  },
  bannerDot: { width: 8, height: 8, borderRadius: 4 },
  seePlans: {
    minHeight: SEE_PLANS_H, paddingHorizontal: SP.md, paddingVertical: SP.xs2,
    borderRadius: R.pill, backgroundColor: W.primary, alignItems: 'center', justifyContent: 'center',
  },

  sectionLabel: { flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingHorizontal: SP.xs2, paddingBottom: 9 },
  sectionDot: { width: 4, height: 4, borderRadius: 2, opacity: 0.8 },
  sectionRule: { flex: 1, height: 1, backgroundColor: W.hairlineFaint },

  streak: {
    flexDirection: 'row', alignItems: 'center', gap: SP.xs2, minHeight: 32,
    paddingVertical: SP.xs2, paddingHorizontal: SP.md, borderRadius: R.pill,
    backgroundColor: rgba(W.gold, 0.1), borderWidth: 1, borderColor: rgba(W.gold, 0.28),
    overflow: 'hidden',
  },
  sweep: { position: 'absolute', left: 0, top: 0, bottom: 0, width: SWEEP_W, backgroundColor: rgba(W.text, 0.14) },

  quickReply: {
    minHeight: 36, paddingVertical: SP.xs2, paddingHorizontal: SP.md2, borderRadius: R.pill, justifyContent: 'center',
    backgroundColor: rgba(W.primary, 0.08), borderWidth: 1, borderColor: rgba(W.primary, 0.28),
  },
  quickReplyPressed: { backgroundColor: rgba(W.primary, 0.16) },

  shimmer: { position: 'absolute', top: 0, bottom: 0, left: 0, width: SHIMMER_BAND },
  lines: { gap: SP.sm2 },

  state: { alignItems: 'center', paddingHorizontal: SP.xl, paddingVertical: SP.xxl },
  stateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  stateIconEmpty: { backgroundColor: W.primaryDim, borderColor: rgba(W.primary, 0.18) },
  stateIconError: { backgroundColor: rgba(W.text3, 0.12), borderColor: rgba(W.text3, 0.2) },
  stateTitle: { marginTop: SP.base, textAlign: 'center' },
  stateBody: { marginTop: SP.xs2, textAlign: 'center', color: W.text2, maxWidth: 320 },
  stateAction: { marginTop: SP.xl, width: 'auto', alignSelf: 'center', minWidth: 200 },

  notice: {
    minHeight: HIT, flexDirection: 'row', alignItems: 'center', gap: SP.sm2,
    paddingVertical: SP.sm2, paddingLeft: SP.md, paddingRight: SP.sm, borderRadius: R.md, borderWidth: 1,
  },
  noticeText: { flex: 1, color: W.text },
  noticeAction: { paddingHorizontal: SP.xs2, paddingVertical: SP.xxs },
});
