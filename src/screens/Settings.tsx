// Settings.tsx — S21 Settings, S22 Memories, S23 Paywall, S24 Voice Top-up.
// Ported from settings.jsx. Paywall/top-up are modal bottom sheets rendered
// over the home screen by the router (they navigate via `go`, not tap-to-close,
// matching the prototype).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, ScrollView, Pressable, Animated, Easing,
  LayoutChangeEvent, PanResponder, TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Path } from 'react-native-svg';
import { Screen, TopBar } from '../components/Chrome';
import { NavIcon } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { Card, Toggle, PrimaryButton } from '../components/Atoms';
import { useEntrance, usePressScale, useCountUp } from '../theme/animations';
import { W, alpha } from '../theme/theme';
import { ARCHETYPE_COLORS, ARCHETYPE_LABEL, MEM_TYPES, SAMPLE_MEMORIES, Companion, Tier, Memory } from '../data/config';
import { Go, ScreenName } from '../navigation/types';
import { getMemories, deleteMemory, deleteAllMemories, ApiMemory } from '../api';

export interface AppSettings {
  dailyCheckin: boolean;
  weeklyReflection: boolean;
  autoPlay: boolean;
  liveCaptions: boolean;
}

// ─── S21 SETTINGS ────────────────────────────────────────────────────────
interface SettingsProps {
  go: Go;
  tier: Tier;
  companions: Companion[];
  userName: string;
  userEmail: string;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  openCompanionProfile?: (c: Companion) => void;
}

