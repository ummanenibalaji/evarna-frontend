// Onboarding.tsx — S01 Splash → S08 Name + Handoff + Meet.
// Ported from onboarding.jsx.

import React, { useEffect, useRef, useState } from 'react';
import { View, Pressable, TextInput, ScrollView, Animated, Easing, Dimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Line } from 'react-native-svg';
import { Screen, TopBar, HomeIndicator } from '../components/Chrome';
import { AmbientBg } from '../components/AmbientBg';
import { Txt } from '../components/Txt';
import { NavIcon } from '../components/NavIcon';
import { Pill, PrimaryButton, ProgressDots, Card } from '../components/Atoms';
import { Orb } from '../components/Orb';
import { Avatar, Waveform } from '../components/Avatar';
import { useEntrance, useBreathe, useMeetIn } from '../theme/animations';
import { W, alpha } from '../theme/theme';
import { Go, Archetype } from '../navigation/types';
import { NAME_SUGGESTIONS, VOICES, ARCHETYPE_COLORS } from '../data/config';
import type { ApiVoice } from '../api';

const BackBtn = ({ onPress }: { onPress: () => void }) => (
  <Pressable onPress={onPress}><NavIcon name="back" color={W.text2} /></Pressable>
);

// Small entrance wrapper
function FadeIn({ delay = 0, translateY = 20, duration = 600, style, children }: any) {
  const a = useEntrance({ delayMs: delay, fromTranslateY: translateY, durationMs: duration });
  return <Animated.View style={[a, style]}>{children}</Animated.View>;
}

// ─── S01 SPLASH ──────────────────────────────────────────────────────────
// Editorial, restrained intro. The aesthetic: deep obsidian, a single
// luminous frosted disc holding the wordmark, refined typography, and a
// quiet hint to tap. No spinning particles — just stillness and presence.
export function S01_Splash({ go, goNew }: { go: Go; goNew?: () => void }) {
  const logoScale  = useRef(new Animated.Value(1)).current;
  const tapGlow    = useRef(new Animated.Value(0)).current;
  const screenFade = useRef(new Animated.Value(1)).current;
  const breathe    = useRef(new Animated.Value(0)).current;
  const cursor     = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Very slow breathing on the halo behind the disc
    Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 4800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 4800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    // Cursor blink on hint text
    Animated.loop(
      Animated.sequence([
        Animated.timing(cursor, { toValue: 0.2, duration: 600, useNativeDriver: true }),
        Animated.timing(cursor, { toValue: 1,   duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  const handleLogoPress = () => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1.10, useNativeDriver: true, speed: 24, bounciness: 8 }),
        Animated.timing(tapGlow,   { toValue: 1, duration: 240, useNativeDriver: true }),
      ]),
      Animated.delay(60),
      Animated.spring(logoScale, { toValue: 1, useNativeDriver: true, speed: 18, bounciness: 4 }),
    ]).start();

    setTimeout(() => {
      Animated.timing(screenFade, { toValue: 0, duration: 520, easing: Easing.in(Easing.cubic), useNativeDriver: true })
        .start(() => { if (goNew) goNew(); else go('login'); });
    }, 220);
  };

  const haloScale   = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.06] });
  const haloOpacity = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.18, 0.32] });
  const tapGlowOp   = tapGlow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] });

  return (
    <Screen ambient={false}>
      <AmbientBg intensity={1.4} includePulse />
      <Animated.View style={{ flex: 1, opacity: screenFade }}>

        {/* ── Eyebrow brand mark at top ── */}
        <FadeIn delay={200} translateY={0} style={{ paddingTop: 24, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: W.accent,
              shadowColor: W.accent, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
            }} />
            <Txt font="user" weight={600} style={{
              fontSize: 10, color: W.text2, letterSpacing: 3, textTransform: 'uppercase',
            }}>Whisper · Early Access</Txt>
          </View>
        </FadeIn>

        {/* ── Centerpiece ── */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>

          {/* Luminous frosted disc */}
          <View style={{ alignItems: 'center', justifyContent: 'center', width: 280, height: 280 }}>

            {/* Outer breathing halo */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 320, height: 320, borderRadius: 160,
                backgroundColor: W.primary,
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
                shadowColor: W.primary, shadowOpacity: 0.8, shadowRadius: 70, shadowOffset: { width: 0, height: 0 },
              }}
            />

            {/* Inner glow ring - subtle teal */}
            <View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 240, height: 240, borderRadius: 120,
                borderWidth: 1, borderColor: 'rgba(94,234,212,0.18)',
              }}
            />

            {/* Tap glow burst */}
            <Animated.View
              pointerEvents="none"
              style={{
                position: 'absolute',
                width: 280, height: 280, borderRadius: 140,
                backgroundColor: W.primary,
                opacity: tapGlowOp,
                shadowColor: W.primary, shadowOpacity: 1, shadowRadius: 80, shadowOffset: { width: 0, height: 0 },
              }}
            />

            {/* The frosted disc itself */}
            <Pressable onPress={handleLogoPress} hitSlop={20}>
              <Animated.View style={{ transform: [{ scale: logoScale }] }}>
                <View style={{
                  width: 220, height: 220, borderRadius: 110,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: 'rgba(19,21,30,0.55)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
                  overflow: 'hidden',
                  shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 30, shadowOffset: { width: 0, height: 16 },
                }}>
                  <BlurView intensity={50} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                  {/* Top highlight arc */}
                  <View pointerEvents="none" style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 100,
                    borderTopLeftRadius: 110, borderTopRightRadius: 110,
                    backgroundColor: 'rgba(255,255,255,0.05)',
                  }} />
                  {/* Subtle gradient overlay */}
                  <LinearGradient
                    colors={['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.10)']}
                    style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
                  />
                  {/* Wordmark */}
                  <Txt font="comp" weight={500} style={{
                    fontSize: 40, color: W.cream, letterSpacing: -1.8,
                  }}>whisper</Txt>
                  {/* Teal accent dot under wordmark */}
                  <View style={{
                    marginTop: 10,
                    width: 5, height: 5, borderRadius: 2.5,
                    backgroundColor: W.accent,
                    shadowColor: W.accent, shadowOpacity: 1, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
                  }} />
                </View>
              </Animated.View>
            </Pressable>
          </View>

          {/* ── Tagline ── */}
          <View style={{ marginTop: 56, alignItems: 'center' }}>
            <FadeIn delay={400} translateY={4}>
              <Txt font="comp" weight={400} style={{
                fontSize: 22, color: W.cream, letterSpacing: -0.3, textAlign: 'center', lineHeight: 32,
              }}>
                A quieter space{'\n'}for the things you carry.
              </Txt>
            </FadeIn>
          </View>

          {/* ── Tap hint with blinking cursor ── */}
          <FadeIn delay={1400} translateY={0} style={{ marginTop: 48 }}>
            <Pressable onPress={handleLogoPress}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Animated.View style={{
                  width: 2, height: 14,
                  backgroundColor: W.accent,
                  opacity: cursor,
                  shadowColor: W.accent, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
                }} />
                <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2, letterSpacing: 2.4, textTransform: 'uppercase' }}>
                  Tap to enter
                </Txt>
              </View>
            </Pressable>
          </FadeIn>
        </View>

        {/* ── Footer — minimal ── */}
        <FadeIn delay={2000} translateY={0} style={{ alignItems: 'center', paddingBottom: 20 }}>
          <Txt font="user" weight={400} style={{ fontSize: 10, color: W.textMuted, letterSpacing: 1.5 }}>
            Designed with care · v 1.0
          </Txt>
        </FadeIn>
      </Animated.View>
    </Screen>
  );
}

