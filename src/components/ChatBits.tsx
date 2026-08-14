// ChatBits.tsx — shared chat UI: Bubble, BubbleMem (with inline memory refs),
// ChatInput, TypingDots, VoiceNoteBubble, CapHitCard, Coachmark.
// Ported from home.jsx + chat.jsx.

import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, TextInput, Animated, Easing, StyleProp, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Txt } from './Txt';
import { NavIcon } from './NavIcon';
import { MemoryRef } from './Atoms';
import { useDotPulse } from '../theme/animations';
import { W, GRAD, alpha, rgba } from '../theme/theme';

// ─── Bubble (simple, first-chat) ─────────────────────────────────────────
export function Bubble({ from, text, memoryRefs = [] }: { from: string; text: string; memoryRefs?: string[] }) {
  const isUser = from === 'user';
  return (
    <BubbleEntrance isUser={isUser}>
      <BubbleSkin isUser={isUser}>
        <RefText text={text} memoryRefs={memoryRefs} isUser={isUser} />
      </BubbleSkin>
    </BubbleEntrance>
  );
}

// ─── BubbleSkin ──────────────────────────────────────────────────────────
// The two bubble treatments, in one place:
//   companion — near-transparent glass with a coral edge-lit left border,
//               tail on the bottom-left
//   user      — a warm dark gradient, tail on the bottom-right
// Both keep the same 18px corner family so a thread reads as one material.
function BubbleSkin({ isUser, accent = W.primary, children, style }: {
  isUser: boolean; accent?: string; children: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const shape: ViewStyle = {
    borderRadius: 18,
    borderBottomLeftRadius: isUser ? 18 : 6,
    borderBottomRightRadius: isUser ? 6 : 18,
    paddingVertical: 11, paddingHorizontal: 15,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 4 },
  };

  if (isUser) {
    return (
      <View style={[shape, { borderColor: 'rgba(255,255,255,0.07)' }, style]}>
        <LinearGradient
          pointerEvents="none"
          colors={[...GRAD.userBubble]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        />
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        shape,
        {
          backgroundColor: 'rgba(255,255,255,0.055)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderLeftWidth: 2,
          borderLeftColor: rgba(accent, 0.55),
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

// Shared per-bubble entrance — rises from the appropriate side with a soft spring.
function BubbleEntrance({ isUser, children }: { isUser: boolean; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(v, { toValue: 1, useNativeDriver: true, tension: 110, friction: 14 }).start();
  }, []);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [isUser ? 8 : -8, 0] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] });
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY }, { translateX }, { scale }], alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '78%' }}>
      {children}
    </Animated.View>
  );
}

// Renders body text with memory-reference substrings tinted teal.
function RefText({
  text, memoryRefs, isUser, onMemoryClick, asMemoryRef = false,
}: {
  text: string; memoryRefs: string[]; isUser: boolean;
  onMemoryClick?: (ref: string) => void; asMemoryRef?: boolean;
}) {
  const font = isUser ? 'user' : 'comp';
  const weight = isUser ? 400 : 500;
  // The companion speaks in Manrope at a slightly looser line height — its
  // text is meant to be *read*, the user's is meant to be scanned.
  const baseStyle = isUser
    ? ({ fontSize: 15, lineHeight: 21, color: '#F2EAE7' } as const)
    : ({ fontSize: 15, lineHeight: 22, color: '#F0E7E4' } as const);

  if (!memoryRefs.length) {
    return <Txt font={font} weight={weight} style={baseStyle}>{text}</Txt>;
  }

  // Split text around each ref, in order.
  let parts: (string | { ref: string })[] = [text];
  memoryRefs.forEach(ref => {
    parts = parts.flatMap(p => {
      if (typeof p !== 'string') return [p];
      const chunks = p.split(ref);
      const out: (string | { ref: string })[] = [];
      chunks.forEach((chunk, i) => {
        out.push(chunk);
        if (i < chunks.length - 1) out.push({ ref });
      });
      return out;
    });
  });

  return (
    <Txt font={font} weight={weight} style={baseStyle}>
      {parts.map((p, i) =>
        typeof p === 'string'
          ? p
          : asMemoryRef
            ? <MemoryRef key={i} onPress={() => onMemoryClick?.(p.ref)}>{p.ref}</MemoryRef>
            : <Txt key={i} font={font} weight={500} style={{ color: W.gold }}>{p.ref}</Txt>
      )}
    </Txt>
  );
}