export function S21_Settings({ go, tier, companions, userName, userEmail, settings, setSettings, openCompanionProfile }: SettingsProps) {
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [bgSoundIdx, setBgSoundIdx] = useState(0);
  // Notification time as an exact moment of day.
  const [notifHour, setNotifHour] = useState(21);   // 9 PM default
  const [notifMinute, setNotifMinute] = useState(0);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [info, setInfo] = useState<{ title: string; body: string } | null>(null);
  const enter = useEntrance({ durationMs: 420, fromTranslateY: 14 });

  const BG_SOUNDS = ['Off', 'Rain', 'Ocean', 'Fireplace', 'White noise'];
  const notifTimeLabel = useMemo(() => formatTime(notifHour, notifMinute), [notifHour, notifMinute]);

  return (
    <Screen>
      <TopBar
        height={64}
        left={
          <View>
            <Txt font="comp" weight={700} style={{ fontSize: 24, color: W.cream, letterSpacing: -0.5 }}>Settings</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2, letterSpacing: 0.4, marginTop: 1 }}>Personalize your whisper</Txt>
          </View>
        }
      />
      <Animated.ScrollView style={[{ flex: 1 }, enter]} contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 32, gap: 18 }} showsVerticalScrollIndicator={false}>
        {/* User card — tap to edit your own profile (not a companion) */}
        <Card onPress={() => go('user-profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: W.surface2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <LinearGradient colors={[alpha(W.primary, '80'), alpha(W.accent, '60')]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <Txt font="user" weight={600} style={{ fontSize: 18, color: '#fff' }}>{userName[0]}</Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt font="user" weight={500} style={{ fontSize: 15, color: W.text }}>{userName}</Txt>
            <Txt font="user" style={{ fontSize: 12, color: W.text2 }} numberOfLines={1}>{userEmail}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Txt font="user" style={{ fontSize: 12, color: W.secondary }}>Edit</Txt>
            <NavIcon name="right" color={W.secondary} size={16} />
          </View>
        </Card>

        {/* Premium stats hero — streak, minutes left, total talk time */}
        <StatsHero
          streak={12}
          minutesLeft={87}
          minutesTotal={120}
          talkTimeMinutes={342}
          onMinutesPress={() => go('topup')}
        />

        <Section title="My companions">
          {companions.map(c => {
            const accent = ARCHETYPE_COLORS[c.archetype] || W.primary;
            return (
              <Row
                key={c.id}
                onPress={() => openCompanionProfile ? openCompanionProfile(c) : go('profile')}
                label={
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                      <LinearGradient colors={[alpha(accent, 'cc'), alpha(accent, '55')]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                      <Txt font="comp" weight={700} style={{ fontSize: 13, color: '#fff' }}>{c.name[0]}</Txt>
                    </View>
                    <View>
                      <Txt font="user" style={{ fontSize: 14, color: W.text }}>{c.name}</Txt>
                      <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{ARCHETYPE_LABEL[c.archetype]}</Txt>
                    </View>
                  </View>
                }
                right={<NavIcon name="right" color={W.text2} size={18} />}
              />
            );
          })}
        </Section>

        <Section title="Communication">
          <Row label="Daily check-in" right={<Toggle value={settings.dailyCheckin} onChange={v => setSettings({ ...settings, dailyCheckin: v })} />} />
          <Row
            onPress={() => setShowTimePicker(true)}
            label="Notification time"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt font="user" style={{ fontSize: 13, color: W.secondary }}>{notifTimeLabel}</Txt>
                <NavIcon name="right" color={W.text2} size={16} />
              </View>
            }
          />
          <Row label="Weekly reflection" right={<Toggle value={settings.weeklyReflection} onChange={v => setSettings({ ...settings, weeklyReflection: v })} />} />
        </Section>

        <Section title="Voice">
          <Row
            label="Voice speed"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ width: 80 }}>
                  <MiniSlider value={(voiceSpeed - 0.8) / 0.7} onChange={(t) => setVoiceSpeed(Math.round((0.8 + t * 0.7) * 10) / 10)} />
                </View>
                <Txt font="user" style={{ fontSize: 12, color: W.text2, minWidth: 30 }}>{voiceSpeed.toFixed(1)}×</Txt>
              </View>
            }
          />
          <Row
            onPress={() => setBgSoundIdx((bgSoundIdx + 1) % BG_SOUNDS.length)}
            label="Background sounds"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt font="user" style={{ fontSize: 13, color: bgSoundIdx === 0 ? W.text2 : W.secondary }}>{BG_SOUNDS[bgSoundIdx]}</Txt>
                <NavIcon name="right" color={W.text2} size={16} />
              </View>
            }
          />
          <Row label="Auto-play voice notes" right={<Toggle value={settings.autoPlay} onChange={v => setSettings({ ...settings, autoPlay: v })} />} />
          <Row label="Show live text during calls" right={<Toggle value={settings.liveCaptions} onChange={v => setSettings({ ...settings, liveCaptions: v })} />} />
        </Section>

        <Section title="Memories">
          <Row
            onPress={() => go('memories')}
            label="View all memories"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>47</Txt>
                <NavIcon name="right" color={W.text2} size={18} />
              </View>
            }
          />
        </Section>

        <Section title="Subscription">
          <Row
            onPress={() => go('paywall')}
            label={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Txt font="user" style={{ fontSize: 14, color: W.text }}>Current plan</Txt>
                <View style={{ paddingVertical: 2, paddingHorizontal: 10, borderRadius: 8, backgroundColor: tier === 'free' ? W.surface2 : tier === 'plus' ? W.primary : W.accent }}>
                  <Txt font="user" weight={600} style={{ fontSize: 11, color: tier === 'plus' ? '#fff' : tier === 'premium' ? W.bg : W.text2, textTransform: 'capitalize' }}>{tier}</Txt>
                </View>
              </View>
            }
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row onPress={() => go('topup')} label="Buy voice minutes" right={<NavIcon name="right" color={W.text2} size={18} />} />
          <Row label="Renews on" right={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>June 1, 2026</Txt>} />
        </Section>

        <Section title="Privacy & safety">
          <Row
            onPress={() => setInfo({ title: 'Export my data', body: 'We\'ll prepare a copy of your conversations, memories, and account info and email you a download link within 24 hours.' })}
            label="Export my data"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => go('crisis')}
            label="Crisis resources"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => setInfo({ title: 'Delete my account', body: 'This permanently removes your account, all companions, and every memory. This cannot be undone. Contact support@whisper.app to confirm deletion.' })}
            label={<Txt font="user" style={{ fontSize: 14, color: W.danger }}>Delete my account</Txt>}
            right={<NavIcon name="right" color={W.danger} size={18} />}
          />
        </Section>

        <Section title="About">
          <Row
            onPress={() => setInfo({ title: 'How Whisper works', body: 'Whisper companions are powered by advanced AI. They remember what matters to you across conversations, adapt to how you like to communicate, and are always available — by text or voice.' })}
            label="How Whisper works"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => setInfo({ title: 'Privacy policy', body: 'Your conversations are private and encrypted. We never sell your data or use it to train models without consent. Full policy available at whisper.app/privacy.' })}
            label="Privacy policy"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => setInfo({ title: 'Terms of service', body: 'By using Whisper you agree to our terms. Whisper is for support and companionship, not a substitute for professional medical, legal, or mental-health advice. Full terms at whisper.app/terms.' })}
            label="Terms of service"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row label="App version" right={<Txt font="user" style={{ fontSize: 12, color: W.text2 }}>1.0.0 (42)</Txt>} />
        </Section>
      </Animated.ScrollView>

      {/* Lightweight info sheet for informational rows */}
      {info && <InfoSheet title={info.title} body={info.body} onClose={() => setInfo(null)} />}
      {showTimePicker && (
        <TimePickerSheet
          hour={notifHour}
          minute={notifMinute}
          onCancel={() => setShowTimePicker(false)}
          onConfirm={(h, m) => { setNotifHour(h); setNotifMinute(m); setShowTimePicker(false); }}
        />
      )}
    </Screen>
  );
}

