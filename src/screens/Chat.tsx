// Chat.tsx — S09 First Conversation, S12 Voice Call, S13 Voice Note, S14 Chat.
// Ported from home.jsx (S09) + chat.jsx (S12–S14). UI kept identical to the
// prototype; web CSS (radial-gradients, backdrop blur, keyframes) is expressed
// with RadialGlow / BlurView / Animated equivalents.

import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Animated, Easing, Linking } from 'react-native';
import { startSession, endSession, getCharacterSessions, getConversationTurns } from '../api';
import { streamConversation } from '../api/client';
import { useVoiceCall } from '../hooks/useVoiceCall';
import { Screen, TopBar } from '../components/Chrome';
import { AmbientBg } from '../components/AmbientBg';
import { RadialGlow } from '../components/RadialGlow';
import { Orb } from '../components/Orb';
import { NavIcon, IconName } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { GlassPill, PrimaryButton, MemoryBadge, MinuteWarningBanner } from '../components/Atoms';
import { Bubble, BubbleMem, ChatInput, TypingDots, VoiceNoteBubble, CapHitCard, Coachmark } from '../components/ChatBits';
import { W, alpha } from '../theme/theme';
import { ARCHETYPE_LABEL, Companion, MinutesRemaining } from '../data/config';
import { Go } from '../navigation/types';

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

type Msg = {
  from: string;
  text?: string;
  memoryRefs?: string[];
  duration?: number;
  t?: string;
  streaming?: boolean;
};

// ─── S09 FIRST CONVERSATION ──────────────────────────────────────────────
export function S09_FirstChat({ go, companion }: { go: Go; companion: Companion }) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: 'comp', text: `Hey, this is ${companion.name}. Thanks for choosing me. I'd love to get to know you — what's been on your mind today?` },
  ]);
  const [draft, setDraft] = useState('');
  const [showBadge, setShowBadge] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [msgs, typing]);

  const send = () => {
    if (!draft.trim()) return;
    const userMsg = draft.trim();
    const prevLen = msgs.length;
    setMsgs(m => [...m, { from: 'user', text: userMsg }]);
    setDraft('');
    setTyping(true);
    setTimeout(() => {
      const next = prevLen >= 2
        ? `I really enjoyed this. I'll remember everything we talked about. Come back tomorrow?`
        : `That means a lot. Tell me more — I'm listening.`;
      setTyping(false);
      setMsgs(m => [...m, { from: 'comp', text: next }]);
      setShowBadge(true);
      setTimeout(() => setShowBadge(false), 3000);
      if (prevLen >= 2) setTimeout(() => setShowContinue(true), 600);
    }, 1200);
  };

  return (
    <Screen>
      <TopBar
        center={
          <View style={{ alignItems: 'center' }}>
            <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.text }}>{companion.name}</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>Guided first chat</Txt>
          </View>
        }
        bg="rgba(15,17,26,0.55)"
        border
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 8 }}
      >
        {msgs.map((m, i) => <Bubble key={i} from={m.from} text={m.text || ''} memoryRefs={m.memoryRefs} />)}
        {typing && <TypingDots />}
        <View style={{ alignSelf: 'center', marginTop: 6 }}>
          <MemoryBadge show={showBadge} />
        </View>
      </ScrollView>
      {showContinue ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: W.surface1, borderTopWidth: 1, borderTopColor: W.surface2 }}>
          <PrimaryButton onPress={() => go('home')}>Continue to home</PrimaryButton>
        </View>
      ) : (
        <ChatInput draft={draft} setDraft={setDraft} onSend={send} companionName={companion.name} />
      )}
    </Screen>
  );
}

// ─── S12 VOICE CALL ──────────────────────────────────────────────────────
interface VoiceCallProps {
  go: Go;
  companion: Companion;
  accent?: string;
  orbIntensity?: number;
  minutesRemaining?: MinutesRemaining | 'critical';
  userId?: string;
  characterId?: string;
}

