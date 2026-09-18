// Txt.tsx — typography primitive.
// RN can't synthesize weights from one named family, so this component maps a
// (family, weight) pair to the concrete loaded font face and strips
// fontWeight/fontFamily out of the passed style.
//
// Text follows Dynamic Type, capped per role (TYPE[variant].maxScale) so
// chrome and numerals stay inside their layouts at the largest sizes.
//
// Txt is the most-rendered component in the app, so it is built to be cheap:
// role styles are built once per role/font/weight and shared, a label with
// no `style` hands that shared object straight to Text (which then skips its
// own flattening and the native diff), a styled label builds one merged
// object only when its inputs change, and the component re-renders only when
// its props change by value (an inline `style={{ color: W.text2 }}` counts as
// unchanged).

import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';
import { resolveFont, TYPE, W, type FontFamily, type FontWeightKey, type TypeVariant } from '../theme/theme';

export interface TxtProps extends TextProps {
  /** Role from the type scale: sets family, weight, size, line height,
   *  tracking and the Dynamic Type cap. Explicit props and style win. */
  variant?: TypeVariant;
  /** 'display' = Bricolage Grotesque (headlines/numerals), 'comp' = Manrope
   *  (companion voice), 'user' = Outfit (UI body/labels). Default 'user'. */
  font?: FontFamily;
  weight?: FontWeightKey;
  /** Text colour (a token). Prefer this to `style={{ color }}`: a plain
   *  string keeps the label from re-rendering. A colour in `style` wins. */
  color?: string;
  /** Largest Dynamic Type multiplier. Defaults to the variant's cap. */
  maxScale?: number;
  /** Marks the text as a heading for the VoiceOver rotor. */
  heading?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

const MIN_SIZE = TYPE.caption.size;
const DEFAULT_MAX_SCALE = 1.35;

function nearestWeight(w: TextStyle['fontWeight']): FontWeightKey | undefined {
  const n = typeof w === 'string' ? parseInt(w, 10) : w;
  if (n == null || Number.isNaN(n)) return undefined;
  if (n >= 700) return 700;
  if (n >= 600) return 600;
  if (n >= 500) return 500;
  return 400;
}

// ── Role styles ──────────────────────────────────────────────────────────
// One frozen object per (variant, font, weight): a few dozen in the app.
const ROLE_STYLES = new Map<string, TextStyle>();

function roleStyle(variant: TypeVariant | undefined, font: FontFamily | undefined, weight: FontWeightKey | undefined): TextStyle {
  const key = `${variant ?? ''}|${font ?? ''}|${weight ?? ''}`;
  let style = ROLE_STYLES.get(key);
  if (style) return style;
  const role = variant ? TYPE[variant] : undefined;
  const s: TextStyle = { color: W.text, fontFamily: resolveFont(font ?? role?.font ?? 'user', weight ?? role?.weight ?? 400) };
  if (role) {
    s.fontSize = role.size;
    s.lineHeight = role.lineHeight;
    if (role.letterSpacing != null) s.letterSpacing = role.letterSpacing;
    if (role.uppercase) s.textTransform = 'uppercase';
    if (role.tabular) s.fontVariant = ['tabular-nums'];
  }
  style = Object.freeze(s);
  ROLE_STYLES.set(key, style);
  return style;
}

let warnedItalic = false;

/** The role style merged with the caller's style, as one plain object. */
function mergedStyle(
  variant: TypeVariant | undefined, font: FontFamily | undefined, weight: FontWeightKey | undefined,
  color: string | undefined, style: StyleProp<TextStyle>,
): TextStyle {
  // A plain object (a StyleSheet entry or an inline object) comes back as is;
  // only an array allocates here.
  const flat: TextStyle = StyleSheet.flatten(style) ?? {};

  // None of the loaded faces has an italic, so iOS would draw these upright
  // and Android would fake a slant. Emphasis has to come from colour instead.
  if (__DEV__ && flat.fontStyle === 'italic' && !warnedItalic) {
    warnedItalic = true;
    console.warn('Txt: no italic face is loaded; use colour or opacity for emphasis.');
  }

  const out: TextStyle = { ...roleStyle(variant, font, weight ?? nearestWeight(flat.fontWeight)) };
  if (color != null) out.color = color;
  const target = out as Record<string, unknown>;
  const source = flat as Record<string, unknown>;
  for (const key in source) {
    // The face is picked from family + weight above; RN can't synthesize them.
    if (key === 'fontWeight' || key === 'fontFamily' || key === 'fontStyle') continue;
    target[key] = source[key];
  }

  // Nothing renders below the caption size.
  if (flat.fontSize != null && flat.fontSize < MIN_SIZE) {
    out.fontSize = MIN_SIZE;
    if (flat.lineHeight != null && flat.lineHeight < TYPE.caption.lineHeight) out.lineHeight = TYPE.caption.lineHeight;
  }

  // A caller resizing a role keeps the role's leading, not its absolute
  // line height, which would crop or over-space the new size.
  const role = variant ? TYPE[variant] : undefined;
  if (role && flat.fontSize != null && flat.lineHeight == null) {
    out.lineHeight = Math.round(((out.fontSize ?? role.size) * role.lineHeight) / role.size);
  }
  return out;
}

function TxtImpl({ variant, font, weight, color, maxScale, heading, style, children, ...rest }: TxtProps) {
  const textStyle = useMemo(
    () => (style == null && color == null ? roleStyle(variant, font, weight) : mergedStyle(variant, font, weight, color, style)),
    [variant, font, weight, color, style],
  );

  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={maxScale ?? (variant ? TYPE[variant].maxScale : DEFAULT_MAX_SCALE)}
      accessibilityRole={heading ? 'header' : undefined}
      {...rest}
      style={textStyle}
    >
      {children}
    </Text>
  );
}

// ── Memo ─────────────────────────────────────────────────────────────────
// Style values are compared one level deep, so a fresh inline object or array
// with the same entries counts as unchanged; anything nested (a transform, a
// fontVariant array) still compares by identity. Children made only of
// strings and numbers compare by value.
type Loose = Record<string, unknown>;

function sameObject(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false;
  let count = 0;
  for (const key in a as Loose) {
    if ((a as Loose)[key] !== (b as Loose)[key]) return false;
    count++;
  }
  for (const _ in b as Loose) count--;
  return count === 0;
}

function sameStyle(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameStyle(a[i], b[i])) return false;
    return true;
  }
  return sameObject(a, b);
}

const isPlain = (v: unknown) => v == null || typeof v !== 'object';

function sameChildren(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] || !isPlain(a[i])) return false;
  }
  return true;
}

function propsEqual(prev: TxtProps, next: TxtProps): boolean {
  let count = 0;
  for (const key in prev) {
    const a = (prev as Loose)[key];
    const b = (next as Loose)[key];
    if (key === 'style' ? !sameStyle(a, b) : key === 'children' ? !sameChildren(a, b) : a !== b) return false;
    count++;
  }
  for (const _ in next) count--;
  return count === 0;
}

export const Txt = memo(TxtImpl, propsEqual);
Txt.displayName = 'Txt';
