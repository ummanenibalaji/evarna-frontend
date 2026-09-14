// Settings.tsx — S21 Settings, S22 Memories, S23 Paywall, S24 Voice Top-up.
// Ported from settings.jsx. Paywall/top-up are modal bottom sheets rendered
// over the home screen by the router (they navigate via `go`, not tap-to-close,
// matching the prototype).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking,
  View, ScrollView, Pressable, Animated, Easing,
  LayoutChangeEvent, PanResponder, TextInput, Share,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import Svg, { Path, Circle, Defs, LinearGradient as SvgLinearGradient, Stop } from 'react-native-svg';
import { Screen, TopBar } from '../components/Chrome';
import { NavIcon, IconName } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { Card, Toggle, PrimaryButton, MeterBar } from '../components/Atoms';
import { useEntrance, usePressScale, useCountUp } from '../theme/animations';
import { W, GRAD, alpha, rgba } from '../theme/theme';
// BILLING_LIVE is gone: the tier now comes from the entitlement, not a constant.
import { ARCHETYPE_COLORS, ARCHETYPE_LABEL, MEM_TYPES, Companion, Tier, Memory } from '../data/config';
import { Go, PaywallTrigger, ScreenName } from '../navigation/types';
import { getMemories, deleteMemory, deleteAllMemories, ApiMemory, getUserStats, ApiUserStats, getActivity, ApiActivity, exportMyData, ApiEntitlement } from '../api';
import { balanceLine, formatBalance, formatResetDate, minutesFrom, planFeatures, priceFor, resetLabel } from '../lib/entitlement';

const PRIVACY_URL = process.env.EXPO_PUBLIC_PRIVACY_URL || undefined;
const TERMS_URL = process.env.EXPO_PUBLIC_TERMS_URL || undefined;

export interface AppSettings {
  dailyCheckin: boolean;
  weeklyReflection: boolean;
  autoPlay: boolean;
  liveCaptions: boolean;
}

// ─── S21 SETTINGS ────────────────────────────────────────────────────────
interface SettingsProps {
  go: Go;
  /**
   * What the account is entitled to, or null while it is still loading. Null
   * and `entitlementFailed` are different states and must look different:
   * "we could not read your plan" must never render as "you are on Free".
   */
  entitlement?: ApiEntitlement | null;
  entitlementFailed?: boolean;
  onRetryEntitlement?: () => void;
  companions: Companion[];
  userName: string;
  userEmail: string;
  settings: AppSettings;
  setSettings: (s: AppSettings) => void;
  openCompanionProfile?: (c: Companion) => void;
  userId?: string;
  // Deletes the account server-side, then signs out. Owned by App.tsx.
  onDeleteAccount?: () => void | Promise<void>;
}

