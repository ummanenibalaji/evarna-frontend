// App.tsx (root) — loads the Bricolage Grotesque + Manrope + Outfit font faces
// used by the Txt component, then renders the navigation router inside a
// SafeAreaProvider.

// MUST be first: installs DOMException + other shims Hermes lacks, before any
// other module (e.g. livekit-client) loads and references them.
import './src/polyfills';

import React, { useCallback } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts as useManrope,
  Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
} from '@expo-google-fonts/manrope';
import {
  Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold,
} from '@expo-google-fonts/outfit';
import {
  BricolageGrotesque_500Medium, BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold,
} from '@expo-google-fonts/bricolage-grotesque';
import Router from './src/navigation/App';
import { W } from './src/theme/theme';

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

export default function App() {
  const [fontsLoaded] = useManrope({
    Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold,
    Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold,
    BricolageGrotesque_500Medium, BricolageGrotesque_600SemiBold, BricolageGrotesque_700Bold,
  });

  const onLayout = useCallback(async () => {
    if (fontsLoaded) await SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: W.bg }} onLayout={onLayout}>
        <StatusBar style="light" />
        <Router />
      </View>
    </SafeAreaProvider>
  );
}
