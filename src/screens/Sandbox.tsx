// Sandbox.tsx — S19 Sandbox Home, S20 Sandbox Session. Ported from sandbox.jsx.
// The diagonal "different rules" grid is drawn with react-native-svg's Pattern;
// the color bleed uses RadialGlow; sheets/overlays use absolute Views + blur.

import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import Svg, { Defs, Pattern, Line, Rect } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Screen, TopBar } from '../components/Chrome';
import { RadialGlow } from '../components/RadialGlow';
import { NavIcon, IconName } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { BubbleMem, ChatInput } from '../components/ChatBits';
import { W, alpha } from '../theme/theme';
import { SANDBOX_MODES, SandboxMode } from '../data/config';
import { Go } from '../navigation/types';

// Faint diagonal hatch behind the whole sandbox surface.
function DiagonalGrid({ color = 'rgba(124,114,255,0.05)', spacing = 16, opacity = 0.7 }: { color?: string; spacing?: number; opacity?: number }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity }}>
      <Svg width="100%" height="100%">
        <Defs>
          <Pattern id="diag" patternUnits="userSpaceOnUse" width={spacing} height={spacing} patternTransform="rotate(45)">
            <Line x1="0" y1="0" x2="0" y2={spacing} stroke={color} strokeWidth="1" />
          </Pattern>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#diag)" />
      </Svg>
    </View>
  );
}

// ─── S19 SANDBOX HOME ────────────────────────────────────────────────────
export function S19_SandboxHome({ go, comingSoon, isMinor, openMode }: { go: Go; comingSoon: boolean; isMinor: boolean; openMode: (m: SandboxMode) => void }) {
  const [activeMode, setActiveMode] = useState<string | null>(null);
  const bleedColor = activeMode ? SANDBOX_MODES.find(m => m.id === activeMode)?.accent ?? null : null;

  return (
    <Screen>
      <DiagonalGrid />
      {/* dynamic color bleed for the pressed card */}
      <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '60%', marginLeft: -200, marginTop: -200, width: 400, height: 400 }}>
        {bleedColor && (
          <RadialGlow
            width={400}
            height={400}
            stops={[
              { offset: 0, color: bleedColor, opacity: 0.15 },
              { offset: 0.7, color: bleedColor, opacity: 0 },
            ]}
          />
        )}
      </View>
      <TopBar
        left={<Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text }}>Sandbox</Txt>}
        right={
          <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: 'rgba(26,29,46,0.5)', alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>i</Txt>
          </View>
        }
      />
      {/* disclaimer */}
      <View style={{ marginHorizontal: 16, marginBottom: 16, borderRadius: 10, padding: 10, paddingHorizontal: 14, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(196,181,253,0.10)', borderLeftWidth: 2, borderLeftColor: W.secondary, backgroundColor: 'rgba(26,29,46,0.55)' }}>
        <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <Txt font="user" style={{ fontSize: 12, color: W.text2, lineHeight: 17 }}>
          Sessions here are private. No long-term memory saved unless you choose to.
        </Txt>
      </View>
      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
          {SANDBOX_MODES.map(m => {
            const locked = m.id === 'intimate' && isMinor;
            const active = activeMode === m.id;
            return (
              <Pressable
                key={m.id}
                onPressIn={() => setActiveMode(m.id)}
                onPressOut={() => setActiveMode(null)}
                onPress={() => !comingSoon && !locked && openMode(m)}
                style={{
                  borderRadius: 16, padding: 16, gap: 8, overflow: 'hidden',
                  opacity: comingSoon ? 0.55 : 1,
                  borderWidth: 1, borderColor: active ? alpha(m.accent, '40') : 'rgba(124,114,255,0.10)',
                  backgroundColor: m.id === 'intimate' ? 'rgba(15,17,26,0.7)' : 'rgba(26,29,46,0.55)',
                }}
              >
                <BlurView intensity={m.id === 'intimate' ? 32 : 24} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: alpha(m.accent, '1f'), borderWidth: 1, borderColor: alpha(m.accent, '26'), alignItems: 'center', justifyContent: 'center' }}>
                    <NavIcon name={m.icon as IconName} color={m.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Txt font="user" weight={600} style={{ fontSize: 16, color: W.text }}>{m.name}</Txt>
                      {m.sub && m.sub.length <= 12 && (
                        <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8, backgroundColor: m.id === 'intimate' ? alpha(W.danger, '26') : 'rgba(255,255,255,0.06)' }}>
                          <Txt font="user" weight={600} style={{ fontSize: 10, color: m.id === 'intimate' ? W.danger : W.text2 }}>{m.sub}</Txt>
                        </View>
                      )}
                    </View>
                    {m.sub && m.sub.length > 12 && (
                      <Txt font="user" style={{ marginTop: 2, fontSize: 12, color: m.accent, opacity: 0.9 }}>{m.sub}</Txt>
                    )}
                  </View>
                  {locked && <NavIcon name="lock" color={W.text2} />}
                </View>
                <Txt font="user" style={{ fontSize: 12, color: W.text2, lineHeight: 18 }}>{m.desc}</Txt>
              </Pressable>
            );
          })}
        </ScrollView>
        {comingSoon && (
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, overflow: 'hidden' }}>
            <BlurView intensity={16} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,17,26,0.55)' }} />
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(124,114,255,0.12)', borderWidth: 1, borderColor: 'rgba(124,114,255,0.20)', alignItems: 'center', justifyContent: 'center', shadowColor: W.primary, shadowOpacity: 0.4, shadowRadius: 32, shadowOffset: { width: 0, height: 0 } }}>
              <NavIcon name="bell" color={W.primary} />
            </View>
            <Txt font="comp" weight={600} style={{ fontSize: 18, color: W.text, textAlign: 'center' }}>Sandbox is coming soon.</Txt>
            <Txt font="user" style={{ fontSize: 13, color: W.text2, textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>We're making sure it's done right.</Txt>
            <Pressable style={{ marginTop: 4, paddingVertical: 10, paddingHorizontal: 22, backgroundColor: W.primary, borderRadius: 22, shadowColor: W.primary, shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 6 } }}>
              <Txt font="user" weight={500} style={{ fontSize: 13, color: '#fff' }}>Notify me</Txt>
            </Pressable>
          </View>
        )}
      </View>
    </Screen>
  );
}

