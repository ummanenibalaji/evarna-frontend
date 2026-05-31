// Home.tsx — S10 Home (companion list) + CompanionCard + S11 Add Companion.
// Ported from home.jsx.

import React, { useState } from 'react';
import { View, Pressable, ScrollView, Animated, TextInput } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Screen, TopBar } from '../components/Chrome';
import { Txt } from '../components/Txt';
import { NavIcon } from '../components/NavIcon';
import { Card, Pill, PrimaryButton } from '../components/Atoms';
import { Avatar, Waveform } from '../components/Avatar';
import { useGreetingGlow, useFloat, useCtaHalo } from '../theme/animations';
import { W, alpha } from '../theme/theme';
import { Go } from '../navigation/types';
import { Companion, Tier, ARCHETYPE_COLORS, ARCHETYPE_LABEL, VOICES } from '../data/config';

// ─── CompanionCard ───────────────────────────────────────────────────────
function CompanionCard({ companion, onChat, onCall, hero = false }: { companion: Companion; onChat: () => void; onCall: () => void; hero?: boolean }) {
  const accent = ARCHETYPE_COLORS[companion.archetype] || W.primary;
  const float = useFloat();

  if (hero) {
    return (
      <Animated.View style={float}>
        <Pressable onPress={onChat}>
          <View style={{
            width: 320, maxWidth: 320, padding: 32, borderRadius: 28,
            overflow: 'hidden',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
            alignItems: 'center', gap: 16,
            backgroundColor: 'rgba(19,21,30,0.55)',
            shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 30, shadowOffset: { width: 0, height: 16 },
          }}>
            <BlurView intensity={50} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
            {/* Accent glow at top */}
            <View pointerEvents="none" style={{
              position: 'absolute', top: -100, left: '50%', marginLeft: -150,
              width: 300, height: 200, borderRadius: 150,
              backgroundColor: accent, opacity: 0.18,
              shadowColor: accent, shadowOpacity: 0.5, shadowRadius: 60, shadowOffset: { width: 0, height: 0 },
            }} />
            {/* Top highlight */}
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
            {/* Vertical gradient */}
            <LinearGradient
              colors={['rgba(255,255,255,0.04)', 'rgba(255,255,255,0)', 'rgba(0,0,0,0.10)']}
              style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
            />

            <Avatar name={companion.name} color={accent} size={88} image={companion.image} />
            <View style={{ alignItems: 'center', gap: 4 }}>
              <Txt font="comp" weight={600} style={{ fontSize: 24, color: W.cream, letterSpacing: -0.4 }}>{companion.name}</Txt>
              <Txt font="user" weight={500} style={{ fontSize: 10, color: accent, letterSpacing: 2, textTransform: 'uppercase' }}>
                {ARCHETYPE_LABEL[companion.archetype]}
              </Txt>
            </View>
            {companion.memory ? (
              <View style={{
                paddingVertical: 8, paddingHorizontal: 14, borderRadius: 12,
                backgroundColor: 'rgba(94,234,212,0.06)',
                borderWidth: 1, borderColor: 'rgba(94,234,212,0.15)',
                maxWidth: 250,
              }}>
                <Txt font="user" style={{ fontSize: 11, color: W.accent, textAlign: 'center', lineHeight: 16, letterSpacing: 0.2 }}>
                  Remembers · {companion.memory}
                </Txt>
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
              <Pressable
                onPress={onChat}
                style={{
                  paddingVertical: 14, paddingHorizontal: 22,
                  borderRadius: 24,
                  backgroundColor: 'rgba(255,255,255,0.06)',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                }}
              >
                <NavIcon name="chat" color={W.text} size={16} />
                <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text, letterSpacing: 0.3 }}>Message</Txt>
              </Pressable>
              <Pressable
                onPress={onCall}
                style={{
                  paddingVertical: 14, paddingHorizontal: 22, borderRadius: 24,
                  backgroundColor: W.primary,
                  flexDirection: 'row', alignItems: 'center', gap: 8,
                  shadowColor: W.primary, shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 8 },
                  overflow: 'hidden',
                }}
              >
                <LinearGradient
                  colors={['#A29CFF', '#736AF0']}
                  start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                  style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
                />
                <View pointerEvents="none" style={{ position: 'absolute', left: 1, top: 1, right: 1, height: 16, borderTopLeftRadius: 23, borderTopRightRadius: 23, backgroundColor: 'rgba(255,255,255,0.18)' }} />
                <NavIcon name="phone" color="#fff" size={16} />
                <Txt font="user" weight={600} style={{ fontSize: 13, color: '#fff', letterSpacing: 0.3 }}>Call</Txt>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    );
  }

  return (
    <Pressable onPress={onChat}>
      <View style={{
        borderRadius: 20, padding: 18,
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: 'rgba(19,21,30,0.55)',
        borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
        shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
      }}>
        <BlurView intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        {/* Accent stripe left */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 14, bottom: 14, width: 2, borderRadius: 1, backgroundColor: accent, opacity: 0.7 }} />
        {/* Top highlight */}
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.10)' }} />

        <Avatar name={companion.name} color={accent} size={52} image={companion.image} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <Txt font="comp" weight={600} style={{ fontSize: 17, color: W.cream, letterSpacing: -0.2 }}>{companion.name}</Txt>
            <Txt font="user" weight={500} style={{ fontSize: 9, color: accent, letterSpacing: 1.5, textTransform: 'uppercase' }}>{ARCHETYPE_LABEL[companion.archetype]}</Txt>
          </View>
          {companion.memory ? (
            <Txt font="user" numberOfLines={1} style={{ marginTop: 4, fontSize: 12, color: W.accent, opacity: 0.85 }}>
              {companion.memory}
            </Txt>
          ) : null}
          <Txt font="user" style={{ marginTop: 4, fontSize: 11, color: companion.pending ? W.secondary : W.textMuted, letterSpacing: 0.3 }}>
            {companion.pending ? 'Has something on their mind' : companion.lastTalked}
          </Txt>
        </View>
        <View style={{ alignItems: 'center' }}>
          {companion.pending && (
            <View style={{ position: 'absolute', top: -2, right: -2, width: 8, height: 8, borderRadius: 4, backgroundColor: W.primary, zIndex: 2, shadowColor: W.primary, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } }} />
          )}
          <Pressable
            onPress={onCall}
            style={{
              backgroundColor: 'rgba(139,130,255,0.12)',
              borderWidth: 1, borderColor: 'rgba(139,130,255,0.25)',
              width: 42, height: 42, borderRadius: 21,
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <NavIcon name="phone" color={W.primary} size={18} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

// ─── ConversationRow (WhatsApp-style list item for 2+ companions) ──────────
// 80px tall row: 48px ringed avatar · name+archetype·preview·memory column ·
// timestamp on the right. Tapping anywhere on the row opens chat for that
// companion. Used only when the user has 2 or more companions on home.
function formatLastInteraction(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ConversationRow({ companion, onPress }: { companion: Companion; onPress: () => void }) {
  const accent = ARCHETYPE_COLORS[companion.archetype] || W.primary;
  const timestamp = formatLastInteraction(companion.lastInteractionAt) || companion.lastTalked || '';
  const preview = companion.lastMessagePreview;
  const highlight = companion.memoryHighlight ?? companion.memory;

  return (
    <Pressable onPress={onPress} style={{ height: 80, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 12 }}>
      {/* Avatar with archetype-color ring */}
      <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Avatar name={companion.name} color={accent} size={48} image={companion.image} breathe={false} />
      </View>

      {/* Center column: name+badge / preview / memory */}
      <View style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.cream, letterSpacing: -0.2 }} numberOfLines={1}>
            {companion.name}
          </Txt>
          <View style={{
            paddingVertical: 2, paddingHorizontal: 7, borderRadius: 999,
            backgroundColor: alpha(W.secondary, '1f'),
            borderWidth: 1, borderColor: alpha(W.secondary, '40'),
          }}>
            <Txt font="user" weight={600} style={{ fontSize: 10, color: W.secondary, letterSpacing: 0.5 }}>
              {ARCHETYPE_LABEL[companion.archetype]}
            </Txt>
          </View>
        </View>
        {preview ? (
          <Txt font="user" numberOfLines={1} style={{ marginTop: 2, fontSize: 13, color: W.text2 }}>
            {preview}
          </Txt>
        ) : null}
        {highlight ? (
          <Txt font="user" numberOfLines={1} style={{ marginTop: 2, fontSize: 11, color: W.accent }}>
            Remembers: {highlight}
          </Txt>
        ) : null}
      </View>

      {/* Right column: timestamp */}
      {timestamp ? (
        <Txt font="user" style={{ fontSize: 11, color: W.text3 }}>
          {timestamp}
        </Txt>
      ) : null}
    </Pressable>
  );
}

// ─── S10 HOME ──────────────────────────────────────────────────────────────
export function S10_Home({ go, tier, companions, onSelectCompanion, onCallCompanion, userName, onAddCompanion, maxCompanions: maxCompanionsProp }: {
  go: Go; tier: Tier; companions: Companion[]; userName: string;
  onSelectCompanion: (c: Companion) => void; onCallCompanion: (c: Companion) => void;
  onAddCompanion?: () => void; maxCompanions?: number;
}) {
  const glow = useGreetingGlow();
  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return `Can't sleep, ${userName}?`;
    if (h < 12) return `Good morning, ${userName}`;
    if (h < 18) return `Good afternoon, ${userName}`;
    return `Good evening, ${userName}`;
  })();
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  // Phase 1 cap: 5 companions per user (overrides tier-based caps from prototype).
  const maxCompanions = maxCompanionsProp ?? 5;
  const isSingle = companions.length === 1;
  const isList = companions.length >= 2;
  const canAdd = companions.length < maxCompanions;
  const handleAdd = onAddCompanion ?? (() => go('add-companion'));

  return (
    <Screen>
      <TopBar
        height={64}
        left={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{
              width: 6, height: 6, borderRadius: 3,
              backgroundColor: W.accent,
              shadowColor: W.accent, shadowOpacity: 1, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
            }} />
            <Txt font="comp" weight={700} style={{ fontSize: 17, color: W.cream, letterSpacing: -0.4 }}>whisper</Txt>
          </View>
        }
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
            <Pressable style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(19,21,30,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
              <NavIcon name="bell" color={W.text2} size={18} />
            </Pressable>
            <Pressable onPress={() => go('settings')} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(19,21,30,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }}>
              <Txt font="user" weight={600} style={{ fontSize: 13, color: W.text }}>{userName[0]}</Txt>
            </Pressable>
          </View>
        }
      />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* Editorial greeting block */}
        <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24 }}>
          <Txt font="user" weight={500} style={{ fontSize: 10, color: W.text3, letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 12 }}>
            {dateStr}
          </Txt>
          <Animated.View style={glow}>
            <Txt font="comp" weight={500} style={{ fontSize: 30, color: W.cream, letterSpacing: -0.8, lineHeight: 38 }}>{greeting}</Txt>
          </Animated.View>
        </View>

        {/* Companions section label */}
        <View style={{ paddingHorizontal: 24, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Txt font="user" weight={600} style={{ fontSize: 11, color: W.text2, letterSpacing: 1.6, textTransform: 'uppercase' }}>
            Your companions
          </Txt>
          {companions.length > 1 && (
            <Txt font="user" weight={500} style={{ fontSize: 11, color: W.textMuted, letterSpacing: 0.4 }}>
              {companions.length} active
            </Txt>
          )}
        </View>

        {isList ? (
          // ── List mode (2+ companions): WhatsApp-style conversation rows ──
          <View style={{ paddingBottom: 96 }}>
            {companions.map(c => (
              <ConversationRow key={String(c.id)} companion={c} onPress={() => onSelectCompanion(c)} />
            ))}
          </View>
        ) : (
          // ── Single companion (hero card) ──
          <View style={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12, alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
            {companions.map(c => (
              <CompanionCard key={String(c.id)} companion={c} hero onChat={() => onSelectCompanion(c)} onCall={() => onCallCompanion(c)} />
            ))}
            {/* Centered "+" below the card. Same circle treatment as spec. */}
            <View style={{ marginTop: 24, alignItems: 'center', gap: 8 }}>
              <Pressable
                onPress={canAdd ? handleAdd : undefined}
                style={{
                  width: 56, height: 56, borderRadius: 28,
                  backgroundColor: W.surface1,
                  borderWidth: 1, borderColor: canAdd ? W.primary : W.textMuted,
                  alignItems: 'center', justifyContent: 'center',
                  opacity: canAdd ? 1 : 0.5,
                }}
              >
                <NavIcon name="plus" color={canAdd ? W.primary : W.textMuted} size={22} />
              </Pressable>
              <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text2, letterSpacing: 0.3 }}>
                {canAdd ? 'Add companion' : 'Maximum companions reached'}
              </Txt>
            </View>
          </View>
        )}
      </ScrollView>

      {/* FAB for list mode — always reachable, bottom-right */}
      {isList ? (
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 20, bottom: 90, alignItems: 'flex-end', gap: 6 }}>
          <Pressable
            onPress={canAdd ? handleAdd : undefined}
            style={{
              width: 56, height: 56, borderRadius: 28,
              backgroundColor: canAdd ? W.primary : W.surface2,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: canAdd ? W.primary : '#000', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
              opacity: canAdd ? 1 : 0.6,
            }}
          >
            <NavIcon name="plus" color="#fff" size={24} />
          </Pressable>
          {!canAdd ? (
            <Txt font="user" weight={500} style={{ fontSize: 11, color: W.textMuted }}>
              Maximum companions reached
            </Txt>
          ) : null}
        </View>
      ) : null}
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
            <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text }}>Choose a new companion</Txt>
            <Txt font="user" style={{ marginTop: 8, fontSize: 13, color: W.text2 }}>What kind of presence?</Txt>
            <View style={{ marginTop: 24, gap: 10 }}>
              {[
                { k: 'mentor', icon: 'compass', l: 'Mentor', d: 'Help thinking things through' },
                { k: 'friend', icon: 'two', l: 'Best Friend', d: "A friend who's always there" },
                { k: 'partner', icon: 'heart', l: 'Partner', d: 'Connection and affection' },
                { k: 'challenger', icon: 'target', l: 'Challenger', d: 'Someone to keep you honest' },
              ].map((c: any) => (
                <Pressable key={c.k} onPress={() => { setArchetype(c.k); setStep(2); }} style={{ backgroundColor: W.surface1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden' }}>
                  <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: ARCHETYPE_COLORS[c.k] }} />
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: W.surface2, alignItems: 'center', justifyContent: 'center', marginLeft: 6 }}>
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
            <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text }}>Voice gender</Txt>
            <View style={{ marginTop: 24, flexDirection: 'row', gap: 8 }}>
              {['male', 'female', 'neutral'].map(g => (
                <Pill key={g} active={gender === g} onPress={() => { setGender(g); setTimeout(() => setStep(3), 300); }} style={{ flex: 1 }} textStyle={{ textTransform: 'capitalize' }}>{g}</Pill>
              ))}
            </View>
          </>
        )}
        {step === 3 && gender && (
          <>
            <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text }}>Pick a voice</Txt>
            <View style={{ marginTop: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {VOICES[gender].map(v => (
                <Pressable key={v.n} onPress={() => { setVoice(v.n); setName(v.n); setTimeout(() => setStep(4), 300); }} style={{ width: '31.5%', minHeight: 110, backgroundColor: W.surface1, borderRadius: 16, padding: 12, alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: voice === v.n ? 2 : 0, borderColor: W.accent }}>
                  <Waveform color={W.primary} animate={voice === v.n} size={32} />
                  <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text }}>{v.n}</Txt>
                  <Txt font="user" style={{ fontSize: 10, color: W.text2 }}>{v.d}</Txt>
                </Pressable>
              ))}
            </View>
          </>
        )}
        {step === 4 && (
          <>
            <Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text }}>Name your companion</Txt>
            <View style={{ marginTop: 40, alignItems: 'center' }}>
              <TextInput value={name} onChangeText={setName} style={{ backgroundColor: W.surface1, color: W.text, borderWidth: 1, borderColor: W.surface2, height: 60, borderRadius: 16, fontFamily: 'Manrope_500Medium', fontSize: 22, textAlign: 'center', width: '100%', maxWidth: 280 }} />
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
