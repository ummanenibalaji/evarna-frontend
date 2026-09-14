// Keeps a voice call's microphone alive with the screen locked, on Android.
// The native side is modules/call-service. In Expo Go, on iOS and on web the
// module is absent and these calls do nothing; iOS keeps call audio alive
// through the "audio" background mode instead.
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';

type CallServiceModule = { start(title: string, text: string): void; stop(): void };

const native = Platform.OS === 'android'
  ? requireOptionalNativeModule<CallServiceModule>('CallService')
  : null;

export function startCallService(companionName: string): void {
  try {
    native?.start(`On a call with ${companionName}`, 'Tap to return to the call.');
  } catch {
    // The call still works while the app is open.
  }
}

export function stopCallService(): void {
  try {
    native?.stop();
  } catch {
    // Not running.
  }
}
