// Push notifications, isolated behind a lazy require.
//
// expo-notifications is a native module, so importing it at module scope
// crashes anything that loads before a dev/production build exists — including
// Expo Go, where the rest of the app still runs fine. Same pattern as
// lib/googleSignIn.ts. `import type` is erased at compile time, so it costs
// nothing at runtime and we still get the real types.

import { Platform } from 'react-native';
import type * as NotificationsModule from 'expo-notifications';

/** What the backend puts in the notification's `data` so we can open the right chat. */
export interface PushTapData {
  character_id?: string;
  session_id?: string;
}

let mod: typeof NotificationsModule | null = null;
let handlerSet = false;

// Returns null instead of throwing: every caller here is fire-and-forget and a
// missing native module must never be louder than "notifications are off".
function load(): typeof NotificationsModule | null {
  if (mod) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('expo-notifications') as typeof NotificationsModule;
  } catch {
    return null;
  }
  if (!handlerSet) {
    // Without this, a notification arriving while the app is foregrounded is
    // delivered silently and the user never sees the companion reach out.
    mod.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    handlerSet = true;
  }
  return mod;
}

/** The device's IANA zone. The backend needs it for quiet hours (22:00–08:00 local). */
export function getDeviceTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// Shared tail of both entry points: a granted status still has to survive an
// emulator, a missing EAS projectId, and Expo's token server being unreachable.
async function tokenIfGranted(N: typeof NotificationsModule, granted: boolean): Promise<string | null> {
  if (!granted) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Device = require('expo-device') as { isDevice: boolean };
    // ponytail: iOS simulators genuinely cannot get a push token, so bail before
    // the native call turns that into a scary-looking error.
    if (!Device.isDevice) return null;
    if (Platform.OS === 'android') {
      // Android 8+ drops notifications that belong to no channel.
      await N.setNotificationChannelAsync('default', {
        name: 'Check-ins',
        importance: N.AndroidImportance.DEFAULT,
      });
    }
    // projectId comes from app config once `eas init` has run; when it is absent
    // the module infers it, and if it can't, the catch below turns that into null.
    const constants = require('expo-constants') as
      { default?: { expoConfig?: { extra?: { eas?: { projectId?: string } } } } };
    const projectId = constants.default?.expoConfig?.extra?.eas?.projectId;
    const { data } = await N.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Asks for permission and returns the Expo push token, or null if the user
 * declined or this build/device can't have one. Never throws.
 */
export async function requestPushPermission(): Promise<string | null> {
  const N = load();
  if (!N) return null;
  try {
    const existing = await N.getPermissionsAsync();
    // iOS only ever shows the system sheet once; asking again just re-reads it.
    const status = existing.granted ? existing : await N.requestPermissionsAsync();
    return await tokenIfGranted(N, status.granted);
  } catch {
    return null;
  }
}

/**
 * Token for an already-granted permission, without prompting. Used on launch —
 * the ask itself belongs to S25, not to the boot sequence.
 */
export async function getPushTokenIfGranted(): Promise<string | null> {
  const N = load();
  if (!N) return null;
  try {
    return await tokenIfGranted(N, (await N.getPermissionsAsync()).granted);
  } catch {
    return null;
  }
}

/** Tap while the app was running/backgrounded. Returns an unsubscribe. */
export function addPushTapListener(cb: (data: PushTapData) => void): () => void {
  const N = load();
  if (!N) return () => {};
  const sub = N.addNotificationResponseReceivedListener(r => {
    cb((r.notification.request.content.data ?? {}) as PushTapData);
  });
  return () => sub.remove();
}

/** The tap that cold-started the app, if any. Null on a normal launch. */
export async function getInitialPushTap(): Promise<PushTapData | null> {
  const N = load();
  if (!N) return null;
  try {
    // ponytail: the async form is marked deprecated in favour of the sync
    // getLastNotificationResponse(), but on a cold start the native side may not
    // have the response yet when boot runs. Switch once that race is gone.
    const r = await N.getLastNotificationResponseAsync();
    if (!r) return null;
    // The OS keeps the last response until it's cleared, so without this a plain
    // launch days later would re-open that same chat out of nowhere.
    await N.clearLastNotificationResponseAsync().catch(() => {});
    return (r.notification.request.content.data ?? {}) as PushTapData;
  } catch {
    return null;
  }
}
