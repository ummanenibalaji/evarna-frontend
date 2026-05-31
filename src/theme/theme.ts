// theme.ts — Whisper design tokens.
// Design system: "Obsidian Glass" — deep neutral surfaces, restrained purple
// brand accent, frosted glass as primary container, refined typography.

export const W = {
  // ── Surfaces ─────────────────────────────────────────────────────────
  // Deeper, more neutral base. Less purple cast, more "luxury obsidian".
  bg: '#08090D',
  bgSoft: '#0E1018',
  surface1: '#13151E',         // base glass surface (behind blur)
  surface2: '#1B1E2A',         // raised glass surface
  surface3: '#262A38',          // input / pill fills
  hairline: 'rgba(255,255,255,0.06)',   // borders between surfaces
  hairlineStrong: 'rgba(255,255,255,0.10)',

  // ── Brand ────────────────────────────────────────────────────────────
  // Slightly desaturated, more refined purple. Used sparingly now.
  primary: '#8B82FF',           // primary brand — restrained
  primaryDim: 'rgba(139,130,255,0.12)',
  primaryGlow: 'rgba(139,130,255,0.40)',
  secondary: '#B8AEFF',         // softer purple tint
  accent: '#5EEAD4',            // teal — reserved for "highlights & memory"
  accentDim: 'rgba(94,234,212,0.12)',
  cream: '#F5F3EE',             // warm-white premium text accent

  // ── Text — refined neutrals ──────────────────────────────────────────
  text: '#ECECF0',              // primary, slightly warmer than #F0F0F5
  text2: '#8E92A4',             // secondary
  text3: 'rgba(142,146,164,0.55)', // tertiary / disabled
  textMuted: '#5C5F70',         // very subtle metadata

  // ── Status ───────────────────────────────────────────────────────────
  danger: '#F87171',

  // ── Archetype accents ────────────────────────────────────────────────
  mentor: '#7FA9FF',
  friend: '#5EE2A8',
  partner: '#FB9DA8',
  challenger: '#FBC960',

  // ── Fonts ────────────────────────────────────────────────────────────
  fontComp: 'Manrope',
  fontUser: 'Outfit',
  fontMono: 'JetBrainsMono',
} as const;

// Specific weighted font families.
export const fonts = {
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

export type FontFamily = 'comp' | 'user';
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