export function S12_VoiceCall({ go, companion, accent = W.primary, orbIntensity = 1, minutesRemaining = 'normal', userId, characterId }: VoiceCallProps) {
  const [time, setTime] = useState(0);
  const navigatedRef = useRef(false);
  const goHome = () => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    go('home');
  };
  const { phase, orbState, muted, error, toggleMute, hangUp, retry } = useVoiceCall({
    userId,
    characterId,
    enabled: true,
    onEnded: goHome,
  });

  const minutesLeft = minutesRemaining === 'low' ? 5 : minutesRemaining === 'critical' ? 1 : null;

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

  const pillText = derivePillText(phase, orbState, companion.name);

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
          <View style={{ height: 28, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
            <BlurPill>
              <NavIcon name="sparkle" color={phase === 'reconnecting' ? W.danger : W.secondary} size={14} />
              <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2 }}>{pillText}</Txt>
            </BlurPill>
          </View>
        }
        right={<Txt font="user" style={{ fontSize: 11, color: W.text2, opacity: 0.5 }}>{fmt(time)}</Txt>}
      />
      {minutesLeft != null && <MinuteWarningBanner minutes={minutesLeft} onTopUp={() => go('topup')} />}

      {phase === 'error' && error ? (
        <CallErrorView error={error} onRetry={retry} onCancel={handleEnd} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <Orb state={orbState} size={180} accent={accent} intensity={orbIntensity} />
          <View style={{ marginTop: -20, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: accent, shadowColor: accent, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }} />
            <Txt font="comp" weight={600} style={{ fontSize: 22, color: W.text }}>{companion.name}</Txt>
          </View>
          <BlurInCaption text={null} />
        </View>
      )}

      {/* Floating glass control pill */}
      <View style={{ paddingHorizontal: 24, paddingBottom: 80, alignItems: 'center' }}>
        <GlassPill style={{ padding: 8 }}>
          <CallBtn icon="chat" onPress={() => { void hangUp(); navigatedRef.current = true; go('chat'); }} />
          <CallBtn icon="close" bg={W.danger} size={60} onPress={handleEnd} />
          <CallBtn icon={muted ? 'mute' : 'mic'} active={muted} onPress={toggleMute} />
        </GlassPill>
      </View>
    </Screen>
  );
}

function derivePillText(phase: ReturnType<typeof useVoiceCall>['phase'], orbState: ReturnType<typeof useVoiceCall>['orbState'], companionName: string): string {
  if (phase === 'connecting') return 'Connecting…';
  if (phase === 'reconnecting') return 'Reconnecting…';
  if (phase === 'ended') return 'Call ended';
  if (phase === 'error') return 'Connection issue';
  // connected — orbState-driven
  if (orbState === 'speaking') return companionName;
  if (orbState === 'listening') return 'Listening…';
  if (orbState === 'thinking') return 'Thinking…';
  return companionName;
}

function CallErrorView({ error, onRetry, onCancel }: { error: { kind: string; message: string }; onRetry: () => void; onCancel: () => void }) {
  const isPermission = error.kind === 'mic-permission';
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <Txt font="comp" weight={600} style={{ fontSize: 20, color: W.text, textAlign: 'center', marginBottom: 12 }}>
        {isPermission ? 'Microphone needed' : "Couldn't connect"}
      </Txt>
      <Txt font="user" style={{ fontSize: 14, color: W.text2, textAlign: 'center', marginBottom: 24, lineHeight: 20 }}>
        {error.message}
      </Txt>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <PrimaryButton onPress={isPermission ? () => Linking.openSettings() : onRetry}>
          {isPermission ? 'Open Settings' : 'Try again'}
        </PrimaryButton>
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

function BlurPill({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(26,29,46,0.55)' }}>
      {children}
    </View>
  );
}

// Caption that blur-fades-in word by word (approximated: per-word fade + slight rise).
function BlurInCaption({ text }: { text: string | null }) {
  if (!text) return <View style={{ marginTop: 16, minHeight: 22 }} />;
  const words = text.split(' ');
  return (
    <View style={{ marginTop: 16, minHeight: 22, maxWidth: 280, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
      {words.map((w, i) => <Word key={`${text}-${i}`} word={w} index={i} />)}
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
        opacity: v, color: W.text, fontFamily: 'Manrope_500Medium', fontSize: 16, lineHeight: 23,
        marginRight: 6, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [4, 0] }) }],
      }}
    >
      {word}
    </Animated.Text>
  );
}