// ─── S20 SANDBOX SESSION ─────────────────────────────────────────────────
type SbMsg = { from: string; text: string };

export function S20_SandboxSession({ go, mode, onEnd }: { go: Go; mode: SandboxMode; onEnd?: () => void }) {
  const accent = mode.id === 'roast' ? W.challenger
    : mode.id === 'intimate' ? W.partner
    : mode.id === 'safe' ? W.partner
    : W.secondary;

  const initial: SbMsg[] = (() => {
    if (mode.id === 'incognito') return [{ from: 'comp', text: "This is between us. Nothing leaves here. What's on your mind?" }];
    if (mode.id === 'roast') return [{ from: 'comp', text: "Alright, gloves off. Hit me — what's the bad decision we're examining today?" }];
    if (mode.id === 'safe') return [{ from: 'comp', text: "I'm here. You're in a safe space. There's no wrong way to start." }];
    return [{ from: 'comp', text: "This is a space for intimate conversation between consenting adults. You're in control — say stop anytime." }];
  })();

  const [msgs, setMsgs] = useState<SbMsg[]>(initial);
  const [draft, setDraft] = useState('');
  const [showEnd, setShowEnd] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [msgs]);

  const send = () => {
    if (!draft.trim()) return;
    setMsgs(m => [...m, { from: 'user', text: draft.trim() }]);
    setDraft('');
    setTimeout(() => {
      const reply = mode.id === 'roast' ? "Oh that's the plan? Bold of you to call that a plan."
        : mode.id === 'safe' ? "Thank you for trusting me with that. Take your time."
        : "I hear you. Tell me more.";
      setMsgs(m => [...m, { from: 'comp', text: reply }]);
    }, 1200);
  };

  return (
    <Screen>
      <DiagonalGrid color={alpha(W.surface2, '1a')} spacing={14} opacity={0.5} />
      <TopBar
        left={<Pressable onPress={() => setShowEnd(true)}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <NavIcon name={mode.icon as IconName} color={mode.accent} />
            <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.text }}>{mode.name}</Txt>
          </View>
        }
        right={
          mode.id === 'incognito'
            ? <NavIcon name="eye-off" color={W.text2} />
            : <Pressable onPress={() => setShowEnd(true)}><Txt font="user" weight={500} style={{ fontSize: 13, color: W.danger }}>End</Txt></Pressable>
        }
        bg="rgba(15,17,26,0.55)"
        border
      />
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 }}>
        {msgs.map((m, i) => <BubbleMem key={i} from={m.from} text={m.text} accent={accent} />)}
      </ScrollView>
      <ChatInput draft={draft} setDraft={setDraft} onSend={send} companionName={mode.name} />
      {showEnd && (
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 30, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: alpha(W.bg, 'cc') }}>
          <View style={{ backgroundColor: W.surface1, borderRadius: 16, padding: 24, width: '100%', alignItems: 'center', gap: 14 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: W.accentDim, alignItems: 'center', justifyContent: 'center' }}>
              <NavIcon name="check" color={W.accent} />
            </View>
            <Txt font="comp" weight={600} style={{ fontSize: 17, color: W.text }}>Session cleared.</Txt>
            <Txt font="user" style={{ fontSize: 13, color: W.text2, textAlign: 'center' }}>Nothing saved.</Txt>
            <Pressable onPress={() => go('sandbox')} style={{ marginTop: 8, width: '100%', height: 44, backgroundColor: W.primary, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
              <Txt font="user" weight={500} style={{ fontSize: 14, color: '#fff' }}>Done</Txt>
            </Pressable>
          </View>
        </View>
      )}
    </Screen>
  );
}