export function S21_Settings({ go, entitlement, entitlementFailed, onRetryEntitlement, companions, userName, userEmail, settings, setSettings, openCompanionProfile, userId, onDeleteAccount }: SettingsProps) {
  const tier: Tier = entitlement?.tier ?? 'free';
  // Three states, three renderings: known, still loading, and failed. Failure
  // must not borrow Free's appearance — being told you are on Free reads as a
  // downgrade, not as a network problem.
  const planLabel = entitlement ? entitlement.tier_label : entitlementFailed ? "Couldn't load" : '—';
  const tierBg = !entitlement || tier === 'free' ? W.surface2 : tier === 'plus' ? W.primary : W.accent;
  const tierFg = entitlement && tier === 'plus' ? '#fff' : entitlement && tier === 'premium' ? W.bg : W.text2;

  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [userStats, setUserStats] = useState<ApiUserStats | null>(null);
  const [activity, setActivity] = useState<ApiActivity | null>(null);

  useEffect(() => {
    if (!userId) return;
    getUserStats().then(setUserStats).catch(() => {});
    getActivity().then(setActivity).catch(() => {});
  }, [userId]);
  const [bgSoundIdx, setBgSoundIdx] = useState(0);
  // Notification time as an exact moment of day.
  const [notifHour, setNotifHour] = useState(21);   // 9 PM default
  const [notifMinute, setNotifMinute] = useState(0);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [info, setInfo] = useState<{ title: string; body: string; danger?: { label: string; onPress: () => void } } | null>(null);
  const [busy, setBusy] = useState(false);

  // ponytail: hands the whole export JSON to the OS share sheet. Fine for a
  // normal account; swap for a file write + share if exports get large.
  const exportData = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await exportMyData();
      await Share.share({ message: JSON.stringify(data, null, 2) });
    } catch {
      setInfo({ title: 'Export failed', body: "We couldn't prepare your data right now. Please try again." });
    } finally {
      setBusy(false);
    }
  };
  // The hosted documents, not a summary of them. The old in-app text promised
  // things ("encrypted", "never used to train models") that no one had checked,
  // at a domain we do not own, and both stores require a real policy URL.
  const openLegal = (title: string, url: string | undefined) => {
    if (url) { Linking.openURL(url).catch(() => setInfo({ title, body: `Open ${url} in your browser.` })); return; }
    setInfo({ title, body: 'This document has not been published yet.' });
  };
  const enter = useEntrance({ durationMs: 420, fromTranslateY: 14 });

  const BG_SOUNDS = ['Off', 'Rain', 'Ocean', 'Fireplace', 'White noise'];
  const notifTimeLabel = useMemo(() => formatTime(notifHour, notifMinute), [notifHour, notifMinute]);

  return (
    <Screen>
      <TopBar
        height={64}
        left={
          <View>
            <Txt font="display" weight={700} style={{ fontSize: 27, color: W.cream, letterSpacing: -0.5 }}>Settings</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2, letterSpacing: 0.4, marginTop: 1 }}>Personalize your experience</Txt>
          </View>
        }
      />
      <Animated.ScrollView style={[{ flex: 1 }, enter]} contentContainerStyle={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 32, gap: 18 }} showsVerticalScrollIndicator={false}>
        {/* User card — tap to edit your own profile (not a companion) */}
        <Card onPress={() => go('user-profile')} style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View style={{ width: 48, height: 48, borderRadius: 24, padding: 2, overflow: 'hidden' }}>
            <LinearGradient colors={[W.coral, W.rose, W.violet, W.coral]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            <View style={{ flex: 1, borderRadius: 22, backgroundColor: '#1C1216', alignItems: 'center', justifyContent: 'center' }}>
              <Txt font="user" weight={600} style={{ fontSize: 17, color: W.cream }}>{userName.trim()[0] ?? '·'}</Txt>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Txt font="user" weight={600} style={{ fontSize: 15, color: W.cream }}>{userName.trim() || 'Your profile'}</Txt>
              {/* Only for a plan that is actually in force. It used to be
                  suppressed entirely because `tier` was a constant. */}
              {entitlement && tier !== 'free' ? (
                <View style={{ borderRadius: 9, overflow: 'hidden', paddingVertical: 2, paddingHorizontal: 9 }}>
                  <LinearGradient colors={[...GRAD.auroraShort]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                  <Txt font="user" weight={700} style={{ fontSize: 9.5, color: '#fff', letterSpacing: 1 }}>{tier.toUpperCase()}</Txt>
                </View>
              ) : null}
            </View>
            {/* Only render an email when there actually is one. This used to
                display a fabricated address built from their name. */}
            {userEmail ? (
              <Txt font="user" style={{ fontSize: 12, color: W.text2 }} numberOfLines={1}>{userEmail}</Txt>
            ) : (
              <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>No email linked</Txt>
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Txt font="user" style={{ fontSize: 12, color: W.primarySoft }}>Edit</Txt>
            <NavIcon name="right" color={W.primarySoft} size={14} />
          </View>
        </Card>

        {/* Premium stats hero — streak, minutes left, total talk time */}
        {/* Every number here used to be a constant: a 12-day streak, a best of
            21, "87 / 120 min" of a voice allowance nobody had been sold, and
            342 minutes of talk time. The quota panel is gone until billing
            exists; the rest is the user's own history. */}
        <StatsHero
          streak={activity?.streak_days ?? 0}
          bestStreak={activity?.best_streak ?? 0}
          talkTimeMinutes={Math.round(userStats?.total_voice_minutes ?? 0)}
          weekMinutes={activity?.week_minutes ?? null}
          deltaMinutes={
            activity ? activity.week_total_minutes - activity.prev_week_total_minutes : null
          }
          voice={entitlement ? entitlement.voice : null}
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

        <Section title="Communication" accent={W.coral}>
          <Row icon="bell" iconColor={W.coral} label="Daily check-in" right={<Toggle value={settings.dailyCheckin} onChange={v => setSettings({ ...settings, dailyCheckin: v })} />} />
          <Row
            icon="clock" iconColor={W.gold}
            onPress={() => setShowTimePicker(true)}
            label="Notification time"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt font="user" style={{ fontSize: 13, color: W.secondary }}>{notifTimeLabel}</Txt>
                <NavIcon name="right" color={W.text3} size={14} />
              </View>
            }
          />
          <Row icon="sparkle" iconColor={W.secondary} label="Weekly reflection" right={<Toggle value={settings.weeklyReflection} onChange={v => setSettings({ ...settings, weeklyReflection: v })} />} />
        </Section>

        <Section title="Voice" accent={W.violet}>
          <Row
            icon="mic" iconColor={W.secondary}
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
            icon="speaker" iconColor={W.success}
            onPress={() => setBgSoundIdx((bgSoundIdx + 1) % BG_SOUNDS.length)}
            label="Background sounds"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Txt font="user" style={{ fontSize: 13, color: bgSoundIdx === 0 ? W.text2 : W.secondary }}>{BG_SOUNDS[bgSoundIdx]}</Txt>
                <NavIcon name="right" color={W.text3} size={14} />
              </View>
            }
          />
          <Row icon="play" iconColor={W.coral} label="Auto-play voice notes" right={<Toggle value={settings.autoPlay} onChange={v => setSettings({ ...settings, autoPlay: v })} />} />
          <Row icon="chat" iconColor={W.secondary} label="Show live text during calls" right={<Toggle value={settings.liveCaptions} onChange={v => setSettings({ ...settings, liveCaptions: v })} />} />
        </Section>

        <Section title="Memories" accent={W.gold}>
          <Row
            icon="sparkle-solid" iconColor={W.gold}
            onPress={() => go('memories')}
            label="View all memories"
            right={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {/* Hardcoded to 47 for every account, like the companion
                    profile was. Absent until the real count arrives. */}
                {userStats ? (
                  <Txt font="user" weight={600} style={{ fontSize: 12, color: W.gold }}>{userStats.total_memories}</Txt>
                ) : null}
                <NavIcon name="right" color={W.text3} size={14} />
              </View>
            }
          />
        </Section>

        <Section title="Subscription">
          <Row
            onPress={() => (entitlementFailed ? onRetryEntitlement?.() : go('paywall'))}
            label={
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Txt font="user" style={{ fontSize: 14, color: W.text }}>Current plan</Txt>
                <View style={{ paddingVertical: 2, paddingHorizontal: 10, borderRadius: 8, backgroundColor: tierBg }}>
                  {/* The real plan, or an honest placeholder. "Early access"
                      used to render for every account because there was no
                      entitlement to read. */}
                  <Txt font="user" weight={600} style={{ fontSize: 11, color: tierFg }}>{planLabel}</Txt>
                </View>
              </View>
            }
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row onPress={() => go('topup')} label="Buy voice minutes" right={<NavIcon name="right" color={W.text2} size={18} />} />
          {/* Hidden until it is known. A date is worse than no date if it is
              invented — this row read "June 1, 2026" for every account. */}
          {entitlement && formatResetDate(entitlement.period.renews_at) ? (
            <Row
              label={resetLabel(entitlement)}
              right={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>{formatResetDate(entitlement.period.renews_at)}</Txt>}
            />
          ) : null}
        </Section>

        <Section title="Privacy & safety">
          <Row
            onPress={exportData}
            label="Export my data"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => go('crisis')}
            label="Crisis resources"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => setInfo({
              title: 'Delete my account',
              body: 'This permanently removes your account, every companion, and every memory. It cannot be undone and we cannot recover any of it afterwards.',
              danger: { label: 'Delete permanently', onPress: () => { setInfo(null); onDeleteAccount && onDeleteAccount(); } },
            })}
            label={<Txt font="user" style={{ fontSize: 14, color: W.danger }}>Delete my account</Txt>}
            right={<NavIcon name="right" color={W.danger} size={18} />}
          />
        </Section>

        <Section title="About">
          <Row
            onPress={() => setInfo({ title: 'How Evarna works', body: 'Evarna companions are powered by advanced AI. They remember what matters to you across conversations, adapt to how you like to communicate, and are always available — by text or voice.' })}
            label="How Evarna works"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => openLegal('Privacy policy', PRIVACY_URL)}
            label="Privacy policy"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row
            onPress={() => openLegal('Terms of service', TERMS_URL)}
            label="Terms of service"
            right={<NavIcon name="right" color={W.text2} size={18} />}
          />
          <Row label="App version" right={<Txt font="user" style={{ fontSize: 12, color: W.text2 }}>1.0.0 (42)</Txt>} />
        </Section>
      </Animated.ScrollView>

      {/* Lightweight info sheet for informational rows */}
      {info && <InfoSheet title={info.title} body={info.body} danger={info.danger} onClose={() => setInfo(null)} />}
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
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,10,13,0.6)', zIndex: 60, justifyContent: 'flex-end' }}>
      <Pressable onPress={onCancel} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <Animated.View style={[{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }, a]}>
        <LinearGradient colors={['rgba(48,32,40,0.95)', 'rgba(24,16,20,0.95)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
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
      <View pointerEvents="none" style={{ position: 'absolute', left: 4, right: 4, top: 2 * WHEEL_ITEM_HEIGHT, height: WHEEL_ITEM_HEIGHT, borderRadius: 12, backgroundColor: 'rgba(255,138,118,0.14)', borderWidth: 1, borderColor: 'rgba(255,138,118,0.30)' }} />
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
        <LinearGradient colors={['rgba(24,16,20,1)', 'rgba(24,16,20,0)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: WHEEL_ITEM_HEIGHT, overflow: 'hidden' }}>
        <LinearGradient colors={['rgba(24,16,20,0)', 'rgba(24,16,20,1)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      </View>
    </View>
  );
}

// ─── S_UserProfile — edit your own account (separate from companion edit) ──
export function S_UserProfile({ go, userName, userEmail, onSave, onDeleteAccount, backTo = 'settings' }: { go: Go; userName: string; userEmail: string; onSave?: (p: { display_name?: string }) => void; onDeleteAccount?: () => void | Promise<void>; backTo?: ScreenName }) {
  const [name, setName] = useState(userName);
  const [email, setEmail] = useState(userEmail);
  const [editName, setEditName] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const enter = useEntrance({ durationMs: 420, fromTranslateY: 16 });

  // Same save-on-back pattern as the companion edit screen. Email isn't
  // editable server-side (it's the sign-in identity), so it isn't sent.
  const saveAndLeave = () => {
    if (onSave && name.trim() && name.trim() !== userName) onSave({ display_name: name.trim() });
    go(backTo);
  };

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={saveAndLeave} hitSlop={12}><NavIcon name="back" color={W.text2} /></Pressable>}
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
                style={{ backgroundColor: 'rgba(48,32,40,0.7)', color: W.text, borderWidth: 1, borderColor: alpha(W.primary, '66'), borderRadius: 10, height: 36, paddingHorizontal: 12, fontFamily: 'Manrope_600SemiBold', fontSize: 20, textAlign: 'center', minWidth: 180 }}
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
          <Row label={<Txt font="user" style={{ fontSize: 14, color: W.danger }}>Delete account</Txt>} right={<NavIcon name="right" color={W.danger} size={18} />} onPress={() => setConfirmDelete(true)} />
        </Section>
      </Animated.ScrollView>
      {confirmDelete && (
        <InfoSheet
          title="Delete my account"
          body="This permanently removes your account, every companion, and every memory. It cannot be undone and we cannot recover any of it afterwards."
          danger={{ label: 'Delete permanently', onPress: () => { setConfirmDelete(false); onDeleteAccount && onDeleteAccount(); } }}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </Screen>
  );
}

// ─── InfoSheet — simple bottom sheet for informational settings rows ──────
function InfoSheet({ title, body, onClose, danger }: { title: string; body: string; onClose: () => void; danger?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,10,13,0.6)', zIndex: 50, justifyContent: 'flex-end' }}>
      <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View style={{ borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
        <BlurView intensity={50} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(30,21,25,0.7)' }} />
        <View style={{ paddingHorizontal: 24, paddingTop: 14, paddingBottom: 36 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'center', marginBottom: 20 }} />
          <Txt font="comp" weight={600} style={{ fontSize: 20, color: W.cream, letterSpacing: -0.3 }}>{title}</Txt>
          <Txt font="user" style={{ marginTop: 12, fontSize: 14, color: W.text2, lineHeight: 22, letterSpacing: 0.15 }}>{body}</Txt>
          <View style={{ marginTop: 24, gap: 10 }}>
            {danger ? (
              <Pressable onPress={danger.onPress} style={{ height: 52, borderRadius: 14, borderWidth: 1, borderColor: alpha(W.danger, '66'), backgroundColor: alpha(W.danger, '1a'), alignItems: 'center', justifyContent: 'center' }}>
                <Txt font="user" weight={600} style={{ fontSize: 15, color: W.danger }}>{danger.label}</Txt>
              </Pressable>
            ) : null}
            <PrimaryButton onPress={onClose}>{danger ? 'Cancel' : 'Got it'}</PrimaryButton>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── StatsHero — the streak ring, voice minutes, and talk time ────────────
// The streak ring is the emotional anchor of this screen, so it gets the only
// conic-style arc in the app: an aurora sweep whose length *is* the progress
// toward the personal best.
function StatsHero({
  streak, bestStreak, talkTimeMinutes, weekMinutes, deltaMinutes, voice,
}: {
  streak: number; bestStreak: number; talkTimeMinutes: number;
  /** Seven real daily totals, or null while unknown. */
  weekMinutes: number[] | null;
  deltaMinutes: number | null;
  /** This period's voice balance, or null until the entitlement is known. */
  voice: { allowance_seconds: number; used_seconds: number; remaining_seconds: number } | null;
}) {
  const streakN = useCountUp(streak, 1100, 200);
  const talkN = useCountUp(talkTimeMinutes, 1500, 300);
  const talkHrsAnim = Math.floor(talkN / 60);
  const talkMinAnim = talkN % 60;

  return (
    <View style={{
      borderRadius: 22, overflow: 'hidden',
      borderWidth: 1, borderColor: rgba(W.primary, 0.20),
      shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 34, shadowOffset: { width: 0, height: 16 },
    }}>
      <LinearGradient
        colors={['rgba(72,38,44,0.55)', 'rgba(34,22,30,0.85)', 'rgba(20,13,17,0.95)']}
        locations={[0, 0.5, 1]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
      />
      <BlurView intensity={30} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -60, right: -40, width: 190, height: 190, borderRadius: 95, backgroundColor: W.gold, opacity: 0.10 }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: -50, left: -40, width: 170, height: 170, borderRadius: 85, backgroundColor: W.violet, opacity: 0.12 }} />
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.10)' }} />

      <View style={{ padding: 18, gap: 15 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <StreakRing progress={Math.min(1, streak / Math.max(bestStreak, 1))} />
          <View style={{ flex: 1 }}>
            <Txt font="user" weight={600} style={{ fontSize: 10, color: W.gold, letterSpacing: 1.6, textTransform: 'uppercase' }}>Current streak</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
              <Txt font="display" weight={700} style={{ fontSize: 31, color: W.cream, letterSpacing: -1 }}>{streakN}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text2 }}>{streak === 1 ? 'day' : 'days'}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 11, color: W.textMuted, marginLeft: 6 }}>best {bestStreak}</Txt>
            </View>
            <Txt font="user" style={{ marginTop: 2, fontSize: 11, color: W.text2 }}>Talk today to extend it</Txt>
          </View>
        </View>

        <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.06)' }} />

        {/* The "87 / 120 min" that sat here was fiction — there was no
            entitlement to read. This is the real balance for this period, and
            it stays absent rather than guessing while it is unknown. */}
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <View style={{ flex: 1, gap: 7 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: W.violet, shadowColor: W.violet, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />
              <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 1.2, textTransform: 'uppercase' }}>Talk time</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
              <Txt font="display" weight={700} style={{ fontSize: 26, color: W.cream, letterSpacing: -0.8 }}>{talkHrsAnim}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2 }}>h</Txt>
              <Txt font="display" weight={700} style={{ fontSize: 21, color: W.cream, marginLeft: 3 }}>{talkMinAnim}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2 }}>m</Txt>
            </View>
            {/* The sparkline was seven fixed numbers and the label read
                "+38m this week" for everyone. Both are the real week now, and
                neither renders before it is known. */}
            {weekMinutes ? <Sparkline data={weekMinutes} color={W.gold} /> : null}
            {deltaMinutes === null ? null : (
              <Txt font="user" weight={500} style={{ fontSize: 11, color: W.gold }}>
                {deltaMinutes >= 0 ? '+' : ''}{deltaMinutes}m this week
              </Txt>
            )}
          </View>

          {voice ? (
            <View style={{ flex: 1, gap: 7 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: W.primary, shadowColor: W.primary, shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />
                <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 1.2, textTransform: 'uppercase' }}>Voice left</Txt>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Txt font="display" weight={700} style={{ fontSize: 26, color: voice.remaining_seconds <= 0 ? W.challenger : W.cream, letterSpacing: -0.8 }}>{formatBalance(voice.remaining_seconds)}</Txt>
              </View>
              <MeterBar pct={voice.allowance_seconds > 0 ? voice.remaining_seconds / voice.allowance_seconds : 0} />
              <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>of {minutesFrom(voice.allowance_seconds)} min this month</Txt>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

// The streak arc: a 74px ring, drawn as a dashed stroke so its length tracks
// progress toward the personal best, with the flame sitting in the well.
function StreakRing({ progress }: { progress: number }) {
  const size = 74;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = Math.max(0.02, progress) * circumference;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <SvgLinearGradient id="streakArc" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={W.coral} />
            <Stop offset="0.55" stopColor={W.rose} />
            <Stop offset="1" stopColor={W.violet} />
          </SvgLinearGradient>
        </Defs>
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} fill="none"
        />
        <Circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="url(#streakArc)" strokeWidth={stroke} fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          // Start the sweep at 12 o'clock rather than 3 o'clock.
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={{ width: size - stroke * 2 - 4, height: size - stroke * 2 - 4, borderRadius: size, backgroundColor: '#160E12', alignItems: 'center', justifyContent: 'center' }}>
        <FlameIcon />
      </View>
    </View>
  );
}

