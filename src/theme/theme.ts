// theme.ts — Evarna design tokens.
// Design system: "Ember Dusk" — warm obsidian surfaces, coral → rose → violet
// aurora gradients, gold reserved for memory and streaks. Bricolage Grotesque
// display type over Manrope (companion voice) and Outfit (UI).
//
// Colour, spacing, radius, type, elevation, layering and motion all come from
// here. Screens should not introduce their own literals.

import type { ViewStyle } from 'react-native';

export const W = {
  // ── Surfaces ─────────────────────────────────────────────────────────
  // Warm near-black. The page itself is a vertical gradient (see GRAD.page);
  // `bg` is the top stop and the flat fallback.
  bg: '#0E0A0D',
  bgSoft: '#171017',            // mid stop of the page gradient
  bgDeep: '#0C080B',            // bottom stop of the page gradient
  surface1: '#1A1115',          // base surface (behind blur)
  surface2: '#241820',          // raised surface
  surface3: '#2E1F27',          // input / pill fills
  glass: 'rgba(30,21,25,0.55)', // frosted card fill
  glassRaised: 'rgba(28,19,23,0.60)',
  glassSoft: 'rgba(24,16,20,0.50)',
  glassBar: 'rgba(26,17,21,0.80)',   // floating nav / composer
  hairlineFaint: 'rgba(255,255,255,0.05)',
  hairline: 'rgba(255,255,255,0.07)',
  hairlineStrong: 'rgba(255,255,255,0.10)',
  scrim: 'rgba(14,10,13,0.66)', // behind sheets and dialogs (W.bg at 66%)
  shadow: '#000000',

  // ── Brand — the aurora ───────────────────────────────────────────────
  coral: '#FF9A7C',
  rose: '#FF5E7A',
  violet: '#8B82FF',
  gold: '#FFC960',              // memory + streak only

  primary: '#FF8A76',           // primary brand — warm coral
  primaryDim: 'rgba(255,138,118,0.10)',
  primaryGlow: 'rgba(255,138,118,0.40)',
  primarySoft: '#FFB49F',       // coral text on dark
  secondary: '#B8AEFF',         // violet tint — secondary values
  // Alias of gold kept for the screens that already use it for memory and
  // streak highlights. New code should say W.gold.
  accent: '#FFC960',
  accentDim: 'rgba(255,201,96,0.10)',
  cream: '#F4EDEA',             // warm-white premium text accent
  recall: '#B79A6B',            // quiet gold for "recalling your memories…"

  // Label colour for text and icons on solid coral, rose, violet and aurora
  // fills. White fails there (2.1–3.1:1); this reaches
  // 8.35 on primary, 9.28 on coral, 6.51 on rose, 6.15 on violet.
  onAccent: '#140D11',

  // ── Text — warm neutrals ─────────────────────────────────────────────
  // WCAG contrast (bg / surface1 / surface2 / surface3):
  //   text       15.78 / 14.85 / 13.74 / 12.56
  //   text2       8.30 /  7.81 /  7.23 /  6.61
  //   text3       6.31 /  5.94 /  5.49 /  5.02
  //   textMuted   5.17 /  4.86 /  4.50 /  4.11  — not for small text on surface3
  // Lightness steps (L*): 91 / 69 / 61 / 55, so the hierarchy still reads.
  text: '#EDE4E7',
  text2: '#B2A5AB',
  text3: '#9D8E95',
  textMuted: '#907E87',
  placeholder: '#9D8E95',       // text3's value: inputs sit on surface3

  // ── Status ───────────────────────────────────────────────────────────
  // No single red can carry white text (≤ 0.18 luminance) and also read as
  // text on surface1 (≥ 0.21), so fills and text get separate tokens.
  danger: '#E23B4E',            // tints and borders; 4.65 on bg, 4.38 on surface1
  dangerStrong: '#DB3246',      // solid destructive fills with white labels (4.61)
  dangerSoft: '#FF7A6B',        // top stop of GRAD.danger
  dangerText: '#FF6B78',        // errors and the last-minute warning (5.69+ on every surface)
  warning: '#FFA95E',           // caution: low minutes, limits (10.38 on bg)
  success: '#5EE2A8',

  // ── Archetype accents ────────────────────────────────────────────────
  mentor: '#7FA9FF',
  friend: '#42CFC8',            // teal, so it no longer matches success
  partner: '#FF8A9B',
  // Amber-orange rather than gold, so a Challenger badge no longer looks like
  // a memory line. It still equals `warning` because several screens use
  // W.challenger to mean "warning"; once those read W.warning this can move.
  challenger: '#FFA95E',
} as const;

