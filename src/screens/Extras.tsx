// Extras.tsx — S25 notification ask, S26 companion profile, S27 out-of-minutes
// sheet, S28 crisis resources, S29 session recap and S30 sign-in, plus the
// crisis banner.
//
// Crisis numbers come from data/crisis.ts, chosen for the region the phone is
// in. Nothing here hard-codes a hotline.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, TextInput, View,
  type NativeScrollEvent, type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector, ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Rect } from 'react-native-svg';

import { Screen, TopBar } from '../components/Chrome';
import { Txt } from '../components/Txt';
import { NavIcon, type IconName } from '../components/NavIcon';
import { Avatar } from '../components/Avatar';
import { Sheet, useSheet } from '../components/Sheet';
import {
  BackButton, ErrorState, GlassFill, IconButton, InlineNotice, PrimaryButton, Skeleton, SkeletonLines, minTarget,
} from '../components/Atoms';
import { ApiError, isNetworkError } from '../api/client';
import {
  deleteMemory, getCharacterSessions, getMemories, getSuggestion, resolveSuggestion,
  type ApiMemory, type ApiSession, type ApiSuggestion, type ApiVoice, type UpdateCharacterPayload,
} from '../api';
import { canOpenCrisisResource, crisisResources, openCrisisResource, type CrisisResource } from '../data/crisis';
import { legalDocs, openLegalDoc, type LegalDoc } from '../data/legal';
import { hasVoicePreview, useVoicePreview } from '../lib/voicePreview';
import { haptic } from '../lib/haptics';
import { announce } from '../hooks/useAccessibilityPrefs';
import { enter, exit, layout, spring, timing, usePressFeedback } from '../theme/motion';
import { ELEV, HIT, MOTION, R, resolveFont, rgba, SP, TYPE, W } from '../theme/theme';
import { Go, ScreenName } from '../navigation/types';
import { Companion, ARCHETYPE_COLORS, ARCHETYPE_LABEL, MEM_TYPES } from '../data/config';

// The inline crisis card lives with the chat components now; this keeps the
// name importable from here for anything that still reaches for it.
export { CrisisResourceCard } from '../components/CrisisResourceCard';

const D = MOTION.duration;
const FILL = StyleSheet.absoluteFillObject;
const ACROSS = { start: { x: 0, y: 0 }, end: { x: 1, y: 0 } } as const;

// A sheet finishes its exit before unmounting but doesn't say when, so a sheet
// that navigates on close waits this long, letting the exit play in full.
const SHEET_EXIT_MS = D.slow;

// ─── Shared helpers ─────────────────────────────────────────────────────────
function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return mounted;
}

/** The latest value, for callbacks that must keep a stable identity. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function isPromise(v: unknown): v is Promise<unknown> {
  return !!v && typeof (v as { then?: unknown }).then === 'function';
}

/** What failed, and the likely reason, in one plain sentence. */
function failureText(e: unknown, what: string): string {
  if (isNetworkError(e)) return `Couldn't ${what}. Check your connection and try again.`;
  if (e instanceof ApiError && e.status === 429) return `Couldn't ${what} just now. Try again in a minute.`;
  return `Couldn't ${what}. Please try again.`;
}

// ─── S25 — NOTIFICATION PERMISSION (companion-led ask) ──────────────────────
const SAMPLE_NOTIFICATION = "Hey, thinking of you. How's your day going?";

export function S25_NotifPermission({ go, companion, onAllow, onSkip, next = 'first-chat' }: {
  go: Go;
  companion: Companion;
  // The screen only navigates; App.tsx owns the permission prompt and the
  // token upload. Returning the prompt's promise keeps this screen up until
  // the system dialog has been answered.
  onAllow?: () => void | Promise<unknown>;
  onSkip?: () => void;
  /** Where both answers lead. */
  next?: ScreenName;
}) {
  const [asking, setAsking] = useState(false);
  const accent = ARCHETYPE_COLORS[companion.archetype] ?? W.primary;

  const allow = async () => {
    if (asking) return;
    setAsking(true);
    try {
      await onAllow?.();
    } catch {
      // A refused or failed prompt still moves on; Settings can change it later.
    }
    go(next);
  };

  const skip = () => {
    onSkip?.();
    go(next);
  };

  return (
    <Screen label="25 Notification Permission">
      <ScrollView contentContainerStyle={styles.notifBody} showsVerticalScrollIndicator={false}>
        <View style={styles.flexSpace} />
        <Avatar color={accent} size={80} />
        <Txt variant="title2" heading style={styles.notifTitle}>
          Can {companion.name} check in on you?
        </Txt>
        <Txt variant="callout" style={styles.notifSub}>
          Sometimes a quiet check-in is exactly what you need.
        </Txt>
        <NotificationPreview name={companion.name} />
        <Txt variant="footnote" style={styles.notifFoot}>
          This covers all your companions. You can turn check-ins off anytime in Settings.
        </Txt>
        <View style={styles.flexSpaceTall} />
      </ScrollView>
      <View style={styles.notifActions}>
        <PrimaryButton onPress={allow} loading={asking}>Yes, let them check in</PrimaryButton>
        <PrimaryButton variant="text" onPress={skip} disabled={asking}>Not now</PrimaryButton>
      </View>
    </Screen>
  );
}

// What a check-in looks like, in the shape of an iOS banner. Deliberately
// generic: a companion knows nothing about a brand-new user yet, so the
// sample doesn't pretend to remember anything.
function NotificationPreview({ name }: { name: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`Example notification from ${name}: ${SAMPLE_NOTIFICATION}`}
      style={styles.notifPreview}
    >
      <GlassFill intensity={24} solid={W.surface2} />
      <View style={styles.notifHead}>
        {/* The glyph sits in a fixed tile, like the real app icon it stands for. */}
        <View style={styles.appGlyph}>
          <Txt font="display" weight={700} maxScale={1} style={styles.appGlyphText}>e</Txt>
        </View>
        <Txt variant="footnote" weight={600} style={styles.notifApp}>Evarna</Txt>
        <Txt variant="caption" style={{ color: W.text2 }}>now</Txt>
      </View>
      <Txt variant="subhead" weight={600} numberOfLines={1} style={styles.notifFrom}>{name}</Txt>
      <Txt variant="subhead" style={styles.notifText}>{SAMPLE_NOTIFICATION}</Txt>
    </View>
  );
}

// ─── S26 — COMPANION PROFILE / EDIT ─────────────────────────────────────────
type TraitKey = 'warmth' | 'humor' | 'directness' | 'energy' | 'formality';
type Traits = Record<TraitKey, number>;
const TRAIT_KEYS: TraitKey[] = ['warmth', 'humor', 'directness', 'energy', 'formality'];

interface TraitSpec {
  k: TraitKey;
  label: string;
  /** How the trait reads in each third of the slider, low to high. */
  low: string;
  mid: string;
  high: string;
  lowMark: string;
  highMark: string;
}

const TRAITS: TraitSpec[] = [
  { k: 'warmth', label: 'Warmth', low: 'cool', mid: 'balanced', high: 'warm', lowMark: '❄️', highMark: '☀️' },
  { k: 'humor', label: 'Humor', low: 'serious', mid: 'easygoing', high: 'funny', lowMark: '😐', highMark: '😂' },
  { k: 'directness', label: 'Directness', low: 'gentle', mid: 'thoughtful', high: 'direct', lowMark: '🌊', highMark: '🎯' },
  { k: 'energy', label: 'Energy', low: 'calm', mid: 'steady', high: 'energetic', lowMark: '🌙', highMark: '⚡' },
  { k: 'formality', label: 'Formality', low: 'casual', mid: 'natural', high: 'formal', lowMark: '👕', highMark: '👔' },
];

// Where a slider's word changes. The slider ticks as it crosses one.
function traitZone(v: number): 0 | 1 | 2 {
  'worklet';
  return v < 0.3 ? 0 : v > 0.7 ? 2 : 1;
}

function traitWord(t: TraitSpec, v: number): string {
  const zone = traitZone(v);
  return zone === 0 ? t.low : zone === 2 ? t.high : t.mid;
}

// The backend stores 0-100 integers; the sliders work in 0-1. The two were
// once never converted, which saved 0.7 into a 0-100 field and floored every
// trait.
function traitsFromApi(v?: Record<string, number>): Traits | null {
  if (!v) return null;
  if (TRAIT_KEYS.some(k => typeof v[k] !== 'number')) return null;
  return TRAIT_KEYS.reduce((acc, k) => {
    acc[k] = Math.max(0, Math.min(1, v[k] / 100));
    return acc;
  }, {} as Traits);
}

function traitsToApi(t: Traits): Traits {
  return TRAIT_KEYS.reduce((acc, k) => {
    acc[k] = Math.round(t[k] * 100);
    return acc;
  }, {} as Traits);
}

/** Equal as the backend would store them. */
function sameTraits(a: Traits, b: Traits): boolean {
  const x = traitsToApi(a);
  const y = traitsToApi(b);
  return TRAIT_KEYS.every(k => x[k] === y[k]);
}

const ARCHETYPE_ICON: Record<Companion['archetype'], IconName> = {
  mentor: 'compass', friend: 'two', partner: 'heart', challenger: 'target',
};
const GENDER_LABEL: Record<string, string> = { male: 'Male', female: 'Female', nonbinary: 'Non-binary' };

type Draft = { name: string; voiceId?: string; traits: Traits | null };
type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

const NAME_MAX = 30;            // the backend's limit
const AUTOSAVE_MS = 800;        // after the last slider release
const SAVED_SHOWN_MS = 2000;
const PERSONALITY_WAIT_MS = 8000;
const APPLIED_SHOWN_MS = 5000;

