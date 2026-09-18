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
//
// Rendering is kept cheap, because this component re-renders on every change
// to what the app knows: every screen is memoised and gets props that keep
// their identity (stable handlers, one per route where they need the route),
// so a router update only redraws the screens whose own props changed. The
// toast lives in its own store (Feedback.tsx). Screen modules load the first
// time one of their screens is drawn, and work Home doesn't need in its first
// second waits until the launch has settled.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState, BackHandler, Keyboard, StyleSheet, View } from 'react-native';
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
import { BusyOverlay, FullScreenState, ToastHost, showToast } from './Feedback';
import { emitTabReselect } from './tabEvents';
import { runAfterTransitions } from './sceneContext';
import {
  CACHE, SESSION_KEY, SIGNED_IN_KEY, appRevealed, canOpenFromBlob, readCachedData, revealApp, takeLaunchReads,
  type CachedData, type SessionBlob,
} from './launch';
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
import { writeCache, clearUserCache } from '../lib/cache';
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
import { prepareVoiceCall } from '../hooks/useVoiceCall';
import { BottomNav, type TabId } from '../components/BottomNav';
import { ErrorBoundary } from '../components/ErrorBoundary';

import type { PickNameResult } from '../screens/Onboarding';
import { S10_Home } from '../screens/Home';

// ── Screens ────────────────────────────────────────────────────────────
const REACT_MEMO = Symbol.for('react.memo');

/** `component` wrapped in memo, unless its module already did that. */
function memoOnce<C>(component: C): C {
  if ((component as { $$typeof?: symbol }).$$typeof === REACT_MEMO) return component;
  return memo(component as unknown as React.ComponentType<object>) as unknown as C;
}

/**
 * A screen module that loads the first time one of its screens is drawn.
 * Metro runs a module's code at its first require, so the screens (and the
 * libraries they pull in) that a launch never opens cost that launch nothing.
 * Each screen is memoised once, for the router's frequent re-renders.
 */
function lazyScreens<M extends object>(load: () => M) {
  let loaded: M | undefined;
  const made = new Map<keyof M, unknown>();
  return function screen<K extends keyof M>(name: K): M[K] {
    loaded ??= load();
    if (!made.has(name)) made.set(name, memoOnce(loaded[name]));
    return made.get(name) as M[K];
  };
}

/* eslint-disable @typescript-eslint/no-var-requires */
const onboardingScreens = lazyScreens(() => require('../screens/Onboarding') as typeof import('../screens/Onboarding'));
// Kept once loaded, so sign-out can clear chat's per-account memory without
// loading the module just to do it.
let chatModule: typeof import('../screens/Chat') | undefined;
const chatScreens = lazyScreens(() => (chatModule = require('../screens/Chat') as typeof import('../screens/Chat')));
const callScreens = lazyScreens(() => require('../screens/VoiceCall') as typeof import('../screens/VoiceCall'));
const studioScreens = lazyScreens(() => require('../screens/Studio') as typeof import('../screens/Studio'));
const sandboxScreens = lazyScreens(() => require('../screens/Sandbox') as typeof import('../screens/Sandbox'));
const settingsScreens = lazyScreens(() => require('../screens/Settings') as typeof import('../screens/Settings'));
const extraScreens = lazyScreens(() => require('../screens/Extras') as typeof import('../screens/Extras'));
/* eslint-enable @typescript-eslint/no-var-requires */

// Home is the first screen of almost every launch, so it loads with the router.
const Home = memoOnce(S10_Home);
const TabBar = memoOnce(BottomNav);

// Shared empties, so a memoised screen sees the same "nothing" every render.
const NO_COMPANIONS: Companion[] = [];
const NO_STUDIO_CHARACTERS: ApiStudioCharacter[] = [];

// ── Timing ─────────────────────────────────────────────────────────────
/** Coming back to the app refreshes lists at most this often. */
const FOREGROUND_REFRESH_MS = 30_000;
/** Arriving on Home, Studio or Settings refreshes their data at most this often. */
const FOCUS_REFRESH_MS = 3_000;
/** Sign-out asks the server to stop pushing to this phone for at most this
 *  long before carrying on locally. */
const SIGN_OUT_GRACE_MS = 4_000;
const SDK_SIGN_OUT_GRACE_MS = 1_500;
/** A notification tap that launched the app is normally known at once; Home
 *  waits no longer than this for one, and a later answer still opens its chat. */
const PUSH_TAP_WAIT_MS = 50;
/** Launch work Home doesn't draw from (the session check, the plan) waits
 *  until the splash has faded and Home has had its first moments. */
const LAUNCH_SETTLE_MS = 700;
/** Work nobody is waiting for yet (voices, the store) waits for a quiet spell. */
const LAUNCH_IDLE_MS = 2_500;
/** The push token is sent again at most this often when nothing about it changed. */
const PUSH_RESYNC_MS = 24 * 60 * 60 * 1000;
/** The last push token upload: whose, from which zone, and when. */
const PUSH_SYNC_KEY = 'evarna_push_synced';

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