// ── Gradients ──────────────────────────────────────────────────────────
// Tuples typed as such so expo-linear-gradient's `colors` prop accepts them.
export const GRAD = {
  /** Page backdrop, top → bottom. */
  page: [W.bg, W.bgSoft, W.bgDeep] as const,
  /** The signature aurora — coral → rose → violet. CTAs, active nav, orb ring. */
  aurora: [W.coral, W.rose, W.violet] as const,
  /** Two-stop aurora for smaller surfaces. */
  auroraShort: [W.coral, W.rose] as const,
  /** Hairline that fades in from both edges — card tops, header underlines. */
  auroraLine: ['transparent', W.coral, W.rose, W.violet, 'transparent'] as const,
  /** End-call button. */
  danger: [W.dangerSoft, W.danger] as const,
  /** User chat bubble. */
  userBubble: ['rgba(64,46,52,0.85)', 'rgba(50,36,44,0.85)'] as const,
  /** Bottom-sheet panel, top → bottom (over the panel's surface1 base). */
  sheet: ['rgba(48,32,40,0.95)', 'rgba(24,16,20,0.95)'] as const,
} as const;

// ── "Dawn" light theme ─────────────────────────────────────────────────
// The light counterpart from the design doc (screen 1e). Not wired to a
// runtime switch and not at parity with W (no status, overlay or on-accent
// tokens, and its text3/textMuted fail contrast on its own bg), so it needs a
// pass before any theme toggle ships.
export const DAWN = {
  bg: '#FBF5F0',
  bgSoft: '#F7EEE9',
  bgDeep: '#F3E7E2',
  surface1: '#FFFFFF',
  surface2: '#F7EEE9',
  surface3: '#F1E4DE',
  glass: 'rgba(255,255,255,0.78)',
  glassRaised: 'rgba(255,255,255,0.86)',
  glassSoft: 'rgba(255,255,255,0.62)',
  glassBar: 'rgba(255,255,255,0.88)',
  hairline: 'rgba(36,24,32,0.08)',
  hairlineStrong: 'rgba(36,24,32,0.14)',

  coral: '#F98066',
  rose: '#F1465E',
  violet: '#7A6FF0',
  gold: '#E8A33C',

  primary: '#E9503F',
  primaryDim: 'rgba(244,93,78,0.08)',
  primaryGlow: 'rgba(244,93,78,0.30)',
  primarySoft: '#D14B3B',
  secondary: '#7A6FF0',
  accent: '#C07E1B',
  accentDim: 'rgba(232,163,60,0.12)',
  cream: '#241820',

  text: '#241820',
  text2: '#8A7A80',
  text3: '#A8969C',
  textMuted: '#A8969C',

  danger: '#E9503F',
  dangerSoft: '#F98066',
  success: '#2EB57C',

  mentor: '#5E8FE8',
  friend: '#2EB57C',
  partner: '#F1465E',
  challenger: '#D08E22',
} as const;

// ── Fonts ──────────────────────────────────────────────────────────────
// Only these face names are loaded (navigation/App.tsx). Bricolage has no
// 400 face loaded, so display 400 renders as 500.
export const fonts = {
  display: {
    400: 'BricolageGrotesque_500Medium',
    500: 'BricolageGrotesque_500Medium',
    600: 'BricolageGrotesque_600SemiBold',
    700: 'BricolageGrotesque_700Bold',
  },
  comp: {
    400: 'Manrope_400Regular',
    500: 'Manrope_500Medium',
    600: 'Manrope_600SemiBold',
    700: 'Manrope_700Bold',
  },
  user: {
    400: 'Outfit_400Regular',
    500: 'Outfit_500Medium',
    600: 'Outfit_600SemiBold',
    700: 'Outfit_700Bold',
  },
} as const;

