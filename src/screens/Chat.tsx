// Chat.tsx — S09 First Conversation, S13 Voice Note, S14 Chat.
// (S12 Voice Call lives in VoiceCall.tsx.)
// Ported from home.jsx (S09) + chat.jsx (S13–S14). UI kept identical to the
// prototype; web CSS (radial-gradients, backdrop blur, keyframes) is expressed
// with RadialGlow / BlurView / Animated equivalents.

import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, Animated, Easing, TextInput } from 'react-native';
import { limitMessage } from '../api/client';
import { LinearGradient } from 'expo-linear-gradient';
import { startSession, endSession, getCharacterSessions, getConversationTurns, getMemories, createReport, ReportReason } from '../api';
import { streamConversation, type SseErrorInfo } from '../api/client';
import { dropRefusedTurn, restoreDraft } from '../lib/chatTurns';
import { usePressScale, useLoop } from '../theme/animations';
import { Screen, TopBar } from '../components/Chrome';
import { NavIcon } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { Pill, PrimaryButton, MemoryBadge, QuickReply } from '../components/Atoms';
import { AiNotice, useAiNoticeRepeat, Bubble, BubbleMem, ChatInput, TypingDots, CapHitCard, Coachmark, RecallIndicator, DayDivider } from '../components/ChatBits';
import { aiNoticeText } from '../lib/aiNotice';
import { Avatar } from '../components/Avatar';
import { W, GRAD, rgba } from '../theme/theme';
import { ARCHETYPE_LABEL, Companion, QUICK_REPLIES } from '../data/config';
import { Go } from '../navigation/types';

/**
 * Hitting the daily message cap is not a failure to reach the server, and it
 * must not be rendered as one. It used to arrive as the string "HTTP 429" and
 * come out of the companion's mouth as "(Couldn't reach the server — please
 * try again.)" — the companion apologising for a product limit.
 */
export const messageLimitOf = (
  info?: SseErrorInfo,
): { message?: string; planCap: boolean } | null => {
  if (info?.code === 'DAILY_MESSAGE_CAP') return { planCap: true };
  // The server's abuse ceilings (a burst per minute, a rolling day) land here.
  // They are not a plan limit, so no upsell — but they are still a limit, and
  // must not come out of the companion's mouth either.
  if (info?.code === 'USAGE_LIMIT_REACHED') {
    return info.serverMessage ? { message: info.serverMessage, planCap: false } : { planCap: false };
  }
  return null;
};

type Msg = {
  from: string;
  // Backend turn id for assistant replies — what a content report points at.
  turnId?: string;
  text?: string;
  memoryRefs?: string[];
  duration?: number;
  t?: string;
  streaming?: boolean;
};

