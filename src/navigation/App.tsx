// App.tsx (navigation) — main orchestrator replicating app.jsx's string-based
// router. Keeps the exact go(screen) + tab behavior of the prototype.

import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { W } from '../theme/theme';
import { ScreenName } from './types';
import {
  CONFIG, PLUS_COMPANIONS, FREE_COMPANIONS,
  SCENARIOS, SANDBOX_MODES, ARCHETYPE_COLORS, Companion, Scenario, SandboxMode,
} from '../data/config';
import {
  onboardUser, getVoices, ApiVoice, getUserCharacters, ApiCharacter, createCharacter,
  signInWithGoogle, signInWithApple, requestEmailCode, verifyEmailCode, getMe, logout, AuthSession,
  updateCharacter, deleteCharacter, updateMe, deleteMe,
  getScenarios, getStudioCharacters, ApiScenario, ApiStudioCharacter,
} from '../api';
import { loadAuthToken, setAuthToken, ApiError } from '../api/client';
import { getGoogleIdToken, googleSignOut, GoogleSignInUnavailable } from '../lib/googleSignIn';

const SESSION_KEY = 'whisper_session';
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
  const [paywallTrigger] = useState('voice');
  const [isNewUser, setIsNewUser] = useState(false);
  // Login screen state
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');
  // The signed-in user's email, from GET /auth/me — shown in Settings.
  const [userEmail, setUserEmail] = useState('');
  // Track where modal/edit screens were opened from so the back button returns correctly.
  const [profileBack, setProfileBack] = useState<ScreenName>('chat');
  const [paywallBack, setPaywallBack] = useState<ScreenName>('home');
  const [topupBack, setTopupBack] = useState<ScreenName>('home');

  // Onboarding-collected
  const [voicePick, setVoicePick] = useState<string | null>(null);
  const [archetypePick, setArchetypePick] = useState<Companion['archetype']>('mentor');
  const [companionName, setCompanionName] = useState(t.companionName || 'Sage');

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
        setUserCharacters(sorted.map(apiCharacterToCompanion));
      })
      .catch(() => { /* backend offline — fall back to userCompanion */ });

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
        if (me.onboarding_completed) {
          refreshUserCharacters();
          setScreen('home');
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

  // ── Auth handlers ────────────────────────────────────────────────────────

  const applySession = (s: AuthSession) => {
    setAuthToken(s.token);
    setUserId(s.user_id);
    if (s.onboarding_completed) {
      refreshUserCharacters();
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
      await requestEmailCode(email);
      setPendingEmail(email);
      return true;
    } catch (e) {
      console.warn('[Auth] email request failed:', e);
      setAuthError("Couldn't send a code to that address. Check it and try again.");
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
  const [settings, setSettings] = useState({
    dailyCheckin: true, weeklyReflection: true, autoPlay: true, liveCaptions: true,
  });

  // What the UI shows for the user's name. `userName` is the real, onboarded
  // value; the CONFIG constant is only a last resort for the pre-onboarding
  // prototype screens so nothing renders blank.
  const displayName = userName.trim() || t.userName;
  // Comes from GET /auth/me on boot; empty until then (better than a fabricated address).
  const displayEmail = userEmail;

  // Prefer the live backend list when present; fall back to the locally onboarded
  // companion (so the screen still renders if the API is unreachable), and finally
  // a static placeholder so a brand-new app launch isn't blank.
  const companions: Companion[] =
    (userCharacters && userCharacters.length > 0)
      ? userCharacters
      : userCompanion
        ? [userCompanion]
        : (t.tier === 'free' ? FREE_COMPANIONS : PLUS_COMPANIONS.slice(0, 1));
  const currentCompanion: Companion = activeCompanion || companions[0];

  // Real backend characters from GET /characters have UUIDs as ids. The
  // static placeholder companions use string slugs ("sage", "atlas", ...). Treat
  // anything from `userCharacters` as a real backend character so each list-row
  // tap routes through the real chat session.
  const isBackendCompanion = !!userCharacters?.some(c => c.id === currentCompanion.id)
    || currentCompanion.id === characterId;
  const activeCharacterId = isBackendCompanion ? String(currentCompanion.id) : null;

  // Navigation helper — mirrors prototype go() and remembers origin for modal-like screens.
  const go = (s: ScreenName) => {
    // Capture the back-target BEFORE we change screen, so profile/paywall/topup return correctly.
    if (s === 'profile' || s === 'user-profile') setProfileBack(screen);
    if (s === 'paywall') setPaywallBack(screen);
    if (s === 'topup') setTopupBack(screen);
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
        Alert.alert(
          'Connection problem',
          "Couldn't reach the server to add your companion. Make sure the backend is reachable and try again.",
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
          "Whisper isn't available to under-15s, so we can't finish setting up your account. If your birth date is wrong, go back and correct it.",
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
      tier={t.tier}
      companions={companions}
      userName={displayName}
      maxCompanions={MAX_COMPANIONS}
      onSelectCompanion={interactive ? (c) => { setActiveCompanion(c); setScreen('chat'); } : () => {}}
      onCallCompanion={interactive ? (c) => {
        setActiveCompanion(c);
        if (t.minutesRemaining === 'zero') setScreen('callDepleted');
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

  const renderScreen = () => {
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
      case 'notif': return <S25_NotifPermission go={go} companion={{ id: 'new', name: companionName, archetype: archetypePick }} />;
      case 'first-chat': return <S09_FirstChat go={(s) => go(s)} companion={{ id: characterId ?? 'new', name: companionName, archetype: archetypePick }} userId={userId ?? undefined} characterId={characterId ?? undefined} />;
      case 'home': return renderHome(true);
      case 'callDepleted': return <S27_StartCallDepleted companion={currentCompanion} onClose={() => setScreen('home')} onTopUp={() => setScreen('topup')} onUpgrade={() => setScreen('paywall')} onText={() => setScreen('chat')} />;
      case 'call': return <S12_VoiceCall go={(s) => go(s)} companion={currentCompanion} accent={t.orbHue} orbIntensity={1} minutesRemaining={t.minutesRemaining} userId={activeCharacterId ? userId ?? undefined : undefined} characterId={activeCharacterId ?? undefined} />;
      case 'chat': return <S14_Chat go={(s) => go(s)} companion={currentCompanion} accent={t.orbHue} capHit={t.capHit} userName={displayName} openMemorySheet={() => {}} userId={activeCharacterId ? userId ?? undefined : undefined} characterId={activeCharacterId ?? undefined} />;
      case 'crisis': return <S28_CrisisChat go={go} companion={currentCompanion} />;
      case 'profile': return <S26_CompanionEdit
        go={(s) => go(s)}
        companion={currentCompanion}
        onSave={activeCharacterId ? (p) => { updateCharacter(activeCharacterId, p).then(refreshUserCharacters).catch(e => console.warn('[Companion] save failed:', e)); } : undefined}
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
          <S29_Recap go={go} companion={currentCompanion} />
        </View>
      );
      case 'studio': return <S15_StudioHome go={go} tier={t.tier} characters={studioCharacters}
        setupScenario={(s) => { setScenario(s); setStudioCharacter(null); setStudioCharacterId(null); setStudioRemember(true); setScreen('scenario-setup'); }}
        resumeConvo={(c) => { setScenario(studioScenarioFor(c)); setStudioCharacter(c); setStudioCharacterId(c._id); setStudioRemember(true); setScreen('studio-session'); }}
        openCreator={() => setScreen('character-creator')} />;
      case 'scenario-setup': return <S16_ScenarioSetup go={go} scenario={scenario || SCENARIOS[0]}
        def={backendScenarios.find(s => s.id === (scenario || SCENARIOS[0]).id)}
        apiVoices={backendVoices}
        onStart={(id, remember) => { setStudioCharacter(null); setStudioCharacterId(id); setStudioRemember(remember); setScreen('studio-session'); }} />;
      case 'studio-session': return <S17_StudioSession go={go} scenario={scenario || SCENARIOS[0]}
        characterId={studioCharacterId ?? undefined} totalSessions={studioCharacter?.total_sessions ?? 0}
        remember={studioRemember} />;
      case 'character-creator': return <S18_CharacterCreator go={go} apiVoices={backendVoices} />;
      case 'sandbox': return <S19_SandboxHome go={go} comingSoon={t.sandboxComingSoon} isMinor={isMinor} openMode={(m) => { setSandboxMode(m); setScreen('sandbox-session'); }} />;
      case 'sandbox-session': return <S20_SandboxSession go={go} mode={sandboxMode || SANDBOX_MODES[0]} />;
      // Settings' only route to 'login' is its Sign out row — intercept it so it
      // actually ends the session instead of just showing the login screen.
      case 'settings': return <S21_Settings go={(sc) => { if (sc === 'login') signOut(); else go(sc); }} tier={t.tier} companions={companions} userName={displayName} userEmail={displayEmail} settings={settings} setSettings={setSettings} openCompanionProfile={openCompanionProfile} userId={userId ?? undefined} onDeleteAccount={deleteAccount} />;
      case 'memories': return <S22_Memories go={go} characterId={activeCharacterId ?? undefined} companionName={currentCompanion.name} />;
      case 'paywall': return <S23_Paywall go={go} trigger={paywallTrigger} currentTier={t.tier} backTo={paywallBack} />;
      case 'topup': return <S24_TopUp go={go} backTo={topupBack} />;
      case 'login': return <S30_Login
        isNew={isNewUser}
        onGoogle={() => handleOAuth('google')}
        onApple={() => handleOAuth('apple')}
        onEmailRequest={handleEmailRequest}
        onEmailVerify={handleEmailVerify}
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
      return <S21_Settings go={() => {}} tier={t.tier} companions={companions} userName={displayName} userEmail={displayEmail} settings={settings} setSettings={setSettings} openCompanionProfile={() => {}} userId={userId ?? undefined} />;
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
