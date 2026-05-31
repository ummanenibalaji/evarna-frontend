// config.ts — ported from app.jsx TWEAK_DEFAULTS + the data arrays the app uses.
// The HTML prototype exposed these through a floating "Tweaks" dev panel. Here
// they live as plain config so the same states remain adjustable in code.

import { W } from '../theme/theme';

export type Tier = 'free' | 'plus' | 'premium';
export type MinutesRemaining = 'normal' | 'low' | 'zero';

export interface AppConfig {
  tier: Tier;
  userName: string;
  companionName: string;
  callState: string;
  sandboxComingSoon: boolean;
  orbHue: string;
  showFirstChat: boolean;
  capHit: boolean;
  minutesRemaining: MinutesRemaining;
}

export const CONFIG: AppConfig = {
  tier: 'plus',
  userName: 'Aria',
  companionName: 'Sage',
  callState: 'auto',
  sandboxComingSoon: false,
  orbHue: '#8B82FF',
  showFirstChat: true,
  capHit: false,
  minutesRemaining: 'normal',
};

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
  // Backend-sourced fields used by the home conversation-list (S11). Optional so
  // existing static prototype companions still type-check.
  lastInteractionAt?: string;       // ISO date — used for sort + timestamp
  lastMessagePreview?: string | null;
  memoryHighlight?: string | null;
}

export const PLUS_COMPANIONS: Companion[] = [
  { id: 'sage', name: 'Sage', archetype: 'mentor', memory: 'your interview is tomorrow', lastTalked: 'Last talked: 2 hours ago' },
  { id: 'atlas', name: 'Atlas', archetype: 'friend', memory: "you've been running again", lastTalked: 'Last talked: yesterday', pending: true },
  { id: 'nova', name: 'Nova', archetype: 'challenger', memory: 'your 30-day writing streak', lastTalked: 'Last talked: 3 days ago' },
];

export const FREE_COMPANIONS: Companion[] = [PLUS_COMPANIONS[0]];

export interface ActiveConvo {
  id: string;
  kind: 'scenario' | 'character';
  scenarioId?: string;
  icon: string;
  name: string;
  accent: string;
  preview: string;
  timeAgo: string;
  memoryCount: number;
}

export const STUDIO_ACTIVE_CONVOS: ActiveConvo[] = [
  {
    id: 'c1', kind: 'scenario', scenarioId: 'interview', icon: 'briefcase', name: 'Interview Coach', accent: '#60A5FA',
    preview: 'You nailed the behavioral question about leadership — last time you struggled with it.',
    timeAgo: 'Yesterday', memoryCount: 12,
  },
  {
    id: 'c2', kind: 'character', icon: 'sparkle', name: 'Coach Maya', accent: '#A78BFA',
    preview: 'Pick it up where we left off — week 3 of your writing accountability check-in.',
    timeAgo: '3 days ago', memoryCount: 28,
  },
];

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

// Voices (onboarding.jsx)
export interface Voice { n: string; d: string; }
export const VOICES: Record<string, Voice[]> = {
  male: [{ n: 'Atlas', d: 'deep, steady' }, { n: 'River', d: 'warm, gentle' }, { n: 'Ember', d: 'energetic' }],
  female: [{ n: 'Luna', d: 'soft, soothing' }, { n: 'Nova', d: 'bright, warm' }, { n: 'Sage', d: 'calm, wise' }],
  neutral: [{ n: 'Onyx', d: 'balanced' }, { n: 'Haze', d: 'ethereal' }],
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

// Memory types + samples (settings.jsx)
export const MEM_TYPES: Record<string, { l: string; color: string }> = {
  fact: { l: 'Fact', color: W.primary },
  emotion: { l: 'Emotion', color: W.accent },
  event: { l: 'Event', color: W.secondary },
  preference: { l: 'Preference', color: W.challenger },
};

export interface Memory { id: number; type: string; text: string; via: string; date: string; }
export const SAMPLE_MEMORIES: Memory[] = [
  { id: 1, type: 'event', text: 'Has a sister named Priya who is getting married in October', via: 'Sage', date: 'May 15' },
  { id: 2, type: 'event', text: 'Has a software engineer interview at a tech startup tomorrow', via: 'Sage', date: 'May 14' },
  { id: 3, type: 'fact', text: 'Lives in Brooklyn, originally from Mumbai', via: 'Sage', date: 'May 12' },
  { id: 4, type: 'emotion', text: "Feels guilty when canceling plans, even when it's the right call", via: 'Atlas', date: 'May 10' },
  { id: 5, type: 'preference', text: 'Prefers being asked questions rather than given advice', via: 'Sage', date: 'May 8' },
  { id: 6, type: 'fact', text: 'Started running again after a 2-year break', via: 'Atlas', date: 'May 5' },
  { id: 7, type: 'emotion', text: "Misses their dad — he passed last year. Doesn't bring it up often.", via: 'Sage', date: 'May 3' },
];
