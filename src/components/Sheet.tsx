// Sheet.tsx — bottom sheet rendered in place over the current screen.
//
// Not an RN Modal: it lives in the screen's tree, so it can sit over the real
// screen and animate on the UI thread. Render it as the last child of the
// screen root; VoiceOver then treats it as modal. The panel springs up,
// follows a drag on its handle, and always finishes animating out before it
// unmounts. Under Reduce Motion it only fades.
//
// Wherever it is drawn (inside a Screen's padded body, or a full-window
// Modal), it measures where its host sits in the window: the scrim then
// reaches the window's edges, the panel runs down to the bottom edge, and the
// safe areas are applied once. While it is open the screen's edge swipe back
// is held, so the screen can't be swiped away under it.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  measure,
  ReduceMotion,
  useAnimatedKeyboard,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type WithTimingConfig,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { LinearGradient } from 'expo-linear-gradient';

import { useBlockSwipeBack } from '../navigation/sceneContext';
import { spring, timing, useReducedMotion } from '../theme/motion';
import { GRAD, MOTION, R, rgba, SP, W, Z } from '../theme/theme';
import { Txt } from './Txt';

const D = MOTION.duration;
const GENTLE = MOTION.spring.gentle;
const FILL = StyleSheet.absoluteFillObject;

// The panel runs this far below the screen edge so an upward overdrag, or a
// spring settling, never shows a gap under it.
const SKIRT = 48;
// Release past this distance (or 30% of the panel, if shorter), or flick
// down faster than this, to dismiss.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 900;
// Share of the finger's travel the panel follows where it can't go.
const RESISTANCE = 0.15;
const DISMISS_ACTION = [{ name: 'dismiss', label: 'Close' }];

function fadeConfig(ms: number): WithTimingConfig {
  'worklet';
  // A fade is the calm alternative to movement, so it plays under Reduce Motion.
  return { ...timing(ms), reduceMotion: ReduceMotion.Never };
}

export interface SheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children?: ReactNode;
  /** False: no drag-to-dismiss, scrim tap, escape gesture or back button. Default true. */
  dismissible?: boolean;
  /** Tallest the panel may grow, as a share of the window. Default 0.9. */
  maxHeightPct?: number;
  /** Pinned under the content (the sheet's actions), above the home indicator. */
  footer?: ReactNode;
  /** Names the sheet for VoiceOver when it has no title. */
  accessibilityLabel?: string;
  /** Wrap the content in a ScrollView (default). Pass false when the content scrolls itself. */
  scrollable?: boolean;
  /** The control that opened the sheet. VoiceOver focus goes back to it once
   *  the sheet has closed, so the user keeps their place. */
  returnFocusRef?: RefObject<View | null>;
}

export function Sheet(props: SheetProps) {
  const [mounted, setMounted] = useState(props.visible);
  // Mount in the same render that opens, so the panel starts moving at once.
  if (props.visible && !mounted) setMounted(true);

  const visible = useRef(props.visible);
  visible.current = props.visible;
  const returnFocus = useRef(props.returnFocusRef);
  returnFocus.current = props.returnFocusRef;
  const onExited = useCallback(() => {
    if (visible.current) return;
    setMounted(false);
    // Once the sheet has left the tree, put VoiceOver back where it was.
    setTimeout(() => {
      const target = returnFocus.current?.current;
      if (target && !visible.current) AccessibilityInfo.sendAccessibilityEvent(target, 'focus');
    }, D.instant);
  }, []);

  return mounted ? <SheetBody {...props} onExited={onExited} /> : null;
}

/** State for one sheet: `<Sheet visible={s.visible} onClose={s.close} />`. */
export function useSheet(initiallyVisible = false) {
  const [visible, setVisible] = useState(initiallyVisible);
  const open = useCallback(() => setVisible(true), []);
  const close = useCallback(() => setVisible(false), []);
  return useMemo(() => ({ visible, open, close }), [visible, open, close]);
}

