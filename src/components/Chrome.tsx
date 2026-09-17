// Chrome.tsx — Screen wrapper + TopBar. The real device chrome draws the
// status bar and home indicator; safe-area insets keep content clear of the
// notch and the home bar. Screen also avoids the keyboard so text inputs are
// never hidden. Screens have no entrance of their own: the router animates
// every route change.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Keyboard, KeyboardAvoidingView, Platform, StyleSheet, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientBg } from './AmbientBg';
import { AuroraLine } from './Atoms';
import { Txt } from './Txt';
import { GRAD, HIT, MOTION, SP, W, Z } from '../theme/theme';
import { useReduceTransparency, useScreenReader } from '../hooks/useAccessibilityPrefs';

// Kept as no-op shims so legacy imports (HomeIndicator, StatusBar) don't crash.
export function HomeIndicator(_props: { color?: string }) { return null; }
export function StatusBar(_props: { light?: boolean }) { return null; }

// Android resizes the window for the keyboard itself but can leave the
// bottom inset in place, which opens a gap above the keyboard; collapsing
// the inset while the keyboard is up closes it. iOS needs none of this, so
// it doesn't subscribe and keyboard events never re-render the screen there.
function useAndroidKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const show = Keyboard.addListener('keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return visible;
}

interface ScreenProps {
  children: React.ReactNode;
  /** Optional debug label mirroring the prototype's data-screen-label. Not rendered. */
  label?: string;
  bg?: string;
  statusBarLight?: boolean;
  hideHomeIndicator?: boolean;
  homeIndicatorColor?: string;
  ambient?: boolean;
  ambientIntensity?: number;
  /** Adds the slow centre swell to the ambient backdrop. */
  ambientPulse?: boolean;
  /** Lets the ambient glows drift. Only for screens with no glass on them. */
  ambientDrift?: boolean;
  /** Tab-root screens: the floating tab bar covers the home-indicator area,
   *  so the screen leaves the bottom inset to the bar. Pad scroll content
   *  with `useTabBarHeight()` from BottomNav instead. */
  tabBar?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Disable keyboard avoidance if a screen needs to manage it itself. */
  noKeyboardAvoid?: boolean;
}

export function Screen({
  children,
  bg = W.bg,
  ambient = true,
  ambientIntensity = 1,
  ambientPulse = false,
  ambientDrift = false,
  tabBar = false,
  style,
  noKeyboardAvoid = false,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const androidKeyboard = useAndroidKeyboardVisible();
  const bottom = tabBar || androidKeyboard ? 0 : insets.bottom;

  // The bottom inset sits outside the keyboard avoider, so the avoider's
  // frame already ends above the home bar. Its padding then comes out as
  // keyboard height minus that inset and the content lands flush on the
  // keyboard, animated by the avoider on the keyboard's own curve. For the
  // same reason no vertical offset is needed: the frame it measures already
  // starts below the top inset.
  const body = noKeyboardAvoid ? (
    <View style={styles.body}>{children}</View>
  ) : (
    <KeyboardAvoidingView style={styles.body} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {children}
    </KeyboardAvoidingView>
  );

  return (
    <View style={[styles.screen, { backgroundColor: bg, paddingTop: insets.top, paddingBottom: bottom }, style]}>
      {/* AmbientBg paints the page gradient itself. */}
      {ambient ? (
        <AmbientBg intensity={ambientIntensity} includePulse={ambientPulse} drift={ambientDrift} />
      ) : (
        <LinearGradient colors={[...GRAD.page]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      )}
      {body}
    </View>
  );
}

interface TopBarProps {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  /** Screen title, announced as a heading. Ignored when `center` is given. */
  title?: string;
  /** Ref to the title element, for moving accessibility focus to it. */
  titleRef?: React.Ref<View>;
  /** Moves VoiceOver focus to the title once the screen has arrived. For
   *  pushed screens; tab roots should leave focus on the tab bar. */
  focusTitleOnMount?: boolean;
  /** Minimum height; the bar grows with larger text. */
  height?: number;
  /** Frosted glass bar. */
  glass?: boolean;
  /** Custom fill; any value other than 'transparent' also frosts the bar. */
  bg?: string;
  /** Aurora hairline along the bottom edge. */
  border?: boolean;
}

export function TopBar({
  left, center, right, title, titleRef, focusTitleOnMount = false,
  height = 56, glass = false, bg = 'transparent', border = false,
}: TopBarProps) {
  const reduceTransparency = useReduceTransparency();
  const screenReader = useScreenReader();
  const frosted = glass || bg !== 'transparent';
  const fill = !frosted ? 'transparent' : reduceTransparency ? W.surface1 : glass ? W.glassSoft : bg;

  const ownTitle = useRef<View>(null);
  const showTitle = center == null && !!title;
  useEffect(() => {
    if (!focusTitleOnMount || !screenReader || !showTitle) return;
    // Wait for the route transition, or VoiceOver lands on a moving target.
    const id = setTimeout(() => {
      if (ownTitle.current) AccessibilityInfo.sendAccessibilityEvent(ownTitle.current, 'focus');
    }, MOTION.duration.slow);
    return () => clearTimeout(id);
  }, [focusTitleOnMount, screenReader, showTitle]);

  const setTitleRef = useCallback((node: View | null) => {
    ownTitle.current = node;
    if (typeof titleRef === 'function') titleRef(node);
    else if (titleRef) titleRef.current = node;
  }, [titleRef]);

  return (
    <View style={[styles.bar, { minHeight: height, backgroundColor: fill }]}>
      {frosted && !reduceTransparency && (
        <BlurView pointerEvents="none" intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
      )}
      {border && <AuroraLine height={1} style={styles.edge} />}
      <View style={styles.side}>{left}</View>
      <View style={styles.center}>
        {showTitle ? (
          <View ref={setTitleRef} accessible accessibilityRole="header" accessibilityLabel={title}>
            <Txt variant="headline" numberOfLines={1} style={styles.title}>{title}</Txt>
          </View>
        ) : center}
      </View>
      <View style={[styles.side, styles.sideEnd]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden' },
  body: { flex: 1, minHeight: 0, zIndex: 1 },
  bar: {
    paddingHorizontal: SP.lg,
    paddingVertical: SP.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    zIndex: Z.raised,
  },
  // The same lit edge as a live card, turned down for a header.
  edge: { top: undefined, bottom: 0, opacity: 0.5 },
  side: { minWidth: HIT, flexDirection: 'row', alignItems: 'center' },
  sideEnd: { justifyContent: 'flex-end' },
  center: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  title: { textAlign: 'center' },
});
