import '@/global.css';
import '@/lib/background-sync';

import { DarkTheme, DefaultTheme, router, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { AppProvider, useApp } from '@/providers/app-provider';
import { VersionProvider } from '@/providers/version-provider';
import { subscribeAnnouncementOpen } from '@/lib/notifications';
import { DownloadLocationScreen } from '@/components/download-location-screen';
import { ThemedSurface } from '@/components/themed-surface';
import { usePaletteColors, useResolvedColorScheme } from '@/hooks/use-palette';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <AppProvider>
      <VersionProvider>
        <ThemedApp />
      </VersionProvider>
    </AppProvider>
  );
}

/** Lives inside AppProvider so the navigator picks up the palette chosen in Settings. */
function ThemedApp() {
  const scheme = useResolvedColorScheme();
  const colors = usePaletteColors();
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.pine,
        background: colors.paper,
        border: colors.line,
        text: colors.ink,
        notification: colors.ember,
      },
    };
  }, [scheme, colors]);

  return (
    <ThemeProvider value={navigationTheme}>
      <ThemedSurface>
        <RootNavigator />
      </ThemedSurface>
    </ThemeProvider>
  );
}

function RootNavigator() {
  const { status, data, canSyncFiles } = useApp();
  const colors = usePaletteColors();
  const allowed = status !== 'loading' && status !== 'signed-out';
  const needsLocation = canSyncFiles && !data.settings.downloadLocationChosen;
  useEffect(() => {
    if (!allowed || needsLocation) return;
    return subscribeAnnouncementOpen((id) => {
      if (id === '__sakai_downloads__') router.push('/sync');
      else if (id) router.push({ pathname: '/announcement/[id]', params: { id } });
      else router.push('/announcements');
    });
  }, [allowed, needsLocation]);
  if (status === 'loading') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={colors.pine} /></View>;
  if (needsLocation) return <DownloadLocationScreen />;
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={!allowed}><Stack.Screen name="login" /></Stack.Protected>
    <Stack.Protected guard={allowed}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="course/[id]" />
      <Stack.Screen name="announcement/[id]" />
      <Stack.Screen name="document" />
    </Stack.Protected>
  </Stack>;
}
