import { Pressable, Text, View } from 'react-native';

import { PALETTES, PALETTE_IDS, paletteTokens, type PaletteId } from '@/constants/palettes';
import { usePaletteId, useResolvedColorScheme } from '@/hooks/use-palette';
import { useApp } from '@/providers/app-provider';

export function PalettePicker() {
  const app = useApp();
  const selected = usePaletteId();
  const scheme = useResolvedColorScheme();

  return (
    <View className="-m-1 flex-row flex-wrap">
      {PALETTE_IDS.map((id) => (
        <View key={id} className="w-1/3 p-1">
          <PaletteOption
            id={id}
            scheme={scheme}
            selected={id === selected}
            onSelect={() => void app.setPalette(id)}
          />
        </View>
      ))}
    </View>
  );
}

function PaletteOption({
  id,
  scheme,
  selected,
  onSelect,
}: {
  id: PaletteId;
  scheme: 'light' | 'dark';
  selected: boolean;
  onSelect(): void;
}) {
  const { name, description } = PALETTES[id];
  const colors = paletteTokens(id, scheme);

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`Tema ${name}`}
      accessibilityHint={description}
      onPress={onSelect}
      className={`items-center gap-2 rounded-2xl border-2 p-2 active:opacity-70 ${
        selected ? 'border-pine' : 'border-transparent'
      }`}>
      <View
        className="h-14 w-full items-center justify-center gap-1 rounded-xl border"
        style={{ backgroundColor: colors.paper, borderColor: colors.line }}>
        <View className="h-5 w-5 rounded-full" style={{ backgroundColor: colors.pine }} />
        <View className="h-2 w-8 rounded-full" style={{ backgroundColor: colors.mint }} />
      </View>
      <Text
        numberOfLines={1}
        className={`text-xs ${selected ? 'font-bold text-pine' : 'font-semibold text-ink dark:text-zinc-300'}`}>
        {name}
      </Text>
    </Pressable>
  );
}