// ─── S09 FIRST CONVERSATION ──────────────────────────────────────────────
export function S09_FirstChat({ go, companion, userId, characterId, isMinor = false, textRemainingToday = null, textDailyCap = null, textResetsAt = null, textUpsell = true, onQuotaRefused, onCapUpgrade }: {
  go: Go; companion: Companion; userId?: string; characterId?: string;
  /** Known minors get the break reminder California requires. */
  isMinor?: boolean;
  textRemainingToday?: number | null;
  textDailyCap?: number | null;
  textResetsAt?: string | null;
  textUpsell?: boolean;
  onQuotaRefused?: () => void;
  onCapUpgrade?: () => void;
}) {
  const [msgs, setMsgs] = useState<Msg[]>([
    { from: 'comp', text: `Hey, this is ${companion.name}. Thanks for choosing me. I'd love to get to know you — what's been on your mind today?` },
  ]);
  const [draft, setDraft] = useState('');
  const [showBadge, setShowBadge] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  useAiNoticeRepeat(() => setMsgs(m => [...m, { from: 'notice', text: aiNoticeText(companion.name, isMinor, true) }]));
  // Either the server refused this turn, or the balance we already knew about
  // says there is nothing left today.
  const [capRefused, setCapRefused] = useState<{ message?: string; planCap: boolean } | null>(null);
  const capHit = capRefused != null || (textRemainingToday != null && textRemainingToday <= 0);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<string | null>(null);
  const backendMode = !!(userId && characterId);

  const finishStreaming = (patch: Partial<Msg>) => {
    setMsgs(m => {
      const updated = [...m];
      const last = updated[updated.length - 1];
      if (last?.streaming) updated[updated.length - 1] = { ...last, ...patch, streaming: false };
      return updated;
    });
  };

  const runBackendTurn = (sid: string, text: string, userMsgCount: number) => {
    abortRef.current?.abort();
    abortRef.current = streamConversation(
      { session_id: sid, message: text },
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
          if (userMsgCount >= 1) setTimeout(() => setShowContinue(true), 600);
        },
        onCrisis: (_content) => { finishStreaming({}); go('crisis'); },
        onError: (err, info) => {
          const limited = messageLimitOf(info);
          if (limited) {
            // Take back the two bubbles this send added, and hand the text back
            // so nothing anyone typed is lost.
            setMsgs(m => dropRefusedTurn(m, text));
            setDraft(d => restoreDraft(d, text));
            setCapRefused(limited);
            onQuotaRefused?.();
            setShowContinue(true);
            return;
          }
          console.warn('[FirstChat] Stream error:', err);
          finishStreaming({ text: limitMessage(err) ?? "(Couldn't reach the server — please try again.)" });
          // A failed turn used to leave the guided chat with no way forward:
          // "Continue to home" only appeared from onDone, so an offline
          // backend trapped the user here. Offer the exit on failure too.
          setShowContinue(true);
        },
      },
    );
  };

  useEffect(() => {
    if (sessionId && pendingRef.current) {
      const text = pendingRef.current;
      pendingRef.current = null;
      runBackendTurn(sessionId, text, msgs.filter(m => m.from === 'user').length);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!userId || !characterId) return;
    let mounted = true;
    startSession(characterId, 'text')
      .then(res => {
        if (!mounted) return;
        setSessionId(res.session_id);
        sessionRef.current = res.session_id;
      })
      .catch(e => {
        console.warn('[FirstChat] Session start failed:', e);
        if (!mounted) return;
        if (pendingRef.current) {
          pendingRef.current = null;
          finishStreaming({ text: limitMessage(e) ?? "(Couldn't reach the server — please try again.)" });
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

  const send = () => {
    if (!draft.trim()) return;
    const userMsg = draft.trim();
    // A new attempt clears the last refusal: the cap resets at midnight, and a
    // card that never goes away would outlive the limit it describes.
    setCapRefused(null);
    const userMsgCount = msgs.filter(m => m.from === 'user').length;
    setMsgs(m => [...m, { from: 'user', text: userMsg }]);
    setDraft('');

    if (backendMode) {
      setMsgs(m => [...m, { from: 'comp', text: '', streaming: true }]);
      if (sessionRef.current) runBackendTurn(sessionRef.current, userMsg, userMsgCount);
      else pendingRef.current = userMsg;
      return;
    }

    setTyping(true);
    setTimeout(() => {
      const next = userMsgCount >= 1
        ? `I really enjoyed this. I'll remember everything we talked about. Come back tomorrow?`
        : `That means a lot. Tell me more — I'm listening.`;
      setTyping(false);
      setMsgs(m => [...m, { from: 'comp', text: next }]);
      setShowBadge(true);
      setTimeout(() => setShowBadge(false), 3000);
      if (userMsgCount >= 1) setTimeout(() => setShowContinue(true), 600);
    }, 1200);
  };

  return (
    <Screen>
      <TopBar
        left={
          <Pressable onPress={() => go('home')} hitSlop={8}>
            <NavIcon name="back" color={W.text2} size={20} />
          </Pressable>
        }
        center={
          <View style={{ alignItems: 'center' }}>
            <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.cream }}>{companion.name}</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>Guided first chat</Txt>
          </View>
        }
        right={
          <Pressable onPress={() => go('home')} hitSlop={8}>
            <Txt font="user" weight={500} style={{ fontSize: 13, color: W.primarySoft }}>Skip</Txt>
          </Pressable>
        }
        bg="rgba(24,16,20,0.55)"
        border
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 8 }}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <AiNotice text={aiNoticeText(companion.name, isMinor, false)} />
        {msgs.map((m, i) => {
          if (m.from === 'notice') return <AiNotice key={i} text={m.text || ''} />;
          if (m.streaming && !m.text) return <TypingDots key={i} />;
          return <Bubble key={i} from={m.from} text={m.text || ''} memoryRefs={m.memoryRefs} streaming={m.streaming} />;
        })}
        {typing && <TypingDots />}
        {capHit && (
          <View style={{ marginTop: 10 }}>
            <CapHitCard
              onUpgrade={() => { onCapUpgrade?.(); go('paywall'); }}
              dailyCap={textDailyCap}
              resetsAt={textResetsAt}
              upsell={textUpsell && (capRefused?.planCap ?? true)}
              message={capRefused?.message ?? null}
            />
          </View>
        )}
        <View style={{ alignSelf: 'center', marginTop: 6 }}>
          <MemoryBadge show={showBadge} />
        </View>
      </ScrollView>
      {showContinue ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: W.glassBar, borderTopWidth: 1, borderTopColor: W.hairline }}>
          <PrimaryButton onPress={() => go('home')}>Continue to home</PrimaryButton>
        </View>
      ) : (
        <ChatInput draft={draft} setDraft={setDraft} onSend={send} companionName={companion.name} />
      )}
    </Screen>
  );
}

