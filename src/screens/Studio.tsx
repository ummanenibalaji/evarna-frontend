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
import { SCENARIOS, Scenario, Tier } from '../data/config';
import {
  ApiGender, ApiMemory, ApiScenario, ApiStudioCharacter, ApiVoice,
  createStudioCharacter, deleteMemory, endSession, getCharacterSessions,
  getConversationTurns, getMemories, startSession,
} from '../api';
import { ApiError, streamConversation } from '../api/client';
import { formatLastInteraction } from './Home';
import { Go } from '../navigation/types';

// The UI keeps male/female/neutral; the backend enum only knows nonbinary.
type StudioGender = 'male' | 'female' | 'neutral';
const API_GENDER: Record<StudioGender, ApiGender> = { male: 'male', female: 'female', neutral: 'nonbinary' };

// The backend voice catalog is tagged male/female only, so 'neutral' offers all of them.
const voicesFor = (voices: ApiVoice[], g: StudioGender) =>
  g === 'neutral' ? voices : voices.filter(v => v.gender === g);

// ponytail: ApiError keeps the backend's `code` but drops the 400 body's `field`,
// so validation errors read generically. Widen ApiError if per-field highlighting matters.
function createErrorMessage(e: unknown): string {
  const code = e instanceof ApiError ? e.code : undefined;
  if (code === 'STUDIO_LIMIT_REACHED') return "You've hit your Studio character limit. Delete one to make room.";
  if (code === 'VALIDATION_ERROR') return 'The server rejected one of these fields. Check them and try again.';
  return "Couldn't reach the server. Check your connection and try again.";
}

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

function ErrorNote({ children }: { children: React.ReactNode }) {
  return <Txt font="user" style={{ fontSize: 12, color: W.danger, lineHeight: 17 }}>{children}</Txt>;
}