export type FontFamily = 'display' | 'comp' | 'user';
export type FontWeightKey = 400 | 500 | 600 | 700;

export function resolveFont(family: FontFamily, weight: FontWeightKey = 400): string {
  return fonts[family][weight];
}

// ── Type scale ─────────────────────────────────────────────────────────
// Sizes are the design sizes at the default text setting; Dynamic Type
// scales them up to `maxScale`. Reading text may grow a lot, chrome a
// little, and display numerals barely, so layouts hold at the largest
// accessibility sizes. 11pt is the floor.
export type TypeVariant =
  | 'hero' | 'title1' | 'title2' | 'title3' | 'headline'
  | 'body' | 'bodyComp' | 'callout' | 'subhead' | 'footnote' | 'caption'
  | 'eyebrow' | 'button' | 'numeral';

export interface TypeStyle {
  font: FontFamily;
  weight: FontWeightKey;
  size: number;
  lineHeight: number;
  letterSpacing?: number;
  uppercase?: boolean;
  /** Use tabular figures so counting numbers don't jitter. */
  tabular?: boolean;
  maxScale: number;
}

export const TYPE: Record<TypeVariant, TypeStyle> = {
  hero:     { font: 'display', weight: 600, size: 33, lineHeight: 38, letterSpacing: -0.8, maxScale: 1.2 },
  title1:   { font: 'display', weight: 600, size: 26, lineHeight: 31, letterSpacing: -0.5, maxScale: 1.3 },
  title2:   { font: 'display', weight: 600, size: 22, lineHeight: 27, letterSpacing: -0.3, maxScale: 1.3 },
  title3:   { font: 'comp',    weight: 600, size: 19, lineHeight: 24, letterSpacing: -0.2, maxScale: 1.35 },
  headline: { font: 'comp',    weight: 600, size: 17, lineHeight: 22, maxScale: 1.4 },
  body:     { font: 'user',    weight: 400, size: 15, lineHeight: 21, maxScale: 1.8 },
  bodyComp: { font: 'comp',    weight: 400, size: 16, lineHeight: 23, maxScale: 1.8 },
  callout:  { font: 'user',    weight: 400, size: 14, lineHeight: 19, maxScale: 1.6 },
  subhead:  { font: 'user',    weight: 400, size: 13, lineHeight: 18, maxScale: 1.5 },
  footnote: { font: 'user',    weight: 400, size: 12, lineHeight: 16, maxScale: 1.5 },
  caption:  { font: 'user',    weight: 400, size: 11, lineHeight: 14, maxScale: 1.35 },
  eyebrow:  { font: 'user',    weight: 600, size: 11, lineHeight: 14, letterSpacing: 1.4, uppercase: true, maxScale: 1.2 },
  button:   { font: 'user',    weight: 600, size: 15, lineHeight: 20, maxScale: 1.3 },
  numeral:  { font: 'display', weight: 700, size: 28, lineHeight: 32, letterSpacing: -0.6, tabular: true, maxScale: 1.15 },
};

// ── Spacing scale (use these instead of magic numbers) ─────────────────
// The `*2` keys are the half-steps between neighbours; dense rows need them.
export const SP = {
  xxs: 2, xs: 4, xs2: 6, sm: 8, sm2: 10, md: 12, md2: 14, base: 16, base2: 18,
  lg: 20, xl: 24, xxl: 32, xxxl: 48,
} as const;

// ── Radius scale ───────────────────────────────────────────────────────
export const R = {
  xxs: 2, xs: 4, sm: 8, sm2: 10, md: 12, md2: 14, lg: 16, lg2: 18, xl: 20, xl2: 22, xxl: 24,
  pill: 999,
  // Roles
  button: 16,
  bubble: 18,
  card: 20,
  sheet: 28,
} as const;

