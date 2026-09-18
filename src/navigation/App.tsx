// App.tsx (navigation) — the router: who the user is, what they have, and
// where they are in the app.
//
// Navigation is a stack of routes (history.ts) drawn by ScreenStack. While
// signed in, the bottom of the stack is the tab layer: the four tab roots stay
// mounted, so switching tabs keeps each one's scroll position and data, and
// everything else is pushed on top of it. Screens still call go(name); the
// router reads that against history, so naming the screen you came from goes
// back to it, naming a tab switches to it, and the paywall, the out-of-minutes
// sheet and the conversation recap open as sheets over the screen you're on,
// which stays mounted underneath.
//
// Launch trusts what this phone already knows. With a saved session the app
// opens straight onto Home from the last known data and checks the session in
// the background; only a session the server has actually ended goes back to
// the login screen. Being offline, or the server having a bad moment, is not a
// reason to sign anyone out.

import React, { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, BackHandler, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

import { MOTION, W, Z } from '../theme/theme';
import { exit, useReducedMotion } from '../theme/motion';
import type { PaywallTrigger, ScreenName } from './types';
import {
  BACK_ALIASES, inTabs, indexBelowTop, isTabsBase, pop, popTo, push, replaceAbove, replaceTop,
  resetToFlow, resetToTabs, route, switchTab, tabForRoot, top,
  type NavState, type Route, type RouteParams,
} from './history';
import { ScreenStack, TabRoots } from './ScreenStack';
import { BusyOverlay, FullScreenState, ToastHost, type ToastItem, type ToastSpec } from './Feedback';
import { emitTabReselect } from './tabEvents';
import {
  CONFIG, SCENARIOS, SANDBOX_MODES, ARCHETYPE_COLORS, type Companion, type Scenario, type SandboxMode,
} from '../data/config';
import {
  onboardUser, getVoices, getUserCharacters, createCharacter,
  signInWithGoogle, requestEmailCode, verifyEmailCode, getMe,
  updateCharacter, deleteCharacter, updateMe, deleteMe,
  getScenarios, getStudioCharacters, deleteStudioCharacter, setPushToken, getEntitlement,
  type ApiCharacter, type ApiEntitlement, type ApiMe, type ApiScenario, type ApiStudioCharacter,
  type ApiVoice, type AuthSession, type UpdateCharacterPayload,
} from '../api';
import {
  API_MISCONFIGURED, ApiError, AuthExpiredError, getAuthToken, isNetworkError, limitMessage,
  loadAuthToken, setAuthToken, streamConversation, subscribeAuthExpired,
} from '../api/client';
import { readCache, writeCache, clearUserCache } from '../lib/cache';
import { getGoogleIdToken, googleSignOut, GoogleSignInUnavailable } from '../lib/googleSignIn';
import { formatResetDate } from '../lib/entitlement';
import { purchasesSignIn, purchasesSignOut } from '../lib/purchases';
import {
  requestPushPermission, getPushTokenIfGranted, getDeviceTimezone, getPushPermissionStatus,
  addPushTapListener, addPushReplyListener, notifyReplyFailed, saveUnsentReply, takeUnsentReply,
  getInitialPushTap, type PushTapData,
} from '../lib/notifications';
import { haptic } from '../lib/haptics';
import { announce, useScreenReader } from '../hooks/useAccessibilityPrefs';
import { BottomNav, type TabId } from '../components/BottomNav';
import { ErrorBoundary } from '../components/ErrorBoundary';

import {
  S01_Splash, S02_Age, S03_Disclosure, S05_Pronouns, S06_Comm, S_Handoff,
  S04_Archetype, S07_Voice, S08_Name, S_Meet, type PickNameResult,
} from '../screens/Onboarding';
import { S10_Home } from '../screens/Home';
import { S09_FirstChat, S14_Chat } from '../screens/Chat';
import { S12_VoiceCall } from '../screens/VoiceCall';
import {
  S15_StudioHome, S16_ScenarioSetup, S17_StudioSession, S18_CharacterCreator,
} from '../screens/Studio';
import { S19_SandboxHome, S20_SandboxSession } from '../screens/Sandbox';
import { S21_Settings, S22_Memories, S23_Paywall, S_UserProfile } from '../screens/Settings';
import {
  S25_NotifPermission, S26_CompanionEdit, S27_StartCallDepleted,
  S28_CrisisChat, S29_Recap, S30_Login,
} from '../screens/Extras';

// ── Storage keys ───────────────────────────────────────────────────────
const SESSION_KEY = 'evarna_session';
// Set at the first sign-in and kept through sign-out, so the login screen can
// tell a first visit from a return. A reinstall clears it.
const SIGNED_IN_KEY = 'evarna_signed_in_before';
// Per-user stale-while-revalidate entries (lib/cache.ts).
const CACHE = {
  characters: 'characters',
  entitlement: 'entitlement',
  studio: 'studio-characters',
  studioMemory: 'studio-memory',
} as const;

// ── Timing ─────────────────────────────────────────────────────────────
/** Coming back to the app refreshes lists at most this often. */
const FOREGROUND_REFRESH_MS = 30_000;
/** Arriving on Home, Studio or Settings refreshes their data at most this often. */
const FOCUS_REFRESH_MS = 3_000;
/** Sign-out asks the server to stop pushing to this phone for at most this
 *  long before carrying on locally. */
const SIGN_OUT_GRACE_MS = 4_000;
const SDK_SIGN_OUT_GRACE_MS = 1_500;

// Phase 1 cap until the paywall sells more companions.
const MAX_COMPANIONS = 5;

// Archetype names: the app says 'friend', the backend 'bestfriend'.
const ARCHETYPE_MAP: Record<string, string> = {
  friend: 'bestfriend', mentor: 'mentor', partner: 'partner', challenger: 'challenger',
};
const ARCHETYPE_MAP_REV: Record<string, Companion['archetype']> = {
  bestfriend: 'friend', friend: 'friend',
  mentor: 'mentor', partner: 'partner', challenger: 'challenger',
};

const INTENT_MAP: Record<string, string> = {
  mentor: 'personal development', friend: 'emotional support',
  partner: 'connection', challenger: 'accountability',
};

/** Screens where an edge swipe must not go back. */
const NO_SWIPE_BACK: ReadonlySet<ScreenName> = new Set<ScreenName>([
  // Ending a call by brushing the screen edge would be a nasty surprise.
  'call',
  // These save or commit when left through their own controls, so a swipe
  // would quietly drop edits.
  'profile', 'user-profile', 'character-creator',
  // Past account creation there is nothing to go back to.
  'meet', 'notif', 'first-chat',
]);

// ── Types ──────────────────────────────────────────────────────────────
type LoadStatus = 'loading' | 'ready' | 'error';

/** Sheets drawn over the current screen, which stays mounted beneath. */
type Overlay =
  /** No trigger: a neutral headline, e.g. from Settings' plan row. */
  | { kind: 'paywall'; trigger?: PaywallTrigger }
  | { kind: 'callDepleted'; companion: Companion }
  | { kind: 'recap'; companion: Companion };

type Launch =
  /** Reading what this phone knows; nothing is drawn yet. */
  | { kind: 'reading' }
  /** Signed in with nothing saved here: the splash waits for the server. */
  | { kind: 'confirming' }
  | { kind: 'ready' }
  /** Signed in with nothing saved here, and the server can't be reached. */
  | { kind: 'unreachable'; reason: 'offline' | 'server'; retrying: boolean }
  | { kind: 'misconfigured' };

/** What survives a relaunch so Home can paint before the network answers. */
interface SessionBlob {
  userId: string;
  onboarded?: boolean;
  /** The first companion, from sessions saved before `onboarded` existed. */
  characterId?: string;
  companion?: Companion;
  isMinor?: boolean;
  userName?: string;
}

/** The screen a go() call came from. Tab roots share the tab layer's key. */
type Caller = { key: string; tab?: TabId };

// ── Helpers ────────────────────────────────────────────────────────────
function apiCharacterToCompanion(c: ApiCharacter): Companion {
  return {
    id: c._id,
    name: c.name,
    archetype: ARCHETYPE_MAP_REV[c.archetype] ?? 'mentor',
    gender: c.gender,
    voice: c.voice_id,
    lastInteractionAt: c.last_interaction_at,
    lastMessagePreview: c.last_message_preview ?? undefined,
    memoryHighlight: c.memory_highlight ?? undefined,
    memory: c.memory_highlight ?? undefined,
    personalitySliders: c.personality_sliders,
  };
}

const lastTalkedAt = (iso?: string) => (iso ? new Date(iso).getTime() : 0);

function byRecent(list: ApiCharacter[]): ApiCharacter[] {
  return [...list].sort((a, b) => lastTalkedAt(b.last_interaction_at) - lastTalkedAt(a.last_interaction_at));
}

// Studio cards carry an icon and accent the backend doesn't return. Match a
// scenario character to its local look; custom characters get a neutral one.
function studioScenarioFor(c: ApiStudioCharacter): Scenario {
  return SCENARIOS.find(s => s.id === c.scenario_id)
    ?? { id: 'custom', icon: 'sparkle', name: c.name, desc: '', accent: W.secondary };
}

const idOf = (c: Companion) => String(c.id);

/** What a companion screen needs to find its companion again. */
const companionParams = (c: Companion): RouteParams => ({ companionId: idOf(c), companion: c });

function parseBlob(raw: string | null): SessionBlob | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as SessionBlob | null;
    return b && typeof b.userId === 'string' && b.userId ? b : null;
  } catch {
    return null;
  }
}