// ─── S14 CHAT ────────────────────────────────────────────────────────────

// Shown only when no backend connection (pure prototype mode)
interface ChatProps {
  go: Go;
  companion: Companion;
  accent?: string;
  openMemorySheet?: (ref: string) => void;
  /** Messages left today, or null while unknown. Replaces a dev-config flag. */
  textRemainingToday?: number | null;
  textDailyCap?: number | null;
  textResetsAt?: string | null;
  /** False on a paid plan: there is nothing left to sell them. */
  textUpsell?: boolean;
  /** Re-read the entitlement after the server refuses a turn. */
  onQuotaRefused?: () => void;
  /** Tells App why the paywall is opening, so it shows the right headline. */
  onCapUpgrade?: () => void;
  userName?: string;
  firstRun?: boolean;
  userId?: string;
  characterId?: string;
  /** Known minors get the break reminder California requires. */
  isMinor?: boolean;
}

export function S14_Chat({ go, companion, accent = W.primary, openMemorySheet, textRemainingToday = null, textDailyCap = null, textResetsAt = null, textUpsell = true, onQuotaRefused, onCapUpgrade, userName = '', firstRun = false, userId, characterId, isMinor = false }: ChatProps) {
  // firstRun → the opening line, which is the companion's own and true.
  // Otherwise empty, and real history loads from the backend.
  //
  // There used to be a third branch: with no characterId this rendered a
  // scripted demo conversation — including two messages attributed to the USER
  // ("honestly, kinda nervous about tomorrow's interview"), a fake voice note,
  // and a fake memory citation. Words in the user's own mouth is the worst
  // version of this, so the branch is gone rather than gated.
  const [msgs, setMsgs] = useState<Msg[]>(
    firstRun
      ? [{ from: 'comp', text: `So — what's been on your mind lately?`, t: 'today' }]
      : [],
  );
  useAiNoticeRepeat(() => setMsgs(m => [...m, { from: 'notice', text: aiNoticeText(companion.name, isMinor, true) }]));
  const [loadingHistory, setLoadingHistory] = useState(!firstRun && !!characterId);
  const [draft, setDraft] = useState('');
  // The server refused a turn for the cap, or the known balance says there is
  // nothing left today. Either way the card appears instead of a fake apology.
  const [capRefused, setCapRefused] = useState<{ message?: string; planCap: boolean } | null>(null);
  const capHit = capRefused != null || (textRemainingToday != null && textRemainingToday <= 0);
  const [typing, setTyping] = useState(false);
  const [showBadge, setShowBadge] = useState(false);
  const [showPhoneTip, setShowPhoneTip] = useState(firstRun);
  const [showMemoryTip, setShowMemoryTip] = useState(false);
  // How much of the user this companion is holding — shown in the header, and
  // the reason the design puts memory in gold everywhere else.
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [seenFirstMemory, setSeenFirstMemory] = useState(false);
  // Long-pressed assistant turn awaiting a report (Apple Guideline 1.2).
  const [reportTurn, setReportTurn] = useState<string | null>(null);
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
      { session_id: sid, message: text },
      {
        onChunk: (content) => {
          setMsgs(m => {
            const updated = [...m];
            const last = updated[updated.length - 1];
            if (last?.streaming) updated[updated.length - 1] = { ...last, text: (last.text ?? '') + content };
            return updated;
          });
        },
        onDone: (turnId) => {
          finishStreaming({ turnId });
          setShowBadge(true);
          setTimeout(() => setShowBadge(false), 3000);
        },
        onCrisis: (_content) => { finishStreaming({}); go('crisis'); },
        onError: (err, info) => {
          const limited = messageLimitOf(info);
          if (limited) {
            setMsgs(m => dropRefusedTurn(m, text));
            setDraft(d => restoreDraft(d, text));
            setCapRefused(limited);
            onQuotaRefused?.();
            return;
          }
          console.warn('[Chat] Stream error:', err);
          finishStreaming({ text: limitMessage(err) ?? "(Couldn't reach the server — please try again.)" });
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
    startSession(characterId, 'text')
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
          finishStreaming({ text: limitMessage(e) ?? "(Couldn't reach the server — please try again.)" });
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
            turnId: t._id,
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
    if (!characterId) return;
    let cancelled = false;
    getMemories(characterId)
      .then(ms => { if (!cancelled) setMemoryCount(ms.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [characterId]);

  useEffect(() => {
    if (!showPhoneTip) return;
    const t = setTimeout(() => setShowPhoneTip(false), 5000);
    return () => clearTimeout(t);
  }, [showPhoneTip]);

  // Autoscroll follows new content only while the user is already near the
  // bottom; scrolling up to reread history must never be hijacked by a
  // streaming reply. animated:false — an animated scroll restarted on every
  // streamed token visibly jitters.
  const nearBottomRef = useRef(true);
  const callPress = usePressScale(0.93);

  const send = () => {
    if (!draft.trim()) return;
    const text = draft.trim();
    // A new attempt clears the last refusal — see S09.
    setCapRefused(null);
    nearBottomRef.current = true;
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
      {/* Header — presence first: who you're talking to, whether they're
          here, and how much of you they hold (memory count). */}
      <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <LinearGradient
          pointerEvents="none"
          colors={['transparent', rgba(W.coral, 0.35), rgba(W.violet, 0.3), 'transparent']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 }}
        />
        <Pressable onPress={() => {
          const hasTalked = !firstRun && backendMode && msgs.some(m => m.from === 'user');
          go(hasTalked ? 'recap' : 'home');
        }} hitSlop={8}>
          <NavIcon name="back" color={W.text2} size={20} />
        </Pressable>

        <Pressable onPress={() => go('profile')}>
          <Avatar name={companion.name} color={accent} size={40} image={companion.image} breathe={false} />
        </Pressable>

        <Pressable onPress={() => go('profile')} style={{ flex: 1 }}>
          <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.cream, letterSpacing: -0.2 }}>{companion.name}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 1 }}>
            <View style={{
              width: 5, height: 5, borderRadius: 2.5, backgroundColor: W.success,
              shadowColor: W.success, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
            }} />
            <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>
              Online · <Txt font="user" style={{ fontSize: 11, color: W.gold }}>
                {memoryCount != null ? `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}` : ARCHETYPE_LABEL[companion.archetype]}
              </Txt>
            </Txt>
          </View>
        </Pressable>

        <View>
          <Animated.View style={callPress.style}>
          <Pressable
            onPress={() => { setShowPhoneTip(false); go('call'); }}
            onPressIn={callPress.onPressIn}
            onPressOut={callPress.onPressOut}
            style={{
              flexDirection: 'row', alignItems: 'center', gap: 7,
              paddingVertical: 9, paddingHorizontal: 16, borderRadius: 20,
              overflow: 'hidden',
              shadowColor: W.rose, shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 8 },
            }}
          >
            <LinearGradient
              colors={[...GRAD.aurora]}
              locations={[0, 0.6, 1]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
            />
            <NavIcon name="phone" color="#fff" size={14} />
            <Txt font="user" weight={700} style={{ fontSize: 12.5, color: '#fff' }}>Call</Txt>
            {showPhoneTip && <PhoneHalo />}
          </Pressable>
          </Animated.View>
          {showPhoneTip && (
            <Coachmark
              text={`Tap to talk to ${companion.name} with your voice`}
              onDismiss={() => setShowPhoneTip(false)}
              style={{ top: '100%', right: 0, marginTop: 12 }}
            />
          )}
        </View>
      </View>
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}
        onScroll={({ nativeEvent: { contentOffset, contentSize, layoutMeasurement } }) => {
          nearBottomRef.current =
            contentSize.height - (contentOffset.y + layoutMeasurement.height) < 80;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          if (nearBottomRef.current) scrollRef.current?.scrollToEnd({ animated: false });
        }}
      >
        {loadingHistory
          ? <SkeletonBubbles />
          : <>
              <AiNotice text={aiNoticeText(companion.name, isMinor, false)} />
              {msgs.length > 0 && <DayDivider />}
              {msgs.map((m, i) => {
                // Consecutive same-sender messages group: tighter gap so a
                // thread reads as exchanges, not an undifferentiated stack.
                const grouped = i > 0 && msgs[i - 1].from === m.from;
                const gap = { marginTop: grouped ? 2 : 10 };
                if (m.from === 'notice') return <View key={i} style={gap}><AiNotice text={m.text || ''} /></View>;
                // While a streamed reply has no text yet, show the typing indicator
                // instead of an empty bubble; it swaps to text once tokens arrive.
                if (m.streaming && !m.text)
                  return (
                    <View key={i} style={[{ gap: 6 }, gap]}>
                      <RecallIndicator />
                      <TypingDots />
                    </View>
                  );
                // Long-press only on companion messages, and only once the turn
                // has an id — there is nothing to report until the backend has
                // persisted it.
                return <View key={i} style={gap}><BubbleMem from={m.from} text={m.text || ''} memoryRefs={m.memoryRefs} accent={accent} onMemoryClick={openMemorySheet} streaming={m.streaming}
                  onLongPress={m.from === 'comp' && m.turnId ? () => setReportTurn(m.turnId!) : undefined} /></View>;
              })}
              {typing && <View style={{ marginTop: 10 }}><TypingDots /></View>}
            </>
        }
        <View style={{ alignSelf: 'center', marginTop: 6 }}>
          <MemoryBadge show={showBadge} />
          {showMemoryTip && (
            <View
              style={{
                marginTop: 10, width: 240, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12,
                backgroundColor: 'rgba(32,22,26,0.85)', borderWidth: 1, borderColor: 'rgba(255,201,96,0.22)',
              }}
            >
              <Txt font="user" style={{ fontSize: 12, color: W.text, lineHeight: 18 }}>
                This is how {companion.name} remembers you. Tap any <Txt font="user" weight={500} style={{ color: W.gold }}>gold phrase</Txt> to see what they recall.
              </Txt>
            </View>
          )}
        </View>
        {capHit && (
          <View style={{ marginTop: 10 }}>
            <CapHitCard
              onUpgrade={() => { onCapUpgrade?.(); go('paywall'); }}
              dailyCap={textDailyCap}
              resetsAt={textResetsAt}
              upsell={textUpsell && (capRefused?.planCap ?? true)}
              message={capRefused?.message ?? null}
            />
          </View>
        )}
      </ScrollView>
      {/* Quick replies — only offered when the thread is idle and the user
          hasn't started typing, so they never compete with a live draft. */}
      {!draft.trim() && !typing && !msgs.some(m => m.streaming) ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}
        >
          {QUICK_REPLIES.map(q => (
            <QuickReply key={q} onPress={() => { setDraft(q); }}>{q}</QuickReply>
          ))}
        </ScrollView>
      ) : null}
      {reportTurn && <ReportSheet turnId={reportTurn} onClose={() => setReportTurn(null)} />}
      <ChatInput draft={draft} setDraft={setDraft} onSend={send} companionName={companion.name} />
    </Screen>
  );
}