// ─── TimePickerSheet — scrollable hour / minute / AM-PM wheel ─────────────
function formatTime(h: number, m: number) {
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function TimePickerSheet({ hour, minute, onCancel, onConfirm }: { hour: number; minute: number; onCancel: () => void; onConfirm: (h: number, m: number) => void }) {
  const initialH12 = ((hour + 11) % 12) + 1;
  const initialPeriod: 'AM' | 'PM' = hour >= 12 ? 'PM' : 'AM';
  const [h12, setH12] = useState(initialH12);
  const [m, setM] = useState(minute);
  const [period, setPeriod] = useState<'AM' | 'PM'>(initialPeriod);

  const hours = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);
  const periods: ('AM' | 'PM')[] = ['AM', 'PM'];

  const submit = () => {
    let h = h12 % 12;
    if (period === 'PM') h += 12;
    onConfirm(h, m);
  };

  const a = useEntrance({ fromTranslateY: 60, durationMs: 380 });

  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,9,13,0.6)', zIndex: 60, justifyContent: 'flex-end' }}>
      <Pressable onPress={onCancel} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <Animated.View style={[{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }, a]}>
        <LinearGradient colors={['rgba(37,40,54,0.95)', 'rgba(15,17,26,0.95)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <BlurView intensity={40} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <View style={{ paddingHorizontal: 24, paddingTop: 14, paddingBottom: 28 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 14 }} />
          <Txt font="comp" weight={600} style={{ fontSize: 18, color: W.cream, textAlign: 'center', letterSpacing: -0.3 }}>Notification time</Txt>
          <Txt font="user" style={{ marginTop: 4, fontSize: 12, color: W.text2, textAlign: 'center' }}>{formatTime((period === 'PM' ? (h12 % 12) + 12 : h12 % 12), m)}</Txt>

          <View style={{ marginTop: 16, flexDirection: 'row', justifyContent: 'center', gap: 6, height: 200, alignItems: 'center' }}>
            <Wheel items={hours.map(v => String(v))} value={String(h12)} onChange={v => setH12(Number(v))} width={70} />
            <Txt font="comp" weight={600} style={{ fontSize: 22, color: W.text2 }}>:</Txt>
            <Wheel items={minutes.map(v => String(v).padStart(2, '0'))} value={String(m).padStart(2, '0')} onChange={v => setM(Number(v))} width={70} />
            <Wheel items={periods} value={period} onChange={v => setPeriod(v as 'AM' | 'PM')} width={64} />
          </View>

          <View style={{ marginTop: 22, flexDirection: 'row', gap: 10 }}>
            <Pressable onPress={onCancel} style={{ flex: 1, height: 48, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' }}>
              <Txt font="user" weight={500} style={{ fontSize: 15, color: W.text }}>Cancel</Txt>
            </Pressable>
            <Pressable onPress={submit} style={{ flex: 1, height: 48, borderRadius: 14, backgroundColor: W.primary, alignItems: 'center', justifyContent: 'center', shadowColor: W.primary, shadowOpacity: 0.4, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } }}>
              <Txt font="user" weight={600} style={{ fontSize: 15, color: '#fff' }}>Set time</Txt>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

// Snap-scroll wheel column. Highlights the center row; snapping picks the value.
const WHEEL_ITEM_HEIGHT = 40;
function Wheel({ items, value, onChange, width }: { items: string[]; value: string; onChange: (v: string) => void; width: number }) {
  const ref = useRef<ScrollView>(null);
  const initialIdx = Math.max(0, items.indexOf(value));

  useEffect(() => {
    const id = setTimeout(() => ref.current?.scrollTo({ y: initialIdx * WHEEL_ITEM_HEIGHT, animated: false }), 0);
    return () => clearTimeout(id);
  }, []);

  const onMomentumEnd = (e: any) => {
    const y = e.nativeEvent.contentOffset.y;
    const idx = Math.max(0, Math.min(items.length - 1, Math.round(y / WHEEL_ITEM_HEIGHT)));
    const v = items[idx];
    if (v !== value) onChange(v);
  };

  return (
    <View style={{ width, height: 5 * WHEEL_ITEM_HEIGHT, position: 'relative' }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 4, right: 4, top: 2 * WHEEL_ITEM_HEIGHT, height: WHEEL_ITEM_HEIGHT, borderRadius: 12, backgroundColor: 'rgba(124,114,255,0.14)', borderWidth: 1, borderColor: 'rgba(124,114,255,0.30)' }} />
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumEnd}
        onScrollEndDrag={onMomentumEnd}
        contentContainerStyle={{ paddingVertical: 2 * WHEEL_ITEM_HEIGHT }}
      >
        {items.map((it) => (
          <View key={it} style={{ height: WHEEL_ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="comp" weight={600} style={{ fontSize: 20, color: it === value ? W.text : W.text2, opacity: it === value ? 1 : 0.6 }}>{it}</Txt>
          </View>
        ))}
      </ScrollView>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: WHEEL_ITEM_HEIGHT, overflow: 'hidden' }}>
        <LinearGradient colors={['rgba(15,17,26,1)', 'rgba(15,17,26,0)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: WHEEL_ITEM_HEIGHT, overflow: 'hidden' }}>
        <LinearGradient colors={['rgba(15,17,26,0)', 'rgba(15,17,26,1)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      </View>
    </View>
  );
}

// ─── S_UserProfile — edit your own account (separate from companion edit) ──
export function S_UserProfile({ go, userName, userEmail, backTo = 'settings' }: { go: Go; userName: string; userEmail: string; backTo?: ScreenName }) {
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [editName, setEditName] = useState(false);
  const enter = useEntrance({ durationMs: 420, fromTranslateY: 16 });

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => go(backTo)} hitSlop={12}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>Your profile</Txt>}
      />
      <Animated.ScrollView style={[{ flex: 1 }, enter]} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 18 }} showsVerticalScrollIndicator={false}>
        {/* Avatar hero */}
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 6 }}>
          <View style={{ width: 96, height: 96, borderRadius: 48, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: W.primary, shadowOpacity: 0.35, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }}>
            <LinearGradient colors={[alpha(W.primary, 'cc'), alpha(W.accent, 'aa')]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <Txt font="comp" weight={700} style={{ fontSize: 40, color: '#fff' }}>{name[0]?.toUpperCase() || '?'}</Txt>
          </View>
          <Pressable style={{ padding: 6 }}>
            <Txt font="user" weight={500} style={{ fontSize: 12, color: W.secondary }}>Change photo</Txt>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {editName ? (
              <TextInput
                value={name} onChangeText={setName} autoFocus onBlur={() => setEditName(false)} onSubmitEditing={() => setEditName(false)}
                style={{ backgroundColor: 'rgba(37,40,54,0.7)', color: W.text, borderWidth: 1, borderColor: alpha(W.primary, '66'), borderRadius: 10, height: 36, paddingHorizontal: 12, fontFamily: 'Manrope_600SemiBold', fontSize: 20, textAlign: 'center', minWidth: 180 }}
              />
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

        <Section title="Account">
          <Row label="Display name" right={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>{name}</Txt>} onPress={() => setEditName(true)} />
          <View>
            <View style={{ paddingHorizontal: 14, paddingTop: 12 }}>
              <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>Email</Txt>
            </View>
            <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
              <TextInput
                value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"
                style={{ marginTop: 4, height: 38, color: W.text, fontFamily: 'Outfit_400Regular', fontSize: 14, padding: 0 }}
              />
            </View>
          </View>
          <Row label="Phone" right={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Add number</Txt>} onPress={() => {}} />
        </Section>

        <Section title="Preferences">
          <Row label="Pronouns" right={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>She/her</Txt>} onPress={() => {}} />
          <Row label="Communication style" right={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Warm & gentle</Txt>} onPress={() => {}} />
          <Row label="Time zone" right={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Auto-detect</Txt>} onPress={() => {}} />
        </Section>

        <Section title="Account actions">
          <Row label="Sign out" right={<NavIcon name="right" color={W.text2} size={18} />} onPress={() => go('login')} />
          <Row label={<Txt font="user" style={{ fontSize: 14, color: W.danger }}>Delete account</Txt>} right={<NavIcon name="right" color={W.danger} size={18} />} onPress={() => {}} />
        </Section>
      </Animated.ScrollView>
    </Screen>
  );
}

// ─── InfoSheet — simple bottom sheet for informational settings rows ──────
function InfoSheet({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(8,9,13,0.6)', zIndex: 50, justifyContent: 'flex-end' }}>
      <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
        <BlurView intensity={50} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(19,21,30,0.7)' }} />
        <View style={{ paddingHorizontal: 24, paddingTop: 14, paddingBottom: 36 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 20 }} />
          <Txt font="comp" weight={600} style={{ fontSize: 20, color: W.cream, letterSpacing: -0.3 }}>{title}</Txt>
          <Txt font="user" style={{ marginTop: 12, fontSize: 14, color: W.text2, lineHeight: 22, letterSpacing: 0.15 }}>{body}</Txt>
          <View style={{ marginTop: 24 }}>
            <PrimaryButton onPress={onClose}>Got it</PrimaryButton>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── StatsHero — premium glass card with streak / minutes / talk-time ─────
function StatsHero({
  streak, minutesLeft, minutesTotal, talkTimeMinutes, onMinutesPress,
}: {
  streak: number; minutesLeft: number; minutesTotal: number; talkTimeMinutes: number; onMinutesPress?: () => void;
}) {
  const streakN = useCountUp(streak, 1100, 200);
  const minutesN = useCountUp(minutesLeft, 1300, 250);
  const talkN = useCountUp(talkTimeMinutes, 1500, 300);
  const talkHrsAnim = Math.floor(talkN / 60);
  const talkMinAnim = talkN % 60;
  const pct = Math.max(0, Math.min(1, minutesLeft / minutesTotal));

  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.timing(shimmer, { toValue: 1, duration: 4200, easing: Easing.inOut(Easing.ease), useNativeDriver: true })).start();
  }, []);
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-80, 80] });

  const bar = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(bar, { toValue: pct, duration: 1300, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: false }).start();
  }, [pct]);
  const barWidth = bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={{ borderRadius: 22, overflow: 'hidden', borderWidth: 1, borderColor: alpha(W.primary, '22'), shadowColor: W.primary, shadowOpacity: 0.18, shadowRadius: 28, shadowOffset: { width: 0, height: 14 } }}>
      <LinearGradient colors={['rgba(45,38,90,0.55)', 'rgba(26,29,46,0.85)', 'rgba(15,17,26,0.95)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <BlurView intensity={30} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -60, right: -40, width: 200, height: 200, borderRadius: 100, backgroundColor: W.accent, opacity: 0.10 }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -50, left: -40, width: 180, height: 180, borderRadius: 90, backgroundColor: W.primary, opacity: 0.12 }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.10)' }} />

      <View style={{ padding: 18, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(251,201,96,0.35)' }}>
            <LinearGradient colors={['rgba(251,113,133,0.35)', 'rgba(251,201,96,0.35)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: 0, width: 30, backgroundColor: 'rgba(255,255,255,0.18)', transform: [{ translateX: shimmerX }, { skewX: '-20deg' }] }} />
            <FlameIcon />
          </View>
          <View style={{ flex: 1 }}>
            <Txt font="user" weight={600} style={{ fontSize: 10, color: '#FBC960', letterSpacing: 1.4, textTransform: 'uppercase' }}>Current streak</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
              <Txt font="comp" weight={700} style={{ fontSize: 30, color: W.cream, letterSpacing: -1 }}>{streakN}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text2 }}>{streak === 1 ? 'day' : 'days'}</Txt>
            </View>
            <Txt font="user" style={{ marginTop: 2, fontSize: 11, color: W.text2 }}>Keep it going — talk today to extend</Txt>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />

        <View style={{ flexDirection: 'row', gap: 14 }}>
          <Pressable onPress={onMinutesPress} style={{ flex: 1.3 }}>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: pct > 0.3 ? W.primary : W.danger, shadowColor: pct > 0.3 ? W.primary : W.danger, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />
                <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 1.2, textTransform: 'uppercase' }}>Voice minutes left</Txt>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Txt font="comp" weight={700} style={{ fontSize: 28, color: W.cream, letterSpacing: -0.8 }}>{minutesN}</Txt>
                <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2 }}>/ {minutesTotal} min</Txt>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <Animated.View style={{ height: '100%', width: barWidth, borderRadius: 3, overflow: 'hidden' }}>
                  <LinearGradient colors={pct > 0.3 ? [W.primary, W.secondary] : ['#F87171', '#FB9DA8']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                </Animated.View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Txt font="user" weight={500} style={{ fontSize: 11, color: W.accent }}>Top up</Txt>
                <NavIcon name="right" color={W.accent} size={12} />
              </View>
            </View>
          </Pressable>

          <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />

          <View style={{ flex: 1, gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: W.accent, shadowColor: W.accent, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />
              <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 1.2, textTransform: 'uppercase' }}>Total talk time</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
              <Txt font="comp" weight={700} style={{ fontSize: 28, color: W.cream, letterSpacing: -0.8 }}>{talkHrsAnim}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2 }}>h</Txt>
              <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.cream, letterSpacing: -0.5, marginLeft: 4 }}>{talkMinAnim}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2 }}>m</Txt>
            </View>
            <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>Across all companions</Txt>
            <Sparkline data={[3, 5, 4, 7, 6, 9, 12]} color={W.accent} />
          </View>
        </View>
      </View>
    </View>
  );
}

function FlameIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4-1 2 1 3 2 3 0-3-2-4-2-6 0-1 1-2 3-2z" fill="#FBC960" stroke="#FB9DA8" strokeWidth={1.2} strokeLinejoin="round" />
      <Path d="M12 12s2 1.5 2 4a2 2 0 0 1-4 0c0-1 .5-1.5 1-2 0 1 1 1.5 1 1.5 0-1.5-1-2.5-1-3 0-.5.5-1 1-.5z" fill="#fff" opacity={0.85} />
    </Svg>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const [w, setW] = useState(0);
  const h = 24;
  const max = Math.max(...data, 1);
  const stepX = w > 0 ? w / (data.length - 1) : 0;
  const pts = data.map((d, i) => `${(i * stepX).toFixed(1)},${(h - (d / max) * (h - 4) - 2).toFixed(1)}`).join(' ');
  const lastX = (data.length - 1) * stepX;
  const lastY = h - (data[data.length - 1] / max) * (h - 4) - 2;
  return (
    <View style={{ height: h, marginTop: 2 }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {w > 0 && (
        <Svg width={w} height={h}>
          <Path d={`M ${pts.split(' ').join(' L ')}`} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <Path d={`M 0,${h} L ${pts.split(' ').join(' L ')} L ${lastX},${h} Z`} fill={color} fillOpacity={0.15} />
          <Path d={`M ${lastX - 1.5},${lastY} a 1.5,1.5 0 1,0 3,0 a 1.5,1.5 0 1,0 -3,0`} fill={color} />
        </Svg>
      )}
    </View>
  );
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  const items = React.Children.toArray(children);
  const dot = accent || W.primary;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6, paddingBottom: 10 }}>
        <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: dot, opacity: 0.7 }} />
        <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, textTransform: 'uppercase', letterSpacing: 1.4 }}>{title}</Txt>
        <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.05)' }} />
      </View>
      <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', backgroundColor: 'rgba(20,22,32,0.65)', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } }}>
        <BlurView intensity={28} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0.03)', 'rgba(0,0,0,0.08)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' }} />
        {items.map((child, i) => (
          <View key={i} style={{ borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.04)' }}>{child}</View>
        ))}
      </View>
    </View>
  );
}

