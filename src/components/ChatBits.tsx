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
import { W, alpha } from '../theme/theme';

// ─── Bubble (simple, first-chat) ─────────────────────────────────────────
export function Bubble({ from, text, memoryRefs = [] }: { from: string; text: string; memoryRefs?: string[] }) {
  const isUser = from === 'user';
  return (
    <BubbleEntrance isUser={isUser}>
      <View
        style={{
          maxWidth: '78%', alignSelf: isUser ? 'flex-end' : 'flex-start',
          backgroundColor: isUser ? W.surface2 : 'rgba(124,114,255,0.12)',
          borderRadius: 16,
          borderTopLeftRadius: isUser ? 16 : 4,
          borderTopRightRadius: isUser ? 4 : 16,
          paddingVertical: 10, paddingHorizontal: 14,
        }}
      >
        <RefText text={text} memoryRefs={memoryRefs} isUser={isUser} />
      </View>
    </BubbleEntrance>
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
  const baseStyle = { fontSize: 15, lineHeight: 21, color: W.text } as const;

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
            : <Txt key={i} font={font} weight={500} style={{ color: W.accent }}>{p.ref}</Txt>
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
  const bg = isUser ? 'rgba(37,40,54,0.78)' : alpha(accent, '1f');
  return (
    <BubbleEntrance isUser={isUser}>
      <View
        style={{
          backgroundColor: bg,
          borderWidth: 1, borderColor: isUser ? 'rgba(255,255,255,0.06)' : alpha(accent, '33'),
          borderRadius: 18,
          borderTopLeftRadius: isUser ? 18 : 6,
          borderTopRightRadius: isUser ? 6 : 18,
          paddingVertical: 11, paddingHorizontal: 15,
          borderLeftWidth: 1,
          borderLeftColor: isUser ? 'rgba(255,255,255,0.06)' : alpha(accent, '66'),
          shadowColor: isUser ? '#000' : accent,
          shadowOpacity: isUser ? 0.20 : 0.18,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <RefText text={text} memoryRefs={memoryRefs} isUser={isUser} onMemoryClick={onMemoryClick} asMemoryRef />
      </View>
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
  const borderColor = focusV.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.06)', 'rgba(139,130,255,0.45)'] });
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
        borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)',
        paddingVertical: 10, paddingHorizontal: 12,
        flexDirection: 'row', alignItems: 'center', gap: 8,
        backgroundColor: 'rgba(12,14,20,0.78)', overflow: 'hidden', zIndex: 2,
      }}
    >
      <BlurView intensity={50} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      {/* faint top sheen */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />

      <Pressable onPress={onMic} android_ripple={{ color: alpha(W.primary, '22'), borderless: true }} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
        <NavIcon name="mic" color={W.text2} />
      </Pressable>

      <Animated.View
        style={{
          flex: 1, backgroundColor: 'rgba(30,32,46,0.85)',
          borderWidth: 1, borderColor,
          minHeight: 44, maxHeight: 110, borderRadius: 22, justifyContent: 'center', paddingHorizontal: 16,
          shadowColor: W.primary, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={onSend}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={`Talk to ${companionName}…`}
          placeholderTextColor={W.text2}
          multiline
          style={{ color: W.text, fontFamily: 'Outfit_400Regular', fontSize: 15, padding: 0, paddingTop: 10, paddingBottom: 10, maxHeight: 90 }}
        />
      </Animated.View>

      <Animated.View style={{ transform: [{ scale: sendScale }], opacity: sendOpacity, width: hasDraft ? 42 : 0 }}>
        <Pressable
          onPress={onSend}
          disabled={!hasDraft}
          style={{
            width: 42, height: 42, borderRadius: 21, overflow: 'hidden',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: W.primary, shadowOpacity: 0.55, shadowRadius: 18, shadowOffset: { width: 0, height: 6 },
          }}
        >
          <LinearGradient
            colors={['#A29CFF', '#736AF0']}
            start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
          <View pointerEvents="none" style={{ position: 'absolute', left: 1, top: 1, right: 1, height: 14, borderTopLeftRadius: 20, borderTopRightRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)' }} />
          <NavIcon name="send" color="#fff" size={18} />
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
        backgroundColor: alpha(W.primary, '1f'),
        borderRadius: 16, borderTopLeftRadius: 4,
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

// ─── VoiceNoteBubble ─────────────────────────────────────────────────────
export function VoiceNoteBubble({ from, duration = 12 }: { from: string; duration?: number }) {
  const isUser = from === 'user';
  const [playing, setPlaying] = useState(false);
  const color = isUser ? W.text2 : W.primary;
  const bars = [4, 6, 10, 16, 12, 8, 14, 20, 16, 10, 18, 14, 8, 12, 16, 22, 14, 10, 16, 8, 6, 4];
  return (
  <BubbleEntrance isUser={isUser}>
    <View
      style={{
        maxWidth: 260,
        backgroundColor: isUser ? W.surface2 : 'rgba(124,114,255,0.14)',
        borderRadius: 18, borderTopLeftRadius: isUser ? 18 : 6, borderTopRightRadius: isUser ? 6 : 18,
        paddingVertical: 9, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 10,
        borderWidth: 1, borderColor: isUser ? 'rgba(255,255,255,0.06)' : alpha(W.primary, '22'),
      }}
    >
      <Pressable
        onPress={() => setPlaying(p => !p)}
        style={{ backgroundColor: color, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}
      >
        <NavIcon name={playing ? 'pause' : 'play'} color={isUser ? W.text : '#fff'} size={18} />
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 }}>
        {bars.map((h, i) => (
          <View key={i} style={{ width: 2, height: h, backgroundColor: color, opacity: 0.7, borderRadius: 1 }} />
        ))}
      </View>
      <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>0:{String(duration).padStart(2, '0')}</Txt>
    </View>
  </BubbleEntrance>
  );
}

// ─── CapHitCard ──────────────────────────────────────────────────────────
export function CapHitCard({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <View
      style={{
        alignSelf: 'center', maxWidth: '85%', marginTop: 12,
        backgroundColor: W.surface1, borderRadius: 12, padding: 12,
        borderWidth: 1, borderColor: W.surface2, gap: 10, alignItems: 'flex-start',
      }}
    >
      <Txt font="user" style={{ fontSize: 13, color: W.text, lineHeight: 18 }}>
        Want unlimited conversations? Upgrade to Plus.
      </Txt>
      <Pressable onPress={onUpgrade} style={{ backgroundColor: W.primary, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 }}>
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
          backgroundColor: 'rgba(26,29,46,0.92)', borderRadius: 12,
          borderWidth: 1, borderColor: 'rgba(124,114,255,0.30)',
          shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 28, shadowOffset: { width: 0, height: 10 },
        }}
      >
        <Txt font="user" style={{ fontSize: 12, color: W.text, lineHeight: 17 }}>{text}</Txt>
      </Pressable>
    </Animated.View>
  );
}
