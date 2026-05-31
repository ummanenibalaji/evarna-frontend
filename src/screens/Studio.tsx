// Studio.tsx — S15 Studio Home, S16 Scenario Setup, S17 Active Session
// (+ Session Summary sheet), S18 Character Creator. Ported from studio.jsx.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, ScrollView, Pressable, TextInput, Animated, Easing,
  LayoutChangeEvent, PanResponder,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Screen, TopBar } from '../components/Chrome';
import { NavIcon, IconName } from '../components/NavIcon';
import { Txt } from '../components/Txt';
import { Pill, PrimaryButton, Toggle } from '../components/Atoms';
import { Avatar, Waveform } from '../components/Avatar';
import { BubbleMem, ChatInput } from '../components/ChatBits';
import { W, alpha } from '../theme/theme';
import { SCENARIOS, VOICES, Scenario, ActiveConvo, Tier } from '../data/config';
import { Go } from '../navigation/types';

export interface Character { id: number; name: string; trait: string; }

// ─── Section header ──────────────────────────────────────────────────────
function SectionHeader({ children, marginTop = 8 }: { children: React.ReactNode; marginTop?: number }) {
  return (
    <View style={{ paddingTop: marginTop, paddingHorizontal: 20, paddingBottom: 12 }}>
      <Txt font="user" weight={600} style={{ fontSize: 11, color: W.text2, textTransform: 'uppercase', letterSpacing: 0.9 }}>
        {children}
      </Txt>
    </View>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Txt font="user" weight={600} style={{ fontSize: 11, color: W.text2, textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 10 }}>
      {children}
    </Txt>
  );
}

// ─── S15 STUDIO HOME ─────────────────────────────────────────────────────
interface StudioHomeProps {
  go: Go;
  tier: Tier;
  characters: Character[];
  activeConvos?: ActiveConvo[];
  setupScenario: (s: Scenario) => void;
  openCreator: () => void;
  resumeConvo: (c: ActiveConvo) => void;
}

