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

import React, { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { scheduleOnRN } from 'react-native-worklets';
import { LinearGradient } from 'expo-linear-gradient';

import type { TabId } from '../components/BottomNav';
import { MOTION, rgba, W } from '../theme/theme';
import { timing, useReducedMotion } from '../theme/motion';

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

/**
 * The four tab roots, each mounted on first visit and kept mounted after, so
 * switching back returns to the same scroll position with its data already on
 * screen. Unselected roots are taken out of layout (display: none), which on
 * iOS also releases their native views; a ScrollView's offset survives that.
 */
export function TabRoots({ active, renderTab }: { active: TabId; renderTab: (tab: TabId) => ReactNode }) {
  const [visited, setVisited] = useState<readonly TabId[]>([active]);
  if (!visited.includes(active)) setVisited([...visited, active]);

  return (
    <>
      {TAB_ORDER.filter(tab => visited.includes(tab)).map(tab => {
        const shown = tab === active;
        return (
          <View
            key={tab}
            style={shown ? FILL : styles.hidden}
            accessibilityElementsHidden={!shown}
            importantForAccessibility={shown ? 'auto' : 'no-hide-descendants'}
          >
            <Freeze frozen={!shown}>{renderTab(tab)}</Freeze>
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

// The first screen fades in as the launch screen fades out, rather than
// appearing all at once.
function initialState<R extends StackRoute>(routes: readonly R[]): StackState<R> {
  return { routes, scenes: routes.map(r => sceneFor(r, 0, 1, 0)), group: 0, move: { kind: 'reset', group: 0 }, moveId: 1 };
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

// ── ScreenStack ────────────────────────────────────────────────────────
interface ScreenStackProps<R extends StackRoute> {
  routes: readonly R[];
  renderScene: (route: R) => ReactNode;
  /** Whether an edge swipe may take the top screen away right now (iOS only). */
  canSwipeBack: boolean;
  /** A swipe back carried the route with this key off-screen: the router removes it. */
  onSwipeBack: (key: string) => void;
}

export function ScreenStack<R extends StackRoute>({ routes, renderScene, canSwipeBack, onSwipeBack }: ScreenStackProps<R>) {
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const dir = I18nManager.isRTL ? -1 : 1;

  const [st, setSt] = useState(() => initialState(routes));
  // Derived during render, so the new screen's first frame already has its
  // starting position: no flash of it in place before the slide begins.
  if (st.routes !== routes) setSt(diff(st, routes));

  // Taps are held while screens move, as in UIKit, so a double tap can't
  // push the same screen twice or pop two levels at once.
  const moving = useRef(0);
  const [locked, setLocked] = useState(false);

  const settle = useCallback((leave: string | null, belowGroup: number | null) => {
    moving.current = Math.max(0, moving.current - 1);
    setLocked(moving.current > 0);
    if (leave === null && belowGroup === null) return;
    setSt(s => ({
      ...s,
      scenes: s.scenes.filter(x => !(
        (leave !== null && x.leaving && x.route.key === leave)
        || (belowGroup !== null && x.group < belowGroup)
      )),
    }));
  }, []);

  useLayoutEffect(() => {
    const m = st.move;
    if (!m) return;
    const find = (key: string) => st.scenes.find(s => s.route.key === key && s.group === st.group);
    moving.current += 1;
    setLocked(true);
    const cfg = reduced ? fadeConfig(D.fast) : slideConfig();

    // Completion callbacks fire whether the animation finished or was
    // interrupted by the next move, so the lock can never stick.
    switch (m.kind) {
      case 'push': {
        const s = find(m.enter);
        if (!s) { settle(null, null); return; }
        s.progress.value = withTiming(1, cfg, () => {
          'worklet';
          scheduleOnRN(settle, null, null);
        });
        return;
      }
      case 'pop': {
        const s = st.scenes.find(x => x.route.key === m.leave && x.leaving);
        if (!s) { settle(null, null); return; }
        // A swipe back has already carried it off-screen.
        if (s.progress.value <= 0) { settle(m.leave, null); return; }
        const leave = m.leave;
        s.progress.value = withTiming(0, cfg, () => {
          'worklet';
          scheduleOnRN(settle, leave, null);
        });
        return;
      }
      case 'replace': {
        const s = find(m.enter);
        if (!s) { settle(m.leave, null); return; }
        const leave = m.leave;
        s.progress.value = withTiming(1, cfg, () => {
          'worklet';
          scheduleOnRN(settle, leave, null);
        });
        return;
      }
      case 'reset': {
        const fresh = st.scenes.filter(s => s.group === m.group);
        if (fresh.length === 0) { settle(null, m.group); return; }
        const group = m.group;
        fresh.forEach((s, i) => {
          s.fade.value = withTiming(1, fadeConfig(D.base), i === 0 ? () => {
            'worklet';
            scheduleOnRN(settle, null, group);
          } : undefined);
        });
      }
    }
    // Keyed on the move alone: a new move is the only thing that starts an
    // animation, and the scenes it names are already in `st`.
  }, [st.moveId]);

  const live = st.scenes.filter(s => s.group === st.group && !s.leaving);
  const topScene = live[live.length - 1];
  const topKey = topScene.route.key;
  const topIndex = st.scenes.indexOf(topScene);

  // ── Edge swipe back ──────────────────────────────────────────────────
  const dragging = useSharedValue(0);
  const swipeable = Platform.OS === 'ios' && canSwipeBack && !locked && live.length > 1;
  const pan = useMemo(() => {
    const progress = topScene.progress;
    const swiped = topScene.route.key;
    const finish = () => onSwipeBack(swiped);
    return Gesture.Pan()
      .enabled(swipeable)
      .hitSlop(dir === 1 ? { left: 0, width: EDGE } : { right: 0, width: EDGE })
      .activeOffsetX(dir * 10)
      .failOffsetY([-12, 12])
      .onStart(() => {
        dragging.value = 1;
      })
      .onUpdate(e => {
        progress.value = 1 - Math.min(1, Math.max(0, (e.translationX * dir) / width));
      })
      .onEnd((e, success) => {
        const speed = (e.velocityX * dir) / width;
        const done = success && (speed > FLICK || (progress.value < 0.5 && speed > -FLICK / 4));
        progress.value = withSpring(done ? 0 : 1, { ...SWIPE_SPRING, velocity: -speed }, finished => {
          'worklet';
          dragging.value = 0;
          if (finished && done) scheduleOnRN(finish);
        });
      });
  }, [swipeable, topScene.progress, topScene.route.key, dir, width, dragging, onSwipeBack]);

  return (
    <GestureDetector gesture={pan}>
      <View style={FILL} pointerEvents={locked ? 'none' : 'auto'}>
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
              reduced={reduced}
              dragging={dragging}
              width={width}
              dir={dir}
            >
              <Freeze frozen={frozen}>{renderScene(scene.route)}</Freeze>
            </SceneView>
          );
        })}
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
  reduced: boolean;
  dragging: SharedValue<number>;
  width: number;
  dir: 1 | -1;
  children: ReactNode;
}

function SceneView({ progress, fade, above, isBase, focused, reduced, dragging, width, dir, children }: SceneViewProps) {
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
      {children}
      <Animated.View pointerEvents="none" style={[styles.dim, dimStyle]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  hidden: { display: 'none' },
  // Opaque, so a screen never shows the one beneath through its gaps.
  scene: { ...FILL, backgroundColor: W.bg },
  dim: { ...FILL, backgroundColor: W.scrim },
  // Sits just outside the moving screen's leading edge, so at rest it is off-screen.
  shadowLeading: { position: 'absolute', top: 0, bottom: 0, left: -SHADOW_W, width: SHADOW_W },
  shadowTrailing: { position: 'absolute', top: 0, bottom: 0, right: -SHADOW_W, width: SHADOW_W },
});
