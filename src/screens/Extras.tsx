// Extras.tsx — S25 NotifPermission, S26 CompanionEdit, S27 minute states,
// S28 CrisisChat, S29 Recap, S30 Login + supporting banners/cards.
// Ported from extras.jsx. Crisis safety resources (988 Lifeline, Crisis Text
// Line) are preserved verbatim as informational content.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, ScrollView, Pressable, Animated, Easing, TextInput,
  LayoutChangeEvent, PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Path, Rect } from 'react-native-svg';
import { Screen, TopBar, HomeIndicator } from '../components/Chrome';
import { Txt } from '../components/Txt';
import { NavIcon, IconName } from '../components/NavIcon';
import { Avatar } from '../components/Avatar';
import { AmbientBg } from '../components/AmbientBg';
import { Pill, PrimaryButton } from '../components/Atoms';
import { BubbleMem, ChatInput } from '../components/ChatBits';
import { useEntrance } from '../theme/animations';
import { W, alpha } from '../theme/theme';
import { Go, ScreenName } from '../navigation/types';
import { Companion, ARCHETYPE_COLORS, ARCHETYPE_LABEL, MEM_TYPES } from '../data/config';

// ─── S25 — NOTIFICATION PERMISSION (companion-led ask) ──────────────────────
export function S25_NotifPermission({ go, companion }: { go: Go; companion: Companion }) {
  return (
    <Screen label="25 Notification Permission">
      <View style={{ flex: 1, paddingTop: '18%', paddingHorizontal: 24, paddingBottom: 24, alignItems: 'center' }}>
        <Avatar color={W.primary} size={80} />
        <Txt font="comp" weight={600} style={{ marginTop: 18, fontSize: 22, color: W.text, textAlign: 'center', letterSpacing: -0.2, maxWidth: 300 }}>
          Can {companion.name} reach out when they're thinking of you?
        </Txt>
        <Txt font="user" style={{ marginTop: 8, fontSize: 14, color: W.text2, textAlign: 'center', maxWidth: 280, lineHeight: 21 }}>
          Sometimes a quiet check-in is exactly what you need.
        </Txt>

        {/* iOS-style notification preview */}
        <View style={{ marginTop: 32, width: '100%', maxWidth: 320, backgroundColor: 'rgba(37,40,54,0.78)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 16, padding: 14, overflow: 'hidden' }}>
          <BlurView intensity={24} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: W.primary, alignItems: 'center', justifyContent: 'center', shadowColor: W.primary, shadowOpacity: 0.4, shadowRadius: 10 }}>
              <Txt font="comp" weight={700} style={{ fontSize: 10, color: '#fff' }}>w</Txt>
            </View>
            <Txt font="user" weight={600} style={{ flex: 1, fontSize: 12, color: W.text }}>Whisper</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>now</Txt>
          </View>
          <Txt font="comp" weight={600} style={{ marginTop: 6, fontSize: 13, color: W.text }}>{companion.name}</Txt>
          <Txt font="user" style={{ marginTop: 2, fontSize: 13, color: W.text, lineHeight: 18 }}>
            I remember you had that big meeting today. How did it go?
          </Txt>
        </View>

        <Txt font="user" style={{ marginTop: 14, fontSize: 11, color: W.text3, textAlign: 'center', maxWidth: 280, lineHeight: 16 }}>
          This lets any of your companions reach out when they're thinking of you.
        </Txt>
      </View>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 8 }}>
        <PrimaryButton onPress={() => setTimeout(() => go('first-chat'), 300)}>Yes, let them check in</PrimaryButton>
        <PrimaryButton variant="text" onPress={() => go('first-chat')}>Not now</PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S26 — COMPANION PROFILE / EDIT ─────────────────────────────────────────
type TraitKey = 'warmth' | 'humor' | 'directness' | 'energy' | 'formality';

