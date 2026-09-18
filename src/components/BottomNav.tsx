// BottomNav.tsx — "Ember Dusk" floating tab bar. A rounded glass capsule
// that floats over the bottom of the screen; the selected tab is an
// aurora-filled pill carrying its icon and label, the others are icons.
//
// Geometry is computed, not measured per tab: the row width comes from the
// window and the label widths are measured once, off-screen, at the current
// text size. A tap therefore knows where everything ends up and starts the
// move on the UI thread straight away. One spring drives the pill and every
// icon together, and each icon changes colour as the pill passes under it.
//
// The bar is an absolute overlay. Tab screens pass `tabBar` to Screen and pad
// their scroll content by `useTabBarHeight()` so content scrolls behind the
// glass. Content really does move under it, so its blur stays live.
//
// The router re-renders on every app-level state change; the bar and each
// tab are memoized with stable props, so those renders stop here. Only a
// selection (which moves every tab's slot) or a resize re-renders the tabs.

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import Animated, {
  ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming,
  type SharedValue, type WithTimingConfig,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from './Txt';
import { NavIcon, type IconName } from './NavIcon';
import { ELEV, GRAD, HIT, MOTION, R, SP, W, Z, rgba } from '../theme/theme';
import { ease, spring, timing, usePressFeedback, useReducedMotion } from '../theme/motion';
import { useReduceTransparency } from '../hooks/useAccessibilityPrefs';
import { haptic } from '../lib/haptics';

export type TabId = 'home' | 'studio' | 'sandbox' | 'settings';

interface BottomNavProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  sandboxComingSoon?: boolean;
  /** Tapping the tab that is already selected. Without it the tap goes to
   *  `onChange`, which returns a screen pushed from that tab to its root. */
  onReselect?: (tab: TabId) => void;
  /** Slides the bar away but keeps it mounted, so it comes back in place. */
  hidden?: boolean;
}

const TABS: readonly { id: TabId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'chat' },
  { id: 'studio', label: 'Studio', icon: 'grid' },
  { id: 'sandbox', label: 'Sandbox', icon: 'mask' },
  { id: 'settings', label: 'Settings', icon: 'gear' },
];
const COUNT = TABS.length;

// ── Geometry (pt) ──────────────────────────────────────────────────────
const EDGE = SP.lg;            // capsule inset from the screen sides
const INSET = SP.sm;           // capsule padding around the tab row
const ROW_H = HIT;             // every tab is a full-height touch target
const CAPSULE_H = ROW_H + INSET * 2;
const ICON = 20;
const GAP = SP.sm;             // icon to label
const PAD = SP.base;           // pill side padding at its natural width
const PAD_MIN = SP.sm2;        // …and when a narrow screen squeezes it
const BADGE_W = 48;

function useBottomGap(): number {
  return Math.max(useSafeAreaInsets().bottom, SP.md);
}

/** Height of the band the floating tab bar covers at the bottom of the
 *  screen, safe area included. Tab screens pad their scroll content by this
 *  plus their own breathing room so the last row can scroll clear of it. */
export function useTabBarHeight(): number {
  return CAPSULE_H + useBottomGap();
}

interface Layout {
  /** Touch areas, relative to the capsule, spanning its padding too. */
  hitX: number[];
  hitW: number[];
  /** Animated targets relative to the row: [pillX, pillW, icon0 … iconN]. */
  geo: number[];
  /** Width each label may take. Only the selected one is ever seen. */
  labelW: number[];
}

// Unselected tabs share what the pill leaves and never drop below the touch
// minimum; on a narrow screen the pill gives way and its label truncates.
function layoutFor(selected: number, rowW: number, natural: readonly number[]): Layout {
  const pillW = Math.min(PAD * 2 + ICON + GAP + natural[selected], rowW - (COUNT - 1) * HIT);
  const restW = (rowW - pillW) / (COUNT - 1);
  const labelMax = Math.max(0, pillW - PAD_MIN * 2 - ICON - GAP);

  const layout: Layout = { hitX: [], hitW: [], geo: [0, pillW], labelW: [] };
  let x = 0;
  for (let i = 0; i < COUNT; i++) {
    const isSel = i === selected;
    const w = isSel ? pillW : restW;
    const label = isSel ? Math.min(natural[i], labelMax) : natural[i];
    const content = isSel ? ICON + GAP + label : ICON;
    if (isSel) layout.geo[0] = x;
    layout.geo.push(x + (w - content) / 2);
    layout.labelW.push(label);
    layout.hitX.push(i === 0 ? 0 : INSET + x);
    layout.hitW.push(w + (i === 0 ? INSET : 0) + (i === COUNT - 1 ? INSET : 0));
    x += w;
  }
  return layout;
}

