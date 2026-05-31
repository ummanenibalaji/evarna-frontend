// Txt.tsx — typography primitive.
// In the web prototype, fontFamily + fontWeight combine freely. RN can't
// synthesize weights from one named family, so this component maps a
// (family, weight) pair to the concrete loaded font face and strips
// fontWeight/fontFamily out of the passed style.

import React from 'react';
import { Text, TextProps, StyleSheet, TextStyle, StyleProp } from 'react-native';
import { FontFamily, FontWeightKey, resolveFont, W } from '../theme/theme';

interface TxtProps extends TextProps {
  /** 'comp' = Manrope (display/companion), 'user' = Outfit (body/labels). Default 'user'. */
  font?: FontFamily;
  weight?: FontWeightKey;
  children?: React.ReactNode;
  style?: StyleProp<TextStyle>;
}

function nearestWeight(w?: number): FontWeightKey {
  if (w == null) return 400;
  if (w >= 700) return 700;
  if (w >= 600) return 600;
  if (w >= 500) return 500;
  return 400;
}

export function Txt({ font = 'user', weight, style, children, ...rest }: TxtProps) {
  // Flatten style so we can read fontWeight if the caller passed it there.
  const flat = StyleSheet.flatten(style) || {};
  const weightFromStyle = nearestWeight(
    typeof flat.fontWeight === 'string' ? parseInt(flat.fontWeight, 10) : (flat.fontWeight as number | undefined)
  );
  const finalWeight: FontWeightKey = weight ?? weightFromStyle;
  const family = resolveFont(font, finalWeight);

  // Remove fontWeight + fontFamily from passed style so RN uses our resolved face.
  const { fontWeight, fontFamily, ...cleanStyle } = flat;

  return (
    <Text
      {...rest}
      style={[{ color: W.text, fontFamily: family }, cleanStyle]}
      allowFontScaling={false}
    >
      {children}
    </Text>
  );
}
