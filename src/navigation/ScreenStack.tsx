// ScreenStack.tsx — draws the route stack and animates every change to it.
//
// The router hands over its routes (bottom → top). This compares them with
// what is on screen and plays the matching move, all on the UI thread:
//   push     the new screen slides in from the trailing edge while the one
//            under it recedes a little and dims
//   pop      the top slides back out, uncovering the screen below
//   replace  the new screen slides in over the one it retires
//   reset    a new base (sign-in, sign-out, finishing onboarding) cross-fades
// Under Reduce Motion pushes and pops cross-fade instead of sliding.
//
// The screen under the top stays mounted and live, so an iOS edge swipe can
// drag the top away and reveal it. Screens further down, and tab roots that
// aren't selected, are frozen: they keep their state but skip re-rendering
// until they are uncovered.
//
// Every screen can tell whether it is the one in front (useSceneFocused), so
// a covered screen can stop work nobody sees, and a screen can hold its own
// swipe back while it waits for an answer (useBlockSwipeBack). See
// sceneContext.ts.
//
// Kept cheap on purpose: a move costs one render of the stack (the router's
// new routes), and nothing else in React. Touches are held and released on
// the UI thread, and finishing a push re-renders nothing.

import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { I18nManager, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { scheduleOnRN, scheduleOnUI } from 'react-native-worklets';
import { LinearGradient } from 'expo-linear-gradient';

import type { TabId } from '../components/BottomNav';
import { MOTION, rgba, W, Z } from '../theme/theme';
import { timing, useReducedMotion } from '../theme/motion';
import {
  SceneFocusContext, SceneFocusSignalContext, SwipeBackHoldContext, beginTransition, createFocusSignal, isIdle,
  noteTouch, useSceneFocused, type SwipeBackHold, type WritableFocusSignal,
} from './sceneContext';

const D = MOTION.duration;
const FILL = StyleSheet.absoluteFillObject;

/** How far a covered screen recedes, as a share of the width (as in UIKit). */
const PARALLAX = 0.3;
/** Scrim over a fully covered screen. */
const DIM = 0.4;
/** The strip along the leading edge that starts a swipe back. */
const EDGE = 24;
/** Soft shadow cast by a moving screen onto the one it covers. */
const SHADOW_W = 14;
const EDGE_SHADOW = [rgba(W.shadow, 0), rgba(W.shadow, 0.28)] as const;

// Releasing a swipe back: past half the width, or flicked faster than this
// many widths a second, completes it.
const FLICK = 1.2;
const SWIPE_SPRING = { ...MOTION.spring.snappy, overshootClamping: true, reduceMotion: ReduceMotion.Never };

/** A move's completion always arrives (finished or interrupted), but should
 *  one ever be lost, touches come back after this long regardless. */
const LOCK_FAILSAFE_MS = D.slower * 3;

// A slide is only used when motion is allowed; a fade is the calm form of the
// same move, so it plays under Reduce Motion too.
const slideConfig = (): WithTimingConfig => ({ ...timing(D.slow, 'decel'), reduceMotion: ReduceMotion.Never });
const fadeConfig = (ms: number): WithTimingConfig => ({ ...timing(ms), reduceMotion: ReduceMotion.Never });

// ── Freezing ───────────────────────────────────────────────────────────
// While frozen, the last render stays on screen and new props are ignored,
// so covered screens cost nothing when the router re-renders. Unfreezing
// renders the latest props.
const Freeze = memo(
  function Freeze({ children }: { frozen: boolean; children: ReactNode }) {
    return <>{children}</>;
  },
  (_prev, next) => next.frozen,
);

// ── Tab roots ──────────────────────────────────────────────────────────
const TAB_ORDER: readonly TabId[] = ['home', 'studio', 'sandbox', 'settings'];

// Tabs not yet opened are drawn ahead of time, one at a time, while the user
// is idle on the tab layer, so opening one for the first time is as quick as
// coming back to it. Most likely first.
const PREWARM_ORDER: readonly TabId[] = ['studio', 'settings', 'sandbox'];
/** After launch (or coming back to the tabs), before the first one. */
const PREWARM_AFTER_MS = 2000;
/** Between one tab and the next, so each mount lands on its own. */
const PREWARM_GAP_MS = 900;
/** Busy (a finger down, a list coasting, a screen moving): look again after this long. */
const PREWARM_RETRY_MS = 600;
/** How long without a touch counts as idle: a flung list has stopped by then. */
const PREWARM_QUIET_MS = 1500;

interface TabRootsProps {
  active: TabId;
  renderTab: (tab: TabId) => ReactNode;
  /** Draw the other tabs ahead of time while the user is idle. */
  prewarm?: boolean;
  /** A tab was drawn ahead of time, e.g. to fetch what it shows. */
  onPrewarm?: (tab: TabId) => void;
}

/**
 * The four tab roots, each mounted on first visit (or ahead of it, see
 * PREWARM_ORDER) and kept mounted after, so switching back returns to the
 * same scroll position with its data already on screen.
 *
 * Unselected roots stay laid out with their native views alive, just
 * transparent, untouchable, hidden from VoiceOver and frozen. A tab switch is
 * then two prop changes. Taking them out of layout (display: none) would
 * destroy every native view of the tab (blurs, SVG icons, gradients) and
 * rebuild them all on the main thread on every switch.
 */
export function TabRoots({ active, renderTab, prewarm = false, onPrewarm }: TabRootsProps) {
  const [visited, setVisited] = useState<readonly TabId[]>([active]);
  if (!visited.includes(active)) setVisited([...visited, active]);
  // The tab layer is in front only while nothing is pushed over it.
  const layerFocused = useSceneFocused();
  // One focus signal per tab root (see useSceneFocusRef), kept for its life.
  const signals = useRef(new Map<TabId, WritableFocusSignal>());
  const signalFor = (tab: TabId) => {
    let signal = signals.current.get(tab);
    if (!signal) {
      signal = createFocusSignal(layerFocused && tab === active);
      signals.current.set(tab, signal);
    }
    return signal;
  };
  useLayoutEffect(() => {
    signals.current.forEach((signal, tab) => signal.set(layerFocused && tab === active));
  }, [layerFocused, active]);

  const visitedRef = useRef(visited);
  visitedRef.current = visited;
  const onPrewarmRef = useRef(onPrewarm);
  onPrewarmRef.current = onPrewarm;
  // Only while the tabs are what the user is looking at: under a chat, the
  // time is the chat's.
  const warming = prewarm && layerFocused;
  useEffect(() => {
    if (!warming) return;
    let timer: ReturnType<typeof setTimeout>;
    const step = () => {
      const next = PREWARM_ORDER.find(tab => !visitedRef.current.includes(tab));
      if (!next) return;
      if (!isIdle(PREWARM_QUIET_MS)) {
        timer = setTimeout(step, PREWARM_RETRY_MS);
        return;
      }
      setVisited(v => (v.includes(next) ? v : [...v, next]));
      onPrewarmRef.current?.(next);
      timer = setTimeout(step, PREWARM_GAP_MS);
    };
    timer = setTimeout(step, PREWARM_AFTER_MS);
    return () => clearTimeout(timer);
  }, [warming]);

  return (
    <>
      {TAB_ORDER.filter(tab => visited.includes(tab)).map(tab => {
        const shown = tab === active;
        return (
          // Never flattened: switching tabs must only change these props,
          // not reparent the tab's views.
          <View
            key={tab}
            collapsable={false}
            pointerEvents={shown ? 'auto' : 'none'}
            style={shown ? FILL : styles.parked}
            accessibilityElementsHidden={!shown}
            importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
          >
            <SceneFocusContext.Provider value={layerFocused && shown}>
              <SceneFocusSignalContext.Provider value={signalFor(tab)}>
                <Freeze frozen={!shown}>{renderTab(tab)}</Freeze>
              </SceneFocusSignalContext.Provider>
            </SceneFocusContext.Provider>
          </View>
        );
      })}
    </>
  );
}

// ── Stack state ────────────────────────────────────────────────────────
interface StackRoute {
  key: string;
}

interface Scene<R> {
  route: R;
  /** Bumped by every reset, so the outgoing screens fade out as one group. */
  group: number;
  /** 0 = off-screen at the trailing edge, 1 = in place. */
  progress: SharedValue<number>;
  /** Opacity for reset cross-fades. */
  fade: SharedValue<number>;
  leaving: boolean;
}

type Move =
  | { kind: 'push'; enter: string }
  | { kind: 'pop'; leave: string }
  | { kind: 'replace'; enter: string; leave: string }
  | { kind: 'reset'; group: number };

interface StackState<R> {
  routes: readonly R[];
  scenes: Scene<R>[];
  group: number;
  move: Move | null;
  moveId: number;
}

function sceneFor<R extends StackRoute>(route: R, group: number, progress: number, fade = 1): Scene<R> {
  return { route, group, progress: makeMutable(progress), fade: makeMutable(fade), leaving: false };
}

/** The first screens either fade in, or are simply there (under a launch
 *  screen that fades out by itself, which is then the only transition). */
function initialState<R extends StackRoute>(routes: readonly R[], enter: 'fade' | 'none'): StackState<R> {
  const fade = enter === 'fade';
  return {
    routes,
    scenes: routes.map(r => sceneFor(r, 0, 1, fade ? 0 : 1)),
    group: 0,
    move: fade ? { kind: 'reset', group: 0 } : null,
    moveId: 1,
  };
}

/** What changed between the scenes on screen and the router's new routes. */
function diff<R extends StackRoute>(st: StackState<R>, routes: readonly R[]): StackState<R> {
  const live = st.scenes.filter(s => s.group === st.group && !s.leaving);
  const leaving = st.scenes.filter(s => s.group === st.group && s.leaving);
  // Screens from before a reset that are still fading out stay underneath
  // until their fade ends.
  const older = st.scenes.filter(s => s.group !== st.group);
  const moveId = st.moveId + 1;

  if (live.length === 0 || live[0].route.key !== routes[0].key) {
    const group = st.group + 1;
    return {
      routes,
      scenes: [...st.scenes.map(s => ({ ...s, leaving: true })), ...routes.map(r => sceneFor(r, group, 1, 0))],
      group,
      move: { kind: 'reset', group },
      moveId,
    };
  }

  const byKey = new Map(live.map(s => [s.route.key, s]));
  // Route objects are refreshed even when the key is kept: a tab switch
  // renames the base in place.
  const reuse = (r: R, progress: number): Scene<R> => {
    const s = byKey.get(r.key);
    return s ? { ...s, route: r } : sceneFor(r, st.group, progress);
  };
  const oldTop = live[live.length - 1];
  const newTop = routes[routes.length - 1];

  let prefix = 0;
  while (prefix < live.length && prefix < routes.length && live[prefix].route.key === routes[prefix].key) prefix++;

  if (oldTop.route.key === newTop.key) {
    return { ...st, routes, scenes: [...older, ...routes.map(r => reuse(r, 1)), ...leaving] };
  }
  const lastIndex = routes.length - 1;
  const enteringTop = (r: R, i: number) => reuse(r, i === lastIndex ? 0 : 1);

  if (prefix === live.length) {
    return {
      ...st, routes, moveId,
      scenes: [...older, ...routes.map(enteringTop), ...leaving],
      move: { kind: 'push', enter: newTop.key },
    };
  }
  const retired = { ...oldTop, leaving: true };
  if (prefix === routes.length) {
    // Anything between the old top and the new one goes at once; only the
    // top is seen leaving.
    return {
      ...st, routes, moveId,
      scenes: [...older, ...routes.map(r => reuse(r, 1)), ...leaving, retired],
      move: { kind: 'pop', leave: oldTop.route.key },
    };
  }
  const next = routes.map(enteringTop);
  return {
    ...st, routes, moveId,
    scenes: [...older, ...next.slice(0, -1), ...leaving, retired, next[next.length - 1]],
    move: { kind: 'replace', enter: newTop.key, leave: oldTop.route.key },
  };
}

// Touch bookkeeping for idle detection (sceneContext.isIdle). Observers only:
// they claim nothing, so every touch still goes where it was going.
const onTouchStart = () => noteTouch(true);
const onTouchEnd = () => noteTouch(false);

// ── ScreenStack ────────────────────────────────────────────────────────
interface ScreenStackProps<R extends StackRoute> {
  routes: readonly R[];
  renderScene: (route: R) => ReactNode;
  /** Whether an edge swipe may take the top screen away right now (iOS only). */
  canSwipeBack: boolean;
  /** A swipe back carried the route with this key off-screen: the router removes it. */
  onSwipeBack: (key: string) => void;
  /** How the first screens appear: fading in (default), or already in place
   *  under a launch screen that is about to fade out itself. */
  initialEnter?: 'fade' | 'none';
  /** Called once, when the first screens have been drawn. */
  onFirstFrame?: () => void;
}

export function ScreenStack<R extends StackRoute>({
  routes, renderScene, canSwipeBack, onSwipeBack, initialEnter = 'fade', onFirstFrame,
}: ScreenStackProps<R>) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const dir = I18nManager.isRTL ? -1 : 1;

  const [st, setSt] = useState(() => initialState(routes, initialEnter));
  // Derived during render, so the new screen's first frame already has its
  // starting position: no flash of it in place before the slide begins.
  if (st.routes !== routes) setSt(diff(st, routes));

  // A frame after the first commit, so its views are on screen by then.
  const firstFrame = useRef(onFirstFrame);
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => firstFrame.current?.());
    return () => cancelAnimationFrame(id);
  }, []);

  // ── Touch lock ───────────────────────────────────────────────────────
  // Taps are held while screens move, as in UIKit, so a double tap can't
  // push the same screen twice or pop two levels at once. `heldFor` is the
  // latest move and `doneTo` the latest one to finish; touches are held
  // while doneTo < heldFor. Both live on the UI thread: a move's end frees
  // touches in the same frame the animation lands, even while JS is busy,
  // and locking or unlocking renders nothing.
  const heldFor = useSharedValue(0);
  const doneTo = useSharedValue(0);
  const release = useCallback((id: number) => {
    'worklet';
    if (doneTo.value < id) doneTo.value = id;
  }, [doneTo]);

  // JS-side ends of each move in flight (sceneContext's transition count).
  const endings = useRef(new Map<number, () => void>());
  const endMove = useCallback((id: number) => {
    endings.current.get(id)?.();
    endings.current.delete(id);
  }, []);
  // Unmounted mid-move (a launch that fell back to its error screen):
  // nothing is left to finish these.
  useEffect(() => () => {
    endings.current.forEach(end => end());
    endings.current.clear();
  }, []);
  const settle = useCallback((id: number, leave: string | null, belowGroup: number | null) => {
    endMove(id);
    // A finished push leaves nothing to tidy, so it renders nothing.
    if (leave === null && belowGroup === null) return;
    setSt(s => ({
      ...s,
      scenes: s.scenes.filter(x => !(
        (leave !== null && x.leaving && x.route.key === leave)
        || (belowGroup !== null && x.group < belowGroup)
      )),
    }));
  }, [endMove]);

  useLayoutEffect(() => {
    const m = st.move;
    if (!m) return;
    const id = st.moveId;
    const find = (key: string) => st.scenes.find(s => s.route.key === key && s.group === st.group);
    heldFor.value = id;
    const endTransition = beginTransition();
    const failsafe = setTimeout(() => {
      scheduleOnUI(release, id);
      endMove(id);
    }, LOCK_FAILSAFE_MS);
    endings.current.set(id, () => {
      clearTimeout(failsafe);
      endTransition();
    });
    // Nothing to animate: done at once.
    const doneNow = (leave: string | null, below: number | null) => {
      scheduleOnUI(release, id);
      settle(id, leave, below);
    };
    const cfg = reduced ? fadeConfig(D.fast) : slideConfig();

    // Completion callbacks fire whether the animation finished or was
    // interrupted by the next move, so the lock can never stick.
    switch (m.kind) {
      case 'push': {
        const s = find(m.enter);
        if (!s) { doneNow(null, null); break; }
        s.progress.value = withTiming(1, cfg, () => {
          'worklet';
          release(id);
          scheduleOnRN(settle, id, null, null);
        });
        break;
      }
      case 'pop': {
        const s = st.scenes.find(x => x.route.key === m.leave && x.leaving);
        if (!s) { doneNow(null, null); break; }
        // A swipe back has already carried it off-screen.
        if (s.progress.value <= 0) { doneNow(m.leave, null); break; }
        const leave = m.leave;
        s.progress.value = withTiming(0, cfg, () => {
          'worklet';
          release(id);
          scheduleOnRN(settle, id, leave, null);
        });
        break;
      }
      case 'replace': {
        const s = find(m.enter);
        if (!s) { doneNow(m.leave, null); break; }
        const leave = m.leave;
        s.progress.value = withTiming(1, cfg, () => {
          'worklet';
          release(id);
          scheduleOnRN(settle, id, leave, null);
        });
        break;
      }
      case 'reset': {
        const fresh = st.scenes.filter(s => s.group === m.group);
        if (fresh.length === 0) { doneNow(null, m.group); break; }
        const group = m.group;
        fresh.forEach((s, i) => {
          s.fade.value = withTiming(1, fadeConfig(D.base), i === 0 ? () => {
            'worklet';
            release(id);
            scheduleOnRN(settle, id, null, group);
          } : undefined);
        });
      }
    }
    // Keyed on the move alone: a new move is the only thing that starts an
    // animation, and the scenes it names are already in `st`.
  }, [st.moveId]);

  // Held on the UI thread: an untouchable screen-sized layer over the stack,
  // parked off-screen when nothing is moving.
  const shieldStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: doneTo.value < heldFor.value ? 0 : -2 * width }],
  }));

  const live = st.scenes.filter(s => s.group === st.group && !s.leaving);
  const topScene = live[live.length - 1];
  const topKey = topScene.route.key;
  const topIndex = st.scenes.indexOf(topScene);

  // ── Swipe holds ──────────────────────────────────────────────────────
  // A screen holds its own swipe back while something inside it waits for
  // an answer, such as an open sheet (useBlockSwipeBack). Counted per route,
  // so a sheet left open on a covered screen never holds the one on top.
  const holdCounts = useRef(new Map<string, number>());
  const [held, setHeld] = useState<ReadonlySet<string>>(() => new Set());
  // One stable hold per route, so a screen's effect doesn't re-run on every render.
  const holders = useRef(new Map<string, SwipeBackHold>());
  const holdFor = (key: string): SwipeBackHold => {
    let hold = holders.current.get(key);
    if (!hold) {
      const sync = () => setHeld(new Set(holdCounts.current.keys()));
      hold = () => {
        holdCounts.current.set(key, (holdCounts.current.get(key) ?? 0) + 1);
        sync();
        let released = false;
        return () => {
          if (released) return;
          released = true;
          const n = (holdCounts.current.get(key) ?? 1) - 1;
          if (n > 0) holdCounts.current.set(key, n);
          else holdCounts.current.delete(key);
          sync();
        };
      };
      holders.current.set(key, hold);
    }
    return hold;
  };
  useEffect(() => {
    const keys = new Set(st.scenes.map(s => s.route.key));
    for (const key of holders.current.keys()) {
      if (!keys.has(key)) holders.current.delete(key);
    }
  }, [st.scenes]);

  // ── Edge swipe back ──────────────────────────────────────────────────
  const dragging = useSharedValue(0);
  // A swipe that starts while a screen is still moving is ignored, as in
  // UIKit. Decided on the UI thread when the finger lands.
  const ignored = useSharedValue(0);
  const swipeable = Platform.OS === 'ios' && canSwipeBack && live.length > 1 && !held.has(topKey);
  const pan = useMemo(() => {
    const progress = topScene.progress;
    const swiped = topScene.route.key;
    const finish = () => onSwipeBack(swiped);
    return Gesture.Pan()
      .enabled(swipeable)
      .hitSlop(dir === 1 ? { left: 0, width: EDGE } : { right: 0, width: EDGE })
      .activeOffsetX(dir * 10)
      .failOffsetY([-12, 12])
      .onBegin(() => {
        ignored.value = doneTo.value < heldFor.value ? 1 : 0;
      })
      .onStart(() => {
        if (ignored.value) return;
        dragging.value = 1;
      })
      .onUpdate(e => {
        if (ignored.value) return;
        progress.value = 1 - Math.min(1, Math.max(0, (e.translationX * dir) / width));
      })
      .onEnd((e, success) => {
        if (ignored.value) return;
        const speed = (e.velocityX * dir) / width;
        const done = success && (speed > FLICK || (progress.value < 0.5 && speed > -FLICK / 4));
        progress.value = withSpring(done ? 0 : 1, { ...SWIPE_SPRING, velocity: -speed }, finished => {
          'worklet';
          dragging.value = 0;
          if (finished && done) scheduleOnRN(finish);
        });
      });
  }, [swipeable, topScene.progress, topScene.route.key, dir, width, dragging, ignored, doneTo, heldFor, onSwipeBack]);

  return (
    <GestureDetector gesture={pan}>
      <View style={FILL} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}>
        {st.scenes.map((scene, i) => {
          const next = st.scenes[i + 1];
          const above = next && next.group === scene.group ? next.progress : null;
          const focused = scene.route.key === topKey && !scene.leaving && scene.group === st.group;
          // The screen right under the top stays live for a swipe back.
          const frozen = scene.leaving || scene.group !== st.group || i < topIndex - 1;
          return (
            <SceneView
              key={`${scene.group}:${scene.route.key}`}
              progress={scene.progress}
              fade={scene.fade}
              above={above}
              isBase={i === 0 || scene.group !== st.scenes[i - 1]?.group}
              focused={focused}
              hold={holdFor(scene.route.key)}
              reduced={reduced}
              dragging={dragging}
              width={width}
              dir={dir}
            >
              <Freeze frozen={frozen}>{renderScene(scene.route)}</Freeze>
            </SceneView>
          );
        })}
        {/* Never flattened away, or it couldn't catch the touches it holds. */}
        <Animated.View collapsable={false} style={[styles.shield, shieldStyle]} />
      </View>
    </GestureDetector>
  );
}

