// CallBits.tsx — the voice call's small parts: its controls, status pill,
// clock, minutes banner and voice-level probe.
//
// Anything that changes every second (the clock, the countdown) or many times
// a second (the voice level) is its own leaf here, so only that leaf
// re-renders — never the orb and glows of the call screen around it.

import React, { useEffect, useState } from 'react';
import { Animated as RNAnimated, Pressable, StyleSheet, View } from 'react-native';
import Animated, { withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import type { RemoteAudioTrack } from 'livekit-client';

import { MinuteWarningBanner } from './Atoms';
import { NavIcon, type IconName } from './NavIcon';
import { Txt } from './Txt';
import { LOW_BALANCE_SECONDS } from '../lib/entitlement';
import { formatClock, levelFromRms, liveBalance, spokenDuration } from '../lib/voiceCall';
import { useWave } from '../theme/animations';
import { spring, timing, usePressFeedback } from '../theme/motion';
import { ELEV, MOTION, R, rgba, SP, W } from '../theme/theme';

// ─── CallControl ─────────────────────────────────────────────────────────
// A round control with its name underneath, as in the Phone app: at a glance
// mid-conversation a word is faster than an icon, and "End & text" needs to
// say that it ends the call.
interface CallControlProps {
  icon: IconName;
  /** The word under the button. */
  caption: string;
  /** Spoken name, when the caption alone would be unclear. Defaults to the caption. */
  label?: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** Makes it a switch (mute), filled while on. */
  checked?: boolean;
  danger?: boolean;
  /** Circle diameter. */
  size?: number;
}

export function CallControl({
  icon, caption, label, hint, onPress, disabled = false, checked, danger = false, size = 56,
}: CallControlProps) {
  // The haptic belongs to the action (each caller fires its own on press),
  // not to touching down.
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall, haptic: false });
  const isSwitch = checked !== undefined;
  const on = !!checked;
  const fill = danger ? W.dangerStrong : on ? W.text : CONTROL_FILL;
  const ink = danger ? W.text : on ? W.onAccent : W.text;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      accessibilityRole={isSwitch ? 'switch' : 'button'}
      accessibilityLabel={label ?? caption}
      accessibilityHint={hint}
      accessibilityState={{ disabled, checked: isSwitch ? on : undefined }}
      style={[styles.control, disabled ? styles.disabled : null]}
    >
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: fill },
          danger ? styles.dangerGlow : on ? null : styles.controlEdge,
          press.animatedStyle,
        ]}
      >
        <View style={styles.controlIcon}>
          <NavIcon name={icon} color={ink} size={danger ? 26 : 22} />
        </View>
      </Animated.View>
      <Txt variant="caption" weight={500} numberOfLines={2} style={styles.caption}>{caption}</Txt>
    </Pressable>
  );
}

const CONTROL_FILL = rgba(W.text, 0.1);

// ─── CallStatusPill ──────────────────────────────────────────────────────
export type PillMark = 'voice' | 'muted' | 'reconnecting' | 'calm';

const MARK: Record<Exclude<PillMark, 'voice'>, { icon: IconName; color: string }> = {
  muted: { icon: 'mute', color: W.dangerText },
  reconnecting: { icon: 'wifi-off', color: W.warning },
  calm: { icon: 'sparkle', color: W.secondary },
};

/** The call's state in a word or two. Deliberately not a live region: it
 *  changes at every turn, and a screen reader reading "Listening…" over the
 *  companion's voice would drown the call out. The call screen announces the
 *  changes that matter (connected, reconnecting, ended) itself. */
export function CallStatusPill({ text, mark }: { text: string; mark: PillMark }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      style={styles.pill}
    >
      {mark === 'voice' ? <Equalizer /> : <NavIcon name={MARK[mark].icon} color={MARK[mark].color} size={14} />}
      <Txt variant="footnote" weight={500} numberOfLines={1} style={styles.pillText}>{text}</Txt>
    </View>
  );
}

// Three bars bouncing out of phase — the call's "they're talking now" mark.
// Still under Reduce Motion (useWave holds them).
const EQ_COLORS = [W.coral, W.rose, W.violet] as const;

function Equalizer() {
  return (
    <View style={styles.eq}>
      {EQ_COLORS.map((c, i) => <EqBar key={c} color={c} delay={i * 180} />)}
    </View>
  );
}

function EqBar({ color, delay }: { color: string; delay: number }) {
  // The shared useWave hook runs on RN Animated's native driver.
  const wave = useWave(delay);
  return <RNAnimated.View style={[styles.eqBar, { backgroundColor: color }, wave]} />;
}

// ─── CallTimer ───────────────────────────────────────────────────────────
/** Whole seconds since `since`, re-rendering on each new second. Timed off the
 *  clock (not by counting ticks) and aligned to `since`, so it never drifts
 *  or skips a second when the JS thread is busy. */
