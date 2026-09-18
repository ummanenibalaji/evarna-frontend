// VoiceCall.tsx — S12 Voice Call.
// Ported from chat.jsx (S12); lived in Chat.tsx until the call screen grew
// enough to own a file. Web CSS (radial-gradients, backdrop blur, keyframes)
// is expressed with RadialGlow and Reanimated equivalents.
//
// The screen is a thin view over useVoiceCall: it maps the call's phase to
// the orb, the status pill, the controls and, when something goes wrong, a
// screen that says what happened and offers the one thing that helps.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { callAudioOutput, useVoiceCall } from '../hooks/useVoiceCall';
import { announce } from '../hooks/useAccessibilityPrefs';
import { haptic } from '../lib/haptics';
import { aiNoticeText } from '../lib/aiNotice';
import {
  ENDED_BEAT_MS,
  ENDED_BEAT_SHORT_MS,
  RECAP_MIN_SECONDS,
  formatClock,
  spokenDuration,
  type CallError,
  type CallErrorKind,
  type CallPhase,
  type OrbState,
} from '../lib/voiceCall';
import { enter, exit, useReducedMotion } from '../theme/motion';
import { ELEV, SP, W, rgba } from '../theme/theme';
import { Screen, TopBar } from '../components/Chrome';
import { Orb } from '../components/Orb';
import { RadialGlow, type GlowStop } from '../components/RadialGlow';
import { NavIcon, type IconName } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { Pill, PrimaryButton } from '../components/Atoms';
import { Sheet } from '../components/Sheet';
import { AiNotice } from '../components/ChatBits';
import {
  AudioLevelProbe,
  CallControl,
  CallMinuteBanner,
  CallStatusPill,
  CallTimer,
  type PillMark,
} from '../components/CallBits';
import { Companion } from '../data/config';
import { Go } from '../navigation/types';

// ─── S12 VOICE CALL ──────────────────────────────────────────────────────
export interface VoiceCallProps {
  go: Go;
  companion: Companion;
  accent?: string;
  orbIntensity?: number;
  /** This period's balance, or null while unknown. Drives the warning banner. */
  voiceSecondsRemaining?: number | null;
  userId?: string;
  characterId?: string;
  /** Opens the paywall with a back-target that will not redial. */
  onOutOfMinutes?: () => void;
  /** Re-read the balance after the call, since it is what just spent it. */
  onCallEnded?: () => void;
  /** After a call long enough to summarise, called in place of going home. */
  onRecap?: () => void;
  /** Where hanging up lands: the chat the call was started from, or Home. */
  returnTo?: 'home' | 'chat';
}

type Exit = 'back' | 'recap' | 'chat' | 'plans';

// Layout budget for everything on the call screen that isn't the orb: top
// bar, AI notice, name, controls with captions and their padding.
const CALL_CHROME = 270;
const ORB_MIN = 120;
const ORB_MAX = 200;
// The orb lays out in 1.2× its size; its glow overflows that box.
const ORB_BOX = 1.2;