function CallBtn({ icon, onPress, bg, active, size = 52 }: { icon: IconName; onPress?: () => void; bg?: string; active?: boolean; size?: number }) {
  const isDanger = bg === W.danger;
  const content = (
    <NavIcon name={icon} color={isDanger ? '#fff' : active ? W.danger : W.text} />
  );
  if (bg) {
    return (
      <Pressable
        onPress={onPress}
        style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: bg,
          alignItems: 'center', justifyContent: 'center',
          shadowColor: isDanger ? W.danger : '#000', shadowOpacity: isDanger ? 0.5 : 0, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
        }}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: active ? 'rgba(248,113,113,0.18)' : 'rgba(255,255,255,0.06)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      {content}
    </Pressable>
  );
}

// ─── S13 VOICE NOTE — recording sheet ────────────────────────────────────
function S13_VoiceNote({ onClose, onSend }: { onClose: () => void; onSend: (t: number) => void }) {
  const [time, setTime] = useState(0);
  const breathe = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setInterval(() => setTime(s => s + 1), 1000);
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
    return () => clearInterval(t);
  }, []);
  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });
  return (
    <View
      style={{
        position: 'absolute', bottom: 64, left: 0, right: 0, zIndex: 20,
        backgroundColor: W.surface1, borderTopWidth: 1, borderTopColor: W.surface2,
        borderTopLeftRadius: 16, borderTopRightRadius: 16,
        paddingVertical: 16, paddingHorizontal: 24,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}
    >
      <Pressable onPress={onClose} style={{ padding: 6 }}>
        <NavIcon name="close" color={W.text2} />
      </Pressable>
      <Pressable onPress={() => onSend(time)}>
        <Animated.View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: W.primary, alignItems: 'center', justifyContent: 'center', transform: [{ scale }] }}>
          <NavIcon name="mic" color="#fff" />
        </Animated.View>
      </Pressable>
      <Txt font="user" style={{ fontSize: 14, color: W.text }}>{fmt(time)}</Txt>
    </View>
  );
}

// ─── S14 CHAT ────────────────────────────────────────────────────────────

// Shown only when no backend connection (pure prototype mode)
const demoMsgs = (userName: string): Msg[] => [
  { from: 'comp', text: `Hey ${userName}, how are you doing today?`, t: 'today' },
  { from: 'user', text: "honestly, kinda nervous about tomorrow's interview" },
  { from: 'comp', text: 'I remember you mentioning your interview is tomorrow. What part is making you most nervous?', memoryRefs: ['I remember you mentioning your interview is tomorrow'] },
  { from: 'user', text: "the technical round. I haven't done one in years" },
  { from: 'voiceUser', duration: 14 },
  { from: 'comp', text: "That's totally understandable. Want to do a quick mock round right now? We can keep it light." },
];

interface ChatProps {
  go: Go;
  companion: Companion;
  accent?: string;
  openMemorySheet?: (ref: string) => void;
  capHit?: boolean;
  userName?: string;
  firstRun?: boolean;
  userId?: string;
  characterId?: string;
}

