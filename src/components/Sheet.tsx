// Sheet.tsx — bottom sheet rendered in place over the current screen.
//
// Not an RN Modal: it lives in the screen's tree, so it can sit over the real
// screen and animate on the UI thread. Render it as the last child of the
// screen root; VoiceOver then treats it as modal. The panel springs up,
// follows a drag on its handle, and always finishes animating out before it
// unmounts. Under Reduce Motion it only fades.

import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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

import { spring, timing, useReducedMotion } from '../theme/motion';
import { GRAD, MOTION, R, rgba, SP, W, Z } from '../theme/theme';
import { GlassFill } from './Atoms';
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
}

export function Sheet(props: SheetProps) {
  const [mounted, setMounted] = useState(props.visible);
  // Mount in the same render that opens, so the panel starts moving at once.
  if (props.visible && !mounted) setMounted(true);

  const visible = useRef(props.visible);
  visible.current = props.visible;
  const onExited = useCallback(() => {
    if (!visible.current) setMounted(false);
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

function SheetBody({
  visible, onClose, onExited, title, children, dismissible = true, maxHeightPct = 0.9,
  footer, accessibilityLabel, scrollable = true,
}: SheetProps & { onExited: () => void }) {
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height: winH } = useWindowDimensions();
  const [hostH, setHostH] = useState(winH);
  const cap = Math.min(winH * maxHeightPct, hostH - insets.top - SP.md);

  const offset = useSharedValue(winH); // panel translateY; 0 is open
  const shown = useSharedValue(0);     // scrim, and the panel itself under Reduce Motion
  const panelH = useSharedValue(0);
  const dragFrom = useSharedValue(0);
  const panelHeight = useRef(0);
  // Opening waits for the panel's first layout, which may arrive before effects run.
  const pendingOpen = useRef(visible);
  const exitStarted = useRef(false);
  const visibleNow = useRef(visible);
  visibleNow.current = visible;

  const rootRef = useAnimatedRef<Animated.View>();
  const headerRef = useRef<View>(null);
  const label = title ?? accessibilityLabel;

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

  useEffect(() => {
    if (visible) {
      if (panelHeight.current > 0) open(false);
      else pendingOpen.current = true;
      return;
    }
    pendingOpen.current = false;
    Keyboard.dismiss();
    // A dismissing drag has already sent the panel on its way.
    if (!exitStarted.current) close();
  }, [visible, open, close]);

  const focusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  const onPanelLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    panelHeight.current = h;
    panelH.value = h;
    if (!pendingOpen.current) return;
    pendingOpen.current = false;
    open(true);
    // Give VoiceOver the new content once it exists.
    clearTimeout(focusTimer.current);
    focusTimer.current = setTimeout(focusHeader, D.fast);
  }, [open, focusHeader, panelH]);

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
      lift.value = hostAvoids.value ? 0 : Math.max(0, kb - insets.bottom - Math.max(0, baseGap.value));
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
      onLayout={e => setHostH(e.nativeEvent.layout.height)}
      style={styles.root}
    >
      <Animated.View style={[styles.scrim, scrimStyle]}>
        <Pressable
          style={FILL}
          onPress={dismissible ? onClose : undefined}
          accessible={false}
          importantForAccessibility="no"
        />
      </Animated.View>

      <Animated.View
        onLayout={onPanelLayout}
        style={[styles.panel, { paddingBottom: SKIRT + Math.max(insets.bottom, SP.base) }, panelStyle]}
      >
        <GlassFill intensity={40} solid={W.surface1} />
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