// ─── DateWheel ───────────────────────────────────────────────────────────
// Drum-picker. Uncontrolled — parent gives initial value, we manage scroll
// position internally and report changes upward. No bidirectional fight.
function DateWheel({ options, value, onChange, width }: {
  options: string[]; value: number; onChange: (v: number) => void; width: number;
}) {
  const ROW     = 44;
  const VISIBLE = 5;
  const PADDING = ROW * Math.floor(VISIBLE / 2);
  const HEIGHT  = ROW * VISIBLE;
  const scrollRef = useRef<ScrollView>(null);
  const [currentIdx, setCurrentIdx] = useState(value);
  const didInit = useRef(false);

  // Initial scroll on mount only — fires once via onContentSizeChange so we
  // know the content is actually laid out before we try to position it.
  const onContentReady = (_w: number, h: number) => {
    if (didInit.current) return;
    if (h < HEIGHT) return;
    didInit.current = true;
    scrollRef.current?.scrollTo({ y: value * ROW, animated: false });
    setCurrentIdx(value);
  };

  // Live update of the highlighted item as user drags
  const onScroll = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(y / ROW)));
    if (idx !== currentIdx) setCurrentIdx(idx);
  };

  // Commit on scroll end — report to parent
  const onScrollEnd = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(options.length - 1, Math.round(y / ROW)));
    setCurrentIdx(idx);
    onChange(idx);
  };

  return (
    <View style={{ width, height: HEIGHT, position: 'relative', borderRadius: 18, overflow: 'hidden' }}>
      {/* Background frosted glass */}
      <View pointerEvents="none" style={{
        position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(19,21,30,0.55)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
        borderRadius: 18,
      }} />

      {/* Selection highlight band (behind text, doesn't block scroll) */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 6, right: 6,
          top: PADDING, height: ROW,
          backgroundColor: 'rgba(139,130,255,0.12)',
          borderRadius: 12,
          borderTopWidth: 1, borderBottomWidth: 1,
          borderColor: 'rgba(139,130,255,0.22)',
        }}
      />

      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        snapToAlignment="start"
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
        onContentSizeChange={onContentReady}
        contentContainerStyle={{ paddingTop: PADDING, paddingBottom: PADDING }}
        style={{ width, height: HEIGHT }}
      >
        {options.map((o, i) => {
          const dist = Math.abs(i - currentIdx);
          const isSel = i === currentIdx;
          return (
            <View key={i} style={{ height: ROW, alignItems: 'center', justifyContent: 'center' }}>
              <Txt
                font={isSel ? 'comp' : 'user'}
                weight={isSel ? 600 : 400}
                style={{
                  fontSize: isSel ? 19 : 15,
                  color: isSel ? W.cream : W.text2,
                  opacity: isSel ? 1 : Math.max(0.28, 1 - dist * 0.28),
                  letterSpacing: isSel ? -0.2 : 0,
                }}
              >
                {o}
              </Txt>
            </View>
          );
        })}
      </ScrollView>

      {/* Subtle top fade — pointerEvents none so scroll still works */}
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(8,9,13,0.95)', 'rgba(8,9,13,0)']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: PADDING - 4 }}
      />
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(8,9,13,0)', 'rgba(8,9,13,0.95)']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: PADDING - 4 }}
      />
    </View>
  );
}