export function S26_CompanionEdit({
  go, companion, onSave, onDelete, onRefresh, backTo = 'chat', apiVoices,
}: {
  go: Go;
  companion: Companion;
  /**
   * Saves only what changed: shortly after an edit, and on the way out.
   * Return the request's promise (rejecting on failure) and the screen shows
   * saving, saved or failed; return nothing and it claims neither.
   */
  onSave?: (p: UpdateCharacterPayload) => void | Promise<unknown>;
  // Accepting a suggestion changes the companion server-side without going
  // through onSave, so the list this screen was opened from needs re-reading.
  onRefresh?: () => void | Promise<unknown>;
  /** Deletes the companion. The screen waits for the returned promise and
   *  stays put (with the error) if it rejects. Omit to hide Delete. */
  onDelete?: () => void | Promise<unknown>;
  backTo?: ScreenName;
  /** The voice catalog: names the companion's voice and offers the others. */
  apiVoices?: ApiVoice[];
}) {
  const mounted = useMountedRef();
  const characterId = String(companion.id);
  const isRealCompanion = characterId.length === 24; // local placeholders have short ids
  const canEdit = !!onSave;
  const accent = ARCHETYPE_COLORS[companion.archetype] ?? W.primary;

  // ── What is on screen, and what the server last confirmed ─────────────
  // Both live in refs so a save can read them the moment an edit happens,
  // without waiting for a render.
  const [form, setForm] = useState<Draft>(() => ({
    name: companion.name,
    voiceId: companion.voice,
    traits: traitsFromApi(companion.personalitySliders),
  }));
  const draft = useRef(form);
  const saved = useRef(form);
  const edit = useCallback((patch: Partial<Draft>) => {
    draft.current = { ...draft.current, ...patch };
    setForm(draft.current);
  }, []);
  const displayName = form.name.trim() || companion.name;
  const nameRef = useLatest(displayName);

  // ── Saving ────────────────────────────────────────────────────────────
  // Edits save themselves, as iOS settings do: shortly after a slider is let
  // go, when a rename is finished, when a voice is picked, and on the way
  // out by any route. Only fields that actually changed are sent, so one
  // slider can never write stale values over the other four.
  const onSaveRef = useLatest(onSave);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const inFlight = useRef<Promise<void> | null>(null);
  const flushAgain = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editingNameRef = useRef(false);
  // Set once the companion is deleted: its edits have nowhere to go.
  const discarded = useRef(false);

  const pendingPatch = useCallback((): UpdateCharacterPayload => {
    const d = draft.current;
    const s = saved.current;
    const patch: UpdateCharacterPayload = {};
    const name = d.name.trim();
    // A half-typed name is not a rename yet.
    if (!editingNameRef.current && name && name !== s.name) patch.name = name;
    if (d.voiceId && d.voiceId !== s.voiceId) patch.voice_id = d.voiceId;
    if (d.traits && s.traits) {
      const now = traitsToApi(d.traits);
      const was = traitsToApi(s.traits);
      const moved = TRAIT_KEYS.filter(k => now[k] !== was[k]);
      if (moved.length > 0) patch.personality_sliders = Object.fromEntries(moved.map(k => [k, now[k]]));
    }
    return patch;
  }, []);

  const flush = useCallback((): Promise<void> => {
    clearTimeout(autosaveTimer.current);
    if (inFlight.current) {
      flushAgain.current = true;
      return inFlight.current;
    }
    const save = onSaveRef.current;
    const patch = pendingPatch();
    if (!save || discarded.current || Object.keys(patch).length === 0) return Promise.resolve();

    const markSaved = () => {
      const s = saved.current;
      const sliders = patch.personality_sliders;
      const was = s.traits;
      saved.current = {
        name: patch.name ?? s.name,
        voiceId: patch.voice_id ?? s.voiceId,
        traits: sliders && was
          ? TRAIT_KEYS.reduce((acc, k) => {
            acc[k] = k in sliders ? sliders[k] / 100 : was[k];
            return acc;
          }, {} as Traits)
          : was,
      };
    };

    const result = save(patch);
    if (!isPromise(result)) {
      // A caller that doesn't hand back its request can't say how it went,
      // so the screen claims nothing either way.
      markSaved();
      return Promise.resolve();
    }
    if (mounted.current) {
      clearTimeout(savedTimer.current);
      setStatus('saving');
    }
    const run = result
      .then(
        () => {
          markSaved();
          if (!mounted.current) return;
          setStatus('saved');
          savedTimer.current = setTimeout(() => { if (mounted.current) setStatus('idle'); }, SAVED_SHOWN_MS);
        },
        (e: unknown) => {
          if (!mounted.current) return;
          setStatus('failed');
          haptic.error();
          announce(failureText(e, `save changes to ${nameRef.current}`));
        },
      )
      .finally(() => {
        inFlight.current = null;
        if (flushAgain.current) {
          flushAgain.current = false;
          void flush();
        }
      });
    inFlight.current = run;
    return run;
  }, [mounted, nameRef, onSaveRef, pendingPatch]);

  const scheduleSave = useCallback(() => {
    clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void flush(); }, AUTOSAVE_MS);
  }, [flush]);

  // Leaving by any route (back, a tab, a notification) keeps the edits.
  useEffect(() => () => {
    clearTimeout(savedTimer.current);
    void flush();
  }, [flush]);

  // ── Name ──────────────────────────────────────────────────────────────
  const [editingName, setEditingName] = useState(false);
  const startNameEdit = () => {
    haptic.selection();
    editingNameRef.current = true;
    setEditingName(true);
  };
  const finishNameEdit = useCallback(() => {
    if (!editingNameRef.current) return;
    editingNameRef.current = false;
    setEditingName(false);
    // A blank name isn't allowed, so an emptied field gets the old one back.
    edit({ name: draft.current.name.trim() || saved.current.name });
  }, [edit]);

  const leave = () => {
    finishNameEdit();
    void flush();
    go(backTo);
  };

  const openMemories = () => {
    finishNameEdit();
    void flush();
    go('memories');
  };

  // ── Server updates ────────────────────────────────────────────────────
  // The companion is re-read after saves and accepted suggestions. Take the
  // server's word for anything the user isn't in the middle of changing.
  useEffect(() => {
    if (inFlight.current) return; // its reply is about to say the same thing
    const d = draft.current;
    const s = saved.current;
    const server = traitsFromApi(companion.personalitySliders);
    const patch: Partial<Draft> = {};
    const nextSaved: Draft = { ...s };
    if (companion.name !== s.name && d.name === s.name && !editingNameRef.current) {
      patch.name = companion.name;
      nextSaved.name = companion.name;
    }
    if (companion.voice !== s.voiceId && d.voiceId === s.voiceId) {
      patch.voiceId = companion.voice;
      nextSaved.voiceId = companion.voice;
    }
    if (server && (!d.traits || !s.traits || sameTraits(d.traits, s.traits))) {
      nextSaved.traits = server;
      if (!d.traits || !sameTraits(d.traits, server)) patch.traits = server;
    }
    saved.current = nextSaved;
    if (Object.keys(patch).length > 0) edit(patch);
  }, [companion.name, companion.voice, companion.personalitySliders, edit]);

  // ── Personality ───────────────────────────────────────────────────────
  // The real values or nothing: rendering defaults here once saved invented
  // numbers over a companion's real personality.
  const traits = form.traits;
  const [personalityFailed, setPersonalityFailed] = useState(!isRealCompanion && !traits);
  const [retryingPersonality, setRetryingPersonality] = useState(false);

  useEffect(() => {
    if (traits || personalityFailed) {
      if (traits) setPersonalityFailed(false);
      return;
    }
    const id = setTimeout(() => setPersonalityFailed(true), PERSONALITY_WAIT_MS);
    return () => clearTimeout(id);
  }, [traits, personalityFailed]);

  // The failure clears itself when the refreshed companion brings its values
  // (the effect above); otherwise the retry button simply stays.
  const retryPersonality = async () => {
    setRetryingPersonality(true);
    try {
      await onRefresh?.();
    } catch {
      // Still failed; nothing more to say than the state already does.
    } finally {
      if (mounted.current) setRetryingPersonality(false);
    }
  };

  const commitTrait = useCallback((k: TraitKey, v: number) => {
    const current = draft.current.traits;
    if (!current || current[k] === v) return;
    edit({ traits: { ...current, [k]: v } });
    scheduleSave();
  }, [edit, scheduleSave]);

  // ── Weekly suggestion ─────────────────────────────────────────────────
  // Reading it starts the backend's one-a-week cooldown, so ask only once
  // the card can actually be shown, and only once.
  const [suggestion, setSuggestion] = useState<ApiSuggestion | null>(null);
  const [applying, setApplying] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [appliedNote, setAppliedNote] = useState<string | null>(null);
  const suggestionAsked = useRef(false);

  useEffect(() => {
    if (!isRealCompanion || !traits || suggestionAsked.current) return;
    suggestionAsked.current = true;
    getSuggestion(characterId)
      .then(s => { if (mounted.current) setSuggestion(s); })
      .catch(() => { /* an offer is a nicety; its absence isn't worth a message */ });
  }, [characterId, isRealCompanion, traits, mounted]);

  useEffect(() => {
    if (!appliedNote) return;
    const id = setTimeout(() => setAppliedNote(null), APPLIED_SHOWN_MS);
    return () => clearTimeout(id);
  }, [appliedNote]);

  const applySuggestion = async () => {
    if (!suggestion || applying) return;
    const offer = suggestion;
    setApplying(true);
    setSuggestionError(null);
    try {
      const res = await resolveSuggestion(characterId, offer.memory_id, 'apply');
      if (!mounted.current) return;
      setSuggestion(null);
      // The backend decides how far the slider moves. Take its number for that
      // one trait; unsaved moves on the others stay as they are.
      const next = traitsFromApi(res.personality_sliders);
      if (next) {
        const value = next[offer.trait];
        edit({ traits: { ...(draft.current.traits ?? next), [offer.trait]: value } });
        const s = saved.current.traits;
        saved.current = { ...saved.current, traits: s ? { ...s, [offer.trait]: value } : next };
      }
      haptic.success();
      const note = `${nameRef.current} will be ${offer.phrase} from now on.`;
      setAppliedNote(note);
      announce(note);
      void onRefresh?.();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof ApiError && e.code === 'SUGGESTION_STALE') {
        // Already answered, often by an apply whose reply was lost. Offering
        // it again would fail the same way forever, so re-read instead.
        setSuggestion(null);
        getSuggestion(characterId)
          .then(s => { if (mounted.current) setSuggestion(s); })
          .catch(() => {});
        void onRefresh?.();
        return;
      }
      haptic.error();
      setSuggestionError(failureText(e, `update ${nameRef.current}`));
    } finally {
      if (mounted.current) setApplying(false);
    }
  };

  const dismissSuggestion = () => {
    if (!suggestion) return;
    const offer = suggestion;
    haptic.light();
    setSuggestion(null);
    setSuggestionError(null);
    resolveSuggestion(characterId, offer.memory_id, 'dismiss').catch(() => {
      // Nothing changed; the offer can simply come back another time.
    });
  };

  // ── Memories ──────────────────────────────────────────────────────────
  // null until known: a 0 shown while loading would tell someone whose
  // companion remembers plenty that it remembers nothing.
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  useEffect(() => {
    if (!isRealCompanion) return;
    getMemories(characterId)
      .then(ms => { if (mounted.current) setMemoryCount(ms.length); })
      .catch(() => { /* leave it unlabelled rather than show a wrong number */ });
  }, [characterId, isRealCompanion, mounted]);
  const memoryLabel = memoryCount === null
    ? 'Memories'
    : `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'}`;

  // ── Voice ─────────────────────────────────────────────────────────────
  const voices = apiVoices ?? [];
  const currentVoice = voices.find(v => v.id === form.voiceId);
  // The companion's gender comes from its voice and can't be changed, so only
  // voices that match it are offered.
  const voiceOptions = useMemo(() => {
    const all = apiVoices ?? [];
    const g = companion.gender;
    return g === 'male' || g === 'female' ? all.filter(v => v.gender === g) : all;
  }, [apiVoices, companion.gender]);
  const canPickVoice = canEdit && !!currentVoice && voiceOptions.length > 1;
  const voiceSheet = useSheet();
  const preview = useVoicePreview();
  const closeVoices = () => {
    preview.stop();
    voiceSheet.close();
    void flush();
  };

  // ── Delete ────────────────────────────────────────────────────────────
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = !!onDelete && isRealCompanion;

  const runDelete = async () => {
    if (!onDelete || deleting) return;
    clearTimeout(autosaveTimer.current);
    setDeleting(true);
    setDeleteError(null);
    announce(`Deleting ${displayName}`);
    try {
      await onDelete();
      discarded.current = true;
      go('home');
    } catch (e) {
      if (!mounted.current) return;
      setDeleting(false);
      haptic.error();
      setDeleteError(failureText(e, `delete ${displayName}`));
    }
  };

  const confirmDelete = () => {
    haptic.warning();
    Alert.alert(
      `Delete ${displayName}?`,
      `${displayName} and everything they remember about you will be removed. You can't undo this.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { void runDelete(); } },
      ],
    );
  };

  // ── Header title ──────────────────────────────────────────────────────
  // The name sits in the hero; the bar only shows it once the hero has
  // scrolled away, the way iOS large titles do.
  const heroBottom = useRef(0);
  const titleShown = useRef(false);
  const titleOpacity = useSharedValue(0);
  const titleStyle = useAnimatedStyle(() => ({ opacity: titleOpacity.value }));
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const shown = heroBottom.current > 0 && e.nativeEvent.contentOffset.y > heroBottom.current;
    if (shown === titleShown.current) return;
    titleShown.current = shown;
    // A fade, not movement, so it plays under Reduce Motion too.
    titleOpacity.value = withTiming(shown ? 1 : 0, { ...timing(D.fast), reduceMotion: ReduceMotion.Never });
  };

  return (
    <Screen label="26 Companion Profile">
      <TopBar
        left={<View style={styles.barSlot}><BackButton onPress={leave} /></View>}
        center={
          <Animated.View style={[styles.barTitle, titleStyle]}>
            <Txt variant="headline" heading numberOfLines={1}>{displayName}</Txt>
          </Animated.View>
        }
        right={
          <View style={[styles.barSlot, styles.barSlotEnd]}>
            <SaveIndicator status={status} onRetry={() => { void flush(); }} />
          </View>
        }
      />
      <GestureScrollView
        style={styles.fill}
        contentContainerStyle={styles.profileContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
      >
        <View
          style={styles.hero}
          onLayout={e => { heroBottom.current = e.nativeEvent.layout.y + e.nativeEvent.layout.height; }}
        >
          <Avatar color={accent} size={96} />
          {editingName ? (
            <TextInput
              value={form.name}
              onChangeText={v => edit({ name: v })}
              onBlur={() => { finishNameEdit(); void flush(); }}
              autoFocus
              selectTextOnFocus
              maxLength={NAME_MAX}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="done"
              accessibilityLabel="Name"
              maxFontSizeMultiplier={TYPE.title2.maxScale}
              style={styles.nameInput}
            />
          ) : (
            <View style={styles.nameRow}>
              <Txt variant="title2" heading numberOfLines={2} style={styles.nameText}>{displayName}</Txt>
              {canEdit ? (
                // Felt on the tap itself: a press-in haptic would also fire
                // when a scroll happens to start on the button.
                <IconButton
                  icon="pencil" label={`Rename ${displayName}`} onPress={startNameEdit}
                  size={32} iconSize={16} tint={W.text2} haptic={false}
                />
              ) : null}
            </View>
          )}
        </View>

        {!canEdit ? (
          <InlineNotice tone="info" text={`Changes to ${displayName} can't be saved right now.`} />
        ) : null}

        <ProfileSection title="Identity">
          <ProfileRow
            label="Archetype"
            value={ARCHETYPE_LABEL[companion.archetype] ?? companion.archetype}
            icon={<NavIcon name={ARCHETYPE_ICON[companion.archetype] ?? 'compass'} color={accent} />}
          />
          {companion.gender && GENDER_LABEL[companion.gender] ? (
            <ProfileRow label="Gender" value={GENDER_LABEL[companion.gender]} />
          ) : null}
          {currentVoice ? (
            <ProfileRow
              label="Voice"
              value={currentVoice.name}
              onPress={canPickVoice ? voiceSheet.open : undefined}
              hint="Choose a different voice"
            />
          ) : null}
        </ProfileSection>

        <ProfileSection title="Personality">
          <View style={styles.sectionBody}>
            {traits ? (
              <>
                {suggestion ? (
                  <SuggestionCard
                    suggestion={suggestion}
                    companionName={displayName}
                    accent={accent}
                    applying={applying}
                    error={suggestionError}
                    onApply={() => { void applySuggestion(); }}
                    onDismiss={dismissSuggestion}
                  />
                ) : null}
                {appliedNote ? <InlineNotice tone="success" text={appliedNote} /> : null}
                {TRAITS.map(t => (
                  <TraitSlider
                    key={t.k}
                    spec={t}
                    value={traits[t.k]}
                    disabled={!canEdit}
                    onCommit={v => commitTrait(t.k, v)}
                  />
                ))}
              </>
            ) : personalityFailed ? (
              <ErrorState
                title={`Couldn't load ${displayName}'s personality`}
                body={isRealCompanion ? 'Check your connection and try again.' : `${displayName} isn't fully set up yet.`}
                onRetry={isRealCompanion && onRefresh ? () => { void retryPersonality(); } : undefined}
                retrying={retryingPersonality}
                style={styles.inlineState}
              />
            ) : (
              <PersonalitySkeleton />
            )}
          </View>
        </ProfileSection>

        {isRealCompanion ? (
          <ProfileSection title="Memory">
            <ProfileRow label={memoryLabel} value="View all" onPress={openMemories} hint={`Opens what ${displayName} remembers`} />
          </ProfileSection>
        ) : null}

        {canDelete ? (
          <View style={styles.dangerZone}>
            {deleteError ? (
              <InlineNotice tone="error" text={deleteError} actionLabel="Try again" onAction={() => { void runDelete(); }} />
            ) : null}
            <Pressable
              onPress={confirmDelete}
              disabled={deleting}
              accessibilityRole="button"
              accessibilityLabel={deleting ? `Deleting ${displayName}` : `Delete ${displayName}`}
              accessibilityState={{ disabled: deleting, busy: deleting }}
              style={({ pressed }) => [styles.deleteLink, pressed ? styles.pressed : null]}
            >
              {deleting
                ? <ActivityIndicator size="small" color={W.dangerText} />
                : <NavIcon name="trash" color={W.dangerText} size={18} />}
              <Txt variant="callout" weight={500} numberOfLines={1} style={styles.deleteText}>
                {deleting ? `Deleting ${displayName}…` : `Delete ${displayName}`}
              </Txt>
            </Pressable>
          </View>
        ) : null}
      </GestureScrollView>

      <Sheet
        visible={voiceSheet.visible}
        onClose={closeVoices}
        title="Voice"
        footer={<PrimaryButton onPress={closeVoices}>Done</PrimaryButton>}
      >
        <VoicePicker
          voices={voiceOptions}
          selectedId={form.voiceId}
          accent={accent}
          playingId={preview.playingId}
          onPlay={preview.play}
          onStop={preview.stop}
          onSelect={id => edit({ voiceId: id })}
        />
      </Sheet>
    </Screen>
  );
}

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  if (status === 'saving') {
    return (
      <Animated.View entering={enter.fade} exiting={exit.fade} accessible accessibilityLabel="Saving" style={styles.saveState}>
        <ActivityIndicator size="small" color={W.text2} />
      </Animated.View>
    );
  }
  if (status === 'saved') {
    return (
      <Animated.View entering={enter.fade} exiting={exit.fade} accessible accessibilityLabel="Saved" style={styles.saveState}>
        <NavIcon name="check" color={W.success} size={16} />
        <Txt variant="footnote" maxScale={1.2} style={{ color: W.text2 }}>Saved</Txt>
      </Animated.View>
    );
  }
  if (status === 'failed') {
    return (
      <Animated.View entering={enter.fade} exiting={exit.fade}>
        <Pressable
          onPress={onRetry}
          hitSlop={minTarget(64, 28)}
          accessibilityRole="button"
          accessibilityLabel="Changes not saved. Try again"
          style={({ pressed }) => [styles.saveState, pressed ? styles.pressed : null]}
        >
          <NavIcon name="alert" color={W.dangerText} size={16} />
          <Txt variant="footnote" weight={600} maxScale={1.2} style={{ color: W.dangerText }}>Retry</Txt>
        </Pressable>
      </Animated.View>
    );
  }
  return null;
}

