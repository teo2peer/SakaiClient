import { Pressable, Text, View } from 'react-native';

export function ErrorBanner({ message, onDismiss }: { message?: string; onDismiss(): void }) {
  if (!message) return null;
  return (
    <View
      accessibilityRole="alert"
      className="mx-4 mb-3 flex-row items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-950 dark:bg-red-950/40">
      <Text className="flex-1 text-sm leading-5 text-red-900 dark:text-red-100">{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cerrar error"
        onPress={onDismiss}
        className="px-1 active:opacity-60">
        <Text className="font-bold text-red-800 dark:text-red-200">Cerrar</Text>
      </Pressable>
    </View>
  );
}