const labelOn = (selected: number) => TABS.map((_, i) => (i === selected ? 1 : 0));

// Showing and hiding under Reduce Motion: a fade in place.
const FADE: WithTimingConfig = { duration: MOTION.duration.fast, easing: ease.standard, reduceMotion: ReduceMotion.Never };

function BottomNavImpl({ active, onChange, sandboxComingSoon = true, onReselect, hidden = false }: BottomNavProps) {
  const { width } = useWindowDimensions();
  const bottomGap = useBottomGap();
  const reduced = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  const rowW = width - EDGE * 2 - INSET * 2;

  // Label widths at the current text size. Remeasured when Dynamic Type
  // changes, because the hidden labels lay out again.
  const [natural, setNatural] = useState<readonly number[] | null>(null);
  const measured = useRef<number[]>([]);
  // One stable handler per label, so the measuring labels never re-render.
  const onMeasure = useMemo(() => TABS.map((_, i) => (e: LayoutChangeEvent) => {
    const w = Math.ceil(e.nativeEvent.layout.width);
    if (measured.current[i] === w) return;
    measured.current[i] = w;
    if (TABS.every((_, j) => measured.current[j] != null)) setNatural([...measured.current]);
  }), []);

  // A tap selects at once; the router's `active` follows a frame later and
  // wins whenever it changes on its own.
  const activeIndex = Math.max(0, TABS.findIndex(t => t.id === active));
  const [selected, setSelected] = useState(activeIndex);
  const [synced, setSynced] = useState(activeIndex);
  if (activeIndex !== synced) {
    setSynced(activeIndex);
    setSelected(activeIndex);
  }

  // Parked (display: none) once hidden, so the blur costs nothing offscreen.
  const visible = !hidden && natural != null;
  const [parked, setParked] = useState(!visible);
  // Parks only if the bar is still meant to be away when the fade-out ends.
  // At launch the bar mounts hidden (labels not measured yet) and its
  // fade-out finishes a frame later; the measurement can land in between and
  // un-park it, and an unconditional park would then hide the bar for good.
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const park = useCallback(() => {
    if (!visibleRef.current) setParked(true);
  }, []);
  const shown = useSharedValue(visible ? 1 : 0);

  const layout = useMemo(() => (natural ? layoutFor(selected, rowW, natural) : null), [selected, rowW, natural]);
  const geo = useSharedValue<number[]>(Array.from({ length: COUNT + 2 }, () => 0));
  const vis = useSharedValue<number[]>(labelOn(activeIndex));

  // Travel only when the selection moves in view. The first placement,
  // resizes (rotation, text size) and changes made while the bar is away all
  // snap, so the pill never sweeps in from the edge.
  const placed = useRef<{ index: number; key: string } | null>(null);
  const place = (index: number) => {
    if (!natural) return;
    const key = `${rowW}|${natural.join(',')}`;
    const prev = placed.current;
    if (prev && prev.index === index && prev.key === key) return;
    placed.current = { index, key };
    const target = layoutFor(index, rowW, natural).geo;
    if (!prev || prev.index === index || parked) {
      geo.value = target;
      vis.value = labelOn(index);
    } else {
      // Under Reduce Motion these configs land instantly: the pill snaps.
      geo.value = withSpring(target, spring('snappy'));
      vis.value = withTiming(labelOn(index), timing(MOTION.duration.fast));
    }
  };
  useEffect(() => place(selected), [selected, rowW, natural]);

  const select = (index: number) => {
    const tab = TABS[index].id;
    if (index === selected) {
      (onReselect ?? onChange)(tab);
      return;
    }
    haptic.selection();
    place(index);
    setSelected(index);
    // The pill is already moving on the UI thread; the next screen mounts a
    // frame later so its render doesn't hold up the pill's first frame.
    requestAnimationFrame(() => onChange(tab));
  };
  // Tabs get one handler for the bar's lifetime, which always runs the
  // latest `select`, so a render of the bar doesn't re-render every tab.
  const latestSelect = useRef(select);
  latestSelect.current = select;
  const onTabPress = useCallback((index: number) => latestSelect.current(index), []);

  // ── Presence ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setParked(false);
      shown.value = withTiming(1, reduced ? FADE : timing(MOTION.duration.base, 'decel'));
      return;
    }
    shown.value = withTiming(0, reduced ? FADE : timing(MOTION.duration.fast, 'accel'), finished => {
      'worklet';
      if (finished) scheduleOnRN(park);
    });
  }, [visible, reduced]);

  const band = CAPSULE_H + bottomGap;
  const presenceStyle = useAnimatedStyle(() => (reduced
    ? { opacity: shown.value, transform: [{ translateY: 0 }] }
    : { opacity: 1, transform: [{ translateY: (1 - shown.value) * (band + SP.xl) }] }));

  const pillStyle = useAnimatedStyle(() => ({
    width: geo.value[1],
    transform: [{ translateX: geo.value[0] }],
  }));

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.measure}
      >
        {TABS.map((t, i) => (
          <Txt key={t.id} {...LABEL} numberOfLines={1} onLayout={onMeasure[i]}>{t.label}</Txt>
        ))}
      </View>

      <Animated.View
        pointerEvents={visible ? 'box-none' : 'none'}
        accessibilityElementsHidden={!visible}
        importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
        style={[styles.presence, { paddingBottom: bottomGap, display: parked ? 'none' : 'flex' }, presenceStyle]}
      >
        {/* Content fades out as it scrolls down behind the bar. */}
        <LinearGradient pointerEvents="none" colors={SCROLL_EDGE} style={[styles.scrollEdge, { height: band + SP.xxl }]} />

        <View
          accessibilityRole="tabbar"
          style={[styles.capsule, { backgroundColor: reduceTransparency ? W.surface1 : W.glass }]}
        >
          {!reduceTransparency && (
            <BlurView pointerEvents="none" intensity={50} tint="dark" style={StyleSheet.absoluteFill} />
          )}
          {/* The capsule catching light along its top edge */}
          <LinearGradient
            pointerEvents="none"
            colors={TOP_LIGHT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topLight}
          />

          {layout && (
            <>
              <Animated.View pointerEvents="none" style={[styles.pill, pillStyle]}>
                <View style={styles.pillClip}>
                  <LinearGradient
                    colors={[...GRAD.aurora]}
                    locations={[0, 0.55, 1]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={StyleSheet.absoluteFill}
                  />
                  <LinearGradient colors={GLOSS} style={styles.gloss} />
                </View>
              </Animated.View>

              {TABS.map((t, i) => (
                <Tab
                  key={t.id}
                  index={i}
                  label={t.label}
                  icon={t.icon}
                  selected={i === selected}
                  soon={t.id === 'sandbox' && sandboxComingSoon}
                  hitX={layout.hitX[i]}
                  hitW={layout.hitW[i]}
                  labelW={layout.labelW[i]}
                  geo={geo}
                  vis={vis}
                  onPress={onTabPress}
                />
              ))}
            </>
          )}

          <View pointerEvents="none" style={styles.border} />
        </View>
      </Animated.View>
    </View>
  );
}

