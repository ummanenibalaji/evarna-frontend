// App.tsx (navigation) — main orchestrator replicating app.jsx's string-based
// router. Keeps the exact go(screen) + tab behavior of the prototype.

import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, Alert, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { W } from '../theme/theme';
import { ScreenName, PaywallTrigger } from './types';
import {
  CONFIG,
  SCENARIOS, SANDBOX_MODES, ARCHETYPE_COLORS, Companion, Scenario, SandboxMode,
} from '../data/config';
import {
  onboardUser, getVoices, ApiVoice, getUserCharacters, ApiCharacter, createCharacter,
  signInWithGoogle, signInWithApple, requestEmailCode, verifyEmailCode, getMe, logout, AuthSession,
  updateCharacter, deleteCharacter, updateMe, deleteMe,
  getScenarios, getStudioCharacters, ApiScenario, ApiStudioCharacter, setPushToken,
  getEntitlement, ApiEntitlement,
} from '../api';
import { loadAuthToken, setAuthToken, getAuthToken, ApiError, streamConversation, limitMessage } from '../api/client';
import { getGoogleIdToken, googleSignOut, GoogleSignInUnavailable } from '../lib/googleSignIn';
import { formatResetDate } from '../lib/entitlement';
import {
  requestPushPermission, getPushTokenIfGranted, getDeviceTimezone,
  addPushTapListener, addPushReplyListener, notifyReplyFailed,
  getInitialPushTap, PushTapData,
} from '../lib/notifications';

const SESSION_KEY = 'evarna_session';
import { BottomNav, TabId } from '../components/BottomNav';

import {
  S01_Splash, S02_Age, S03_Disclosure, S05_Pronouns, S06_Comm, S_Handoff,
  S04_Archetype, S07_Voice, S08_Name, S_Meet,
} from '../screens/Onboarding';
import { S10_Home } from '../screens/Home';
import { S09_FirstChat, S12_VoiceCall, S14_Chat } from '../screens/Chat';
import {
  S15_StudioHome, S16_ScenarioSetup, S17_StudioSession, S18_CharacterCreator,
} from '../screens/Studio';
import { S19_SandboxHome, S20_SandboxSession } from '../screens/Sandbox';
import { S21_Settings, S22_Memories, S23_Paywall, S24_TopUp, S_UserProfile } from '../screens/Settings';
import {
  S25_NotifPermission, S26_CompanionEdit, S27_StartCallDepleted,
  S28_CrisisChat, S29_Recap, S30_Login,
} from '../screens/Extras';

const t = CONFIG;

// Archetype name mapping: frontend uses 'friend', backend uses 'bestfriend'
const ARCHETYPE_MAP: Record<string, string> = {
  friend: 'bestfriend', mentor: 'mentor', partner: 'partner', challenger: 'challenger',
};

// Reverse map for backend → frontend archetype keys
const ARCHETYPE_MAP_REV: Record<string, Companion['archetype']> = {
  bestfriend: 'friend', friend: 'friend',
  mentor: 'mentor', partner: 'partner', challenger: 'challenger',
};

// Phase 1 cap: keep things sane until paywall lands in Phase 2.
const MAX_COMPANIONS = 5;

// Convert ApiCharacter from GET /characters into the home-screen Companion shape.
function apiCharacterToCompanion(c: ApiCharacter): Companion {
  return {
    id: c._id,
    name: c.name,
    archetype: ARCHETYPE_MAP_REV[c.archetype] ?? 'mentor',
    gender: c.gender,
    voice: c.voice_id,
    lastTalked: c.last_interaction_at ? 'Recently' : undefined,
    lastInteractionAt: c.last_interaction_at,
    lastMessagePreview: c.last_message_preview ?? undefined,
    memoryHighlight: c.memory_highlight ?? undefined,
    memory: c.memory_highlight ?? undefined,
    personalitySliders: c.personality_sliders,
  };
}

// Studio cards carry icon + accent, which the backend doesn't return. Match a
// scenario character to its local look; custom characters get a neutral one.
function studioScenarioFor(c: ApiStudioCharacter): Scenario {
  return SCENARIOS.find(s => s.id === c.scenario_id)
    ?? { id: 'custom', icon: 'sparkle', name: c.name, desc: '', accent: W.secondary };
}

const INTENT_MAP: Record<string, string> = {
  mentor: 'personal development', friend: 'emotional support',
  partner: 'connection', challenger: 'accountability',
};

