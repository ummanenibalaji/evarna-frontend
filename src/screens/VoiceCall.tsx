// VoiceCall.tsx — S12 Voice Call.
// Ported from chat.jsx (S12); lived in Chat.tsx until the call screen grew
// enough to own a file. Web CSS (radial-gradients, backdrop blur, keyframes)
// is expressed with RadialGlow / Animated equivalents.

import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, Animated, Easing, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useVoiceCall } from '../hooks/useVoiceCall';
import type { CallError } from '../lib/voiceCall';
import { LOW_BALANCE_SECONDS } from '../lib/entitlement';
import { useWave, usePressScale } from '../theme/animations';
import { Screen, TopBar } from '../components/Chrome';
import { AmbientBg } from '../components/AmbientBg';
import { RadialGlow } from '../components/RadialGlow';
import { Orb } from '../components/Orb';
import { NavIcon, IconName } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { GlassPill, PrimaryButton, MinuteWarningBanner } from '../components/Atoms';
import { AiNotice } from '../components/ChatBits';
import { aiNoticeText } from '../lib/aiNotice';
import { W, GRAD, rgba } from '../theme/theme';
import { Companion } from '../data/config';
import { Go } from '../navigation/types';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

// ─── S12 VOICE CALL ──────────────────────────────────────────────────────
interface VoiceCallProps {
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
}