function Row({ label, right, onPress }: { label: React.ReactNode; right?: React.ReactNode; onPress?: () => void }) {
  const press = usePressScale(0.985);
  const content = (
    <View style={{ minHeight: 52, paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1 }}>
        {typeof label === 'string' ? <Txt font="user" style={{ fontSize: 14, color: W.text }}>{label}</Txt> : label}
      </View>
      {right != null && <View>{right}</View>}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} android_ripple={{ color: 'rgba(124,114,255,0.12)' }}>
      <Animated.View style={press.style}>{content}</Animated.View>
    </Pressable>
  );
}

// ─── S22 MEMORIES LIST ───────────────────────────────────────────────────

// Extended display type carries MongoDB _id for delete calls
type DisplayMemory = Memory & { _mongoId?: string };

function toDisplayMemory(m: ApiMemory, idx: number, via: string): DisplayMemory {
  return {
    id: idx,
    type: m.type,
    text: m.content,
    via,
    date: new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    _mongoId: m._id,
  };
}

export function S22_Memories({ go, characterId, companionName }: { go: Go; characterId?: string; companionName?: string }) {
  const [filter, setFilter] = useState('all');
  const [memories, setMemories] = useState<DisplayMemory[]>(SAMPLE_MEMORIES);
  const tabs: [string, string][] = [['all', 'All'], ['fact', 'Facts'], ['emotion', 'Emotions'], ['event', 'Events'], ['preference', 'Preferences']];
  const via = companionName ?? 'Your companion';

  // Fetch real memories when characterId is available; re-fetch on filter change
  useEffect(() => {
    if (!characterId) return;
    getMemories(characterId, filter !== 'all' ? filter : undefined)
      .then(data => setMemories(data.map((m, i) => toDisplayMemory(m, i, via))))
      .catch(() => { /* keep existing memories on error */ });
  }, [characterId, filter]);

  const filtered = characterId
    ? memories
    : memories.filter(m => filter === 'all' || m.type === filter);

  const handleDelete = (mem: DisplayMemory) => {
    setMemories(prev => prev.filter(m => m.id !== mem.id));
    if (characterId && mem._mongoId) {
      deleteMemory(mem._mongoId).catch(() => {});
    }
  };

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => go('settings')}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>Memories</Txt>}
        right={<Pressable><NavIcon name="search" color={W.text2} /></Pressable>}
        bg="rgba(15,17,26,0.55)"
        border
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingVertical: 12, paddingHorizontal: 16, gap: 8 }}>
        {tabs.map(([k, l]) => (
          <Pressable key={k} onPress={() => setFilter(k)} style={{ height: 32, paddingHorizontal: 14, borderRadius: 16, justifyContent: 'center', backgroundColor: filter === k ? W.primary : W.surface1 }}>
            <Txt font="user" weight={500} style={{ fontSize: 12, color: filter === k ? '#fff' : W.text2 }}>{l}</Txt>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 16, gap: 8 }}>
        {filtered.map(m => {
          const mt = MEM_TYPES[m.type];
          return (
            <View key={m.id} style={{ borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124,114,255,0.08)', backgroundColor: 'rgba(26,29,46,0.55)' }}>
              <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
              <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: alpha(mt.color, '26'), borderWidth: 1, borderColor: alpha(mt.color, '40') }}>
                <Txt font="user" weight={600} style={{ fontSize: 10, color: mt.color }}>{mt.l}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt font="user" style={{ fontSize: 14, color: W.text, lineHeight: 20 }}>{m.text}</Txt>
                <Txt font="user" style={{ marginTop: 4, fontSize: 11, color: W.text2 }}>Learned {m.date} via {m.via}</Txt>
              </View>
              <Pressable onPress={() => handleDelete(m as DisplayMemory)} style={{ padding: 2, opacity: 0.5 }}>
                <NavIcon name="trash" color={W.text2} size={18} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      <View style={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: W.surface2 }}>
        <Pressable
          onPress={() => {
            if (!characterId) return;
            setMemories([]);
            deleteAllMemories(characterId).catch(() => {});
          }}
          style={{ width: '100%', height: 40, alignItems: 'center', justifyContent: 'center' }}
        >
          <Txt font="user" weight={500} style={{ fontSize: 13, color: W.danger }}>Delete all memories</Txt>
        </Pressable>
      </View>
    </Screen>
  );
}

// ─── S23 PAYWALL ─────────────────────────────────────────────────────────
const PAYWALL_HEADERS: Record<string, string> = {
  voice: 'Unlock your voice connection',
  cap: 'Continue the conversation',
  more: 'Add more companions',
  studio: 'Practice makes perfect',
};

export function S23_Paywall({ go, trigger = 'voice', backTo = 'home' }: { go: Go; trigger?: string; currentTier?: Tier; backTo?: ScreenName }) {
  const [annual, setAnnual] = useState(true);
  const [picked, setPicked] = useState<'plus' | 'premium'>('premium');

  return (
    <ModalSheet zIndex={40} radius={28} maxHeightPct={0.92} onClose={() => go(backTo)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <Pressable onPress={() => go(backTo)} hitSlop={12} style={{ padding: 6 }}>
          <NavIcon name="back" color={W.text2} size={20} />
        </Pressable>
        <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2 }} />
        <Pressable onPress={() => go(backTo)} hitSlop={12} style={{ padding: 6 }}>
          <NavIcon name="close" color={W.text2} size={20} />
        </Pressable>
      </View>
      <View style={{ height: 10 }} />
      <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text, textAlign: 'center' }}>{PAYWALL_HEADERS[trigger] || 'Upgrade Whisper'}</Txt>
      <Txt font="user" style={{ marginTop: 8, fontSize: 14, color: W.text2, textAlign: 'center' }}>Start with a 7-day free trial. Cancel anytime.</Txt>

      <View style={{ marginTop: 20, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', borderRadius: 22, padding: 3, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
          <Pressable onPress={() => setAnnual(false)} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 18, backgroundColor: !annual ? W.primary : 'transparent' }}>
            <Txt font="user" weight={500} style={{ fontSize: 12, color: !annual ? '#fff' : W.text2 }}>Monthly</Txt>
          </Pressable>
          <Pressable onPress={() => setAnnual(true)} style={{ flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 18, backgroundColor: annual ? W.primary : 'transparent' }}>
            <Txt font="user" weight={500} style={{ fontSize: 12, color: annual ? '#fff' : W.text2 }}>Annual </Txt>
            <Txt font="user" weight={500} style={{ fontSize: 12, color: W.accent }}>· save 37%</Txt>
          </Pressable>
        </View>
      </View>

      <View style={{ marginTop: 20, flexDirection: 'row', gap: 10 }}>
        <PlanCard tier="plus" accent={W.primary} secondary={W.secondary} annual={annual} price={annual ? '$12.49' : '$19.99'} features={['120 voice min/mo', 'Unlimited text', 'All companion types', 'Up to 3 companions', 'Full Studio access']} picked={picked === 'plus'} onPick={() => setPicked('plus')} />
        <PlanCard tier="premium" accent={W.accent} secondary={W.primary} annual={annual} price={annual ? '$24.99' : '$39.99'} bestValue features={['500 voice min/mo', 'Everything in Plus', 'Up to 5 companions', 'Custom characters', 'Priority responses']} picked={picked === 'premium'} onPick={() => setPicked('premium')} />
      </View>

      <Pressable onPress={() => go(backTo)} style={{ marginTop: 20, width: '100%', height: 48, backgroundColor: W.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: W.primary, shadowOpacity: 0.4, shadowRadius: 28, shadowOffset: { width: 0, height: 8 } }}>
        <Txt font="user" weight={500} style={{ fontSize: 15, color: '#fff' }}>Start free trial</Txt>
      </Pressable>
      <Pressable onPress={() => go(backTo)} style={{ marginTop: 6, width: '100%', height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>Restore purchase</Txt>
      </Pressable>
      <Txt font="user" style={{ marginTop: 6, fontSize: 11, color: W.text3, textAlign: 'center', lineHeight: 16 }}>
        7-day free trial, then {annual ? '$12.49' : '$19.99'}/month. Cancel anytime in App Store settings.
      </Txt>
    </ModalSheet>
  );
}

