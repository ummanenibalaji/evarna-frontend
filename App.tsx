// App.tsx (root) — loads the Bricolage Grotesque + Manrope + Outfit font faces
// used by the Txt component, then renders the navigation router inside the
// gesture, safe-area and error-recovery shells, with the app-switcher privacy
// cover on top.

// MUST be first: installs DOMException + other shims Hermes lacks, before any
// other module (e.g. livekit-client) loads and references them.
import './src/polyfills';

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

import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  BricolageGrotesque_500Medium, BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import Router from './src/navigation/App';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { PrivacyShield } from './src/components/PrivacyShield';
import { MOTION, W } from './src/theme/theme';

// Install LiveKit's WebRTC globals once, before any Room is created. The native
// module is absent in Expo Go, where importing it eagerly crashes the whole app
// at launch — so we require it defensively. Text chat then works in Expo Go;
// voice calls still need a dev/production build that includes the module.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('@livekit/react-native').registerGlobals();
} catch {
  // LiveKit native module unavailable (e.g. Expo Go) — voice disabled, chat OK.
}

SplashScreen.preventAutoHideAsync().catch(() => {});
// The launch screen shares W.bg, so fading it out reads as the UI surfacing
// rather than a cut.
SplashScreen.setOptions({ duration: MOTION.duration.base, fade: true });

function App() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
    Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold,
    BricolageGrotesque_500Medium, BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold,
  });
  // A failed load must not strand the user on the splash: carry on with the
  // system font and report why the brand faces are missing.
  const ready = fontsLoaded || fontError != null;

  useEffect(() => {
    if (fontError) Sentry.captureException(fontError);
  }, [fontError]);

  const onLayout = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* Until the fonts are in, the native splash is still covering. */}
        {ready && (
          <>
            <View style={styles.root} onLayout={onLayout}>
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