/**
 * Phase C — the companion noticing what it was told.
 *
 * The quote is the whole point. An app that says "want me to be more direct?"
 * out of nowhere is guessing at you; one that shows the sentence it is working
 * from is answering something you actually said. It also makes the offer
 * refusable on the merits — if the memory is wrong, "not quite" is the right
 * answer and the memory screen is where you go to delete it.
 */
function SuggestionCard({ suggestion, companionName, accent, applying, error, onApply, onDismiss }: {
  suggestion: ApiSuggestion;
  companionName: string;
  accent: string;
  applying: boolean;
  error: string | null;
  onApply: () => void;
  onDismiss: () => void;
}) {
  return (
    <Animated.View
      entering={enter.fadeUp}
      exiting={exit.fade}
      style={[styles.suggestion, { borderColor: rgba(accent, 0.3), backgroundColor: rgba(accent, 0.08) }]}
    >
      <Txt variant="eyebrow" style={{ color: accent }}>From something you said</Txt>
      <Txt variant="subhead" style={{ color: W.text2 }}>“{suggestion.quote}”</Txt>
      <Txt variant="callout" style={{ color: W.text }}>
        Want {companionName} to be {suggestion.phrase}?
      </Txt>
      {error ? <InlineNotice tone="error" text={error} /> : null}
      <View style={styles.suggestionActions}>
        <CardButton label="Yes, do that" accent={accent} loading={applying} onPress={onApply} />
        <CardButton label="Not quite" disabled={applying} onPress={onDismiss} />
      </View>
    </Animated.View>
  );
}

