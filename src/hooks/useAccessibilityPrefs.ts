// useAccessibilityPrefs.ts — live system accessibility settings.
// Each setting is asked for once, then followed through its change event, so
// flipping it in the system Settings app takes effect without a relaunch.
//
// All three are asked for as soon as this module loads (it loads with the
// theme, long before the first screen), so the answers are normally in by the
// first real render and nothing re-renders to catch up. One native listener
// per setting fans out to every subscriber.

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

type ChangeEvent = 'reduceMotionChanged' | 'reduceTransparencyChanged' | 'screenReaderChanged';

export interface LivePref {
  /** The current setting, or null until the platform has answered. */
  get(): boolean | null;
  subscribe(onChange: () => void): () => void;
  /** Settles once the platform has answered (or failed to). */
  ready: Promise<void>;
}

function livePref(event: ChangeEvent, query: () => Promise<boolean>): LivePref {
  let value: boolean | null = null;
  const listeners = new Set<() => void>();

  const set = (next: boolean) => {
    if (next === value) return;
    value = next;
    listeners.forEach(notify => notify());
  };

  // Never torn down: the setting matters for as long as the app runs.
  let heardChange = false;
  let ready: Promise<void>;
  try {
    AccessibilityInfo.addEventListener(event, next => {
      heardChange = true;
      set(next);
    });
    // A change event that beats the initial answer is the newer value.
    ready = query().then(
      initial => { if (!heardChange) set(initial); },
      () => {},
    );
  } catch {
    // Accessibility module unavailable (tests, some web builds).
    ready = Promise.resolve();
  }

  return {
    get: () => value,
    subscribe(onChange) {
      listeners.add(onChange);
      return () => { listeners.delete(onChange); };
    },
    ready,
  };
}

/** Reduce Motion. Components read it through `useReducedMotion` in theme/motion. */
export const reduceMotionPref = livePref('reduceMotionChanged', () => AccessibilityInfo.isReduceMotionEnabled());
const reduceTransparencyPref = livePref('reduceTransparencyChanged', () => AccessibilityInfo.isReduceTransparencyEnabled());
const screenReaderPref = livePref('screenReaderChanged', () => AccessibilityInfo.isScreenReaderEnabled());

/** Settles once every setting has its first answer. The launch sequence can
 *  await it next to its storage reads, so screens mount with final values. */
export const accessibilityPrefsReady: Promise<void> = Promise.all([
  reduceMotionPref.ready, reduceTransparencyPref.ready, screenReaderPref.ready,
]).then(() => undefined);

// The snapshot is the boolean the hook returns, not the raw `null` → answer
// transition, so an answer of "off" (the usual case) re-renders nobody.
const transparencySnapshot = () => reduceTransparencyPref.get() ?? false;
const screenReaderSnapshot = () => screenReaderPref.get() ?? false;

/** True when iOS "Reduce Transparency" is on: swap blurs for solid fills. */
export function useReduceTransparency(): boolean {
  return useSyncExternalStore(reduceTransparencyPref.subscribe, transparencySnapshot);
}

/** True while VoiceOver / TalkBack is running. */
export function useScreenReader(): boolean {
  return useSyncExternalStore(screenReaderPref.subscribe, screenReaderSnapshot);
}

/** Speaks `message` through the screen reader, after anything it is already
 *  saying. Does nothing when no screen reader is running. */
export function announce(message: string): void {
  const text = message.trim();
  if (!text) return;
  try {
    AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
  } catch {
    // Accessibility module unavailable (tests, web without support).
  }
}