// ─── BubbleMem (glassy, with tappable memory refs) ───────────────────────
export function BubbleMem({
  from, text, memoryRefs = [], accent = W.primary, onMemoryClick,
}: {
  from: string; text: string; memoryRefs?: string[]; accent?: string; onMemoryClick?: (ref: string) => void;
}) {
  const isUser = from === 'user';
  return (
    <BubbleEntrance isUser={isUser}>
      <BubbleSkin isUser={isUser} accent={accent}>
        <RefText text={text} memoryRefs={memoryRefs} isUser={isUser} onMemoryClick={onMemoryClick} asMemoryRef />
      </BubbleSkin>
    </BubbleEntrance>
  );
}

// ─── ChatInput ───────────────────────────────────────────────────────────
export function ChatInput({
  draft, setDraft, onSend, onMic, companionName,
}: {
  draft: string; setDraft: (v: string) => void; onSend: () => void; onMic?: () => void; companionName: string;
}) {
  const [focused, setFocused] = useState(false);
  const focusV = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(focusV, { toValue: focused ? 1 : 0, duration: 220, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: false }).start();
  }, [focused]);
  const borderColor = focusV.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.06)', 'rgba(255,138,118,0.45)'] });
  const hasDraft = draft.trim().length > 0;

  // Animated send button reveal
  const sendV = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(sendV, { toValue: hasDraft ? 1 : 0, useNativeDriver: true, tension: 120, friction: 10 }).start();
  }, [hasDraft]);
  const sendScale = sendV;
  const sendOpacity = sendV;

  return (
    <View
      style={{
        marginHorizontal: 12, marginBottom: 10,
        padding: 8, borderRadius: 26,
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: W.glassBar,
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        overflow: 'hidden', zIndex: 2,
        shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 36, shadowOffset: { width: 0, height: 16 },
      }}
    >
      <BlurView intensity={50} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      {/* inset top highlight — the capsule catching light */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />

      <Pressable onPress={onMic} android_ripple={{ color: alpha(W.primary, '22'), borderless: true }} style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <NavIcon name="mic" color={W.text2} size={18} />
      </Pressable>

      <Animated.View
        style={{
          flex: 1, backgroundColor: 'transparent',
          borderWidth: 1, borderColor,
          minHeight: 40, maxHeight: 110, borderRadius: 20, justifyContent: 'center', paddingHorizontal: 14,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={onSend}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={`Talk to ${companionName}…`}
          placeholderTextColor="#8F7E85"
          multiline
          style={{ color: W.text, fontFamily: 'Outfit_400Regular', fontSize: 15, padding: 0, paddingTop: 10, paddingBottom: 10, maxHeight: 90 }}
        />
      </Animated.View>

      <Animated.View style={{ transform: [{ scale: sendScale }], opacity: sendOpacity, width: hasDraft ? 40 : 0 }}>
        <Pressable
          onPress={onSend}
          disabled={!hasDraft}
          style={{
            width: 40, height: 40, borderRadius: 20, overflow: 'hidden',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: W.rose, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
          }}
        >
          <LinearGradient
            colors={[...GRAD.aurora]}
            locations={[0, 0.6, 1]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
          <View pointerEvents="none" style={{ position: 'absolute', left: 1, top: 1, right: 1, height: 14, borderTopLeftRadius: 19, borderTopRightRadius: 19, backgroundColor: 'rgba(255,255,255,0.16)' }} />
          <NavIcon name="send" color="#fff" size={17} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ─── TypingDots ────────────────────────────────────────────────────────
export function TypingDots() {
  return (
    <View
      style={{
        maxWidth: 60, alignSelf: 'flex-start',
        backgroundColor: 'rgba(255,255,255,0.055)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
        borderLeftWidth: 2, borderLeftColor: rgba(W.primary, 0.55),
        borderRadius: 18, borderBottomLeftRadius: 6,
        paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', gap: 4,
      }}
    >
      {[0, 1, 2].map(i => <TypingDot key={i} delay={i * 150} />)}
    </View>
  );
}
function TypingDot({ delay }: { delay: number }) {
  const pulse = useDotPulse(delay);
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: W.primary }, pulse]} />;
}

// ─── DayDivider ──────────────────────────────────────────────────────────
// Centered date chip that opens a thread — the design's only horizontal rule.
export function DayDivider({ label = 'Today' }: { label?: string }) {
  return (
    <View style={{ alignSelf: 'center', paddingVertical: 4, paddingHorizontal: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' }}>
      <Txt font="user" weight={500} style={{ fontSize: 10.5, color: W.text3, letterSpacing: 0.6 }}>{label}</Txt>
    </View>
  );
}

// ─── RecallIndicator ─────────────────────────────────────────────────────
// Shown while a reply is being composed but before the first token lands —
// the moment the companion is pulling from long-term memory. Gold, italic,
// and quiet: it explains the pause rather than filling it.
export function RecallIndicator() {
  const pulse = useDotPulse(0);
  return (
    <Animated.View style={[{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 4 }, pulse]}>
      <NavIcon name="sparkle-solid" color={W.gold} size={12} />
      <Txt font="user" weight={500} style={{ fontSize: 11, color: '#B79A6B', fontStyle: 'italic' }}>
        recalling your memories…
      </Txt>
    </Animated.View>
  );
}

// ─── VoiceNoteBubble ─────────────────────────────────────────────────────
export function VoiceNoteBubble({ from, duration = 12 }: { from: string; duration?: number }) {
  const isUser = from === 'user';
  const [playing, setPlaying] = useState(false);
  const color = isUser ? '#C9B4BC' : W.primarySoft;
  const bars = [4, 6, 10, 16, 12, 8, 14, 20, 16, 10, 18, 14, 8, 12, 16, 22, 14, 10, 16, 8, 6, 4];
  return (
  <BubbleEntrance isUser={isUser}>
    <BubbleSkin isUser={isUser} style={{ maxWidth: 260, paddingVertical: 9, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {/* Play control — always the aurora, on both sides of the thread, so
          "audio" reads as one affordance regardless of who recorded it. */}
      <Pressable
        onPress={() => setPlaying(p => !p)}
        style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
      >
        <LinearGradient
          colors={[...GRAD.auroraShort]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
        />
        <NavIcon name={playing ? 'pause' : 'play'} color="#fff" size={16} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 }}>
        {bars.map((h, i) => (
          <View key={i} style={{ width: 2, height: h, backgroundColor: color, borderRadius: 1 }} />
        ))}
      </View>
      <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>0:{String(duration).padStart(2, '0')}</Txt>
    </BubbleSkin>
  </BubbleEntrance>
  );
}

// ─── CapHitCard ──────────────────────────────────────────────────────────
export function CapHitCard({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <View
      style={{
        alignSelf: 'center', maxWidth: '85%', marginTop: 12,
        backgroundColor: W.glass, borderRadius: 16, padding: 14,
        borderWidth: 1, borderColor: W.hairline, gap: 10, alignItems: 'flex-start',
      }}
    >
      <Txt font="user" style={{ fontSize: 13, color: W.text, lineHeight: 18 }}>
        Want unlimited conversations? Upgrade to Plus.
      </Txt>
      <Pressable onPress={onUpgrade} style={{ backgroundColor: W.primary, borderRadius: 12, paddingVertical: 7, paddingHorizontal: 14 }}>
        <Txt font="user" weight={500} style={{ fontSize: 12, color: '#fff' }}>See plans</Txt>
      </Pressable>
    </View>
  );
}

// ─── Coachmark ─────────────────────────────────────────────────────────
export function Coachmark({ text, onDismiss, style }: { text: string; onDismiss?: () => void; style?: StyleProp<ViewStyle> }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, []);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [20, 0] });
  return (
    <Animated.View style={[{ position: 'absolute', opacity: v, transform: [{ translateY }], zIndex: 20 }, style]}>
      <Pressable
        onPress={onDismiss}
        style={{
          width: 200, paddingVertical: 10, paddingHorizontal: 12,
          backgroundColor: 'rgba(32,22,26,0.92)', borderRadius: 12,
          borderWidth: 1, borderColor: 'rgba(255,138,118,0.30)',
          shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 28, shadowOffset: { width: 0, height: 10 },
        }}
      >
        <Txt font="user" style={{ fontSize: 12, color: W.text, lineHeight: 17 }}>{text}</Txt>
      </Pressable>
    </Animated.View>
  );
}