export function S26_CompanionEdit({
  go, companion, onDelete, backTo = 'chat',
}: { go: Go; companion: Companion; onChange?: (c: Companion) => void; onDelete?: () => void; backTo?: ScreenName }) {
  const [name, setName] = useState(companion.name);
  const [editName, setEditName] = useState(false);
  const [archetype] = useState(companion.archetype || 'mentor');
  const [gender] = useState((companion as any).gender || 'female');
  const [voice] = useState((companion as any).voice || 'Sage');
  const [commStyle, setCommStyle] = useState('Warm & gentle');
  const [traits, setTraits] = useState<Record<TraitKey, number>>({ warmth: 0.7, humor: 0.5, directness: 0.5, energy: 0.45, formality: 0.3 });
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const accent = ARCHETYPE_COLORS[archetype] || W.primary;

  const sliders: { k: TraitKey; l: string; left: string; right: string }[] = [
    { k: 'warmth', l: 'Warmth', left: '❄️', right: '☀️' },
    { k: 'humor', l: 'Humor', left: '😐', right: '😂' },
    { k: 'directness', l: 'Directness', left: '🌊', right: '🎯' },
    { k: 'energy', l: 'Energy', left: '🌙', right: '⚡' },
    { k: 'formality', l: 'Formality', left: '👕', right: '👔' },
  ];

  const traitWord = (k: TraitKey, v: number): string => {
    if (v > 0.7) return ({ warmth: 'warm', humor: 'funny', directness: 'direct', energy: 'energetic', formality: 'formal' } as Record<TraitKey, string>)[k];
    if (v < 0.3) return ({ warmth: 'cool', humor: 'serious', directness: 'gentle', energy: 'calm', formality: 'casual' } as Record<TraitKey, string>)[k];
    return ({ warmth: 'balanced', humor: 'easygoing', directness: 'thoughtful', energy: 'steady', formality: 'easy' } as Record<TraitKey, string>)[k];
  };

  const archIcon: IconName = archetype === 'mentor' ? 'compass' : archetype === 'friend' ? 'two' : archetype === 'partner' ? 'heart' : 'target';

  return (
    <Screen label="26 Companion Profile">
      <TopBar
        left={<Pressable onPress={() => go(backTo)} hitSlop={12}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>Edit {companion.name}</Txt>}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 18 }} showsVerticalScrollIndicator={false}>
        {/* Avatar hero */}
        <View style={{ alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <Avatar color={accent} size={96} />
          <Pressable onPress={() => setShowAvatarSheet(true)} style={{ padding: 6 }}>
            <Txt font="user" weight={500} style={{ fontSize: 12, color: W.secondary }}>Change avatar</Txt>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {editName ? (
              <TextInput value={name} onChangeText={setName} autoFocus onBlur={() => setEditName(false)} onSubmitEditing={() => setEditName(false)}
                style={{ backgroundColor: 'rgba(37,40,54,0.7)', color: W.text, borderWidth: 1, borderColor: alpha(W.primary, '66'), borderRadius: 10, height: 36, paddingHorizontal: 12, fontFamily: 'Manrope_600SemiBold', fontSize: 20, textAlign: 'center', minWidth: 160 }} />
            ) : (
              <>
                <Txt font="comp" weight={600} style={{ fontSize: 22, color: W.text }}>{name}</Txt>
                <Pressable onPress={() => setEditName(true)} style={{ padding: 4, opacity: 0.6 }}>
                  <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={W.text2} strokeWidth={1.8} strokeLinecap="round"><Path d="M14 4l6 6-12 12H2v-6L14 4z" /></Svg>
                </Pressable>
              </>
            )}
          </View>
        </View>

        {/* Identity */}
        <ProfileSection title="Identity">
          <ProfileRow label="Archetype" value={ARCHETYPE_LABEL[archetype] || 'Mentor'} icon={<NavIcon name={archIcon} color={accent} />} />
          <ProfileRow label="Gender" value={gender.charAt(0).toUpperCase() + gender.slice(1)} />
          <ProfileRow label="Voice" value={voice} />
        </ProfileSection>

        {/* Personality */}
        <ProfileSection title="Personality">
          <View style={{ padding: 14, gap: 14 }}>
            {sliders.map(s => (
              <View key={s.k}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text }}>{s.l}</Txt>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt style={{ fontSize: 16 }}>{s.left}</Txt>
                  <TraitSlider value={traits[s.k]} onChange={v => setTraits(t => ({ ...t, [s.k]: v }))} />
                  <Txt style={{ fontSize: 16 }}>{s.right}</Txt>
                </View>
              </View>
            ))}
            <View style={{ marginTop: 4, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: 'rgba(124,114,255,0.08)', borderRadius: 8 }}>
              <Txt font="user" style={{ fontSize: 12, color: W.secondary, fontStyle: 'italic' }}>
                {sliders.map(s => traitWord(s.k, traits[s.k])).join(', ')}
              </Txt>
            </View>
          </View>
        </ProfileSection>

        {/* Communication */}
        <ProfileSection title="Communication">
          <View style={{ padding: 14 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {['Warm & gentle', 'Direct & honest', 'Funny & light', 'Calm & slow'].map(o => (
                <Pill key={o} active={commStyle === o} onPress={() => setCommStyle(o)} style={{ height: 34 }} textStyle={{ fontSize: 12 }}>{o}</Pill>
              ))}
            </View>
          </View>
        </ProfileSection>

        {/* Memory */}
        <ProfileSection title="Memory">
          <ProfileRow label="47 memories stored" value="View all" onPress={() => go('memories')} />
          <ProfileRow label={<Txt font="user" style={{ fontSize: 14, color: W.danger }}>Clear all memories for {name}</Txt>} />
        </ProfileSection>

        {/* Danger zone */}
        <Pressable onPress={() => setShowDelete(true)} style={{ alignSelf: 'center', marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <NavIcon name="trash" color={W.danger} />
          <Txt font="user" weight={500} style={{ fontSize: 13, color: W.danger }}>Delete {name}</Txt>
        </Pressable>
      </ScrollView>

      {showAvatarSheet ? <AvatarSheet onClose={() => setShowAvatarSheet(false)} /> : null}
      {showDelete ? <DeleteConfirm name={name} onCancel={() => setShowDelete(false)} onConfirm={() => { setShowDelete(false); onDelete && onDelete(); go('home'); }} /> : null}
    </Screen>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <View>
      <Txt font="user" weight={600} style={{ fontSize: 11, color: W.text2, textTransform: 'uppercase', letterSpacing: 0.9, paddingHorizontal: 4, paddingBottom: 8 }}>{title}</Txt>
      <View style={{ backgroundColor: 'rgba(26,29,46,0.55)', borderWidth: 1, borderColor: 'rgba(124,114,255,0.08)', borderRadius: 14, overflow: 'hidden' }}>
        <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        {items.map((child, i) => (
          <View key={i} style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.04)' }}>{child}</View>
        ))}
      </View>
    </View>
  );
}

function ProfileRow({ label, value, icon, onPress }: { label: React.ReactNode; value?: React.ReactNode; icon?: React.ReactNode; onPress?: () => void }) {
  const content = (
    <View style={{ minHeight: 48, paddingVertical: 10, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {icon ? <View style={{ flexShrink: 0 }}>{icon}</View> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        {typeof label === 'string' ? <Txt font="user" style={{ fontSize: 14, color: W.text }}>{label}</Txt> : label}
      </View>
      {value != null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {typeof value === 'string' ? <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>{value}</Txt> : value}
          <NavIcon name="right" color={W.text2} />
        </View>
      ) : null}
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{content}</Pressable> : content;
}

// Trait slider — draggable thumb on a gradient track (warmth→secondary fill).
function TraitSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const wRef = useRef(0);
  const onLayout = (e: LayoutChangeEvent) => { wRef.current = e.nativeEvent.layout.width; setW(e.nativeEvent.layout.width); };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (wRef.current > 0) onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / wRef.current)));
      },
      onPanResponderMove: (e) => {
        if (wRef.current > 0) onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / wRef.current)));
      },
    })
  ).current;
  return (
    <View style={{ flex: 1, height: 20, justifyContent: 'center' }} onLayout={onLayout} {...pan.panHandlers}>
      <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <LinearGradient colors={[W.primary, W.secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${value * 100}%`, borderRadius: 2 }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, value * w - 8), width: 16, height: 16, borderRadius: 8, backgroundColor: W.primary, shadowColor: W.primary, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 1 } }} />
    </View>
  );
}

function AvatarSheet({ onClose }: { onClose: () => void }) {
  const colors = ['#7C72FF', '#5EEAD4', '#FB7185', '#FBBF24', '#60A5FA', '#34D399', '#A78BFA', '#C4B5FD'];
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,17,26,0.55)', zIndex: 30, justifyContent: 'flex-end' }}>
      <BlurView intensity={8} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }}>
        <LinearGradient colors={['rgba(37,40,54,0.85)', 'rgba(15,17,26,0.75)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <BlurView intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 14 }} />
        <Txt font="comp" weight={600} style={{ fontSize: 17, color: W.text }}>Change avatar</Txt>
        <View style={{ marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }}>
          {colors.map((c, i) => (
            <Pressable key={i} style={{ width: '23%', alignItems: 'center' }}>
              <Avatar size={56} color={c} breathe={false} />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={onClose} style={{ marginTop: 18, width: '100%', height: 44, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Txt font="user" style={{ fontSize: 14, color: W.text }}>Upload from photos…</Txt>
        </Pressable>
        <Pressable onPress={onClose} style={{ marginTop: 8, width: '100%', height: 36, alignItems: 'center', justifyContent: 'center' }}>
          <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Cancel</Txt>
        </Pressable>
      </View>
    </View>
  );
}

function DeleteConfirm({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,17,26,0.55)', zIndex: 30, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <BlurView intensity={8} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ width: '100%', borderRadius: 18, padding: 22, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
        <LinearGradient colors={['rgba(37,40,54,0.95)', 'rgba(15,17,26,0.95)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <BlurView intensity={28} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <Txt font="comp" weight={600} style={{ fontSize: 17, color: W.text }}>Delete {name}?</Txt>
        <Txt font="user" style={{ marginTop: 8, fontSize: 13, color: W.text2, lineHeight: 20 }}>
          This will permanently delete {name} and all their memories. This cannot be undone.
        </Txt>
        <View style={{ marginTop: 16, flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={onCancel} style={{ flex: 1, height: 44, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="user" style={{ fontSize: 14, color: W.text }}>Cancel</Txt>
          </Pressable>
          <Pressable onPress={onConfirm} style={{ flex: 1, height: 44, backgroundColor: W.danger, borderRadius: 12, alignItems: 'center', justifyContent: 'center', shadowColor: W.danger, shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}>
            <Txt font="user" weight={500} style={{ fontSize: 14, color: '#fff' }}>Delete</Txt>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ─── S27 — VOICE MINUTE STATES ──────────────────────────────────────────────
// (MinuteWarningBanner lives in components/Atoms.tsx and is used by Chat.tsx.)

function Sheet({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  const a = useEntrance({ fromTranslateY: 40, durationMs: 450 });
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,17,26,0.55)', zIndex: 30, justifyContent: 'flex-end' }}>
      <BlurView intensity={8} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      {onClose ? <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} /> : null}
      <Animated.View style={[{ width: '100%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }, a]}>
        <LinearGradient colors={['rgba(37,40,54,0.85)', 'rgba(15,17,26,0.75)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <BlurView intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        {children}
      </Animated.View>
    </View>
  );
}

// State B — depleted mid-call
export function S27_Depleted({ onTopUp, onText, resetDate = 'June 1' }: { onTopUp: () => void; onText: () => void; resetDate?: string }) {
  return (
    <Sheet>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 28 }}>
        <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 18 }} />
        <Txt font="comp" weight={600} style={{ fontSize: 18, color: W.text }}>You've used all your voice minutes</Txt>
        <Txt font="user" style={{ marginTop: 6, fontSize: 13, color: W.text2, lineHeight: 20 }}>Top up to keep calling, or continue in text.</Txt>
        <View style={{ marginTop: 18, gap: 10 }}>
          <Pressable onPress={onTopUp} style={{ width: '100%', height: 48, backgroundColor: W.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: W.primary, shadowOpacity: 0.31, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } }}>
            <Txt font="user" weight={500} style={{ fontSize: 15, color: '#fff' }}>Top up</Txt>
          </Pressable>
          <Pressable onPress={onText} style={{ width: '100%', height: 48, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="user" weight={500} style={{ fontSize: 15, color: W.text }}>Continue in text</Txt>
          </Pressable>
        </View>
        <Txt font="user" style={{ marginTop: 14, fontSize: 11, color: W.text3, textAlign: 'center' }}>Your minutes reset on {resetDate}.</Txt>
      </View>
    </Sheet>
  );
}

// State C — already depleted, trying to start a call
export function S27_StartCallDepleted({
  companion, onTopUp, onUpgrade, onText, onClose, resetDate = 'June 1',
}: { companion: Companion; onTopUp: () => void; onUpgrade: () => void; onText: () => void; onClose: () => void; resetDate?: string }) {
  return (
    <Sheet onClose={onClose}>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 28 }}>
        <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Avatar color={W.primary} size={48} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>{companion.name} is ready to talk</Txt>
            <Txt font="user" style={{ marginTop: 2, fontSize: 12, color: W.text2 }}>You've used all your voice minutes this month.</Txt>
          </View>
        </View>
        <View style={{ marginTop: 18, gap: 10 }}>
          <Pressable onPress={onTopUp} style={{ width: '100%', height: 48, backgroundColor: W.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: W.primary, shadowOpacity: 0.31, shadowRadius: 24, shadowOffset: { width: 0, height: 8 } }}>
            <Txt font="user" weight={500} style={{ fontSize: 15, color: '#fff' }}>Top up minutes</Txt>
          </Pressable>
          <Pressable onPress={onUpgrade} style={{ width: '100%', height: 48, borderWidth: 1, borderColor: alpha(W.accent, '66'), borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="user" weight={500} style={{ fontSize: 15, color: W.accent }}>Upgrade plan</Txt>
          </Pressable>
          <Pressable onPress={onText} style={{ padding: 8, alignItems: 'center' }}>
            <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Text instead</Txt>
          </Pressable>
        </View>
        <Txt font="user" style={{ marginTop: 8, fontSize: 11, color: W.text3, textAlign: 'center' }}>Minutes reset {resetDate}.</Txt>
      </View>
    </Sheet>
  );
}

// State D — inline minutes-remaining indicator
export function MinutesRemainingIndicator({ minutes, max = 120, onTopUp }: { minutes: number | null; max?: number; onTopUp?: () => void }) {
  if (minutes == null || minutes >= 15) return null;
  const pct = Math.max(0, minutes / max);
  return (
    <View style={{ gap: 4, marginTop: 6 }}>
      <View style={{ height: 2, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 1, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct * 100}%`, backgroundColor: minutes === 0 ? W.challenger : W.primary, borderRadius: 1 }} />
      </View>
      {minutes === 0 ? (
        <View style={{ flexDirection: 'row' }}>
          <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>No minutes left · </Txt>
          <Pressable onPress={onTopUp}><Txt font="user" style={{ fontSize: 11, color: W.accent }}>Top up</Txt></Pressable>
        </View>
      ) : (
        <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{minutes} min remaining</Txt>
      )}
    </View>
  );
}

