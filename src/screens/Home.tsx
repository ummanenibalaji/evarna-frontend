// Home.tsx — S10 Home (ritual + companions) + S11 Add Companion.
// "Ember Dusk": the header carries the streak, a nightly check-in card sits
// above the companion list, and a weekly momentum strip closes the screen.

import React, { useEffect, useState } from 'react';
import { View, Pressable, ScrollView, Animated, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Screen, TopBar } from '../components/Chrome';
import { Txt } from '../components/Txt';
import { NavIcon } from '../components/NavIcon';
import { Pill, PrimaryButton, AuroraLine, StreakPill } from '../components/Atoms';
import { Avatar, Waveform } from '../components/Avatar';
import { RadialGlow } from '../components/RadialGlow';
import { usePulse, usePressScale, useEntrance } from '../theme/animations';
import { W, GRAD, rgba } from '../theme/theme';
import { Go } from '../navigation/types';
import { Companion, ARCHETYPE_COLORS, ARCHETYPE_LABEL, CHECK_IN } from '../data/config';
import { getActivity, ApiActivity } from '../api';

// ─── AuroraAvatarButton ──────────────────────────────────────────────────
// The account button in the header: an aurora ring around the user's initial.
function AuroraAvatarButton({ initial, onPress }: { initial: string; onPress: () => void }) {
  const press = usePressScale(0.92);
  return (
    <Animated.View style={press.style}>
      <Pressable onPress={onPress} onPressIn={press.onPressIn} onPressOut={press.onPressOut}>
        <View style={{ width: 38, height: 38, borderRadius: 19, padding: 2, overflow: 'hidden' }}>
          <LinearGradient
            colors={[W.coral, W.rose, W.violet, W.coral]}
            start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          />
          <View style={{ flex: 1, borderRadius: 17, backgroundColor: '#1C1216', alignItems: 'center', justifyContent: 'center' }}>
            <Txt font="user" weight={600} style={{ fontSize: 13, color: W.cream }}>{initial}</Txt>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── CheckInCard ─────────────────────────────────────────────────────────
// The nightly ritual. Gold eyebrow (it feeds the streak), aurora hairline on
// the top edge, one-tap mood answers.
function CheckInCard({ onMood, streak }: { onMood: (mood: string) => void; streak: number | null }) {
  return (
    <View style={{
      marginHorizontal: 16, marginBottom: 18,
      borderRadius: 22, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14,
      backgroundColor: W.glass,
      borderWidth: 1, borderColor: W.hairline,
      overflow: 'hidden',
      shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 30, shadowOffset: { width: 0, height: 14 },
    }}>
      <BlurView pointerEvents="none" intensity={40} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      {/* Coral bloom bleeding in from the top-right corner */}
      <View pointerEvents="none" style={{ position: 'absolute', right: -40, top: -50 }}>
        <RadialGlow
          width={150} height={150}
          stops={[{ offset: 0, color: W.primary, opacity: 0.16 }, { offset: 0.65, color: W.primary, opacity: 0 }]}
        />
      </View>
      <AuroraLine />

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt font="user" weight={600} style={{ fontSize: 10, color: W.gold, letterSpacing: 1.8, textTransform: 'uppercase' }}>
          Tonight’s check-in
        </Txt>
        <Txt font="user" weight={500} style={{ fontSize: 10.5, color: W.textMuted }}>{CHECK_IN.duration}</Txt>
      </View>

      <Txt font="comp" weight={600} style={{ marginTop: 8, fontSize: 17, color: W.cream, letterSpacing: -0.2 }}>
        {CHECK_IN.prompt}
      </Txt>

      <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {CHECK_IN.moods.map(m => (
          <Pressable
            key={m}
            onPress={() => onMood(m)}
            style={({ pressed }) => ({
              paddingVertical: 9, paddingHorizontal: 15, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Txt font="user" weight={500} style={{ fontSize: 13, color: '#E8DEE1' }}>{m}</Txt>
          </Pressable>
        ))}
      </View>

      {/* Only claim a streak that exists. This read "Keeps your 12-day streak
          alive" for every user on every launch, including their first. */}
      {streak && streak > 0 ? (
        <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <NavIcon name="flame-solid" color={W.gold} size={12} />
          <Txt font="user" style={{ fontSize: 11, color: W.text3 }}>
            Keeps your {streak}-day streak alive
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

// Exported so Studio's Continue row can stamp last_interaction_at the same way.
export function formatLastInteraction(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    const mins = Math.max(1, Math.round((now.getTime() - d.getTime()) / 60000));
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ─── CompanionCard ───────────────────────────────────────────────────────
// One row per companion: ringed waveform avatar, name + archetype badge, a
// gold memory line (or a pulsing coral "has something on their mind"), the
// last-talked stamp, and a coral call button.
function CompanionCard({ companion, onChat, onCall }: { companion: Companion; onChat: () => void; onCall: () => void }) {
  const accent = ARCHETYPE_COLORS[companion.archetype] || W.primary;
  const pulse = usePulse();
  const cardPress = usePressScale(0.98);
  const callPress = usePressScale(0.9);
  const memory = companion.memoryHighlight ?? companion.memory;

  return (
    <Animated.View style={cardPress.style}>
    <Pressable onPress={onChat} onPressIn={cardPress.onPressIn} onPressOut={cardPress.onPressOut}>
      <View style={{
        borderRadius: 20, padding: 14,
        flexDirection: 'row', alignItems: 'center', gap: 13,
        backgroundColor: W.glass,
        borderWidth: 1, borderColor: W.hairline,
        overflow: 'hidden',
      }}>
        <BlurView pointerEvents="none" intensity={34} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.09)' }} />

        <Avatar name={companion.name} color={accent} size={56} image={companion.image} breathe={!!companion.pending} />

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.cream, letterSpacing: -0.2 }} numberOfLines={1}>
              {companion.name}
            </Txt>
            <View style={{
              paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999,
              backgroundColor: rgba(accent, 0.12),
              borderWidth: 1, borderColor: rgba(accent, 0.32),
            }}>
              <Txt font="user" weight={700} style={{ fontSize: 9, color: accent, letterSpacing: 1.1, textTransform: 'uppercase' }}>
                {ARCHETYPE_LABEL[companion.archetype]}
              </Txt>
            </View>
          </View>

          {companion.pending ? (
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Animated.View style={[{
                width: 6, height: 6, borderRadius: 3, backgroundColor: W.primary,
                shadowColor: W.primary, shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
              }, pulse]} />
              <Txt font="user" weight={500} style={{ fontSize: 12, color: W.primarySoft }}>Has something on their mind</Txt>
            </View>
          ) : memory ? (
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <NavIcon name="sparkle-solid" color={W.gold} size={11} />
              <Txt font="user" numberOfLines={1} style={{ flex: 1, fontSize: 12, color: W.gold }}>
                Remembers · {memory}
              </Txt>
            </View>
          ) : null}

          {companion.lastMessagePreview ? (
            <Txt font="user" numberOfLines={1} style={{ marginTop: 4, fontSize: 12, color: W.text2 }}>
              {companion.lastMessagePreview}
            </Txt>
          ) : null}

          <Txt font="user" style={{ marginTop: 4, fontSize: 11, color: W.textMuted }}>
            {formatLastInteraction(companion.lastInteractionAt) || companion.lastTalked || ''}
          </Txt>
        </View>

        <Animated.View style={callPress.style}>
          <Pressable
            onPress={onCall}
            onPressIn={callPress.onPressIn}
            onPressOut={callPress.onPressOut}
            hitSlop={8}
            style={{
              width: 42, height: 42, borderRadius: 21,
              backgroundColor: rgba(W.primary, 0.10),
              borderWidth: 1, borderColor: rgba(W.primary, 0.30),
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <NavIcon name="phone" color={W.primary} size={17} />
          </Pressable>
        </Animated.View>
      </View>
    </Pressable>
    </Animated.View>
  );
}

// ─── EnterStagger ────────────────────────────────────────────────────────
// Staggered entrance wrapper — hooks can't run in loops, so each list item
// gets its own instance.
function EnterStagger({ delay, children }: { delay: number; children: React.ReactNode }) {
  const e = useEntrance({ fromTranslateY: 14, durationMs: 480, delayMs: delay });
  return <Animated.View style={e}>{children}</Animated.View>;
}

// ─── WeekStrip ───────────────────────────────────────────────────────────
// Seven bars, Monday first. Today's bar is the only one that gets the aurora
// — everything else stays neutral so the eye lands on "today".
function WeekStrip({ activity }: { activity: ApiActivity }) {
  const bars = activity.week_minutes;
  const peak = Math.max(...bars, 1);
  const total = activity.week_total_minutes;
  const prev = activity.prev_week_total_minutes;
  // No delta on a first week — "+100%" against zero is arithmetic, not insight.
  const delta = prev > 0 ? Math.round(((total - prev) / prev) * 100) : null;
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  // JS weeks start on Sunday; this strip starts on Monday.
  const todayIdx = (new Date().getDay() + 6) % 7;

  return (
    <View style={{
      marginHorizontal: 16, marginTop: 16,
      borderRadius: 18, paddingVertical: 14, paddingHorizontal: 16,
      backgroundColor: W.glassSoft,
      borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Txt font="user" weight={600} style={{ fontSize: 10, color: W.text2, letterSpacing: 1.6, textTransform: 'uppercase' }}>
          Your week
        </Txt>
        <Txt font="user" weight={600} style={{ fontSize: 11, color: W.gold }}>
          {total} min{delta === null ? '' : ` · ${delta >= 0 ? '+' : ''}${delta}%`}
        </Txt>
      </View>

      <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 14, height: 52 }}>
        {bars.map((v, i) => {
          const h = Math.max(6, Math.round((v / peak) * 36));
          const isToday = i === todayIdx;
          return (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              {isToday ? (
                <LinearGradient
                  colors={[...GRAD.aurora]}
                  start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                  style={{
                    width: '100%', height: h, borderRadius: 4,
                    shadowColor: W.rose, shadowOpacity: 0.4, shadowRadius: 12, shadowOffset: { width: 0, height: 0 },
                  }}
                />
              ) : (
                <View style={{ width: '100%', height: h, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.10)' }} />
              )}
              <Txt font="user" weight={isToday ? 600 : 500} style={{ fontSize: 9, color: isToday ? W.primarySoft : W.textMuted }}>
                {days[i]}
              </Txt>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── S10 HOME ──────────────────────────────────────────────────────────────
export function S10_Home({ go, companions, onSelectCompanion, onCallCompanion, userName, onAddCompanion, maxCompanions: maxCompanionsProp }: {
  go: Go; companions: Companion[]; userName: string;
  onSelectCompanion: (c: Companion) => void; onCallCompanion: (c: Companion) => void;
  onAddCompanion?: () => void; maxCompanions?: number;
}) {
  // Fetched here rather than threaded through App: the streak and the week
  // strip are the only things that need it, and both live on this screen.
  const [activity, setActivity] = useState<ApiActivity | null>(null);
  useEffect(() => {
    getActivity().then(setActivity).catch(() => { /* no numbers is better than invented ones */ });
  }, []);

  // The name is genuinely empty until the profile loads, and it used to fall
  // back to "Aria" app-wide. Greet without a name rather than with a stranger's.
  const greeting = (() => {
    const h = new Date().getHours();
    const who = userName.trim();
    const suffix = who ? `, ${who}` : '';
    if (h < 5) return who ? `Can’t sleep, ${who}?` : 'Can’t sleep?';
    if (h < 12) return `Good morning${suffix}`;
    if (h < 18) return `Good afternoon${suffix}`;
    return `Good evening${suffix}`;
  })();
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  // Phase 1 cap: 5 companions per user (overrides tier-based caps from prototype).
  const maxCompanions = maxCompanionsProp ?? 5;
  const canAdd = companions.length < maxCompanions;
  // App always supplies this; the fallback used to open a dead prototype
  // screen whose voice picker offered names the backend has never heard of.
  const handleAdd = onAddCompanion ?? (() => go('archetype'));
  const lead = companions[0];
  const slotsLeft = maxCompanions - companions.length;

  return (
    <Screen>
      <TopBar
        height={56}
        left={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
            <View style={{
              width: 7, height: 7, borderRadius: 3.5, backgroundColor: W.rose,
              shadowColor: W.primary, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 },
            }} />
            <Txt font="display" weight={700} style={{ fontSize: 18, color: W.cream, letterSpacing: -0.3 }}>whisper</Txt>
          </View>
        }
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {activity && activity.streak_days > 0
              ? <StreakPill days={activity.streak_days} onPress={() => go('settings')} />
              : null}
            <AuroraAvatarButton initial={userName.trim()[0] ?? '·'} onPress={() => go('settings')} />
          </View>
        }
      />

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
        {/* Editorial greeting */}
        <View style={{ paddingHorizontal: 24, paddingTop: 10, paddingBottom: 20 }}>
          <Txt font="user" weight={500} style={{ fontSize: 10, color: W.textMuted, letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 10 }}>
            {dateStr}
          </Txt>
          <Txt font="display" weight={600} style={{ fontSize: 33, color: W.cream, letterSpacing: -0.8, lineHeight: 37 }}>
            {greeting}
          </Txt>
          {lead ? (
            <Txt font="user" style={{ marginTop: 8, fontSize: 13, color: W.text2 }}>
              {lead.name} has been thinking about tomorrow with you.
            </Txt>
          ) : null}
        </View>

        {lead ? <CheckInCard onMood={() => onSelectCompanion(lead)} streak={activity?.streak_days ?? null} /> : null}

        {/* Companions */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt font="user" weight={600} style={{ fontSize: 11, color: W.text2, letterSpacing: 1.6, textTransform: 'uppercase' }}>
            Your companions
          </Txt>
          <Txt font="user" weight={500} style={{ fontSize: 11, color: W.textMuted }}>
            {companions.length} active
          </Txt>
        </View>

        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          {companions.map((c, index) => (
            <EnterStagger key={String(c.id)} delay={index * 70}>
              <CompanionCard
                companion={c}
                onChat={() => onSelectCompanion(c)}
                onCall={() => onCallCompanion(c)}
              />
            </EnterStagger>
          ))}

          {/* Add companion — ghost row that matches the card rhythm */}
          <Pressable
            onPress={canAdd ? handleAdd : undefined}
            style={{
              borderRadius: 20, padding: 14,
              flexDirection: 'row', alignItems: 'center', gap: 13,
              borderWidth: 1, borderColor: canAdd ? rgba(W.primary, 0.24) : 'rgba(255,255,255,0.06)',
              backgroundColor: canAdd ? rgba(W.primary, 0.05) : 'transparent',
              opacity: canAdd ? 1 : 0.5,
            }}
          >
            <View style={{
              width: 56, height: 56, borderRadius: 28,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: canAdd ? rgba(W.primary, 0.30) : 'rgba(255,255,255,0.08)',
            }}>
              <NavIcon name="plus" color={canAdd ? W.primary : W.textMuted} size={22} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt font="comp" weight={600} style={{ fontSize: 15, color: canAdd ? W.cream : W.text2, letterSpacing: -0.2 }}>
                {canAdd ? 'Add a companion' : 'Maximum companions reached'}
              </Txt>
              <Txt font="user" style={{ marginTop: 3, fontSize: 11.5, color: W.textMuted }}>
                {canAdd ? `${slotsLeft} slot${slotsLeft === 1 ? '' : 's'} left` : `${maxCompanions} of ${maxCompanions} used`}
              </Txt>
            </View>
          </Pressable>
        </View>

        {activity && activity.active_days > 0 ? <WeekStrip activity={activity} /> : null}
      </ScrollView>
    </Screen>
  );
}

// ─── S11 ADD COMPANION ──────────────────────────────────────────────────────