// ─── ReportSheet — report an AI reply (long-press a companion message) ────
const REPORT_REASONS: { k: ReportReason; l: string }[] = [
  { k: 'harmful', l: 'Harmful or unsafe' },
  { k: 'sexual', l: 'Sexual content' },
  { k: 'inappropriate_minor', l: 'Inappropriate for a minor' },
  { k: 'inaccurate', l: 'Inaccurate' },
  { k: 'other', l: 'Something else' },
];

function ReportSheet({ turnId, onClose }: { turnId: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');

  const submit = async () => {
    if (!reason || state !== 'idle') return;
    setState('sending');
    try {
      await createReport(turnId, reason, note.trim() || undefined);
      setState('sent');
      setTimeout(onClose, 1200);
    } catch (e) {
      console.warn('[Report] failed:', e);
      setState('idle');
    }
  };

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,9,13,0.6)', zIndex: 60, justifyContent: 'flex-end' }}>
      <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', backgroundColor: 'rgba(19,21,30,0.96)' }}>
        <View style={{ paddingHorizontal: 24, paddingTop: 14, paddingBottom: 32 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 18 }} />
          {state === 'sent' ? (
            <Txt font="comp" weight={600} style={{ fontSize: 18, color: W.cream, textAlign: 'center', paddingVertical: 16 }}>Thanks — we'll review it.</Txt>
          ) : (
            <>
              <Txt font="comp" weight={600} style={{ fontSize: 20, color: W.cream, letterSpacing: -0.3 }}>Report this reply</Txt>
              <Txt font="user" style={{ marginTop: 8, fontSize: 13, color: W.text2, lineHeight: 20 }}>What was wrong with it?</Txt>
              <View style={{ marginTop: 14, gap: 8 }}>
                {REPORT_REASONS.map(r => (
                  <Pill key={r.k} active={reason === r.k} onPress={() => setReason(r.k)} style={{ height: 40 }} textStyle={{ fontSize: 13 }}>{r.l}</Pill>
                ))}
              </View>
              <TextInput
                value={note} onChangeText={(v) => setNote(v.slice(0, 1000))} placeholder="Add a note (optional)" placeholderTextColor={W.text2} multiline
                style={{ marginTop: 12, minHeight: 60, backgroundColor: 'rgba(37,40,54,0.7)', color: W.text, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', borderRadius: 10, paddingHorizontal: 14, paddingTop: 10, fontFamily: 'Outfit_400Regular', fontSize: 14 }} />
              <View style={{ marginTop: 12, opacity: reason && state === 'idle' ? 1 : 0.5 }}>
                <PrimaryButton onPress={submit}>{state === 'sending' ? 'Sending…' : 'Submit report'}</PrimaryButton>
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// Shimmering placeholder bubbles while history loads. TypingDots was used
// here before, which read as "companion is typing" during a page load.
function SkeletonBubbles() {
  const v = useLoop(1600, { yoyo: true });
  const opacity = v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.75] });
  const rows: Array<{ w: number; mine?: boolean }> = [{ w: 210 }, { w: 140, mine: true }, { w: 250 }];
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r, i) => (
        <Animated.View
          key={i}
          style={{
            opacity,
            alignSelf: r.mine ? 'flex-end' : 'flex-start',
            width: r.w, height: 40, borderRadius: 18,
            backgroundColor: r.mine ? W.surface3 : W.surface2,
          }}
        />
      ))}
    </View>
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