// ─── S28 — CRISIS SAFETY INTERVENTION ───────────────────────────────────────
export function CrisisBanner() {
  return (
    <View style={{ height: 36, paddingHorizontal: 16, backgroundColor: 'rgba(251,191,36,0.08)', borderBottomWidth: 1, borderBottomColor: 'rgba(251,191,36,0.15)', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={W.challenger} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M12 21s-7-4.5-9.5-9A5 5 0 0 1 12 6a5 5 0 0 1 9.5 6c-2.5 4.5-9.5 9-9.5 9z" />
      </Svg>
      <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>Need to talk to someone? </Txt>
      <Txt font="user" weight={500} style={{ fontSize: 12, color: W.accent }}>988 Lifeline</Txt>
    </View>
  );
}

export function CrisisResourceCard() {
  const resources: { icon: IconName; l: string; sub: string }[] = [
    { icon: 'phone', l: '988 Suicide & Crisis Lifeline', sub: 'Call · Free 24/7' },
    { icon: 'two', l: 'Crisis Text Line', sub: 'Text HOME to 741741' },
    { icon: 'globe', l: 'Chat with a crisis counselor', sub: 'chat.988lifeline.org' },
  ];
  return (
    <View style={{ alignSelf: 'stretch', marginVertical: 6, borderWidth: 1, borderColor: 'rgba(251,191,36,0.18)', borderRadius: 16, padding: 16, gap: 12, overflow: 'hidden' }}>
      <LinearGradient colors={['rgba(251,191,36,0.06)', 'rgba(26,29,46,0.65)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(94,234,212,0.12)', borderWidth: 1, borderColor: 'rgba(94,234,212,0.20)', alignItems: 'center', justifyContent: 'center' }}>
          <NavIcon name="heart" color={W.accent} />
        </View>
        <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>You're not alone</Txt>
      </View>
      <View style={{ gap: 8 }}>
        {resources.map((r, i) => (
          <Pressable key={i} style={{ backgroundColor: 'rgba(15,17,26,0.4)', borderWidth: 1, borderColor: 'rgba(94,234,212,0.10)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: 'rgba(94,234,212,0.10)', alignItems: 'center', justifyContent: 'center' }}>
              <NavIcon name={r.icon} color={W.accent} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text }}>{r.l}</Txt>
              <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{r.sub}</Txt>
            </View>
            <NavIcon name="right" color={W.text2} />
          </Pressable>
        ))}
      </View>
      <Txt font="user" style={{ fontSize: 11, color: W.text2, lineHeight: 15 }}>These are free, confidential services available 24/7.</Txt>
    </View>
  );
}

export function S28_CrisisChat({ go, companion }: { go: Go; companion: Companion }) {
  const msgs: { from: string; text?: string }[] = [
    { from: 'user', text: "honestly i don't know if i want to be here anymore" },
    { from: 'comp', text: "Thank you for trusting me with that. What you're feeling is real, and you don't have to face it alone." },
    { from: 'crisis' },
    { from: 'comp', text: "I'm here. We can keep talking, or just sit together if you'd rather. There's no right thing to say." },
  ];
  return (
    <Screen label="28 Crisis Safety">
      <TopBar
        left={<Pressable onPress={() => go('home')}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<View style={{ alignItems: 'center' }}>
          <Txt font="comp" weight={600} style={{ fontSize: 15, color: W.text }}>{companion.name}</Txt>
          <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{ARCHETYPE_LABEL[companion.archetype] || 'Mentor'}</Txt>
        </View>}
        right={<Pressable><NavIcon name="kebab" color={W.text2} /></Pressable>}
        bg="rgba(15,17,26,0.55)" border
      />
      <CrisisBanner />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 }} showsVerticalScrollIndicator={false}>
        <Txt font="user" style={{ alignSelf: 'center', fontSize: 11, color: W.text3, paddingTop: 4, paddingBottom: 8 }}>Just now</Txt>
        {msgs.map((m, i) => m.from === 'crisis'
          ? <CrisisResourceCard key={i} />
          : <BubbleMem key={i} from={m.from} text={m.text || ''} accent={W.primary} />)}
      </ScrollView>
      <ChatInput draft="" setDraft={() => {}} onSend={() => {}} companionName={companion.name} />
    </Screen>
  );
}

