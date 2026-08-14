// Home.tsx — S10 Home (ritual + companions) + S11 Add Companion.
// "Ember Dusk": the header carries the streak, a nightly check-in card sits
// above the companion list, and a weekly momentum strip closes the screen.

import React, { useState } from 'react';
import { View, Pressable, ScrollView, Animated, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Screen, TopBar } from '../components/Chrome';
import { Txt } from '../components/Txt';
import { NavIcon } from '../components/NavIcon';
import { Pill, PrimaryButton, AuroraLine, StreakPill } from '../components/Atoms';
import { Avatar, Waveform } from '../components/Avatar';
import { RadialGlow } from '../components/RadialGlow';
import { usePulse } from '../theme/animations';
import { W, GRAD, rgba } from '../theme/theme';
import { Go } from '../navigation/types';
import { Companion, Tier, ARCHETYPE_COLORS, ARCHETYPE_LABEL, VOICES, RITUAL } from '../data/config';

// ─── AuroraAvatarButton ──────────────────────────────────────────────────
// The account button in the header: an aurora ring around the user's initial.
function AuroraAvatarButton({ initial, onPress }: { initial: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
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
  );
}

// ─── CheckInCard ─────────────────────────────────────────────────────────
// The nightly ritual. Gold eyebrow (it feeds the streak), aurora hairline on
// the top edge, one-tap mood answers.
function CheckInCard({ onMood }: { onMood: (mood: string) => void }) {
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
        <Txt font="user" weight={500} style={{ fontSize: 10.5, color: W.textMuted }}>{RITUAL.checkInDuration}</Txt>
      </View>

      <Txt font="comp" weight={600} style={{ marginTop: 8, fontSize: 17, color: W.cream, letterSpacing: -0.2 }}>
        {RITUAL.checkInPrompt}
      </Txt>

      <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {RITUAL.moods.map(m => (
          <Pressable
            key={m}
            onPress={() => onMood(m)}
            style={{
              paddingVertical: 9, paddingHorizontal: 15, borderRadius: 18,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)',
            }}
          >
            <Txt font="user" weight={500} style={{ fontSize: 13, color: '#E8DEE1' }}>{m}</Txt>
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <NavIcon name="flame-solid" color={W.gold} size={12} />
        <Txt font="user" style={{ fontSize: 11, color: W.text3 }}>
          Keeps your {RITUAL.streakDays}-day streak alive
        </Txt>
      </View>
    </View>
  );
}

function formatLastInteraction(iso?: string): string {
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
  const memory = companion.memoryHighlight ?? companion.memory;

  return (
    <Pressable onPress={onChat}>
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

        <Pressable
          onPress={onCall}
          style={{
            width: 42, height: 42, borderRadius: 21,
            backgroundColor: rgba(W.primary, 0.10),
            borderWidth: 1, borderColor: rgba(W.primary, 0.30),
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <NavIcon name="phone" color={W.primary} size={17} />
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── WeekStrip ───────────────────────────────────────────────────────────
// Seven bars, Monday first. Today's bar is the only one that gets the aurora
// — everything else stays neutral so the eye lands on "today".
function WeekStrip() {
  const bars = RITUAL.weekMinutes;
  const peak = Math.max(...bars, 1);
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
          {RITUAL.weekTotalLabel} · {RITUAL.weekDeltaLabel}
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
export function S10_Home({ go, tier, companions, onSelectCompanion, onCallCompanion, userName, onAddCompanion, maxCompanions: maxCompanionsProp }: {
  go: Go; tier: Tier; companions: Companion[]; userName: string;
  onSelectCompanion: (c: Companion) => void; onCallCompanion: (c: Companion) => void;
  onAddCompanion?: () => void; maxCompanions?: number;
}) {
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return `Can’t sleep, ${userName}?`;
    if (h < 12) return `Good morning, ${userName}`;
    if (h < 18) return `Good afternoon, ${userName}`;
    return `Good evening, ${userName}`;
  })();
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  // Phase 1 cap: 5 companions per user (overrides tier-based caps from prototype).
  const maxCompanions = maxCompanionsProp ?? 5;
  const canAdd = companions.length < maxCompanions;
  const handleAdd = onAddCompanion ?? (() => go('add-companion'));
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
            <StreakPill days={RITUAL.streakDays} onPress={() => go('settings')} />
            <AuroraAvatarButton initial={userName?.[0] ?? 'A'} onPress={() => go('settings')} />
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

        {lead ? <CheckInCard onMood={() => onSelectCompanion(lead)} /> : null}

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
          {companions.map(c => (
            <CompanionCard
              key={String(c.id)}
              companion={c}
              onChat={() => onSelectCompanion(c)}
              onCall={() => onCallCompanion(c)}
            />
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

        <WeekStrip />
      </ScrollView>
    </Screen>
  );
}

// ─── S11 ADD COMPANION ──────────────────────────────────────────────────────
export function S11_AddCompanion({ go, tier, onCreate }: { go: Go; tier: Tier; onCreate: (c: { name: string; archetype: string; voice: string | null }) => void }) {
  const [step, setStep] = useState(1);
  const [archetype, setArchetype] = useState<string | null>(null);
  const [gender, setGender] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [name, setName] = useState('');

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => (step === 1 ? go('home') : setStep(s => s - 1))}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Step {step} of 4</Txt>}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 16 }}>
        {step === 1 && (
          <>
            <Txt font="display" weight={700} style={{ fontSize: 24, color: W.cream, letterSpacing: -0.5 }}>Choose a new companion</Txt>
            <Txt font="user" style={{ marginTop: 8, fontSize: 13, color: W.text2 }}>What kind of presence?</Txt>
            <View style={{ marginTop: 24, gap: 10 }}>
              {[
                { k: 'mentor', icon: 'compass', l: 'Mentor', d: 'Help thinking things through' },
                { k: 'friend', icon: 'two', l: 'Best Friend', d: "A friend who's always there" },
                { k: 'partner', icon: 'heart', l: 'Partner', d: 'Connection and affection' },
                { k: 'challenger', icon: 'target', l: 'Challenger', d: 'Someone to keep you honest' },
              ].map((c: any) => (
                <Pressable key={c.k} onPress={() => { setArchetype(c.k); setStep(2); }} style={{ backgroundColor: W.glass, borderRadius: 18, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden', borderWidth: 1, borderColor: W.hairline }}>
                  <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: ARCHETYPE_COLORS[c.k] }} />
                  <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: rgba(ARCHETYPE_COLORS[c.k], 0.14), alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
                    <NavIcon name={c.icon} color={ARCHETYPE_COLORS[c.k]} size={20} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Txt font="user" weight={500} style={{ fontSize: 15, color: W.text }}>{c.l}</Txt>
                    <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>{c.d}</Txt>
                  </View>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {step === 2 && (
          <>
            <Txt font="display" weight={700} style={{ fontSize: 24, color: W.cream, letterSpacing: -0.5 }}>Voice gender</Txt>
            <View style={{ marginTop: 24, flexDirection: 'row', gap: 8 }}>
              {['male', 'female', 'neutral'].map(g => (
                <Pill key={g} active={gender === g} onPress={() => { setGender(g); setTimeout(() => setStep(3), 300); }} style={{ flex: 1 }} textStyle={{ textTransform: 'capitalize' }}>{g}</Pill>
              ))}
            </View>
          </>
        )}
        {step === 3 && gender && (
          <>
            <Txt font="display" weight={700} style={{ fontSize: 24, color: W.cream, letterSpacing: -0.5 }}>Pick a voice</Txt>
            <View style={{ marginTop: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {VOICES[gender].map(v => (
                <Pressable key={v.n} onPress={() => { setVoice(v.n); setName(v.n); setTimeout(() => setStep(4), 300); }} style={{ width: '31.5%', minHeight: 110, backgroundColor: W.glass, borderRadius: 16, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: voice === v.n ? 2 : 1, borderColor: voice === v.n ? W.primary : W.hairline }}>
                  <Waveform color={voice === v.n ? W.primary : W.text2} animate={voice === v.n} size={32} />
                  <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text }}>{v.n}</Txt>
                  <Txt font="user" style={{ fontSize: 10, color: W.text2 }}>{v.d}</Txt>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {step === 4 && (
          <>
            <Txt font="display" weight={700} style={{ fontSize: 24, color: W.cream, letterSpacing: -0.5 }}>Name your companion</Txt>
            <View style={{ marginTop: 40, alignItems: 'center' }}>
              <TextInput value={name} onChangeText={setName} style={{ backgroundColor: W.glass, color: W.text, borderWidth: 1, borderColor: W.hairlineStrong, height: 60, borderRadius: 16, fontFamily: 'Manrope_500Medium', fontSize: 22, textAlign: 'center', width: '100%', maxWidth: 280 }} />
            </View>
          </>
        )}
      </ScrollView>
      {step === 4 && (
        <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24 }}>
          <PrimaryButton disabled={!name.trim()} onPress={() => {
            if (tier === 'free') return go('paywall');
            onCreate({ name: name.trim(), archetype: archetype!, voice });
            go('home');
          }}>Create companion</PrimaryButton>
        </View>
      )}
    </Screen>
  );
}