export function S15_StudioHome({ go, tier, characters, activeConvos = [], setupScenario, openCreator, resumeConvo }: StudioHomeProps) {
  const locked = tier === 'free';
  const startedScenarios = new Set(activeConvos.filter(c => c.kind === 'scenario').map(c => c.scenarioId));

  return (
    <Screen>
      <TopBar
        left={<Txt font="comp" weight={700} style={{ fontSize: 22, color: W.text }}>Studio</Txt>}
        right={
          <Pressable onPress={() => (locked ? go('paywall') : openCreator())} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <NavIcon name="plus" color={W.accent} size={18} />
            <Txt font="user" weight={500} style={{ fontSize: 13, color: W.accent }}>Create</Txt>
          </Pressable>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        {/* CONTINUE — active conversations */}
        {!locked && activeConvos.length > 0 && (
          <>
            <SectionHeader>Continue</SectionHeader>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}
            >
              {activeConvos.map(c => (
                <Pressable
                  key={c.id}
                  onPress={() => resumeConvo(c)}
                  style={{
                    width: 220, borderRadius: 16, padding: 14, gap: 8, overflow: 'hidden',
                    borderWidth: 1, borderColor: alpha(c.accent, '26'), backgroundColor: 'rgba(26,29,46,0.55)',
                  }}
                >
                  <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: alpha(c.accent, '1f'), borderWidth: 1, borderColor: alpha(c.accent, '40'), alignItems: 'center', justifyContent: 'center' }}>
                      <NavIcon name={c.icon as IconName} color={c.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Txt font="user" weight={600} style={{ fontSize: 14, color: W.text }} numberOfLines={1}>{c.name}</Txt>
                      <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{c.timeAgo}</Txt>
                    </View>
                  </View>
                  <Txt font="user" style={{ fontSize: 12, color: W.text2, lineHeight: 17 }} numberOfLines={2}>{c.preview}</Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <NavIcon name="sparkle" color={W.accent} size={14} />
                    <Txt font="user" style={{ fontSize: 11, color: W.accent }}>{c.memoryCount} memories</Txt>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* Ready-made scenarios */}
        <SectionHeader marginTop={activeConvos.length ? 24 : 8}>Ready-made scenarios</SectionHeader>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}>
          {SCENARIOS.map(s => {
            const isStarted = startedScenarios.has(s.id);
            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  if (locked) return go('paywall');
                  if (isStarted) {
                    const existing = activeConvos.find(c => c.scenarioId === s.id);
                    if (existing) return resumeConvo(existing);
                  }
                  setupScenario(s);
                }}
                style={{
                  width: 160, height: 200, borderRadius: 18, padding: 16, overflow: 'hidden',
                  justifyContent: 'space-between',
                  borderWidth: 1, borderColor: alpha(s.accent, '1f'), backgroundColor: 'rgba(26,29,46,0.55)',
                }}
              >
                <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: alpha(s.accent, '1f'), borderWidth: 1, borderColor: alpha(s.accent, '26'), alignItems: 'center', justifyContent: 'center' }}>
                  <NavIcon name={s.icon as IconName} color={s.accent} />
                </View>
                <View>
                  <Txt font="user" weight={600} style={{ fontSize: 14, color: W.text, marginBottom: 4 }}>{s.name}</Txt>
                  <Txt font="user" style={{ fontSize: 11, color: W.text2, lineHeight: 15 }}>{s.desc}</Txt>
                </View>
                {isStarted && (
                  <View style={{ position: 'absolute', top: 10, right: 10, backgroundColor: alpha(s.accent, '26'), paddingVertical: 2, paddingHorizontal: 8, borderRadius: 8 }}>
                    <Txt font="user" weight={600} style={{ fontSize: 9, color: s.accent, letterSpacing: 0.4, textTransform: 'uppercase' }}>Continue</Txt>
                  </View>
                )}
                {locked && (
                  <View style={{ position: 'absolute', top: 12, right: 12, opacity: 0.7 }}>
                    <NavIcon name="lock" color={W.text2} size={18} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Your characters */}
        <SectionHeader marginTop={24}>Your characters</SectionHeader>
        <View style={{ paddingHorizontal: 20 }}>
          {locked ? (
            <View style={{ backgroundColor: W.surface1, borderRadius: 16, padding: 16, gap: 10 }}>
              <Txt font="user" style={{ fontSize: 14, color: W.text, lineHeight: 20 }}>Upgrade to Plus to create custom characters.</Txt>
              <Pressable onPress={() => go('paywall')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Txt font="user" style={{ fontSize: 13, color: W.secondary }}>See plans</Txt>
                <NavIcon name="right" color={W.secondary} size={18} />
              </Pressable>
            </View>
          ) : characters.length === 0 ? (
            <Pressable
              onPress={openCreator}
              style={{ borderWidth: 1.5, borderColor: W.surface2, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center', gap: 8 }}
            >
              <NavIcon name="plus" color={W.text2} />
              <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Create a character</Txt>
            </Pressable>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {characters.map(c => (
                <View key={c.id} style={{ width: '48%', backgroundColor: W.surface1, borderRadius: 16, padding: 14 }}>
                  <Avatar color={W.secondary} size={40} />
                  <Txt font="user" weight={500} style={{ marginTop: 10, fontSize: 14, color: W.text }}>{c.name}</Txt>
                  <Txt font="user" style={{ marginTop: 2, fontSize: 11, color: W.text2 }} numberOfLines={1}>{c.trait}</Txt>
                </View>
              ))}
              <Pressable
                onPress={openCreator}
                style={{ width: '48%', minHeight: 96, borderWidth: 1.5, borderColor: W.surface2, borderStyle: 'dashed', borderRadius: 16, padding: 14, alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <NavIcon name="plus" color={W.text2} />
                <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>Add</Txt>
              </Pressable>
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

// ─── S16 SCENARIO SETUP ──────────────────────────────────────────────────
interface FieldDef { f1: string | null; ph: string; f2: string[] | null; f3: string[] | null; }
const FIELD_MAP: Record<string, FieldDef> = {
  interview: { f1: 'Role', ph: 'Software Engineer', f2: ['Startup', 'Corporate', 'Agency'], f3: ['Behavioral', 'Technical', 'Case'] },
  difficult: { f1: 'Who are you talking to?', ph: 'My manager', f2: ['Aggressive', 'Passive', 'Dismissive', 'Emotional'], f3: null },
  debate: { f1: 'Topic', ph: 'Remote work', f2: null, f3: null },
  story: { f1: 'Your role', ph: 'A reluctant hero', f2: ['Fantasy', 'Sci-fi', 'Thriller', 'Romance', 'Horror'], f3: null },
  language: { f1: null, ph: '', f2: ['Spanish', 'French', 'German', 'Japanese'], f3: ['Beginner', 'Intermediate', 'Advanced'] },
};

export function S16_ScenarioSetup({ go, scenario, onStart }: { go: Go; scenario: Scenario; onStart: () => void }) {
  const [gender, setGender] = useState<'male' | 'female' | 'neutral'>('female');
  const [voice, setVoice] = useState('Sage');
  const [field1, setField1] = useState('');
  const [field2, setField2] = useState<string | null>(null);
  const [field3, setField3] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  const fields = FIELD_MAP[scenario.id];

  const f2Label = scenario.id === 'difficult' ? 'Their personality'
    : scenario.id === 'interview' ? 'Company type'
    : scenario.id === 'story' ? 'Genre' : 'Language';
  const f3Label = scenario.id === 'interview' ? 'Style' : 'Level';

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => go('studio')}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: alpha(scenario.accent, '26'), alignItems: 'center', justifyContent: 'center' }}>
              <NavIcon name={scenario.icon as IconName} color={scenario.accent} size={14} />
            </View>
            <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>{scenario.name}</Txt>
          </View>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 20 }}>
        <View>
          <FieldLabel>Voice gender</FieldLabel>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {(['male', 'female', 'neutral'] as const).map(g => (
              <Pill key={g} active={gender === g} onPress={() => setGender(g)} style={{ flex: 1, height: 38 }} textStyle={{ fontSize: 13, textTransform: 'capitalize' }}>{g}</Pill>
            ))}
          </View>
        </View>
        <View>
          <FieldLabel>Voice</FieldLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {VOICES[gender].map(v => (
              <Pressable
                key={v.n}
                onPress={() => setVoice(v.n)}
                style={{ width: '31.5%', backgroundColor: W.surface1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 4, borderWidth: voice === v.n ? 2 : 0, borderColor: W.accent }}
              >
                <Waveform color={W.primary} size={24} />
                <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text }}>{v.n}</Txt>
              </Pressable>
            ))}
          </View>
        </View>
        {fields.f1 && (
          <View>
            <FieldLabel>{fields.f1}</FieldLabel>
            <TextInput
              value={field1}
              onChangeText={setField1}
              placeholder={fields.ph}
              placeholderTextColor={W.text2}
              style={{ backgroundColor: W.surface1, color: W.text, borderWidth: 1, borderColor: W.surface2, height: 44, borderRadius: 12, paddingHorizontal: 14, fontFamily: 'Outfit_400Regular', fontSize: 14 }}
            />
          </View>
        )}
        {fields.f2 && (
          <View>
            <FieldLabel>{f2Label}</FieldLabel>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {fields.f2.map(opt => (
                <Pill key={opt} active={field2 === opt} onPress={() => setField2(opt)} style={{ height: 36 }} textStyle={{ fontSize: 13 }}>{opt}</Pill>
              ))}
            </View>
          </View>
        )}
        {fields.f3 && (
          <View>
            <FieldLabel>{f3Label}</FieldLabel>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {fields.f3.map(opt => (
                <Pill key={opt} active={field3 === opt} onPress={() => setField3(opt)} style={{ flex: 1, height: 36 }} textStyle={{ fontSize: 13 }}>{opt}</Pill>
              ))}
            </View>
          </View>
        )}
        {/* Memory toggle */}
        <View style={{ marginTop: 4, borderRadius: 14, padding: 14, paddingLeft: 16, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(124,114,255,0.10)', backgroundColor: 'rgba(26,29,46,0.55)' }}>
          <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: remember ? alpha(W.accent, '1f') : 'rgba(139,143,163,0.10)', alignItems: 'center', justifyContent: 'center' }}>
            <NavIcon name="sparkle" color={remember ? W.accent : W.text2} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Remember this session</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2, lineHeight: 15, marginTop: 2 }}>
              {remember ? `Your ${scenario.name} will remember everything across sessions.` : 'One-time session. Nothing will be saved.'}
            </Txt>
          </View>
          <Toggle value={remember} onChange={setRemember} />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 }}>
        <PrimaryButton onPress={onStart} style={{ backgroundColor: scenario.accent }}>Start session</PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S17 ACTIVE STUDIO SESSION ───────────────────────────────────────────
type SMsg = { from: string; text: string; memoryRefs?: string[] };

export function S17_StudioSession({ go, scenario, onEnd, sessionN = 4, memoryCount = 12 }: { go: Go; scenario: Scenario; onEnd?: () => void; sessionN?: number; memoryCount?: number }) {
  const [msgs, setMsgs] = useState<SMsg[]>([
    { from: 'comp', text: `Welcome back. Last time you struggled with the "tell me about a time you failed" question. Let's try that one again — I think you'll do better this time.`, memoryRefs: ['"tell me about a time you failed" question'] },
    { from: 'user', text: "Okay, let's do it." },
    { from: 'comp', text: 'Great. So — tell me about a time you failed and what you learned from it.' },
  ]);
  const [draft, setDraft] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [msgs]);

  const send = () => {
    if (!draft.trim()) return;
    setMsgs(m => [...m, { from: 'user', text: draft.trim() }]);
    setDraft('');
    setTimeout(() => setMsgs(m => [...m, { from: 'comp', text: "That's a solid answer. Notice how you used the STAR format this time — situation, task, action, result. You weren't doing that two sessions ago.", memoryRefs: ["You weren't doing that two sessions ago"] }]), 1400);
  };

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => go('studio')}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="comp" weight={600} style={{ fontSize: 15, color: W.text }}>{scenario.name}</Txt>}
        right={<Pressable onPress={() => setShowSummary(true)}><Txt font="user" weight={500} style={{ fontSize: 13, color: W.danger }}>End</Txt></Pressable>}
        bg="rgba(15,17,26,0.55)"
        border
      />
      {/* context banner */}
      <View style={{ marginHorizontal: 16, marginTop: 10, marginBottom: 6, borderRadius: 10, padding: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, overflow: 'hidden', borderWidth: 1, borderColor: alpha(scenario.accent, '1f'), borderLeftWidth: 2, borderLeftColor: scenario.accent, backgroundColor: 'rgba(26,29,46,0.55)' }}>
        <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <Txt font="user" style={{ flex: 1, fontSize: 12, color: W.text2 }} numberOfLines={1}>Playing: Interviewer at a tech startup</Txt>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <NavIcon name="sparkle" color={W.accent} size={14} />
          <Txt font="user" style={{ fontSize: 11, color: W.accent }}>Session {sessionN} · {memoryCount} memories</Txt>
        </View>
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {msgs.map((m, i) => (
          <BubbleMem key={i} from={m.from} text={m.text} memoryRefs={m.memoryRefs || []} accent={scenario.accent} />
        ))}
      </ScrollView>
      <ChatInput draft={draft} setDraft={setDraft} onSend={send} companionName={scenario.name} />
      {showSummary && (
        <StudioSummary scenario={scenario} sessionN={sessionN} memoryCount={memoryCount} onClose={() => { setShowSummary(false); go('studio'); }} />
      )}
    </Screen>
  );
}