function FlameIcon() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2s5 4 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4-1 2 1 3 2 3 0-3-2-4-2-6 0-1 1-2 3-2z" fill={W.gold} stroke={W.coral} strokeWidth={1.2} strokeLinejoin="round" />
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
      <View style={{ borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glassRaised, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 20, shadowOffset: { width: 0, height: 10 } }}>
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

function Row({ label, right, onPress, icon, iconColor }: {
  label: React.ReactNode; right?: React.ReactNode; onPress?: () => void;
  icon?: IconName; iconColor?: string;
}) {
  const press = usePressScale(0.985);
  const tint = iconColor || W.primary;
  const content = (
    <View style={{ minHeight: 52, paddingVertical: 11, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        {icon ? (
          <View style={{ width: 30, height: 30, borderRadius: 9, backgroundColor: rgba(tint, 0.13), alignItems: 'center', justifyContent: 'center' }}>
            <NavIcon name={icon} color={tint} size={15} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          {typeof label === 'string' ? <Txt font="user" style={{ fontSize: 14, color: W.text }}>{label}</Txt> : label}
        </View>
      </View>
      {right != null && <View>{right}</View>}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut} android_ripple={{ color: 'rgba(255,138,118,0.12)' }}>
      <Animated.View style={press.style}>{content}</Animated.View>
    </Pressable>
  );
}

// ─── S22 MEMORIES LIST ───────────────────────────────────────────────────

// Extended display type carries MongoDB _id for delete calls
type DisplayMemory = Memory & { _mongoId?: string; _recalled?: number };

function toDisplayMemory(m: ApiMemory, _idx: number, via: string): DisplayMemory {
  return {
    id: m._id,
    type: m.type,
    text: m.content,
    via,
    date: new Date(m.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    _mongoId: m._id,
    _recalled: m.access_count ?? 0,
  };
}

export function S22_Memories({ go, characterId, companionName }: { go: Go; characterId?: string; companionName?: string }) {
  const [filter, setFilter] = useState('all');
  // No seeded sample data. This screen used to open on seven invented
  // memories — including a bereavement — which a new user would read as things
  // their companion believed about them. An empty list is the honest state.
  const [memories, setMemories] = useState<DisplayMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const tabs: [string, string][] = [['all', 'All'], ['fact', 'Facts'], ['emotion', 'Emotions'], ['event', 'Events'], ['preference', 'Preferences']];
  const via = companionName ?? 'Your companion';

  useEffect(() => {
    if (!characterId) { setLoading(false); return; }
    setLoading(true);
    setLoadFailed(false);
    getMemories(characterId, filter !== 'all' ? filter : undefined)
      .then(data => { setMemories(data.map((m, i) => toDisplayMemory(m, i, via))); })
      // "We could not load these" and "there are none" are different facts and
      // must not look the same — silently showing an empty list on a network
      // error tells the user their companion has forgotten them.
      .catch(() => setLoadFailed(true))
      .finally(() => setLoading(false));
  }, [characterId, filter]);

  const filtered = memories;

  const handleDelete = (mem: DisplayMemory) => {
    if (!characterId || !mem._mongoId) return;
    const previous = memories;
    setMemories(prev => prev.filter(m => m.id !== mem.id));
    // Put it back if the delete did not land. Leaving it gone locally while it
    // still exists server-side means it reappears on the next visit, which
    // reads as the app ignoring the request.
    deleteMemory(mem._mongoId).catch(() => setMemories(previous));
  };

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => go('settings')}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>Memories</Txt>}
        bg="rgba(24,16,20,0.55)"
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
        {loading ? (
          <Txt font="user" style={{ marginTop: 32, fontSize: 13, color: W.text2, textAlign: 'center' }}>Loading…</Txt>
        ) : loadFailed ? (
          <View style={{ marginTop: 32, alignItems: 'center', gap: 6 }}>
            <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Couldn't load memories</Txt>
            <Txt font="user" style={{ fontSize: 13, color: W.text2, textAlign: 'center' }}>Check your connection and try again.</Txt>
          </View>
        ) : filtered.length === 0 ? (
          <View style={{ marginTop: 32, alignItems: 'center', gap: 6, paddingHorizontal: 24 }}>
            <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>
              {filter === 'all' ? 'Nothing remembered yet' : 'None of these yet'}
            </Txt>
            <Txt font="user" style={{ fontSize: 13, color: W.text2, textAlign: 'center', lineHeight: 19 }}>
              {filter === 'all'
                ? `${via} builds these from your conversations. Talk for a while and they'll appear here.`
                : 'Try another filter.'}
            </Txt>
          </View>
        ) : null}
        {filtered.map(m => {
          const mt = MEM_TYPES[m.type];
          return (
            <View key={m.id} style={{ borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,138,118,0.08)', backgroundColor: 'rgba(32,22,26,0.55)' }}>
              <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
              <View style={{ paddingVertical: 3, paddingHorizontal: 8, borderRadius: 8, backgroundColor: alpha(mt.color, '26'), borderWidth: 1, borderColor: alpha(mt.color, '40') }}>
                <Txt font="user" weight={600} style={{ fontSize: 10, color: mt.color }}>{mt.l}</Txt>
              </View>
              <View style={{ flex: 1 }}>
                <Txt font="user" style={{ fontSize: 14, color: W.text, lineHeight: 20 }}>{m.text}</Txt>
                <Txt font="user" style={{ marginTop: 4, fontSize: 11, color: W.text2 }}>
                  Learned {m.date} via {m.via}
                  {/* Retrieval is otherwise invisible: this is the difference
                      between claiming to remember and showing the receipts. */}
                  {(m as DisplayMemory)._recalled ? ` · brought up ${(m as DisplayMemory)._recalled} time${(m as DisplayMemory)._recalled === 1 ? '' : 's'}` : ''}
                </Txt>
              </View>
              <Pressable onPress={() => handleDelete(m as DisplayMemory)} style={{ padding: 2, opacity: 0.5 }}>
                <NavIcon name="trash" color={W.text2} size={18} />
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
      {memories.length > 0 && (
        <View style={{ paddingTop: 8, paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: 1, borderTopColor: W.surface2 }}>
          <Pressable
            onPress={() => setConfirmClearAll(true)}
            style={{ width: '100%', height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <Txt font="user" weight={500} style={{ fontSize: 13, color: W.danger }}>Delete all memories</Txt>
          </Pressable>
        </View>
      )}
      {confirmClearAll && (
        <InfoSheet
          title={`Forget everything ${via} knows?`}
          body={`This erases all ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} ${via} has built from your conversations. Your messages stay; what they learned from them does not. This cannot be undone.`}
          danger={{
            label: 'Delete all memories',
            onPress: () => {
              setConfirmClearAll(false);
              if (!characterId) return;
              const previous = memories;
              setMemories([]);
              deleteAllMemories(characterId).catch(() => setMemories(previous));
            },
          }}
          onClose={() => setConfirmClearAll(false)}
        />
      )}
    </Screen>
  );
}

// ─── S23 PAYWALL ─────────────────────────────────────────────────────────
/** One honest line wherever a purchase button sits. StoreKit is the next step;
 *  until it lands a tap cannot complete, so nothing pretends it can. */
const PURCHASES_NOT_LIVE = "Purchases aren't live yet — they arrive with the next update.";

const PAYWALL_HEADERS: Record<PaywallTrigger, string> = {
  voice: 'Unlock your voice connection',
  cap: 'Continue the conversation',
  more: 'Add more companions',
  studio: 'Practice makes perfect',
};

export function S23_Paywall({ go, trigger = 'voice', backTo = 'home', entitlement }: { go: Go; trigger?: PaywallTrigger; backTo?: ScreenName; entitlement?: ApiEntitlement | null }) {
  const [annual, setAnnual] = useState(true);
  const [picked, setPicked] = useState<'plus' | 'premium'>('premium');
  // The catalog is served, not shipped, so there is nothing to fall back to:
  // when it has not arrived the sheet says so rather than rendering a blank
  // price list, which would be a worse regression than the wrong prices it
  // replaced.
  const plans = entitlement?.plans ?? [];
  const pickedPlan = plans.find(p => p.tier === picked);

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
      <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text, textAlign: 'center' }}>{PAYWALL_HEADERS[trigger] ?? 'Upgrade Evarna'}</Txt>
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

      {/* Generated from the server's catalog, not typed here. Hand-written copy
          is how this card came to advertise "500 voice min/mo" for a tier that
          allows 400. */}
      {plans.length === 0 ? (
        <View style={{ marginTop: 24, alignItems: 'center', gap: 10 }}>
          <Txt font="user" style={{ fontSize: 13, color: W.text2, textAlign: 'center' }}>
            Couldn't load the plans just now.
          </Txt>
          <Pressable onPress={() => go(backTo)} style={{ paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, backgroundColor: W.surface2 }}>
            <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text }}>Close</Txt>
          </Pressable>
        </View>
      ) : (
      <View style={{ marginTop: 20, flexDirection: 'row', gap: 10 }}>
        {plans.map(p => (
          <PlanCard
            key={p.tier}
            tier={p.label}
            accent={p.tier === 'plus' ? W.primary : W.accent}
            secondary={p.tier === 'plus' ? W.secondary : W.primary}
            annual={annual}
            price={priceFor(p, annual)}
            features={planFeatures(p)}
            bestValue={p.tier === 'premium'}
            picked={picked === p.tier}
            onPick={() => setPicked(p.tier)}
          />
        ))}
      </View>
      )}

      {/* Disabled rather than dismissive. Both of these used to close the sheet
          and do nothing, which reads as a purchase that silently failed. There
          is no StoreKit yet, and saying so is better than pretending. */}
      {plans.length > 0 ? (
      <>
      <View style={{ marginTop: 20, width: '100%', height: 48, backgroundColor: W.primary, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: 0.45 }}>
        <Txt font="user" weight={500} style={{ fontSize: 15, color: '#fff' }}>Start free trial</Txt>
      </View>
      <View style={{ marginTop: 6, width: '100%', height: 36, alignItems: 'center', justifyContent: 'center', opacity: 0.45 }}>
        <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>Restore purchase</Txt>
      </View>
      <Txt font="user" style={{ marginTop: 8, fontSize: 11, color: W.accent, textAlign: 'center' }}>{PURCHASES_NOT_LIVE}</Txt>
      <Txt font="user" style={{ marginTop: 6, fontSize: 11, color: W.text3, textAlign: 'center', lineHeight: 16 }}>
        7-day free trial, then {pickedPlan ? priceFor(pickedPlan, annual) : '—'}/month. Cancel anytime in App Store settings.
      </Txt>
      </>
      ) : null}
    </ModalSheet>
  );
}

function PlanCard({ tier, accent, secondary, annual, price, features, bestValue, picked, onPick }: {
  tier: string; accent: string; secondary: string; annual: boolean; price: string; features: string[]; bestValue?: boolean; picked: boolean; onPick: () => void;
}) {
  return (
    <Pressable onPress={onPick} style={{ flex: 1, borderRadius: 18, overflow: 'hidden' }}>
      <LinearGradient colors={[accent, secondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: 18, padding: picked ? 2 : 1, opacity: picked ? 1 : 0.35 }}>
        <View style={{ borderRadius: 17, padding: 14, backgroundColor: picked ? alpha(accent, '1f') : 'rgba(48,32,40,0.9)' }}>
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
export function S24_TopUp({ go, backTo = 'home', entitlement }: { go: Go; backTo?: ScreenName; entitlement?: ApiEntitlement | null }) {
  const [autoTopUp, setAutoTopUp] = useState(false);
  // Packs come from the server so a price can only be wrong in one place. The
  // badges stay local: "Most popular" is a merchandising choice, not data.
  const BADGES: Record<number, { badge: string; accent: string }> = {
    75: { badge: 'Most popular', accent: W.primary },
    150: { badge: 'Best value', accent: W.accent },
  };
  const packs = (entitlement?.topup_packs ?? []).map(p => ({
    id: p.id,
    min: Math.round(p.seconds / 60),
    price: `$${p.price_usd.toFixed(2)}`,
    ...(BADGES[Math.round(p.seconds / 60)] ?? { badge: null as string | null, accent: undefined as string | undefined }),
  }));
  const balance = entitlement ? balanceLine(entitlement) : null;
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
      {/* The real balance. This line said "12 minutes remaining" to every
          account, including one with a full allowance and one with none. */}
      {balance ? (
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt font="user" style={{ fontSize: 13, color: balance.urgent ? W.challenger : W.text2 }}>{balance.text}</Txt>
        </View>
      ) : null}
      {packs.length === 0 ? (
        <Txt font="user" style={{ marginTop: 20, fontSize: 13, color: W.text2 }}>
          Couldn't load the minute packs just now.
        </Txt>
      ) : null}
      <View style={{ marginTop: 20, gap: 8 }}>
        {packs.map(p => (
          <View key={p.id} style={{ backgroundColor: W.surface2, borderRadius: 12, padding: 14, borderTopWidth: 2, borderTopColor: p.accent || 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: 0.45 }}>
            <View style={{ gap: 2, alignItems: 'flex-start' }}>
              <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>{p.min} minutes</Txt>
              {p.badge && <Txt font="user" weight={600} style={{ fontSize: 10, color: p.accent }}>{p.badge}</Txt>}
            </View>
            <Txt font="user" weight={600} style={{ fontSize: 16, color: W.text }}>{p.price}</Txt>
          </View>
        ))}
      </View>
      <Txt font="user" style={{ marginTop: 10, fontSize: 11, color: W.accent }}>{PURCHASES_NOT_LIVE}</Txt>
      {/* Dimmed with the packs: it promises a charge that nothing can make. */}
      <View style={{ marginTop: 20, backgroundColor: W.surface2, borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, opacity: 0.45 }}>
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
function ModalSheet({ children, zIndex = 40, radius = 24, maxHeightPct = 0.9, solid = false, backdrop = 'rgba(24,16,20,0.55)', onClose }: {
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
            <LinearGradient colors={['rgba(48,32,40,0.95)', 'rgba(24,16,20,0.95)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
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
