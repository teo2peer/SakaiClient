import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui/button';
import { usePaletteColors } from '@/hooks/use-palette';
import { useApp } from '@/providers/app-provider';

export function DownloadLocationScreen() {
  const app = useApp();
  const colors = usePaletteColors();
  const count = Object.keys(app.data.documents).length;
  return <SafeAreaView className="flex-1 bg-paper dark:bg-zinc-950">
    <View className="mx-auto w-full max-w-lg flex-1 justify-center gap-5 px-6 py-8">
      <Text className="text-xs font-bold uppercase tracking-widest text-pine">Almacenamiento</Text>
      <Text className="text-3xl font-bold text-ink dark:text-zinc-50">¿Dónde quieres guardar los documentos?</Text>
      <Text className="text-base leading-6 text-zinc-600 dark:text-zinc-300">Usa la carpeta predeterminada o elige una con el selector del sistema. Podrás cambiarla después desde Descargas. No se descargarán archivos automáticamente.</Text>
      {count ? <Text className="text-sm leading-5 text-zinc-600 dark:text-zinc-400">Si cambias la ubicación, trasladaremos los documentos disponibles conservando sus carpetas.</Text> : null}
      {app.error ? <Text accessibilityRole="alert" className="text-sm text-ember">{app.error}</Text> : null}
      <Button label="Usar carpeta predeterminada" disabled={app.movingFiles} onPress={() => void app.chooseSyncFolder(true)} />
      <Button label="Elegir carpeta" variant="secondary" disabled={app.movingFiles} onPress={() => void app.chooseSyncFolder()} />
      {app.movingFiles ? <View className="gap-3"><ActivityIndicator color={colors.pine} /><Text className="text-center text-sm text-zinc-600 dark:text-zinc-400">{app.syncProgress ? `Trasladando ${app.syncProgress.current} de ${app.syncProgress.total}` : 'Preparando carpeta...'}</Text><Button label="Cancelar traslado" variant="secondary" onPress={app.cancelDownload} /></View> : null}
    </View>
  </SafeAreaView>;
}