export function S12_VoiceCall({
  go, companion, accent = W.primary, orbIntensity = 1, voiceSecondsRemaining = null,
  userId, characterId, onOutOfMinutes, onCallEnded, onRecap, returnTo = 'home',
}: VoiceCallProps) {
  const call = useVoiceCall({ userId, characterId, callTitle: companion.name });
  const { phase, orbState, muted, error, connectedAt, billedSince, endedAt, agentTrack, hangUp, toggleMute, retry, allowMic } = call;
  const name = companion.name;
  const reduced = useReducedMotion();
  const level = useSharedValue(0);

  // The router animates the screen in; the stage only fades in on its own
  // when it comes back after an error screen.
  const [stageReturns, setStageReturns] = useState(false);
  if (phase === 'error' && !stageReturns) setStageReturns(true);

  // The balance the countdown starts from: the first one known. A refresh of
  // the entitlement mid-call must not move it.
  const balanceRef = useRef(voiceSecondsRemaining);
  if (balanceRef.current == null) balanceRef.current = voiceSecondsRemaining;

  // ── Leaving ──────────────────────────────────────────────────────────
  // Every way out converges here, once: the balance is re-read, then the
  // screen goes where the ending calls for.
  const navigatedRef = useRef(false);
  const leave = (to: Exit) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    onCallEnded?.();
    if (to === 'plans') {
      // onOutOfMinutes, not go('paywall'): `go` captures 'call' as the back
      // target, so closing the sheet would return here and start a second
      // billed call.
      if (onOutOfMinutes) onOutOfMinutes();
      else go('paywall');
      return;
    }
    if (to === 'chat') {
      go('chat');
      return;
    }
    if (to === 'recap' && onRecap && returnTo === 'home') {
      onRecap();
      return;
    }
    go(returnTo);
  };
  // The router passes fresh callbacks on every render; timers read the latest.
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  const endCall = useCallback(() => {
    haptic.heavy();
    void hangUp();
  }, [hangUp]);

  // There's no way to keep a call running behind the chat, so this ends it —
  // and says so on the button.
  const endAndText = useCallback(() => {
    haptic.heavy();
    void hangUp();
    leaveRef.current('chat');
  }, [hangUp]);

  const onMute = useCallback(() => {
    haptic.medium();
    toggleMute();
  }, [toggleMute]);

  // The last-minute banner's "See plans": the paywall replaces this screen, so
  // the call ends first rather than being cut off by the navigation.
  const plansMidCall = useCallback(() => {
    void hangUp();
    leaveRef.current('plans');
  }, [hangUp]);

  // "Call ended · 4:12" for a beat while the orb dims, then away. A call long
  // enough to talk about goes to its recap.
  useEffect(() => {
    if (phase !== 'ended') return;
    const talked = connectedAt != null && endedAt != null ? (endedAt - connectedAt) / 1000 : 0;
    announce(connectedAt != null ? `Call ended. ${spokenDuration(talked)}.` : 'Call ended.');
    const id = setTimeout(
      () => leaveRef.current(talked >= RECAP_MIN_SECONDS ? 'recap' : 'back'),
      connectedAt != null ? ENDED_BEAT_MS : ENDED_BEAT_SHORT_MS,
    );
    return () => clearTimeout(id);
  }, [phase, connectedAt, endedAt]);

  // ── Feedback on the call's big moments ───────────────────────────────
  // Said once the server session exists, not on arrival: the first call may
  // stop at the microphone question before anything is dialled.
  useEffect(() => {
    if (billedSince != null) announce(`Calling ${name}.`);
  }, [billedSince, name]);

  const prevPhase = useRef<CallPhase | null>(null);
  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = phase;
    if (prev === phase) return;
    if (phase === 'reconnecting') announce('Connection lost. Reconnecting.');
    else if (phase === 'connected' && prev === 'reconnecting') announce('Reconnected.');
    else if (phase === 'connected') {
      haptic.medium();
      announce(`Connected. ${name} is on the call.`);
    }
  }, [phase, name]);

  useEffect(() => {
    if (!error) return;
    if (WARNING_KINDS.has(error.kind)) haptic.warning();
    else haptic.error();
  }, [error]);

  // ── Microphone permission (first call only) ──────────────────────────
  const [asking, setAsking] = useState(false);
  const onAllowMic = useCallback(async () => {
    setAsking(true);
    try {
      await allowMic();
    } finally {
      setAsking(false);
    }
  }, [allowMic]);

  // ── Audio output ─────────────────────────────────────────────────────
  // iOS has a system picker; Android gets a sheet of the outputs it reports.
  const [outputs, setOutputs] = useState<string[] | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const onAudio = useCallback(async () => {
    haptic.light();
    if (await callAudioOutput.showPicker()) return;
    setOutputs(await callAudioOutput.list());
  }, []);
  const chooseOutput = useCallback(async (id: string) => {
    if (await callAudioOutput.select(id)) {
      setOutput(id);
      announce(`Playing on ${outputLabel(id)}.`);
    }
    setOutputs(null);
  }, []);

  // ── Layout ───────────────────────────────────────────────────────────
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const usable = height - insets.top - insets.bottom - CALL_CHROME;
  const orbSize = Math.round(Math.max(ORB_MIN, Math.min(ORB_MAX, width * 0.5, usable / 2.4)));

  const inCall = phase === 'connecting' || phase === 'connected' || phase === 'reconnecting';
  const orbShown: OrbState =
    phase === 'connected' ? orbState
      : phase === 'reconnecting' ? 'paused'
        : phase === 'connecting' ? 'thinking'
          : 'idle';
  const pill = pillFor(phase, orbState, muted, name);
  // The orb follows the voice only while there is one and motion is allowed.
  const metering = phase === 'connected' && !reduced && agentTrack != null;

  return (
    <Screen ambientIntensity={2.2} ambientPulse ambientDrift>
      <TopBar
        center={pill ? <CallStatusPill text={pill.text} mark={pill.mark} /> : undefined}
        // Billing carries on through a reconnect, so the clock does too.
        right={<CallTimer since={phase === 'connected' || phase === 'reconnecting' ? connectedAt : null} />}
      />
      <CallMinuteBanner balance={balanceRef.current} billedSince={billedSince} onUpgrade={plansMidCall} />

      {phase === 'error' && error ? (
        <CallErrorView
          key={error.kind}
          error={error}
          name={name}
          onRetry={retry}
          onClose={() => leave('back')}
          onPlans={() => leave('plans')}
          onText={() => leave('chat')}
        />
      ) : (
        <>
          {/* Directly under the bar, where nothing can cover it. Start of the
              call only: the 60-minute daily voice ceiling ends any call long
              before the 3-hour repeat, so raising that ceiling past 3 hours
              means adding the repeat here too. */}
          <AiNotice text={aiNoticeText(name, false, false)} />
          <OrbStage
            arrive={stageReturns}
            name={name}
            accent={accent}
            intensity={orbIntensity}
            size={orbSize}
            state={orbShown}
            dimmed={phase === 'ended' || (phase === 'connected' && muted)}
            level={level}
            ended={phase === 'ended'}
            talkedSeconds={phase === 'ended' && connectedAt != null && endedAt != null ? (endedAt - connectedAt) / 1000 : null}
          />
          {inCall || phase === 'ended' ? (
            <View style={styles.controls}>
              <CallControl
                icon="mute"
                caption="Mute"
                checked={muted}
                disabled={phase !== 'connected'}
                onPress={onMute}
              />
              <CallControl
                icon="speaker"
                caption="Audio"
                label="Audio output"
                hint="Choose where the call plays"
                disabled={!inCall}
                onPress={onAudio}
              />
              <CallControl
                icon="chat"
                caption="End & text"
                label={`End call and text ${name}`}
                disabled={phase !== 'connecting' && phase !== 'connected'}
                onPress={endAndText}
              />
              <CallControl icon="close" caption="End" label="End call" danger disabled={!inCall} onPress={endCall} />
            </View>
          ) : null}
        </>
      )}

      {metering && agentTrack ? <AudioLevelProbe track={agentTrack} level={level} /> : null}

      <Sheet
        visible={phase === 'permission'}
        onClose={() => leave('back')}
        title="Evarna needs your microphone"
        footer={
          <>
            <PrimaryButton onPress={onAllowMic} loading={asking}>Continue</PrimaryButton>
            <PrimaryButton variant="text" onPress={() => leave('back')}>Not now</PrimaryButton>
          </>
        }
      >
        <Txt variant="body" style={styles.sheetBody}>
          {`So ${name} can hear you. The mic is only on during a call, and you can mute it at any time.`}
        </Txt>
      </Sheet>

      {Platform.OS === 'android' ? (
        <Sheet visible={outputs != null} onClose={() => setOutputs(null)} title="Play the call on">
          {outputs && outputs.length > 0 ? (
            <View accessibilityRole="radiogroup" style={styles.outputs}>
              {outputs.map(id => (
                <Pill key={id} selected={id === output} onPress={() => void chooseOutput(id)}>{outputLabel(id)}</Pill>
              ))}
            </View>
          ) : (
            <Txt variant="callout" style={styles.sheetBody}>No other speakers or headphones are connected.</Txt>
          )}
        </Sheet>
      ) : null}
    </Screen>
  );
}