/** Screens that show the voice catalog: arriving on one loads it if needed. */
const NEEDS_VOICES: ReadonlySet<ScreenName> = new Set<ScreenName>([
  'archetype', 'voice', 'name', 'profile', 'scenario-setup', 'character-creator',
]);

/** Screens that move VoiceOver to their own title as they open (TopBar's
 *  focusTitleOnMount). The router doesn't also announce them on arrival, or
 *  the two would talk over each other; coming back to one still says where
 *  the user is. */
const FOCUSES_OWN_TITLE: ReadonlySet<ScreenName> = new Set<ScreenName>([
  'crisis', 'user-profile', 'memories', 'studio-session',
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

/** Draws a screen unless its route was left through its error screen. The
 *  error boundary remounts the screen as it lets go, and a screen that just
 *  crashed would only crash again (and report again) while it slides away.
 *  Read at render time, because a leaving screen is frozen and gets no new
 *  props. */
function UnlessDropped({ dropped, routeKey, children }: {
  dropped: { readonly current: ReadonlySet<string> };
  routeKey: string;
  children: ReactNode;
}) {
  return dropped.current.has(routeKey) ? null : <>{children}</>;
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
    const prev = navRef.current;
    const next = update(prev);
    if (next === prev) return;
    // The screen being covered or left stays mounted for a while, and its
    // input would stay first responder: the next screen would open under a
    // keyboard nothing on it can close, typing into a draft nobody can see.
    // Dismissed before the next screen mounts, so one that focuses its own
    // input on arrival keeps it.
    if (top(next).key !== top(prev).key || next.tab !== prev.tab) Keyboard.dismiss();
    navRef.current = next;
    setNavState(next);
  }, []);

  const [overlay, setOverlayState] = useState<Overlay | null>(null);
  const overlayRef = useRef<Overlay | null>(null);
  const setOverlay = useCallback((o: Overlay | null) => {
    // A sheet opens over the screen, whose keyboard would otherwise cover it.
    if (o) Keyboard.dismiss();
    overlayRef.current = o;
    setOverlayState(o);
  }, []);
  // Set by onCapUpgrade just before the screen asks for the paywall.
  const pendingTrigger = useRef<PaywallTrigger | null>(null);

  const [launch, setLaunch] = useState<Launch>(() => (API_MISCONFIGURED ? { kind: 'misconfigured' } : { kind: 'reading' }));
  const launchRef = useRef(launch);
  launchRef.current = launch;
  // A notification tap that launched the app, opened once Home is up.
  const initialPush = useRef<PushTapData | null>(null);

  // ── Feedback ────────────────────────────────────────────────────────
  // Toasts go through Feedback's own store (showToast), not this component.
  // Busy stays here: it also hides the screens from VoiceOver and holds the
  // swipe, and only signing out sets it.
  const [busy, setBusyState] = useState<string | null>(null);
  const busyRef = useRef<string | null>(null);
  const setBusy = useCallback((label: string | null) => {
    busyRef.current = label;
    setBusyState(label);
  }, []);
  // Set for the whole of signOut(), which finishes the job itself if the
  // server turns out to have ended the session already.
  const signingOut = useRef(false);

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
  // Same array until the list itself changes, so memoised screens skip.
  const companions = useMemo(
    () => characters ?? (savedCompanion ? [savedCompanion] : NO_COMPANIONS),
    [characters, savedCompanion],
  );
  const companionsRef = useRef(companions);
  companionsRef.current = companions;
  const companionById = (id?: string) => (id ? companions.find(c => idOf(c) === id) : undefined);
  /** The live copy of a route's companion, or its last known copy while the list catches up. */
  const companionFor = (r: Route): Companion | null =>
    companionById(r.params?.companionId) ?? r.params?.companion ?? null;

  /** The live companion of the route with `key`, read when a handler runs. */
  const companionOfRoute = useCallback((key: string): Companion | null => {
    const r = navRef.current.routes.find(x => x.key === key);
    if (!r) return null;
    const id = r.params?.companionId;
    return (id ? companionsRef.current.find(c => idOf(c) === id) : undefined) ?? r.params?.companion ?? null;
  }, []);
  /** The live copy of `c`, for a sheet opened with an older one. */
  const liveCompanion = useCallback(
    (c: Companion): Companion => companionsRef.current.find(x => idOf(x) === idOf(c)) ?? c,
    [],
  );

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
  // Loaded when a screen that shows them comes up (NEEDS_VOICES), or in a
  // quiet moment after launch, not with Home: Home never shows them.
  const voicesInFlight = useRef<Promise<ApiVoice[]> | null>(null);
  const loadVoices = useCallback((): Promise<ApiVoice[]> => {
    if (voicesInFlight.current) return voicesInFlight.current;
    if (!voicesRef.current.length) setVoicesStatus('loading');
    const request = getVoices()
      .then(list => {
        voicesRef.current = list;
        setVoices(list);
        setVoicesStatus('ready');
        return list;
      })
      .catch(() => {
        setVoicesStatus(voicesRef.current.length ? 'ready' : 'error');
        return voicesRef.current;
      })
      .finally(() => { voicesInFlight.current = null; });
    voicesInFlight.current = request;
    return request;
  }, []);
  /** The catalog, unless it is already here or on its way. */
  const ensureVoices = useCallback(() => {
    if (!voicesRef.current.length) void loadVoices();
  }, [loadVoices]);

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
    const uid = userIdRef.current;
    const tz = getDeviceTimezone();
    setPushToken(token, tz)
      .then(() => {
        if (uid) AsyncStorage.setItem(PUSH_SYNC_KEY, JSON.stringify({ uid, tz, at: Date.now() })).catch(() => {});
      })
      .catch(() => {});
  }, []);
  // Launch and sign-in refresh. Never prompts: the ask belongs to S25.
  // Fetching the token asks Expo's push service over the network, so it and
  // the upload are skipped while the last upload, for this account and time
  // zone, is less than a day old. Sign-out forgets that upload.
  const refreshPushToken = useCallback(() => {
    const uid = userIdRef.current;
    void (async () => {
      if ((await getPushPermissionStatus()) !== 'granted') return;
      const raw = await AsyncStorage.getItem(PUSH_SYNC_KEY).catch(() => null);
      let last: { uid?: string; tz?: string; at?: number } | null = null;
      try { last = raw ? JSON.parse(raw) : null; } catch { last = null; }
      const fresh = !!uid && last?.uid === uid && last.tz === getDeviceTimezone()
        && typeof last.at === 'number' && Date.now() - last.at < PUSH_RESYNC_MS;
      if (fresh) return;
      uploadPushToken(await getPushTokenIfGranted());
    })().catch(() => {});
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
  const applyCached = useCallback((uid: string, cached: CachedData): Companion[] | null => {
    if (userIdRef.current !== uid) return null;
    const { characters: savedList, entitlement: savedPlan, studio, studioMemory: memory } = cached;
    if (savedList) setCharacters(prev => prev ?? savedList);
    if (savedPlan && !entitlementRef.current) {
      entitlementRef.current = savedPlan;
      setEntitlementState(savedPlan);
    }
    if (studio) setStudioCharacters(prev => prev ?? studio);
    if (memory) setStudioMemory(prev => ({ ...memory, ...prev }));
    return savedList;
  }, []);
  const hydrateFromCache = useCallback(
    async (uid: string): Promise<Companion[] | null> => applyCached(uid, await readCachedData(uid)),
    [applyCached],
  );

  /** Everything a signed-in, onboarded session keeps fresh. */
  const refreshAll = useCallback(() => {
    void refreshUserCharacters();
    void refreshEntitlement();
    refreshPushToken();
  }, [refreshUserCharacters, refreshEntitlement, refreshPushToken]);

  /** Local sign-out: forget this account on this phone. Makes no requests. */
  const teardownLocal = useEvent(() => {
    sessionEpoch.current += 1;
    // Chat keeps threads and drafts in memory per account.
    chatModule?.clearChatMemory();
    charactersSeq.current += 1;
    studioSeq.current += 1;
    setAuthToken(null);
    AsyncStorage.multiRemove([SESSION_KEY, PUSH_SYNC_KEY]).catch(() => {});
    void clearUserCache();
    purchasesUser.current = null;
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
    // Mid sign-out (its last request can be the one that finds the session
    // already over): signOut() tears down and goes to login itself, once.
    if (signingOut.current) return;
    teardownLocal();
    setBusy(null);
    setIsNewUser(false);
    setAuthError('Your session ended. Please sign in again.');
    setLaunch({ kind: 'ready' });
    setNav(s => resetToFlow(s, route('login')));
  }), [teardownLocal, setBusy, setNav]);

  // ── Navigation actions ──────────────────────────────────────────────
  const closeOverlay = useCallback(() => setOverlay(null), [setOverlay]);
  // A purchase the store confirms after the sheet has given up waiting
  // ("Payment received · can take a few minutes") shows once this lands.
  const closePaywall = useEvent(() => {
    setOverlay(null);
    void refreshEntitlement();
  });
  const back = useEvent(() => setNav(s => pop(s)));
  // Only the screen that was swiped leaves, even if something else arrived mid-swipe.
  const swipedBack = useEvent((key: string) => setNav(s => (top(s).key === key ? pop(s) : s)));

  // ── Store ───────────────────────────────────────────────────────────
  // RevenueCat's setup runs on the main thread, so it waits for a quiet
  // moment after launch (see below) instead of landing on Home's first
  // second, and the paywall does it on the spot if it comes first.
  const purchasesUser = useRef<string | null>(null);
  const ensurePurchases = useEvent(() => {
    const uid = userIdRef.current;
    if (!uid || purchasesUser.current === uid) return;
    purchasesUser.current = uid;
    void purchasesSignIn(uid);
  });

  const openPaywall = useEvent((trigger?: PaywallTrigger) => {
    pendingTrigger.current = null;
    ensurePurchases();
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
    if (top(navRef.current).name === 'call') return;
    // The microphone check and the session request start now, while the
    // call screen renders and slides in; its hook takes them over.
    prepareVoiceCall(idOf(c));
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
      // 'first-chat' also finishes an added companion (see navigate), which
      // resets the add flow and refreshes the list on the way Home.
      setNav(s => push(s, route('notif', { next: 'first-chat' })));
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
    signingOut.current = true;
    setBusy('Signing out…');
    try {
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
    } finally {
      signingOut.current = false;
      setBusy(null);
    }
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
      case 'first-chat': {
        if (t.name === 'meet') { void continueFromMeet(t); return; }
        // Back to the first chat this was opened from (crisis support), with
        // its conversation, rather than a new, empty one on top.
        const open = indexBelowTop(s, 'first-chat');
        if (open >= 0) { setNav(x => popTo(x, open)); return; }
        if (addMode === 'add') { finishAddCompanion(); return; }
        if (t.name !== 'first-chat') setNav(x => push(x, route('first-chat')));
        return;
      }
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

  // One function per route and role (its go, its call button…), made once
  // and kept while the route lives. A memoised screen then sees the same
  // props on every render, and a screen can keep them in effect dependencies.
  // They read the route's companion when they run, never a stale copy.
  const routeFns = useRef(new Map<string, unknown>());
  const forRoute = <F,>(key: string, role: string, make: () => F): F => {
    const id = `${key}|${role}`;
    let fn = routeFns.current.get(id) as F | undefined;
    if (fn === undefined) {
      fn = make();
      routeFns.current.set(id, fn);
    }
    return fn;
  };
  useEffect(() => {
    const live = new Set(nav.routes.map(r => r.key));
    for (const id of routeFns.current.keys()) {
      if (!live.has(id.split('|')[0])) routeFns.current.delete(id);
    }
  }, [nav.routes]);
  const goFor = (key: string, tab?: TabId) =>
    forRoute(key, tab ? `go:${tab}` : 'go', () => (target: ScreenName) => navigate({ key, tab }, target));

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
  const droppedRoutes = useRef(new Set<string>());
  const dropRoute = useEvent((key: string) => {
    const i = navRef.current.routes.findIndex(r => r.key === key);
    // Only a screen that actually leaves stays blank on its way out; one
    // that can't leave keeps its error screen and its "Try again".
    if (i <= 0) return;
    droppedRoutes.current.add(key);
    setNav(s => popTo(s, i - 1));
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
  const entered = useRef(false);
  const enterApp = useEvent(async (known: Companion[] | null) => {
    entered.current = true;
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
        afterLaunch(() => { void refreshEntitlement(); });
      }
    } catch (e) {
      // A session the server ended is handled by the auth-expired listener.
      if (e instanceof AuthExpiredError) return;
      const unreachable = isNetworkError(e) || (e instanceof ApiError && (e.status >= 500 || e.status === 429));
      if (blocking && unreachable) {
        const reason = isNetworkError(e) ? 'offline' : 'server';
        // A retry that fails the same way changes nothing on screen but the
        // button's spinner, so say so: otherwise VoiceOver users can't tell
        // the retry ran at all. A new reason is read out by the screen itself.
        const was = launchRef.current;
        if (was.kind === 'unreachable' && was.reason === reason) {
          announce(reason === 'offline' ? "Still can't reach Evarna." : 'Evarna is still having trouble.');
        }
        setLaunch({ kind: 'unreachable', reason, retrying: false });
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

  // What Home doesn't draw from waits until the launch has settled: the
  // splash has faded, Home has had its first moments and nothing is moving.
  // Each answer re-renders the router, and during Home's entrance that costs
  // frames.
  const afterLaunch = useCallback((fn: () => void, ms = LAUNCH_SETTLE_MS) => {
    setTimeout(() => runAfterTransitions(fn), ms);
  }, []);

  const launched = useRef(false);
  useEffect(() => {
    if (API_MISCONFIGURED || launched.current) return;
    launched.current = true;
    (async () => {
      // Read before the first screen is chosen, so a tap that launched the
      // app opens its chat without flashing Home first; usually known at
      // once, and never waited on for long.
      const tapRead = getInitialPushTap().catch(() => null);
      // Started as the app's JS loaded (launch.ts), so usually done by now.
      const { token, signedInBefore, blob, cached } = await takeLaunchReads();
      const tap = await Promise.race([tapRead, delay(PUSH_TAP_WAIT_MS).then(() => undefined)]);
      if (tap !== undefined) {
        initialPush.current = tap;
      } else {
        // Late: open it once Home is up, or hand it to the entry still to come.
        void tapRead.then(late => {
          if (!late) return;
          if (entered.current) void openFromPush(late);
          else initialPush.current = late;
        });
      }

      if (!token) {
        // The splash leads to sign-in.
        setIsNewUser(!signedInBefore);
        setLaunch({ kind: 'ready' });
        return;
      }

      if (canOpenFromBlob(blob)) {
        setUserId(blob.userId);
        setOnboarded(true);
        if (blob.isMinor !== undefined) setIsMinor(blob.isMinor);
        if (blob.userName) setUserName(blob.userName);
        if (blob.companion) setSavedCompanion(blob.companion);
        const saved = cached ? applyCached(blob.userId, cached) : null;
        await enterApp(saved ?? (blob.companion ? [blob.companion] : null));
        afterLaunch(() => {
          void refreshEntitlement();
          void confirmSession(false);
        });
        return;
      }
      // Signed in, but nothing saved here: the splash waits for the server.
      setLaunch({ kind: 'confirming' });
      await confirmSession(true);
    })();
  }, [afterLaunch, applyCached, confirmSession, enterApp, openFromPush, refreshEntitlement, setUserId]);

  const retryLaunch = useEvent(() => {
    setLaunch(l => (l.kind === 'unreachable' ? { ...l, retrying: true } : l));
    void confirmSession(true);
  });

  // Signed in: the voice catalog (for a companion's profile, Studio setup)
  // and the store (for the paywall) are set up in a quiet moment, not with
  // Home. Both are also fetched on the spot by whatever needs them first.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    afterLaunch(() => {
      if (cancelled) return;
      ensureVoices();
      ensurePurchases();
      // The chat screen's code, so the first companion tapped opens at once.
      chatScreens('S14_Chat');
    }, LAUNCH_IDLE_MS);
    return () => { cancelled = true; };
  }, [userId, afterLaunch, ensureVoices, ensurePurchases]);

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
  //
  // One request at a time, and nothing goes back while it is out: S08 only
  // moves on to Meet if it is still there when the answer lands, so leaving
  // mid-request (an edge swipe, Android back) would strand a companion that
  // exists, and asking again would make a second one, or in onboarding hit
  // "already onboarded" and skip Meet and the first chat.
  const nameRequest = useRef<Promise<PickNameResult> | null>(null);
  const [creatingCompanion, setCreatingCompanion] = useState(false);
  const createCompanion = useEvent(async (name: string): Promise<PickNameResult> => {
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

  const handlePickName = useEvent((name: string): Promise<PickNameResult> => {
    if (nameRequest.current) return nameRequest.current;
    setCreatingCompanion(true);
    const request = createCompanion(name).finally(() => {
      nameRequest.current = null;
      setCreatingCompanion(false);
    });
    nameRequest.current = request;
    return request;
  });

  // ── Keeping things fresh ────────────────────────────────────────────
  const t = top(nav);
  const tabsBase = inTabs(nav);
  const topName = t.name;
  const topKey = t.key;

  // Arriving on a list refreshes it, so Home shows the latest message and
  // order after a chat or a call. Coming back from a pushed screen always
  // refreshes; flicking between tabs is throttled so it doesn't refetch on
  // every tap. The request goes out once the screen has stopped moving: an
  // answer landing mid-slide would re-render and reflow the list being
  // uncovered while the UI thread animates it.
  const lastFocusFetch = useRef<Partial<Record<ScreenName, number>>>({});
  const lastTopKey = useRef(topKey);
  useEffect(() => {
    const returned = lastTopKey.current !== topKey;
    lastTopKey.current = topKey;
    // A screen that shows the voice catalog loads it if nothing else has.
    if (NEEDS_VOICES.has(topName)) ensureVoices();
    if (!tabsBase || launch.kind !== 'ready') return;
    const due = (name: ScreenName) =>
      returned || Date.now() - (lastFocusFetch.current[name] ?? 0) >= FOCUS_REFRESH_MS;
    // Stamped when the request actually goes, so one cancelled by a quick
    // move on doesn't count as done.
    const fetched = (name: ScreenName) => { lastFocusFetch.current[name] = Date.now(); };
    let work: (() => void) | null = null;
    if (topName === 'home' && due('home')) {
      work = () => { fetched('home'); void refreshUserCharacters(); };
    } else if (topName === 'studio' && due('studio')) {
      work = () => {
        fetched('studio');
        void refreshStudio();
        if (!scenariosRef.current) void loadScenarios();
      };
    } else if (topName === 'scenario-setup' && !scenariosRef.current) {
      work = () => { void loadScenarios(); };
    } else if (topName === 'settings' && due('settings')) {
      work = () => { fetched('settings'); void refreshEntitlement(); };
    }
    return work ? runAfterTransitions(work) : undefined;
  }, [topKey, topName, tabsBase, launch.kind, ensureVoices, refreshUserCharacters, refreshStudio, loadScenarios, refreshEntitlement]);

  // A tab drawn ahead of its first visit (TabRoots) fetches what it shows,
  // so it opens complete instead of on a skeleton.
  const prewarmedTab = useEvent((tab: TabId) => {
    if (tab !== 'studio') return;
    lastFocusFetch.current.studio = Date.now();
    void refreshStudio();
    if (!scenariosRef.current) void loadScenarios();
  });

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
      // Nothing leaves while signing out or while a companion is being made.
      if (busyRef.current || nameRequest.current) return true;
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
  const lastArrival = useRef<string | null>(null);
  const beenOnTop = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const s = navRef.current;
    const r = top(s);
    // Back on a screen that was on top before: it is already mounted, so it
    // won't move focus to its title again.
    const returned = lastArrival.current !== r.key && beenOnTop.current.has(r.key);
    lastArrival.current = r.key;
    const live = new Set(s.routes.map(x => x.key));
    beenOnTop.current = new Set([...beenOnTop.current, r.key].filter(k => live.has(k)));
    if (!screenReader || launch.kind !== 'ready') return;
    if (FOCUSES_OWN_TITLE.has(r.name) && !returned) return;
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
  // Home hands over the bare chip word ('Heavy'); the draft reads as the user's own words.
  const moodCompanion = useEvent((c: Companion, mood: string) => {
    void openChat(c, `I'm feeling ${mood.trim().toLowerCase()}.`);
  });
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
  /** S16 calls this once its character exists, after a request the user may
   *  not have waited for. `from` is the setup screen that asked. */
  const startStudioSession = useEvent((from: string, id: string, remember: boolean) => {
    rememberStudioChoice(id, remember);
    if (top(navRef.current).key !== from) {
      // They left setup before it finished: the character is made, so it
      // shows up in Studio to resume, but nothing opens over where they are now.
      void refreshStudio();
      return;
    }
    setStudioCharacter(null);
    setStudioCharacterId(id);
    setStudioRemember(remember);
    // The setup form is spent once the session starts, so Back returns to Studio.
    setNav(x => (top(x).key === from ? replaceTop(x, route('studio-session')) : x));
  });
  const capUpgrade = useEvent(() => { pendingTrigger.current = 'cap'; });
  // Returned, so the ask stays on screen until the system dialog is answered.
  const allowNotifications = useEvent(() => {
    pushStatus.current = null;
    return requestPushPermission().then(uploadPushToken).catch(() => {});
  });
  const recapAfterCall = useEvent((c: Companion) => leaveCall(() => setOverlay({ kind: 'recap', companion: c })));
  // The call has hung up by now: it leaves, and the plans open over whatever
  // it was started from, so closing them can't redial.
  const callOutOfMinutes = useEvent(() => leaveCall(() => openPaywall('voice')));
  // Returned, not voided: each button shows its own spinner until they settle.
  const signInWithGoogleTap = useEvent(() => handleOAuth('google'));
  const signInWithAppleTap = useEvent(() => handleOAuth('apple'));
  const signOutTap = useEvent(() => { void signOut(); });
  const depletedUpgrade = useEvent(() => openPaywall('voice'));
  const depletedText = useEvent(() => {
    const o = overlayRef.current;
    if (o?.kind === 'callDepleted') void openChat(liveCompanion(o.companion));
  });

  // Each keeps its identity while its inputs do, for the memoised screens.
  const meetCompanion = useMemo(() => ({ name: companionName, archetype: archetypePick }), [companionName, archetypePick]);
  const notifCompanion = useMemo(
    () => created ?? { id: 'new', name: companionName, archetype: archetypePick },
    [created, companionName, archetypePick],
  );
  const companionLimitReason = companions.length >= MAX_COMPANIONS
    ? `You can have up to ${MAX_COMPANIONS} companions for now.`
    : serverLimitReason ?? undefined;
  const [overlayExit] = useState(() => exit.fade);

  // The first screen is drawn under the native launch screen, which then
  // fades straight onto it; a launch that can't go anywhere shows its own
  // screen instead.
  useEffect(() => {
    if (launch.kind === 'misconfigured' || launch.kind === 'unreachable') revealApp();
  }, [launch.kind]);

  // ── Rendering ───────────────────────────────────────────────────────
  const renderTabRoot = (tab: TabId): ReactNode => {
    const go = goFor(nav.routes[0].key, tab);
    switch (tab) {
      case 'home':
        return (
          <Home
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
            companionLimitReason={companionLimitReason}
          />
        );
      case 'studio': {
        const StudioHome = studioScreens('S15_StudioHome');
        return (
          <StudioHome
            go={go}
            characters={studioCharacters ?? NO_STUDIO_CHARACTERS}
            status={studioStatus}
            onRetry={refreshStudio}
            onRefresh={refreshStudio}
            onDeleteCharacter={deleteStudio}
            setupScenario={setupScenario}
            resumeConvo={resumeStudio}
            openCreator={openCreator}
          />
        );
      }
      case 'sandbox': {
        const SandboxHome = sandboxScreens('S19_SandboxHome');
        return <SandboxHome go={go} comingSoon={CONFIG.sandboxComingSoon} isMinor={isMinor} openMode={openSandboxMode} />;
      }
      case 'settings': {
        const Settings = settingsScreens('S21_Settings');
        return (
          <Settings
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
    }
  };

  const renderRoute = (r: Route): ReactNode => {
    const go = goFor(r.key);
    const companion = companionFor(r);
    const missing = <Redirect to={redirectHome} />;
    const index = nav.routes.findIndex(x => x.key === r.key);
    const nameBelow = index > 0 ? nav.routes[index - 1].name : undefined;

    switch (r.name) {
      case 'splash': {
        const Splash = onboardingScreens('S01_Splash');
        return <Splash go={go} booting={launch.kind !== 'ready'} />;
      }
      case 'login': {
        const Login = extraScreens('S30_Login');
        return (
          <Login
            isNew={isNewUser}
            appleAvailable={false}
            onGoogle={signInWithGoogleTap}
            onApple={signInWithAppleTap}
            onEmailRequest={handleEmailRequest}
            onEmailVerify={handleEmailVerify}
            devCode={devCode}
            busy={authBusy}
            error={authError}
          />
        );
      }
      case 'age': {
        const Age = onboardingScreens('S02_Age');
        return (
          <Age
            go={go}
            onDob={setDateOfBirth}
            onBack={nameBelow ? back : undefined}
            onSignOut={signOutTap}
            initialDob={dateOfBirth || undefined}
          />
        );
      }
      case 'disclosure': {
        const Disclosure = onboardingScreens('S03_Disclosure');
        return <Disclosure go={go} />;
      }
      case 'pronouns': {
        const Pronouns = onboardingScreens('S05_Pronouns');
        return <Pronouns go={go} onGender={setUserGender} onName={setUserName} initialName={userName || undefined} />;
      }
      case 'comm': {
        const Comm = onboardingScreens('S06_Comm');
        return <Comm go={go} onCommStyle={setCommStyle} />;
      }
      case 'handoff': {
        const Handoff = onboardingScreens('S_Handoff');
        return <Handoff go={go} />;
      }
      case 'archetype': {
        const Archetype = onboardingScreens('S04_Archetype');
        return <Archetype go={go} onPick={setArchetypePick} backTo={nameBelow ?? 'handoff'} />;
      }
      case 'voice': {
        const Voice = onboardingScreens('S07_Voice');
        return <Voice go={go} onPickVoice={setVoicePick} apiVoices={voices} voicesStatus={voicesStatus} onRetryVoices={loadVoices} />;
      }
      case 'name': {
        const Name = onboardingScreens('S08_Name');
        return <Name go={go} archetype={archetypePick} onPickName={handlePickName} />;
      }
      case 'meet': {
        const Meet = onboardingScreens('S_Meet');
        return (
          <Meet
            go={go}
            companion={meetCompanion}
            accent={ARCHETYPE_COLORS[archetypePick] ?? W.primary}
            voiceId={chosenVoiceId ?? undefined}
          />
        );
      }
      case 'notif': {
        const NotifPermission = extraScreens('S25_NotifPermission');
        return (
          <NotifPermission
            go={go}
            companion={notifCompanion}
            onAllow={allowNotifications}
            next={r.params?.next}
          />
        );
      }
      case 'first-chat': {
        // Only ever with a real companion: without one there is nobody to talk to.
        if (!created) return missing;
        const FirstChat = chatScreens('S09_FirstChat');
        return (
          <FirstChat
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
      }
      case 'chat': {
        if (!companion) return missing;
        const Chat = chatScreens('S14_Chat');
        const key = r.key;
        return (
          <Chat
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
            onCall={forRoute(key, 'call', () => () => {
              const c = companionOfRoute(key);
              if (c) startCall(c);
            })}
          />
        );
      }
      case 'call': {
        if (!companion) return missing;
        const VoiceCall = callScreens('S12_VoiceCall');
        const key = r.key;
        return (
          <VoiceCall
            go={go}
            companion={companion}
            accent={CONFIG.orbHue}
            orbIntensity={1}
            voiceSecondsRemaining={entitlement ? entitlement.voice.remaining_seconds : null}
            userId={userId ?? undefined}
            characterId={idOf(companion)}
            onOutOfMinutes={callOutOfMinutes}
            onCallEnded={refreshEntitlement}
            onRecap={forRoute(key, 'recap', () => () => {
              const c = companionOfRoute(key);
              if (c) recapAfterCall(c);
            })}
            returnTo={nameBelow === 'chat' ? 'chat' : 'home'}
          />
        );
      }
      case 'crisis': {
        const Crisis = extraScreens('S28_CrisisChat');
        return <Crisis go={go} backTo={nameBelow ?? 'home'} />;
      }
      case 'profile': {
        if (!companion) return missing;
        const CompanionEdit = extraScreens('S26_CompanionEdit');
        // A profile route belongs to one companion for its whole life.
        const id = idOf(companion);
        return (
          <CompanionEdit
            go={go}
            companion={companion}
            onSave={forRoute(r.key, 'save', () => (p: UpdateCharacterPayload) => saveCompanion(id, p))}
            onRefresh={refreshUserCharacters}
            onDelete={forRoute(r.key, 'delete', () => () => deleteCompanion(id))}
            backTo={nameBelow ?? 'home'}
            apiVoices={voices}
          />
        );
      }
      case 'user-profile': {
        const UserProfile = settingsScreens('S_UserProfile');
        return (
          <UserProfile
            go={go}
            userName={displayName}
            userEmail={userEmail}
            onSave={saveProfile}
            onDeleteAccount={deleteAccount}
            backTo={nameBelow ?? 'settings'}
          />
        );
      }
      case 'memories': {
        // From Settings there is no particular companion: the most recent one.
        const c = companion ?? companions[0] ?? null;
        const Memories = settingsScreens('S22_Memories');
        return <Memories go={go} characterId={c ? idOf(c) : undefined} companionName={c?.name} />;
      }
      case 'scenario-setup': {
        const sc = scenario ?? SCENARIOS[0];
        const ScenarioSetup = studioScreens('S16_ScenarioSetup');
        const key = r.key;
        return (
          <ScenarioSetup
            go={go}
            scenario={sc}
            def={scenarios?.find(d => d.id === sc.id)}
            defStatus={scenariosStatus}
            onRetry={loadScenarios}
            apiVoices={voices}
            voicesStatus={voicesStatus}
            onRetryVoices={loadVoices}
            onStart={forRoute(key, 'start', () => (id: string, remember: boolean) => startStudioSession(key, id, remember))}
          />
        );
      }
      case 'studio-session': {
        const StudioSession = studioScreens('S17_StudioSession');
        return (
          <StudioSession
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
      }
      case 'character-creator': {
        const CharacterCreator = studioScreens('S18_CharacterCreator');
        return <CharacterCreator go={go} apiVoices={voices} voicesStatus={voicesStatus} onRetryVoices={loadVoices} />;
      }
      case 'sandbox-session': {
        const SandboxSession = sandboxScreens('S20_SandboxSession');
        return (
          <SandboxSession
            go={go}
            mode={sandboxMode ?? SANDBOX_MODES[0]}
            isMinor={isMinor}
            companionName={companions[0]?.name}
          />
        );
      }
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
        <>
          <TabRoots
            active={nav.tab}
            renderTab={tab => <ErrorBoundary name={`tab:${tab}`}>{renderTabRoot(tab)}</ErrorBoundary>}
            // Not under a sheet: its touches don't reach the stack, so the
            // stack can't tell whether the user is busy with it.
            prewarm={launch.kind === 'ready' && !overlay && !busy}
            onPrewarm={prewarmedTab}
          />
          {/* The bar belongs to the tab layer and moves with it: a pushed
              screen slides in over it, and it is uncovered as that screen
              slides back out, never drawn over a screen that is leaving. */}
          <TabBar
            active={nav.tab}
            onChange={onTabChange}
            onReselect={onTabReselect}
            sandboxComingSoon={CONFIG.sandboxComingSoon}
            hidden={launch.kind !== 'ready'}
          />
        </>
      );
    }
    const pushed = nav.routes.findIndex(x => x.key === r.key) > 0;
    const key = r.key;
    return (
      <ErrorBoundary
        name={`screen:${r.name}`}
        resetKey={key}
        onReset={pushed ? forRoute(key, 'drop', () => () => dropRoute(key)) : undefined}
      >
        <UnlessDropped dropped={droppedRoutes} routeKey={key}>{renderRoute(r)}</UnlessDropped>
      </ErrorBoundary>
    );
  };

  const renderOverlay = (o: Overlay): ReactNode => {
    switch (o.kind) {
      case 'paywall': {
        const Paywall = settingsScreens('S23_Paywall');
        return (
          <Paywall
            go={overlayGo}
            trigger={o.trigger}
            backTo={topName}
            entitlement={entitlement}
            entitlementFailed={entitlementFailed}
            onRetryEntitlement={refreshEntitlement}
            // Both arrive once the sheet has animated out.
            onPurchased={applyEntitlement}
            onClose={closePaywall}
          />
        );
      }
      case 'callDepleted': {
        const c = companionById(idOf(o.companion)) ?? o.companion;
        const StartCallDepleted = extraScreens('S27_StartCallDepleted');
        return (
          <StartCallDepleted
            companion={c}
            onClose={closeOverlay}
            onUpgrade={depletedUpgrade}
            onText={depletedText}
            resetDate={entitlement ? formatResetDate(entitlement.period.renews_at) : undefined}
          />
        );
      }
      case 'recap': {
        const c = companionById(idOf(o.companion)) ?? o.companion;
        const Recap = extraScreens('S29_Recap');
        return <Recap go={overlayGo} companion={c} characterId={idOf(c)} />;
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
  // A few milliseconds while this phone's saved session is read, still under
  // the native launch screen, so the first screen drawn is the right one.
  if (launch.kind === 'reading') return <View style={styles.root} />;

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
          canSwipeBack={!covered && !creatingCompanion && !NO_SWIPE_BACK.has(topName)}
          onSwipeBack={swipedBack}
          // Under the launch screen the first screen is simply there; its
          // fade-out is the only transition.
          initialEnter={appRevealed() ? 'fade' : 'none'}
          onFirstFrame={revealApp}
        />
      </View>

      {overlay ? (
        // Each sheet animates itself in; this carries it out as it closes.
        <Animated.View key={overlay.kind} exiting={overlayExit} pointerEvents="box-none" style={styles.overlay}>
          {renderOverlay(overlay)}
        </Animated.View>
      ) : null}

      <ToastHost />
      {busy ? <BusyOverlay label={busy} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: W.bg },
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: Z.sheet },
});