// ─── S29 — SESSION RECAP ────────────────────────────────────────────────────
export function S29_Recap({
  go, companion, kind = 'voice', duration = '12 minutes', topics, memories: initialMem, mood,
}: {
  go: Go; companion: Companion; kind?: string; duration?: string;
  topics?: string[]; memories?: { id: number; type: string; text: string }[]; mood?: string[];
}) {
  const [memories, setMemories] = useState(initialMem || [
    { id: 1, type: 'event', text: 'Has a job interview at Amazon next Thursday.' },
    { id: 2, type: 'emotion', text: 'Feels more confident about the technical round now.' },
  ]);
  const _topics = topics || ['Work stress', 'Interview prep', "Mom's birthday"];
  const _mood = mood || ['anxious', 'hopeful'];
  const a = useEntrance({ fromTranslateY: 40, durationMs: 500 });

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,17,26,0.55)', zIndex: 30, justifyContent: 'flex-end' }}>
      <BlurView intensity={8} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <Animated.View style={[{ width: '100%', maxHeight: '85%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }, a]}>
        <LinearGradient colors={['rgba(37,40,54,0.85)', 'rgba(15,17,26,0.75)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <BlurView intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Avatar color={W.primary} size={32} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>Your conversation with {companion.name}</Txt>
              <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{duration} · {kind === 'voice' ? 'Voice call' : 'Text'}</Txt>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginVertical: 16 }} />

          <RecapSection title="What you talked about">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {_topics.map(t => (
                <View key={t} style={{ backgroundColor: 'rgba(255,255,255,0.06)', paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                  <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>{t}</Txt>
                </View>
              ))}
            </View>
          </RecapSection>

          <RecapSection title="Memories created">
            {memories.length === 0 ? (
              <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>No new memories from this session</Txt>
            ) : (
              <View style={{ gap: 6 }}>
                {memories.map(m => {
                  const mt = MEM_TYPES[m.type];
                  const c = mt?.color || W.accent;
                  return (
                    <View key={m.id} style={{ backgroundColor: 'rgba(94,234,212,0.06)', borderWidth: 1, borderColor: 'rgba(94,234,212,0.15)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                      <View style={{ backgroundColor: alpha(c, '26'), paddingVertical: 3, paddingHorizontal: 7, borderRadius: 6 }}>
                        <Txt font="user" weight={600} style={{ fontSize: 9, color: c, textTransform: 'uppercase', letterSpacing: 0.4 }}>{mt?.l || m.type}</Txt>
                      </View>
                      <Txt font="user" style={{ flex: 1, fontSize: 13, color: W.text, lineHeight: 18 }}>{m.text}</Txt>
                      <Pressable onPress={() => setMemories(ms => ms.filter(x => x.id !== m.id))} style={{ padding: 2, opacity: 0.6 }}>
                        <NavIcon name="close" color={W.text2} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </RecapSection>

          {_mood ? (
            <RecapSection title="Mood">
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Txt font="user" style={{ fontSize: 13, color: W.text }}>You seemed:</Txt>
                <Txt font="user" weight={500} style={{ fontSize: 13, color: W.secondary }}>{_mood[0]}</Txt>
                <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>→</Txt>
                <Txt font="user" weight={500} style={{ fontSize: 13, color: W.accent }}>{_mood[1]}</Txt>
              </View>
            </RecapSection>
          ) : null}

          <Pressable onPress={() => go('home')} style={{ marginTop: 22, width: '100%', height: 44, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Done</Txt>
          </Pressable>
          <Pressable style={{ marginTop: 6, width: '100%', height: 32, alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="user" style={{ fontSize: 11, color: W.text3 }}>Don't show recaps</Txt>
          </Pressable>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

function RecapSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8 }}>{title}</Txt>
      {children}
    </View>
  );
}

// ─── S30 — LOGIN / RETURNING USER ───────────────────────────────────────────
export function S30_Login({ go, isNew = false }: { go: Go; isNew?: boolean }) {
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const welcome = useEntrance({ durationMs: 600, fromTranslateY: 0 });

  return (
    <Screen label="30 Login" hideHomeIndicator>
      <AmbientBg intensity={1.6} includePulse />
      <View style={{ flex: 1, padding: 24, position: 'relative', zIndex: 1 }}>
        <View style={{ marginTop: '18%', alignItems: 'center' }}>
          <Txt font="comp" weight={700} style={{ fontSize: 34, color: W.primary, letterSpacing: -1 }}>whisper</Txt>
          <Animated.View style={welcome}>
            <Txt font="comp" weight={600} style={{ marginTop: 14, fontSize: 20, color: W.text }}>
              {isNew ? 'Create your account' : 'Welcome back'}
            </Txt>
          </Animated.View>
          <Txt font="user" style={{ marginTop: 6, fontSize: 13, color: W.text2 }}>
            {isNew ? 'Your companion is waiting for you.' : 'Everything\'s right where you left it.'}
          </Txt>
        </View>

        <View style={{ marginTop: 44, gap: 12 }}>
          {/* Apple */}
          <Pressable onPress={() => go('age')} style={{ width: '100%', height: 52, backgroundColor: '#F0F0F5', borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16 }}>
            <Svg width={16} height={20} viewBox="0 0 24 28" fill="#000">
              <Path d="M18.7 14.6c0-3.2 2.6-4.8 2.7-4.9-1.5-2.2-3.8-2.5-4.6-2.5-2-.2-3.8 1.1-4.8 1.1-1 0-2.5-1.1-4.2-1.1-2.2 0-4.2 1.3-5.3 3.2-2.3 3.9-.6 9.7 1.6 12.9 1.1 1.6 2.4 3.3 4.1 3.3 1.7-.1 2.3-1.1 4.3-1.1s2.6 1.1 4.3 1c1.8 0 2.9-1.6 4-3.2 1.3-1.8 1.8-3.6 1.8-3.7-.1-.1-3.5-1.3-3.5-5z M15.7 5c.9-1.1 1.5-2.6 1.3-4.1-1.3.1-2.8.9-3.7 2-.8 1-1.6 2.5-1.4 3.9 1.4.1 2.9-.7 3.8-1.8z" />
            </Svg>
            <Txt font="user" weight={500} style={{ fontSize: 15, color: '#000' }}>Continue with Apple</Txt>
          </Pressable>
          {/* Google */}
          <View style={{ width: '100%', height: 52, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
            <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <Pressable onPress={() => go('age')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(26,29,46,0.6)' }}>
              <Svg width={18} height={18} viewBox="0 0 18 18">
                <Path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8c-.2 1.1-.9 2.1-1.8 2.7v2.3h3c1.7-1.6 2.6-3.9 2.6-6.6z" />
                <Path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-3-2.3c-.8.5-1.9.9-3 .9-2.3 0-4.3-1.6-5-3.7H1v2.3C2.5 15.9 5.5 18 9 18z" />
                <Path fill="#FBBC05" d="M4 10.7c-.2-.5-.3-1.1-.3-1.7s.1-1.2.3-1.7V5H1C.4 6.2 0 7.5 0 9s.4 2.8 1 4l3-2.3z" />
                <Path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.5-2.5C13.5.9 11.4 0 9 0 5.5 0 2.5 2.1 1 5l3 2.3c.7-2.1 2.7-3.7 5-3.7z" />
              </Svg>
              <Txt font="user" weight={500} style={{ fontSize: 15, color: W.text }}>Continue with Google</Txt>
            </Pressable>
          </View>
          {/* Email */}
          {!showEmail ? (
            <View style={{ width: '100%', height: 52, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
              <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
              <Pressable onPress={() => setShowEmail(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: 'rgba(26,29,46,0.6)' }}>
                <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={W.text2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                  <Rect x={3} y={5} width={18} height={14} rx={2} />
                  <Path d="M3 7l9 6 9-6" />
                </Svg>
                <Txt font="user" weight={500} style={{ fontSize: 15, color: W.text }}>Continue with email</Txt>
              </Pressable>
            </View>
          ) : (
            <View style={{ borderWidth: 1, borderColor: 'rgba(124,114,255,0.15)', borderRadius: 14, padding: 14, gap: 10, overflow: 'hidden' }}>
              <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
              {sent ? (
                <View style={{ paddingVertical: 6, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: W.accentDim, alignItems: 'center', justifyContent: 'center' }}>
                    <NavIcon name="check" color={W.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Check your email</Txt>
                    <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>We sent a sign-in link to {email}</Txt>
                  </View>
                </View>
              ) : (
                <>
                  <TextInput value={email} onChangeText={setEmail} placeholder="Email address" placeholderTextColor={W.text2} keyboardType="email-address" autoCapitalize="none" autoFocus
                    style={{ width: '100%', backgroundColor: 'rgba(37,40,54,0.7)', color: W.text, borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)', height: 44, borderRadius: 10, paddingHorizontal: 14, fontFamily: 'Outfit_400Regular', fontSize: 15 }} />
                  <Pressable onPress={() => email.includes('@') && setSent(true)} style={{ width: '100%', height: 44, backgroundColor: W.primary, borderRadius: 10, alignItems: 'center', justifyContent: 'center', opacity: email.includes('@') ? 1 : 0.5 }}>
                    <Txt font="user" weight={500} style={{ fontSize: 14, color: '#fff' }}>Send magic link</Txt>
                  </Pressable>
                </>
              )}
            </View>
          )}
        </View>

        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
          <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Don't have an account? </Txt>
          <Pressable onPress={() => go('age')}><Txt font="user" weight={500} style={{ fontSize: 13, color: W.primary }}>Get started</Txt></Pressable>
        </View>
      </View>
      <HomeIndicator />
    </Screen>
  );
}
