// types.ts — route names and the navigation function every screen receives.

export type ScreenName =
  | 'splash' | 'age' | 'disclosure' | 'pronouns' | 'comm' | 'handoff'
  | 'archetype' | 'voice' | 'name' | 'meet' | 'notif' | 'first-chat'
  | 'home' | 'callDepleted' | 'call' | 'chat' | 'crisis'
  | 'profile' | 'user-profile' | 'recap' | 'studio' | 'scenario-setup' | 'studio-session'
  | 'character-creator' | 'sandbox' | 'sandbox-session' | 'settings'
  | 'memories' | 'paywall' | 'login';

/** Why the paywall opened. Chooses its headline (PAYWALL_HEADERS in Settings). */
export type PaywallTrigger = 'voice' | 'cap' | 'more' | 'studio';

/**
 * Navigation as screens see it. The router reads intent from history: naming
 * a screen you came from goes back to it, naming a tab switches to it, and
 * 'paywall', 'callDepleted' and 'recap' open as sheets over the current
 * screen instead of replacing it.
 */
export type Go = (screen: ScreenName) => void;

export type Archetype = 'mentor' | 'friend' | 'partner' | 'challenger';