// ── Tab ────────────────────────────────────────────────────────────────

interface TabProps {
  index: number;
  label: string;
  icon: IconName;
  selected: boolean;
  soon: boolean;
  hitX: number;
  hitW: number;
  labelW: number;
  geo: SharedValue<number[]>;
  vis: SharedValue<number[]>;
  onPress: (index: number) => void;
}

/** How much of [from, to] the pill covers, 0…1. */
function covered(from: number, to: number, g: number[]): number {
  'worklet';
  const pillL = g[0];
  const pillR = g[0] + g[1];
  if (to <= from) return 0;
  return Math.min(1, Math.max(0, (Math.min(to, pillR) - Math.max(from, pillL)) / (to - from)));
}

const Tab = memo(function Tab({ index, label, icon, selected, soon, hitX, hitW, labelW, geo, vis, onPress }: TabProps) {
  const press = usePressFeedback({ scale: MOTION.press.scaleSmall, haptic: false });
  const slot = 2 + index;

  const slotStyle = useAnimatedStyle(() => ({ transform: [{ translateX: geo.value[slot] }] }));
  const litStyle = useAnimatedStyle(() => {
    const x = geo.value[slot];
    return { opacity: covered(x, x + ICON, geo.value) };
  });
  const restStyle = useAnimatedStyle(() => {
    const x = geo.value[slot];
    return { opacity: 1 - covered(x, x + ICON, geo.value) };
  });
  // The dark label only shows where the pill is under it.
  const labelStyle = useAnimatedStyle(() => {
    const x = geo.value[slot] + ICON + GAP;
    return { opacity: vis.value[index] * covered(x, x + labelW, geo.value) };
  });

  const contentW = ICON + GAP + labelW;
  // Press feedback shrinks toward what the eye is on: the icon, or the
  // icon and label together on the selected tab.
  const originX = selected ? contentW / 2 : ICON / 2;

  return (
    <>
      {/* What the eye sees. The Pressable below is what a screen reader
          reads — label, "coming soon" and selected state in one stop — so
          the drawn label and badge must not become stops of their own. */}
      <Animated.View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.slot, slotStyle]}
      >
        <Animated.View
          style={[styles.content, { width: contentW, transformOrigin: [originX, ROW_H / 2, 0] }, press.animatedStyle]}
        >
          <View style={styles.icon}>
            <Animated.View style={[StyleSheet.absoluteFill, restStyle]}>
              <NavIcon name={icon} color={W.text2} size={ICON} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, litStyle]}>
              <NavIcon name={icon} color={W.onAccent} size={ICON} />
            </Animated.View>
          </View>
          <Animated.View style={labelStyle}>
            <Txt {...LABEL} numberOfLines={1} style={[LABEL.style, styles.labelInk, { maxWidth: labelW }]}>
              {label}
            </Txt>
          </Animated.View>
        </Animated.View>
        {soon ? <SoonBadge index={index} vis={vis} /> : null}
      </Animated.View>

      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={soon ? `${label}, coming soon` : label}
        accessibilityState={{ selected }}
        accessibilityShowsLargeContentViewer
        accessibilityLargeContentTitle={label}
        onPress={() => onPress(index)}
        onPressIn={press.onPressIn}
        onPressOut={press.onPressOut}
        style={[styles.hit, { left: hitX, width: hitW }]}
      />
    </>
  );
});