export function S12_VoiceCall({ go, companion, accent = W.primary, orbIntensity = 1, voiceSecondsRemaining = null, userId, characterId, onOutOfMinutes, onCallEnded }: VoiceCallProps) {
  const [time, setTime] = useState(0);
  const navigatedRef = useRef(false);
  const goHome = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    onCallEnded?.();
    go('home');
  };
  const { phase, orbState, muted, error, toggleMute, hangUp, retry } = useVoiceCall({
    userId,
    characterId,
    enabled: true,
    onEnded: goHome,
    callTitle: companion.name,
  });

  // Real seconds, not a config enum. This used to be 5 or 1 depending on a
  // constant, which is why the banner never appeared for anyone. Rounded UP:
  // someone with 40 seconds left has a minute of call, and "0 minutes
  // remaining" mid-call while they are still talking is a lie.
  const minutesLeft =
    voiceSecondsRemaining != null && voiceSecondsRemaining <= LOW_BALANCE_SECONDS
      ? Math.max(0, Math.ceil(voiceSecondsRemaining / 60))
      : null;

  // session timer — only counts up while connected
  useEffect(() => {
    if (phase !== 'connected') return;
    const t = setInterval(() => setTime(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Hangup → tear down LiveKit, then navigate. The hook's onEnded fires after
  // teardown completes; we route through goHome so taps and remote disconnects
  // converge on a single navigation.
  const handleEnd = async () => {
    await hangUp();
    goHome();
  };

  const pillText = derivePillText(phase, orbState, companion.name, error);

  return (
    <Screen ambient={false}>
      <AmbientBg intensity={2.2} includePulse />
      {/* extra accent halo behind orb */}
      <View pointerEvents="none" style={{ position: 'absolute', top: '20%', left: '50%', marginLeft: -300, width: 600, height: 600 }}>
        <RadialGlow
          width={600}
          height={600}
          stops={[
            { offset: 0, color: accent, opacity: 0.3 },
            { offset: 0.55, color: W.bg, opacity: 0 },
          ]}
        />
      </View>
      <TopBar
        left={
          <Pressable onPress={handleEnd}>
            <NavIcon name="down" color={W.text2} />
          </Pressable>
        }
        center={
          <View style={{ height: 30, borderRadius: 15, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <BlurPill>
              {phase === 'connected' && orbState === 'speaking'
                ? <Equalizer />
                : <NavIcon name="sparkle" color={phase === 'reconnecting' ? W.danger : W.violet} size={14} />}
              <Txt font="user" weight={500} style={{ fontSize: 12, color: '#D8CCD1' }}>{pillText}</Txt>
            </BlurPill>
          </View>
        }
        right={<Txt font="user" style={{ fontSize: 11, color: W.text2, opacity: 0.5 }}>{fmt(time)}</Txt>}
      />
      {/* onOutOfMinutes, not go('paywall'): `go` captures 'call' as the back
          target, so closing the sheet would return here and start a second
          billed call. */}
      {minutesLeft != null && <MinuteWarningBanner minutes={minutesLeft} onUpgrade={() => (onOutOfMinutes ? onOutOfMinutes() : go('paywall'))} />}

      {phase === 'error' && error ? (
        <CallErrorView error={error} onRetry={retry} onCancel={handleEnd} onUpgrade={onOutOfMinutes} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Orb state={orbState} size={200} accent={accent} intensity={orbIntensity} />
          <View style={{ marginTop: -20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: W.primary, shadowColor: W.primary, shadowOpacity: 1, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }} />
            <Txt font="display" weight={600} style={{ fontSize: 24, color: W.cream, letterSpacing: -0.3 }}>{companion.name}</Txt>
          </View>
          {/* Start of the call only. No 3-hour repeat: the 60-minute daily voice
              ceiling ends any call long before, so raising that ceiling past 3
              hours means adding the repeat here too. */}
          <AiNotice text={aiNoticeText(companion.name, false, false)} />
        </View>
      )}

      {/* Floating glass control pill */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 80, alignItems: 'center' }}>
        <GlassPill style={{ padding: 10, gap: 12 }}>
          <CallBtn icon="chat" size={54} onPress={() => { void hangUp(); navigatedRef.current = true; go('chat'); }} />
          <CallBtn icon="close" bg={W.danger} size={64} onPress={handleEnd} />
          <CallBtn icon={muted ? 'mute' : 'mic'} size={54} active={muted} onPress={toggleMute} />
        </GlassPill>
      </View>
    </Screen>
  );
}

function derivePillText(phase: ReturnType<typeof useVoiceCall>['phase'], orbState: ReturnType<typeof useVoiceCall>['orbState'], companionName: string, error?: CallError | null): string {
  if (phase === 'connecting') return 'Connecting…';
  if (phase === 'reconnecting') return 'Reconnecting…';
  if (phase === 'ended') return 'Call ended';
  // A refusal is not a connection issue, and saying so above a message that
  // explains the real reason just contradicts it.
  if (phase === 'error' && error?.kind === 'quota-exhausted') return 'No minutes left';
  if (phase === 'error' && error?.kind === 'call-in-progress') return 'Call in progress';
  if (phase === 'error') return 'Connection issue';
  // connected — orbState-driven
  if (orbState === 'speaking') return companionName;
  if (orbState === 'listening') return 'Listening…';
  if (orbState === 'thinking') return 'Thinking…';
  return companionName;
}

/**
 * What to offer for each kind of failure. Typed on the real CallError, not a
 * structural copy of it — the copy is why a new kind could be added to the
 * union and silently land in the "Try again" branch.
 */
function CallErrorView({ error, onRetry, onCancel, onUpgrade }: { error: CallError; onRetry: () => void; onCancel: () => void; onUpgrade?: () => void }) {
  const isPermission = error.kind === 'mic-permission';
  const isSpent = error.kind === 'quota-exhausted';
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <Txt font="comp" weight={600} style={{ fontSize: 20, color: W.text, textAlign: 'center', marginBottom: 12 }}>
        {isPermission ? 'Microphone needed'
          : isSpent ? "You're out of voice minutes"
          : error.kind === 'call-in-progress' ? 'Already on a call'
          : error.kind === 'limit' ? "Can't call right now"
          : "Couldn't connect"}
      </Txt>
      <Txt font="user" style={{ fontSize: 14, color: W.text2, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
        {error.message}
      </Txt>
      {/* PrimaryButton is width:100%, so it needs a flex parent of its own —
          without this it pushes Cancel off the right edge. */}
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          {/* The offer has to match the cause. "Try again" for an exhausted
              balance repeats a request that cannot succeed; "See plans" for an
              abuse ceiling sells something that would not lift it. */}
          <PrimaryButton
            onPress={
              isPermission ? () => Linking.openSettings()
                : isSpent ? () => onUpgrade?.()
                : error.kind === 'limit' ? onCancel
                : onRetry
            }
          >
            {isPermission ? 'Open Settings' : isSpent ? 'See plans' : error.kind === 'limit' ? 'Close' : 'Try again'}
          </PrimaryButton>
        </View>
        <Pressable
          onPress={onCancel}
          style={{ paddingHorizontal: 18, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)' }}
        >
          <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Cancel</Txt>
        </Pressable>
      </View>
    </View>
  );
}

// Three bars bouncing out of phase — the call's "they're talking now" mark.
function Equalizer() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 12 }}>
      {[W.coral, '#FF7A8A', W.violet].map((c, i) => <EqBar key={c} color={c} delay={i * 180} />)}
    </View>
  );
}
function EqBar({ color, delay }: { color: string; delay: number }) {
  const wave = useWave(delay);
  return <Animated.View style={[{ width: 2.5, height: 12, borderRadius: 1.25, backgroundColor: color }, wave]} />;
}

function BlurPill({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(34,22,26,0.60)' }}>
      {children}
    </View>
  );
}

function Word({ word, index }: { word: string; index: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 360, delay: index * 60, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.Text
      style={{
        opacity: v, color: '#E8DEE1', fontFamily: 'Manrope_500Medium', fontSize: 16, lineHeight: 24,
        marginRight: 6, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
      }}
    >
      {word}
    </Animated.Text>
  );
}

function CallBtn({ icon, onPress, bg, active, size = 52 }: { icon: IconName; onPress?: () => void; bg?: string; active?: boolean; size?: number }) {
  const isDanger = bg === W.danger;
  const press = usePressScale(0.9);
  const content = (
    <NavIcon name={icon} color={isDanger ? '#fff' : active ? W.dangerSoft : '#EDE4E7'} size={isDanger ? 24 : 21} />
  );
  if (bg) {
    return (
      <Animated.View style={press.style}>
        <Pressable
          onPress={onPress}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          style={{
            width: size, height: size, borderRadius: size / 2,
            alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            shadowColor: isDanger ? W.dangerSoft : '#000', shadowOpacity: isDanger ? 0.5 : 0, shadowRadius: 28, shadowOffset: { width: 0, height: 10 },
          }}
        >
          <LinearGradient
            colors={isDanger ? [...GRAD.danger] : [bg, bg]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
          {content}
        </Pressable>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={press.style}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={{
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: active ? rgba(W.danger, 0.18) : 'rgba(255,255,255,0.06)',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        {content}
      </Pressable>
    </Animated.View>
  );
}