interface SceneViewProps {
  progress: SharedValue<number>;
  fade: SharedValue<number>;
  /** Progress of the screen covering this one, if any. */
  above: SharedValue<number> | null;
  isBase: boolean;
  focused: boolean;
  hold: SwipeBackHold;
  reduced: boolean;
  dragging: SharedValue<number>;
  width: number;
  dir: 1 | -1;
  children: ReactNode;
}

function SceneView({ progress, fade, above, isBase, focused, hold, reduced, dragging, width, dir, children }: SceneViewProps) {
  const sceneStyle = useAnimatedStyle(() => {
    // A finger-driven swipe always slides, even under Reduce Motion, as iOS does.
    const slide = !reduced || dragging.value === 1;
    const p = progress.value;
    if (!slide) return { opacity: fade.value * p, transform: [{ translateX: 0 }] };
    const cover = above ? above.value : 0;
    return {
      opacity: fade.value,
      transform: [{ translateX: dir * ((1 - p) * width - cover * width * PARALLAX) }],
    };
  });
  const dimStyle = useAnimatedStyle(() => {
    const slide = !reduced || dragging.value === 1;
    return { opacity: slide && above ? above.value * DIM : 0 };
  });
  const [focusSignal] = useState(() => createFocusSignal(focused));
  useLayoutEffect(() => focusSignal.set(focused), [focused, focusSignal]);

  return (
    <Animated.View
      pointerEvents={focused ? 'auto' : 'none'}
      accessibilityElementsHidden={!focused}
      importantForAccessibility={focused ? 'auto' : 'no-hide-descendants'}
      style={[styles.scene, sceneStyle]}
    >
      {isBase ? null : (
        <LinearGradient
          pointerEvents="none"
          colors={EDGE_SHADOW}
          start={{ x: dir === 1 ? 0 : 1, y: 0 }}
          end={{ x: dir === 1 ? 1 : 0, y: 0 }}
          style={dir === 1 ? styles.shadowLeading : styles.shadowTrailing}
        />
      )}
      <SceneFocusContext.Provider value={focused}>
        <SceneFocusSignalContext.Provider value={focusSignal}>
          <SwipeBackHoldContext.Provider value={hold}>{children}</SwipeBackHoldContext.Provider>
        </SceneFocusSignalContext.Provider>
      </SceneFocusContext.Provider>
      <Animated.View pointerEvents="none" style={[styles.dim, dimStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Laid out and alive, just not drawn: iOS skips transparent layers.
  parked: { ...FILL, opacity: 0 },
  // Opaque, so a screen never shows the one beneath through its gaps.
  scene: { ...FILL, backgroundColor: W.bg },
  // Above anything the screen raises inside itself (its sheets, the tab
  // bar), so a covered screen dims evenly.
  dim: { ...FILL, backgroundColor: W.scrim, zIndex: Z.overlay },
  // Sits just outside the moving screen's leading edge, so at rest it is off-screen.
  shadowLeading: { position: 'absolute', top: 0, bottom: 0, left: -SHADOW_W, width: SHADOW_W },
  shadowTrailing: { position: 'absolute', top: 0, bottom: 0, right: -SHADOW_W, width: SHADOW_W },
  shield: { ...FILL, zIndex: Z.overlay },
});
