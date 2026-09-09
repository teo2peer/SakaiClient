import { useEffect, useMemo } from 'react';
import { colorScheme } from 'nativewind';
import { Platform } from 'react-native';

import {
  DEFAULT_PALETTE_ID,
  paletteTokens,
  paletteVariables,
  resolveColorScheme,
  type ColorScheme,
  type ColorSchemePreference,
  type PaletteId,
  type PaletteTokens,
} from '@/constants/palettes';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useApp } from '@/providers/app-provider';

export function useColorSchemePreference(): ColorSchemePreference {
  const { data } = useApp();
  return data.settings.colorScheme ?? 'system';
}

export function useResolvedColorScheme(): ColorScheme {
  return resolveColorScheme(useColorSchemePreference(), useColorScheme());
}

export function useApplyColorScheme(): void {
  const preference = useColorSchemePreference();
  const resolved = useResolvedColorScheme();
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Expo can insert the development stylesheet after the first effect, so
      // apply the class directly as well as updating NativeWind's observable.
      document.documentElement.classList.toggle('dark', resolved === 'dark');
      document.documentElement.style.colorScheme = resolved;
      colorScheme.set(resolved);
    } else {
      // Releasing the native override keeps automatic mode subscribed to later
      // system appearance changes.
      colorScheme.set(preference);
    }
  }, [preference, resolved]);
}

export function usePaletteId(): PaletteId {
  const { data } = useApp();
  return data.settings.palette ?? DEFAULT_PALETTE_ID;
}

/**
 * Resolved hex colors of the active palette. Use it only for props that cannot
 * take a class name (`tintColor`, `ActivityIndicator`, navigator options...);
 * everything else should keep using the `bg-pine` / `text-ink` classes.
 */
export function usePaletteColors(): PaletteTokens {
  const palette = usePaletteId();
  const scheme = useResolvedColorScheme();
  return useMemo(() => paletteTokens(palette, scheme), [palette, scheme]);
}

/** CSS variables of the active palette, ready to be spread into a `style` prop. */
export function usePaletteVariables(): Record<string, string> {
  const palette = usePaletteId();
  const scheme = useResolvedColorScheme();
  return useMemo(() => paletteVariables(palette, scheme), [palette, scheme]);
}
