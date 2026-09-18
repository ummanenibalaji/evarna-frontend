// Google Sign-In, isolated behind a lazy require.
//
// @react-native-google-signin/google-signin is a native module, so importing it
// at module scope crashes anything that loads before a dev/production build
// exists — including Expo Go, where the rest of the app still runs fine. Same
// pattern as getAudioSession() in hooks/useVoiceCall.ts.

import { withSystemPrompt } from '../components/PrivacyShield';

/**
 * This build cannot do Google sign-in at all. The message is written for the
 * person holding the phone; the reason, which only a developer can act on, goes
 * to the console.
 */
export class GoogleSignInUnavailable extends Error {
  constructor(readonly detail: string) {
    super("Google sign-in isn't available in this build.");
    this.name = 'GoogleSignInUnavailable';
  }
}

function unavailable(detail: string): GoogleSignInUnavailable {
  console.warn(`[GoogleSignIn] ${detail}`);
  return new GoogleSignInUnavailable(detail);
}

// The web client id is not a mistake and not optional. The library exchanges
// the native sign-in for an ID token whose audience is the WEB client, and the
// backend verifies that audience. Configuring only the iOS/Android ids yields a
// token the server rejects, which is the single most common way this fails.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

interface GoogleSignInModule {
  GoogleSignin: {
    configure: (o: Record<string, unknown>) => void;
    hasPlayServices: (o?: Record<string, unknown>) => Promise<boolean>;
    signIn: () => Promise<{ data?: { idToken?: string | null } | null; idToken?: string | null }>;
    signOut: () => Promise<void>;
  };
}

let mod: GoogleSignInModule | null = null;
let configured = false;

function load(): GoogleSignInModule {
  if (!mod) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
    } catch {
      throw unavailable('The native module is missing. Google sign-in needs a development build; it does not work in Expo Go.');
    }
  }
  // Checked on every call, not only the first: a cached module is not a
  // configured one.
  if (!configured) {
    if (!WEB_CLIENT_ID) {
      throw unavailable('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is unset, so the ID token would have the wrong audience.');
    }
    mod.GoogleSignin.configure({
      webClientId: WEB_CLIENT_ID,
      ...(IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}),
      // We only ever want identity. Asking for more would put the consent
      // screen into a verification review we have no reason to sit through.
      scopes: ['openid', 'email', 'profile'],
    });
    configured = true;
  }
  return mod;
}

/**
 * Returns a Google ID token, or null if the user cancelled.
 *
 * Throws GoogleSignInUnavailable when the build or the configuration cannot
 * support it. The caller shows its message directly: "not available in this
 * build" and "we couldn't sign you in" are different problems, and the console
 * warning carries the reason for whoever made the build.
 */
export async function getGoogleIdToken(): Promise<string | null> {
  const { GoogleSignin } = load();

  // Android only; a no-op elsewhere. Without it, a device with an outdated or
  // missing Play Services fails deep inside the native call.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  // iOS asks "Evarna wants to use google.com to sign in" and then shows
  // Google's sheet; the sign-in screen stays visible behind both.
  const res = await withSystemPrompt(() => GoogleSignin.signIn());
  // v13+ returns { data: { idToken } }; older versions returned idToken at the
  // top level. Accept both so a minor bump does not silently break sign-in.
  return res?.data?.idToken ?? res?.idToken ?? null;
}

/** Clears the native session so the account picker appears again next time. */
export async function googleSignOut(): Promise<void> {
  try {
    await load().GoogleSignin.signOut();
  } catch {
    // Never block our own sign-out on Google's. If the native session lingers,
    // the worst case is the picker pre-selecting an account.
  }
}