function pillFor(phase: CallPhase, orbState: OrbState, muted: boolean, name: string): { text: string; mark: PillMark } | null {
  switch (phase) {
    case 'connecting': return { text: 'Connecting…', mark: 'calm' };
    case 'reconnecting': return { text: 'Reconnecting…', mark: 'reconnecting' };
    case 'connected':
      if (muted) return { text: 'Muted', mark: 'muted' };
      if (orbState === 'speaking') return { text: name, mark: 'voice' };
      if (orbState === 'listening') return { text: 'Listening…', mark: 'calm' };
      if (orbState === 'thinking') return { text: 'Thinking…', mark: 'calm' };
      return { text: name, mark: 'calm' };
    // The permission sheet, the ended line and the error screen say it themselves.
    default: return null;
  }
}

const OUTPUT_LABELS: Record<string, string> = {
  speaker: 'Speaker',
  earpiece: 'Phone',
  headset: 'Headphones',
  bluetooth: 'Bluetooth',
};
const outputLabel = (id: string) => OUTPUT_LABELS[id] ?? id;

// ─── Orb stage ───────────────────────────────────────────────────────────
function OrbStage({ arrive, name, accent, intensity, size, state, dimmed, level, ended, talkedSeconds }: {
  /** Fade in on mount. */
  arrive: boolean;
  name: string; accent: string; intensity: number; size: number; state: OrbState; dimmed: boolean;
  level: SharedValue<number>; ended: boolean; talkedSeconds: number | null;
}) {
  const [entering] = useState(() => (arrive ? enter.fade : undefined));
  const [exiting] = useState(() => exit.fade);
  const box = size * ORB_BOX;
  const halo = size * 3;
  const haloStops = useMemo<GlowStop[]>(() => [
    { offset: 0, color: accent, opacity: 0.3 },
    { offset: 0.55, color: accent, opacity: 0 },
  ], [accent]);

  return (
    <Animated.View entering={entering} exiting={exiting} style={styles.stage}>
      <View style={{ width: box, height: box }}>
        {/* A wide accent wash behind the orb, overflowing like its glow. */}
        <View pointerEvents="none" style={[styles.halo, { width: halo, height: halo, left: (box - halo) / 2, top: (box - halo) / 2 }]}>
          <RadialGlow width={halo} height={halo} stops={haloStops} />
        </View>
        <Orb state={state} size={size} box={ORB_BOX} accent={accent} intensity={intensity} level={level} dimmed={dimmed} />
      </View>
      <View style={styles.nameRow}>
        <View style={[styles.nameDot, { backgroundColor: accent }, ELEV.glow(accent, 10, 1)]} />
        <Txt variant="title2" numberOfLines={1} heading style={styles.name}>{name}</Txt>
      </View>
      {ended ? <EndedLine seconds={talkedSeconds} /> : null}
    </Animated.View>
  );
}

