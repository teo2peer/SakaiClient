import { Pressable, Text, View } from 'react-native';

import { useVersionManager } from '@/providers/version-provider';

export function VersionUpdateBanner() {
  const versions = useVersionManager();
  if (!versions.showUpdateBanner || !versions.latestRelease) return null;
  return (
    <View
      accessibilityRole="alert"
      className="mx-4 mb-3 gap-3 rounded-xl border border-pine/30 bg-mint p-3 dark:border-pine dark:bg-zinc-900 sm:flex-row sm:items-center">
      <View className="flex-1 gap-1">
        <Text className="font-bold text-ink dark:text-zinc-50">
          Nueva versión {versions.latestRelease.version} disponible
        </Text>
        <Text className="text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          Tienes la versión {versions.currentVersion}. La descarga e instalación son manuales.
        </Text>
      </View>
      <View className="flex-row items-center gap-3">
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={`Ver la versión ${versions.latestRelease.version}`}
          onPress={() => void versions.openLatestRelease()}
          className="min-h-10 justify-center rounded-lg bg-pine px-3 active:opacity-70">
          <Text className="font-bold text-pine-contrast">Ver versión</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cerrar aviso de nueva versión"
          onPress={versions.dismissUpdate}
          className="min-h-10 justify-center px-1 active:opacity-60">
          <Text className="font-bold text-pine">Cerrar</Text>
        </Pressable>
      </View>
    </View>
  );
}
