import { View } from 'react-native';
import { useSegments } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorBanner } from '@/components/error-banner';
import { useApp } from '@/providers/app-provider';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { error, clearError } = useApp();
  const inTabs = useSegments()[0] === '(tabs)';
  return (
    <View className="flex-1 bg-paper dark:bg-zinc-950">
      <SafeAreaView edges={inTabs ? ['top'] : ['top', 'bottom']} className="mx-auto w-full max-w-4xl flex-1">
        <ErrorBanner message={error} onDismiss={clearError} />
        {children}
      </SafeAreaView>
    </View>
  );
}