// How far the host's edges sit from the window's edges.
type Gaps = { top: number; bottom: number };
const NO_GAPS: Gaps = { top: 0, bottom: 0 };

function SheetBody({
  visible, onClose, onExited, title, children, dismissible = true, maxHeightPct = 0.9,
  footer, accessibilityLabel, scrollable = true,
}: SheetProps & { onExited: () => void }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  useBlockSwipeBack(visible);

  // A Screen draws its body inside the safe areas already, so the insets
  // this sheet still owes are only the parts its host doesn't cover.
  const [gaps, setGaps] = useState<Gaps>(NO_GAPS);
  const safeBottom = Math.max(insets.bottom, SP.base);
  const cap = Math.min(winH * maxHeightPct, winH - Math.max(insets.top, gaps.top) - SP.md);

  const offset = useSharedValue(winH); // panel translateY; 0 is open
  const shown = useSharedValue(0);     // scrim, and the panel itself under Reduce Motion
  const panelH = useSharedValue(0);
  const dragFrom = useSharedValue(0);
  const panelHeight = useRef(0);
  // Set when the panel's height wasn't readable at mount; its first layout opens it.
  const pendingOpen = useRef(false);
  const exitStarted = useRef(false);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;

  const rootRef = useAnimatedRef<Animated.View>();
  const panelRef = useRef<View>(null);
  const headerRef = useRef<View>(null);
  const label = title ?? accessibilityLabel;

  // Measured on mount (synchronously, before the first frame, under the New
  // Architecture) and when the window changes, but not on later layouts: a
  // host shrinking for the keyboard hasn't moved.
  const hostMeasured = useRef(false);
  const measureHost = useCallback(() => {
    const node = rootRef.current as unknown as View | null;
    node?.measureInWindow((_x, y, _w, h) => {
      if (!h) return;
      hostMeasured.current = true;
      const next = { top: Math.max(0, Math.round(y)), bottom: Math.max(0, Math.round(winH - (y + h))) };
      setGaps(g => (g.top === next.top && g.bottom === next.bottom ? g : next));
    });
  }, [rootRef, winH]);
  useLayoutEffect(measureHost, [measureHost]);
  // Only a fallback for when the synchronous measure had nothing to read.
  const onRootLayout = useCallback(() => {
    if (!hostMeasured.current) measureHost();
  }, [measureHost]);

  // ── Open / close ─────────────────────────────────────────────────────
  const open = useCallback((fromRest: boolean) => {
    exitStarted.current = false;
    shown.value = withTiming(1, fadeConfig(D.base));
    if (reduced) {
      offset.value = 0;
      return;
    }
    if (fromRest) offset.value = panelHeight.current;
    offset.value = withSpring(0, spring('gentle'));
  }, [reduced, offset, shown]);

  // The exit animation's end. A parent that ignored onClose keeps the sheet
  // open, so bring it back rather than strand an invisible scrim.
  const exited = useCallback(() => {
    if (visibleNow.current) open(false);
    else onExited();
  }, [open, onExited]);

  const close = useCallback(() => {
    exitStarted.current = true;
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(exited);
    };
    if (reduced) {
      shown.value = withTiming(0, fadeConfig(D.fast), done);
      return;
    }
    shown.value = withTiming(0, fadeConfig(D.base));
    offset.value = withTiming(panelHeight.current || winH, timing(D.base, 'accel'), done);
  }, [reduced, winH, exited, offset, shown]);

  const focusHeader = useCallback(() => {
    if (headerRef.current && label) AccessibilityInfo.sendAccessibilityEvent(headerRef.current, 'focus');
  }, [label]);

  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  const recordPanelHeight = useCallback((h: number) => {
    panelHeight.current = h;
    panelH.value = h;
  }, [panelH]);

  const openFromRest = useCallback(() => {
    pendingOpen.current = false;
    open(true);
    // Give VoiceOver the new content once it exists.
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(focusHeader, D.fast);
  }, [open, focusHeader]);

  // A layout effect, so the first open reads the panel's height in the same
  // commit that mounted it (measure is synchronous under the New
  // Architecture) and the spring starts on the very next frame, rather than
  // after a round trip for onLayout. If the height isn't known yet,
  // onPanelLayout opens it instead.
  useLayoutEffect(() => {
    if (visible) {
      if (panelHeight.current > 0) {
        open(false);
        return;
      }
      let measured = 0;
      panelRef.current?.measure((_x, _y, _w, h) => { measured = h; });
      if (measured > 0) {
        recordPanelHeight(measured);
        openFromRest();
      } else {
        pendingOpen.current = true;
      }
      return;
    }
    pendingOpen.current = false;
    Keyboard.dismiss();
    // A dismissing drag has already sent the panel on its way.
    if (!exitStarted.current) close();
  }, [visible, open, close, recordPanelHeight, openFromRest]);

  const onPanelLayout = useCallback((e: LayoutChangeEvent) => {
    recordPanelHeight(e.nativeEvent.layout.height);
    if (pendingOpen.current) openFromRest();
  }, [recordPanelHeight, openFromRest]);

  // Android back button.
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (dismissible) onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, dismissible, onClose]);

  // ── Drag ─────────────────────────────────────────────────────────────
  const beginGestureExit = useCallback(() => {
    exitStarted.current = true;
    Keyboard.dismiss();
    onClose();
  }, [onClose]);

  const pan = useMemo(() => {
    const done = (finished?: boolean) => {
      'worklet';
      if (finished) scheduleOnRN(exited);
    };
    return Gesture.Pan()
      .failOffsetX([-24, 24])
      .onStart(() => {
        dragFrom.value = offset.value;
      })
      .onUpdate(e => {
        const y = dragFrom.value + e.translationY;
        offset.value = y < 0 || !dismissible ? y * RESISTANCE : y;
      })
      .onEnd(e => {
        const h = panelH.value;
        const far = offset.value > Math.min(DISMISS_DISTANCE, h * 0.3);
        const dismiss = dismissible && (e.velocityY > DISMISS_VELOCITY || (far && e.velocityY > -DISMISS_VELOCITY / 2));
        if (!dismiss) {
          offset.value = withSpring(0, { ...spring('snappy'), velocity: e.velocityY });
          return;
        }
        scheduleOnRN(beginGestureExit);
        if (reduced) {
          shown.value = withTiming(0, fadeConfig(D.fast), done);
          return;
        }
        shown.value = withTiming(0, fadeConfig(D.base));
        // Carry the finger's speed into the exit.
        offset.value = withSpring(
          h,
          { ...GENTLE, velocity: Math.max(e.velocityY, 0), overshootClamping: true, reduceMotion: ReduceMotion.Never },
          done,
        );
      });
  }, [dismissible, reduced, exited, beginGestureExit, dragFrom, offset, panelH, shown]);

  // ── Keyboard ─────────────────────────────────────────────────────────
  // Lift the panel over the keyboard unless the host already moves this view
  // for it (Screen's KeyboardAvoidingView shrinks it). The host's layout lands
  // a frame or two into the keyboard animation, so compare with the gap seen
  // on the keyboard's first frame, and remember the answer for the way down.
  // The panel's content ends the bottom safe area above the window's bottom
  // edge, which is where the keyboard rises from.
  const keyboard = useAnimatedKeyboard();
  const lift = useSharedValue(0);
  const baseGap = useSharedValue(-1);
  const hostAvoids = useSharedValue(false);

  useAnimatedReaction(
    () => keyboard.height.value,
    kb => {
      if (kb <= 0) {
        baseGap.value = -1;
        lift.value = 0;
        return;
      }
      const m = measure(rootRef);
      if (m) {
        const gap = winH - (m.pageY + m.height);
        if (baseGap.value < 0) baseGap.value = Math.max(0, gap);
        else if (gap - baseGap.value > kb / 2) hostAvoids.value = true;
      }
      lift.value = hostAvoids.value ? 0 : Math.max(0, kb - insets.bottom);
    },
    [winH, insets.bottom],
  );

  // ── Styles ───────────────────────────────────────────────────────────
  const scrimStyle = useAnimatedStyle(() => {
    const h = panelH.value;
    const drag = h > 0 ? interpolate(offset.value, [0, h], [1, 0], Extrapolation.CLAMP) : 1;
    return { opacity: shown.value * drag };
  });

  const panelStyle = useAnimatedStyle(() => ({
    opacity: reduced ? shown.value : 1,
    maxHeight: cap + SKIRT - lift.value,
    transform: [{ translateY: offset.value - lift.value }],
  }));

  const onAccessibilityAction = useCallback((e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'dismiss') onClose();
  }, [onClose]);

  return (
    <Animated.View
      ref={rootRef}
      pointerEvents={visible ? 'box-none' : 'none'}
      accessibilityViewIsModal={visible}
      onAccessibilityEscape={dismissible ? onClose : undefined}
      onLayout={onRootLayout}
      style={styles.root}
    >
      {/* Out to the window's edges: over the status bar band and the home
          indicator band that the host leaves to its parent. */}
      <Animated.View style={[styles.scrim, { top: -gaps.top, bottom: -gaps.bottom }, scrimStyle]}>
        <Pressable
          style={FILL}
          onPress={dismissible ? onClose : undefined}
          accessible={false}
          importantForAccessibility="no"
        />
      </Animated.View>

      <Animated.View
        ref={panelRef}
        onLayout={onPanelLayout}
        style={[styles.panel, { bottom: -(SKIRT + gaps.bottom), paddingBottom: SKIRT + safeBottom }, panelStyle]}
      >
        {/* Opaque: a blur under this 95% gradient could never be seen, and
            it would re-run on every frame of the spring and the drag. */}
        <LinearGradient pointerEvents="none" colors={GRAD.sheet} style={FILL} />

        <GestureDetector gesture={pan}>
          <View
            ref={headerRef}
            accessible={!!label}
            accessibilityRole="header"
            accessibilityLabel={label}
            accessibilityActions={dismissible ? DISMISS_ACTION : undefined}
            onAccessibilityAction={dismissible ? onAccessibilityAction : undefined}
            style={[styles.header, title ? null : styles.headerBare]}
          >
            <View style={styles.grabber} />
            {title ? (
              <Txt variant="title3" numberOfLines={2} style={styles.title}>{title}</Txt>
            ) : null}
          </View>
        </GestureDetector>

        {scrollable ? (
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            alwaysBounceVertical={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.body, styles.bodyContent]}>{children}</View>
        )}

        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { ...FILL, zIndex: Z.sheet, justifyContent: 'flex-end' },
  scrim: { ...FILL, backgroundColor: W.scrim },
  panel: {
    position: 'absolute', left: 0, right: 0, bottom: -SKIRT,
    borderTopLeftRadius: R.sheet, borderTopRightRadius: R.sheet,
    borderWidth: 1, borderColor: W.hairlineStrong,
    backgroundColor: W.surface1,
    overflow: 'hidden',
  },
  // A generous drag target around the grabber.
  header: { paddingTop: SP.sm2, paddingBottom: SP.sm, paddingHorizontal: SP.xl, alignItems: 'center' },
  headerBare: { paddingBottom: SP.md2 },
  grabber: { width: 36, height: 5, borderRadius: R.pill, backgroundColor: rgba(W.text3, 0.5) },
  title: { alignSelf: 'stretch', marginTop: SP.md, color: W.text },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: SP.xl, paddingTop: SP.xs, paddingBottom: SP.base },
  footer: { paddingHorizontal: SP.xl, paddingTop: SP.sm, gap: SP.sm2 },
});
