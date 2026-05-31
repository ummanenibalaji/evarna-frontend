// types.ts — routing types mirroring app.jsx's string-based `go(screen)` router.

import { Companion, Scenario, SandboxMode } from '../data/config';

export type ScreenName =
  | 'splash' | 'age' | 'disclosure' | 'pronouns' | 'comm' | 'handoff'
  | 'archetype' | 'voice' | 'name' | 'meet' | 'notif' | 'first-chat'
  | 'home' | 'callDepleted' | 'add-companion' | 'call' | 'chat' | 'crisis'
  | 'profile' | 'user-profile' | 'recap' | 'studio' | 'scenario-setup' | 'studio-session'
  | 'character-creator' | 'sandbox' | 'sandbox-session' | 'settings'
  | 'memories' | 'paywall' | 'topup' | 'login';

// Navigation function shape used by every screen (matches prototype `go`).
export type Go = (screen: ScreenName) => void;

export interface NavContextValue {
  go: Go;
  screen: ScreenName;
}

export type Archetype = 'mentor' | 'friend' | 'partner' | 'challenger';

export interface ScreenCommonProps {
  go: Go;
}

export type { Companion, Scenario, SandboxMode };