/** A compact button for inside a card. `accent` gives it the tinted fill. */
function CardButton({ label, accent, loading = false, disabled = false, onPress }: {
  label: string;
  accent?: string;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  // Inside a scroll view, so no press-in haptic: a scroll would set it off.
  const press = usePressFeedback({ haptic: false });
  return (
    <Animated.View style={[styles.cardButtonWrap, press.animatedStyle]}>
      <Pressable
        onPress={onPress}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        style={({ pressed }) => [
          styles.cardButton,
          accent
            ? { backgroundColor: rgba(accent, pressed ? 0.3 : 0.2), borderColor: rgba(accent, 0.45) }
            : { backgroundColor: pressed ? W.hairline : 'transparent', borderColor: W.hairlineStrong },
          disabled ? styles.dimmed : null,
        ]}
      >
        {loading
          ? <ActivityIndicator size="small" color={W.text} />
          : (
            <Txt variant="subhead" weight={600} numberOfLines={2} style={[styles.cardButtonText, { color: accent ? W.text : W.text2 }]}>
              {label}
            </Txt>
          )}
      </Pressable>
    </Animated.View>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  return (
    <View>
      <Txt variant="eyebrow" heading style={styles.sectionTitle}>{title}</Txt>
      <View style={styles.sectionCard}>
        <GlassFill intensity={20} solid={W.surface1} />
        {items.map((child, i) => (
          <View key={i} style={i > 0 ? styles.sectionDivider : null}>{child}</View>
        ))}
      </View>
    </View>
  );
}

// A row with a chevron only when it goes somewhere. The value truncates
// before it can squeeze the label.
function ProfileRow({ label, value, icon, onPress, hint }: {
  label: string;
  value?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  hint?: string;
}) {
  const content = (
    <View style={styles.row}>
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <Txt variant="callout" style={styles.rowLabel}>{label}</Txt>
      {value ? <Txt variant="subhead" numberOfLines={1} style={styles.rowValue}>{value}</Txt> : null}
      {onPress ? <NavIcon name="right" color={W.text3} size={18} /> : null}
    </View>
  );
  const spoken = value ? `${label}, ${value}` : label;
  if (!onPress) return <View accessible accessibilityLabel={spoken}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={hint}
      style={({ pressed }) => (pressed ? styles.rowPressed : null)}
    >
      {content}
    </Pressable>
  );
}

function PersonalitySkeleton() {
  return (
    <View accessible accessibilityLabel="Loading personality" accessibilityState={{ busy: true }} style={styles.skeletonTraits}>
      {TRAITS.map(t => (
        <View key={t.k} style={styles.skeletonTrait}>
          <Skeleton width={72} height={12} />
          <Skeleton height={8} radius={R.pill} />
        </View>
      ))}
    </View>
  );
}

// ─── Trait slider ───────────────────────────────────────────────────────────
// One adjustable control per trait: a 44pt touch row, a 4pt track and a 24pt
// thumb. It moves on the UI thread and tells the profile only when it is let
// go, so dragging doesn't re-render the whole screen.
const THUMB = 24;
const TRACK_H = 4;
const TRAIT_STEP = 0.1;
// A plain number, so the tap worklet captures (and in dev freezes) only this.
const TAP_GLIDE_MS = D.fast;
const ADJUST_ACTIONS = [{ name: 'increment' }, { name: 'decrement' }];
const TRAIT_FILL = [W.primary, W.secondary] as const;

function TraitSlider({ spec, value, disabled = false, onCommit }: {
  spec: TraitSpec;
  value: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const width = useSharedValue(0);
  const pos = useSharedValue(value);
  const from = useSharedValue(0);
  const held = useSharedValue(0);
  const dragging = useRef(false);
  // The value while a finger is on it, so the word follows the drag.
  const [live, setLive] = useState<number | null>(null);
  const commit = useLatest(onCommit);
  const shown = live ?? value;
  const word = traitWord(spec, shown);

  useEffect(() => {
    // Changes from outside (an accepted suggestion, a refresh) glide into
    // place; a drag in progress keeps the finger's value.
    if (!dragging.current) pos.value = withTiming(value, timing(D.slow, 'decel'));
  }, [value, pos]);

  const cross = useCallback((v: number) => {
    haptic.selection();
    setLive(v);
  }, []);
  const begin = useCallback(() => { dragging.current = true; }, []);
  const end = useCallback((v: number) => {
    dragging.current = false;
    setLive(null);
    commit.current(Math.round(v * 100) / 100);
  }, [commit]);

  const gesture = useMemo(() => {
    // Only a sideways drag takes the touch. A vertical one fails at once and
    // the page scrolls, so scrolling past a slider can't retune a companion.
    const pan = Gesture.Pan()
      .enabled(!disabled)
      .activeOffsetX([-6, 6])
      .failOffsetY([-10, 10])
      .onStart(() => {
        from.value = pos.value;
        held.value = withSpring(1, spring('snappy'));
        scheduleOnRN(begin);
      })
      .onUpdate(e => {
        const travel = width.value - THUMB;
        if (travel <= 0) return;
        // From where the thumb was, so grabbing it never makes it jump.
        const next = Math.min(1, Math.max(0, from.value + e.translationX / travel));
        if (traitZone(next) !== traitZone(pos.value)) scheduleOnRN(cross, next);
        pos.value = next;
      })
      .onEnd(() => {
        scheduleOnRN(end, pos.value);
      })
      .onFinalize(() => {
        held.value = withSpring(0, spring('snappy'));
      });
    const tap = Gesture.Tap()
      .enabled(!disabled)
      .maxDistance(8)
      .onEnd((e, success) => {
        const travel = width.value - THUMB;
        if (!success || travel <= 0) return;
        const next = Math.min(1, Math.max(0, (e.x - THUMB / 2) / travel));
        if (traitZone(next) !== traitZone(pos.value)) scheduleOnRN(cross, next);
        pos.value = withTiming(next, timing(TAP_GLIDE_MS, 'decel'));
        scheduleOnRN(end, next);
      });
    return Gesture.Race(pan, tap);
  }, [disabled, begin, cross, end, width, pos, from, held]);

  const thumbStyle = useAnimatedStyle(() => ({
    opacity: width.value > 0 ? 1 : 0,
    transform: [
      { translateX: pos.value * Math.max(0, width.value - THUMB) },
      { scale: 1 + held.value * 0.12 },
    ],
  }));
  // The fill slides in from the left while its gradient stays put.
  const fillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (pos.value - 1) * Math.max(0, width.value - THUMB) }],
  }));
  const pinStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - pos.value) * Math.max(0, width.value - THUMB) }],
  }));

  const step = (dir: 1 | -1) => {
    const next = Math.min(1, Math.max(0, Math.round((value + dir * TRAIT_STEP) * 100) / 100));
    if (next === value) return;
    if (traitZone(next) !== traitZone(value)) haptic.selection();
    onCommit(next);
  };

  return (
    <View style={[styles.trait, disabled ? styles.dimmed : null]}>
      {/* The slider itself speaks its name and value. */}
      <View style={styles.traitHead} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Txt variant="subhead" weight={600}>{spec.label}</Txt>
        <Txt variant="footnote" style={{ color: W.text2 }}>{word}</Txt>
      </View>
      <View style={styles.traitRow}>
        <TraitMark>{spec.lowMark}</TraitMark>
        <GestureDetector gesture={gesture}>
          <View
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${spec.label}, ${spec.low} to ${spec.high}`}
            accessibilityValue={{ text: `${word}, ${Math.round(shown * 100)}%` }}
            accessibilityState={{ disabled }}
            accessibilityActions={disabled ? undefined : ADJUST_ACTIONS}
            onAccessibilityAction={e => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
            onLayout={e => { width.value = e.nativeEvent.layout.width; }}
            style={styles.traitTouch}
          >
            <View style={styles.traitTrack}>
              <Animated.View style={[FILL, fillStyle]}>
                <Animated.View style={[FILL, pinStyle]}>
                  <LinearGradient colors={TRAIT_FILL} {...ACROSS} style={FILL} />
                </Animated.View>
              </Animated.View>
            </View>
            <Animated.View pointerEvents="none" style={[styles.traitThumb, thumbStyle]} />
          </View>
        </GestureDetector>
        <TraitMark>{spec.highMark}</TraitMark>
      </View>
    </View>
  );
}

function TraitMark({ children }: { children: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Txt maxScale={1.3} style={styles.traitMark}>{children}</Txt>
    </View>
  );
}

// ─── Voice picker (inside a Sheet) ──────────────────────────────────────────
function VoicePicker({ voices, selectedId, accent, playingId, onPlay, onStop, onSelect }: {
  voices: ApiVoice[];
  selectedId?: string;
  accent: string;
  playingId: string | null;
  onPlay: (voiceId: string) => void;
  onStop: () => void;
  onSelect: (voiceId: string) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel="Voice" style={styles.voiceList}>
      {voices.map(v => {
        const selected = v.id === selectedId;
        const playing = playingId === v.id;
        return (
          <View
            key={v.id}
            style={[styles.voiceRow, selected ? { borderColor: rgba(accent, 0.55), backgroundColor: rgba(accent, 0.1) } : null]}
          >
            <Pressable
              onPress={() => {
                if (!selected) haptic.selection();
                onSelect(v.id);
              }}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={v.personality ? `${v.name}, ${v.personality}` : v.name}
              style={({ pressed }) => [styles.voiceMain, pressed ? styles.pressed : null]}
            >
              <View style={[styles.radio, selected ? { borderColor: accent } : null]}>
                {selected ? <View style={[styles.radioDot, { backgroundColor: accent }]} /> : null}
              </View>
              <View style={styles.voiceText}>
                <Txt variant="headline" numberOfLines={1}>{v.name}</Txt>
                {v.personality ? (
                  <Txt variant="footnote" numberOfLines={2} style={{ color: W.text2 }}>{v.personality}</Txt>
                ) : null}
              </View>
            </Pressable>
            {hasVoicePreview(v.id) ? (
              <IconButton
                icon={playing ? 'pause' : 'play'}
                label={playing ? `Stop ${v.name}'s preview` : `Hear ${v.name}`}
                onPress={() => {
                  haptic.selection();
                  if (playing) onStop();
                  else onPlay(v.id);
                }}
                variant="tinted"
                tint={accent}
                size={40}
                iconSize={18}
                haptic={false}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ─── S27 — VOICE MINUTE STATES ──────────────────────────────────────────────
// (MinuteWarningBanner lives in components/Atoms.tsx and is used by the call.)

// State C — already depleted, trying to start a call.
export function S27_StartCallDepleted({
  companion, onUpgrade, onText, onClose, resetDate,
}: {
  companion: Companion;
  onUpgrade: () => void;
  onText: () => void;
  onClose: () => void;
  /** When the allowance comes back, in the reader's own timezone. Omitted
   *  while unknown — this used to default to "June 1" and say it out loud. */
  resetDate?: string;
}) {
  const [open, setOpen] = useState(true);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const accent = ARCHETYPE_COLORS[companion.archetype] ?? W.primary;

  useEffect(() => {
    haptic.warning();
    return () => clearTimeout(closing.current);
  }, []);

  // Let the sheet slide away before the route changes under it.
  const dismiss = () => {
    if (closing.current) return;
    setOpen(false);
    closing.current = setTimeout(onClose, SHEET_EXIT_MS);
  };

  return (
    <Sheet
      visible={open}
      onClose={dismiss}
      title="Out of voice minutes"
      footer={
        <>
          {/* No top-up: bought minutes can't be spent until usage counters
              exist, so v1 sells plans only. */}
          <PrimaryButton onPress={onUpgrade}>See plans</PrimaryButton>
          <PrimaryButton variant="text" onPress={onText}>Text instead</PrimaryButton>
        </>
      }
    >
      <View style={styles.depletedBody}>
        <Avatar color={accent} size={48} />
        <View style={styles.depletedText}>
          <Txt variant="callout" style={{ color: W.text }}>
            You've used all your voice minutes for now. See plans for more, or keep talking to {companion.name} by text.
          </Txt>
          {resetDate ? (
            <Txt variant="footnote" style={styles.depletedReset}>Voice minutes reset {resetDate}.</Txt>
          ) : null}
        </View>
      </View>
    </Sheet>
  );
}

// ─── S28 — CRISIS RESOURCES ─────────────────────────────────────────────────
const CRISIS_ICON: Record<CrisisResource['kind'], IconName> = { call: 'phone', text: 'chat', web: 'globe' };
const CRISIS_HINT: Record<CrisisResource['kind'], string> = {
  call: 'Opens your phone to call',
  text: 'Opens Messages',
  web: 'Opens in your browser',
};

function couldNotOpen(r: CrisisResource): string {
  if (r.kind === 'web') return `Couldn't open the link. Go to ${r.value.replace(/^https?:\/\//, '')} in your browser.`;
  return `Couldn't open ${r.name} on this device. ${r.detail.replace(/\.$/, '')}.`;
}

/** A one-line pointer to the nearest helpline, for the top of a conversation. */
export function CrisisBanner() {
  const [primary] = useState(() => crisisResources().resources[0]);
  const openable = canOpenCrisisResource(primary);
  const open = async () => {
    if (await openCrisisResource(primary)) return;
    haptic.error();
    Alert.alert(primary.name, couldNotOpen(primary));
  };
  return (
    <Pressable
      onPress={openable ? () => { void open(); } : undefined}
      disabled={!openable}
      accessibilityRole={openable ? 'link' : 'text'}
      accessibilityLabel={`Need to talk to someone? ${primary.name}, ${primary.detail}`}
      accessibilityHint={openable ? CRISIS_HINT[primary.kind] : undefined}
      style={({ pressed }) => [styles.crisisBanner, pressed ? styles.crisisBannerPressed : null]}
    >
      <NavIcon name="heart" color={W.warning} size={16} />
      <Txt variant="footnote" numberOfLines={1} style={styles.crisisBannerText}>
        Need to talk to someone?{' '}
        <Txt variant="footnote" weight={600} style={{ color: W.warning }}>{primary.name}</Txt>
      </Txt>
      {openable ? <NavIcon name="right" color={W.text3} size={14} /> : null}
    </Pressable>
  );
}

/**
 * Everywhere to turn, for the region the phone is in. Reached from Settings
 * and from "More support" on a conversation's crisis card; it depends on no
 * companion and shows no conversation — it used to show a scripted one that
 * put words in the user's mouth.
 */
export function S28_CrisisChat({ go, backTo = 'home' }: {
  go: Go;
  /** Where Back returns to: the screen that opened this one. */
  backTo?: ScreenName;
  /** @deprecated Resources don't depend on a companion. Still accepted so
   *  existing call sites compile; nothing reads it. */
  companion?: Companion;
}) {
  const [{ emergency, resources }] = useState(() => crisisResources());
  const [unopened, setUnopened] = useState<CrisisResource | null>(null);
  const mounted = useMountedRef();

  const open = async (r: CrisisResource) => {
    setUnopened(null);
    const ok = await openCrisisResource(r);
    // An iPad can't place a call: keep the number on screen and say so.
    if (!ok && mounted.current) {
      haptic.error();
      setUnopened(r);
    }
  };

  return (
    <Screen label="28 Crisis Resources">
      <TopBar left={<BackButton onPress={() => go(backTo)} />} title="Support" focusTitleOnMount />
      <ScrollView contentContainerStyle={styles.crisisContent} showsVerticalScrollIndicator={false}>
        <View style={styles.crisisIntro}>
          <View style={styles.crisisBadge}>
            <NavIcon name="heart" color={W.warning} size={24} />
          </View>
          <Txt variant="title2" heading style={styles.crisisTitle}>You're not alone</Txt>
          <Txt variant="callout" style={styles.crisisLead}>
            You don't have to handle this on your own. These can put you in touch with someone trained to help.
          </Txt>
        </View>

        <Txt variant="eyebrow" heading style={styles.crisisSection}>Talk to someone</Txt>
        <View style={styles.crisisList}>
          {resources.map(r => <CrisisRow key={r.id} resource={r} onOpen={open} />)}
        </View>

        <Txt variant="eyebrow" heading style={styles.crisisSection}>In an emergency</Txt>
        <CrisisRow resource={emergency} onOpen={open} emergency />

        {unopened ? <InlineNotice tone="warning" text={couldNotOpen(unopened)} style={styles.crisisNotice} /> : null}

        <Txt variant="footnote" style={styles.crisisNote}>
          Evarna's companions are AI. They can listen, but they can't get you help in an emergency.
        </Txt>
      </ScrollView>
    </Screen>
  );
}

function CrisisRow({ resource: r, onOpen, emergency = false }: {
  resource: CrisisResource;
  onOpen: (r: CrisisResource) => void;
  emergency?: boolean;
}) {
  // Inside a scroll view: the tap is felt on release, not on touch-down.
  const press = usePressFeedback({ scale: MOTION.press.scaleSubtle, haptic: false });
  const tint = emergency ? W.dangerText : W.warning;
  const label = [r.name, r.detail, r.hours].filter(Boolean).join(', ');
  const body = (
    <>
      <View style={[styles.crisisIcon, { backgroundColor: rgba(tint, 0.14) }]}>
        <NavIcon name={emergency ? 'alert' : CRISIS_ICON[r.kind]} color={tint} size={18} />
      </View>
      <View style={styles.crisisRowText}>
        <Txt variant="callout" weight={600}>{r.name}</Txt>
        <Txt variant="subhead" style={{ color: W.text2 }}>{r.detail}</Txt>
        {r.hours ? <Txt variant="footnote" style={{ color: W.text3 }}>{r.hours}</Txt> : null}
      </View>
    </>
  );

  // Some regions only say what to do ("your local emergency number"), with
  // nothing to dial: that reads as text, not as a button.
  if (!canOpenCrisisResource(r)) {
    return <View accessible accessibilityLabel={label} style={styles.crisisRow}>{body}</View>;
  }
  return (
    <Animated.View style={press.animatedStyle}>
      <Pressable
        onPress={() => {
          haptic.light();
          onOpen(r);
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        accessibilityRole="link"
        accessibilityLabel={label}
        accessibilityHint={CRISIS_HINT[r.kind]}
        style={({ pressed }) => [styles.crisisRow, pressed ? styles.crisisRowPressed : null]}
      >
        {body}
        <NavIcon name={r.kind === 'web' ? 'external' : 'right'} color={W.text3} size={18} />
      </Pressable>
    </Animated.View>
  );
}

// ─── S29 — SESSION RECAP ────────────────────────────────────────────────────
//
// This sheet opens the moment a real conversation ends, and it used to be
// entirely fabricated: "12 minutes", topics of "Work stress / Interview prep /
// Mom's birthday", and two memories about a job interview at Amazon. Every
// user saw the same invented summary of the conversation they had just had.
//
// The real summary is written by the memory-extraction job, which runs after
// the session ends — so for the first half-minute there genuinely is nothing
// to show, and this says that instead of filling it in.
function formatDuration(session: ApiSession | null): string | null {
  if (!session) return null;
  let seconds = session.duration_seconds ?? 0;
  if (!seconds && session.ended_at) {
    seconds = (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 1000;
  }
  if (!seconds || seconds < 0) return null;
  const mins = Math.round(seconds / 60);
  if (mins < 1) return 'Under a minute';
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}

// About a minute of patience in all, backing off: extraction usually lands
// within half a minute, and a closed sheet stops asking.
const RECAP_POLL_MS = [3000, 4000, 5000, 6000, 8000, 10000, 12000, 12000];
const UNDO_MS = 4000;

type RecapPhase = 'loading' | 'waiting' | 'done' | 'slow' | 'none' | 'error';
type PendingForget = { memory: ApiMemory; index: number };

function insertAt<T>(list: T[], index: number, item: T): T[] {
  const next = list.slice();
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

export function S29_Recap({ go, companion, characterId }: {
  go: Go;
  companion: Companion;
  characterId?: string;
}) {
  const mounted = useMountedRef();
  const [open, setOpen] = useState(true);
  const [session, setSession] = useState<ApiSession | null>(null);
  const [memories, setMemories] = useState<ApiMemory[]>([]);
  const [phase, setPhase] = useState<RecapPhase>('loading');
  const [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumped by Retry
  const accent = ARCHETYPE_COLORS[companion.archetype] ?? W.primary;

  // ── Forget, with a few seconds to take it back ────────────────────────
  const [pendingForget, setPendingForget] = useState<PendingForget | null>(null);
  const pendingRef = useRef<PendingForget | null>(null);
  const forgotten = useRef(new Set<string>());
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [forgetError, setForgetError] = useState<string | null>(null);

  const setPending = (p: PendingForget | null) => {
    pendingRef.current = p;
    setPendingForget(p);
  };

  const commitForget = useCallback((p: PendingForget) => {
    forgotten.current.add(p.memory._id);
    deleteMemory(p.memory._id).catch(() => {
      forgotten.current.delete(p.memory._id);
      if (!mounted.current) return;
      setMemories(ms => insertAt(ms, p.index, p.memory));
      setForgetError("Couldn't forget that memory, so it's back in the list.");
      haptic.error();
    });
  }, [mounted]);

  const forget = (m: ApiMemory) => {
    clearTimeout(undoTimer.current);
    // A second forget closes the first one's undo window now.
    if (pendingRef.current) commitForget(pendingRef.current);
    const p = { memory: m, index: memories.findIndex(x => x._id === m._id) };
    setPending(p);
    setForgetError(null);
    setMemories(ms => ms.filter(x => x._id !== m._id));
    announce('Memory removed. You can undo this for a few seconds.');
    undoTimer.current = setTimeout(() => {
      setPending(null);
      commitForget(p);
    }, UNDO_MS);
  };

  const undo = () => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(undoTimer.current);
    setPending(null);
    setMemories(ms => insertAt(ms, p.index, p.memory));
    announce('Memory restored');
  };

  // Closing the sheet ends the undo window.
  useEffect(() => () => {
    clearTimeout(undoTimer.current);
    if (pendingRef.current) commitForget(pendingRef.current);
  }, [commitForget]);

  // ── Loading ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!characterId) {
      setPhase('none');
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;
    let latest: ApiSession | null = null;
    setPhase('loading');
    setOffline(false);

    const pollAgain = () => {
      if (polls < RECAP_POLL_MS.length) {
        timer = setTimeout(load, RECAP_POLL_MS[polls++]);
        return;
      }
      // Out of patience: show what arrived rather than wait forever.
      setPhase(latest?.summary ? 'done' : 'slow');
    };

    const load = async (): Promise<void> => {
      try {
        const { sessions } = await getCharacterSessions(characterId);
        if (cancelled) return;
        latest = sessions?.[0] ?? null;
        setSession(latest);
        if (!latest) {
          setPhase('none');
          return;
        }
        const summary = latest.summary;
        if (!summary) {
          setPhase('waiting');
          pollAgain();
          return;
        }
        // Memories carry no session id, so "from this conversation" is
        // anything written since it started. Close enough, and never wrong in
        // a way that invents something the user did not say.
        const since = new Date(latest.started_at).getTime();
        const all = await getMemories(characterId);
        if (cancelled) return;
        const fromSession = all.filter(m => new Date(m.created_at).getTime() >= since);
        setMemories(fromSession.filter(m =>
          !forgotten.current.has(m._id) && m._id !== pendingRef.current?.memory._id));
        // They are written just after the summary, so keep looking while
        // fewer have landed than it counted.
        if (fromSession.length + forgotten.current.size >= (summary.memory_count ?? 0)) {
          setPhase('done');
          return;
        }
        setPhase('waiting');
        pollAgain();
      } catch (e) {
        if (cancelled) return;
        // Nothing yet is a failure to load; a hiccup mid-poll is just a miss.
        if (!latest) {
          setOffline(isNetworkError(e));
          setPhase('error');
          return;
        }
        pollAgain();
      }
    };

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [characterId, attempt]);

  // ── Closing ───────────────────────────────────────────────────────────
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaving.current), []);
  const close = () => {
    if (leaving.current) return;
    setOpen(false);
    leaving.current = setTimeout(() => go('home'), SHEET_EXIT_MS);
  };

  const summary = session?.summary ?? null;
  const topics = summary?.topics ?? [];
  const moodLine = summary?.mood_arc?.end?.trim() || null;
  const waiting = phase === 'loading' || phase === 'waiting';
  const duration = formatDuration(session);
  const kind = session?.session_type === 'voice_call' ? 'Voice call' : 'Text chat';

  return (
    <Sheet
      visible={open}
      onClose={close}
      title={`Your conversation with ${companion.name}`}
      maxHeightPct={0.85}
      footer={
        <>
          {pendingForget ? <InlineNotice tone="info" text="Memory removed" actionLabel="Undo" onAction={undo} /> : null}
          <PrimaryButton variant="secondary" onPress={close}>Done</PrimaryButton>
        </>
      }
    >
      {phase === 'error' ? (
        <ErrorState
          title="Couldn't load this recap"
          body={offline ? 'Check your connection and try again.' : 'Please try again in a moment.'}
          onRetry={() => setAttempt(a => a + 1)}
          style={styles.inlineState}
        />
      ) : phase === 'none' ? (
        <Txt variant="subhead" style={{ color: W.text2 }}>There's nothing to recap for this conversation yet.</Txt>
      ) : (
        <>
          <View style={styles.recapMeta}>
            <Avatar color={accent} size={32} breathe={false} />
            {session ? (
              <Txt variant="footnote" style={{ flex: 1, color: W.text2 }}>
                {duration ? `${duration} · ` : ''}{kind}
              </Txt>
            ) : (
              <Skeleton width={140} height={12} />
            )}
          </View>

          <RecapSection title="What you talked about">
            {summary ? (
              topics.length > 0 ? (
                <View style={styles.chips}>
                  {topics.map(t => (
                    <Animated.View key={t} entering={enter.fade} style={styles.chip}>
                      <Txt variant="footnote" style={{ color: W.text2 }}>{t}</Txt>
                    </Animated.View>
                  ))}
                </View>
              ) : (
                <Txt variant="subhead" style={{ color: W.text2 }}>No topics stood out this time.</Txt>
              )
            ) : waiting ? (
              <View accessible accessibilityLabel={`${companion.name} is still writing this up`} accessibilityState={{ busy: true }} style={styles.recapWaiting}>
                <View style={styles.chips}>
                  <Skeleton width={84} height={28} radius={R.pill} />
                  <Skeleton width={112} height={28} radius={R.pill} />
                  <Skeleton width={68} height={28} radius={R.pill} />
                </View>
                <Txt variant="footnote" style={{ color: W.text3 }}>{companion.name} is still writing this up…</Txt>
              </View>
            ) : (
              <Txt variant="subhead" style={{ color: W.text2 }}>This is taking longer than usual.</Txt>
            )}
          </RecapSection>

          <RecapSection title="New memories">
            {forgetError ? <InlineNotice tone="error" text={forgetError} style={styles.recapNotice} /> : null}
            {memories.length > 0 ? (
              <View style={styles.memoryList}>
                {memories.map(m => (
                  <RecapMemory key={m._id} memory={m} companionName={companion.name} onForget={forget} />
                ))}
              </View>
            ) : waiting ? (
              <SkeletonLines lines={2} />
            ) : summary ? (
              <Txt variant="subhead" style={{ color: W.text2 }}>No new memories from this conversation.</Txt>
            ) : (
              <Txt variant="subhead" style={{ color: W.text2 }}>
                Anything {companion.name} remembers will show up in Memories when it's ready.
              </Txt>
            )}
          </RecapSection>

          {/* One real sentence from the extraction, not two invented tags with
              an arrow between them — nothing records a start-to-end mood arc. */}
          {moodLine ? (
            <RecapSection title="Mood">
              <Txt variant="subhead" style={{ color: W.text }}>{moodLine}</Txt>
            </RecapSection>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

function RecapMemory({ memory: m, companionName, onForget }: {
  memory: ApiMemory;
  companionName: string;
  onForget: (m: ApiMemory) => void;
}) {
  const type = MEM_TYPES[m.type];
  const tone = type?.color ?? W.gold;
  return (
    <Animated.View entering={enter.fade} exiting={exit.fade} layout={layout} style={styles.memoryRow}>
      <View style={[styles.memoryType, { backgroundColor: rgba(tone, 0.15) }]}>
        <Txt variant="eyebrow" maxScale={1.2} style={{ color: tone, letterSpacing: 0.6 }}>{type?.l ?? m.type}</Txt>
      </View>
      <Txt variant="subhead" style={styles.memoryText}>{m.content}</Txt>
      <IconButton
        icon="close"
        label="Forget this memory"
        accessibilityHint={`${companionName} won't remember this`}
        onPress={() => {
          haptic.light();
          onForget(m);
        }}
        size={32}
        iconSize={16}
        tint={W.text2}
        haptic={false}
        style={styles.memoryForget}
      />
    </Animated.View>
  );
}

function RecapSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.recapSection}>
      <Txt variant="eyebrow" heading style={styles.recapSectionTitle}>{title}</Txt>
      {children}
    </View>
  );
}

// ─── S30 — SIGN IN ──────────────────────────────────────────────────────────
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CODE_PATTERN = /^\d{6}$/;
const RESEND_AFTER_S = 30;
// Apple's guidelines allow only its own black or white button; neither
// colour belongs to the theme.
const APPLE_FILL = '#FFFFFF';
const APPLE_INK = '#000000';

type AuthStep = 'google' | 'apple' | 'send' | 'verify';

export function S30_Login({
  isNew = false, appleAvailable = false, onGoogle, onApple, onEmailRequest, onEmailVerify, busy = false, error, devCode,
}: {
  isNew?: boolean;
  /** Offer Sign in with Apple. Off until it is provisioned: until then the
   *  button could only fail. */
  appleAvailable?: boolean;
  onGoogle: () => void | Promise<unknown>;
  onApple: () => void | Promise<unknown>;
  // Resolves true when the request was accepted — that's what flips this
  // screen to its "enter the code" step.
  onEmailRequest: (email: string) => Promise<boolean>;
  onEmailVerify: (code: string) => void | Promise<unknown>;
  busy?: boolean;
  error?: string | null;
  // Development only: set when the backend has no mail provider configured and
  // returned the code instead of sending it. Without this the screen said
  // "check your email" for a mail that was never sent, and sign-in dead-ended.
  devCode?: string | null;
}) {
  const mounted = useMountedRef();
  const scroll = useRef<ScrollView>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  // Which control is working, so its own button shows the spinner.
  const [pending, setPending] = useState<AuthStep | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [errorHidden, setErrorHidden] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Prefill rather than just display it: retyping a code the machine already
  // knows is pure friction in the one flow every developer runs daily.
  useEffect(() => { if (devCode) setCode(devCode); }, [devCode]);

  // A new error shows even if the user has moved past the last one.
  useEffect(() => {
    setErrorHidden(false);
    if (error) haptic.error();
  }, [error]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const working = busy || pending !== null;
  const address = email.trim();
  const emailValid = EMAIL_PATTERN.test(address);
  const codeReady = CODE_PATTERN.test(code);
  const shownError = error && !errorHidden ? error : null;

  const run = async <T,>(step: AuthStep, action: () => T | Promise<T>): Promise<T | undefined> => {
    if (working) return undefined;
    setPending(step);
    try {
      return await action();
    } finally {
      if (mounted.current) setPending(null);
    }
  };

  const sendCode = async (again = false) => {
    if (!emailValid) return;
    setNotice(null);
    const ok = await run('send', () => onEmailRequest(address));
    if (!ok || !mounted.current) return;
    setSent(true);
    setCode('');
    setResendIn(RESEND_AFTER_S);
    const said = again ? 'We sent a new code.' : `We sent a 6-digit code to ${address}.`;
    if (again) setNotice(said);
    announce(said);
  };

  const verify = (value: string) => {
    if (!CODE_PATTERN.test(value)) return;
    void run('verify', () => onEmailVerify(value));
  };

  const changeEmail = () => {
    setSent(false);
    setCode('');
    setNotice(null);
    setErrorHidden(true);
  };

  // With the keyboard up the form can sit below the fold; bring it into view
  // once the keyboard has settled.
  const revealForm = () => {
    setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), D.base);
  };

  return (
    <Screen label="30 Login" ambientIntensity={1.6} ambientPulse>
      <ScrollView
        ref={scroll}
        contentContainerStyle={styles.loginContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.loginTopSpace} />
        <View style={styles.loginHeader}>
          <Txt font="display" weight={700} maxScale={1.2} accessibilityLabel="Evarna" style={styles.wordmark}>evarna</Txt>
          <Txt variant="title3" heading style={styles.loginTitle}>
            {isNew ? 'Welcome to Evarna' : 'Welcome back'}
          </Txt>
          <Txt variant="subhead" style={styles.loginSub}>
            {isNew ? 'Sign in or create an account to meet your companion.' : 'Sign in to pick up where you left off.'}
          </Txt>
        </View>

        <View style={styles.loginActions}>
          {appleAvailable ? (
            <ProviderButton
              label="Continue with Apple"
              icon={<AppleMark />}
              fill={APPLE_FILL}
              ink={APPLE_INK}
              loading={pending === 'apple'}
              disabled={working}
              onPress={() => { void run('apple', onApple); }}
            />
          ) : null}
          <ProviderButton
            label="Continue with Google"
            icon={<GoogleMark />}
            loading={pending === 'google'}
            disabled={working}
            onPress={() => { void run('google', onGoogle); }}
          />

          {!showEmail ? (
            <ProviderButton
              label="Continue with email"
              icon={<MailMark />}
              disabled={working}
              onPress={() => setShowEmail(true)}
            />
          ) : (
            <Animated.View entering={enter.fadeUp} style={styles.emailCard}>
              <GlassFill intensity={20} solid={W.surface2} />
              {sent ? (
                <>
                  <View style={styles.sentRow}>
                    <View style={styles.sentIcon}>
                      <NavIcon name="check" color={W.success} size={18} />
                    </View>
                    <View style={styles.sentText}>
                      <Txt variant="callout" weight={600}>{devCode ? 'Development build' : 'Check your email'}</Txt>
                      <Txt variant="footnote" style={{ color: W.text2 }}>
                        {devCode ? 'No email was sent, so the code is filled in below.' : `We sent a 6-digit code to ${address}.`}
                      </Txt>
                    </View>
                  </View>
                  {/* Submits on the sixth digit: the number pad has no return
                      key, and the button is the thing the keyboard covers. */}
                  <TextInput
                    value={code}
                    onChangeText={v => {
                      const digits = v.replace(/\D/g, '').slice(0, 6);
                      setCode(digits);
                      setErrorHidden(true);
                      setNotice(null);
                      if (digits.length === 6) verify(digits);
                    }}
                    placeholder="6-digit code"
                    placeholderTextColor={W.placeholder}
                    keyboardType="number-pad"
                    autoFocus
                    maxLength={6}
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    accessibilityLabel="6-digit code"
                    maxFontSizeMultiplier={TYPE.title3.maxScale}
                    onFocus={revealForm}
                    style={[styles.input, styles.codeInput, code ? styles.codeSpaced : null]}
                  />
                  <PrimaryButton
                    onPress={() => verify(code)}
                    disabled={!codeReady || (working && pending !== 'verify')}
                    loading={pending === 'verify'}
                  >
                    Verify code
                  </PrimaryButton>
                  <View style={styles.codeLinks}>
                    <TextLink
                      label={resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
                      disabled={resendIn > 0 || working}
                      onPress={() => { void sendCode(true); }}
                    />
                    <TextLink label="Change email" disabled={working} onPress={changeEmail} />
                  </View>
                  {notice ? <InlineNotice tone="success" text={notice} /> : null}
                </>
              ) : (
                <>
                  <TextInput
                    value={email}
                    onChangeText={v => {
                      setEmail(v);
                      setErrorHidden(true);
                    }}
                    onSubmitEditing={() => { void sendCode(); }}
                    placeholder="Email address"
                    placeholderTextColor={W.placeholder}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    returnKeyType="send"
                    autoFocus
                    accessibilityLabel="Email address"
                    maxFontSizeMultiplier={TYPE.body.maxScale}
                    onFocus={revealForm}
                    style={styles.input}
                  />
                  <PrimaryButton
                    onPress={() => { void sendCode(); }}
                    disabled={!emailValid || (working && pending !== 'send')}
                    loading={pending === 'send'}
                  >
                    Send code
                  </PrimaryButton>
                </>
              )}
            </Animated.View>
          )}

          {shownError ? <InlineNotice tone="error" text={shownError} /> : null}
        </View>

        <View style={styles.loginBottomSpace} />
        <LegalConsent />
      </ScrollView>
    </Screen>
  );
}

function ProviderButton({ label, icon, onPress, loading = false, disabled = false, fill, ink = W.text }: {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** A solid fill (Apple's); glass otherwise. */
  fill?: string;
  ink?: string;
}) {
  const press = usePressFeedback({ haptic: false });
  return (
    <Animated.View style={[press.animatedStyle, disabled && !loading ? styles.dimmed : null]}>
      <Pressable
        onPress={() => {
          haptic.light();
          onPress();
        }}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || loading, busy: loading }}
        style={({ pressed }) => [
          styles.provider,
          fill ? { backgroundColor: fill, borderColor: fill } : null,
          pressed ? styles.providerPressed : null,
        ]}
      >
        {fill ? null : <GlassFill intensity={20} solid={W.surface2} />}
        <View style={styles.providerIcon}>
          {loading ? <ActivityIndicator size="small" color={ink} /> : icon}
        </View>
        <Txt variant="button" numberOfLines={1} style={[styles.providerLabel, { color: ink }]}>{label}</Txt>
      </Pressable>
    </Animated.View>
  );
}

function TextLink({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.textLink, pressed || disabled ? styles.dimmed : null]}
    >
      <Txt variant="footnote" weight={600} style={{ color: W.text2 }}>{label}</Txt>
    </Pressable>
  );
}

// "By continuing you agree to…" with the documents this build has actually
// published. With neither published there is nothing to agree to, and no line.
function LegalConsent() {
  const [docs] = useState(legalDocs);
  if (docs.length === 0) return null;
  const openDoc = async (doc: LegalDoc) => {
    if (!(await openLegalDoc(doc))) Alert.alert(doc.title, `Open ${doc.url} in your browser.`);
  };
  return (
    <View style={styles.consent}>
      <Txt variant="footnote" style={styles.consentText}>By continuing, you agree to our</Txt>
      {docs.map((doc, i) => (
        <React.Fragment key={doc.id}>
          {i > 0 ? <Txt variant="footnote" style={styles.consentText}>and</Txt> : null}
          <Pressable
            onPress={() => { void openDoc(doc); }}
            accessibilityRole="link"
            accessibilityHint="Opens in your browser"
            hitSlop={minTarget(HIT, 20)}
            style={({ pressed }) => (pressed ? styles.pressed : null)}
          >
            <Txt variant="footnote" weight={600} style={styles.consentLink}>{doc.title}</Txt>
          </Pressable>
        </React.Fragment>
      ))}
    </View>
  );
}

// Provider marks. Google's four colours and Apple's black are the brands'
// own and have to stay exactly as given.
function GoogleMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.6 9.2c0-.6-.1-1.2-.2-1.7H9v3.3h4.8c-.2 1.1-.9 2.1-1.8 2.7v2.3h3c1.7-1.6 2.6-3.9 2.6-6.6z" />
      <Path fill="#34A853" d="M9 18c2.4 0 4.5-.8 6-2.2l-3-2.3c-.8.5-1.9.9-3 .9-2.3 0-4.3-1.6-5-3.7H1v2.3C2.5 15.9 5.5 18 9 18z" />
      <Path fill="#FBBC05" d="M4 10.7c-.2-.5-.3-1.1-.3-1.7s.1-1.2.3-1.7V5H1C.4 6.2 0 7.5 0 9s.4 2.8 1 4l3-2.3z" />
      <Path fill="#EA4335" d="M9 3.6c1.3 0 2.5.5 3.4 1.3l2.5-2.5C13.5.9 11.4 0 9 0 5.5 0 2.5 2.1 1 5l3 2.3c.7-2.1 2.7-3.7 5-3.7z" />
    </Svg>
  );
}

