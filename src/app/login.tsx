import { ActivityIndicator, View } from 'react-native';
import { LoginScreen } from '@/components/courses-screen';
import { usePaletteColors } from '@/hooks/use-palette';
import { useApp } from '@/providers/app-provider';

export default function LoginRoute() {
  const { status } = useApp();
  const colors = usePaletteColors();
  if (status === 'loading') return <View className="flex-1 items-center justify-center bg-paper dark:bg-zinc-950"><ActivityIndicator color={colors.pine} /></View>;
  return <LoginScreen />;
}