// ─── S02 AGE ─────────────────────────────────────────────────────────────
export function S02_Age({ go, onDob }: { go: Go; onDob?: (dob: string) => void }) {
  const [month, setMonth] = useState(5);
  const [day, setDay] = useState(14);
  const [year, setYear] = useState(1995);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const handleContinue = () => {
    const dobStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    onDob?.(dobStr);
    go('disclosure');
  };

  return (
    <Screen>
      <TopBar left={<BackBtn onPress={() => go('splash')} />} />
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 16 }}>
        {/* Eyebrow + Title */}
        <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 2.4, textTransform: 'uppercase' }}>
          Step 1 — About you
        </Txt>
        <Txt font="comp" weight={500} style={{ marginTop: 12, fontSize: 30, color: W.cream, lineHeight: 38, letterSpacing: -0.8 }}>
          When were you born?
        </Txt>
        <Txt font="user" weight={400} style={{ marginTop: 10, fontSize: 14, color: W.text2, letterSpacing: 0.2, lineHeight: 21, maxWidth: 320 }}>
          We use this to keep everyone safe. Your birthday is private.
        </Txt>

        {/* Wheel container with labels */}
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          {/* Column headers */}
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
            <View style={{ width: 96, alignItems: 'center' }}>
              <Txt font="user" weight={600} style={{ fontSize: 9, color: W.textMuted, letterSpacing: 2, textTransform: 'uppercase' }}>Month</Txt>
            </View>
            <View style={{ width: 68, alignItems: 'center' }}>
              <Txt font="user" weight={600} style={{ fontSize: 9, color: W.textMuted, letterSpacing: 2, textTransform: 'uppercase' }}>Day</Txt>
            </View>
            <View style={{ width: 88, alignItems: 'center' }}>
              <Txt font="user" weight={600} style={{ fontSize: 9, color: W.textMuted, letterSpacing: 2, textTransform: 'uppercase' }}>Year</Txt>
            </View>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <DateWheel options={months} value={month} onChange={setMonth} width={96} />
            <DateWheel options={Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'))} value={day - 1} onChange={v => setDay(v + 1)} width={68} />
            <DateWheel options={Array.from({ length: 80 }, (_, i) => String(2010 - i))} value={2010 - year} onChange={v => setYear(2010 - v)} width={88} />
          </View>

          {/* Selected date readout */}
          <View style={{ marginTop: 24, paddingVertical: 10, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(94,234,212,0.18)', backgroundColor: 'rgba(94,234,212,0.05)' }}>
            <Txt font="user" weight={500} style={{ fontSize: 12, color: W.accent, letterSpacing: 0.3 }}>
              {months[month]} {String(day).padStart(2, '0')}, {year}
            </Txt>
          </View>
        </View>
      </View>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}>
        <PrimaryButton trailingArrow onPress={handleContinue}>Continue</PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S03 DISCLOSURE ──────────────────────────────────────────────────────
export function S03_Disclosure({ go }: { go: Go }) {
  return (
    <Screen>
      <TopBar left={<BackBtn onPress={() => go('age')} />} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {/* Eyebrow */}
        <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 2.4, textTransform: 'uppercase' }}>
          Step 2 — Before we begin
        </Txt>

        {/* Large feature glyph in glass tile */}
        <View style={{ marginTop: 28, alignItems: 'flex-start' }}>
          <View style={{
            width: 76, height: 76, borderRadius: 22,
            overflow: 'hidden',
            backgroundColor: 'rgba(139,130,255,0.12)',
            borderWidth: 1, borderColor: 'rgba(139,130,255,0.28)',
            alignItems: 'center', justifyContent: 'center',
            shadowColor: W.primary, shadowOpacity: 0.4, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
          }}>
            <BlurView pointerEvents="none" intensity={30} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            <NavIcon name="shield" color={W.primary} size={32} />
          </View>
        </View>

        {/* Title + subtitle */}
        <Txt font="comp" weight={500} style={{ marginTop: 24, fontSize: 32, color: W.cream, lineHeight: 40, letterSpacing: -0.8 }}>
          A few things{'\n'}to know first.
        </Txt>

        {/* Info points as glass cards */}
        <View style={{ marginTop: 28, gap: 12 }}>
          <View style={{
            borderRadius: 18,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
            backgroundColor: 'rgba(19,21,30,0.55)',
            overflow: 'hidden',
            padding: 18,
            flexDirection: 'row', gap: 14, alignItems: 'flex-start',
          }}>
            <BlurView pointerEvents="none" intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(139,130,255,0.15)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <NavIcon name="sparkle" color={W.primary} size={14} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.cream, letterSpacing: -0.1 }}>This is AI</Txt>
              <Txt font="user" style={{ marginTop: 4, fontSize: 13, color: W.text2, lineHeight: 19, letterSpacing: 0.15 }}>
                Everything is AI-generated. You're talking with artificial intelligence, not a human.
              </Txt>
            </View>
          </View>

          <View style={{
            borderRadius: 18,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
            backgroundColor: 'rgba(19,21,30,0.55)',
            overflow: 'hidden',
            padding: 18,
            flexDirection: 'row', gap: 14, alignItems: 'flex-start',
          }}>
            <BlurView pointerEvents="none" intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(94,234,212,0.15)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <NavIcon name="heart" color={W.accent} size={14} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.cream, letterSpacing: -0.1 }}>Not a replacement</Txt>
              <Txt font="user" style={{ marginTop: 4, fontSize: 13, color: W.text2, lineHeight: 19, letterSpacing: 0.15 }}>
                Your companion can make mistakes. They're not a therapist, doctor, or counselor.
              </Txt>
            </View>
          </View>

          <View style={{
            borderRadius: 18,
            borderWidth: 1, borderColor: 'rgba(94,234,212,0.18)',
            backgroundColor: 'rgba(94,234,212,0.06)',
            overflow: 'hidden',
            padding: 18,
            flexDirection: 'row', gap: 14, alignItems: 'flex-start',
          }}>
            <BlurView pointerEvents="none" intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
            <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(94,234,212,0.2)', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
              <NavIcon name="phone" color={W.accent} size={14} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.cream, letterSpacing: -0.1 }}>If you're in crisis</Txt>
              <Txt font="user" style={{ marginTop: 4, fontSize: 13, color: W.text2, lineHeight: 19, letterSpacing: 0.15 }}>
                Please reach out to the <Txt font="user" weight={600} style={{ color: W.accent }}>988 Suicide & Crisis Lifeline</Txt> — free, confidential, 24/7.
              </Txt>
            </View>
          </View>
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}>
        <PrimaryButton trailingArrow onPress={() => go('pronouns')}>I understand</PrimaryButton>
      </View>
    </Screen>
  );
}