export default function App() {
  // Routing
  // Splash is only the boot placeholder now — the effect below routes to
  // home / onboarding / login once the auth token has been checked.
  const [screen, setScreen] = useState<ScreenName>('splash');
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [activeCompanion, setActiveCompanion] = useState<Companion | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode | null>(null);
  // Set when something actually triggers the paywall, so PAYWALL_HEADERS'
  // other cases stop being dead copy. It had no setter before, which is why
  // every route into the paywall claimed to be about voice.
  const [paywallTrigger, setPaywallTrigger] = useState<PaywallTrigger>('voice');
  const [isNewUser, setIsNewUser] = useState(false);
  // Login screen state
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  // Set only when the backend could not actually send the mail — development
  // with no provider configured. It returns the code instead so the flow can
  // still be completed; production refuses to produce it at all.
  const [devCode, setDevCode] = useState<string | null>(null);
  // The signed-in user's email, from GET /auth/me — shown in Settings.
  const [userEmail, setUserEmail] = useState('');
  // Track where modal/edit screens were opened from so the back button returns correctly.
  const [profileBack, setProfileBack] = useState<ScreenName>('chat');
  const [paywallBack, setPaywallBack] = useState<ScreenName>('home');
  const [topupBack, setTopupBack] = useState<ScreenName>('home');

  // Onboarding-collected
  const [voicePick, setVoicePick] = useState<string | null>(null);
  const [archetypePick, setArchetypePick] = useState<Companion['archetype']>('mentor');
  // Empty until the user names them on S08. It used to default to "Sage",
  // which is a real name for a companion nobody had named yet.
  const [companionName, setCompanionName] = useState('');

  // Mode for the companion-selection flow (archetype → voice → name):
  //   'onboarding' — initial flow, hits POST /users/onboard
  //   'add'        — adding a companion later, hits POST /characters/create
  const [addMode, setAddMode] = useState<'onboarding' | 'add'>('onboarding');

  // Onboarding user attributes (collected from screens S02 / S05 / S06)
  const [dateOfBirth, setDateOfBirth] = useState('1995-06-15');
  const [userGender, setUserGender] = useState('non-binary');
  const [commStyle, setCommStyle] = useState('warm');
  // The user's real name, collected on S05 and sent as User.display_name.
  // Persisted with the session so a restored install doesn't lose it.
  // Previously this was never collected and CONFIG.userName ("Aria") was sent
  // for every single user.
  const [userName, setUserName] = useState('');

  // Backend IDs — set after successful onboarding API call
  // What this account is entitled to. Held here rather than fetched in a leaf
  // because the call button below decides on it, and that decision lives in the
  // router — same shape as refreshUserCharacters.
  const [entitlement, setEntitlement] = useState<ApiEntitlement | null>(null);
  const [entitlementFailed, setEntitlementFailed] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [isMinor, setIsMinor] = useState(false);

  // The companion created during onboarding — replaces static placeholder on home screen
  const [userCompanion, setUserCompanion] = useState<Companion | null>(null);

  // All of the user's companions, fetched from GET /characters (token-scoped).
  // Sorted newest-interaction-first; drives the multi-companion list view on home.
  const [userCharacters, setUserCharacters] = useState<Companion[] | null>(null);

  // Refetch the user's companions from the backend. Safe to call after onboarding,
  // after creating a new companion, or whenever returning to home.
  const refreshUserCharacters = () =>
    getUserCharacters()
      .then(list => {
        const sorted = [...list].sort((a, b) => {
          const ta = a.last_interaction_at ? new Date(a.last_interaction_at).getTime() : 0;
          const tb = b.last_interaction_at ? new Date(b.last_interaction_at).getTime() : 0;
          return tb - ta;
        });
        const mapped = sorted.map(apiCharacterToCompanion);
        setUserCharacters(mapped);
        return mapped;
      })
      .catch((): Companion[] | null => null /* backend offline — fall back to userCompanion */);

  /**
   * A degraded payload is discarded, not stored. The server fails open by
   * answering "free, full allowance, period starts now", so rendering it would
   * tell a Plus subscriber they had been downgraded to 8 minutes. Keeping the
   * last known values is the lesser wrong; with nothing known, the UI shows
   * "unknown" rather than guessing.
   */
  const entitlementInFlight = useRef(false);
  const refreshEntitlement = (): Promise<ApiEntitlement | null> => {
    // One at a time. Opening and closing the paywall quickly would otherwise
    // race two reads, and the older answer could land last.
    if (entitlementInFlight.current) return Promise.resolve(entitlement);
    entitlementInFlight.current = true;
    return getEntitlement()
      .then(e => {
        if (e.degraded) {
          console.warn('[Entitlement] degraded snapshot — keeping last known values');
          // With nothing known, this is no better than a failure: the payload
          // says "free, full allowance" regardless of what was bought.
          setEntitlement(prev => { if (!prev) setEntitlementFailed(true); return prev; });
          return null;
        }
        setEntitlement(e);
        setEntitlementFailed(false);
        return e;
      })
      .catch((): null => {
        setEntitlementFailed(true);
        return null;
      })
      .finally(() => { entitlementInFlight.current = false; });
  };

  // ── Push ──────────────────────────────────────────────────────────────────
  // Every one of these is fire-and-forget with a caught error: a user whose
  // notification permission is broken must still be able to use the app.

  // Timezone rides along with the token and is re-sent on every launch —
  // people travel, and a stale zone means a check-in at 3am.
  const uploadPushToken = (token: string | null) => {
    if (!token) return;
    setPushToken(token, getDeviceTimezone()).catch(e => console.warn('[Push] upload failed:', e));
  };

  // Launch / post-sign-in refresh. Does NOT prompt — the ask belongs to S25.
  const refreshPushToken = () => {
    getPushTokenIfGranted().then(uploadPushToken).catch(() => {});
  };

  // A tapped check-in opens that companion's chat. The message itself is already
  // in the backend's history, so S14_Chat's own load is what surfaces it.
  // ponytail: always refetches the character list rather than reading state,
  // which keeps the listener closure-free at the cost of one request per tap.
  const openFromPush = async (data: PushTapData) => {
    if (!data.character_id) return;
    const c = (await refreshUserCharacters())?.find(x => x.id === data.character_id);
    if (!c) return;
    setActiveCompanion(c);
    setScreen('chat');
  };

  // A reply typed straight into the notification shade. This can run with no UI
  // mounted (app backgrounded or killed), so everything it needs comes from the
  // payload and the persisted token — never from React state.
  const sendPushReply = async (text: string, data: PushTapData) => {
    const message = text.trim();
    if (!message) return;
    // No session, or no token to send it with: the user typed something and
    // believes it went. Say otherwise rather than dropping it silently.
    if (!data.session_id || !(await loadAuthToken())) { notifyReplyFailed(); return; }
    // ponytail: fired and never awaited or aborted on purpose — the backend
    // persists the turn and finishes the reply even if we disconnect, and it
    // pushes the response itself. Consuming the stream here would only keep a
    // backgrounded app alive for output nobody is looking at.
    let opened = false;
    streamConversation({ session_id: data.session_id, message }, {
      onChunk: () => { opened = true; },
      onDone: () => {},
      onCrisis: () => { opened = true; },
      // Only a failure *before* the first byte means it never got sent; a drop
      // mid-stream means the server already has the turn.
      onError: () => { if (!opened) notifyReplyFailed(); },
    });
  };

  // Prevent double-write on first restore
  const restoredRef = useRef(false);

  // Boot. Two steps, in order:
  //   1. Restore the cached session blob — companion + display data only, so the
  //      home screen has something to paint immediately.
  //   2. Check the auth token. It, not the blob, decides *who* the user is:
  //      valid + onboarded → home, valid + not onboarded → onboarding, else login.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(SESSION_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as {
            userId: string;
            characterId: string;
            companion: Companion;
            isMinor?: boolean;
            userName?: string;
          };
          if (saved.characterId) setCharacterId(saved.characterId);
          if (saved.isMinor !== undefined) setIsMinor(saved.isMinor);
          if (saved.userName) setUserName(saved.userName);
          if (saved.companion) {
            setUserCompanion(saved.companion);
            setCompanionName(saved.companion.name);
            setArchetypePick(saved.companion.archetype);
          }
          restoredRef.current = true;
        }
      } catch { /* corrupt blob — the token check below still decides the route */ }

      const token = await loadAuthToken();
      if (!token) { setScreen('login'); return; }
      try {
        const me = await getMe();
        setUserId(me.user_id);
        if (me.display_name) setUserName(me.display_name);
        setUserEmail(me.email ?? '');
        setIsMinor(!!me.is_minor);
        setSettings({ dailyCheckin: me.checkins_enabled !== false });
        refreshPushToken();
        if (me.onboarding_completed) {
          refreshUserCharacters();
          refreshEntitlement();
          setScreen('home');
          // Killed-app case: the tap that launched us. Read after the session is
          // confirmed, or the character fetch it makes would 401.
          getInitialPushTap().then(d => d && openFromPush(d)).catch(() => {});
        } else {
          setIsNewUser(true);
          setScreen('age');
        }
      } catch {
        // 401 already cleared the token inside the client. Anything else (offline)
        // just means we can't confirm the session — ask them to sign in again.
        // ponytail: no offline grace period; add one if flaky networks bite.
        setScreen('login');
      }
    })();
  }, []);

  // A balance can change while the app is away: a call on another device, a
  // period that rolled over, a top-up. Without this a cached zero would keep
  // showing the depleted sheet after the minutes came back.
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => {
      if (st === 'active' && getAuthToken()) refreshEntitlement();
    });
    return () => sub.remove();
  }, []);

  // Backgrounded case. Registered once; the app is already authenticated by the
  // time a notification can arrive for it.
  useEffect(() => addPushTapListener(d => { openFromPush(d).catch(() => {}); }), []);

  // Inline reply. Its own listener so the tap path stays purely navigational —
  // replying from the shade must not drag the user into a screen.
  useEffect(() => addPushReplyListener((text, d) => {
    sendPushReply(text, d).catch(() => notifyReplyFailed());
  }), []);

  // ── Auth handlers ────────────────────────────────────────────────────────

  const applySession = (s: AuthSession) => {
    setAuthToken(s.token);
    setUserId(s.user_id);
    refreshPushToken();
    if (s.onboarding_completed) {
      refreshUserCharacters();
      refreshEntitlement();
      go('home');
    } else {
      setIsNewUser(true);
      go('age');
    }
  };

  // Apple is still a stub: it needs Sign in with Apple enabled on the App ID,
  // which needs Developer Program enrolment, which needs the D-U-N-S number.
  // See backend/docs/auth-setup.md. Google is live below.
  const appleIdToken = async (): Promise<string | null> => null;

  const handleOAuth = async (provider: 'google' | 'apple') => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const idToken = provider === 'google' ? await getGoogleIdToken() : await appleIdToken();
      if (!idToken) {
        // Google returns null when the user backs out of the picker. That is
        // not an error and must not be reported as one.
        if (provider === 'apple') {
          setAuthError("Apple sign-in isn't available yet — continue with email.");
        }
        return;
      }
      applySession(provider === 'google' ? await signInWithGoogle(idToken) : await signInWithApple(idToken));
    } catch (e) {
      // A configuration or build problem is a different failure from a rejected
      // token, and saying so saves whoever hits it a long afternoon.
      if (e instanceof GoogleSignInUnavailable) {
        setAuthError(e.message);
      } else {
        console.warn('[Auth] oauth failed:', e);
        setAuthError("Couldn't sign you in. Please try again.");
      }
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailRequest = async (email: string): Promise<boolean> => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const res = await requestEmailCode(email);
      setPendingEmail(email);
      setDevCode(res.dev_code ?? null);
      return true;
    } catch (e) {
      console.warn('[Auth] email request failed:', e);
      // Rate limiting needs its own message: "check the address" is wrong and
      // actively misleading when the address was fine and they just asked
      // too many times.
      setAuthError(
        e instanceof ApiError && e.code === 'RATE_LIMITED'
          ? e.message
          : "Couldn't send a code to that address. Check it and try again.",
      );
      return false;
    } finally {
      setAuthBusy(false);
    }
  };

  const handleEmailVerify = async (code: string) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      applySession(await verifyEmailCode(pendingEmail, code));
    } catch (e) {
      console.warn('[Auth] email verify failed:', e);
      setAuthError('That code didn\'t work. Check it or request a new one.');
    } finally {
      setAuthBusy(false);
    }
  };

  // Signs out every device (backend-side), then wipes local identity.
  const signOut = async () => {
    // First, while the token is still valid: a signed-out device must stop
    // receiving someone else's companion messages. After setAuthToken(null)
    // this would 401, and after logout() the token may already be revoked.
    try { await setPushToken(null); } catch { /* offline — best effort */ }
    try { await logout(); } catch { /* offline — sign out locally anyway */ }
    // Clear the native Google session too, so the next sign-in shows the
    // account picker instead of silently resuming the same account — which
    // looks exactly like sign-out having failed.
    await googleSignOut();
    setAuthToken(null);
    await AsyncStorage.removeItem(SESSION_KEY).catch(() => {});
    setUserId(null);
    setCharacterId(null);
    setUserCompanion(null);
    setUserCharacters(null);
    setEntitlement(null);
    setEntitlementFailed(false);
    setUserName('');
    setUserEmail('');
    setPendingEmail('');
    setAuthError(null);
    setScreen('login');
  };

  // Irreversible account deletion (App Store 5.1.1(v)). Reuses signOut's local
  // teardown; its logout() call just 401s on an already-deleted account.
  const deleteAccount = async () => {
    try {
      await deleteMe();
    } catch (e) {
      console.warn('[Account] delete failed:', e);
      Alert.alert('Couldn\'t delete your account', 'We couldn\'t reach the server. Please try again.');
      return;
    }
    await signOut();
  };

  const handleDeleteCompanion = async (id: string) => {
    try {
      await deleteCharacter(id);
    } catch (e) {
      console.warn('[Companion] delete failed:', e);
      Alert.alert('Couldn\'t delete', "We couldn't reach the server. Please try again.");
      return;
    }
    setActiveCompanion(null);
    if (id === characterId) setCharacterId(null);
    refreshUserCharacters();
  };

  // Persist session whenever IDs are set (only after onboarding, not on restore)
  useEffect(() => {
    if (!userId || !characterId) return;
    const companion: Companion = {
      id: characterId,
      name: companionName,
      archetype: archetypePick,
      lastTalked: 'Just now',
    };
    setUserCompanion(companion);
    AsyncStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ userId, characterId, companion, isMinor, userName }),
    ).catch(() => {});
    // After a fresh onboarding or new-character creation, sync the home list
    // so the new companion appears alongside the existing ones.
    refreshUserCharacters();
  }, [userId, characterId]);

  // Voice catalog from backend (fetched once on mount)
  const [backendVoices, setBackendVoices] = useState<ApiVoice[]>([]);

  useEffect(() => {
    getVoices()
      .then(setBackendVoices)
      .catch(() => { /* backend offline — S07_Voice falls back to config voices */ });
  }, []);

  // Studio: server-owned scenario definitions (the setup form renders from these)
  // and the user's studio characters. Both are token-scoped.
  const [backendScenarios, setBackendScenarios] = useState<ApiScenario[]>([]);
  const [studioCharacters, setStudioCharacters] = useState<ApiStudioCharacter[]>([]);
  // The studio character the session screen is talking to.
  const [studioCharacter, setStudioCharacter] = useState<ApiStudioCharacter | null>(null);
  const [studioCharacterId, setStudioCharacterId] = useState<string | null>(null);
  // S16's "Remember this session" choice, held here between setup and S17,
  // which is what actually calls startSession. Resumed sessions remember.
  const [studioRemember, setStudioRemember] = useState(true);

  useEffect(() => {
    getScenarios()
      .then(setBackendScenarios)
      .catch(() => { /* backend offline — S16 shows its loading state */ });
  }, []);

  // Refetch whenever the studio tab is opened. That also covers "just created a
  // character", since both creator flows land back on 'studio'.
  useEffect(() => {
    if (screen !== 'studio') return;
    getStudioCharacters()
      .then(setStudioCharacters)
      .catch(() => { /* backend offline — show what we have */ });
  }, [screen]);

  // settings
  const [settings, setSettings] = useState({ dailyCheckin: true });
  // The one setting left is real: the server skips proactive check-ins for
  // anyone who turns it off. Optimistic, and put back if the save fails, so the
  // switch never shows a state the server does not have.
  const saveSettings = (next: { dailyCheckin: boolean }) => {
    const previous = settings;
    setSettings(next);
    if (next.dailyCheckin !== previous.dailyCheckin) {
      updateMe({ checkins_enabled: next.dailyCheckin }).catch(() => setSettings(previous));
    }
  };

  // The real, onboarded name — or empty. It used to fall back to "Aria", so
  // anyone whose profile had not loaded yet was greeted by someone else's name.
  const displayName = userName.trim();
  // Comes from GET /auth/me on boot; empty until then (better than a fabricated address).
  const displayEmail = userEmail;

  // The live backend list, or the companion just created locally while the
  // refresh is in flight. Nothing else: this used to fall through to three
  // invented companions ("Sage", "Atlas", "Nova") carrying invented memories
  // like "your interview is tomorrow", which a user with an unreachable
  // backend would read as their own.
  const companions: Companion[] =
    (userCharacters && userCharacters.length > 0)
      ? userCharacters
      : userCompanion
        ? [userCompanion]
        : [];
  // Nullable, now that there is no invented companion to fall back on. An
  // empty list is a real state: a fresh account before onboarding finishes, or
  // an unreachable backend.
  const currentCompanion: Companion | null = activeCompanion ?? companions[0] ?? null;

  // Everything in `companions` is now backed by a real record, but the id is
  // still what decides whether a tap opens a real session.
  const isBackendCompanion = !!currentCompanion
    && (!!userCharacters?.some(c => c.id === currentCompanion.id) || currentCompanion.id === characterId);
  const activeCharacterId = isBackendCompanion ? String(currentCompanion.id) : null;

  // Navigation helper — mirrors prototype go() and remembers origin for modal-like screens.
  const go = (s: ScreenName) => {
    // Capture the back-target BEFORE we change screen, so profile/paywall/topup return correctly.
    if (s === 'profile' || s === 'user-profile') setProfileBack(screen);
    if (s === 'paywall') setPaywallBack(screen);
    if (s === 'topup') setTopupBack(screen);
    // Both sheets show a balance and a catalog, so re-read on the way in rather
    // than on every navigation.
    if (s === 'paywall' || s === 'topup') refreshEntitlement();
    setScreen(s);
    if (s === 'home' || s === 'first-chat') setActiveTab('home');
    if (s === 'studio' || s === 'scenario-setup' || s === 'studio-session' || s === 'character-creator') setActiveTab('studio');
    if (s === 'sandbox' || s === 'sandbox-session') setActiveTab('sandbox');
    if (s === 'settings' || s === 'memories' || s === 'user-profile') setActiveTab('settings');
    // paywall / topup keep whatever tab was active so the underlay matches the origin
  };

  // Allow Settings to set the active companion before opening profile.
  const openCompanionProfile = (c: Companion) => {
    setActiveCompanion(c);
    setProfileBack(screen);
    setScreen('profile');
  };

  const onTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab === 'home') setScreen('home');
    if (tab === 'studio') setScreen('studio');
    if (tab === 'sandbox') setScreen('sandbox');
    if (tab === 'settings') setScreen('settings');
  };

  // Called from S08_Name. In "onboarding" mode this hits POST /users/onboard,
  // which fills in the signed-in user + their first companion. In "add" mode
  // the user is already onboarded, so we hit POST /characters/create.
  const handlePickName = async (name: string) => {
    setCompanionName(name);
    const apiArchetype = ARCHETYPE_MAP[archetypePick] ?? archetypePick;

    // Backend gender enum is strict (male/female/nonbinary/undisclosed). The
    // onboarding UI uses the hyphenated 'non-binary' — normalize before sending.
    const genderNorm = userGender === 'non-binary' ? 'nonbinary' : userGender;

    // The backend rejects an empty or non-UUID voice_id. Make sure we send a
    // real backend voice: prefer the user's pick, else the first voice matching
    // their gender, else the first available. Fetch the catalog on demand if
    // it didn't load earlier.
    let voices = backendVoices;
    if (voices.length === 0) {
      try {
        voices = await getVoices();
        setBackendVoices(voices);
      } catch {
        /* surfaced below */
      }
    }
    const chosenVoice =
      voices.find(v => v.id === voicePick) ??
      voices.find(v => v.gender === (genderNorm === 'male' ? 'male' : 'female')) ??
      voices[0];

    if (!chosenVoice) {
      Alert.alert(
        'Setup error',
        "Couldn't load companion voices from the server. Check your connection and try again.",
      );
      return;
    }

    if (addMode === 'add' && userId) {
      try {
        const res = await createCharacter({
          archetype: apiArchetype,
          gender: chosenVoice.gender,
          voice_id: chosenVoice.id,
          name,
        });
        // Refresh the home list so the new companion shows up immediately,
        // and switch the in-memory active character to the new one.
        setCharacterId(res.character_id);
        const newCompanion: Companion = {
          id: res.character_id,
          name,
          archetype: archetypePick,
          lastTalked: 'Just now',
        };
        setUserCompanion(newCompanion);
        setActiveCompanion(newCompanion);
        refreshUserCharacters();
      } catch (e) {
        console.warn('[AddCompanion] API failed:', e);
        const limit = limitMessage(e);
        Alert.alert(
          limit ? 'Companion limit reached' : 'Connection problem',
          limit ?? "Couldn't reach the server to add your companion. Make sure the backend is reachable and try again.",
        );
      }
      return;
    }

    // S05 gates advancing on a non-empty name, so this should always hold.
    // Fail loudly rather than silently onboarding another user called "Aria".
    if (!userName.trim()) {
      Alert.alert('Setup error', 'We didn\'t get your name. Please go back and enter it.');
      return;
    }

    try {
      const res = await onboardUser({
        display_name: userName.trim(),
        gender: genderNorm,
        date_of_birth: dateOfBirth,
        communication_style: commStyle,
        intent: INTENT_MAP[archetypePick] ?? 'emotional support',
        companion: {
          name,
          archetype: apiArchetype,
          gender: chosenVoice.gender,
          voice_id: chosenVoice.id,
        },
      });
      setUserId(res.user_id);
      setCharacterId(res.character_id);
      setIsMinor(res.is_minor ?? false);
      const newCompanion: Companion = {
        id: res.character_id,
        name,
        archetype: archetypePick,
        lastTalked: 'Just now',
      };
      setUserCompanion(newCompanion);
    } catch (e) {
      console.warn('[Onboarding] API failed:', e);
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === 'UNDER_MINIMUM_AGE') {
        Alert.alert(
          'You need to be 15 or older',
          "Evarna isn't available to under-15s, so we can't finish setting up your account. If your birth date is wrong, go back and correct it.",
        );
      } else if (code === 'ALREADY_ONBOARDED') {
        // Onboarding ran twice (e.g. a retry after a dropped response). The
        // account already exists — just take them home.
        Alert.alert('You\'re already set up', 'Taking you to your companions.');
        refreshUserCharacters();
        go('home');
      } else {
        Alert.alert(
          'Connection problem',
          "Couldn't reach the server to create your companion, so replies won't be real yet. Make sure the backend is reachable and try onboarding again.",
        );
      }
    }
  };

  // Home rendered plainly (used both as a screen and as the backdrop for sheets)
  const renderHome = (interactive: boolean) => (
    <S10_Home
      go={interactive ? go : () => {}}
      companions={companions}
      userName={displayName}
      maxCompanions={MAX_COMPANIONS}
      onSelectCompanion={interactive ? (c) => { setActiveCompanion(c); setScreen('chat'); } : () => {}}
      onCallCompanion={interactive ? (c) => {
        setActiveCompanion(c);
        // The balance we already know about, so someone with nothing left gets
        // the depleted sheet instead of a call that fails on connect. An
        // unknown balance dials anyway and lets the server decide — "we could
        // not read your plan" must not read as "you are out of minutes".
        const spent = entitlement != null && entitlement.voice.remaining_seconds <= 0;
        if (spent) { setPaywallTrigger('voice'); setScreen('callDepleted'); }
        else setScreen('call');
      } : () => {}}
      onAddCompanion={interactive ? () => {
        // Cap at 5 (Phase 1 sanity). When at the limit, the "+" still renders
        // but is non-interactive — this branch only fires when canAdd is true.
        if (companions.length >= MAX_COMPANIONS) return;
        setAddMode('add');
        setScreen('archetype');
      } : undefined}
    />
  );

  // These screens are all about one companion. Reaching them without one used
  // to be impossible because the list always had a static placeholder in it;
  // now it can genuinely be empty, and home is the honest landing rather than
  // a crash on a companion that is not there.
  //
  // The compiler will not catch a miss here: without noUncheckedIndexedAccess,
  // `companions[0]` types as Companion even when the array is empty, so
  // currentCompanion reads as non-null at every use. This guard is the only
  // thing standing between an empty list and a crash.
  const COMPANION_SCREENS: ScreenName[] = ['callDepleted', 'call', 'chat', 'crisis', 'profile', 'recap', 'memories'];

  const renderScreen = () => {
    if (!currentCompanion && COMPANION_SCREENS.includes(screen)) return renderHome(true);
    switch (screen) {
      case 'splash': return <S01_Splash go={go} goNew={() => { setIsNewUser(true); go('login'); }} />;
      case 'age': return <S02_Age go={go} onDob={setDateOfBirth} />;
      case 'disclosure': return <S03_Disclosure go={go} />;
      case 'pronouns': return <S05_Pronouns go={go} onGender={setUserGender} onName={setUserName} />;
      case 'comm': return <S06_Comm go={go} onCommStyle={setCommStyle} />;
      case 'handoff': return <S_Handoff go={go} />;
      case 'archetype': return <S04_Archetype go={go} onPick={setArchetypePick} backTo={addMode === 'add' ? 'home' : 'handoff'} />;
      case 'voice': return <S07_Voice go={go} onPickVoice={setVoicePick} apiVoices={backendVoices} />;
      case 'name': return <S08_Name go={go} archetype={archetypePick} onPickName={handlePickName} />;
      case 'meet': return <S_Meet
        go={(s) => {
          // In "add" mode the Meet → CTA should drop the user back on home so
          // the list refreshes with their new companion. Otherwise preserve
          // the first-run flow into first-chat.
          if (addMode === 'add' && s === 'first-chat') { setAddMode('onboarding'); go('home'); return; }
          go(s);
        }}
        companion={{ name: companionName, archetype: archetypePick }}
        accent={ARCHETYPE_COLORS[archetypePick] || W.primary}
      />;
      case 'notif': return <S25_NotifPermission go={go} companion={{ id: 'new', name: companionName, archetype: archetypePick }}
        onAllow={() => { requestPushPermission().then(uploadPushToken).catch(() => {}); }} />;
      case 'first-chat': return <S09_FirstChat isMinor={isMinor} go={(s) => go(s)} companion={{ id: characterId ?? 'new', name: companionName, archetype: archetypePick }} userId={userId ?? undefined} characterId={characterId ?? undefined} textRemainingToday={entitlement ? entitlement.text.remaining_today : null}
        textDailyCap={entitlement ? entitlement.text.daily_cap : null}
        textResetsAt={entitlement ? entitlement.text.resets_at : null}
        textUpsell={entitlement ? entitlement.tier === 'free' : true}
        onQuotaRefused={refreshEntitlement} onCapUpgrade={() => setPaywallTrigger('cap')} />;
      case 'home': return renderHome(true);
      case 'callDepleted': return (
        <S27_StartCallDepleted
          companion={currentCompanion}
          onClose={() => setScreen('home')}
          // Back-target forced to home: `go()` would capture 'callDepleted',
          // and returning there from the sheet would dead-end the user.
          onTopUp={() => { setTopupBack('home'); setScreen('topup'); refreshEntitlement(); }}
          onUpgrade={() => { setPaywallBack('home'); setPaywallTrigger('voice'); setScreen('paywall'); refreshEntitlement(); }}
          onText={() => setScreen('chat')}
          resetDate={entitlement ? formatResetDate(entitlement.period.renews_at) : undefined}
        />
      );
      case 'call': return (
        <S12_VoiceCall
          go={(s) => go(s)}
          companion={currentCompanion}
          accent={t.orbHue}
          orbIntensity={1}
          voiceSecondsRemaining={entitlement ? entitlement.voice.remaining_seconds : null}
          userId={activeCharacterId ? userId ?? undefined : undefined}
          characterId={activeCharacterId ?? undefined}
          // Home, not 'call': returning to the call screen would redial into
          // the same refusal.
          onOutOfMinutes={() => { setTopupBack('home'); setScreen('topup'); refreshEntitlement(); }}
          onCallEnded={refreshEntitlement}
        />
      );
      case 'chat': return (
        <S14_Chat
          go={(s) => go(s)}
          isMinor={isMinor}
          companion={currentCompanion}
          accent={t.orbHue}
          textRemainingToday={entitlement ? entitlement.text.remaining_today : null}
          textDailyCap={entitlement ? entitlement.text.daily_cap : null}
          textResetsAt={entitlement ? entitlement.text.resets_at : null}
          textUpsell={entitlement ? entitlement.tier === 'free' : true}
          onQuotaRefused={refreshEntitlement}
          onCapUpgrade={() => setPaywallTrigger('cap')}
          userName={displayName}
          openMemorySheet={() => {}}
          userId={activeCharacterId ? userId ?? undefined : undefined}
          characterId={activeCharacterId ?? undefined}
        />
      );
      case 'crisis': return <S28_CrisisChat go={go} companion={currentCompanion} />;
      case 'profile': return <S26_CompanionEdit
        go={(s) => go(s)}
        companion={currentCompanion}
        onSave={activeCharacterId ? (p) => { updateCharacter(activeCharacterId, p).then(refreshUserCharacters).catch(e => console.warn('[Companion] save failed:', e)); } : undefined}
        onRefresh={refreshUserCharacters}
        onDelete={activeCharacterId ? () => handleDeleteCompanion(activeCharacterId) : () => {}}
        backTo={profileBack}
      />;
      case 'user-profile': return <S_UserProfile
        go={(sc) => { if (sc === 'login') signOut(); else go(sc); }}
        userName={displayName}
        userEmail={displayEmail}
        onSave={(p) => { if (p.display_name) setUserName(p.display_name); updateMe(p).catch(e => console.warn('[Profile] save failed:', e)); }}
        onDeleteAccount={deleteAccount}
        backTo={profileBack}
      />;
      case 'recap': return (
        <View style={{ flex: 1 }}>
          {renderHome(false)}
          <S29_Recap go={go} companion={currentCompanion} characterId={activeCharacterId ?? undefined} />
        </View>
      );
      case 'studio': return <S15_StudioHome go={go} characters={studioCharacters}
        setupScenario={(s) => { setScenario(s); setStudioCharacter(null); setStudioCharacterId(null); setStudioRemember(true); setScreen('scenario-setup'); }}
        resumeConvo={(c) => { setScenario(studioScenarioFor(c)); setStudioCharacter(c); setStudioCharacterId(c._id); setStudioRemember(true); setScreen('studio-session'); }}
        openCreator={() => setScreen('character-creator')} />;
      case 'scenario-setup': return <S16_ScenarioSetup go={go} scenario={scenario || SCENARIOS[0]}
        def={backendScenarios.find(s => s.id === (scenario || SCENARIOS[0]).id)}
        apiVoices={backendVoices}
        onStart={(id, remember) => { setStudioCharacter(null); setStudioCharacterId(id); setStudioRemember(remember); setScreen('studio-session'); }} />;
      case 'studio-session': return <S17_StudioSession isMinor={isMinor} go={go} scenario={scenario || SCENARIOS[0]}
        characterId={studioCharacterId ?? undefined} totalSessions={studioCharacter?.total_sessions ?? 0}
        remember={studioRemember} textRemainingToday={entitlement ? entitlement.text.remaining_today : null}
        textDailyCap={entitlement ? entitlement.text.daily_cap : null}
        textResetsAt={entitlement ? entitlement.text.resets_at : null}
        textUpsell={entitlement ? entitlement.tier === 'free' : true}
        onQuotaRefused={refreshEntitlement} onCapUpgrade={() => setPaywallTrigger('cap')} />;
      case 'character-creator': return <S18_CharacterCreator go={go} apiVoices={backendVoices} />;
      case 'sandbox': return <S19_SandboxHome go={go} comingSoon={t.sandboxComingSoon} isMinor={isMinor} openMode={(m) => { setSandboxMode(m); setScreen('sandbox-session'); }} />;
      case 'sandbox-session': return <S20_SandboxSession go={go} mode={sandboxMode || SANDBOX_MODES[0]} />;
      // Settings' only route to 'login' is its Sign out row — intercept it so it
      // actually ends the session instead of just showing the login screen.
      case 'settings': return <S21_Settings go={(sc) => { if (sc === 'login') signOut(); else go(sc); }} entitlement={entitlement} entitlementFailed={entitlementFailed} onRetryEntitlement={refreshEntitlement} companions={companions} userName={displayName} userEmail={displayEmail} settings={settings} setSettings={saveSettings} openCompanionProfile={openCompanionProfile} userId={userId ?? undefined} onDeleteAccount={deleteAccount} />;
      case 'memories': return <S22_Memories go={go} characterId={activeCharacterId ?? undefined} companionName={currentCompanion.name} />;
      case 'paywall': return <S23_Paywall go={go} trigger={paywallTrigger} backTo={paywallBack} entitlement={entitlement} />;
      case 'topup': return <S24_TopUp go={go} backTo={topupBack} entitlement={entitlement} />;
      case 'login': return <S30_Login
        isNew={isNewUser}
        onGoogle={() => handleOAuth('google')}
        onApple={() => handleOAuth('apple')}
        onEmailRequest={handleEmailRequest}
        onEmailVerify={handleEmailVerify}
        devCode={devCode}
        busy={authBusy}
        error={authError}
      />;
      default: return renderHome(true);
    }
  };

  const showNav = ['home', 'studio', 'sandbox', 'settings', 'memories', 'recap'].includes(screen);
  const isModal = screen === 'paywall' || screen === 'topup' || screen === 'callDepleted';

  // Render the appropriate underlay for modal sheets so backdrops match the screen they were launched from.
  const renderUnderlay = () => {
    const origin = screen === 'paywall' ? paywallBack : screen === 'topup' ? topupBack : 'home';
    if (origin === 'settings') {
      return <S21_Settings go={() => {}} entitlement={entitlement} entitlementFailed={entitlementFailed} companions={companions} userName={displayName} userEmail={displayEmail} settings={settings} setSettings={saveSettings} openCompanionProfile={() => {}} userId={userId ?? undefined} />;
    }
    return renderHome(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: W.bg }}>
      {isModal ? (
        <>
          {renderUnderlay()}
          {renderScreen()}
        </>
      ) : (
        <ScreenTransition routeKey={screen}>
          <View style={{ flex: 1 }}>{renderScreen()}</View>
        </ScreenTransition>
      )}
      {showNav ? <BottomNav active={activeTab} onChange={onTabChange} sandboxComingSoon={t.sandboxComingSoon} /> : null}
    </View>
  );
}

// ─── ScreenTransition ───────────────────────────────────────────────────
// Fades + lifts a screen on mount. Keyed on the route name so any navigation
// re-runs the entrance for a buttery feel. Uses native driver for 60fps.
function ScreenTransition({ routeKey, children }: { routeKey: string; children: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, {
      toValue: 1,
      duration: 320,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [routeKey]);
  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [0.992, 1] });
  return (
    <Animated.View style={{ flex: 1, opacity: v, transform: [{ translateY }, { scale }] }}>
      {children}
    </Animated.View>
  );
}