/** "Soon" over a tab that isn't open yet; it gives way to the label when the
 *  tab is selected. Its own component, so only that tab pays for the style. */
function SoonBadge({ index, vis }: { index: number; vis: SharedValue<number[]> }) {
  const badgeStyle = useAnimatedStyle(() => ({ opacity: 1 - vis.value[index] }));
  return (
    <Animated.View style={[styles.badgeSlot, badgeStyle]}>
      <View style={styles.badge}>
        <Txt variant="caption" weight={600} maxScale={1.15} style={styles.badgeText}>Soon</Txt>
      </View>
    </Animated.View>
  );
}

export const BottomNav = memo(BottomNavImpl);
BottomNav.displayName = 'BottomNav';

// Shared by the visible labels and the off-screen ones they are sized from.
const LABEL = {
  variant: 'eyebrow',
  weight: 700,
  style: { letterSpacing: 0.8 },
} as const;

const SCROLL_EDGE = [rgba(W.bgDeep, 0), rgba(W.bgDeep, 0.7), rgba(W.bgDeep, 0.92)] as const;
const TOP_LIGHT = [rgba(W.cream, 0), rgba(W.cream, 0.14), rgba(W.cream, 0)] as const;
const GLOSS = [rgba(W.cream, 0.2), rgba(W.cream, 0)] as const;

// The capsule is translucent, so its shadow is drawn around it (boxShadow)
// rather than from its pixels, which iOS would recompute every frame.
const HIGH = ELEV.high;
const CAPSULE_SHADOW =
  `0px ${HIGH.shadowOffset?.height ?? 0}px ${HIGH.shadowRadius ?? 0}px ${rgba(W.shadow, Number(HIGH.shadowOpacity ?? 0))}`;

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: Z.nav },
  measure: { position: 'absolute', left: 0, bottom: 0, opacity: 0, alignItems: 'flex-start' },
  presence: { paddingHorizontal: EDGE },
  scrollEdge: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  capsule: {
    height: CAPSULE_H,
    borderRadius: CAPSULE_H / 2,
    overflow: 'hidden',
    boxShadow: CAPSULE_SHADOW,
  },
  topLight: { position: 'absolute', left: 0, right: 0, top: 0, height: 1 },
  border: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CAPSULE_H / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: W.hairlineStrong,
  },
  // The pill's solid base lets iOS draw the glow from its outline alone.
  pill: {
    position: 'absolute',
    left: INSET,
    top: INSET,
    height: ROW_H,
    borderRadius: ROW_H / 2,
    backgroundColor: W.rose,
    ...ELEV.glow(W.rose, 16, 0.35),
    shadowOffset: { width: 0, height: 6 },
  },
  pillClip: { ...StyleSheet.absoluteFillObject, borderRadius: ROW_H / 2, overflow: 'hidden' },
  gloss: { position: 'absolute', left: 0, right: 0, top: 0, height: ROW_H / 2 },
  slot: { position: 'absolute', left: INSET, top: INSET, height: ROW_H },
  content: { height: ROW_H, flexDirection: 'row', alignItems: 'center', gap: GAP },
  icon: { width: ICON, height: ICON },
  labelInk: { color: W.onAccent },
  badgeSlot: { position: 'absolute', left: ICON - BADGE_W / 2, top: -SP.xs2, width: BADGE_W, alignItems: 'center' },
  badge: {
    paddingHorizontal: SP.xs2,
    borderRadius: R.sm,
    backgroundColor: W.surface3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: W.hairlineStrong,
  },
  badgeText: { color: W.text2 },
  hit: { position: 'absolute', top: 0, bottom: 0 },
});
