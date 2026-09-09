import { Text, View } from 'react-native';

import { usePaletteColors } from '@/hooks/use-palette';

const SEGMENTS = 12;

export function CircularDownloadProgress({ progress, size = 48 }: { progress: number; size?: number }) {
  const colors = usePaletteColors();
  const percentage = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  const active = Math.ceil((percentage / 100) * SEGMENTS);
  return <View
    accessibilityRole="progressbar"
    accessibilityLabel="Progreso de descarga"
    accessibilityValue={{ min: 0, max: 100, now: percentage }}
    style={{ width: size, height: size }}
    className="items-center justify-center">
    {Array.from({ length: SEGMENTS }, (_, index) => <View
      key={index}
      pointerEvents="none"
      style={{ position: 'absolute', width: size, height: size, alignItems: 'center', transform: [{ rotate: `${index * (360 / SEGMENTS)}deg` }] }}>
      <View style={{ width: 3, height: 7, marginTop: 2, borderRadius: 2, backgroundColor: index < active ? colors.pine : colors.line }} />
    </View>)}
    <Text className="text-[9px] font-bold text-pine">{percentage}%</Text>
  </View>;
}
