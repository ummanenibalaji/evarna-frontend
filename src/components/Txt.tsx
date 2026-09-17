// Txt.tsx — typography primitive.
// RN can't synthesize weights from one named family, so this component maps a
// (family, weight) pair to the concrete loaded font face and strips
// fontWeight/fontFamily out of the passed style.
//
// Text follows Dynamic Type, capped per role (TYPE[variant].maxScale) so
// chrome and numerals stay inside their layouts at the largest sizes.

import React from 'react';
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

let warnedItalic = false;

export function Txt({ variant, font, weight, maxScale, heading, style, children, ...rest }: TxtProps) {
  const role = variant ? TYPE[variant] : undefined;
  const { fontWeight, fontFamily, fontStyle, ...own } = StyleSheet.flatten(style) ?? {};

  // None of the loaded faces has an italic, so iOS would draw these upright
  // and Android would fake a slant. Emphasis has to come from colour instead.
  if (__DEV__ && fontStyle === 'italic' && !warnedItalic) {
    warnedItalic = true;
    console.warn('Txt: no italic face is loaded; use colour or opacity for emphasis.');
  }

  const family = resolveFont(font ?? role?.font ?? 'user', weight ?? nearestWeight(fontWeight) ?? role?.weight ?? 400);

  const base: TextStyle = { color: W.text, fontFamily: family };
  if (role) {
    base.fontSize = role.size;
    base.lineHeight = role.lineHeight;
    if (role.letterSpacing != null) base.letterSpacing = role.letterSpacing;
    if (role.uppercase) base.textTransform = 'uppercase';
    if (role.tabular) base.fontVariant = ['tabular-nums'];
    // A caller resizing a role keeps the role's leading, not its absolute
    // line height, which would crop or over-space the new size.
    if (own.fontSize != null && own.lineHeight == null) {
      base.lineHeight = Math.round((own.fontSize * role.lineHeight) / role.size);
    }
  }

  // Nothing renders below the caption size.
  if (own.fontSize != null && own.fontSize < MIN_SIZE) {
    own.fontSize = MIN_SIZE;
    if (own.lineHeight != null && own.lineHeight < TYPE.caption.lineHeight) own.lineHeight = TYPE.caption.lineHeight;
  }

  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={maxScale ?? role?.maxScale ?? DEFAULT_MAX_SCALE}
      accessibilityRole={heading ? 'header' : undefined}
      {...rest}
      style={[base, own]}
    >
      {children}
    </Text>
  );
}
