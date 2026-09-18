// Push notifications, isolated behind a lazy require.
//
// expo-notifications is a native module, so importing it at module scope
// crashes anything that loads before a dev/production build exists — including
// Expo Go, where the rest of the app still runs fine. Same pattern as
// lib/googleSignIn.ts. `import type` is erased at compile time, so it costs
// nothing at runtime and we still get the real types.

import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type * as NotificationsModule from 'expo-notifications';
import { withSystemPrompt } from '../components/PrivacyShield';

/** What the backend puts in the notification's `data` so we can open the right chat. */
export interface PushTapData {
  character_id?: string;
  session_id?: string;
}

/** The action identifier the "message" category's Reply box reports back with. */
const REPLY_ACTION = 'reply';

let mod: typeof NotificationsModule | null = null;
let handlerSet = false;
let categorySet = false;
// The companion whose chat is on screen. Its pushes would only repeat what the
// thread is already showing.
let foregroundThread: string | null = null;
// Bumped by every claim. A chat that is leaving is still mounted while the one
// replacing it slides in, and has already been replaced as the owner by the
// time it unmounts, so its release must not clear the newcomer's claim.
let foregroundClaim = 0;

/**
 * While a chat is open, pushes from that companion arrive without a banner or
 * sound. Returns this claim's release, which clears the slot only if no other
 * chat has claimed it since; leaving a chat should call that (or
 * clearForegroundThread) rather than pass null. Null still clears the slot
 * outright, whoever holds it.
 */
export function setForegroundThread(characterId: string | null): () => void {
  const claim = ++foregroundClaim;
  foregroundThread = characterId;
  return () => {
    if (foregroundClaim === claim) foregroundThread = null;
  };
}

/** Leaving `characterId`'s chat: clears the slot only while it is still that chat's. */
export function clearForegroundThread(characterId: string): void {
  if (foregroundThread === characterId) foregroundThread = null;
}

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
      handleNotification: async n => {
        const data = (n.request.content.data ?? {}) as PushTapData;
        const show = !foregroundThread || data.character_id !== foregroundThread;
        return { shouldShowBanner: show, shouldShowList: show, shouldPlaySound: show, shouldSetBadge: false };
      },
    });
    handlerSet = true;
    registerMessageCategory();
  }
  return mod;
}

/**
 * Registers the "message" category the backend tags its pushes with — that is
 * what puts a Reply box in the notification shade. Called from load(), so it is
 * in place before the first notification can arrive; the flag makes repeat
 * calls free.
 */
export function registerMessageCategory(): void {
  const N = load();
  if (!N || categorySet) return;
  categorySet = true;
  N.setNotificationCategoryAsync('message', [
    {
      identifier: REPLY_ACTION,
      buttonTitle: 'Reply',
      textInput: { submitButtonTitle: 'Send', placeholder: 'Message' },
      // Without this the reply button foregrounds the app, which defeats the
      // entire point — the value of replying from the shade is not opening the
      // app. The send happens in the background handler either way.
      options: { opensAppToForeground: false },
    },
  ]).catch(() => { categorySet = false; });
}

/**
 * Immediate local notification telling the user a reply they typed never left
 * the device. Deliberately plain — they typed into a shade, not into the app.
 * `code` is the refusal code when the server declined it: a limit is not
 * something trying again will fix, so it must not say so. 'DELIVERY_UNKNOWN'
 * (no answer before the app stopped waiting) may well have been delivered:
 * the server finishes a turn after the app leaves and pushes the reply, so
 * that one must not say "not sent".
 */
export function notifyReplyFailed(code?: string): void {
  const N = load();
  if (!N) return;
  if (code === 'DELIVERY_UNKNOWN') {
    N.scheduleNotificationAsync({
      content: { title: 'Message not confirmed', body: 'It may still have gone through. Open Evarna to check.' },
      trigger: null,
    }).catch(() => {});
    return;
  }
  const body = code === 'DAILY_MESSAGE_CAP'
    ? "You've reached today's message limit."
    : code === 'USAGE_LIMIT_REACHED'
      ? "You've reached a messaging limit for now."
      : "Couldn't send that. Open Evarna to try again.";
  N.scheduleNotificationAsync({
    content: { title: 'Message not sent', body },
    trigger: null,
  }).catch(() => {});
}

