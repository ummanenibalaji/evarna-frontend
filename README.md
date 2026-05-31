# Whisper — React Native (Expo) port

A faithful, pixel-for-pixel port of the **Whisper** AI-companion prototype from
the original HTML/CSS/JSX handoff into **React Native + Expo (TypeScript)**.

Built on **Expo SDK 54** (React Native 0.81, React 19.1), so it runs in the
current Expo Go app from the App Store / Play Store.

All 30 screens (onboarding, home, chat, voice call, Studio, Sandbox, settings,
paywall, crisis-safety, recap, login, etc.) have been recreated to match the
prototype's visual design and interaction flow.

---

## Requirements

- **Node.js** 20 or newer (Expo SDK 54 requirement)
- **npm** (bundled with Node) — or yarn/pnpm if you prefer
- The **Expo Go** app (SDK 54) on a physical iOS/Android device, *or* an iOS
  Simulator / Android Emulator

## Setup

```bash
# 1. install dependencies
npm install

# 2. (recommended) let Expo lock every dependency to the exact SDK 54 pin
npx expo install --fix

# 3. start the dev server
npx expo start
```

Then:

- **Physical device:** scan the QR code shown in the terminal with the Expo Go
  app (Android) or the Camera app (iOS).
- **iOS Simulator:** press `i` in the terminal.
- **Android Emulator:** press `a` in the terminal.

> **First launch** downloads the Manrope and Outfit Google Fonts and may take a
> few extra seconds before the UI appears.
>
> **Expo Go version:** this project targets SDK 54, which matches the current
> Expo Go in the stores. If you ever see an "incompatible SDK" message, run
> `npx expo install expo@latest && npx expo install --fix` to move to the SDK
> your Expo Go expects.
>
> **iOS-first visuals:** the heavy frosted-glass blur (`expo-blur`) renders
> fully on iOS. On Android, blur support is more limited in SDK 54, so a few
> translucent panels fall back to a solid tint — layout and colors are
> unaffected.

---

## Configuration / prototype "tweaks"

The original prototype had a floating dev panel ("Tweaks") for toggling app
state. That panel has been removed from the product UI and its values are now a
plain config file:

```
src/data/config.ts  →  CONFIG
```

Edit `CONFIG` to change the starting state, then reload the app. Available
fields (defaults match the prototype's saved tweaks):

| field               | values                          | effect                                   |
|---------------------|---------------------------------|------------------------------------------|
| `tier`              | `free` / `plus` / `premium`     | which companions & limits are shown      |
| `userName`          | string                          | the signed-in user's name                |
| `companionName`     | string                          | default new-companion name               |
| `sandboxComingSoon` | `true` / `false`                | show the Sandbox "coming soon" overlay   |
| `orbHue`            | hex color                       | accent color of the voice orb            |
| `showFirstChat`     | `true` / `false`                | start in onboarding (`true`) vs home     |
| `capHit`            | `true` / `false`                | simulate a free-tier daily cap           |
| `minutesRemaining`  | `normal` / `low` / `zero`       | voice-minute state                       |

To jump straight to any screen during development, change the initial value of
`screen` in `src/navigation/App.tsx` (the router uses the same string screen
names as the prototype, e.g. `'home'`, `'chat'`, `'paywall'`, `'crisis'`).

---

## Project structure

```
App.tsx                     root: loads fonts, SafeAreaProvider, renders router
app.json                    Expo app config (dark UI, bundle id, icons)
assets/                     app icon / splash / favicon (placeholder brand art)
src/
  navigation/
    App.tsx                 the router — string-based go(screen) + tab state
    types.ts                ScreenName union, Go type, shared nav types
  data/
    config.ts               CONFIG + all static data (companions, scenarios,
                            sandbox modes, voices, memories, archetype colors)
  theme/
    theme.ts                design tokens (W), font resolution, color helpers
    animations.ts           reusable Animated hooks (breathe, spin, wave, …)
  components/
    Txt.tsx                 typography primitive (maps weight → font face)
    Chrome.tsx              Screen wrapper, StatusBar, HomeIndicator, TopBar
    Orb.tsx                 the voice orb (radial layers + animations)
    Avatar.tsx              companion avatar (waveform / image)
    AmbientBg.tsx           drifting ambient background gradients
    RadialGlow.tsx          CSS radial-gradient → SVG helper
    NavIcon.tsx             all line icons as react-native-svg
    Atoms.tsx               Pill, Button, Card, Toggle, badges, banners, …
    BottomNav.tsx           the 4-tab bottom navigation bar
    ChatBits.tsx            chat bubbles, input, typing dots, voice notes
  screens/
    Onboarding.tsx          S01–S08 + handoff + meet
    Home.tsx                S10 home, S11 add-companion, companion cards
    Chat.tsx                S09 first-chat, S12 voice call, S14 chat
    Studio.tsx              S15–S18 (scenarios, sessions, character creator)
    Sandbox.tsx             S19–S20 (sandbox home + session)
    Settings.tsx            S21 settings, S22 memories, S23 paywall, S24 top-up
    Extras.tsx              S25 notif, S26 edit, S27 minutes, S28 crisis,
                            S29 recap, S30 login
```

---

## Notes on the port

- **Navigation** intentionally replicates the prototype's simple string-based
  `go(screen)` router (rather than React Navigation) so the screen-to-screen
  behavior is identical. Modal sheets (paywall, top-up, no-minutes) render over
  the home screen exactly as in the prototype.
- **Typography:** React Native can't synthesize font weights from a single
  family, so the `Txt` component maps each `(family, weight)` pair to a concrete
  loaded face (e.g. `Manrope_600SemiBold`). Use `<Txt font="comp|user"
  weight={400|500|600|700}>` instead of raw `<Text>`.
- **CSS effects:** radial gradients are drawn with `react-native-svg`,
  `backdrop-filter` blur uses `expo-blur`'s `BlurView`, and the many keyframe
  animations are reproduced with `Animated` hooks in `theme/animations.ts`
  (transform/opacity are animated on the native driver; blur-based keyframes are
  approximated with soft gradients).
- **Full-screen layout:** the simulated iOS status bar (9:41) and home indicator
  are preserved for visual fidelity, but the app renders full-screen using the
  device's real safe-area insets (no scaled "phone in a box").
- **Crisis-safety content** (988 Suicide & Crisis Lifeline, Crisis Text Line) is
  preserved verbatim as informational resources.
- **Assets** in `assets/` are simple placeholder brand art. Replace
  `icon.png`, `splash.png`, `adaptive-icon.png`, and `favicon.png` with final
  artwork before shipping.

## Type-checking

```bash
npx tsc --noEmit
```

(Requires `npm install` first so the React / React Native / Expo type
definitions are present.)