// Voice grid shared by S16 and S18. Ids are backend voice UUIDs, exactly like S07_Voice.
function VoicePicker({ voices, voiceId, onPick }: { voices: ApiVoice[]; voiceId: string | null; onPick: (id: string) => void }) {
  if (voices.length === 0) return <ErrorNote>Voices unavailable — check your connection.</ErrorNote>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {voices.map(v => (
        <Pressable
          key={v.id}
          onPress={() => onPick(v.id)}
          style={{ width: '31.5%', backgroundColor: W.surface1, borderRadius: 12, padding: 10, alignItems: 'center', gap: 4, borderWidth: voiceId === v.id ? 2 : 0, borderColor: W.accent }}
        >
          <Waveform color={W.primary} size={24} />
          <Txt font="user" weight={500} style={{ fontSize: 12, color: W.text }} numberOfLines={1}>{v.name}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

// ─── S15 STUDIO HOME ─────────────────────────────────────────────────────
interface StudioHomeProps {
  go: Go;
  tier: Tier;
  characters: ApiStudioCharacter[];
  setupScenario: (s: Scenario) => void;
  openCreator: () => void;
  resumeConvo: (c: ApiStudioCharacter) => void;
}

// Icon + accent are local styling — the backend only names the scenario.
const studioLook = (c: ApiStudioCharacter) =>
  SCENARIOS.find(s => s.id === c.scenario_id) ?? { icon: 'sparkle', accent: W.secondary };

export function S15_StudioHome({ go, tier, characters, setupScenario, openCreator, resumeConvo }: StudioHomeProps) {
  const locked = tier === 'free';
  // "Continue" is every studio character that has actually been talked to.
  const activeConvos = characters.filter(c => !!c.last_interaction_at);
  const startedScenarios = new Set(characters.map(c => c.scenario_id).filter(Boolean));
  const customs = characters.filter(c => c.kind === 'custom');

  return (
    <Screen>
      <TopBar
        left={<Txt font="display" weight={700} style={{ fontSize: 22, color: W.text }}>Studio</Txt>}
        right={
          <Pressable onPress={() => (locked ? go('paywall') : openCreator())} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <NavIcon name="plus" color={W.accent} size={18} />
            <Txt font="user" weight={500} style={{ fontSize: 13, color: W.accent }}>Create</Txt>
          </Pressable>
        }
      />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }}>
        {/* CONTINUE — active conversations. The list endpoint has no message
            preview, so that line is dropped rather than filled with filler. */}
        {!locked && activeConvos.length > 0 && (
          <>
            <SectionHeader>Continue</SectionHeader>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingHorizontal: 20 }}
            >
              {activeConvos.map(c => {
                const look = studioLook(c);
                return (
                  <Pressable
                    key={c._id}
                    onPress={() => resumeConvo(c)}
                    style={{
                      width: 220, borderRadius: 16, padding: 14, gap: 8, overflow: 'hidden',
                      borderWidth: 1, borderColor: alpha(look.accent, '26'), backgroundColor: 'rgba(32,22,26,0.55)',
                    }}
                  >
                    <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: alpha(look.accent, '1f'), borderWidth: 1, borderColor: alpha(look.accent, '40'), alignItems: 'center', justifyContent: 'center' }}>
                        <NavIcon name={look.icon as IconName} color={look.accent} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Txt font="user" weight={600} style={{ fontSize: 14, color: W.text }} numberOfLines={1}>{c.name}</Txt>
                        <Txt font="user" style={{ fontSize: 11, color: W.text2 }}>{formatLastInteraction(c.last_interaction_at)}</Txt>
                      </View>
                    </View>
                    {!!c.total_sessions && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <NavIcon name="sparkle" color={W.accent} size={14} />
                        <Txt font="user" style={{ fontSize: 11, color: W.accent }}>
                          {c.total_sessions} {c.total_sessions === 1 ? 'session' : 'sessions'}
                        </Txt>
                      </View>
                    )}
                  </Pressable>
                );
              })}
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
                    const existing = characters.find(c => c.scenario_id === s.id);
                    if (existing) return resumeConvo(existing);
                  }
                  setupScenario(s);
                }}
                style={{
                  width: 160, height: 200, borderRadius: 18, padding: 16, overflow: 'hidden',
                  justifyContent: 'space-between',
                  borderWidth: 1, borderColor: alpha(s.accent, '1f'), backgroundColor: 'rgba(32,22,26,0.55)',
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

        {/* Your characters — custom ones only; the scenario characters live in
            the row above. The list endpoint returns no backstory, so the old
            one-line trait is dropped. */}
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
          ) : customs.length === 0 ? (
            <Pressable
              onPress={openCreator}
              style={{ borderWidth: 1.5, borderColor: W.surface2, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 24, paddingHorizontal: 16, alignItems: 'center', gap: 8 }}
            >
              <NavIcon name="plus" color={W.text2} />
              <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Create a character</Txt>
            </Pressable>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              {customs.map(c => (
                <Pressable key={c._id} onPress={() => resumeConvo(c)} style={{ width: '48%', backgroundColor: W.surface1, borderRadius: 16, padding: 14 }}>
                  <Avatar name={c.name} color={W.secondary} size={40} />
                  <Txt font="user" weight={500} style={{ marginTop: 10, fontSize: 14, color: W.text }} numberOfLines={1}>{c.name}</Txt>
                </Pressable>
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
// The form is rendered from GET /studio/scenarios: the server owns the param
// definitions and the persona that consumes them, so there is nothing to drift.
export function S16_ScenarioSetup({ go, scenario, def, apiVoices = [], onStart }: {
  go: Go;
  scenario: Scenario;
  def?: ApiScenario;
  apiVoices?: ApiVoice[];
  onStart: (characterId: string, remember: boolean) => void;
}) {
  const [gender, setGender] = useState<StudioGender>('female');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  // Handed up with the character id; S17 owns the session, so it passes this
  // to startSession rather than S16 starting one just to carry the flag.
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const voiceList = voicesFor(apiVoices, gender);
  const pickedVoice = voiceList.some(v => v.id === voiceId) ? voiceId : voiceList[0]?.id ?? null;
  const missingRequired = (def?.params ?? []).some(p => p.required && !(params[p.key] ?? '').trim());

  const start = async () => {
    if (!def || !pickedVoice) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await createStudioCharacter({
        kind: 'scenario',
        scenario_id: def.id,
        params,
        voice_id: pickedVoice,
        gender: API_GENDER[gender],
      });
      onStart(res.character_id, remember);
    } catch (e) {
      console.warn('[Studio] scenario character create failed:', e);
      setErr(createErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => go('studio')}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: alpha(scenario.accent, '26'), alignItems: 'center', justifyContent: 'center' }}>
              <NavIcon name={scenario.icon as IconName} color={scenario.accent} size={14} />
            </View>
            <Txt font="comp" weight={600} style={{ fontSize: 16, color: W.text }}>{def?.name ?? scenario.name}</Txt>
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
          <VoicePicker voices={voiceList} voiceId={pickedVoice} onPick={setVoiceId} />
        </View>
        {def ? def.params.map(p => (
          <View key={p.key}>
            <FieldLabel>{p.label}</FieldLabel>
            {p.type === 'choice' ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(p.options ?? []).map(opt => (
                  <Pill
                    key={opt}
                    active={params[p.key] === opt}
                    onPress={() => setParams(v => ({ ...v, [p.key]: opt }))}
                    style={{ height: 36 }}
                    textStyle={{ fontSize: 13 }}
                  >{opt}</Pill>
                ))}
              </View>
            ) : (
              <TextInput
                value={params[p.key] ?? ''}
                onChangeText={(v) => setParams(s => ({ ...s, [p.key]: v }))}
                placeholder={p.placeholder}
                placeholderTextColor={W.text2}
                style={{ backgroundColor: W.surface1, color: W.text, borderWidth: 1, borderColor: W.surface2, height: 44, borderRadius: 12, paddingHorizontal: 14, fontFamily: 'Outfit_400Regular', fontSize: 14 }}
              />
            )}
          </View>
        )) : (
          <Txt font="user" style={{ fontSize: 13, color: W.text2 }}>Loading setup…</Txt>
        )}
        {/* Memory toggle — sent as `remember` on POST /sessions/start. Off means
            the backend skips memory extraction when the session ends. */}
        <View style={{ marginTop: 4, borderRadius: 14, padding: 14, paddingLeft: 16, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,138,118,0.10)', backgroundColor: 'rgba(32,22,26,0.55)' }}>
          <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
          <View style={{ width: 32, height: 32, borderRadius: 10, backgroundColor: remember ? alpha(W.accent, '1f') : 'rgba(139,143,163,0.10)', alignItems: 'center', justifyContent: 'center' }}>
            <NavIcon name="sparkle" color={remember ? W.accent : W.text2} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Remember this session</Txt>
            <Txt font="user" style={{ fontSize: 11, color: W.text2, lineHeight: 15, marginTop: 2 }}>
              {remember
                ? `Your ${def?.name ?? scenario.name} will remember this across sessions.`
                : 'One-time session. Nothing from it is saved to memory.'}
            </Txt>
          </View>
          <Toggle value={remember} onChange={setRemember} />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 10 }}>
        {err && <ErrorNote>{err}</ErrorNote>}
        <PrimaryButton
          disabled={!def || !pickedVoice || missingRequired || busy}
          onPress={start}
          style={{ backgroundColor: scenario.accent }}
        >
          {busy ? 'Starting…' : 'Start session'}
        </PrimaryButton>
      </View>
    </Screen>
  );
}

