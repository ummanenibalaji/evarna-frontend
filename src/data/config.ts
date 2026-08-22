// config.ts — ported from app.jsx TWEAK_DEFAULTS + the data arrays the app uses.
// The HTML prototype exposed these through a floating "Tweaks" dev panel. Here
// they live as plain config so the same states remain adjustable in code.

import { W } from '../theme/theme';

export type Tier = 'free' | 'plus' | 'premium';
export type MinutesRemaining = 'normal' | 'low' | 'zero';

export interface AppConfig {
  callState: string;
  sandboxComingSoon: boolean;
  orbHue: string;
  showFirstChat: boolean;
  capHit: boolean;
  minutesRemaining: MinutesRemaining;
}

export const CONFIG: AppConfig = {
  callState: 'auto',
  sandboxComingSoon: false,
  orbHue: W.primary,   // Ember Dusk: the orb and chat accent are coral, not violet
  showFirstChat: true,
  capHit: false,
  minutesRemaining: 'normal',
};

// There is no billing yet: no IAP, no entitlement on the user record, nobody
// has paid for anything. `tier` used to be hardcoded to 'plus', which put a
// PLUS badge on every account and a plan nobody was sold; flipping it to 'free'
// instead would lock Studio behind a paywall that cannot be paid.
//
// So the flag is explicit. Sanjeev's IAP lane replaces both of these with the
// real entitlement from the backend, and every `BILLING_LIVE &&` guard below
// becomes live at once.
export const BILLING_LIVE = false;
export const CURRENT_TIER: Tier = 'free';

// The nightly check-in card's copy. Prompts and mood words, not data about
// anyone — the streak and the week strip that used to live here alongside them
// were invented numbers shown to every user, and now come from
// GET /users/me/activity.
export const CHECK_IN = {
  prompt: 'How are you arriving tonight?',
  duration: '30 sec',
  moods: ['Calm', 'Heavy', 'Buzzing', 'Tired'],
};

// Suggestion chips shown above the chat composer. Static for now — the
// backend does not yet return per-turn suggestions.
export const QUICK_REPLIES: string[] = [
  'Run a mock round',
  'I just need to vent',
  'Switch topic',
];

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

// Scenarios (studio.jsx)
export interface Scenario { id: string; icon: string; name: string; desc: string; accent: string; }
export const SCENARIOS: Scenario[] = [
  { id: 'interview', icon: 'briefcase', name: 'Interview Coach', desc: 'Practice landing the role', accent: '#60A5FA' },
  { id: 'difficult', icon: 'two', name: 'Difficult Conversation', desc: 'Rehearse the hard ones', accent: '#FBBF24' },
  { id: 'debate', icon: 'flash', name: 'Debate Partner', desc: 'Sharpen your argument', accent: '#34D399' },
  { id: 'story', icon: 'book', name: 'Story Collaborator', desc: 'Build a world together', accent: '#A78BFA' },
  { id: 'language', icon: 'globe', name: 'Language Partner', desc: "Speak it, don't study it", accent: '#5EEAD4' },
];

// Sandbox modes (sandbox.jsx)
export interface SandboxMode { id: string; icon: string; name: string; sub: string | null; accent: string; desc: string; }
export const SANDBOX_MODES: SandboxMode[] = [
  { id: 'incognito', icon: 'eye-off', name: 'Incognito', sub: null, accent: '#8B8FA3', desc: 'Talk freely. Nothing saved. Your companion forgets everything after the session.' },
  { id: 'roast', icon: 'fire', name: 'Roast Mode', sub: 'Your companion, but spicier', accent: '#FBBF24', desc: "They'll still know you — they'll just stop being nice about it." },
  { id: 'safe', icon: 'heart', name: 'Safe Space', sub: 'LGBTQ+ affirming', accent: '#FB7185', desc: 'A judgment-free space to explore identity, practice coming out, or just talk.' },
  { id: 'intimate', icon: 'lock', name: 'Intimate', sub: '18+ only', accent: '#FB7185', desc: 'Romantic and intimate conversations. Your main companion modes stay separate.' },
];

// Memory type badges.
export const MEM_TYPES: Record<string, { l: string; color: string }> = {
  fact: { l: 'Fact', color: W.primary },
  emotion: { l: 'Emotion', color: W.accent },
  event: { l: 'Event', color: W.secondary },
  preference: { l: 'Preference', color: W.challenger },
};

export interface Memory { id: string; type: string; text: string; via: string; date: string; }
