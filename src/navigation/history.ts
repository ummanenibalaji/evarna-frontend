// history.ts — the route stack as plain data.
//
// Pure functions only. App.tsx decides what a navigation request means (open a
// sheet, switch tab, go back…); these describe how the stack changes; and
// ScreenStack animates whatever difference it sees between two stacks.
//
// Shape: `routes[0]` is the base and is never popped. While signed in, the
// base is the tab layer (all four tab roots, see TabRoots in ScreenStack);
// before that it is a flow screen such as the splash, login or the first
// onboarding step. Everything above the base was pushed.

import type { TabId } from '../components/BottomNav';
import type { Companion } from '../data/config';
import type { ScreenName } from './types';

/** What a route needs to draw itself, so two chats — or a chat under its own
 *  profile — never share one global "active companion". */
export interface RouteParams {
  companionId?: string;
  /** The last known copy, shown until the live companion list has it. */
  companion?: Companion;
  /** Seeds the chat composer: a Home mood, or a reply that failed to send from the notification shade. */
  draft?: string;
  /** Where the notification ask continues to. */
  next?: ScreenName;
}

export interface Route {
  key: string;
  name: ScreenName;
  params?: RouteParams;
}

export interface NavState {
  /** The selected tab. Meaningful while the base is the tab layer. */
  tab: TabId;
  /** Bottom → top, never empty. */
  routes: Route[];
}

const TAB_ROOT: Record<TabId, ScreenName> = {
  home: 'home',
  studio: 'studio',
  sandbox: 'sandbox',
  settings: 'settings',
};

export function tabForRoot(name: ScreenName): TabId | null {
  switch (name) {
    case 'home':
    case 'studio':
    case 'sandbox':
    case 'settings':
      return name;
    default:
      return null;
  }
}

let seq = 0;
const nextKey = (prefix: string) => `${prefix}#${++seq}`;

export function route(name: ScreenName, params?: RouteParams): Route {
  return params ? { key: nextKey(name), name, params } : { key: nextKey(name), name };
}

// The tab layer's key changes on every sign-in, so the next account starts
// with freshly mounted tab roots rather than the previous one's scroll
// positions and state.
const TABS_PREFIX = 'tabs';

export function isTabsBase(r: Route): boolean {
  return r.key.startsWith(`${TABS_PREFIX}#`);
}

export const top = (s: NavState): Route => s.routes[s.routes.length - 1];

export const inTabs = (s: NavState): boolean => isTabsBase(s.routes[0]);

/** A fresh tab layer showing `tab`. */
export function resetToTabs(tab: TabId): NavState {
  return { tab, routes: [{ key: nextKey(TABS_PREFIX), name: TAB_ROOT[tab] }] };
}

/** A fresh flow (login, onboarding) made of `routes`, with no tab layer. */
export function resetToFlow(s: NavState, ...routes: Route[]): NavState {
  return { tab: s.tab, routes };
}

/** Selects a tab and drops anything pushed on top of the tab layer. */
export function switchTab(s: NavState, tab: TabId): NavState {
  const base = s.routes[0];
  return { tab, routes: [{ ...base, name: TAB_ROOT[tab] }] };
}

export function push(s: NavState, r: Route): NavState {
  return { ...s, routes: [...s.routes, r] };
}

/** Removes up to `count` routes from the top; the base always stays. */
export function pop(s: NavState, count = 1): NavState {
  const keep = Math.max(1, s.routes.length - count);
  return keep === s.routes.length ? s : { ...s, routes: s.routes.slice(0, keep) };
}

/** Pops until `index` is on top. */
export function popTo(s: NavState, index: number): NavState {
  return pop(s, s.routes.length - 1 - index);
}

export function replaceTop(s: NavState, r: Route): NavState {
  return s.routes.length === 1 ? { ...s, routes: [r] } : { ...s, routes: [...s.routes.slice(0, -1), r] };
}

/** Keeps routes up to and including `index`, then puts `r` on top. */
export function replaceAbove(s: NavState, index: number, r: Route): NavState {
  return { ...s, routes: [...s.routes.slice(0, index + 1), r] };
}

/** The nearest route below the top called `name`, or -1. The tab layer
 *  answers to the name of its selected root. */
export function indexBelowTop(s: NavState, name: ScreenName): number {
  for (let i = s.routes.length - 2; i >= 0; i--) {
    if (s.routes[i].name === name) return i;
  }
  return -1;
}

/**
 * Back buttons that name a fixed destination. These screens send Back to a
 * hard-coded route ('home', 'settings') rather than to wherever they were
 * opened from, so when one of them asks for that route while it is on top,
 * the request means "back" and pops. Crisis support opened from Settings then
 * returns to Settings, Memories opened from a companion's profile returns to
 * the profile, and ending a call started from a chat returns to that chat.
 */
export const BACK_ALIASES: Partial<Record<ScreenName, readonly ScreenName[]>> = {
  chat: ['home'],
  call: ['home'],
  crisis: ['home'],
  memories: ['settings'],
  'scenario-setup': ['studio'],
  'studio-session': ['studio'],
  'character-creator': ['studio'],
  'sandbox-session': ['sandbox'],
};
