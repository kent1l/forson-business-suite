/**
 * The active colour set, honouring the OS light/dark setting.
 *
 * Also folds in the admin-configured brand colours when they have been fetched,
 * so the phone matches whatever the dashboard is showing rather than carrying
 * its own idea of the brand.
 */

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors, type ThemeColors, type ThemeName } from '@/constants/theme';
import useBrandStore from '../store/useBrandStore';

export function useThemeName(): ThemeName {
  const scheme = useColorScheme();
  return scheme === 'dark' ? 'dark' : 'light';
}

export function useTheme(): ThemeColors {
  const name = useThemeName();
  const brand = useBrandStore((s) => s.colors);
  const base = Colors[name];

  if (!brand) return base;
  const override = name === 'dark' ? brand.dark : brand.light;
  if (!override.primary && !override.accent) return base;

  return {
    ...base,
    ...(override.primary ? { primary: override.primary } : {}),
    ...(override.accent ? { accent: override.accent } : {}),
  };
}
