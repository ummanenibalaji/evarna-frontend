// config.ts — ported from app.jsx TWEAK_DEFAULTS + the data arrays the app uses.
// The HTML prototype exposed these through a floating "Tweaks" dev panel. Here
// they live as plain config so the same states remain adjustable in code.
// Colours are theme tokens (hex), never literals: screens tint them with rgba().

import { W } from '../theme/theme';
import type { IconName } from '../components/NavIcon';

export type Tier = 'free' | 'plus' | 'premium';

export interface AppConfig {
  sandboxComingSoon: boolean;
  orbHue: string;
}

export const CONFIG: AppConfig = {
  // Sandbox has no backend session type yet: its modes used to answer with
  // canned lines on a timer. Until the backend can run them, the tab previews
  // the modes behind a "coming soon" card and no session can start.
  sandboxComingSoon: true,
  orbHue: W.primary,   // Ember Dusk: the orb and chat accent are coral, not violet
};

// BILLING_LIVE and CURRENT_TIER are gone. The tier, the balance and the prices
// now come from GET /billing/entitlement, held in App.tsx and threaded down —
// so there is nothing here for the app and the server to disagree about.
// `capHit` and `minutesRemaining` went with them: both were constants that made
// the message-cap card and the minute banner unreachable no matter what the
// account had actually used.

// The nightly check-in card's copy. Prompts and mood words, not data about
// anyone — the streak and the week strip that used to live here alongside them
// were invented numbers shown to every user, and now come from
// GET /users/me/activity. Its "30 sec" label went too: nothing timed it.
export const CHECK_IN = {
  prompt: 'How are you arriving tonight?',
  moods: ['Calm', 'Heavy', 'Buzzing', 'Tired'],
};

// Suggestion chips shown above the chat composer. Static for now — the
// backend does not yet return per-turn suggestions. Keyed by archetype, so a
// Partner is never offered "Run a mock round"; the array itself holds lines
// that suit any companion, for a caller that has no archetype to hand.
type ArchetypeReplies = Readonly<Record<Companion['archetype'], readonly string[]>>;

export const QUICK_REPLIES: readonly string[] & ArchetypeReplies = Object.assign(
  ['I just need to vent', 'Help me think something through', 'Switch topic'],
  {
    mentor: ['Run a mock round', 'Help me plan my week', 'What should I work on next?'],
    friend: ['I just need to vent', 'Guess what happened today', 'Cheer me up'],
    partner: ['I just want to talk', "Here's what's on my mind", 'I had a long day'],
    challenger: ['Hold me to my goal', 'Give me the hard truth', 'Check my progress'],
  },
);

export interface Companion {
  id: string | number;
  name: string;
  archetype: 'mentor' | 'friend' | 'partner' | 'challenger';
  memory?: string;
  lastTalked?: string;
  pending?: boolean;
  image?: string;
  gender?: string;
  voice?: string;
  // Backend-sourced fields used by the home conversation-list.
  lastInteractionAt?: string;       // ISO date — used for sort + timestamp
  lastMessagePreview?: string | null;
  memoryHighlight?: string | null;
  // 0-100, straight from the backend. Undefined until GET /characters answers,
  // which is why the edit screen renders nothing rather than substituting
  // defaults.
  personalitySliders?: Record<string, number>;
}

export const ARCHETYPE_COLORS: Record<string, string> = {
  mentor: W.mentor,
  friend: W.friend,
  partner: W.partner,
  challenger: W.challenger,
};

export const ARCHETYPE_LABEL: Record<string, string> = {
  mentor: 'Mentor', friend: 'Best Friend', partner: 'Partner', challenger: 'Challenger',
};

// Curated name suggestions by archetype (from onboarding.jsx)
export const NAME_SUGGESTIONS: Record<string, string[]> = {
  mentor: ['Sage', 'Marcus', 'Iris', 'Theo'],
  friend: ['Atlas', 'Juno', 'Wren', 'Cleo'],
  partner: ['Luna', 'River', 'Nova', 'Kai'],
  challenger: ['Ember', 'Knox', 'Rae', 'Vance'],
};

// Scenarios (studio.jsx). Accents are Ember Dusk tokens, so Studio reads as
// the same product as Home.
export interface Scenario { id: string; icon: string; name: string; desc: string; accent: string; }
export const SCENARIOS: Scenario[] = [
  { id: 'interview', icon: 'briefcase', name: 'Interview Coach', desc: 'Practice landing the role', accent: W.mentor },
  { id: 'difficult', icon: 'two', name: 'Difficult Conversation', desc: 'Rehearse the hard ones', accent: W.challenger },
  { id: 'debate', icon: 'flash', name: 'Debate Partner', desc: 'Sharpen your argument', accent: W.friend },
  { id: 'story', icon: 'book', name: 'Story Collaborator', desc: 'Build a world together', accent: W.violet },
  { id: 'language', icon: 'globe', name: 'Language Partner', desc: "Speak it, don't study it", accent: W.secondary },
];

// Sandbox modes (sandbox.jsx). Each mode has one accent, used for its card,
// its icon tile and the edge of its companion's bubbles alike.
export type SandboxModeId = 'incognito' | 'roast' | 'safe' | 'intimate';

export interface SandboxMode {
  id: SandboxModeId;
  icon: IconName;
  name: string;
  /** One line under the name, in the mode's accent. */
  tagline?: string;
  /** A short tag beside the name, such as an age rating. */
  badge?: string;
  /** Locked for minors. The session screen also treats an unknown age as a minor. */
  adultsOnly?: boolean;
  accent: string;
  desc: string;
}

export const SANDBOX_MODES: SandboxMode[] = [
  { id: 'incognito', icon: 'eye-off', name: 'Incognito', accent: W.text2, desc: 'Talk freely. Your companion forgets the whole session once it ends.' },
  { id: 'roast', icon: 'fire', name: 'Roast Mode', tagline: 'Your companion, but spicier', accent: W.challenger, desc: "They'll still know you — they'll just stop being nice about it." },
  { id: 'safe', icon: 'shield', name: 'Safe Space', tagline: 'LGBTQ+ affirming', accent: W.secondary, desc: 'A judgment-free space to explore identity, practice coming out, or just talk.' },
  { id: 'intimate', icon: 'heart', name: 'Intimate', badge: '18+', adultsOnly: true, accent: W.partner, desc: 'Romantic and intimate conversation, kept apart from your everyday chats.' },
];

// Memory type badges.
export const MEM_TYPES: Record<string, { l: string; color: string }> = {
  fact: { l: 'Fact', color: W.primary },
  emotion: { l: 'Emotion', color: W.accent },
  event: { l: 'Event', color: W.secondary },
  preference: { l: 'Preference', color: W.challenger },
};

export interface Memory { id: string; type: string; text: string; via: string; date: string; }
