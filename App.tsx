// App.tsx (root) — loads the Bricolage Grotesque + Manrope + Outfit font faces
// used by the Txt component, then renders the navigation router inside the
// gesture, safe-area and error-recovery shells, with the app-switcher privacy
// cover on top.
//
// Launch is kept short: what this phone knows is read from storage while the
// JS loads and the fonts register (navigation/launch.ts), LiveKit and WebRTC
// are only set up when the first call starts (hooks/useVoiceCall.ts), and the
// native launch screen stays up until the first real screen has been drawn,
// then fades straight onto it.

// MUST be first: installs DOMException + other shims Hermes lacks, before any
// other module (e.g. livekit-client) loads and references them.
import './src/polyfills';
// Next: importing it starts reading the saved session and data (launch.ts).
import { revealApp } from './src/navigation/launch';

import * as Sentry from '@sentry/react-native';

// Crash reporting: JS errors, unhandled rejections, native crashes, and render
// errors caught by the ErrorBoundary below (Sentry.wrap itself only adds
// profiling and touch breadcrumbs). Nothing is sent without a DSN. No PII: a
// crash report must never carry what someone said to their companion.
//
// ponytail: stack traces from release builds stay minified until source maps
// are uploaded. The Sentry Expo plugin adds that upload step during prebuild,
// which this project does not run (ios/ and android/ are committed), so the
// Xcode build phase and sentry.gradle have to be added by hand. See the note in
// .env.example.
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: !!SENTRY_DSN,
  environment: __DEV__ ? 'development' : 'production',
  sendDefaultPii: false,
});

import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
// One file per face, from each face's own entry: the package index would also
// bundle every weight the app never uses. These are exactly the faces
// theme.ts's `fonts` table (resolveFont) can hand out.
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_600SemiBold } from '@expo-google-fonts/manrope/600SemiBold';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Outfit_400Regular } from '@expo-google-fonts/outfit/400Regular';
import { Outfit_500Medium } from '@expo-google-fonts/outfit/500Medium';
import { Outfit_600SemiBold } from '@expo-google-fonts/outfit/600SemiBold';
import { Outfit_700Bold } from '@expo-google-fonts/outfit/700Bold';
import { BricolageGrotesque_500Medium } from '@expo-google-fonts/bricolage-grotesque/500Medium';
import { BricolageGrotesque_600SemiBold } from '@expo-google-fonts/bricolage-grotesque/600SemiBold';
import { BricolageGrotesque_700Bold } from '@expo-google-fonts/bricolage-grotesque/700Bold';
import Router from './src/navigation/App';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { PrivacyShield } from './src/components/PrivacyShield';
import { MOTION, W } from './src/theme/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});
// The launch screen shares W.bg, so fading it out reads as the UI surfacing
// rather than a cut.
SplashScreen.setOptions({ duration: MOTION.duration.base, fade: true });

const FONTS = {
  Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
  Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold,
  BricolageGrotesque_500Medium, BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold,
};

// Started as the module loads rather than after the first render. Resolves to
// the load error, if any; the app carries on with the system font.
const fontsLoading: Promise<Error | null> = Font.loadAsync(FONTS).then(
  () => null,
  (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
);
const fontsAlreadyIn = () => Object.keys(FONTS).every(name => Font.isLoaded(name));

/** The router reveals the app when its first screen is drawn. This is only
 *  the backstop, counted from the first render, e.g. for a first render that
 *  crashed into the error screen. */
const SPLASH_BACKSTOP_MS = 3000;

function App() {
  // Text measured before its face is registered keeps the system font's
  // metrics, so nothing is drawn until the faces are in. The native launch
  // screen covers the wait.
  const [ready, setReady] = useState(fontsAlreadyIn);

  useEffect(() => {
    let alive = true;
    void fontsLoading.then(error => {
      // A failed load must not strand the user on the splash: carry on with
      // the system font and report why the brand faces are missing.
      if (error) Sentry.captureException(error);
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const backstop = setTimeout(revealApp, SPLASH_BACKSTOP_MS);
    return () => clearTimeout(backstop);
  }, [ready]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {ready && (
          <>
            <View style={styles.root}>
              <ErrorBoundary>
                <Router />
              </ErrorBoundary>
            </View>
            <PrivacyShield />
          </>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// The root paints the brand background, so nothing lighter shows while the
// fonts load or between splash and first frame.
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: W.bg },
});

export default Sentry.wrap(App);