function EndedLine({ seconds }: { seconds: number | null }) {
  const [entering] = useState(() => enter.fade);
  return (
    <Animated.View entering={entering}>
      <Txt variant="subhead" style={styles.ended}>
        {seconds != null ? `Call ended · ${formatClock(seconds)}` : 'Call ended'}
      </Txt>
    </Animated.View>
  );
}

// ─── Errors ──────────────────────────────────────────────────────────────
type ErrorAction = 'retry' | 'settings' | 'plans' | 'text' | 'close';

// Limits and refusals are cautions, not failures.
const WARNING_KINDS = new Set<CallErrorKind>(['quota-exhausted', 'limit', 'daily-limit', 'rate-limited', 'mic-permission', 'call-in-progress']);

/**
 * What to say and offer for each kind of failure. The offer has to match the
 * cause: "Try again" for a spent balance repeats a request that cannot
 * succeed; "See plans" for an abuse ceiling sells something that would not
 * lift it. Keyed on the real CallErrorKind, so a new kind can't silently land
 * in the "Try again" branch.
 */
const ERROR_COPY: Record<CallErrorKind, { icon: IconName; title: (name: string) => string; body: (name: string) => string; actions: ErrorAction[] }> = {
  'mic-permission': {
    icon: 'mute',
    title: () => 'Microphone is off',
    body: name => `To talk with ${name}, allow Evarna to use the microphone in Settings.`,
    actions: ['settings', 'close'],
  },
  offline: {
    icon: 'wifi-off',
    title: () => "You're offline",
    body: () => 'Check your connection, then try again.',
    actions: ['retry', 'close'],
  },
  connect: {
    icon: 'phone',
    title: () => "Couldn't connect",
    body: () => "The call didn't go through. Please try again.",
    actions: ['retry', 'close'],
  },
  'agent-timeout': {
    icon: 'phone',
    title: name => `${name} didn't pick up`,
    body: () => "That one's on our side. Please try again in a moment.",
    actions: ['retry', 'close'],
  },
  lost: {
    icon: 'wifi-off',
    title: () => 'Call dropped',
    body: () => 'The call was cut off.',
    actions: ['retry', 'close'],
  },
  'quota-exhausted': {
    icon: 'clock',
    title: () => "You're out of voice minutes",
    body: () => "You've used all your voice minutes until they reset.",
    actions: ['plans', 'text', 'close'],
  },
  'call-in-progress': {
    icon: 'phone',
    title: () => 'Already on a call',
    body: () => 'End your other call, then try again.',
    actions: ['retry', 'close'],
  },
  limit: {
    icon: 'clock',
    title: () => "Can't call right now",
    body: () => "You've reached a limit for calls. You can still text.",
    actions: ['text', 'close'],
  },
  'daily-limit': {
    icon: 'clock',
    title: () => "Today's call time is up",
    body: name => `You've reached today's limit for voice calls. You can call ${name} again within 24 hours, or keep talking by text.`,
    actions: ['text', 'close'],
  },
  'rate-limited': {
    icon: 'clock',
    title: () => 'One moment',
    body: () => 'Too many calls in a short time. Please wait a little before trying again.',
    actions: ['retry', 'close'],
  },
  unavailable: {
    icon: 'phone',
    title: () => "Can't start this call",
    body: () => 'Please go back and try again.',
    actions: ['close'],
  },
};