function PlanCard({ tier, accent, secondary, annual, price, features, bestValue, picked, onPick }: {
  tier: string; accent: string; secondary: string; annual: boolean; price: string; features: string[]; bestValue?: boolean; picked: boolean; onPick: () => void;
}) {
  return (
    <Pressable onPress={onPick} style={{ flex: 1, borderRadius: 18, overflow: 'hidden' }}>
      <LinearGradient colors={[accent, secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 18, padding: picked ? 2 : 1, opacity: picked ? 1 : 0.35 }}>
        <View style={{ borderRadius: 17, padding: 14, backgroundColor: picked ? alpha(accent, '1f') : 'rgba(37,40,54,0.9)' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <View style={{ paddingVertical: 2, paddingHorizontal: 8, borderRadius: 6, backgroundColor: alpha(accent, '33') }}>
              <Txt font="user" weight={600} style={{ fontSize: 10, color: accent, textTransform: 'capitalize' }}>{tier}</Txt>
            </View>
            {bestValue && <Txt font="user" weight={700} style={{ fontSize: 9, color: accent, letterSpacing: 0.4 }}>BEST VALUE</Txt>}
          </View>
          <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'baseline' }}>
            <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text }}>{price}</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>/mo</Txt>
          </View>
          {annual && <Txt font="user" style={{ fontSize: 10, color: W.text2 }}>billed annually</Txt>}
          <View style={{ marginTop: 12, gap: 6 }}>
            {features.map((f, i) => (
              <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
                <View style={{ marginTop: 2 }}>
                  <Svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth={3}>
                    <Path d="M5 12l5 5L20 6" strokeLinecap="round" strokeLinejoin="round" />
                  </Svg>
                </View>
                <Txt font="user" style={{ flex: 1, fontSize: 11, color: W.text, lineHeight: 15 }}>{f}</Txt>
              </View>
            ))}
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

