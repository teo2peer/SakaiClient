import { vars } from 'nativewind';
import { useMemo } from 'react';
import { View } from 'react-native';

import { useApplyColorScheme, usePaletteVariables } from '@/hooks/use-palette';

/**
 * Publishes the selected palette as CSS variables for the whole tree, so every
 * `bg-pine` / `text-ink` / `border-line` class resolves to the chosen colors.
 */
export function ThemedSurface({ children }: { children: React.ReactNode }) {
  useApplyColorScheme();
  const variables = usePaletteVariables();
  const style = useMemo(() => vars(variables), [variables]);
  return <View style={[{ flex: 1 }, style]}>{children}</View>;
}