// Replies typed into the shade that never reached the server, by companion, so
// the chat can offer the text back instead of losing it.
const UNSENT_KEY = 'evarna_unsent_replies_v1';
const UNSENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type UnsentReplies = Record<string, { text: string; at: number }>;

async function readUnsent(): Promise<UnsentReplies> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(UNSENT_KEY)) ?? '{}') as UnsentReplies | null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** Keep a reply that failed to send from the notification shade. A newer one for the same companion replaces it. */
export async function saveUnsentReply(characterId: string, text: string): Promise<void> {
  if (!characterId || !text.trim()) return;
  const all = await readUnsent();
  all[characterId] = { text, at: Date.now() };
  await AsyncStorage.setItem(UNSENT_KEY, JSON.stringify(all)).catch(() => {});
}

/**
 * The unsent reply for this companion, removed as it is read, so it becomes the
 * chat's draft exactly once. Older than a week is dropped rather than offered.
 */
export async function takeUnsentReply(characterId: string): Promise<string | null> {
  const all = await readUnsent();
  const entry = all[characterId];
  if (!entry) return null;
  const now = Date.now();
  const fresh = (e: { at: number }) => now - e.at <= UNSENT_TTL_MS;
  const kept = Object.fromEntries(Object.entries(all).filter(([id, e]) => id !== characterId && fresh(e)));
  await AsyncStorage.setItem(UNSENT_KEY, JSON.stringify(kept)).catch(() => {});
  return fresh(entry) && typeof entry.text === 'string' ? entry.text : null;
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
    // The screen explaining why stays visible behind that sheet.
    const status = existing.granted ? existing : await withSystemPrompt(() => N.requestPermissionsAsync());
    return await tokenIfGranted(N, status.granted);
  } catch {
    return null;
  }
}

/**
 * What notifications can do right now, without prompting.
 * 'denied' means only the system Settings app can change it (iOS after one
 * refusal, Android once it stops asking); an Android refusal that can still be
 * asked again counts as 'undetermined'. A build without the module is 'denied':
 * nothing would arrive.
 */
export async function getPushPermissionStatus(): Promise<'granted' | 'denied' | 'undetermined'> {
  const N = load();
  if (!N) return 'denied';
  try {
    const p = await N.getPermissionsAsync();
    if (p.granted) return 'granted';
    return p.status === 'denied' && !p.canAskAgain ? 'denied' : 'undetermined';
  } catch {
    return 'undetermined';
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
    // Everything that isn't the Reply box — the plain tap and any future
    // action — still means "open the chat".
    if (r.actionIdentifier === REPLY_ACTION) return;
    cb((r.notification.request.content.data ?? {}) as PushTapData);
  });
  return () => sub.remove();
}

/**
 * A push that arrived while the app was in the foreground, so an open chat can
 * refetch and show the message in place. Returns an unsubscribe.
 */
export function addPushReceivedListener(cb: (data: PushTapData) => void): () => void {
  const N = load();
  if (!N) return () => {};
  const sub = N.addNotificationReceivedListener(n => {
    cb((n.request.content.data ?? {}) as PushTapData);
  });
  return () => sub.remove();
}

/**
 * Text typed into the notification's Reply box. Separate from the tap listener
 * so the navigation path never has to know this exists. Returns an unsubscribe.
 */
export function addPushReplyListener(cb: (text: string, data: PushTapData) => void): () => void {
  const N = load();
  if (!N) return () => {};
  const sub = N.addNotificationResponseReceivedListener(r => {
    if (r.actionIdentifier !== REPLY_ACTION) return;
    // This runs outside the app's lifecycle — a throw here has no owner.
    try {
      cb(r.userText ?? '', (r.notification.request.content.data ?? {}) as PushTapData);
    } catch (e) {
      console.warn('[Push] reply handler threw:', e);
    }
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
    // A cold start caused by an inline reply must not open the chat as well —
    // addPushReplyListener already got the same response and sent the text.
    if (r.actionIdentifier === REPLY_ACTION) return null;
    return (r.notification.request.content.data ?? {}) as PushTapData;
  } catch {
    return null;
  }
}