function AppleMark() {
  return (
    <Svg width={16} height={20} viewBox="0 0 24 28" fill={APPLE_INK}>
      <Path d="M18.7 14.6c0-3.2 2.6-4.8 2.7-4.9-1.5-2.2-3.8-2.5-4.6-2.5-2-.2-3.8 1.1-4.8 1.1-1 0-2.5-1.1-4.2-1.1-2.2 0-4.2 1.3-5.3 3.2-2.3 3.9-.6 9.7 1.6 12.9 1.1 1.6 2.4 3.3 4.1 3.3 1.7-.1 2.3-1.1 4.3-1.1s2.6 1.1 4.3 1c1.8 0 2.9-1.6 4-3.2 1.3-1.8 1.8-3.6 1.8-3.7-.1-.1-3.5-1.3-3.5-5z M15.7 5c.9-1.1 1.5-2.6 1.3-4.1-1.3.1-2.8.9-3.7 2-.8 1-1.6 2.5-1.4 3.9 1.4.1 2.9-.7 3.8-1.8z" />
    </Svg>
  );
}

function MailMark() {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={W.text2} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path d="M3 7l9 6 9-6" />
    </Svg>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  fill: { flex: 1 },
  dimmed: { opacity: 0.45 },
  pressed: { opacity: 0.7 },
  inlineState: { paddingVertical: SP.lg, paddingHorizontal: 0 },

  // S25
  notifBody: { flexGrow: 1, alignItems: 'center', paddingHorizontal: SP.xl, paddingVertical: SP.base },
  flexSpace: { flexGrow: 1, minHeight: SP.base },
  flexSpaceTall: { flexGrow: 1.4, minHeight: SP.base },
  notifTitle: { marginTop: SP.base2, textAlign: 'center', maxWidth: 320 },
  notifSub: { marginTop: SP.sm, color: W.text2, textAlign: 'center', maxWidth: 300 },
  notifPreview: {
    marginTop: SP.xxl, width: '100%', maxWidth: 360, borderRadius: R.lg, padding: SP.md2,
    borderWidth: 1, borderColor: W.hairlineStrong, backgroundColor: W.glassRaised, overflow: 'hidden',
  },
  notifHead: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  appGlyph: {
    width: 24, height: 24, borderRadius: R.xs + R.xxs, backgroundColor: W.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  appGlyphText: { fontSize: 15, lineHeight: 18, color: W.onAccent },
  notifApp: { flex: 1, color: W.text },
  notifFrom: { marginTop: SP.xs2 },
  notifText: { marginTop: SP.xxs, color: W.text },
  notifFoot: { marginTop: SP.md2, color: W.text3, textAlign: 'center', maxWidth: 300 },
  notifActions: { paddingHorizontal: SP.xl, paddingTop: SP.md, paddingBottom: SP.base, gap: SP.xs },

  // S26
  barSlot: { width: 72, flexDirection: 'row', alignItems: 'center' },
  barSlotEnd: { justifyContent: 'flex-end' },
  barTitle: { flexShrink: 1 },
  saveState: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: SP.xs },
  profileContent: { paddingHorizontal: SP.base, paddingTop: SP.sm, paddingBottom: SP.xxl, gap: SP.lg },
  hero: { alignItems: 'center', gap: SP.md, paddingTop: SP.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.xxs, maxWidth: '100%' },
  nameText: { flexShrink: 1, textAlign: 'center' },
  nameInput: {
    minHeight: HIT, minWidth: 180, maxWidth: '100%', paddingHorizontal: SP.md, paddingVertical: SP.xs2,
    borderRadius: R.md, borderWidth: 1, borderColor: rgba(W.primary, 0.4), backgroundColor: W.surface3,
    color: W.text, textAlign: 'center',
    fontFamily: resolveFont('display', 600), fontSize: TYPE.title2.size, letterSpacing: TYPE.title2.letterSpacing,
  },
  sectionTitle: { color: W.text2, paddingHorizontal: SP.xs, paddingBottom: SP.sm },
  sectionCard: {
    borderRadius: R.lg, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glass, overflow: 'hidden',
  },
  sectionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: W.hairlineStrong },
  sectionBody: { padding: SP.md2, gap: SP.base },
  row: {
    minHeight: 52, paddingVertical: SP.sm2, paddingHorizontal: SP.md2,
    flexDirection: 'row', alignItems: 'center', gap: SP.sm2,
  },
  rowPressed: { backgroundColor: W.hairline },
  rowIcon: { flexShrink: 0 },
  rowLabel: { flex: 1, minWidth: 0, color: W.text },
  rowValue: { flexShrink: 1, maxWidth: '60%', textAlign: 'right', color: W.text2 },
  skeletonTraits: { gap: SP.lg },
  skeletonTrait: { gap: SP.sm2 },
  suggestion: { borderRadius: R.md, borderWidth: 1, padding: SP.md2, gap: SP.sm2 },
  suggestionActions: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  cardButtonWrap: { flexGrow: 1, flexBasis: 120 },
  cardButton: {
    minHeight: HIT, paddingHorizontal: SP.md, paddingVertical: SP.sm, borderRadius: R.md, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  cardButtonText: { textAlign: 'center' },
  dangerZone: { gap: SP.sm, alignItems: 'center' },
  deleteLink: {
    minHeight: HIT, maxWidth: '100%', paddingHorizontal: SP.base,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm,
  },
  deleteText: { flexShrink: 1, color: W.dangerText },

  // Trait slider
  trait: { gap: SP.xxs },
  traitHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: SP.sm },
  traitRow: { flexDirection: 'row', alignItems: 'center', gap: SP.xs2 },
  traitMark: { fontSize: 16, lineHeight: 20 },
  traitTouch: { flex: 1, height: HIT, justifyContent: 'center' },
  traitTrack: {
    position: 'absolute', left: THUMB / 2, right: THUMB / 2, top: (HIT - TRACK_H) / 2, height: TRACK_H,
    borderRadius: TRACK_H / 2, backgroundColor: W.hairlineStrong, overflow: 'hidden',
  },
  traitThumb: {
    position: 'absolute', left: 0, top: (HIT - THUMB) / 2, width: THUMB, height: THUMB, borderRadius: THUMB / 2,
    backgroundColor: W.cream, borderWidth: 2, borderColor: W.primary, ...ELEV.low,
  },

  // Voice picker
  voiceList: { gap: SP.sm },
  voiceRow: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm, paddingRight: SP.sm,
    borderRadius: R.md, borderWidth: 1, borderColor: W.hairline, backgroundColor: W.glass,
  },
  voiceMain: { flex: 1, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.sm2, paddingLeft: SP.md },
  voiceText: { flex: 1, minWidth: 0 },
  radio: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: W.text3,
    alignItems: 'center', justifyContent: 'center',
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },

  // S27
  depletedBody: { flexDirection: 'row', alignItems: 'flex-start', gap: SP.md },
  depletedText: { flex: 1, minWidth: 0 },
  depletedReset: { marginTop: SP.xs2, color: W.text2 },

  // S28 and the crisis banner
  crisisBanner: {
    minHeight: HIT, paddingHorizontal: SP.base, flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    backgroundColor: rgba(W.warning, 0.08), borderBottomWidth: 1, borderBottomColor: rgba(W.warning, 0.18),
  },
  crisisBannerPressed: { backgroundColor: rgba(W.warning, 0.16) },
  crisisBannerText: { flexShrink: 1, color: W.text2 },
  crisisContent: { paddingHorizontal: SP.base, paddingTop: SP.sm, paddingBottom: SP.xxl },
  crisisIntro: { alignItems: 'center', paddingHorizontal: SP.sm, paddingBottom: SP.sm },
  crisisBadge: {
    width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.warning, 0.12), borderWidth: 1, borderColor: rgba(W.warning, 0.24),
  },
  crisisTitle: { marginTop: SP.md2, textAlign: 'center' },
  crisisLead: { marginTop: SP.xs2, color: W.text2, textAlign: 'center', maxWidth: 320 },
  crisisSection: { color: W.text2, marginTop: SP.xl, marginBottom: SP.sm, paddingHorizontal: SP.xs },
  crisisList: { gap: SP.sm },
  crisisRow: {
    minHeight: 64, paddingVertical: SP.md, paddingHorizontal: SP.md2,
    flexDirection: 'row', alignItems: 'center', gap: SP.md,
    borderRadius: R.md2, borderWidth: 1, borderColor: rgba(W.warning, 0.16), backgroundColor: W.glass,
  },
  crisisRowPressed: { backgroundColor: rgba(W.warning, 0.1) },
  crisisIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  crisisRowText: { flex: 1, minWidth: 0, gap: SP.xxs },
  crisisNotice: { marginTop: SP.md },
  crisisNote: { marginTop: SP.xl, color: W.text3, textAlign: 'center', paddingHorizontal: SP.base },

  // S29
  recapMeta: { flexDirection: 'row', alignItems: 'center', gap: SP.sm2, minHeight: 32 },
  recapSection: { marginTop: SP.lg },
  recapSectionTitle: { color: W.text2, marginBottom: SP.sm },
  recapWaiting: { gap: SP.sm2 },
  recapNotice: { marginBottom: SP.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs2 },
  chip: {
    paddingVertical: SP.xs2, paddingHorizontal: SP.md, borderRadius: R.pill,
    backgroundColor: W.hairline, borderWidth: 1, borderColor: W.hairline,
  },
  memoryList: { gap: SP.xs2 },
  memoryRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: SP.sm2,
    paddingVertical: SP.sm2, paddingLeft: SP.md, paddingRight: SP.xs,
    borderRadius: R.sm2, borderWidth: 1, borderColor: rgba(W.gold, 0.15), backgroundColor: rgba(W.gold, 0.06),
  },
  memoryType: { marginTop: SP.xxs, paddingVertical: SP.xxs, paddingHorizontal: SP.xs2, borderRadius: R.xs },
  memoryText: { flex: 1, color: W.text },
  memoryForget: { marginTop: -SP.xs },

  // S30
  loginContent: { flexGrow: 1, paddingHorizontal: SP.xl, paddingTop: SP.base, paddingBottom: SP.base },
  loginTopSpace: { flexGrow: 0.7, minHeight: SP.base },
  loginBottomSpace: { flexGrow: 1, minHeight: SP.xl },
  loginHeader: { alignItems: 'center' },
  wordmark: { fontSize: 34, lineHeight: 40, letterSpacing: -1, color: W.primary },
  loginTitle: { marginTop: SP.md2, textAlign: 'center' },
  loginSub: { marginTop: SP.xs2, color: W.text2, textAlign: 'center', maxWidth: 320 },
  loginActions: { marginTop: SP.xxl, gap: SP.md },
  provider: {
    minHeight: 52, paddingHorizontal: SP.base, paddingVertical: SP.sm2, borderRadius: R.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SP.sm2,
    borderWidth: 1, borderColor: W.hairlineStrong, backgroundColor: W.glass, overflow: 'hidden',
  },
  providerPressed: { opacity: 0.8 },
  providerIcon: { width: 20, alignItems: 'center' },
  providerLabel: { flexShrink: 1 },
  emailCard: {
    padding: SP.md2, gap: SP.sm2, borderRadius: R.lg, borderWidth: 1,
    borderColor: rgba(W.primary, 0.18), backgroundColor: W.glass, overflow: 'hidden',
  },
  sentRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm2, paddingVertical: SP.xs },
  sentIcon: {
    width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: rgba(W.success, 0.12),
  },
  sentText: { flex: 1, minWidth: 0 },
  input: {
    minHeight: 48, paddingHorizontal: SP.md2, paddingVertical: SP.sm2, borderRadius: R.md,
    borderWidth: 1, borderColor: W.hairlineStrong, backgroundColor: W.surface3,
    color: W.text, fontFamily: resolveFont('user', 400), fontSize: TYPE.body.size,
  },
  codeInput: { textAlign: 'center', fontSize: TYPE.title3.size },
  // Spaced digits read as a code; a spaced placeholder only reads as odd.
  codeSpaced: { letterSpacing: 6 },
  codeLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: SP.sm },
  textLink: { minHeight: HIT, justifyContent: 'center', paddingHorizontal: SP.xs },
  consent: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center',
    columnGap: SP.xs, paddingHorizontal: SP.sm, paddingBottom: SP.xs,
  },
  consentText: { color: W.text3 },
  consentLink: { color: W.text2, textDecorationLine: 'underline' },
});
