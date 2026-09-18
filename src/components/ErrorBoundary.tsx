// ErrorBoundary.tsx — catches render errors, reports them to Sentry and shows
// a calm recovery screen instead of letting the app close.
//
// Sentry.wrap() in App.tsx is only a profiler and touch tracker; it does not
// catch anything. "Try again" remounts the whole subtree under a new key, so
// a router below starts over from its boot state rather than re-rendering
// the state that just threw. A boundary that can also be left (onReset)
// offers that as its own, plainly named second action, so "Try again" never
// quietly means "leave".

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sentry from '@sentry/react-native';
import { Txt } from './Txt';
import { RadialGlow } from './RadialGlow';
import { GRAD, HIT, R, SP, W } from '../theme/theme';
import { usePressFeedback } from '../theme/motion';
import { haptic } from '../lib/haptics';
import { announce } from '../hooks/useAccessibilityPrefs';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Tags the Sentry report so a root crash and a single screen crash are
   *  told apart. Defaults to 'root'. */
  name?: string;
  /** A change clears the error and remounts the children, e.g. the route
   *  key for a boundary around one screen. */
  resetKey?: string | number;
  /** A way out of the broken screen, e.g. back to the one it was opened
   *  from. When given, the fallback offers it as a second action next to
   *  "Try again", which still only remounts the children. */
  onReset?: () => void;
  /** Names the onReset action. Defaults to 'Go back'. */
  resetLabel?: string;
}

export function ErrorBoundary({ children, name = 'root', resetKey, onReset, resetLabel = 'Go back' }: ErrorBoundaryProps) {
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt(n => n + 1), []);

  // The remount also covers a way out that leaves this boundary on screen.
  const leave = useCallback(() => {
    onReset?.();
    setAttempt(n => n + 1);
  }, [onReset]);

  return (
    <Sentry.ErrorBoundary
      key={`${resetKey ?? ''}:${attempt}`}
      beforeCapture={scope => scope.setTag('boundary', name)}
      fallback={<Fallback onRetry={retry} onLeave={onReset ? leave : undefined} leaveLabel={resetLabel} />}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}

interface FallbackProps {
  onRetry: () => void;
  onLeave?: () => void;
  leaveLabel: string;
}

// Kept free of the shared atoms so a bug in one of them can't also take the
// recovery screen down.
function Fallback({ onRetry, onLeave, leaveLabel }: FallbackProps) {
  const insets = useSafeAreaInsets();
  const press = usePressFeedback();
  const leavePress = usePressFeedback();

  useEffect(() => {
    haptic.error();
    announce('Something went wrong.');
  }, []);

  return (
    <View style={styles.root}>
      <LinearGradient colors={[...GRAD.page]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <View style={[styles.body, { paddingTop: insets.top + SP.xl, paddingBottom: insets.bottom + SP.xl }]}>
        {/* A resting ember: the brand's warmth, without an alarm icon. */}
        <RadialGlow
          width={132}
          height={132}
          stops={EMBER}
          style={styles.ember}
        />
        <Txt variant="title2" heading style={styles.center}>
          Something went wrong
        </Txt>
        <Txt variant="body" style={[styles.center, styles.copy]}>
          {onLeave
            ? 'Evarna hit a snag showing this screen. Try again, or leave this screen for now.'
            : 'Evarna hit a snag showing this screen. Try again, and if it keeps happening, close and reopen the app.'}
        </Txt>
        <Animated.View style={[styles.buttonWrap, press.animatedStyle]}>
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            onPressIn={press.onPressIn}
            onPressOut={press.onPressOut}
            style={styles.button}
          >
            <LinearGradient
              colors={[...GRAD.aurora]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <Txt variant="button" style={styles.buttonLabel}>Try again</Txt>
          </Pressable>
        </Animated.View>
        {onLeave && (
          <Animated.View style={[styles.leaveWrap, leavePress.animatedStyle]}>
            <Pressable
              accessibilityRole="button"
              onPress={onLeave}
              onPressIn={leavePress.onPressIn}
              onPressOut={leavePress.onPressOut}
              style={styles.leave}
            >
              <Txt variant="button" style={styles.leaveLabel}>{leaveLabel}</Txt>
            </Pressable>
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const EMBER = [
  { offset: 0, color: W.coral, opacity: 0.55 },
  { offset: 0.35, color: W.rose, opacity: 0.22 },
  { offset: 0.7, color: W.violet, opacity: 0 },
] as const;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: W.bg },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  ember: { marginBottom: SP.base },
  center: { textAlign: 'center' },
  copy: { color: W.text2, marginTop: SP.sm, maxWidth: 320 },
  buttonWrap: { marginTop: SP.xxl, alignSelf: 'stretch', alignItems: 'center' },
  button: {
    minHeight: HIT + SP.sm,
    minWidth: 200,
    paddingHorizontal: SP.xl,
    paddingVertical: SP.md,
    borderRadius: R.button,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { color: W.onAccent },
  leaveWrap: { marginTop: SP.sm, alignSelf: 'stretch', alignItems: 'center' },
  leave: {
    minHeight: HIT,
    minWidth: 200,
    paddingHorizontal: SP.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveLabel: { color: W.text2 },
});