/** Minimum touch target, in points. */
export const HIT = 44;

// ── Elevation ──────────────────────────────────────────────────────────
// iOS shadow props plus the Android elevation that roughly matches. Android
// elevation shadows are always black, so glows use none.
type Elevation = Pick<ViewStyle, 'shadowColor' | 'shadowOpacity' | 'shadowRadius' | 'shadowOffset' | 'elevation'>;

function shadow(y: number, radius: number, opacity: number, elevation: number): Elevation {
  return { shadowColor: W.shadow, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: y }, elevation };
}

export const ELEV = {
  none: { shadowOpacity: 0, elevation: 0 } as Elevation,
  low: shadow(2, 8, 0.25, 2),     // chips, small raised controls
  mid: shadow(8, 18, 0.35, 6),    // cards, floating buttons
  high: shadow(16, 32, 0.45, 12), // sheets, nav bar, dialogs
  glow: (color: string, radius = 16, opacity = 0.45): Elevation => ({
    shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: 0 }, elevation: 0,
  }),
};

// ── Layering ───────────────────────────────────────────────────────────
export const Z = { base: 0, raised: 10, nav: 20, sheet: 30, toast: 40, overlay: 50 } as const;

// ── Motion ─────────────────────────────────────────────────────────────
// Durations in ms. Easings are cubic-bezier control points so both RN
// Animated and Reanimated can build them (see motion.ts). Springs are
// Reanimated withSpring configs; RN Animated.spring accepts the same keys.
export const MOTION = {
  duration: { instant: 90, fast: 160, base: 240, slow: 380, slower: 600, ambient: 4200 },
  easing: {
    standard: [0.2, 0, 0, 1],       // state changes that stay on screen
    decel: [0.22, 1, 0.36, 1],      // things arriving
    accel: [0.32, 0, 0.67, 0],      // things leaving
    emphasized: [0.34, 1.05, 0.64, 1], // hero moments; overshoots slightly
  },
  spring: {
    snappy: { damping: 34, stiffness: 400, mass: 1 }, // ζ≈0.85, settles in ~0.25s
    gentle: { damping: 24, stiffness: 140, mass: 1 }, // critically damped, ~0.4s
    bouncy: { damping: 16, stiffness: 220, mass: 1 }, // ζ≈0.54, ~13% overshoot
  },
  press: { scale: 0.97, scaleSmall: 0.92, scaleSubtle: 0.985 },
} as const;

/** Design frame the layouts were drawn at. Layout must still read from useWindowDimensions. */
export const PHONE = { w: 390, h: 844 } as const;

// ── Color helpers ──────────────────────────────────────────────────────
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `rgba()` string from a #RGB, #RRGGBB or #RRGGBBAA hex at the given opacity
 *  (multiplied into any alpha the hex already has). */
export function rgba(hex: string, opacity: number): string {
  if (!HEX.test(hex)) {
    if (__DEV__) throw new Error(`rgba(): "${hex}" is not a hex colour`);
    return hex;
  }
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  const base = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
  const a = Math.round(Math.max(0, Math.min(1, opacity)) * base * 1000) / 1000;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** @deprecated Use rgba(hex, byte / 255). */
export function withAlphaByte(hex: string, byte: number): string {
  return rgba(hex, Math.max(0, Math.min(255, Math.round(byte))) / 255);
}

/** @deprecated Use rgba(hex, opacity). `suffix` is a two-digit hex alpha. */
export function alpha(hex: string, suffix: string): string {
  if (!/^[0-9a-f]{2}$/i.test(suffix)) {
    if (__DEV__) throw new Error(`alpha(): "${suffix}" is not a two-digit hex alpha`);
    return hex;
  }
  return rgba(hex, parseInt(suffix, 16) / 255);
}

/** @deprecated Use rgba(hex, opacity). */
export function hexWithOpacity(hex: string, opacity: number): string {
  return rgba(hex, opacity);
}
