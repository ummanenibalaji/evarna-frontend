// Google Sign-In, isolated behind a lazy require.
//
// @react-native-google-signin/google-signin is a native module, so importing it
// at module scope crashes anything that loads before a dev/production build
// exists — including Expo Go, where the rest of the app still runs fine. Same
// pattern as getAudioSession() in hooks/useVoiceCall.ts.

export class GoogleSignInUnavailable extends Error {}

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
  if (mod) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('@react-native-google-signin/google-signin') as GoogleSignInModule;
  } catch {
    throw new GoogleSignInUnavailable(
      'Google sign-in needs a development build — it does not work in Expo Go.',
    );
  }
  if (!configured) {
    if (!WEB_CLIENT_ID) {
      throw new GoogleSignInUnavailable(
        'Google sign-in is not configured on this build (EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is unset).',
      );
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
 * support it — the caller shows that message directly, because "you need a dev
 * build" and "we couldn't sign you in" are different problems and telling a
 * developer the second one wastes their afternoon.
 */
export async function getGoogleIdToken(): Promise<string | null> {
  const { GoogleSignin } = load();

  // Android only; a no-op elsewhere. Without it, a device with an outdated or
  // missing Play Services fails deep inside the native call.
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const res = await GoogleSignin.signIn();
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
