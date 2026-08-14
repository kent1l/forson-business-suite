/**
 * The app's design tokens.
 *
 * Every screen used to hardcode its own hex literals, which is why the older
 * screens are light-mode-only while POS is not: there was no shared place for a
 * colour to live. Everything visual should come from here.
 *
 * The semantic ramps (success / warning / danger / neutral) deliberately mirror
 * `packages/web/src/index.css` so a status colour means the same thing on a
 * phone as it does on the dashboard. Brand primary/accent are admin-configurable
 * on the web side and can be pulled from `GET /api/branding/theme` at runtime --
 * see `useBrandTheme` -- so the values here are the fallback, not the authority.
 */

// Web-only font custom properties referenced by `Fonts.web` below. Inert on
// native, where Metro drops the stylesheet.
import '@/global.css';

import { Platform } from 'react-native';

/** Forson's brand yellow, also the splash background in app.json. */
export const BRAND_YELLOW = '#fbd602';
export const BRAND_INK = '#111827';

/**
 * The colour roles every theme must define.
 *
 * Declared as an explicit shape rather than inferred from the light palette:
 * inference would give each token its own string-literal type, so comparing two
 * colours or swapping in a runtime brand value would be a type error.
 */
export type ThemeColors = {
  background: string;
  surface: string;
  surfaceMuted: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;

  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  primary: string;
  primaryText: string;
  primarySoft: string;

  accent: string;
  accentText: string;

  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;

  overlay: string;
  skeleton: string;
};

export type ThemeName = 'light' | 'dark';

const palette: Record<ThemeName, ThemeColors> = {
  light: {
    // Surfaces, from furthest back to closest to the user.
    background: '#f3f4f6',
    surface: '#ffffff',
    surfaceMuted: '#f9fafb',
    surfaceSunken: '#eef0f3',
    border: '#e5e7eb',
    borderStrong: '#d1d5db',

    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    textInverse: '#ffffff',

    primary: '#2563eb',
    primaryText: '#ffffff',
    primarySoft: '#eff6ff',

    accent: BRAND_YELLOW,
    accentText: BRAND_INK,

    success: '#059669',
    successSoft: '#e6f4ea',
    warning: '#d97706',
    warningSoft: '#fef3c7',
    danger: '#dc2626',
    dangerSoft: '#fef2f2',
    info: '#7c3aed',
    infoSoft: '#ede9fe',

    overlay: 'rgba(0,0,0,0.4)',
    skeleton: '#e5e7eb',
  },
  dark: {
    background: '#0b0f19',
    surface: '#151a26',
    surfaceMuted: '#1c2331',
    surfaceSunken: '#0f1420',
    border: '#2a3242',
    borderStrong: '#3a4356',

    text: '#f8fafc',
    textSecondary: '#cbd5e1',
    textMuted: '#94a3b8',
    textInverse: '#0b0f19',

    primary: '#60a5fa',
    primaryText: '#0b0f19',
    primarySoft: '#1e293b',

    accent: BRAND_YELLOW,
    accentText: BRAND_INK,

    // Slightly lighter than the light-mode ramp so they hold contrast against a
    // dark surface -- the same adjustment the web app makes under `.dark`.
    success: '#34d399',
    successSoft: '#0f2f24',
    warning: '#fbbf24',
    warningSoft: '#3a2c08',
    danger: '#f87171',
    dangerSoft: '#3a1618',
    info: '#a78bfa',
    infoSoft: '#2a2140',

    overlay: 'rgba(0,0,0,0.6)',
    skeleton: '#2a3242',
  },
};

export const Colors = palette;

export type ThemeColor = keyof ThemeColors;

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 12,
  four: 16,
  five: 24,
  six: 32,
  seven: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 12,
  base: 14,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 40,
} as const;

export const FontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
})!;

/**
 * Elevation that reads correctly on both platforms.
 *
 * Android draws shadows from `elevation` alone and ignores the shadow* props;
 * iOS is the reverse. Emitting both from one place stops screens from setting
 * one and forgetting the other, which is why some cards used to look flat on
 * Android.
 */
export const elevation = (level: 0 | 1 | 2 | 3) => {
  if (level === 0) return {};
  const config = {
    1: { height: 1, opacity: 0.04, radius: 3 },
    2: { height: 2, opacity: 0.06, radius: 5 },
    3: { height: 4, opacity: 0.1, radius: 10 },
  }[level];
  return {
    elevation: level * 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: config.height },
    shadowOpacity: config.opacity,
    shadowRadius: config.radius,
  };
};

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