export function S14_Chat({ go, companion, accent = W.primary, openMemorySheet, capHit = false, userName = 'Aria', firstRun = false, userId, characterId }: ChatProps) {
  // firstRun → fresh onboarding greeting
  // characterId available → start empty, load real history from backend
  // no characterId → show static demo (prototype mode)
  const [msgs, setMsgs] = useState<Msg[]>(
    firstRun
      ? [{ from: 'comp', text: `So — what's been on your mind lately?`, t: 'today' }]
      : characterId ? [] : demoMsgs(userName),
  );
  const [loadingHistory, setLoadingHistory] = useState(!firstRun && !!characterId);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState(false);
  const [typing, setTyping] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [showPhoneTip, setShowPhoneTip] = useState(firstRun);
  const [showMemoryTip, setShowMemoryTip] = useState(false);
  const [seenFirstMemory, setSeenFirstMemory] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Active backend session ID (null when no backend or not yet started)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Message typed before the session finished starting — streamed once it's ready.
  const pendingRef = useRef<string | null>(null);
  const backendMode = !!(userId && characterId);

  // Replace the trailing streaming placeholder with a final/error message.
  const finishStreaming = (patch: Partial<Msg>) => {
    setMsgs(m => {
      const updated = [...m];
      const last = updated[updated.length - 1];
      if (last?.streaming) updated[updated.length - 1] = { ...last, ...patch, streaming: false };
      return updated;
    });
  };

  // Stream a real backend reply for an active session. The empty streaming
  // placeholder bubble must already be appended (shows the typing dots).
  const runBackendTurn = (sid: string, text: string) => {
    abortRef.current?.abort();
    abortRef.current = streamConversation(
      { session_id: sid, character_id: characterId!, user_id: userId!, message: text },
      {
        onChunk: (content) => {
          setMsgs(m => {
            const updated = [...m];
            const last = updated[updated.length - 1];
            if (last?.streaming) updated[updated.length - 1] = { ...last, text: (last.text ?? '') + content };
            return updated;
          });
        },
        onDone: () => {
          finishStreaming({});
          setShowBadge(true);
          setTimeout(() => setShowBadge(false), 3000);
        },
        onCrisis: (content) => finishStreaming({ text: content }),
        onError: (err) => {
          console.warn('[Chat] Stream error:', err);
          finishStreaming({ text: "(Couldn't reach the server — please try again.)" });
        },
      },
    );
  };

  // Fire any queued message as soon as the session id becomes available.
  useEffect(() => {
    if (sessionId && pendingRef.current) {
      const text = pendingRef.current;
      pendingRef.current = null;
      runBackendTurn(sessionId, text);
    }
  }, [sessionId]);

  // Start a backend text session when user + character IDs are available
  useEffect(() => {
    if (!userId || !characterId) return;
    let mounted = true;
    startSession(userId, characterId, 'text')
      .then(res => {
        if (!mounted) return;
        setSessionId(res.session_id);
        sessionRef.current = res.session_id;
      })
      .catch(e => {
        console.warn('[Chat] Session start failed:', e);
        if (!mounted) return;
        // If the user already sent a message, don't leave it spinning forever.
        if (pendingRef.current) {
          pendingRef.current = null;
          finishStreaming({ text: "(Couldn't reach the server — please try again.)" });
        }
      });
    return () => {
      mounted = false;
      abortRef.current?.abort();
      if (sessionRef.current) {
        endSession(sessionRef.current).catch(() => {});
        sessionRef.current = null;
      }
    };
  }, [userId, characterId]);

  // Load conversation history from the last session that has turns.
  // Iterates sessions newest-first and stops at the first non-empty one —
  // this skips the brand-new empty session just created by startSession above.
  useEffect(() => {
    if (firstRun || !characterId) return;
    let cancelled = false;
    setLoadingHistory(true);

    (async () => {
      try {
        const { sessions } = await getCharacterSessions(characterId);
        for (const session of sessions) {
          if (cancelled) return;
          const { turns } = await getConversationTurns(session._id);
          if (turns.length === 0) continue;
          if (cancelled) return;
          setMsgs(turns.map(t => ({
            from: t.role === 'user' ? 'user' : 'comp',
            text: t.content_text,
          })));
          return;
        }
        // No prior turns found — show a fresh greeting
        if (!cancelled) {
          setMsgs([{ from: 'comp', text: `Hey ${userName}, good to have you back.` }]);
        }
      } catch {
        if (!cancelled) {
          setMsgs([{ from: 'comp', text: `Hey ${userName}, good to have you back.` }]);
        }
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();

    return () => { cancelled = true; };
  }, [characterId, firstRun]);

  useEffect(() => {
    if (!showPhoneTip) return;
    const t = setTimeout(() => setShowPhoneTip(false), 5000);
    return () => clearTimeout(t);
  }, [showPhoneTip]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [msgs, typing]);

  const send = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    const userMsgCount = msgs.filter(m => m.from === 'user').length;
    setMsgs(m => [...m, { from: 'user', text }]);
    setDraft('');

    // Backend mode: always stream a real reply. Append the streaming
    // placeholder (typing dots) now; if the session is still starting, queue
    // the message and the effect above fires it the moment the id arrives.
    if (backendMode) {
      setMsgs(m => [...m, { from: 'comp', text: '', streaming: true }]);
      if (sessionRef.current) runBackendTurn(sessionRef.current, text);
      else pendingRef.current = text;
      return;
    }

    // Fallback: simulated response only when there is no backend connection
    // at all (prototype companions with no character id).
    setTyping(true);
    setTimeout(() => {
      const isFirstReply = firstRun && userMsgCount === 0;
      const reply: Msg = isFirstReply
        ? { from: 'comp', text: `Thanks for telling me. I'll remember that — it matters to me to know what you're carrying.`, memoryRefs: ["I'll remember that"] }
        : { from: 'comp', text: `Tell me more about that — I'm here.` };
      setMsgs(m => [...m, reply]);
      setTyping(false);
      setShowBadge(true);
      if (firstRun && !seenFirstMemory) {
        setSeenFirstMemory(true);
        setShowMemoryTip(true);
        setTimeout(() => setShowMemoryTip(false), 6000);
      }
      setTimeout(() => setShowBadge(false), 3000);
    }, 1500);
  };

  return (
    <Screen>
      <TopBar
        left={
          <Pressable onPress={() => go('home')}>
            <NavIcon name="back" color={W.text2} />
          </Pressable>
        }
        center={
          <View style={{ alignItems: 'center' }}>
            <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.text }}>{companion.name}</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{ARCHETYPE_LABEL[companion.archetype]}</Txt>
          </View>
        }
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View>
              <Pressable onPress={() => { setShowPhoneTip(false); go('call'); }} style={{ padding: 4 }}>
                <NavIcon name="phone" color={W.primary} />
                {showPhoneTip && <PhoneHalo />}
              </Pressable>
              {showPhoneTip && (
                <Coachmark
                  text={`Tap to talk to ${companion.name} with your voice`}
                  onDismiss={() => setShowPhoneTip(false)}
                  style={{ top: '100%', right: 0, marginTop: 12 }}
                />
              )}
            </View>
            <Pressable onPress={() => go('profile')} style={{ padding: 4 }}>
              <NavIcon name="kebab" color={W.text2} />
            </Pressable>
          </View>
        }
        bg="rgba(15,17,26,0.6)"
        border
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 }}
      >
        {loadingHistory
          ? <TypingDots />
          : <>
              {msgs.map((m, i) => {
                if (m.from === 'voiceUser' || m.from === 'voiceComp')
                  return <VoiceNoteBubble key={i} from={m.from === 'voiceUser' ? 'user' : 'comp'} duration={m.duration} />;
                // While a streamed reply has no text yet, show the typing indicator
                // instead of an empty bubble; it swaps to text once tokens arrive.
                if (m.streaming && !m.text)
                  return <TypingDots key={i} />;
                return <BubbleMem key={i} from={m.from} text={m.text || ''} memoryRefs={m.memoryRefs} accent={accent} onMemoryClick={openMemorySheet} />;
              })}
              {typing && <TypingDots />}
            </>
        }
        <View style={{ alignSelf: 'center', marginTop: 6 }}>
          <MemoryBadge show={showBadge} />
          {showMemoryTip && (
            <View
              style={{
                marginTop: 10, width: 240, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
                backgroundColor: 'rgba(26,29,46,0.85)', borderWidth: 1, borderColor: 'rgba(94,234,212,0.22)',
              }}
            >
              <Txt font="user" style={{ fontSize: 12, color: W.text, lineHeight: 18 }}>
                This is how {companion.name} remembers you. Tap any <Txt font="user" weight={500} style={{ color: W.accent }}>teal phrase</Txt> to see what they recall.
              </Txt>
            </View>
          )}
        </View>
        {capHit && <CapHitCard onUpgrade={() => go('paywall')} />}
      </ScrollView>
      {recording && (
        <S13_VoiceNote
          onClose={() => setRecording(false)}
          onSend={(d) => { setMsgs(m => [...m, { from: 'voiceUser', duration: d || 8 }]); setRecording(false); }}
        />
      )}
      <ChatInput draft={draft} setDraft={setDraft} onSend={send} onMic={() => setRecording(true)} companionName={companion.name} />
    </Screen>
  );
}

// Pulsing ring halo around the phone icon (CSS ctaHalo keyframe).
function PhoneHalo() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(v, { toValue: 1, duration: 2600, easing: Easing.out(Easing.ease), useNativeDriver: true })).start();
  }, []);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', top: -6, left: -6, right: -6, bottom: -6, borderRadius: 12,
        borderWidth: 2, borderColor: W.primary,
        opacity: v.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.45, 0, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
      }}
    />
  );
}