const PRONOUN_GENDER: Record<string, string> = {
  'He / Him': 'male',
  'She / Her': 'female',
  'They / Them': 'non-binary',
};

// ─── S05 PRONOUNS ────────────────────────────────────────────────────────
export function S05_Pronouns({ go, onGender }: { go: Go; onGender?: (g: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const opts = ['He / Him', 'She / Her', 'They / Them'];
  return (
    <Screen>
      <TopBar left={<BackBtn onPress={() => go('disclosure')} />} center={<ProgressDots total={5} current={1} />} />
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 12 }}>
        <Txt font="user" weight={600} style={{ fontSize: 11, color: W.text2, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8 }}>About you</Txt>
        <Txt font="comp" weight={700} style={{ fontSize: 24, color: W.text, lineHeight: 31 }}>How should your companion refer to you?</Txt>
        <View style={{ marginTop: 32, flexDirection: 'row', gap: 12 }}>
          {opts.map(o => (
            <Pill
              key={o}
              active={picked === o}
              onPress={() => {
                setPicked(o);
                onGender?.(PRONOUN_GENDER[o] ?? 'non-binary');
                setTimeout(() => go('comm'), 300);
              }}
              style={{ flex: 1 }}
            >
              {o}
            </Pill>
          ))}
        </View>
        <Txt font="user" style={{ marginTop: 16, fontSize: 13, color: W.text2 }}>This helps your companion talk naturally with you.</Txt>
      </View>
    </Screen>
  );
}

