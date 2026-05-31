// App.tsx (navigation) — main orchestrator replicating app.jsx's string-based
// router. Keeps the exact go(screen) + tab behavior of the prototype.

import React, { useEffect, useRef, useState } from 'react';
import { View, Animated, Easing, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { W } from '../theme/theme';
import { ScreenName } from './types';
import {
  CONFIG, PLUS_COMPANIONS, FREE_COMPANIONS, STUDIO_ACTIVE_CONVOS,
  SCENARIOS, SANDBOX_MODES, ARCHETYPE_COLORS, Companion, Scenario, SandboxMode,
} from '../data/config';
import { onboardUser, getVoices, ApiVoice, getUserCharacters, ApiCharacter, createCharacter } from '../api';

const SESSION_KEY = 'whisper_session';
import { BottomNav, TabId } from '../components/BottomNav';

import {
  S01_Splash, S02_Age, S03_Disclosure, S05_Pronouns, S06_Comm, S_Handoff,
  S04_Archetype, S07_Voice, S08_Name, S_Meet,
} from '../screens/Onboarding';
import { S10_Home, S11_AddCompanion } from '../screens/Home';
import { S09_FirstChat, S12_VoiceCall, S14_Chat } from '../screens/Chat';
import {
  S15_StudioHome, S16_ScenarioSetup, S17_StudioSession, S18_CharacterCreator,
  Character,
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

// Convert ApiCharacter from /characters/user/:id into the home-screen Companion shape.
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

const INTENT_MAP: Record<string, string> = {
  mentor: 'personal development', friend: 'emotional support',
  partner: 'connection', challenger: 'accountability',
};

export default function App() {
  // Routing
  const [screen, setScreen] = useState<ScreenName>(t.showFirstChat ? 'splash' : 'home');
  const [activeTab, setActiveTab] = useState<TabId>('home');
  const [activeCompanion, setActiveCompanion] = useState<Companion | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [sandboxMode, setSandboxMode] = useState<SandboxMode | null>(null);
  const [paywallTrigger] = useState('voice');
  const [isNewUser, setIsNewUser] = useState(false);
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

  // Backend IDs — set after successful onboarding API call
  const [userId, setUserId] = useState<string | null>(null);
  const [characterId, setCharacterId] = useState<string | null>(null);

  // The companion created during onboarding — replaces static placeholder on home screen
  const [userCompanion, setUserCompanion] = useState<Companion | null>(null);

  // All of the user's companions, fetched from /characters/user/:user_id.
  // Sorted newest-interaction-first; drives the multi-companion list view on home.
  const [userCharacters, setUserCharacters] = useState<Companion[] | null>(null);

  // Refetch the user's companions from the backend. Safe to call after onboarding,
  // after creating a new companion, or whenever returning to home.
  const refreshUserCharacters = (uid: string) =>
    getUserCharacters(uid)
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

  // Restore persisted session on launch so the companion survives app restarts
  useEffect(() => {
    AsyncStorage.getItem(SESSION_KEY)
      .then(raw => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { userId: string; characterId: string; companion: Companion };
        if (saved.userId) setUserId(saved.userId);
        if (saved.characterId) setCharacterId(saved.characterId);
        if (saved.companion) {
          setUserCompanion(saved.companion);
          setCompanionName(saved.companion.name);
          setArchetypePick(saved.companion.archetype);
        }
        restoredRef.current = true;
        if (saved.userId) refreshUserCharacters(saved.userId);
      })
      .catch(() => {});
  }, []);

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
    AsyncStorage.setItem(SESSION_KEY, JSON.stringify({ userId, characterId, companion })).catch(() => {});
    // After a fresh onboarding or new-character creation, sync the home list
    // so the new companion appears alongside the existing ones.
    refreshUserCharacters(userId);
  }, [userId, characterId]);

  // Voice catalog from backend (fetched once on mount)
  const [backendVoices, setBackendVoices] = useState<ApiVoice[]>([]);

  useEffect(() => {
    getVoices()
      .then(setBackendVoices)
      .catch(() => { /* backend offline — S07_Voice falls back to config voices */ });
  }, []);

  // characters (Studio)
  const [characters, setCharacters] = useState<Character[]>([]);

  // settings
  const [settings, setSettings] = useState({
    dailyCheckin: true, weeklyReflection: true, autoPlay: true, liveCaptions: true,
  });

  // Prefer the live backend list when present; fall back to the locally onboarded
  // companion (so the screen still renders if the API is unreachable), and finally
  // a static placeholder so a brand-new app launch isn't blank.
  const companions: Companion[] =
    (userCharacters && userCharacters.length > 0)
      ? userCharacters
      : userCompanion
        ? [userCompanion]
        : (t.tier === 'free' ? FREE_COMPANIONS : PLUS_COMPANIONS.slice(0, 1));
  const isMinor = false;
  const currentCompanion: Companion = activeCompanion || companions[0];

  // Real backend characters from /characters/user/:id have UUIDs as ids. The
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

  // Called from S08_Name. In "onboarding" mode this hits POST /users/onboard
  // (creates both user + first companion). In "add" mode we already have a
  // user_id, so we hit POST /characters/create to add another companion.
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
          user_id: userId,
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
        refreshUserCharacters(userId);
      } catch (e) {
        console.warn('[AddCompanion] API failed:', e);
        Alert.alert(
          'Connection problem',
          "Couldn't reach the server to add your companion. Make sure the backend is reachable and try again.",
        );
      }
      return;
    }

    try {
      const res = await onboardUser({
        display_name: t.userName,
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
      const newCompanion: Companion = {
        id: res.character_id,
        name,
        archetype: archetypePick,
        lastTalked: 'Just now',
      };
      setUserCompanion(newCompanion);
    } catch (e) {
      console.warn('[Onboarding] API failed:', e);
      Alert.alert(
        'Connection problem',
        "Couldn't reach the server to create your companion, so replies won't be real yet. Make sure the backend is reachable and try onboarding again.",
      );
    }
  };

  // Home rendered plainly (used both as a screen and as the backdrop for sheets)
  const renderHome = (interactive: boolean) => (
    <S10_Home
      go={interactive ? go : () => {}}
      tier={t.tier}
      companions={companions}
      userName={t.userName}
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
      case 'pronouns': return <S05_Pronouns go={go} onGender={setUserGender} />;
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
      case 'first-chat': return <S14_Chat go={(s) => go(s)} companion={{ id: 'new', name: companionName, archetype: archetypePick }} accent={t.orbHue} userName={t.userName} firstRun openMemorySheet={() => {}} userId={userId ?? undefined} characterId={characterId ?? undefined} />;
      case 'home': return renderHome(true);
      case 'callDepleted': return <S27_StartCallDepleted companion={currentCompanion} onClose={() => setScreen('home')} onTopUp={() => setScreen('topup')} onUpgrade={() => setScreen('paywall')} onText={() => setScreen('chat')} />;
      case 'add-companion': return <S11_AddCompanion go={go} tier={t.tier} onCreate={(c) => { PLUS_COMPANIONS.push({ id: String(Date.now()), ...c, memory: '', lastTalked: 'New' } as Companion); }} />;
      case 'call': return <S12_VoiceCall go={(s) => go(s)} companion={currentCompanion} accent={t.orbHue} orbIntensity={1} minutesRemaining={t.minutesRemaining} userId={activeCharacterId ? userId ?? undefined : undefined} characterId={activeCharacterId ?? undefined} />;
      case 'chat': return <S14_Chat go={(s) => go(s)} companion={currentCompanion} accent={t.orbHue} capHit={t.capHit} userName={t.userName} openMemorySheet={() => {}} userId={activeCharacterId ? userId ?? undefined : undefined} characterId={activeCharacterId ?? undefined} />;
      case 'crisis': return <S28_CrisisChat go={go} companion={currentCompanion} />;
      case 'profile': return <S26_CompanionEdit go={(s) => go(s)} companion={currentCompanion} onDelete={() => {}} backTo={profileBack} />;
      case 'user-profile': return <S_UserProfile go={(s) => go(s)} userName={t.userName} userEmail={`${t.userName.toLowerCase()}@whisper.app`} backTo={profileBack} />;
      case 'recap': return (
        <View style={{ flex: 1 }}>
          {renderHome(false)}
          <S29_Recap go={go} companion={currentCompanion} />
        </View>
      );
      case 'studio': return <S15_StudioHome go={go} tier={t.tier} characters={characters} activeConvos={STUDIO_ACTIVE_CONVOS}
        setupScenario={(s) => { setScenario(s); setScreen('scenario-setup'); }}
        resumeConvo={(c) => {
          const sc = SCENARIOS.find(x => x.id === (c as any).scenarioId) || ({ id: 'custom', icon: c.icon, name: c.name, desc: '', accent: c.accent } as Scenario);
          setScenario(sc); setScreen('studio-session');
        }}
        openCreator={() => setScreen('character-creator')} />;
      case 'scenario-setup': return <S16_ScenarioSetup go={go} scenario={scenario || SCENARIOS[0]} onStart={() => setScreen('studio-session')} />;
      case 'studio-session': return <S17_StudioSession go={go} scenario={scenario || SCENARIOS[0]} />;
      case 'character-creator': return <S18_CharacterCreator go={go} onSave={(c) => setCharacters(cs => [...cs, c])} />;
      case 'sandbox': return <S19_SandboxHome go={go} comingSoon={t.sandboxComingSoon} isMinor={isMinor} openMode={(m) => { setSandboxMode(m); setScreen('sandbox-session'); }} />;
      case 'sandbox-session': return <S20_SandboxSession go={go} mode={sandboxMode || SANDBOX_MODES[0]} />;
      case 'settings': return <S21_Settings go={go} tier={t.tier} companions={companions} userName={t.userName} userEmail={`${t.userName.toLowerCase()}@whisper.app`} settings={settings} setSettings={setSettings} openCompanionProfile={openCompanionProfile} />;
      case 'memories': return <S22_Memories go={go} characterId={activeCharacterId ?? undefined} companionName={currentCompanion.name} />;
      case 'paywall': return <S23_Paywall go={go} trigger={paywallTrigger} currentTier={t.tier} backTo={paywallBack} />;
      case 'topup': return <S24_TopUp go={go} backTo={topupBack} />;
      case 'login': return <S30_Login go={go} isNew={isNewUser} />;
      default: return renderHome(true);
    }
  };

  const showNav = ['home', 'studio', 'sandbox', 'settings', 'memories', 'recap'].includes(screen);
  const isModal = screen === 'paywall' || screen === 'topup' || screen === 'callDepleted';

  // Render the appropriate underlay for modal sheets so backdrops match the screen they were launched from.
  const renderUnderlay = () => {
    const origin = screen === 'paywall' ? paywallBack : screen === 'topup' ? topupBack : 'home';
    if (origin === 'settings') {
      return <S21_Settings go={() => {}} tier={t.tier} companions={companions} userName={t.userName} userEmail={`${t.userName.toLowerCase()}@whisper.app`} settings={settings} setSettings={setSettings} openCompanionProfile={() => {}} />;
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
