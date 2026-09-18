// PrivacyShield.tsx — hides the conversation from the app switcher.
//
// iOS snapshots the app for the switcher as it leaves, and a 'background'
// event reaches JS too late to change that picture, so the cover goes up as
// soon as the app turns inactive and stays until it is active again. It
// fades in fast enough to be in place before the switcher card settles, and
// fades out gently so returning to the app feels like focus coming back.
//
// iOS also turns the app 'inactive' for every system alert or sheet drawn
// over it: a permission prompt, the purchase sheet, a sign-in sheet. The app
// stays on screen underneath those, and covering it would hide the very
// screen that explains the prompt. Code that asks for one wraps the ask in
// withSystemPrompt(), and while it is up only a real move to the background
// raises the cover.

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

// System prompts the app has asked for and that have not answered yet.
let promptsOpen = 0;
let lastPromptClosedAt = 0;
// A prompt's promise can settle a beat before iOS has finished taking the
// sheet down, and the state changes that trails are still the prompt's.
const PROMPT_SETTLE_MS = 1000;

function promptShowing(): boolean {
  return promptsOpen > 0 || Date.now() - lastPromptClosedAt < PROMPT_SETTLE_MS;
}

/**
 * Call right before asking iOS for something it answers with a system alert
 * or sheet. Returns the matching end, which is safe to call more than once.
 * Prefer withSystemPrompt(), which cannot forget the end.
 */
export function beginSystemPrompt(): () => void {
  promptsOpen += 1;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    promptsOpen -= 1;
    lastPromptClosedAt = Date.now();
  };
}

/**
 * Runs `ask` (a permission request, a purchase, a sign-in) without the privacy
 * cover coming up over the screen it is asked from. Leaving the app while the
 * prompt is up still covers it.
 */
export async function withSystemPrompt<T>(ask: () => Promise<T>): Promise<T> {
  const end = beginSystemPrompt();
  try {
    return await ask();
  } finally {
    end();
  }
}

export function PrivacyShield() {
  // Only a launch straight into the background starts covered. At a normal
  // launch iOS reports 'inactive' until the first frame, which must not
  // flash the cover over the splash hand-off.
  const [covered, setCovered] = useState(() => AppState.currentState === 'background');
  const reduceTransparency = useReduceTransparency();

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') setCovered(false);
      else if (next !== 'inactive' || !promptShowing()) setCovered(true);
    });
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