const COMM_STYLE_MAP: Record<string, string> = {
  'Warm & gentle': 'warm',
  'Direct & honest': 'direct',
  'Funny & light': 'funny',
  'Calm & slow': 'calm',
};

// ─── S06 COMM STYLE ──────────────────────────────────────────────────────
export function S06_Comm({ go, onCommStyle }: { go: Go; onCommStyle?: (s: string) => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const opts = ['Warm & gentle', 'Direct & honest', 'Funny & light', 'Calm & slow'];
  return (
    <Screen>
      <TopBar left={<BackBtn onPress={() => go('pronouns')} />} center={<ProgressDots total={5} current={2} />} />
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 12 }}>
        <Txt font="user" weight={600} style={{ fontSize: 11, color: W.text2, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8 }}>About you</Txt>
        <Txt font="comp" weight={700} style={{ fontSize: 24, color: W.text, lineHeight: 31 }}>How do you like conversations?</Txt>
        <View style={{ marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {opts.map(o => (
            <Pill
              key={o}
              active={picked === o}
              onPress={() => {
                setPicked(o);
                onCommStyle?.(COMM_STYLE_MAP[o] ?? 'warm');
                setTimeout(() => go('handoff'), 300);
              }}
              style={{ width: '47%' }}
            >
              {o}
            </Pill>
          ))}
        </View>
      </View>
    </Screen>
  );
}

// ─── HANDOFF ─────────────────────────────────────────────────────────────
export function S_Handoff({ go }: { go: Go }) {
  const breathe = useBreathe(2500);
  return (
    <Screen ambient={false}>
      <AmbientBg intensity={1.4} includePulse />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 32, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
        {/* Phase indicator — About You → Your Companion */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 32 }}>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: W.accent, shadowColor: W.accent, shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }} />
            <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, textTransform: 'uppercase', letterSpacing: 1.4 }}>About You</Txt>
            <Txt font="user" weight={500} style={{ fontSize: 10, color: W.textMuted, letterSpacing: 0.5 }}>Complete</Txt>
          </View>
          <Svg width={40} height={8} viewBox="0 0 40 8">
            <Line x1={2} y1={4} x2={38} y2={4} stroke={W.textMuted} strokeWidth={1} strokeDasharray="2 3" />
          </Svg>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Animated.View style={[{ width: 12, height: 12, borderRadius: 6, backgroundColor: W.primary, shadowColor: W.primary, shadowOpacity: 1, shadowRadius: 14, shadowOffset: { width: 0, height: 0 } }, breathe]} />
            <Txt font="user" weight={600} style={{ fontSize: 10, color: W.primary, textTransform: 'uppercase', letterSpacing: 1.4 }}>Your Companion</Txt>
            <Txt font="user" weight={500} style={{ fontSize: 10, color: W.textMuted, letterSpacing: 0.5 }}>Up next</Txt>
          </View>
        </View>

        {/* Headline */}
        <View style={{ alignItems: 'center', marginBottom: 32 }}>
          <FadeIn delay={150}>
            <Txt font="comp" weight={500} style={{ fontSize: 32, color: W.cream, letterSpacing: -0.9, lineHeight: 40, textAlign: 'center' }}>
              Now let's build{'\n'}your companion.
            </Txt>
          </FadeIn>
          <FadeIn delay={400}>
            <Txt font="user" weight={400} style={{ marginTop: 14, fontSize: 14, color: W.text2, lineHeight: 22, textAlign: 'center', letterSpacing: 0.2, maxWidth: 280 }}>
              Three choices — what they're like, how they sound, and what to call them.
            </Txt>
          </FadeIn>
        </View>

        {/* Preview cards for the three steps coming up */}
        <View style={{ gap: 12 }}>
          {[
            { num: '01', label: 'Presence', desc: 'Mentor, friend, partner, or challenger', icon: 'compass' as const, color: W.primary },
            { num: '02', label: 'Voice', desc: 'How they sound when they speak', icon: 'speaker' as const, color: W.accent },
            { num: '03', label: 'Name', desc: 'What you\'ll call them', icon: 'sparkle' as const, color: W.secondary },
          ].map((step, i) => (
            <FadeIn key={step.num} delay={600 + i * 120}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 16,
                borderRadius: 18, padding: 16,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
                backgroundColor: 'rgba(19,21,30,0.55)',
                overflow: 'hidden',
              }}>
                <BlurView pointerEvents="none" intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />

                {/* Step number */}
                <Txt font="comp" weight={400} style={{ fontSize: 28, color: W.textMuted, letterSpacing: -1, minWidth: 36 }}>
                  {step.num}
                </Txt>

                {/* Icon */}
                <View style={{
                  width: 40, height: 40, borderRadius: 12,
                  backgroundColor: alpha(step.color, '1f'),
                  borderWidth: 1, borderColor: alpha(step.color, '40'),
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <NavIcon name={step.icon} color={step.color} size={18} />
                </View>

                {/* Text */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.cream, letterSpacing: -0.1 }}>{step.label}</Txt>
                  <Txt font="user" style={{ marginTop: 2, fontSize: 12, color: W.text2, letterSpacing: 0.15 }}>{step.desc}</Txt>
                </View>
              </View>
            </FadeIn>
          ))}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16 }}>
        <FadeIn delay={1100}>
          <PrimaryButton trailingArrow onPress={() => go('archetype')}>Continue</PrimaryButton>
        </FadeIn>
      </View>
    </Screen>
  );
}