function useSecondsSince(since: number | null): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (since == null) return;
    let id: ReturnType<typeof setTimeout>;
    const next = () => {
      const into = (Date.now() - since) % 1000;
      id = setTimeout(() => {
        setTick(n => n + 1);
        next();
      }, 1000 - into + 8);
    };
    next();
    return () => clearTimeout(id);
  }, [since]);
  return since == null ? 0 : Math.max(0, Math.floor((Date.now() - since) / 1000));
}

/** The call's running length. Renders nothing until the companion picks up. */
export function CallTimer({ since }: { since: number | null }) {
  const secs = useSecondsSince(since);
  if (since == null) return null;
  return (
    <Txt variant="footnote" accessibilityLabel={`Call length, ${spokenDuration(secs)}`} style={styles.timer}>
      {formatClock(secs)}
    </Txt>
  );
}

// ─── CallMinuteBanner ────────────────────────────────────────────────────
/**
 * The low-balance banner, counting down live. It used to show the balance as
 * it was when the call started, so it never moved, and it never appeared at
 * all for a call that started above the warning line.
 */
export function CallMinuteBanner({ balance, billedSince, onUpgrade }: {
  /** Seconds left when the call started; null when unknown (no banner). */
  balance: number | null;
  /** When the server session started charging. */
  billedSince: number | null;
  onUpgrade?: () => void;
}) {
  const [now, setNow] = useState(Date.now);
  const left = liveBalance(balance, billedSince, now);

  useEffect(() => {
    const remaining = liveBalance(balance, billedSince, Date.now());
    if (remaining == null || billedSince == null || remaining <= 0) return;
    // Sleep until the warning is due, then wake on each whole second to count down.
    const wait = remaining > LOW_BALANCE_SECONDS
      ? (remaining - LOW_BALANCE_SECONDS) * 1000
      : 1000 - ((Date.now() - billedSince) % 1000) + 8;
    const id = setTimeout(() => setNow(Date.now()), Math.max(250, wait));
    return () => clearTimeout(id);
  }, [balance, billedSince, now]);

  if (left == null || left > LOW_BALANCE_SECONDS) return null;
  return <MinuteWarningBanner minutes={null} seconds={Math.max(0, left)} onUpgrade={onUpgrade} />;
}

// ─── AudioLevelProbe ─────────────────────────────────────────────────────
type TrackVolumeHook = (track?: RemoteAudioTrack) => number;

const useNoVolume: TrackVolumeHook = () => 0;
let trackVolumeHook: TrackVolumeHook | undefined;

// @livekit/react-native is native and absent from Expo Go, so it is resolved
// on first use (a call is already running by then) rather than at import.
function resolveTrackVolume(): TrackVolumeHook {
  if (trackVolumeHook === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      trackVolumeHook = (require('@livekit/react-native') as { useTrackVolume?: TrackVolumeHook }).useTrackVolume ?? useNoVolume;
    } catch {
      trackVolumeHook = useNoVolume;
    }
  }
  return trackVolumeHook;
}

/**
 * Feeds the companion's live voice level (0–1) into `level` on the UI thread,
 * so the orb follows the voice itself rather than a timer. Renders nothing;
 * it is a leaf of its own because the native meter reports ~25 times a second.
 * Mount it only while the orb should listen (connected, motion allowed).
 */
export function AudioLevelProbe({ track, level }: { track: RemoteAudioTrack; level: SharedValue<number> }) {
  const useTrackVolume = resolveTrackVolume();
  const rms = useTrackVolume(track);

  useEffect(() => {
    level.value = withSpring(levelFromRms(rms), spring('snappy'));
  }, [rms, level]);

  useEffect(() => () => {
    level.value = withTiming(0, timing(MOTION.duration.base));
  }, [level]);

  return null;
}

const styles = StyleSheet.create({
  control: { flex: 1, alignItems: 'center', gap: SP.xs2 },
  controlIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  controlEdge: { borderWidth: 1, borderColor: W.hairlineStrong },
  dangerGlow: ELEV.glow(W.danger, 18, 0.45),
  disabled: { opacity: 0.4 },
  caption: { color: W.text2, textAlign: 'center' },

  pill: {
    minHeight: 30, maxWidth: '100%', flexShrink: 1,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    paddingHorizontal: SP.md2, paddingVertical: SP.xs,
    borderRadius: R.pill, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glass,
  },
  pillText: { flexShrink: 1, color: W.text },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: SP.xxs, height: 12 },
  eqBar: { width: 2.5, height: 12, borderRadius: 1.25 },

  timer: { color: W.text2, fontVariant: ['tabular-nums'] },
});
