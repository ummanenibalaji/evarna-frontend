// Feedback.tsx — app-level feedback the router owns: the toast, the busy
// dimmer shown while signing out, and the full-screen states for a launch
// that can't go anywhere yet.
//
// These live above every screen because what they report often outlives the
// screen that caused it: a companion edit saves after its profile has closed,
// a notification lands in the middle of a call.

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ErrorState, InlineNotice } from '../components/Atoms';
import { Txt } from '../components/Txt';
import { announce, useScreenReader } from '../hooks/useAccessibilityPrefs';
import { haptic } from '../lib/haptics';
import { enter, exit } from '../theme/motion';
import { ELEV, GRAD, R, SP, W, Z } from '../theme/theme';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface ToastSpec {
  text: string;
  tone?: ToastTone;
  /** A short verb, e.g. 'Retry' or 'Open'. */
  actionLabel?: string;
  onAction?: () => void;
}

export interface ToastItem extends ToastSpec {
  id: number;
}

// Long enough to read a sentence; longer when there is something to tap, and
// longer again with VoiceOver, which has to reach the button first.
const SHOW_MS = 4000;
const SHOW_WITH_ACTION_MS = 6500;
const SHOW_WITH_SCREEN_READER_MS = 10000;

// The enter/exit getters build a fresh animation per read; take one per mount.
const useOnMount = <T,>(read: () => T): T => useState(read)[0];

/** One toast at a time, under the status bar. A new toast replaces the current one. */
export function ToastHost({ toast, onDismiss }: { toast: ToastItem | null; onDismiss: (id: number) => void }) {
  const insets = useSafeAreaInsets();
  // The layer stays mounted so a leaving toast can play its exit.
  return (
    <View pointerEvents="box-none" style={[styles.toastLayer, { top: insets.top + SP.sm }]}>
      {toast ? <Toast key={toast.id} toast={toast} onDismiss={onDismiss} /> : null}
    </View>
  );
}

function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  const screenReader = useScreenReader();
  const entering = useOnMount(() => enter.fadeDown);
  const exiting = useOnMount(() => exit.fade);
  const tone = toast.tone ?? 'info';

  useEffect(() => {
    if (tone === 'error') haptic.error();
    else if (tone === 'warning') haptic.warning();
    // InlineNotice speaks warnings and errors itself.
    if (tone === 'info' || tone === 'success') announce(toast.text);
  }, [tone, toast.text]);

  useEffect(() => {
    const ms = screenReader ? SHOW_WITH_SCREEN_READER_MS : toast.onAction ? SHOW_WITH_ACTION_MS : SHOW_MS;
    const id = setTimeout(() => onDismiss(toast.id), ms);
    return () => clearTimeout(id);
  }, [toast.id, toast.onAction, screenReader, onDismiss]);

  const act = toast.onAction
    ? () => {
      onDismiss(toast.id);
      toast.onAction?.();
    }
    : undefined;

  return (
    <Animated.View entering={entering} exiting={exiting} style={styles.toast}>
      {/* Tapping the message itself puts it away. */}
      <Pressable onPress={() => onDismiss(toast.id)} accessible={false}>
        <InlineNotice
          tone={tone}
          text={toast.text}
          actionLabel={toast.actionLabel}
          onAction={act}
        />
      </Pressable>
    </Animated.View>
  );
}

/** Blocks the app while something that can't be interrupted finishes. */
export function BusyOverlay({ label }: { label: string }) {
  const entering = useOnMount(() => enter.fade);
  const exiting = useOnMount(() => exit.fade);
  useEffect(() => { announce(label); }, [label]);

  return (
    <Animated.View
      entering={entering}
      exiting={exiting}
      accessibilityViewIsModal
      style={styles.busy}
    >
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        accessibilityState={{ busy: true }}
        style={styles.busyCard}
      >
        <ActivityIndicator color={W.text} />
        <Txt variant="callout" numberOfLines={2} style={styles.busyLabel}>{label}</Txt>
      </View>
    </Animated.View>
  );
}

/** A launch that can't show the app: no connection yet, or a broken build. */
export function FullScreenState({ title, body, onRetry, retrying }: {
  title: string;
  body: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.full, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <LinearGradient colors={[...GRAD.page]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <ErrorState title={title} body={body} onRetry={onRetry} retrying={retrying} />
    </View>
  );
}

const styles = StyleSheet.create({
  toastLayer: { position: 'absolute', left: SP.base, right: SP.base, zIndex: Z.toast },
  // An opaque surface under the notice's tint, so it reads over any screen.
  toast: { borderRadius: R.md, backgroundColor: W.surface2, ...ELEV.mid },
  busy: {
    ...StyleSheet.absoluteFillObject,
    zIndex: Z.overlay,
    backgroundColor: W.scrim,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SP.xl,
  },
  busyCard: {
    minWidth: 180,
    maxWidth: 280,
    alignItems: 'center',
    gap: SP.md,
    paddingVertical: SP.lg,
    paddingHorizontal: SP.xl,
    borderRadius: R.card,
    backgroundColor: W.surface2,
    borderWidth: 1,
    borderColor: W.hairlineStrong,
    ...ELEV.high,
  },
  busyLabel: { color: W.text, textAlign: 'center' },
  full: { flex: 1, backgroundColor: W.bg, justifyContent: 'center' },
});