// ─── S17 ACTIVE STUDIO SESSION ───────────────────────────────────────────
// Same wiring as S14_Chat: one backend text session, SSE replies, session ended
// on unmount. A studio character is just a character, so the endpoints match.
type SMsg = { from: string; text: string; streaming?: boolean };

export function S17_StudioSession({ go, scenario, characterId, totalSessions = 0, remember }: {
  go: Go; scenario: Scenario; characterId?: string; totalSessions?: number; remember?: boolean;
}) {
  const [msgs, setMsgs] = useState<SMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [showSummary, setShowSummary] = useState(false);
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Typed before the session id landed — streamed the moment it does.
  const pendingRef = useRef<string | null>(null);

  const finishStreaming = (patch: Partial<SMsg>) => {
    setMsgs(m => {
      const updated = [...m];
      const last = updated[updated.length - 1];
      if (last?.streaming) updated[updated.length - 1] = { ...last, ...patch, streaming: false };
      return updated;
    });
  };

  const runTurn = (sid: string, text: string) => {
    abortRef.current?.abort();
    abortRef.current = streamConversation(
      { session_id: sid, message: text },
      {
        onChunk: (content) => {
          setMsgs(m => {
            const updated = [...m];
            const last = updated[updated.length - 1];
            if (last?.streaming) updated[updated.length - 1] = { ...last, text: last.text + content };
            return updated;
          });
        },
        onDone: () => finishStreaming({}),
        onCrisis: () => { finishStreaming({}); go('crisis'); },
        onError: (e) => {
          console.warn('[Studio] stream error:', e);
          finishStreaming({ text: "(Couldn't reach the server — please try again.)" });
        },
      },
    );
  };

  useEffect(() => {
    if (sessionId && pendingRef.current) {
      const text = pendingRef.current;
      pendingRef.current = null;
      runTurn(sessionId, text);
    }
  }, [sessionId]);

  useEffect(() => {
    if (!characterId) return;
    let mounted = true;
    startSession(characterId, 'text', remember)
      .then(res => {
        if (!mounted) return;
        setSessionId(res.session_id);
        sessionRef.current = res.session_id;
      })
      .catch(e => {
        console.warn('[Studio] session start failed:', e);
        if (!mounted) return;
        if (pendingRef.current) {
          pendingRef.current = null;
          finishStreaming({ text: "(Couldn't reach the server — please try again.)" });
        }
      });
    return () => {
      mounted = false;
      abortRef.current?.abort();
      if (sessionRef.current) {
        endSession(sessionRef.current).catch(() => {});
        sessionRef.current = null;
      }
    };
  }, [characterId, remember]);

  // Resume where the user left off: newest session that actually has turns.
  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;
    (async () => {
      try {
        const { sessions } = await getCharacterSessions(characterId);
        for (const s of sessions) {
          const { turns } = await getConversationTurns(s._id);
          if (cancelled) return;
          if (turns.length === 0) continue;
          setMsgs(turns.map(t => ({ from: t.role === 'user' ? 'user' : 'comp', text: t.content_text })));
          return;
        }
      } catch { /* no history — start clean */ }
    })();
    return () => { cancelled = true; };
  }, [characterId]);

  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;
    getMemories(characterId)
      .then(ms => { if (!cancelled) setMemoryCount(ms.length); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [characterId]);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [msgs]);

  const send = () => {
    if (!draft.trim() || !characterId) return;
    const text = draft.trim();
    setMsgs(m => [...m, { from: 'user', text }, { from: 'comp', text: '', streaming: true }]);
    setDraft('');
    if (sessionRef.current) runTurn(sessionRef.current, text);
    else pendingRef.current = text;
  };

  return (
    <Screen>
      <TopBar
        left={<Pressable onPress={() => go('studio')}><NavIcon name="back" color={W.text2} /></Pressable>}
        center={<Txt font="comp" weight={600} style={{ fontSize: 15, color: W.text }}>{scenario.name}</Txt>}
        right={<Pressable onPress={() => setShowSummary(true)}><Txt font="user" weight={500} style={{ fontSize: 13, color: W.danger }}>End</Txt></Pressable>}
        bg="rgba(24,16,20,0.55)"
        border
      />
      {/* context banner — the old "Playing: …" line had no backend source, so it's gone */}
      <View style={{ marginHorizontal: 16, marginTop: 10, marginBottom: 6, borderRadius: 10, padding: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, overflow: 'hidden', borderWidth: 1, borderColor: alpha(scenario.accent, '1f'), borderLeftWidth: 2, borderLeftColor: scenario.accent, backgroundColor: 'rgba(32,22,26,0.55)' }}>
        <BlurView intensity={20} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <NavIcon name="sparkle" color={W.accent} size={14} />
        <Txt font="user" style={{ fontSize: 11, color: W.accent }}>
          Session {totalSessions + 1}{memoryCount != null ? ` · ${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}` : ''}
        </Txt>
      </View>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}>
        {msgs.map((m, i) => (
          <BubbleMem key={i} from={m.from} text={m.text} accent={scenario.accent} />
        ))}
      </ScrollView>
      <ChatInput draft={draft} setDraft={setDraft} onSend={send} companionName={scenario.name} />
      {showSummary && (
        <StudioSummary
          scenario={scenario}
          sessionN={totalSessions + 1}
          characterId={characterId}
          onContinue={() => setShowSummary(false)}
          onClose={() => { setShowSummary(false); go('studio'); }}
        />
      )}
    </Screen>
  );
}

