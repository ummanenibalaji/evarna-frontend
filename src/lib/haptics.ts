// haptics.ts — the app's haptic vocabulary over expo-haptics.
//
//   selection  tabs, pills, pickers, slider detents
//   light      an ordinary button press
//   medium     send, call connect, mute toggle, start session
//   heavy      end call
//   success    purchase, companion created, memory saved (only when real)
//   warning    low minutes, limit reached
//   error      failed send or connect
//
// Calls are fire-and-forget and never throw: a build without the native
// module, an old Android or a device with system haptics off all do nothing.

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error';

const { ImpactFeedbackStyle: Impact, NotificationFeedbackType: Notify, AndroidHaptics: A } = Haptics;

const IOS: Record<HapticKind, () => Promise<void>> = {
  selection: () => Haptics.selectionAsync(),
  light: () => Haptics.impactAsync(Impact.Light),
  medium: () => Haptics.impactAsync(Impact.Medium),
  heavy: () => Haptics.impactAsync(Impact.Heavy),
  success: () => Haptics.notificationAsync(Notify.Success),
  warning: () => Haptics.notificationAsync(Notify.Warning),
  error: () => Haptics.notificationAsync(Notify.Error),
};

// On Android, view haptic constants follow the system touch-feedback setting
// and need no vibrator. expo-haptics doesn't surface their failures, so only
// constants the running API level has are used (Confirm/Reject arrived in 30).
const API = Platform.OS === 'android' && typeof Platform.Version === 'number' ? Platform.Version : 0;
const ANDROID: Record<HapticKind, Haptics.AndroidHaptics> = {
  selection: A.Clock_Tick,
  light: A.Keyboard_Tap,
  medium: A.Virtual_Key,
  heavy: A.Long_Press,
  success: API >= 30 ? A.Confirm : A.Virtual_Key,
  warning: A.Long_Press,
  error: API >= 30 ? A.Reject : A.Long_Press,
};

function fire(kind: HapticKind): void {
  try {
    const pending = Platform.OS === 'android'
      ? Haptics.performAndroidHapticsAsync(ANDROID[kind])
      : IOS[kind]();
    pending.catch(() => {});
  } catch {
    // Native module missing from this build.
  }
}

export const haptic: Record<HapticKind, () => void> = {
  selection: () => fire('selection'),
  light: () => fire('light'),
  medium: () => fire('medium'),
  heavy: () => fire('heavy'),
  success: () => fire('success'),
  warning: () => fire('warning'),
  error: () => fire('error'),
};