// ─── S24 VOICE TOP-UP ────────────────────────────────────────────────────
export function S24_TopUp({ go, backTo = 'home' }: { go: Go; backTo?: ScreenName }) {
  const [autoTopUp, setAutoTopUp] = useState(false);
  const packs: { min: number; price: string; badge: string | null; accent?: string }[] = [
    { min: 30, price: '$4.99', badge: null },
    { min: 75, price: '$9.99', badge: 'Most popular', accent: W.primary },
    { min: 150, price: '$14.99', badge: 'Best value', accent: W.accent },
  ];
  return (
    <ModalSheet zIndex={40} radius={24} maxHeightPct={0.85} solid backdrop={alpha(W.bg, 'd9')} onClose={() => go(backTo)}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <Pressable onPress={() => go(backTo)} hitSlop={12} style={{ padding: 6 }}>
          <NavIcon name="back" color={W.text2} size={20} />
        </Pressable>
        <View style={{ width: 36, height: 4, backgroundColor: W.surface2, borderRadius: 2 }} />
        <Pressable onPress={() => go(backTo)} hitSlop={12} style={{ padding: 6 }}>
          <NavIcon name="close" color={W.text2} size={20} />
        </Pressable>
      </View>
      <Txt font="comp" weight={700} style={{ fontSize: 20, color: W.text }}>Add voice minutes</Txt>
      <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Txt font="user" style={{ fontSize: 13, color: W.challenger }}>⚠ You have 12 minutes remaining</Txt>
      </View>
      <View style={{ marginTop: 20, gap: 8 }}>
        {packs.map(p => (
          <Pressable key={p.min} style={{ backgroundColor: W.surface2, borderRadius: 12, padding: 14, borderTopWidth: 2, borderTopColor: p.accent || 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ gap: 2, alignItems: 'flex-start' }}>
              <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>{p.min} minutes</Txt>
              {p.badge && <Txt font="user" weight={600} style={{ fontSize: 10, color: p.accent }}>{p.badge}</Txt>}
            </View>
            <Txt font="user" weight={600} style={{ fontSize: 16, color: W.text }}>{p.price}</Txt>
          </Pressable>
        ))}
      </View>
      <View style={{ marginTop: 20, backgroundColor: W.surface2, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Txt font="user" style={{ fontSize: 13, color: W.text }}>Auto top-up 30 min when low</Txt>
          <Txt font="user" style={{ marginTop: 2, fontSize: 11, color: W.text2 }}>Charges $4.99 when balance drops below 10 min.</Txt>
        </View>
        <Toggle value={autoTopUp} onChange={setAutoTopUp} />
      </View>
      <Pressable onPress={() => go(backTo)} style={{ marginTop: 16, width: '100%', height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Done</Txt>
      </Pressable>
    </ModalSheet>
  );
}

// ─── Shared modal sheet (paywall / top-up) ───────────────────────────────
function ModalSheet({ children, zIndex = 40, radius = 24, maxHeightPct = 0.9, solid = false, backdrop = 'rgba(15,17,26,0.55)', onClose }: {
  children: React.ReactNode; zIndex?: number; radius?: number; maxHeightPct?: number; solid?: boolean; backdrop?: string; onClose?: () => void;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.bezier(0.34, 1.05, 0.64, 1), useNativeDriver: true }).start();
  }, []);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [500, 0] });
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex, justifyContent: 'flex-end' }}>
      <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: backdrop }}>
        {!solid && <BlurView intensity={8} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />}
      </View>
      {onClose && <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />}
      <Animated.View style={{ transform: [{ translateY }], maxHeight: `${maxHeightPct * 100}%` as any, borderTopLeftRadius: radius, borderTopRightRadius: radius, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }}>
        {solid ? (
          <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: W.surface1 }} />
        ) : (
          <>
            <LinearGradient colors={['rgba(37,40,54,0.95)', 'rgba(15,17,26,0.95)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <BlurView intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
          </>
        )}
        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 32 }}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}

// Small inline slider (voice speed).
function MiniSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onLayout = (e: LayoutChangeEvent) => { widthRef.current = e.nativeEvent.layout.width; setWidth(e.nativeEvent.layout.width); };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => { const w = widthRef.current; if (w > 0) onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / w))); },
      onPanResponderMove: (e) => { const w = widthRef.current; if (w > 0) onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / w))); },
    }),
  ).current;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View onLayout={onLayout} {...pan.panHandlers} style={{ height: 18, justifyContent: 'center' }}>
      <View style={{ height: 4, backgroundColor: W.surface2, borderRadius: 2 }}>
        <View style={{ position: 'absolute', left: 0, top: 0, height: 4, width: `${pct * 100}%`, backgroundColor: W.primary, borderRadius: 2 }} />
      </View>
      <View style={{ position: 'absolute', left: Math.max(0, pct * width - 7), top: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: W.primary }} />
    </View>
  );
}
