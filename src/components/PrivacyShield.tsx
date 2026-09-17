// PrivacyShield.tsx — hides the conversation from the app switcher.
//
// iOS snapshots the app for the switcher as it leaves, and a 'background'
// event reaches JS too late to change that picture, so the cover goes up as
// soon as the app turns inactive and stays until it is active again. It
// fades in fast enough to be in place before the switcher card settles, and
// fades out gently so returning to the app feels like focus coming back.

import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from './Txt';
import { GRAD, MOTION, W, Z } from '../theme/theme';
import { ease } from '../theme/motion';
import { useReduceTransparency } from '../hooks/useAccessibilityPrefs';

// A cross-fade is already the Reduce Motion form of this transition.
const coverIn = () => FadeIn.duration(MOTION.duration.instant).easing(ease.decel).reduceMotion(ReduceMotion.Never);
const coverOut = () => FadeOut.duration(MOTION.duration.base).easing(ease.standard).reduceMotion(ReduceMotion.Never);

export function PrivacyShield() {
  // Only a launch straight into the background starts covered. At a normal
  // launch iOS reports 'inactive' until the first frame, which must not
  // flash the cover over the splash hand-off.
  const [covered, setCovered] = useState(() => AppState.currentState === 'background');
  const reduceTransparency = useReduceTransparency();

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => setCovered(next !== 'active'));
    return () => sub.remove();
  }, []);

  if (!covered) return null;

  return (
    <Animated.View
      entering={coverIn()}
      exiting={coverOut()}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.cover}
    >
      {reduceTransparency ? (
        <LinearGradient colors={[...GRAD.page]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      ) : (
        <>
          <BlurView intensity={100} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.tint]} />
        </>
      )}
      <View style={styles.center}>
        <Txt variant="hero" weight={700} maxScale={1} style={styles.wordmark}>evarna</Txt>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: { ...StyleSheet.absoluteFillObject, zIndex: Z.overlay },
  tint: { backgroundColor: W.scrim },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  wordmark: { color: W.primary, letterSpacing: -1 },
});
