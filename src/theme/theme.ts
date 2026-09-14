// theme.ts — Evarna design tokens.
// Design system: "Ember Dusk" — warm obsidian surfaces, coral → rose → violet
// aurora gradients, gold reserved for memory and streaks. Bricolage Grotesque
// display type over the existing Manrope (companion voice) / Outfit (UI) pair.

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
  hairline: 'rgba(255,255,255,0.07)',
  hairlineStrong: 'rgba(255,255,255,0.10)',

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
  accent: '#FFC960',            // memory/streak highlight (was teal)
  accentDim: 'rgba(255,201,96,0.10)',
  cream: '#F4EDEA',             // warm-white premium text accent

  // ── Text — warm neutrals ─────────────────────────────────────────────
  text: '#EDE4E7',
  text2: '#A2939A',
  text3: '#8A7B81',
  textMuted: '#6E6067',

  // ── Status ───────────────────────────────────────────────────────────
  danger: '#E23B4E',
  dangerSoft: '#FF7A6B',
  success: '#5EE2A8',

  // ── Archetype accents ────────────────────────────────────────────────
  mentor: '#7FA9FF',
  friend: '#5EE2A8',
  partner: '#FF8A9B',
  challenger: '#FFC960',

  // ── Fonts ────────────────────────────────────────────────────────────
  fontDisplay: 'BricolageGrotesque',
  fontComp: 'Manrope',
  fontUser: 'Outfit',
  fontMono: 'JetBrainsMono',
} as const;

// ── Gradients ──────────────────────────────────────────────────────────
// Tuples typed as such so expo-linear-gradient's `colors` prop accepts them.
export const GRAD = {
  /** Page backdrop, top → bottom. */
  page: [W.bg, W.bgSoft, W.bgDeep] as const,
  /** The signature aurora — coral → rose → violet. CTAs, active nav, orb ring. */
  aurora: ['#FF9A7C', '#FF5E7A', '#8B82FF'] as const,
  /** Two-stop aurora for smaller surfaces. */
  auroraShort: ['#FF9A7C', '#FF5E7A'] as const,
  /** Hairline that fades in from both edges — card tops, header underlines. */
  auroraLine: ['transparent', '#FF9A7C', '#FF5E7A', '#8B82FF', 'transparent'] as const,
  /** End-call button. */
  danger: ['#FF7A6B', '#E23B4E'] as const,
  /** User chat bubble. */
  userBubble: ['rgba(64,46,52,0.85)', 'rgba(50,36,44,0.85)'] as const,
} as const;

// ── "Dawn" light theme ─────────────────────────────────────────────────
// The light counterpart from the design doc (screen 1e). Not wired to a
// runtime switch yet — kept here so a theme toggle only has to swap maps.
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

  fontDisplay: 'BricolageGrotesque',
  fontComp: 'Manrope',
  fontUser: 'Outfit',
  fontMono: 'JetBrainsMono',
} as const;

// Specific weighted font families.
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

// ── Spacing scale (use these instead of magic numbers) ─────────────────
export const SP = {
  xs: 4, sm: 8, md: 12, base: 16, lg: 20, xl: 24, xxl: 32, xxxl: 48,
} as const;

// ── Radius scale ───────────────────────────────────────────────────────
export const R = {
  sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, pill: 999,
} as const;

export const PHONE = { w: 390, h: 844 } as const;

// ── Color helpers ──────────────────────────────────────────────────────
export function withAlphaByte(hex: string, byte: number): string {
  const clamped = Math.max(0, Math.min(255, Math.round(byte)));
  return `${hex}${clamped.toString(16).padStart(2, '0')}`;
}
export function alpha(hex: string, suffix: string): string {
  return `${hex}${suffix}`;
}
export function hexWithOpacity(hex: string, opacity: number): string {
  return withAlphaByte(hex, opacity * 255);
}
/** `rgba()` string from a #RRGGBB hex — for tints where the alpha suffix form
 *  isn't usable (gradient stops that must interpolate to transparent). */
export function rgba(hex: string, opacity: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${opacity})`;
}
