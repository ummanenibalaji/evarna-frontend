// Chrome.tsx — Screen wrapper + TopBar. The fake iOS status bar and home
// indicator have both been removed — the real device chrome handles these.
// Safe-area insets keep content inside the notch / home-bar zones.
// Screen also wraps in KeyboardAvoidingView so text inputs are never hidden.

import React, { useEffect, useState } from 'react';
import { View, ViewStyle, StyleProp, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AmbientBg } from './AmbientBg';
import { W } from '../theme/theme';

// Kept as a no-op shim so legacy imports (HomeIndicator, StatusBar) don't crash.
export function HomeIndicator(_props: { color?: string }) { return null; }
export function StatusBar(_props: { light?: boolean }) { return null; }

// Track whether the soft keyboard is currently visible (app-wide), plus its height.
function useKeyboard(): { visible: boolean; height: number } {
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, (e) => {
      setVisible(true);
      setHeight(e.endCoordinates?.height ?? 0);
    });
    const h = Keyboard.addListener(hideEvt, () => {
      setVisible(false);
      setHeight(0);
    });
    return () => { s.remove(); h.remove(); };
  }, []);
  return { visible, height };
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
  style?: StyleProp<ViewStyle>;
  /** Disable keyboard avoidance if a screen needs to manage it itself. */
  noKeyboardAvoid?: boolean;
}

export function Screen({
  children,
  bg = W.bg,
  ambient = true,
  ambientIntensity = 1,
  style,
  noKeyboardAvoid = false,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const { visible: kbVisible, height: kbHeight } = useKeyboard();

  if (noKeyboardAvoid) {
    return (
      <View
        style={[
          {
            flex: 1,
            backgroundColor: bg,
            overflow: 'hidden',
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
          style,
        ]}
      >
        {ambient && <AmbientBg intensity={ambientIntensity} />}
        <View style={{ flex: 1, minHeight: 0, zIndex: 1 }}>{children}</View>
      </View>
    );
  }

  // Keyboard handling:
  //  - iOS: KeyboardAvoidingView with `padding` behavior pushes content above the keyboard;
  //    no need to add manual padding ourselves.
  //  - Android: the system auto-resizes the activity when soft input shows (adjustResize),
  //    but Android also typically *includes* the keyboard in the safe-area inset.bottom.
  //    We collapse `insets.bottom` to 0 while the keyboard is visible to remove a stale
  //    gap between the chat input bar and the keyboard top edge.
  const bottomPad = kbVisible ? 0 : insets.bottom;

  return (
    <View
      style={[
        { flex: 1, backgroundColor: bg, overflow: 'hidden', paddingTop: insets.top },
        style,
      ]}
    >
      {ambient && <AmbientBg intensity={ambientIntensity} />}
      <KeyboardAvoidingView
        style={{ flex: 1, zIndex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View style={{ flex: 1, paddingBottom: bottomPad }}>{children}</View>
      </KeyboardAvoidingView>
    </View>
  );
}

interface TopBarProps {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
  height?: number;
  bg?: string;
  border?: boolean;
}

export function TopBar({ left, center, right, height = 56, bg = 'transparent', border = false }: TopBarProps) {
  const isGlass = bg !== 'transparent';
  return (
    <View
      style={{
        height,
        paddingHorizontal: 20,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        backgroundColor: bg,
        overflow: 'hidden',
        zIndex: 2,
      }}
    >
      {isGlass && (
        <BlurView pointerEvents="none" intensity={40} tint="dark" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} />
      )}
      {/* Premium gradient bottom border — fades in from edges */}
      {border && (
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(255,255,255,0)', 'rgba(139,130,255,0.20)', 'rgba(94,234,212,0.16)', 'rgba(139,130,255,0.20)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 }}
        />
      )}
      <View style={{ minWidth: 32, flexDirection: 'row', alignItems: 'center' }}>{left}</View>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' }}>{center}</View>
      <View style={{ minWidth: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' }}>{right}</View>
    </View>
  );
}
