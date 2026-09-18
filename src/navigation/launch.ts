// launch.ts — what this phone already knows, read as early as possible.
//
// Importing this module starts the reads. The root App.tsx imports it right
// after the polyfills, so they run while the rest of the JS loads and the
// fonts register, instead of after the router's first render. The saved
// companions, plan and Studio list are read in the same go, as soon as the
// saved session names the account, so Home can paint from them the moment
// the router asks.
//
// The router takes these reads once. Anything later (the root error screen's
// "Try again" remounts the router) reads storage afresh, because by then the
// early answer may be out of date.
//
// Also the splash hand-off: the native launch screen stays up until the first
// real screen has been drawn, then fades straight onto it (revealApp).

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';

import type { ApiEntitlement, ApiStudioCharacter } from '../api';
import { loadAuthToken } from '../api/client';
import type { Companion } from '../data/config';
import { readCache } from '../lib/cache';

// ── Storage keys ───────────────────────────────────────────────────────
export const SESSION_KEY = 'evarna_session';
// Set at the first sign-in and kept through sign-out, so the login screen can
// tell a first visit from a return. A reinstall clears it.
export const SIGNED_IN_KEY = 'evarna_signed_in_before';
// Per-user stale-while-revalidate entries (lib/cache.ts).
export const CACHE = {
  characters: 'characters',
  entitlement: 'entitlement',
  studio: 'studio-characters',
  studioMemory: 'studio-memory',
} as const;

/** What survives a relaunch so Home can paint before the network answers. */
export interface SessionBlob {
  userId: string;
  onboarded?: boolean;
  /** The first companion, from sessions saved before `onboarded` existed. */
  characterId?: string;
  companion?: Companion;
  isMinor?: boolean;
  userName?: string;
}

export function parseBlob(raw: string | null): SessionBlob | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw) as SessionBlob | null;
    return b && typeof b.userId === 'string' && b.userId ? b : null;
  } catch {
    return null;
  }
}

/** A signed-in account this phone can open straight onto Home. */
export const canOpenFromBlob = (b: SessionBlob | null): b is SessionBlob => !!b && (!!b.onboarded || !!b.characterId);

/** What this phone last saw for one account. */
export interface CachedData {
  characters: Companion[] | null;
  entitlement: ApiEntitlement | null;
  studio: ApiStudioCharacter[] | null;
  studioMemory: Record<string, boolean> | null;
}

export async function readCachedData(uid: string): Promise<CachedData> {
  const [characters, entitlement, studio, studioMemory] = await Promise.all([
    readCache<Companion[]>(uid, CACHE.characters),
    readCache<ApiEntitlement>(uid, CACHE.entitlement),
    readCache<ApiStudioCharacter[]>(uid, CACHE.studio),
    readCache<Record<string, boolean>>(uid, CACHE.studioMemory),
  ]);
  return { characters, entitlement, studio, studioMemory };
}

export interface LaunchReads {
  token: string | null;
  signedInBefore: boolean;
  /** The saved session, when there is a token to go with it. */
  blob: SessionBlob | null;
  /** The saved data for `blob`'s account, when it can open straight onto Home. */
  cached: CachedData | null;
}

async function readLaunch(): Promise<LaunchReads> {
  const [raw, token, signedInBefore] = await Promise.all([
    AsyncStorage.getItem(SESSION_KEY).catch(() => null),
    loadAuthToken(),
    AsyncStorage.getItem(SIGNED_IN_KEY).catch(() => null),
  ]);
  const blob = token ? parseBlob(raw) : null;
  const cached = canOpenFromBlob(blob) ? await readCachedData(blob.userId) : null;
  return { token, signedInBefore: !!signedInBefore, blob, cached };
}

let early: Promise<LaunchReads> | null = null;

/** Starts the launch reads, unless they are already under way. */
export function startLaunchReads(): void {
  if (!early) early = readLaunch();
}

// At import, not from the root's module body: imports are all evaluated
// before any module body runs, so a call there would wait for every screen
// module to load first.
startLaunchReads();

/** The launch reads: the early ones the first time, fresh ones after that. */
export function takeLaunchReads(): Promise<LaunchReads> {
  const reads = early ?? readLaunch();
  early = null;
  return reads;
}

// ── Splash hand-off ────────────────────────────────────────────────────
let revealed = false;

/** Fades the native launch screen out, once. Safe to call from anywhere. */
export function revealApp(): void {
  if (revealed) return;
  revealed = true;
  SplashScreen.hideAsync().catch(() => {});
}

/** Whether the launch screen has been asked to go. */
export function appRevealed(): boolean {
  return revealed;
}
