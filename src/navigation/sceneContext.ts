// sceneContext.ts — what a screen can know about, and ask of, the stack it is
// drawn in.
//
// Screens stay mounted under the one in front (ScreenStack keeps them for Back
// and the edge swipe), so a screen can't tell from being mounted that it is
// the one being looked at. ScreenStack provides both values below for every
// screen it draws. Outside a stack a screen counts as in front and nothing
// holds its swipe.
//
// Also here: whether a screen is moving right now (runAfterTransitions), and
// whether the user is idle (isIdle), so work that can wait doesn't land in
// the middle of an animation or a scroll.
//
// Kept free of other imports, so low-level modules (motion hooks, Sheet) can
// read it without pulling in the router.

import { createContext, useContext, useEffect, useRef, useState } from 'react';

/**
 * True while this screen is the one in front: the top of the stack, and for a
 * tab root also the selected tab. It turns false as soon as another screen is
 * pushed over it, and true again as soon as that screen starts to leave.
 *
 * Covered screens keep their state but should stop work nobody can see, such
 * as ambient animation loops (Freeze only stops React re-renders, not loops
 * running on the UI thread).
 */
export const SceneFocusContext = createContext(true);

export function useSceneFocused(): boolean {
  return useContext(SceneFocusContext);
}

// The same answer without re-rendering. useSceneFocused() re-renders the
// component that reads it every time the screen is covered or uncovered,
// which for a screen's root means redrawing the whole screen in the same
// commit that starts the slide. Code that only needs to act on focus (fetch
// on return, ignore a late answer) reads it through these instead.

/** Whether a screen is in front, readable and watchable without rendering. */
export interface SceneFocusSignal {
  readonly current: boolean;
  subscribe(listener: (focused: boolean) => void): () => void;
}

/** A signal ScreenStack writes. */
export interface WritableFocusSignal extends SceneFocusSignal {
  set(focused: boolean): void;
}

/**
 * `.current` changes at once; listeners hear about it once nothing is moving,
 * so what they do (a fetch, a state change) lands after the slide rather than
 * in the middle of it. A quick back-and-forth reaches them as its end result.
 */
export function createFocusSignal(initial: boolean): WritableFocusSignal {
  let current = initial;
  let told = initial;
  let pending: (() => void) | null = null;
  const listeners = new Set<(focused: boolean) => void>();
  const tell = () => {
    pending = null;
    if (told === current) return;
    told = current;
    listeners.forEach(listener => listener(told));
  };
  return {
    get current() { return current; },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    set(focused) {
      if (focused === current) return;
      current = focused;
      if (!pending) pending = runAfterTransitions(tell);
    },
  };
}

const ALWAYS_FOCUSED: SceneFocusSignal = { current: true, subscribe: () => () => {} };

export const SceneFocusSignalContext = createContext<SceneFocusSignal>(ALWAYS_FOCUSED);

/**
 * Whether this screen is in front, as `.current`, read when needed (in a
 * handler, an effect, an async callback). Unlike useSceneFocused() the
 * component doesn't re-render when it changes.
 */
export function useSceneFocusRef(): { readonly current: boolean } {
  return useContext(SceneFocusSignalContext);
}

/**
 * Runs `effect` whenever this screen has come to the front (at mount, if it
 * is in front), and its cleanup once it has been covered or when it unmounts,
 * without re-rendering the screen. Both wait until the move is over. E.g.
 * refetch on return, pause a timer while covered.
 */
export function useSceneFocusEffect(effect: () => void | (() => void)): void {
  const signal = useContext(SceneFocusSignalContext);
  const latest = useRef(effect);
  latest.current = effect;
  useEffect(() => {
    let active = false;
    let cleanup: void | (() => void);
    const apply = (focused: boolean) => {
      if (focused === active) return;
      active = focused;
      if (focused) {
        cleanup = latest.current();
      } else {
        cleanup?.();
        cleanup = undefined;
      }
    };
    apply(signal.current);
    const unsubscribe = signal.subscribe(apply);
    return () => {
      unsubscribe();
      if (active) cleanup?.();
    };
  }, [signal]);
}

/** Holds this screen's edge swipe back; returns the release. */
export type SwipeBackHold = () => () => void;

export const SwipeBackHoldContext = createContext<SwipeBackHold | null>(null);

/**
 * Stops an edge swipe from taking this screen away while `active`, e.g. while
 * a sheet drawn inside the screen is open and waiting for an answer. Every
 * holder must let go before the swipe works again.
 */
export function useBlockSwipeBack(active: boolean): void {
  const hold = useContext(SwipeBackHoldContext);
  useEffect(() => (active && hold ? hold() : undefined), [active, hold]);
}

// ── Transitions ────────────────────────────────────────────────────────
// Screens slide on the UI thread, but anything that re-renders or mounts a
// lot while they do (a refetch landing on the list being uncovered, a heavy
// first render) holds up the UI thread's commits and the slide stutters.
// Such work can wait the few hundred milliseconds until nothing is moving.

let moving = 0;
const waiting = new Set<() => void>();

function flush() {
  if (moving > 0) return;
  const due = [...waiting];
  waiting.clear();
  due.forEach(run => run());
}

/** ScreenStack: a move has started. Returns its end, safe to call more than once. */
export function beginTransition(): () => void {
  moving += 1;
  let open = true;
  return () => {
    if (!open) return;
    open = false;
    moving -= 1;
    // A tick later, so the work doesn't run inside the settle's own update.
    if (moving === 0 && waiting.size > 0) setTimeout(flush, 0);
  };
}

/**
 * Runs `fn` once no screen is moving: on the next tick if none is. Returns a
 * cancel, safe to call after it has run.
 */
export function runAfterTransitions(fn: () => void): () => void {
  let cancelled = false;
  const task = () => { if (!cancelled) fn(); };
  waiting.add(task);
  if (moving === 0) setTimeout(flush, 0);
  return () => {
    cancelled = true;
    waiting.delete(task);
  };
}

/**
 * False for a screen's first render and until the move that brought it on
 * screen has finished; true from then on (a tick after mount when nothing is
 * moving). For drawing the costly parts of a screen (a long list, a chart)
 * once it has arrived, so they don't hold up its entrance.
 */
export function useSceneArrived(): boolean {
  const [arrived, setArrived] = useState(false);
  // An effect, not the initial state: the move that brings a screen on only
  // starts after the screen's first render has committed.
  useEffect(() => (arrived ? undefined : runAfterTransitions(() => setArrived(true))), [arrived]);
  return arrived;
}

// ── Idle ───────────────────────────────────────────────────────────────
// Fed by ScreenStack, which sees every touch in the app's screens.

let touching = false;
let lastTouchAt = 0;

/** ScreenStack: a finger went down (true) or the last one lifted (false). */
export function noteTouch(down: boolean): void {
  touching = down;
  lastTouchAt = Date.now();
}

/**
 * Nothing is moving, no finger is down, and none has been for `quietMs` (long
 * enough for a flung list to have coasted to a stop). For optional work that
 * would make a frame late, such as preparing a tab before it is opened.
 */
export function isIdle(quietMs: number): boolean {
  return moving === 0 && !touching && Date.now() - lastTouchAt >= quietMs;
}