function StudioSummary({ scenario, sessionN, memoryCount, onClose }: { scenario: Scenario; sessionN: number; memoryCount: number; onClose: () => void }) {
  const [newMemories, setNewMemories] = useState([
    { id: 1, text: 'User uses STAR format consistently in behavioral questions now.' },
    { id: 2, text: 'User tends to rush answers when nervous about technical specifics.' },
    { id: 3, text: 'User prefers practicing with startup-style behavioral over technical.' },
  ]);
  return (
    <SheetOverlay onClose={onClose}>
      <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
      <Txt font="comp" weight={600} style={{ fontSize: 18, color: W.text }}>Session summary</Txt>
      <Txt font="user" style={{ marginTop: 4, fontSize: 12, color: W.text2 }}>Session {sessionN} · {scenario.name}</Txt>

      <View style={{ marginTop: 14, gap: 2 }}>
        <Txt font="user" style={{ fontSize: 13, color: W.text, lineHeight: 20 }}>• Walked through 2 behavioral scenarios with confidence</Txt>
        <Txt font="user" style={{ fontSize: 13, color: W.text, lineHeight: 20 }}>• First clean STAR-format answer on "tell me about a failure"</Txt>
        <Txt font="user" style={{ fontSize: 13, color: W.text, lineHeight: 20 }}>• Lighter on quantified impact — try adding numbers next time</Txt>
      </View>

      {/* Coaching feedback */}
      <View style={{ marginTop: 16, padding: 14, borderRadius: 12, backgroundColor: 'rgba(37,40,54,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.04)', gap: 10 }}>
        <View>
          <Txt font="user" weight={600} style={{ fontSize: 11, color: W.accent, textTransform: 'uppercase', letterSpacing: 0.9 }}>What went well</Txt>
          <Txt font="user" style={{ marginTop: 4, fontSize: 13, color: W.text, lineHeight: 19 }}>Clean STAR format. Specific projects mentioned with timelines.</Txt>
        </View>
        <View>
          <Txt font="user" weight={600} style={{ fontSize: 11, color: W.challenger, textTransform: 'uppercase', letterSpacing: 0.9 }}>What to improve</Txt>
          <Txt font="user" style={{ marginTop: 4, fontSize: 13, color: W.text, lineHeight: 19 }}>Quantify impact with numbers. Practice salary-negotiation prompts.</Txt>
        </View>
      </View>

      {/* Memories from this session */}
      <View style={{ marginTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <NavIcon name="sparkle" color={W.accent} size={14} />
          <Txt font="user" weight={600} style={{ fontSize: 11, color: W.accent, textTransform: 'uppercase', letterSpacing: 0.9 }}>Memories from this session</Txt>
        </View>
        <View style={{ gap: 6 }}>
          {newMemories.map(m => (
            <View key={m.id} style={{ backgroundColor: 'rgba(94,234,212,0.06)', borderWidth: 1, borderColor: 'rgba(94,234,212,0.15)', borderRadius: 10, padding: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Txt font="user" style={{ flex: 1, fontSize: 13, color: W.text, lineHeight: 18 }}>{m.text}</Txt>
              <Pressable onPress={() => setNewMemories(ms => ms.filter(x => x.id !== m.id))} style={{ padding: 2, opacity: 0.6 }}>
                <NavIcon name="close" color={W.text2} size={18} />
              </Pressable>
            </View>
          ))}
        </View>
        <Txt font="user" style={{ marginTop: 8, fontSize: 11, color: W.text2 }}>Total memories with {scenario.name}: {memoryCount + newMemories.length}</Txt>
      </View>

      <View style={{ marginTop: 18, flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={onClose} style={{ flex: 1, height: 44, backgroundColor: W.accentDim, borderWidth: 1, borderColor: 'rgba(94,234,212,0.20)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Txt font="user" weight={500} style={{ fontSize: 14, color: W.accent }}>Save & close</Txt>
        </Pressable>
        <Pressable onPress={onClose} style={{ flex: 1, height: 44, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Practice again</Txt>
        </Pressable>
      </View>
    </SheetOverlay>
  );
}

// ─── S18 CHARACTER CREATOR ───────────────────────────────────────────────
const SLIDERS = [
  { k: 'warmth', l: 'Warmth', left: '❄️', right: '☀️' },
  { k: 'humor', l: 'Humor', left: '😐', right: '😂' },
  { k: 'directness', l: 'Directness', left: '🌊', right: '🎯' },
  { k: 'energy', l: 'Energy', left: '🌙', right: '⚡' },
  { k: 'formality', l: 'Formality', left: '👕', right: '👔' },
] as const;
const STEP_TITLES = ['', 'The Basics', 'Their Personality', 'Who Are They?', 'Test Them Out'];

export function S18_CharacterCreator({ go, onSave }: { go: Go; onSave: (c: Character) => void }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | 'neutral'>('female');
  const [voice, setVoice] = useState('Sage');
  const [traits, setTraits] = useState<Record<string, number>>({ warmth: 0.6, humor: 0.5, directness: 0.5, energy: 0.4, formality: 0.3 });
  const [backstory, setBackstory] = useState('');

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => (step === 1 ? go('studio') : setStep(s => s - 1))}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="user" style={{ fontSize: 13, color: W.text2 }}>{STEP_TITLES[step]}</Txt>}
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingVertical: 12, gap: 20 }}>
        {step === 1 && (
          <>
            <View>
              <FieldLabel>Name</FieldLabel>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Marcus"
                placeholderTextColor={W.text2}
                style={{ backgroundColor: W.surface1, color: W.text, borderWidth: 1, borderColor: W.surface2, height: 52, borderRadius: 14, paddingHorizontal: 16, fontFamily: 'Manrope_500Medium', fontSize: 18, textAlign: 'center' }}
              />
            </View>
            <View>
              <FieldLabel>Voice gender</FieldLabel>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['male', 'female', 'neutral'] as const).map(g => (
                  <Pill key={g} active={gender === g} onPress={() => setGender(g)} style={{ flex: 1, height: 38 }} textStyle={{ fontSize: 13, textTransform: 'capitalize' }}>{g}</Pill>
                ))}
              </View>
            </View>
            <View>
              <FieldLabel>Voice</FieldLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {VOICES[gender].map(v => (
                  <Pressable key={v.n} onPress={() => setVoice(v.n)} style={{ width: '31.5%', backgroundColor: W.surface1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 4, borderWidth: voice === v.n ? 2 : 0, borderColor: W.accent }}>
                    <Waveform color={W.primary} size={24} />
                    <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text }}>{v.n}</Txt>
                  </Pressable>
                ))}
              </View>
            </View>
          </>
        )}
        {step === 2 && (
          <View style={{ gap: 18 }}>
            {SLIDERS.map(s => (
              <View key={s.k}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <Txt font="user" weight={500} style={{ fontSize: 13, color: W.text }}>{s.l}</Txt>
                  <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{Math.round(traits[s.k] * 100)}</Txt>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Txt font="user" style={{ fontSize: 18 }}>{s.left}</Txt>
                  <View style={{ flex: 1 }}>
                    <TraitSlider value={traits[s.k]} onChange={(v) => setTraits(t => ({ ...t, [s.k]: v }))} />
                  </View>
                  <Txt font="user" style={{ fontSize: 18 }}>{s.right}</Txt>
                </View>
              </View>
            ))}
          </View>
        )}
        {step === 3 && (
          <View>
            <FieldLabel>Backstory (optional)</FieldLabel>
            <TextInput
              value={backstory}
              onChangeText={(t) => setBackstory(t.slice(0, 500))}
              placeholder="A laid-back surfer who gives surprisingly deep life advice…"
              placeholderTextColor={W.text2}
              multiline
              style={{ backgroundColor: W.surface1, color: W.text, borderWidth: 1, borderColor: W.surface2, height: 140, borderRadius: 14, padding: 14, fontFamily: 'Outfit_400Regular', fontSize: 14, lineHeight: 21, textAlignVertical: 'top' }}
            />
            <Txt font="user" style={{ marginTop: 6, textAlign: 'right', fontSize: 11, color: W.text2 }}>{backstory.length}/500</Txt>
          </View>
        )}
        {step === 4 && (
          <>
            <Txt font="user" style={{ fontSize: 13, color: W.text2, lineHeight: 20 }}>Test {name || 'them'} out. Type something and hear how they respond.</Txt>
            <View style={{ backgroundColor: W.surface1, borderRadius: 12, padding: 12, gap: 8 }}>
              <BubbleMem from="user" text="Hey, can you give me a quick pep talk?" />
              <BubbleMem from="comp" text={`Yeah man, here it is — you've already won by showing up. Now ride it.`} />
            </View>
          </>
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 }}>
        {step < 4 ? (
          <PrimaryButton disabled={step === 1 && !name.trim()} onPress={() => setStep(s => s + 1)}>Next</PrimaryButton>
        ) : (
          <PrimaryButton onPress={() => { onSave({ id: Date.now(), name, trait: backstory.slice(0, 40) || 'Custom character' }); go('studio'); }}>
            Create {name || 'character'}
          </PrimaryButton>
        )}
      </View>
    </Screen>
  );
}

// Draggable trait slider (replaces <input type=range>). Track + fill + thumb.
function TraitSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const onLayout = (e: LayoutChangeEvent) => { widthRef.current = e.nativeEvent.layout.width; setWidth(e.nativeEvent.layout.width); };
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const w = widthRef.current;
        if (w > 0) onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / w)));
      },
      onPanResponderMove: (e) => {
        const w = widthRef.current;
        if (w > 0) onChange(Math.max(0, Math.min(1, e.nativeEvent.locationX / w)));
      },
    }),
  ).current;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View onLayout={onLayout} {...pan.panHandlers} style={{ height: 20, justifyContent: 'center' }}>
      <View style={{ height: 4, backgroundColor: W.surface2, borderRadius: 2 }}>
        <View style={{ position: 'absolute', left: 0, top: 0, height: 4, width: `${pct * 100}%`, backgroundColor: W.primary, borderRadius: 2 }} />
      </View>
      <View
        style={{
          position: 'absolute', left: Math.max(0, pct * width - 8), top: 2,
          width: 16, height: 16, borderRadius: 8, backgroundColor: W.primary,
          shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, shadowOffset: { width: 0, height: 1 },
        }}
      />
    </View>
  );
}

// Shared bottom-sheet overlay used by studio summary (+ reused pattern elsewhere).
export function SheetOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, { toValue: 1, duration: 450, easing: Easing.bezier(0.34, 1.05, 0.64, 1), useNativeDriver: true }).start();
  }, []);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [400, 0] });
  return (
    <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 30, justifyContent: 'flex-end' }}>
      <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,17,26,0.55)' }}>
        <BlurView intensity={8} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      </Pressable>
      <Animated.View style={{ transform: [{ translateY }], maxHeight: '85%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }}>
        <LinearGradient colors={['rgba(37,40,54,0.95)', 'rgba(15,17,26,0.95)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <BlurView intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}
