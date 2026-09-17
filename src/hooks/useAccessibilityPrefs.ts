// useAccessibilityPrefs.ts — live system accessibility settings.
// Each setting is asked for once, then followed through its change event, so
// flipping it in the system Settings app takes effect without a relaunch.

import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';

type ChangeEvent = 'reduceMotionChanged' | 'reduceTransparencyChanged' | 'screenReaderChanged';

export interface LivePref {
  /** The current setting, or null until the platform has answered. */
  get(): boolean | null;
  subscribe(onChange: () => void): () => void;
}

function livePref(event: ChangeEvent, query: () => Promise<boolean>): LivePref {
  let value: boolean | null = null;
  let started = false;
  const listeners = new Set<() => void>();

  const set = (next: boolean) => {
    if (next === value) return;
    value = next;
    listeners.forEach(notify => notify());
  };

  // Lazy, and never torn down: the setting matters for as long as the app runs.
  const start = () => {
    if (started) return;
    started = true;
    let heardChange = false;
    AccessibilityInfo.addEventListener(event, next => {
      heardChange = true;
      set(next);
    });
    // A change event that beats the initial answer is the newer value.
    query().then(
      initial => { if (!heardChange) set(initial); },
      () => {},
    );
  };

  return {
    get() {
      start();
      return value;
    },
    subscribe(onChange) {
      start();
      listeners.add(onChange);
      return () => { listeners.delete(onChange); };
    },
  };
}

/** Reduce Motion. Components read it through `useReducedMotion` in theme/motion. */
export const reduceMotionPref = livePref('reduceMotionChanged', () => AccessibilityInfo.isReduceMotionEnabled());
const reduceTransparencyPref = livePref('reduceTransparencyChanged', () => AccessibilityInfo.isReduceTransparencyEnabled());
const screenReaderPref = livePref('screenReaderChanged', () => AccessibilityInfo.isScreenReaderEnabled());

function usePref(pref: LivePref): boolean {
  return useSyncExternalStore(pref.subscribe, pref.get) ?? false;
}

/** True when iOS "Reduce Transparency" is on: swap blurs for solid fills. */
export function useReduceTransparency(): boolean {
  return usePref(reduceTransparencyPref);
}

/** True while VoiceOver / TalkBack is running. */
export function useScreenReader(): boolean {
  return usePref(screenReaderPref);
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