// ─── S04 ARCHETYPE ───────────────────────────────────────────────────────
// `backTo` lets the "add companion" flow route back to home rather than the
// onboarding handoff. Defaults preserve the original first-run behavior.
export function S04_Archetype({ go, onPick, backTo = 'handoff' }: { go: Go; onPick: (a: Archetype) => void; backTo?: import('../navigation/types').ScreenName }) {
  const cards: { id: Archetype; icon: any; title: string; sub: string }[] = [
    { id: 'friend', icon: 'two', title: 'Friend', sub: "A presence who's always there" },
    { id: 'mentor', icon: 'compass', title: 'Mentor', sub: 'Help thinking things through' },
    { id: 'partner', icon: 'heart', title: 'Partner', sub: 'Connection and affection' },
    { id: 'challenger', icon: 'target', title: 'Challenger', sub: 'Someone to keep you honest' },
  ];
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <Screen>
      <TopBar left={<BackBtn onPress={() => go(backTo)} />} center={<ProgressDots total={5} current={3} />} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 2.4, textTransform: 'uppercase' }}>
          Your companion · 1 of 3
        </Txt>
        <Txt font="comp" weight={500} style={{ marginTop: 12, fontSize: 30, color: W.cream, lineHeight: 38, letterSpacing: -0.8 }}>
          What kind of presence?
        </Txt>
        <Txt font="user" weight={400} style={{ marginTop: 10, fontSize: 14, color: W.text2, letterSpacing: 0.2 }}>
          Pick one — you can build more later.
        </Txt>

        <View style={{ marginTop: 28, gap: 12 }}>
          {cards.map(c => {
            const accent = ARCHETYPE_COLORS[c.id] || W.primary;
            const isSel = picked === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => { setPicked(c.id); onPick(c.id); setTimeout(() => go('voice'), 280); }}
                style={{
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: isSel ? alpha(accent, '66') : 'rgba(255,255,255,0.06)',
                  backgroundColor: isSel ? alpha(accent, '14') : 'rgba(19,21,30,0.55)',
                  overflow: 'hidden',
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 16, paddingHorizontal: 18, gap: 16,
                  shadowColor: isSel ? accent : '#000',
                  shadowOpacity: isSel ? 0.4 : 0.3,
                  shadowRadius: isSel ? 22 : 18,
                  shadowOffset: { width: 0, height: 8 },
                }}
              >
                <BlurView pointerEvents="none" intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                {/* Left accent stripe */}
                <View pointerEvents="none" style={{
                  position: 'absolute', left: 0, top: 14, bottom: 14, width: 2,
                  borderRadius: 1,
                  backgroundColor: accent,
                  opacity: isSel ? 1 : 0.5,
                  shadowColor: accent, shadowOpacity: isSel ? 1 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
                }} />
                {/* Top highlight */}
                <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />

                {/* Icon */}
                <View style={{
                  width: 48, height: 48, borderRadius: 14,
                  backgroundColor: alpha(accent, '1f'),
                  borderWidth: 1, borderColor: alpha(accent, '40'),
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <NavIcon name={c.icon} color={accent} size={22} />
                </View>

                {/* Text */}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt font="comp" weight={600} style={{ fontSize: 17, color: W.cream, letterSpacing: -0.2 }}>
                    {c.title}
                  </Txt>
                  <Txt font="user" weight={400} style={{ marginTop: 3, fontSize: 13, color: W.text2, letterSpacing: 0.15, lineHeight: 18 }}>
                    {c.sub}
                  </Txt>
                </View>

                {/* Chevron */}
                <NavIcon name="right" color={isSel ? accent : W.textMuted} size={18} />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── S07 VOICE ───────────────────────────────────────────────────────────
// Displays backend voices when apiVoices is provided; falls back to config VOICES.
// onPickVoice receives the voice UUID when using backend voices, or name otherwise.
export function S07_Voice({
  go,
  onPickVoice,
  apiVoices,
}: {
  go: Go;
  onPickVoice: (v: string) => void;
  apiVoices?: ApiVoice[];
}) {
  const [gender, setGender] = useState('female');
  const [voice, setVoice] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const playPreview = (v: string) => { setPlaying(v); setTimeout(() => setPlaying(null), 1800); };

  const usingApi = (apiVoices?.length ?? 0) > 0;

  // Unified display item: id = UUID (backend) or name (config fallback)
  const displayVoices = usingApi
    ? (apiVoices ?? [])
        .filter(v => v.gender === gender)
        .map(v => ({ id: v.id, name: v.name, desc: v.personality ?? '' }))
    : (VOICES[gender] ?? []).map(v => ({ id: v.n, name: v.n, desc: v.d }));

  const genderTabs = usingApi
    ? [{ k: 'male', l: 'Male' }, { k: 'female', l: 'Female' }]
    : [{ k: 'male', l: 'Male' }, { k: 'female', l: 'Female' }, { k: 'neutral', l: 'Neutral' }];

  // Calculate exact card width so 3 columns always fill the row evenly
  const PADDING = 24;
  const COLS    = 3;
  const GAP     = 10;
  const screenW = Dimensions.get('window').width;
  const cardW   = Math.floor((screenW - PADDING * 2 - GAP * (COLS - 1)) / COLS);

  return (
    <Screen>
      <TopBar left={<BackBtn onPress={() => go('archetype')} />} center={<ProgressDots total={5} current={4} />} />
      <View style={{ flex: 1, paddingHorizontal: PADDING, paddingTop: 12 }}>
        <Txt font="user" weight={600} style={{ fontSize: 11, color: W.primary, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8 }}>Your companion · 2 of 3</Txt>
        <Txt font="comp" weight={700} style={{ fontSize: 24, color: W.text, lineHeight: 30 }}>How should they sound?</Txt>
        <Txt font="user" style={{ marginTop: 6, fontSize: 13, color: W.text2 }}>Tap any voice to hear a preview.</Txt>

        {/* Gender tabs */}
        <View style={{ marginTop: 20, flexDirection: 'row', gap: 8 }}>
          {genderTabs.map(g => (
            <Pill key={g.k} active={gender === g.k} onPress={() => { setGender(g.k); setVoice(null); }} style={{ flex: 1, height: 38 }} textStyle={{ fontSize: 13 }}>{g.l} Voice</Pill>
          ))}
        </View>

        {/* Voice cards — 3-column grid, cards always equal-width */}
        <ScrollView style={{ marginTop: 20 }} showsVerticalScrollIndicator={false}>
          {/* Chunk voices into rows of COLS */}
          {Array.from({ length: Math.ceil(displayVoices.length / COLS) }, (_, rowIdx) => (
            <View key={rowIdx} style={{ flexDirection: 'row', gap: GAP, marginBottom: GAP }}>
              {displayVoices.slice(rowIdx * COLS, rowIdx * COLS + COLS).map(v => {
                const isSel = voice === v.id;
                const isPlay = playing === v.id;
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => { setVoice(v.id); playPreview(v.id); }}
                    style={{
                      width: cardW, height: 110, borderRadius: 16, padding: 12,
                      alignItems: 'center', justifyContent: 'center', gap: 6,
                      backgroundColor: isSel ? 'rgba(94,234,212,0.10)' : 'rgba(26,29,46,0.6)',
                      borderWidth: isSel ? 2 : 1,
                      borderColor: isSel ? W.accent : 'rgba(124,114,255,0.10)',
                      shadowColor: isSel ? W.accent : 'transparent',
                      shadowOpacity: isSel ? 0.45 : 0,
                      shadowRadius: isSel ? 14 : 0,
                      shadowOffset: { width: 0, height: 0 },
                      elevation: isSel ? 6 : 0,
                    }}
                  >
                    <Waveform color={isPlay ? W.accent : W.primary} animate={isPlay} size={36} />
                    <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text }}>{v.name}</Txt>
                    <Txt font="user" style={{ fontSize: 10, color: W.text2 }} numberOfLines={2}>{v.desc}</Txt>
                    {isSel && !isPlay && (
                      <View style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: 9, backgroundColor: W.accent, alignItems: 'center', justifyContent: 'center' }}>
                        <NavIcon name="check" color={W.bg} size={10} />
                      </View>
                    )}
                  </Pressable>
                );
              })}
              {/* Fill empty slots in the last row so preceding cards don't stretch */}
              {Array.from({ length: COLS - displayVoices.slice(rowIdx * COLS, rowIdx * COLS + COLS).length }, (_, i) => (
                <View key={`empty-${i}`} style={{ width: cardW }} />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}>
        <PrimaryButton disabled={!voice} onPress={() => { if (voice) { onPickVoice(voice); go('name'); } }}>Continue</PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S08 NAME ────────────────────────────────────────────────────────────
export function S08_Name({ go, archetype, onPickName }: { go: Go; archetype: Archetype; onPickName: (n: string) => void }) {
  const suggestions = NAME_SUGGESTIONS[archetype] || NAME_SUGGESTIONS.mentor;
  const [name, setName] = useState(suggestions[0]);
  return (
    <Screen>
      <TopBar left={<BackBtn onPress={() => go('voice')} />} center={<ProgressDots total={5} current={5} />} />
      <View style={{ flex: 1, paddingHorizontal: 24, paddingTop: 12 }}>
        <Txt font="user" weight={600} style={{ fontSize: 11, color: W.primary, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8 }}>Your companion · 3 of 3</Txt>
        <Txt font="comp" weight={700} style={{ fontSize: 24, color: W.text, lineHeight: 30 }}>Give them a name.</Txt>
        <Txt font="user" style={{ marginTop: 6, fontSize: 13, color: W.text2 }}>Pick from below or write your own.</Txt>
        <View style={{ marginTop: 28, alignItems: 'center' }}>
          <TextInput
            value={name}
            onChangeText={setName}
            style={{
              backgroundColor: 'rgba(26,29,46,0.6)', color: W.text,
              borderWidth: 1, borderColor: 'rgba(124,114,255,0.25)',
              height: 64, borderRadius: 16, fontFamily: 'Manrope_600SemiBold', fontSize: 24,
              textAlign: 'center', width: '100%', maxWidth: 280,
            }}
          />
        </View>
        <View style={{ marginTop: 20, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
          {suggestions.map(s => {
            const isSel = name === s;
            return (
              <Pressable
                key={s}
                onPress={() => setName(s)}
                style={{
                  backgroundColor: isSel ? alpha(W.primary, '1f') : 'rgba(255,255,255,0.04)',
                  borderWidth: 1, borderColor: isSel ? alpha(W.primary, '66') : 'rgba(255,255,255,0.06)',
                  paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999,
                }}
              >
                <Txt font="comp" weight={500} style={{ fontSize: 13, color: isSel ? W.primary : W.text2 }}>{s}</Txt>
              </Pressable>
            );
          })}
        </View>
        <Txt font="user" style={{ marginTop: 16, fontSize: 12, color: W.text3, textAlign: 'center' }}>You can always change this later.</Txt>
      </View>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}>
        <PrimaryButton disabled={!name.trim()} onPress={() => { onPickName(name.trim()); go('meet'); }}>Meet {name.trim() || '…'}</PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── MEET ─────────────────────────────────────────────────────────────────
function MeetWord({ word, index }: { word: string; index: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
    }, 300 + index * 90);
    return () => clearTimeout(t);
  }, []);
  return <Animated.View style={{ opacity: v }}><Txt font="comp" weight={500} style={{ fontSize: 17, color: W.text, lineHeight: 25 }}>{word}</Txt></Animated.View>;
}

export function S_Meet({ go, companion, accent = W.primary }: { go: Go; companion: { name: string; archetype: Archetype }; accent?: string }) {
  const [step, setStep] = useState<'arriving' | 'speaking' | 'ready'>('arriving');
  const meetIn = useMeetIn();
  const nameEntrance = useEntrance({ fromTranslateY: 8, durationMs: 600 });
  useEffect(() => {
    const t1 = setTimeout(() => setStep('speaking'), 1200);
    const t2 = setTimeout(() => setStep('ready'), 3800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  const greeting = `Hi — I'm ${companion.name}. I've been hoping to meet you.`;
  const words = greeting.split(' ');
  const showCompanion = step !== 'arriving';
  return (
    <Screen hideHomeIndicator ambient={false}>
      <AmbientBg intensity={2.4} includePulse />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, zIndex: 1 }}>
        <Animated.View style={meetIn}>
          <Orb state={step === 'speaking' ? 'speaking' : 'idle'} size={180} accent={accent} />
        </Animated.View>
        <View style={{ alignItems: 'center', opacity: showCompanion ? 1 : 0 }}>
          {showCompanion && (
            <Animated.View style={[{ marginTop: -20, flexDirection: 'row', alignItems: 'center', gap: 10 }, nameEntrance]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent, shadowColor: accent, shadowOpacity: 1, shadowRadius: 10, shadowOffset: { width: 0, height: 0 } }} />
              <Txt font="comp" weight={600} style={{ fontSize: 28, color: W.text, letterSpacing: -0.3 }}>{companion.name}</Txt>
            </Animated.View>
          )}
          {showCompanion && (
            <View style={{ marginTop: 18, maxWidth: 300, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
              {words.map((w, i) => <MeetWord key={i} word={w} index={i} />)}
            </View>
          )}
        </View>
      </View>
      <View style={{ paddingHorizontal: 24, paddingBottom: 24, minHeight: 80, justifyContent: 'flex-end' }}>
        {step === 'ready' && (
          <FadeIn translateY={0} style={{ width: '100%' }}>
            <PrimaryButton onPress={() => go('first-chat')}>Say hi</PrimaryButton>
          </FadeIn>
        )}
      </View>
      <HomeIndicator />
    </Screen>
  );
}