const BUTTON_VARIANTS = ['primary', 'secondary', 'text'] as const;

function CallErrorView({ error, name, onRetry, onClose, onPlans, onText }: {
  error: CallError; name: string;
  onRetry: () => void; onClose: () => void; onPlans: () => void; onText: () => void;
}) {
  const copy = ERROR_COPY[error.kind];
  const title = copy.title(name);
  const body = error.message ?? copy.body(name);
  const [entering] = useState(() => enter.fadeUp);

  // A rate limit says how long to wait; the retry counts it down.
  const [wait, setWait] = useState(() => Math.max(0, Math.ceil(error.retryAfter ?? 0)));
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  useEffect(() => {
    announce(`${title}. ${body}`);
  }, [title, body]);

  const button = (action: ErrorAction): { label: string; onPress: () => void; disabled?: boolean } => {
    switch (action) {
      case 'retry':
        return {
          label: wait > 0 ? `Try again in ${wait}s` : error.kind === 'lost' ? 'Call again' : 'Try again',
          onPress: onRetry,
          disabled: wait > 0,
        };
      case 'settings': return { label: 'Open Settings', onPress: () => void Linking.openSettings() };
      case 'plans': return { label: 'See plans', onPress: onPlans };
      case 'text': return { label: 'Text instead', onPress: onText };
      case 'close': return { label: 'Close', onPress: onClose };
    }
  };

  return (
    <Animated.View entering={entering} style={styles.error}>
      <View style={styles.errorIcon}>
        <NavIcon name={copy.icon} color={W.text2} size={26} />
      </View>
      <Txt variant="title3" heading style={styles.errorTitle}>{title}</Txt>
      <Txt variant="callout" style={styles.errorBody}>{body}</Txt>
      <View style={styles.errorActions}>
        {copy.actions.map((action, i) => {
          const b = button(action);
          return (
            <PrimaryButton
              key={action}
              variant={BUTTON_VARIANTS[Math.min(i, BUTTON_VARIANTS.length - 1)]}
              onPress={b.onPress}
              disabled={b.disabled}
            >
              {b.label}
            </PrimaryButton>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl },
  halo: { position: 'absolute' },
  nameRow: { marginTop: SP.md, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: SP.sm2 },
  nameDot: { width: 6, height: 6, borderRadius: 3 },
  name: { flexShrink: 1, color: W.cream },
  ended: { marginTop: SP.xs2, color: W.text2, textAlign: 'center' },

  controls: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: SP.base, paddingTop: SP.md, paddingBottom: SP.xl },

  sheetBody: { color: W.text2 },
  outputs: { gap: SP.sm2 },

  error: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: SP.xl, paddingBottom: SP.xl },
  errorIcon: {
    width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, backgroundColor: rgba(W.text3, 0.12), borderColor: rgba(W.text3, 0.2),
  },
  errorTitle: { marginTop: SP.base, textAlign: 'center' },
  errorBody: { marginTop: SP.sm, textAlign: 'center', color: W.text2, maxWidth: 340 },
  errorActions: { marginTop: SP.xl, width: '100%', maxWidth: 360, gap: SP.sm2 },
});