/** The headline for a paywall a screen opened without naming a reason.
 *  None is honest when nothing specific prompted it (Settings' plan row). */
function triggerFor(from: Route): PaywallTrigger | undefined {
  switch (from.name) {
    case 'call': return 'voice';
    case 'studio':
    case 'scenario-setup':
    case 'studio-session':
    case 'character-creator': return 'studio';
    default: return undefined;
  }
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** "3 minutes", "an hour": how long until something may be tried again. */
function waitPhrase(seconds: number): string {
  if (seconds < 60) return 'a minute';
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return hours <= 1 ? 'an hour' : `${hours} hours`;
}

const CANT_REACH = "Can't reach Evarna. Check your connection and try again.";
const SERVER_TROUBLE = 'Evarna is having trouble right now. Please try again in a moment.';

/** A failure in words for the person who hit it, never a status code or a debug label. */
function problemMessage(e: unknown, fallback: string): string {
  if (isNetworkError(e)) return CANT_REACH;
  if (e instanceof ApiError) {
    if (e.status === 429) return e.retryAfter ? `Too many attempts. Try again in ${waitPhrase(e.retryAfter)}.` : (e.serverMessage ?? fallback);
    if (e.status >= 500) return SERVER_TROUBLE;
    if (e.serverMessage) return e.serverMessage;
  }
  return fallback;
}

/** Sign-in wording: a wrong code, a busy inbox and a dead connection are different problems. */
function authProblem(e: unknown, step: 'request' | 'verify' | 'oauth'): string {
  if (e instanceof ApiError && (e.code === 'RATE_LIMITED' || e.status === 429)) {
    return e.retryAfter
      ? `Too many attempts. Try again in ${waitPhrase(e.retryAfter)}.`
      : (e.serverMessage ?? 'Too many attempts. Please wait a few minutes and try again.');
  }
  if (step === 'verify' && (e instanceof AuthExpiredError || (e instanceof ApiError && (e.status === 400 || e.status === 401)))) {
    return (e instanceof ApiError && e.serverMessage) || 'That code is wrong or has expired.';
  }
  if (step === 'request' && e instanceof ApiError && e.status === 400) {
    return e.serverMessage ?? "That email address doesn't look right.";
  }
  const fallback = step === 'request'
    ? "Couldn't send a code just now. Please try again."
    : step === 'verify'
      ? "Couldn't check that code just now. Please try again."
      : "Couldn't sign you in. Please try again.";
  return problemMessage(e, fallback);
}

/** What VoiceOver says when a screen arrives. Empty for sheets, which speak for themselves. */
function spokenTitle(r: Route, companion: Companion | null, extra: { scenario?: string; mode?: string; meet?: string }): string {
  const name = companion?.name;
  switch (r.name) {
    case 'home': return 'Home';
    case 'studio': return 'Studio';
    case 'sandbox': return 'Sandbox';
    case 'settings': return 'Settings';
    case 'chat':
    case 'first-chat': return name ? `Chat with ${name}` : 'Chat';
    case 'call': return name ? `Call with ${name}` : 'Call';
    case 'profile': return name ? `${name}'s profile` : 'Companion profile';
    case 'user-profile': return 'Your profile';
    case 'memories': return 'Memories';
    case 'crisis': return 'Support resources';
    case 'scenario-setup':
    case 'studio-session': return extra.scenario ?? 'Studio';
    case 'character-creator': return 'Create a character';
    case 'sandbox-session': return extra.mode ?? 'Sandbox';
    case 'login': return 'Sign in';
    case 'splash': return 'Evarna';
    case 'meet': return extra.meet ? `Meet ${extra.meet}` : 'Meet your companion';
    case 'notif': return 'Notifications';
    case 'age':
    case 'disclosure':
    case 'pronouns':
    case 'comm':
    case 'handoff':
    case 'archetype':
    case 'voice':
    case 'name': return 'Setting up';
    case 'paywall':
    case 'callDepleted':
    case 'recap': return '';
  }
}

/** Calls the latest `fn` through a function whose identity never changes, so
 *  screens (and frozen screens holding old props) always reach current state. */
function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/** Stands in for a route with nothing to show and moves the user on, rather
 *  than drawing Home under that route's name. `report` flags a route that
 *  should never exist, once. */
function Redirect({ to, report }: { to: () => void; report?: string }) {
  const first = useRef({ to, report });
  useEffect(() => {
    if (first.current.report) Sentry.captureMessage(first.current.report);
    first.current.to();
  }, []);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
export default function App() {
  const reduced = useReducedMotion();
  const screenReader = useScreenReader();

  // ── Navigation state ────────────────────────────────────────────────
  // Mirrored in a ref so calls in quick succession (a sheet's trigger, then
  // the sheet) always build on the latest stack.
  const [nav, setNavState] = useState<NavState>(() => ({ tab: 'home', routes: [route('splash')] }));
  const navRef = useRef(nav);
  const setNav = useCallback((update: (s: NavState) => NavState) => {
    const next = update(navRef.current);
    if (next === navRef.current) return;
    navRef.current = next;
    setNavState(next);
  }, []);

  const [overlay, setOverlayState] = useState<Overlay | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const setOverlay = useCallback((o: Overlay | null) => {
    overlayRef.current = o;
    setOverlayState(o);
  }, []);
  // Set by onCapUpgrade just before the screen asks for the paywall.
  const pendingTrigger = useRef<PaywallTrigger | null>(null);

  const [launch, setLaunch] = useState<Launch>(() => (API_MISCONFIGURED ? { kind: 'misconfigured' } : { kind: 'reading' }));
  // A notification tap that launched the app, opened once Home is up.
  const initialPush = useRef<PushTapData | null>(null);

  // ── Feedback ────────────────────────────────────────────────────────
  const [toast, setToast] = useState<ToastItem | null>(null);
  const toastSeq = useRef(0);
  const showToast = useCallback((spec: ToastSpec) => {
    toastSeq.current += 1;
    setToast({ ...spec, id: toastSeq.current });
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToast(current => (current && current.id === id ? null : current));
  }, []);
  const [busy, setBusyState] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const setBusy = useCallback((label: string | null) => {
    busyRef.current = label;
    setBusyState(label);
  }, []);

  // ── Sign-in screen ──────────────────────────────────────────────────
  const [isNewUser, setIsNewUser] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  // Set only when the backend could not actually send the mail (development
  // with no provider): it returns the code so the flow can still be finished.
  const [devCode, setDevCode] = useState<string | null>(null);
  // After a 429 with Retry-After, asking again waits instead of failing again.
  const emailCooldownUntil = useRef(0);

  // ── Who the user is ─────────────────────────────────────────────────
  const [userId, setUserIdState] = useState<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const setUserId = useCallback((id: string | null) => {
    userIdRef.current = id;
    setUserIdState(id);
  }, []);
  const [onboarded, setOnboarded] = useState(false);
  const onboardedRef = useRef(onboarded);
  onboardedRef.current = onboarded;
  const [userName, setUserName] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [isMinor, setIsMinor] = useState(false);
  const [settings, setSettings] = useState({ dailyCheckin: true });
  // Bumped on sign-out, so answers still in flight for the previous account
  // are dropped instead of landing in the next one.
  const sessionEpoch = useRef(0);

  // ── Onboarding picks ────────────────────────────────────────────────
  const [addMode, setAddMode] = useState<'onboarding' | 'add'>('onboarding');
  const [voicePick, setVoicePick] = useState<string | null>(null);
  const [archetypePick, setArchetypePick] = useState<Companion['archetype']>('mentor');
  // Empty until named on S08; there is no default name for a companion.
  const [companionName, setCompanionName] = useState('');
  // Empty until chosen on S02. It used to default to an invented birthday.
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [userGender, setUserGender] = useState('non-binary');
  const [commStyle, setCommStyle] = useState('warm');
  // The companion just created on S08: Meet introduces it, S09 talks to it.
  const [created, setCreated] = useState<Companion | null>(null);
  const [chosenVoiceId, setChosenVoiceId] = useState<string | null>(null);
  // Read ahead of Meet's button, so the notification ask can be slotted in
  // without a pause.
  const pushStatus = useRef<'granted' | 'denied' | 'undetermined' | null>(null);

  // ── What the user has ───────────────────────────────────────────────
  // null until known, from this phone's cache or the server.
  const [characters, setCharacters] = useState<Companion[] | null>(null);
  const [charactersFailed, setCharactersFailed] = useState(false);
  // The saved session's companion: something true to show while the list loads.
  const [savedCompanion, setSavedCompanion] = useState<Companion | null>(null);
  const [serverLimitReason, setServerLimitReason] = useState<string | null>(null);

  // A degraded payload is discarded, not stored. The server fails open by
  // answering "free, full allowance, period starts now", so rendering it would
  // tell a Plus subscriber they had been downgraded. Keeping the last known
  // values is the lesser wrong; with nothing known, the UI says "unknown".
  const [entitlement, setEntitlementState] = useState<ApiEntitlement | null>(null);
  const entitlementRef = useRef<ApiEntitlement | null>(null);
  const [entitlementFailed, setEntitlementFailed] = useState(false);

  const [voices, setVoices] = useState<ApiVoice[]>([]);
  const voicesRef = useRef<ApiVoice[]>([]);
  const [voicesStatus, setVoicesStatus] = useState<LoadStatus>('loading');

  const [scenarios, setScenarios] = useState<ApiScenario[] | null>(null);
  const scenariosRef = useRef<ApiScenario[] | null>(null);
  const [scenariosStatus, setScenariosStatus] = useState<LoadStatus>('loading');
  const [studioCharacters, setStudioCharacters] = useState<ApiStudioCharacter[] | null>(null);
  const [studioFailed, setStudioFailed] = useState(false);
  // Each Studio character's "remember this session" choice, so resuming a
  // one-time session doesn't quietly turn memory back on.
  const [studioMemory, setStudioMemory] = useState<Record<string, boolean>>({});

  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [studioCharacter, setStudioCharacter] = useState<ApiStudioCharacter | null>(null);
  const [studioCharacterId, setStudioCharacterId] = useState<string | null>(null);
  const [studioRemember, setStudioRemember] = useState(true);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode | null>(null);

  // ── Derived ─────────────────────────────────────────────────────────
  const companions: Companion[] = characters ?? (savedCompanion ? [savedCompanion] : []);
  const companionsRef = useRef(companions);
  companionsRef.current = companions;
  const companionById = (id?: string) => (id ? companions.find(c => idOf(c) === id) : undefined);
  /** The live copy of a route's companion, or its last known copy while the list catches up. */
  const companionFor = (r: Route): Companion | null =>
    companionById(r.params?.companionId) ?? r.params?.companion ?? null;

  const displayName = userName.trim();
  const homeStatus: LoadStatus = charactersFailed ? 'error' : characters === null ? 'loading' : 'ready';
  const studioStatus: LoadStatus = studioFailed ? 'error' : studioCharacters === null ? 'loading' : 'ready';
  const quota = {
    textRemainingToday: entitlement ? entitlement.text.remaining_today : null,
    textDailyCap: entitlement ? entitlement.text.daily_cap : null,
    textResetsAt: entitlement ? entitlement.text.resets_at : null,
    textUpsell: entitlement ? entitlement.tier === 'free' : true,
  };

  // ── Data: companions ────────────────────────────────────────────────
  const charactersSeq = useRef(0);
  const refreshUserCharacters = useCallback(async (): Promise<Companion[] | null> => {
    const seq = ++charactersSeq.current;
    try {
      const list = byRecent(await getUserCharacters()).map(apiCharacterToCompanion);
      // An older request that lands late must not overwrite a newer answer.
      if (seq === charactersSeq.current) {
        setCharacters(list);
        setCharactersFailed(false);
        const uid = userIdRef.current;
        if (uid) void writeCache(uid, CACHE.characters, list);
      }
      return list;
    } catch (e) {
      if (seq === charactersSeq.current && !(e instanceof AuthExpiredError)) setCharactersFailed(true);
      return null;
    }
  }, []);

  // ── Data: entitlement ───────────────────────────────────────────────
  const applyEntitlement = useCallback((e: ApiEntitlement) => {
    entitlementRef.current = e;
    setEntitlementState(e);
    setEntitlementFailed(false);
    const uid = userIdRef.current;
    if (uid) void writeCache(uid, CACHE.entitlement, e);
  }, []);

  // One read at a time per account: opening and closing the paywall quickly
  // would otherwise race two reads, and the older answer could land last.
  const entitlementInFlight = useRef<{ epoch: number; request: Promise<ApiEntitlement | null> } | null>(null);
  const refreshEntitlement = useCallback((): Promise<ApiEntitlement | null> => {
    const epoch = sessionEpoch.current;
    const pending = entitlementInFlight.current;
    if (pending && pending.epoch === epoch) return pending.request;
    const request = getEntitlement()
      .then(e => {
        if (epoch !== sessionEpoch.current) return null;
        if (e.degraded) {
          if (!entitlementRef.current) setEntitlementFailed(true);
          return null;
        }
        applyEntitlement(e);
        return e;
      })
      .catch((): null => {
        if (epoch === sessionEpoch.current) setEntitlementFailed(true);
        return null;
      })
      .finally(() => {
        if (entitlementInFlight.current?.request === request) entitlementInFlight.current = null;
      });
    entitlementInFlight.current = { epoch, request };
    return request;
  }, [applyEntitlement]);

  // ── Data: voices (a public route, so they can load before sign-in) ──
  const loadVoices = useCallback(async (): Promise<ApiVoice[]> => {
    if (!voicesRef.current.length) setVoicesStatus('loading');
    try {
      const list = await getVoices();
      voicesRef.current = list;
      setVoices(list);
      setVoicesStatus('ready');
      return list;
    } catch {
      setVoicesStatus(voicesRef.current.length ? 'ready' : 'error');
      return voicesRef.current;
    }
  }, []);

  // ── Data: Studio (token-scoped, so never asked for without a session) ─
  const loadScenarios = useCallback(async () => {
    if (!getAuthToken()) return;
    if (!scenariosRef.current) setScenariosStatus('loading');
    try {
      const list = await getScenarios();
      scenariosRef.current = list;
      setScenarios(list);
      setScenariosStatus('ready');
    } catch {
      setScenariosStatus(scenariosRef.current ? 'ready' : 'error');
    }
  }, []);

  const studioSeq = useRef(0);
  const refreshStudio = useCallback(async () => {
    if (!getAuthToken()) return;
    const seq = ++studioSeq.current;
    try {
      const list = await getStudioCharacters();
      if (seq !== studioSeq.current) return;
      setStudioCharacters(list);
      setStudioFailed(false);
      const uid = userIdRef.current;
      if (uid) void writeCache(uid, CACHE.studio, list);
    } catch (e) {
      if (seq === studioSeq.current && !(e instanceof AuthExpiredError)) setStudioFailed(true);
    }
  }, []);

  // ── Push ────────────────────────────────────────────────────────────
  // Fire-and-forget with caught errors: a user whose notification permission
  // is broken must still be able to use the app. The timezone rides along
  // with the token so check-ins respect quiet hours where the user is now.
  const uploadPushToken = useCallback((token: string | null) => {
    if (!token) return;
    setPushToken(token, getDeviceTimezone()).catch(() => {});
  }, []);
  // Launch and sign-in refresh. Never prompts: the ask belongs to S25.
  const refreshPushToken = useCallback(() => {
    getPushTokenIfGranted().then(uploadPushToken).catch(() => {});
  }, [uploadPushToken]);
  const prefetchPushStatus = useCallback(() => {
    getPushPermissionStatus().then(s => { pushStatus.current = s; }).catch(() => {});
  }, []);

  // ── Session ─────────────────────────────────────────────────────────
  const applyMe = useCallback((me: ApiMe) => {
    setUserId(me.user_id);
    if (me.display_name) setUserName(me.display_name);
    setUserEmail(me.email ?? '');
    setIsMinor(!!me.is_minor);
    setSettings({ dailyCheckin: me.checkins_enabled !== false });
  }, [setUserId]);

  /** Paints what this phone last saw for `uid`, without overwriting anything
   *  newer. Returns the saved companions, which the first screen may need
   *  before React has rendered them. */
  const hydrateFromCache = useCallback(async (uid: string): Promise<Companion[] | null> => {
    const [cachedCharacters, cachedEntitlement, cachedStudio, cachedMemory] = await Promise.all([
      readCache<Companion[]>(uid, CACHE.characters),
      readCache<ApiEntitlement>(uid, CACHE.entitlement),
      readCache<ApiStudioCharacter[]>(uid, CACHE.studio),
      readCache<Record<string, boolean>>(uid, CACHE.studioMemory),
    ]);
    if (userIdRef.current !== uid) return null;
    if (cachedCharacters) setCharacters(prev => prev ?? cachedCharacters);
    if (cachedEntitlement && !entitlementRef.current) {
      entitlementRef.current = cachedEntitlement;
      setEntitlementState(cachedEntitlement);
    }
    if (cachedStudio) setStudioCharacters(prev => prev ?? cachedStudio);
    if (cachedMemory) setStudioMemory(prev => ({ ...cachedMemory, ...prev }));
    return cachedCharacters;
  }, []);

  /** Everything a signed-in, onboarded session keeps fresh. */
  const refreshAll = useCallback(() => {
    void refreshUserCharacters();
    void refreshEntitlement();
    refreshPushToken();
  }, [refreshUserCharacters, refreshEntitlement, refreshPushToken]);

  /** Local sign-out: forget this account on this phone. Makes no requests. */
  const teardownLocal = useEvent(() => {
    sessionEpoch.current += 1;
    charactersSeq.current += 1;
    studioSeq.current += 1;
    setAuthToken(null);
    AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    void clearUserCache();
    purchasesSignOut().catch(() => {});
    setUserId(null);
    setOnboarded(false);
    setUserName('');
    setUserEmail('');
    setIsMinor(false);
    setSettings({ dailyCheckin: true });
    setCharacters(null);
    setCharactersFailed(false);
    setSavedCompanion(null);
    setServerLimitReason(null);
    entitlementRef.current = null;
    setEntitlementState(null);
    setEntitlementFailed(false);
    scenariosRef.current = null;
    setScenarios(null);
    setScenariosStatus('loading');
    setStudioCharacters(null);
    setStudioFailed(false);
    setStudioMemory({});
    setCreated(null);
    setChosenVoiceId(null);
    setCompanionName('');
    setVoicePick(null);
    setDateOfBirth('');
    setAddMode('onboarding');
    setPendingEmail('');
    setDevCode(null);
    setOverlay(null);
  });

  // The server ended this session (it expired, or the account signed out on
  // another device). The client has already dropped the token; tidy up and
  // say what happened.
  useEffect(() => subscribeAuthExpired(() => {
    teardownLocal();
    setBusy(null);
    setIsNewUser(false);
    setAuthError('Your session ended. Please sign in again.');
    setLaunch({ kind: 'ready' });
    setNav(s => resetToFlow(s, route('login')));
  }), [teardownLocal, setBusy, setNav]);

  // ── Navigation actions ──────────────────────────────────────────────
  const closeOverlay = useCallback(() => setOverlay(null), [setOverlay]);
  const back = useEvent(() => setNav(s => pop(s)));
  // Only the screen that was swiped leaves, even if something else arrived mid-swipe.
  const swipedBack = useEvent((key: string) => setNav(s => (top(s).key === key ? pop(s) : s)));

  const openPaywall = useEvent((trigger?: PaywallTrigger) => {
    pendingTrigger.current = null;
    // The sheet shows the balance and the catalog, so re-read on the way in.
    void refreshEntitlement();
    setOverlay({ kind: 'paywall', trigger });
  });

  const openChat = useEvent(async (c: Companion, draft?: string) => {
    // A mood from Home is the draft; otherwise offer back a reply that failed
    // to send from the notification shade, so nothing typed is lost.
    const text = draft ?? (await takeUnsentReply(idOf(c)).catch(() => null)) ?? undefined;
    setOverlay(null);
    setNav(s => {
      const t = top(s);
      if (t.name === 'chat' && t.params?.companionId === idOf(c)) return s;
      const next = route('chat', { ...companionParams(c), ...(text ? { draft: text } : {}) });
      // Chats don't stack on chats, and a call that has been left is over.
      return t.name === 'chat' || t.name === 'call' ? replaceTop(s, next) : push(s, next);
    });
  });

  /** The balance we already know decides: someone with nothing left gets the
   *  out-of-minutes sheet rather than a call that fails on connect. An unknown
   *  balance dials anyway and lets the server decide, because "we couldn't
   *  read your plan" must not read as "you're out of minutes". */
  const startCall = useEvent((c: Companion) => {
    const e = entitlementRef.current;
    if (e && e.voice.remaining_seconds <= 0) {
      setOverlay({ kind: 'callDepleted', companion: c });
      return;
    }
    setOverlay(null);
    setNav(s => (top(s).name === 'call' ? s : push(s, route('call', companionParams(c)))));
  });

  /** Leaves the call screen (which hangs up), then runs `then`. */
  const leaveCall = useEvent((then?: () => void) => {
    setNav(s => (top(s).name === 'call' ? pop(s) : s));
    then?.();
  });

  const finishAddCompanion = useEvent(() => {
    setAddMode('onboarding');
    void refreshUserCharacters();
    setNav(s => (inTabs(s) ? switchTab(s, 'home') : resetToTabs('home')));
  });

  /** Meet's "Say hi": the notification ask comes first when it hasn't been answered. */
  const continueFromMeet = useEvent(async (from: Route) => {
    const status = pushStatus.current ?? await getPushPermissionStatus().catch(() => 'undetermined' as const);
    if (top(navRef.current).key !== from.key) return;
    const adding = addMode === 'add';
    if (status === 'undetermined') {
      setNav(s => push(s, route('notif', { next: adding ? 'home' : 'first-chat' })));
      return;
    }
    if (adding) finishAddCompanion();
    else setNav(s => push(s, route('first-chat')));
  });

  /**
   * Signs this phone out. Only this phone: the server's logout ends every
   * session the account has, which nobody tapping "Sign out" on one device
   * expects and nothing on screen warns about. Account deletion still ends
   * them all.
   */
  const signOut = useEvent(async () => {
    if (busyRef.current) return;
    setBusy('Signing out…');
    // While the token still works: a signed-out phone must stop receiving
    // this account's messages. Best effort, and never for long.
    await Promise.race([setPushToken(null).catch(() => {}), delay(SIGN_OUT_GRACE_MS)]);
    // Clear the native Google session too, so the next sign-in shows the
    // account picker instead of silently resuming the same account.
    await Promise.race([googleSignOut().catch(() => {}), delay(SDK_SIGN_OUT_GRACE_MS)]);
    teardownLocal();
    setIsNewUser(false);
    setAuthError(null);
    setNav(s => resetToFlow(s, route('login')));
    setBusy(null);
  });

  /**
   * Irreversible account deletion (App Store 5.1.1(v)). A failure rejects with
   * the request's own error, so the confirmation sheet can stay open and say
   * why (offline, or the server). On success the account is gone, and so is
   * everything this phone kept for it.
   */
  const deleteAccount = useEvent(async (): Promise<void> => {
    await deleteMe();
    googleSignOut().catch(() => {});
    teardownLocal();
    setIsNewUser(true);
    setAuthError(null);
    setNav(s => resetToFlow(s, route('login')));
    showToast({ tone: 'success', text: 'Your account and its data have been deleted.' });
  });

  /** Takes the card off Home at once and puts it back if the server refuses.
   *  The profile screen waits on this and, on a rejection, stays and says why. */
  const deleteCompanion = useEvent(async (id: string): Promise<void> => {
    const victim = companionsRef.current.find(c => idOf(c) === id);
    setCharacters(prev => (prev ? prev.filter(c => idOf(c) !== id) : prev));
    try {
      await deleteCharacter(id);
    } catch (e) {
      // Already gone on the server is the outcome the user asked for.
      if (!(e instanceof ApiError && e.status === 404)) {
        setCharacters(prev => (prev && victim && !prev.some(c => idOf(c) === id) ? [...prev, victim] : prev));
        throw e;
      }
    }
    // The saved session must not bring it back on the next launch.
    setSavedCompanion(prev => (prev && idOf(prev) === id ? null : prev));
    setCreated(prev => (prev && idOf(prev) === id ? null : prev));
    setServerLimitReason(null);
    void refreshUserCharacters();
  });

  /**
   * The companion profile saves as the user edits and again on the way out.
   * While the profile is open it shows saving, saved or failed itself; a save
   * that finishes after it has closed is reported here, since nothing else
   * on screen knows about it.
   */
  const saveCompanion = useEvent(async (id: string, patch: UpdateCharacterPayload): Promise<void> => {
    const before = companionsRef.current.find(c => idOf(c) === id);
    const name = patch.name ?? before?.name ?? 'your companion';
    const profileOpen = () => {
      const t = top(navRef.current);
      return t.name === 'profile' && t.params?.companionId === id;
    };
    setCharacters(prev => prev?.map(c => (idOf(c) === id ? {
      ...c,
      ...(patch.name ? { name: patch.name } : {}),
      ...(patch.voice_id ? { voice: patch.voice_id } : {}),
      ...(patch.personality_sliders ? { personalitySliders: { ...c.personalitySliders, ...patch.personality_sliders } } : {}),
    } : c)) ?? prev);
    try {
      await updateCharacter(id, patch);
      void refreshUserCharacters();
      if (!profileOpen()) showToast({ tone: 'success', text: `Saved ${name}'s changes.` });
    } catch (e) {
      // Put the server's version back rather than show edits that never saved.
      void refreshUserCharacters();
      if (!profileOpen()) {
        showToast({
          tone: 'error',
          text: problemMessage(e, `Couldn't save ${name}'s changes.`),
          actionLabel: 'Retry',
          onAction: () => { saveCompanion(id, patch).catch(() => {}); },
        });
      }
      throw e;
    }
  });

  // The name shows as changed at once. A failed save puts the old one back
  // and says why here, with a Retry; the profile field only marks that the
  // edit didn't stick.
  const saveProfile = useEvent(async (patch: { display_name?: string }): Promise<void> => {
    const previous = userName;
    if (patch.display_name) setUserName(patch.display_name);
    try {
      await updateMe(patch);
    } catch (e) {
      setUserName(previous);
      showToast({
        tone: 'error',
        text: problemMessage(e, "Couldn't save your name."),
        actionLabel: 'Retry',
        onAction: () => { saveProfile(patch).catch(() => {}); },
      });
      throw e;
    }
  });

  // Optimistic, and put back if the save fails, so the switch never shows a
  // state the server doesn't have. Settings shows the failure under the row.
  const saveSettings = useEvent(async (next: { dailyCheckin: boolean }): Promise<void> => {
    const previous = settings;
    setSettings(next);
    if (next.dailyCheckin === previous.dailyCheckin) return;
    try {
      await updateMe({ checkins_enabled: next.dailyCheckin });
    } catch (e) {
      setSettings(previous);
      throw e;
    }
  });

  // Studio hides the card itself while this runs and explains a failure.
  const deleteStudio = useEvent(async (id: string): Promise<void> => {
    await deleteStudioCharacter(id);
    setStudioCharacters(prev => (prev ? prev.filter(c => c._id !== id) : prev));
    void refreshStudio();
  });

  const rememberStudioChoice = useEvent((characterId: string, remember: boolean) => {
    setStudioMemory(prev => {
      const next = { ...prev, [characterId]: remember };
      const uid = userIdRef.current;
      if (uid) void writeCache(uid, CACHE.studioMemory, next);
      return next;
    });
  });

  /**
   * What go(target) means when the screen on top asks for it.
   *
   * Order matters: sheets and special destinations first; then "back" (a
   * screen's fixed back target, or any screen already in the history); then
   * tabs; and only then a push.
   */
  const navigate = useEvent((caller: Caller, target: ScreenName) => {
    const s = navRef.current;
    const t = top(s);
    // A covered or departing screen (a late timer, a reply that finished
    // after its chat was left) doesn't get to move the user.
    if (caller.key !== t.key || (caller.tab && (!inTabs(s) || s.tab !== caller.tab))) return;
    if (overlayRef.current) setOverlay(null);

    switch (target) {
      case 'paywall':
        openPaywall(pendingTrigger.current ?? triggerFor(t));
        return;
      case 'callDepleted': {
        const c = companionFor(t) ?? companions[0];
        if (c) setOverlay({ kind: 'callDepleted', companion: c });
        return;
      }
      case 'recap': {
        // Leaving a conversation: the recap opens over wherever it was opened from.
        const c = companionFor(t);
        if (t.name === 'chat' || t.name === 'call') setNav(x => pop(x));
        if (c) setOverlay({ kind: 'recap', companion: c });
        return;
      }
      case 'call': {
        const c = companionFor(t) ?? companions[0];
        if (c) startCall(c);
        return;
      }
      case 'login':
        // Settings' only route to login is its sign-out control.
        if (t.name === 'settings' || t.name === 'user-profile') void signOut();
        else setNav(x => (t.name === 'splash' ? replaceTop(x, route('login')) : resetToFlow(x, route('login'))));
        return;
      case 'meet':
        // The account (or the added companion) exists now, and the steps that
        // made it are done with.
        setNav(x => (addMode === 'add' && inTabs(x) ? replaceAbove(x, 0, route('meet')) : resetToFlow(x, route('meet'))));
        return;
      case 'first-chat':
        if (t.name === 'meet') { void continueFromMeet(t); return; }
        if (addMode === 'add') { finishAddCompanion(); return; }
        if (t.name !== 'first-chat') setNav(x => push(x, route('first-chat')));
        return;
      default:
        break;
    }

    if (target === t.name) return;
    if (s.routes.length > 1 && BACK_ALIASES[t.name]?.includes(target)) {
      setNav(x => pop(x));
      return;
    }
    const earlier = indexBelowTop(s, target);
    if (earlier >= 0) {
      setNav(x => popTo(x, earlier));
      return;
    }
    const tab = tabForRoot(target);
    if (tab) {
      if (!inTabs(s)) {
        // Onboarding is over: from here on the account lives in the tabs.
        setOnboarded(true);
        setAddMode('onboarding');
        refreshAll();
      }
      setNav(x => (inTabs(x) ? switchTab(x, tab) : resetToTabs(tab)));
      return;
    }

    const c = companionFor(t);
    const params = c && (target === 'chat' || target === 'profile' || target === 'memories') ? companionParams(c) : undefined;
    const next = route(target, params);
    // A call that has been left is over.
    setNav(x => (t.name === 'call' ? replaceTop(x, next) : push(x, next)));
  });

  // One stable go per route, so a screen can keep it in effect dependencies.
  const goCache = useRef(new Map<string, (s: ScreenName) => void>());
  const goFor = (key: string, tab?: TabId) => {
    const id = tab ? `${key}|${tab}` : key;
    let go = goCache.current.get(id);
    if (!go) {
      go = (target: ScreenName) => navigate({ key, tab }, target);
      goCache.current.set(id, go);
    }
    return go;
  };
  useEffect(() => {
    const live = new Set(nav.routes.map(r => r.key));
    for (const id of goCache.current.keys()) {
      if (!live.has(id.split('|')[0])) goCache.current.delete(id);
    }
  }, [nav.routes]);

  /** go() for the sheets. Closing one names the screen beneath it. */
  const overlayGo = useEvent((target: ScreenName) => {
    const t = top(navRef.current);
    const kind = overlayRef.current?.kind;
    setOverlay(null);
    // The recap's Done names Home but means "done", wherever it opened.
    if (target === t.name || (kind === 'recap' && target === 'home')) return;
    navigate({ key: t.key }, target);
  });

  const onTabChange = useEvent((tab: TabId) => {
    setNav(s => (inTabs(s) ? switchTab(s, tab) : s));
  });

  // A second tap on the selected tab returns to its root, or scrolls the
  // root back to the top.
  const onTabReselect = useEvent((tab: TabId) => {
    const s = navRef.current;
    if (!inTabs(s) || s.tab !== tab) return;
    if (s.routes.length > 1) setNav(x => popTo(x, 0));
    else emitTabReselect(tab);
  });

  /** Removes a crashed pushed screen, back to the one it was opened from. */
  const dropRoute = useEvent((key: string) => {
    setNav(s => {
      const i = s.routes.findIndex(r => r.key === key);
      return i > 0 ? popTo(s, i - 1) : s;
    });
  });

  const redirectHome = useEvent(() => {
    setNav(s => (inTabs(s) ? switchTab(s, 'home') : resetToTabs('home')));
  });

  // ── Notifications ───────────────────────────────────────────────────
  // A tapped message opens that companion's chat at once from what's already
  // known; the list refreshes behind it.
  const openFromPush = useEvent(async (data: PushTapData) => {
    const id = data.character_id;
    if (!id || !inTabs(navRef.current)) return;
    const known = companionsRef.current.find(c => idOf(c) === id);
    if (top(navRef.current).name === 'call') {
      // Opening the chat now would hang up the call.
      showToast({ tone: 'info', text: known ? `${known.name} sent you a message.` : 'You have a new message.' });
      return;
    }
    if (known) {
      void openChat(known);
      void refreshUserCharacters();
      return;
    }
    const list = await refreshUserCharacters();
    const c = list?.find(x => idOf(x) === id);
    if (c) void openChat(c);
    else if (!list) showToast({ tone: 'warning', text: "Couldn't open that conversation. Check your connection and try again." });
    else showToast({ tone: 'info', text: "That conversation isn't available anymore." });
  });

  // A reply typed into the notification shade. This can run with no UI
  // mounted (app backgrounded or killed), so everything it needs comes from
  // the payload and the stored token, never from React state.
  const sendPushReply = useEvent(async (text: string, data: PushTapData) => {
    const message = text.trim();
    if (!message) return;
    // Kept so the chat can offer it back as a draft: nothing typed is lost.
    const keep = () => { if (data.character_id) void saveUnsentReply(data.character_id, message); };
    if (!data.session_id || !(await loadAuthToken())) {
      notifyReplyFailed();
      keep();
      return;
    }
    // Fired and never awaited: the backend saves the turn and finishes the
    // reply even if we disconnect, and pushes the answer itself.
    let opened = false;
    streamConversation({ session_id: data.session_id, message }, {
      onChunk: () => { opened = true; },
      onDone: () => {},
      onCrisis: () => { opened = true; },
      // Only a failure before the first byte means it never got sent; a drop
      // mid-reply means the server already has the message.
      onError: (_message, info) => {
        if (opened) return;
        notifyReplyFailed(info?.code);
        keep();
      },
    });
  });

  useEffect(() => addPushTapListener(d => { void openFromPush(d); }), [openFromPush]);
  useEffect(() => addPushReplyListener((text, d) => {
    sendPushReply(text, d).catch(() => notifyReplyFailed());
  }), [sendPushReply]);

  // ── Launch ──────────────────────────────────────────────────────────
  /**
   * Opens the signed-in app on Home. When a notification launched it and its
   * companion is already known, that chat is the first screen, with Home
   * beneath it for Back; otherwise the chat opens once the list arrives.
   * Arriving on Home refreshes the list (see the focus effect below).
   */
  const enterApp = useEvent(async (known: Companion[] | null) => {
    const tap = initialPush.current;
    initialPush.current = null;
    const c = tap?.character_id ? (known ?? companionsRef.current).find(x => idOf(x) === tap.character_id) : undefined;
    if (c) {
      const draft = await takeUnsentReply(idOf(c)).catch(() => null);
      setNav(() => push(resetToTabs('home'), route('chat', { ...companionParams(c), ...(draft ? { draft } : {}) })));
    } else {
      setNav(() => resetToTabs('home'));
    }
    setLaunch({ kind: 'ready' });
    if (tap && !c) void openFromPush(tap);
  });

  /** Confirms the session with the server. `blocking`: nothing true is on
   *  screen yet, so the answer decides the first screen. */
  const confirmSession = useEvent(async (blocking: boolean) => {
    try {
      const me = await getMe();
      applyMe(me);
      refreshPushToken();
      if (!me.onboarding_completed) {
        setOnboarded(false);
        setIsNewUser(true);
        setAddMode('onboarding');
        setLaunch({ kind: 'ready' });
        setNav(s => resetToFlow(s, route('age')));
        return;
      }
      setOnboarded(true);
      if (blocking) {
        await enterApp(await hydrateFromCache(me.user_id));
        void refreshEntitlement();
      }
    } catch (e) {
      // A session the server ended is handled by the auth-expired listener.
      if (e instanceof AuthExpiredError) return;
      const unreachable = isNetworkError(e) || (e instanceof ApiError && (e.status >= 500 || e.status === 429));
      if (blocking && unreachable) {
        setLaunch({ kind: 'unreachable', reason: isNetworkError(e) ? 'offline' : 'server', retrying: false });
      } else if (blocking) {
        // The server answered, but not for this account: start over cleanly.
        teardownLocal();
        setLaunch({ kind: 'ready' });
        setNav(s => resetToFlow(s, route('splash')));
      } else if (unreachable) {
        showToast({
          tone: 'warning',
          text: isNetworkError(e) ? "You're offline. Showing what was saved on this phone." : 'Evarna is having trouble right now. Showing what was saved.',
          actionLabel: 'Retry',
          onAction: () => {
            void confirmSession(false);
            void refreshUserCharacters();
            void refreshEntitlement();
          },
        });
      }
    }
  });

  const launched = useRef(false);
  useEffect(() => {
    if (API_MISCONFIGURED || launched.current) return;
    launched.current = true;
    (async () => {
      const [raw, token, signedInBefore, tap] = await Promise.all([
        AsyncStorage.getItem(SESSION_KEY).catch(() => null),
        loadAuthToken(),
        AsyncStorage.getItem(SIGNED_IN_KEY).catch(() => null),
        // Read before the first screen is chosen, so a tap that launched the
        // app opens its chat without flashing Home first.
        getInitialPushTap(),
      ]);
      initialPush.current = tap;

      if (!token) {
        // The splash leads to sign-in.
        setIsNewUser(!signedInBefore);
        setLaunch({ kind: 'ready' });
        return;
      }

      const blob = parseBlob(raw);
      if (blob && (blob.onboarded || blob.characterId)) {
        setUserId(blob.userId);
        setOnboarded(true);
        if (blob.isMinor !== undefined) setIsMinor(blob.isMinor);
        if (blob.userName) setUserName(blob.userName);
        if (blob.companion) setSavedCompanion(blob.companion);
        const saved = await hydrateFromCache(blob.userId);
        await enterApp(saved ?? (blob.companion ? [blob.companion] : null));
        void refreshEntitlement();
        void confirmSession(false);
        return;
      }
      // Signed in, but nothing saved here: the splash waits for the server.
      setLaunch({ kind: 'confirming' });
      await confirmSession(true);
    })();
  }, [confirmSession, enterApp, hydrateFromCache, refreshEntitlement, setUserId]);

  const retryLaunch = useEvent(() => {
    setLaunch(l => (l.kind === 'unreachable' ? { ...l, retrying: true } : l));
    void confirmSession(true);
  });

  // Voices are public: load them at once so the voice step never waits.
  useEffect(() => { void loadVoices(); }, [loadVoices]);

  // Purchases belong to the signed-in account, so RevenueCat follows it.
  useEffect(() => { if (userId) void purchasesSignIn(userId); }, [userId]);

  // Persist what the next launch needs to paint Home at once. Only for an
  // account that has finished onboarding: a half-made account goes back
  // through the server, which knows where it stopped.
  const primary = companions[0] ?? null;
  useEffect(() => {
    if (!userId || !onboarded) return;
    const blob: SessionBlob = {
      userId,
      onboarded: true,
      isMinor,
      userName,
      ...(primary ? {
        characterId: idOf(primary),
        // The real last-talked time, not a label: "Just now" used to be saved
        // here and shown on every launch.
        companion: { id: primary.id, name: primary.name, archetype: primary.archetype, lastInteractionAt: primary.lastInteractionAt },
      } : {}),
    };
    AsyncStorage.setItem(SESSION_KEY, JSON.stringify(blob)).catch(() => {});
  }, [userId, onboarded, isMinor, userName, primary?.id, primary?.name, primary?.archetype, primary?.lastInteractionAt]);

  // ── Auth handlers ───────────────────────────────────────────────────
  const applySession = useEvent(async (session: AuthSession) => {
    setAuthToken(session.token);
    setUserId(session.user_id);
    setIsNewUser(false);
    setAuthError(null);
    AsyncStorage.setItem(SIGNED_IN_KEY, '1').catch(() => {});
    haptic.success();
    refreshPushToken();
    // The profile (name, email, age band, check-in setting) isn't part of the
    // sign-in answer.
    getMe().then(applyMe).catch(() => {});
    if (session.onboarding_completed) {
      setOnboarded(true);
      await hydrateFromCache(session.user_id);
      // Arriving on Home fetches the companions.
      setNav(() => resetToTabs('home'));
      void refreshEntitlement();
    } else {
      setAddMode('onboarding');
      setNav(s => resetToFlow(s, route('age')));
    }
  });

  const handleOAuth = useEvent(async (provider: 'google' | 'apple') => {
    // Apple needs Sign in with Apple on the App ID, which needs Developer
    // Program enrolment; until then the login screen hides its button.
    if (provider === 'apple') {
      setAuthError("Sign in with Apple isn't available yet. Continue with Google or email.");
      return;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const idToken = await getGoogleIdToken();
      // Backing out of the account picker is not an error.
      if (!idToken) return;
      await applySession(await signInWithGoogle(idToken));
    } catch (e) {
      setAuthError(e instanceof GoogleSignInUnavailable ? e.message : authProblem(e, 'oauth'));
    } finally {
      setAuthBusy(false);
    }
  });

  const handleEmailRequest = useEvent(async (email: string): Promise<boolean> => {
    const wait = Math.ceil((emailCooldownUntil.current - Date.now()) / 1000);
    if (wait > 0) {
      setAuthError(`Too many attempts. Try again in ${waitPhrase(wait)}.`);
      return false;
    }
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await requestEmailCode(email);
      setPendingEmail(email);
      setDevCode(res.dev_code ?? null);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.retryAfter) emailCooldownUntil.current = Date.now() + e.retryAfter * 1000;
      setAuthError(authProblem(e, 'request'));
      return false;
    } finally {
      setAuthBusy(false);
    }
  });

  const handleEmailVerify = useEvent(async (code: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await applySession(await verifyEmailCode(pendingEmail, code));
    } catch (e) {
      setAuthError(authProblem(e, 'verify'));
    } finally {
      setAuthBusy(false);
    }
  });

  // ── Companion creation (S08) ────────────────────────────────────────
  // Resolves only once the account or companion exists, so Meet never opens
  // on something that failed. Some refusals move the user on themselves:
  // under 15 goes back to the birthday, an account that's already set up goes
  // home, and one that never finished onboarding goes back to it.
  const handlePickName = useEvent(async (name: string): Promise<PickNameResult> => {
    setCompanionName(name);
    const apiArchetype = ARCHETYPE_MAP[archetypePick] ?? archetypePick;
    // The backend's gender enum is strict (male/female/nonbinary/undisclosed).
    const genderNorm = userGender === 'non-binary' ? 'nonbinary' : userGender;

    const catalog = voicesRef.current.length ? voicesRef.current : await loadVoices();
    // The backend rejects an empty or unknown voice_id: the user's pick, or
    // failing that a voice that matches them.
    const voice = catalog.find(v => v.id === voicePick)
      ?? catalog.find(v => v.gender === (genderNorm === 'male' ? 'male' : 'female'))
      ?? catalog[0];
    if (!voice) {
      return { ok: false, message: `Couldn't load the voices, so ${name} can't be created yet. Check your connection and try again.` };
    }
    const made = (id: string): Companion => ({ id, name, archetype: archetypePick, gender: voice.gender, voice: voice.id });

    if (addMode === 'add') {
      try {
        const res = await createCharacter({ archetype: apiArchetype, gender: voice.gender, voice_id: voice.id, name });
        const c = made(res.character_id);
        setCreated(c);
        setChosenVoiceId(voice.id);
        setCharacters(prev => [c, ...(prev ?? []).filter(x => idOf(x) !== res.character_id)]);
        void refreshUserCharacters();
        prefetchPushStatus();
        return { ok: true };
      } catch (e) {
        if (e instanceof ApiError && e.code === 'NOT_ONBOARDED') {
          setAddMode('onboarding');
          setOnboarded(false);
          setIsNewUser(true);
          setNav(s => resetToFlow(s, route('age')));
          return { ok: false };
        }
        const limit = limitMessage(e);
        if (limit) {
          setServerLimitReason(limit);
          return { ok: false, message: limit };
        }
        return { ok: false, message: problemMessage(e, `Couldn't create ${name} just now. Please try again.`) };
      }
    }

    // S05 and S02 gate advancing on these, so this is a backstop.
    if (!userName.trim()) return { ok: false, message: "We didn't get your name. Go back a few steps and add it." };
    if (!dateOfBirth) return { ok: false, message: "We didn't get your birthday. Go back to the first step and add it." };

    try {
      const res = await onboardUser({
        display_name: userName.trim(),
        gender: genderNorm,
        date_of_birth: dateOfBirth,
        communication_style: commStyle,
        intent: INTENT_MAP[archetypePick] ?? 'emotional support',
        companion: { name, archetype: apiArchetype, gender: voice.gender, voice_id: voice.id },
      });
      const c = made(res.character_id);
      setUserId(res.user_id);
      setIsMinor(res.is_minor ?? false);
      setCreated(c);
      setChosenVoiceId(voice.id);
      setCharacters([c]);
      setOnboarded(true);
      void refreshUserCharacters();
      // Nothing else reads the plan for a brand-new account.
      void refreshEntitlement();
      prefetchPushStatus();
      return { ok: true };
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'UNDER_MINIMUM_AGE') {
        Alert.alert(
          'You need to be 15 or older',
          "Evarna isn't available to under-15s, so we can't finish setting up your account. If your birthday is wrong, you can correct it.",
        );
        setNav(s => {
          const i = indexBelowTop(s, 'age');
          return i >= 0 ? popTo(s, i) : resetToFlow(s, route('age'));
        });
        return { ok: false };
      }
      if (code === 'ALREADY_ONBOARDED') {
        // Onboarding ran twice (a retry after a dropped response): the
        // account exists, so take them to it.
        setOnboarded(true);
        refreshAll();
        setNav(() => resetToTabs('home'));
        return { ok: false };
      }
      return { ok: false, message: problemMessage(e, `Couldn't create ${name} just now. Please try again.`) };
    }
  });

  // ── Keeping things fresh ────────────────────────────────────────────
  const t = top(nav);
  const tabsBase = inTabs(nav);
  const topName = t.name;
  const topKey = t.key;

  // Arriving on a list refreshes it, so Home shows the latest message and
  // order after a chat or a call. Coming back from a pushed screen always
  // refreshes; flicking between tabs is throttled so it doesn't refetch on
  // every tap.
  const lastFocusFetch = useRef<Partial<Record<ScreenName, number>>>({});
  const lastTopKey = useRef(topKey);
  useEffect(() => {
    const returned = lastTopKey.current !== topKey;
    lastTopKey.current = topKey;
    if (!tabsBase || launch.kind !== 'ready') return;
    const due = (name: ScreenName) => {
      const now = Date.now();
      if (!returned && now - (lastFocusFetch.current[name] ?? 0) < FOCUS_REFRESH_MS) return false;
      lastFocusFetch.current[name] = now;
      return true;
    };
    if (topName === 'home' && due('home')) void refreshUserCharacters();
    if (topName === 'studio' && due('studio')) {
      void refreshStudio();
      if (!scenariosRef.current) void loadScenarios();
    }
    if (topName === 'scenario-setup' && !scenariosRef.current) void loadScenarios();
    if (topName === 'settings' && due('settings')) void refreshEntitlement();
  }, [topKey, topName, tabsBase, launch.kind, refreshUserCharacters, refreshStudio, loadScenarios, refreshEntitlement]);

  // A call spends minutes, however it was left: its own buttons, the Android
  // back button, or the chat button inside it.
  const hadCall = useRef(false);
  useEffect(() => {
    const inCall = nav.routes.some(r => r.name === 'call');
    if (hadCall.current && !inCall) void refreshEntitlement();
    hadCall.current = inCall;
  }, [nav.routes, refreshEntitlement]);

  // Coming back to the app: the balance may have changed (a call on another
  // device, a new period), and so may the lists and the session.
  const lastForeground = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st !== 'active' || !getAuthToken() || !onboardedRef.current) return;
      void refreshEntitlement();
      const now = Date.now();
      if (now - lastForeground.current < FOREGROUND_REFRESH_MS) return;
      lastForeground.current = now;
      void refreshUserCharacters();
      if (top(navRef.current).name === 'studio') void refreshStudio();
      void confirmSession(false);
    });
    return () => sub.remove();
  }, [refreshEntitlement, refreshUserCharacters, refreshStudio, confirmSession]);

  // ── Android back ────────────────────────────────────────────────────
  // Sheets inside screens register their own handler, which runs first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busyRef.current) return true;
      if (overlayRef.current) { setOverlay(null); return true; }
      const s = navRef.current;
      if (top(s).name === 'call') {
        Alert.alert('End the call?', undefined, [
          { text: 'Keep talking', style: 'cancel' },
          { text: 'End call', style: 'destructive', onPress: () => leaveCall() },
        ]);
        return true;
      }
      if (s.routes.length > 1) { setNav(x => pop(x)); return true; }
      if (inTabs(s) && s.tab !== 'home') { setNav(x => switchTab(x, 'home')); return true; }
      return false;
    });
    return () => sub.remove();
  }, [setNav, setOverlay, leaveCall]);

  // ── VoiceOver: say where the user has arrived ───────────────────────
  // Keyed on arrivals, not re-renders. Tab switches aren't announced: the
  // selected tab already says its own name.
  useEffect(() => {
    if (!screenReader || launch.kind !== 'ready') return;
    const r = top(navRef.current);
    const title = spokenTitle(r, companionFor(r), { scenario: scenario?.name, mode: sandboxMode?.name, meet: companionName || undefined });
    if (!title) return;
    // After the transition, so the tap that caused it doesn't talk over it.
    const id = setTimeout(() => announce(title), reduced ? MOTION.duration.fast : MOTION.duration.slow);
    return () => clearTimeout(id);
  }, [topKey, screenReader, launch.kind]);

  // ── Screen handlers ─────────────────────────────────────────────────
  const refreshHome = useEvent(async () => {
    await Promise.all([refreshUserCharacters(), refreshEntitlement()]);
  });
  const selectCompanion = useEvent((c: Companion) => { void openChat(c); });
  const moodCompanion = useEvent((c: Companion, mood: string) => { void openChat(c, mood); });
  const addCompanion = useEvent(() => {
    if (companionsRef.current.length >= MAX_COMPANIONS) return;
    setAddMode('add');
    setNav(s => push(s, route('archetype')));
  });
  const openCompanionProfile = useEvent((c: Companion) => {
    setNav(s => push(s, route('profile', companionParams(c))));
  });
  const setupScenario = useEvent((s: Scenario) => {
    setScenario(s);
    setStudioCharacter(null);
    setStudioCharacterId(null);
    setStudioRemember(true);
    setNav(x => push(x, route('scenario-setup')));
  });
  const resumeStudio = useEvent((c: ApiStudioCharacter) => {
    setScenario(studioScenarioFor(c));
    setStudioCharacter(c);
    setStudioCharacterId(c._id);
    // Resume the way it was started. Characters from before this was
    // recorded keep the server's default, which is to remember.
    setStudioRemember(studioMemory[c._id] ?? true);
    setNav(x => push(x, route('studio-session')));
  });
  const openCreator = useEvent(() => setNav(x => push(x, route('character-creator'))));
  const openSandboxMode = useEvent((m: SandboxMode) => {
    setSandboxMode(m);
    setNav(x => push(x, route('sandbox-session')));
  });
  const startStudioSession = useEvent((id: string, remember: boolean) => {
    rememberStudioChoice(id, remember);
    setStudioCharacter(null);
    setStudioCharacterId(id);
    setStudioRemember(remember);
    // The setup form is spent once the session starts, so Back returns to Studio.
    setNav(x => replaceTop(x, route('studio-session')));
  });
  const capUpgrade = useEvent(() => { pendingTrigger.current = 'cap'; });
  // Returned, so the ask stays on screen until the system dialog is answered.
  const allowNotifications = useEvent(() => {
    pushStatus.current = null;
    return requestPushPermission().then(uploadPushToken).catch(() => {});
  });
  const recapAfterCall = useEvent((c: Companion) => leaveCall(() => setOverlay({ kind: 'recap', companion: c })));

  // ── Rendering ───────────────────────────────────────────────────────
  const renderTabRoot = (tab: TabId): ReactNode => {
    const go = goFor(nav.routes[0].key, tab);
    switch (tab) {
      case 'home':
        return (
          <S10_Home
            go={go}
            companions={companions}
            userName={displayName}
            maxCompanions={MAX_COMPANIONS}
            status={homeStatus}
            onRetry={refreshUserCharacters}
            onRefresh={refreshHome}
            onSelectCompanion={selectCompanion}
            onCallCompanion={startCall}
            onMood={moodCompanion}
            onAddCompanion={addCompanion}
            companionLimitReason={
              companions.length >= MAX_COMPANIONS
                ? `You can have up to ${MAX_COMPANIONS} companions for now.`
                : serverLimitReason ?? undefined
            }
          />
        );
      case 'studio':
        return (
          <S15_StudioHome
            go={go}
            characters={studioCharacters ?? []}
            status={studioStatus}
            onRetry={refreshStudio}
            onRefresh={refreshStudio}
            onDeleteCharacter={deleteStudio}
            setupScenario={setupScenario}
            resumeConvo={resumeStudio}
            openCreator={openCreator}
          />
        );
      case 'sandbox':
        return <S19_SandboxHome go={go} comingSoon={CONFIG.sandboxComingSoon} isMinor={isMinor} openMode={openSandboxMode} />;
      case 'settings':
        return (
          <S21_Settings
            go={go}
            entitlement={entitlement}
            entitlementFailed={entitlementFailed}
            onRetryEntitlement={refreshEntitlement}
            companions={companions}
            userName={displayName}
            userEmail={userEmail}
            settings={settings}
            setSettings={saveSettings}
            openCompanionProfile={openCompanionProfile}
            userId={userId ?? undefined}
            onDeleteAccount={deleteAccount}
          />
        );
    }
  };

  const renderRoute = (r: Route): ReactNode => {
    const go = goFor(r.key);
    const companion = companionFor(r);
    const missing = <Redirect to={redirectHome} />;
    const index = nav.routes.findIndex(x => x.key === r.key);
    const nameBelow = index > 0 ? nav.routes[index - 1].name : undefined;

    switch (r.name) {
      case 'splash':
        return <S01_Splash go={go} booting={launch.kind !== 'ready'} />;
      case 'login':
        return (
          <S30_Login
            isNew={isNewUser}
            appleAvailable={false}
            onGoogle={() => { void handleOAuth('google'); }}
            onApple={() => { void handleOAuth('apple'); }}
            onEmailRequest={handleEmailRequest}
            onEmailVerify={code => { void handleEmailVerify(code); }}
            devCode={devCode}
            busy={authBusy}
            error={authError}
          />
        );
      case 'age':
        return (
          <S02_Age
            go={go}
            onDob={setDateOfBirth}
            onBack={nameBelow ? back : undefined}
            onSignOut={() => { void signOut(); }}
            initialDob={dateOfBirth || undefined}
          />
        );
      case 'disclosure':
        return <S03_Disclosure go={go} />;
      case 'pronouns':
        return <S05_Pronouns go={go} onGender={setUserGender} onName={setUserName} initialName={userName || undefined} />;
      case 'comm':
        return <S06_Comm go={go} onCommStyle={setCommStyle} />;
      case 'handoff':
        return <S_Handoff go={go} />;
      case 'archetype':
        return <S04_Archetype go={go} onPick={setArchetypePick} backTo={nameBelow ?? 'handoff'} />;
      case 'voice':
        return <S07_Voice go={go} onPickVoice={setVoicePick} apiVoices={voices} voicesStatus={voicesStatus} onRetryVoices={loadVoices} />;
      case 'name':
        return <S08_Name go={go} archetype={archetypePick} onPickName={handlePickName} />;
      case 'meet':
        return (
          <S_Meet
            go={go}
            companion={{ name: companionName, archetype: archetypePick }}
            accent={ARCHETYPE_COLORS[archetypePick] ?? W.primary}
            voiceId={chosenVoiceId ?? undefined}
          />
        );
      case 'notif':
        return (
          <S25_NotifPermission
            go={go}
            companion={created ?? { id: 'new', name: companionName, archetype: archetypePick }}
            onAllow={allowNotifications}
            next={r.params?.next}
          />
        );
      case 'first-chat':
        // Only ever with a real companion: without one there is nobody to talk to.
        if (!created) return missing;
        return (
          <S09_FirstChat
            go={go}
            isMinor={isMinor}
            companion={created}
            userId={userId ?? undefined}
            characterId={idOf(created)}
            {...quota}
            onQuotaRefused={refreshEntitlement}
            onCapUpgrade={capUpgrade}
          />
        );
      case 'chat':
        if (!companion) return missing;
        return (
          <S14_Chat
            key={idOf(companion)}
            go={go}
            isMinor={isMinor}
            companion={companion}
            accent={CONFIG.orbHue}
            {...quota}
            onQuotaRefused={refreshEntitlement}
            onCapUpgrade={capUpgrade}
            userId={userId ?? undefined}
            characterId={idOf(companion)}
            initialDraft={r.params?.draft}
            onCall={() => startCall(companion)}
          />
        );
      case 'call':
        if (!companion) return missing;
        return (
          <S12_VoiceCall
            go={go}
            companion={companion}
            accent={CONFIG.orbHue}
            orbIntensity={1}
            voiceSecondsRemaining={entitlement ? entitlement.voice.remaining_seconds : null}
            userId={userId ?? undefined}
            characterId={idOf(companion)}
            // The call has hung up by now: it leaves, and the plans open
            // over whatever it was started from, so closing them can't redial.
            onOutOfMinutes={() => leaveCall(() => openPaywall('voice'))}
            onCallEnded={refreshEntitlement}
            onRecap={() => recapAfterCall(companion)}
            returnTo={nameBelow === 'chat' ? 'chat' : 'home'}
          />
        );
      case 'crisis':
        return <S28_CrisisChat go={go} backTo={nameBelow ?? 'home'} />;
      case 'profile':
        if (!companion) return missing;
        return (
          <S26_CompanionEdit
            go={go}
            companion={companion}
            onSave={p => saveCompanion(idOf(companion), p)}
            onRefresh={refreshUserCharacters}
            onDelete={() => deleteCompanion(idOf(companion))}
            backTo={nameBelow ?? 'home'}
            apiVoices={voices}
          />
        );
      case 'user-profile':
        return (
          <S_UserProfile
            go={go}
            userName={displayName}
            userEmail={userEmail}
            onSave={saveProfile}
            onDeleteAccount={deleteAccount}
            backTo={nameBelow ?? 'settings'}
          />
        );
      case 'memories': {
        // From Settings there is no particular companion: the most recent one.
        const c = companion ?? companions[0] ?? null;
        return <S22_Memories go={go} characterId={c ? idOf(c) : undefined} companionName={c?.name} />;
      }
      case 'scenario-setup': {
        const sc = scenario ?? SCENARIOS[0];
        return (
          <S16_ScenarioSetup
            go={go}
            scenario={sc}
            def={scenarios?.find(d => d.id === sc.id)}
            defStatus={scenariosStatus}
            onRetry={loadScenarios}
            apiVoices={voices}
            voicesStatus={voicesStatus}
            onRetryVoices={loadVoices}
            onStart={startStudioSession}
          />
        );
      }
      case 'studio-session':
        return (
          <S17_StudioSession
            go={go}
            isMinor={isMinor}
            scenario={scenario ?? SCENARIOS[0]}
            characterId={studioCharacterId ?? undefined}
            totalSessions={studioCharacter?.total_sessions ?? 0}
            remember={studioRemember}
            {...quota}
            onQuotaRefused={refreshEntitlement}
            onCapUpgrade={capUpgrade}
          />
        );
      case 'character-creator':
        return <S18_CharacterCreator go={go} apiVoices={voices} />;
      case 'sandbox-session':
        return (
          <S20_SandboxSession
            go={go}
            mode={sandboxMode ?? SANDBOX_MODES[0]}
            isMinor={isMinor}
            companionName={companions[0]?.name}
          />
        );
      case 'home':
      case 'studio':
      case 'sandbox':
      case 'settings':
        // Tab roots live in the tab layer, never as pushed routes.
        return renderTabRoot(r.name);
      case 'paywall':
      case 'callDepleted':
      case 'recap':
        // Sheets, never routes.
        return <Redirect to={redirectHome} report={`Sheet rendered as a route: ${r.name}`} />;
      default: {
        // The compiler proves every name is handled; this catches one that
        // arrives from outside it.
        const unknown: never = r.name;
        return <Redirect to={redirectHome} report={`Unknown route: ${String(unknown)}`} />;
      }
    }
  };

  // Each screen gets its own error boundary, so one broken screen doesn't
  // take the tab bar or the rest of the stack down with it. "Try again"
  // retries a tab root or an onboarding step in place, and leaves a pushed
  // screen for the one beneath it.
  const renderScene = (r: Route): ReactNode => {
    if (isTabsBase(r)) {
      return (
        <TabRoots
          active={nav.tab}
          renderTab={tab => <ErrorBoundary name={`tab:${tab}`}>{renderTabRoot(tab)}</ErrorBoundary>}
        />
      );
    }
    const pushed = nav.routes.findIndex(x => x.key === r.key) > 0;
    return (
      <ErrorBoundary name={`screen:${r.name}`} resetKey={r.key} onReset={pushed ? () => dropRoute(r.key) : undefined}>
        {renderRoute(r)}
      </ErrorBoundary>
    );
  };

  const renderOverlay = (o: Overlay): ReactNode => {
    switch (o.kind) {
      case 'paywall':
        return (
          <S23_Paywall
            go={overlayGo}
            trigger={o.trigger}
            backTo={topName}
            entitlement={entitlement}
            entitlementFailed={entitlementFailed}
            onRetryEntitlement={refreshEntitlement}
            // Both arrive once the sheet has animated out.
            onPurchased={applyEntitlement}
            onClose={closeOverlay}
          />
        );
      case 'callDepleted': {
        const c = companionById(idOf(o.companion)) ?? o.companion;
        return (
          <S27_StartCallDepleted
            companion={c}
            onClose={closeOverlay}
            onUpgrade={() => openPaywall('voice')}
            onText={() => { void openChat(c); }}
            resetDate={entitlement ? formatResetDate(entitlement.period.renews_at) : undefined}
          />
        );
      }
      case 'recap': {
        const c = companionById(idOf(o.companion)) ?? o.companion;
        return <S29_Recap go={overlayGo} companion={c} characterId={idOf(c)} />;
      }
    }
  };

  if (launch.kind === 'misconfigured') {
    return (
      <FullScreenState
        title="This version can't connect"
        body="This version of Evarna can't reach its servers. Please update the app."
      />
    );
  }
  if (launch.kind === 'unreachable') {
    return (
      <FullScreenState
        title={launch.reason === 'offline' ? "Can't reach Evarna" : 'Evarna is having trouble'}
        body={launch.reason === 'offline' ? 'Check your connection and try again.' : 'Please try again in a moment.'}
        onRetry={retryLaunch}
        retrying={launch.retrying}
      />
    );
  }
  // A few milliseconds while this phone's saved session is read, so the
  // first screen drawn is the right one instead of the splash flashing past.
  if (launch.kind === 'reading') return <View style={styles.root} />;

  const showNav = tabsBase && nav.routes.length === 1 && launch.kind === 'ready';
  const covered = !!overlay || !!busy;

  return (
    <View style={styles.root}>
      <View
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        <ScreenStack
          routes={nav.routes}
          renderScene={renderScene}
          canSwipeBack={!covered && !NO_SWIPE_BACK.has(topName)}
          onSwipeBack={swipedBack}
        />
        <BottomNav
          active={nav.tab}
          onChange={onTabChange}
          onReselect={onTabReselect}
          sandboxComingSoon={CONFIG.sandboxComingSoon}
          hidden={!showNav}
        />
      </View>

      {overlay ? (
        // Each sheet animates itself in; this carries it out as it closes.
        <Animated.View key={overlay.kind} exiting={exit.fade} pointerEvents="box-none" style={styles.overlay}>
          {renderOverlay(overlay)}
        </Animated.View>
      ) : null}

      <ToastHost toast={toast} onDismiss={dismissToast} />
      {busy ? <BusyOverlay label={busy} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: W.bg },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: Z.sheet },
});