// The prototype's bullet recap and coaching block had no backend source and are
// gone. What is real is the character's memory set — shown here, deletable.
function StudioSummary({ scenario, sessionN, characterId, onContinue, onClose }: {
  scenario: Scenario; sessionN: number; characterId?: string; onContinue: () => void; onClose: () => void;
}) {
  const [memories, setMemories] = useState<ApiMemory[] | null>(null);
  useEffect(() => {
    if (!characterId) { setMemories([]); return; }
    let cancelled = false;
    getMemories(characterId)
      .then(ms => { if (!cancelled) setMemories(ms); })
      .catch(() => { if (!cancelled) setMemories([]); });
    return () => { cancelled = true; };
  }, [characterId]);

  const forget = (id: string) => {
    setMemories(ms => (ms ?? []).filter(m => m._id !== id));
    deleteMemory(id).catch(e => console.warn('[Studio] memory delete failed:', e));
  };

  return (
    <SheetOverlay onClose={onClose}>
      <View style={{ width: 36, height: 4, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 2, alignSelf: 'center', marginBottom: 16 }} />
      <Txt font="comp" weight={600} style={{ fontSize: 18, color: W.text }}>Session summary</Txt>
      <Txt font="user" style={{ marginTop: 4, fontSize: 12, color: W.text2 }}>Session {sessionN} · {scenario.name}</Txt>

      <View style={{ marginTop: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <NavIcon name="sparkle" color={W.accent} size={14} />
          <Txt font="user" weight={600} style={{ fontSize: 11, color: W.accent, textTransform: 'uppercase', letterSpacing: 0.9 }}>What they remember</Txt>
        </View>
        <View style={{ gap: 6 }}>
          {(memories ?? []).map(m => (
            <View key={m._id} style={{ backgroundColor: 'rgba(255,201,96,0.06)', borderWidth: 1, borderColor: 'rgba(255,201,96,0.15)', borderRadius: 10, padding: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <Txt font="user" style={{ flex: 1, fontSize: 13, color: W.text, lineHeight: 18 }}>{m.content}</Txt>
              <Pressable onPress={() => forget(m._id)} style={{ padding: 2, opacity: 0.6 }}>
                <NavIcon name="close" color={W.text2} size={18} />
              </Pressable>
            </View>
          ))}
        </View>
        {memories?.length === 0 && (
          <Txt font="user" style={{ fontSize: 12, color: W.text2 }}>Nothing saved from this character yet.</Txt>
        )}
      </View>

      <View style={{ marginTop: 18, flexDirection: 'row', gap: 10 }}>
        <Pressable onPress={onClose} style={{ flex: 1, height: 44, backgroundColor: W.accentDim, borderWidth: 1, borderColor: 'rgba(255,201,96,0.20)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Txt font="user" weight={500} style={{ fontSize: 14, color: W.accent }}>Save & close</Txt>
        </Pressable>
        <Pressable onPress={onContinue} style={{ flex: 1, height: 44, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <Txt font="user" weight={500} style={{ fontSize: 14, color: W.text }}>Keep going</Txt>
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

export function S18_CharacterCreator({ go, apiVoices = [] }: { go: Go; apiVoices?: ApiVoice[] }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [gender, setGender] = useState<StudioGender>('female');
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [traits, setTraits] = useState<Record<string, number>>({ warmth: 0.6, humor: 0.5, directness: 0.5, energy: 0.4, formality: 0.3 });
  const [backstory, setBackstory] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const voiceList = voicesFor(apiVoices, gender);
  const pickedVoice = voiceList.some(v => v.id === voiceId) ? voiceId : voiceList[0]?.id ?? null;

  const create = async () => {
    if (!pickedVoice) return;
    setBusy(true);
    setErr(null);
    try {
      await createStudioCharacter({
        kind: 'custom',
        name: name.trim(),
        ...(backstory.trim() ? { backstory: backstory.trim() } : {}),
        voice_id: pickedVoice,
        gender: API_GENDER[gender],
        // Sliders are 0–1 floats here, 0–100 integers on the backend.
        personality_sliders: Object.fromEntries(
          Object.entries(traits).map(([k, v]) => [k, Math.round(v * 100)]),
        ),
      });
      go('studio');
    } catch (e) {
      console.warn('[Studio] custom character create failed:', e);
      setErr(createErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

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
              <VoicePicker voices={voiceList} voiceId={pickedVoice} onPick={setVoiceId} />
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
            {/* ponytail: canned preview. A live one needs the character created first,
                i.e. a create → session → stream round trip before the user commits —
                not a small diff. Wire it to POST /studio/characters + /sessions/start
                if the preview needs to be real. */}
            <Txt font="user" style={{ fontSize: 13, color: W.text2, lineHeight: 20 }}>Test {name || 'them'} out. Type something and hear how they respond.</Txt>
            <View style={{ backgroundColor: W.surface1, borderRadius: 12, padding: 12, gap: 8 }}>
              <BubbleMem from="user" text="Hey, can you give me a quick pep talk?" />
              <BubbleMem from="comp" text={`Yeah man, here it is — you've already won by showing up. Now ride it.`} />
            </View>
          </>
        )}
      </ScrollView>
      <View style={{ paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 10 }}>
        {err && <ErrorNote>{err}</ErrorNote>}
        {step < 4 ? (
          <PrimaryButton disabled={step === 1 && (!name.trim() || !pickedVoice)} onPress={() => setStep(s => s + 1)}>Next</PrimaryButton>
        ) : (
          <PrimaryButton disabled={busy || !pickedVoice} onPress={create}>
            {busy ? 'Creating…' : `Create ${name || 'character'}`}
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
      <Pressable onPress={onClose} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(24,16,20,0.55)' }}>
        <BlurView intensity={8} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      </Pressable>
      <Animated.View style={{ transform: [{ translateY }], maxHeight: '85%', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.10)' }}>
        <LinearGradient colors={['rgba(48,32,40,0.95)', 'rgba(24,16,20,0.95)']} style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <BlurView intensity={36} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
        <ScrollView contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 24, paddingBottom: 24 }}>
          {children}
        </ScrollView>
      </Animated.View>
    </View>
  );
}
