import { Text, View } from 'react-native';

export function ScreenHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
}) {
  return (
    <View className="gap-2 px-5 pb-5 pt-6">
      {eyebrow ? (
        <Text className="text-xs font-bold uppercase tracking-[2px] text-pine">
          {eyebrow}
        </Text>
      ) : null}
      <Text className="text-3xl font-bold tracking-tight text-ink dark:text-zinc-50">{title}</Text>
      {description ? (
        <Text className="max-w-2xl text-[15px] leading-6 text-zinc-600 dark:text-zinc-400">
          {description}
        </Text>
      ) : null}
    </View>
  );
}
