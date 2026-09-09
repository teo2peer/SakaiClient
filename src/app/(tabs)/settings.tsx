import { Alert, Platform, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useState } from 'react';

import { AppShell } from '@/components/app-shell';
import { PalettePicker } from '@/components/palette-picker';
import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePaletteColors } from '@/hooks/use-palette';
import { useApp } from '@/providers/app-provider';
import { isDesktop } from '@/lib/desktop';
import type { ColorSchemePreference } from '@/constants/palettes';

const COLOR_SCHEME_OPTIONS: { id: ColorSchemePreference; label: string }[] = [
  { id: 'system', label: 'Automático' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
];

export default function SettingsScreen() {
  const app = useApp();
  const [confirmDesktopClear, setConfirmDesktopClear] = useState(false);

  const confirmClear = () => {
    if (isDesktop()) { setConfirmDesktopClear(true); return; }
    if (Platform.OS === 'web') {
            if (window.confirm('¿Borrar el índice local? Los archivos descargados se conservarán.')) void app.clearLocalData();
      return;
    }
    Alert.alert(
      'Borrar datos locales',
      'Se borrarán asignaturas, anuncios y el índice local. Los documentos ya descargados no se eliminan.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Borrar', style: 'destructive', onPress: () => void app.clearLocalData() },
      ],
    );
  };

  return (
    <AppShell>
      <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <ScreenHeader
          eyebrow="Preferencias"
          title="Ajustes"
          description="Controla la apariencia, los avisos, las copias portables y la sesión de PoliformaT."
        />
        <View className="gap-4 px-5">
          <Card className="gap-3">
            <Text className="text-lg font-bold text-ink dark:text-zinc-50">Apariencia</Text>
            <Text className="text-sm leading-5 text-zinc-600 dark:text-zinc-400">
              Elige el modo de color y la paleta de la aplicación.
            </Text>
            <ColorSchemePicker />
            <PalettePicker />
          </Card>

          {isDesktop() && app.data.settings.syncRootUri ? (
            <Card className="gap-3">
              <Text className="text-lg font-bold text-ink dark:text-zinc-50">Carpeta de descargas</Text>
              <Text className="text-sm leading-5 text-zinc-600 dark:text-zinc-400">
                {app.data.settings.syncRootName ?? 'Carpeta seleccionada'}
              </Text>
              <Button label="Abrir carpeta de descargas" onPress={() => void app.openSyncFolder()} variant="secondary" />
            </Card>
          ) : null}

          {Platform.OS !== 'web' || isDesktop() ? (
            <Card className="gap-4">
              <SettingRow
                title="Notificaciones"
                description="Avisa de anuncios nuevos y cuando termine una descarga solicitada."
                value={app.data.settings.notifications}
                onValueChange={(value) => void app.setNotifications(value)}
              />
              <View className="h-px bg-line dark:bg-zinc-800" />
              <View className="gap-1">
                <Text className="font-semibold text-ink dark:text-zinc-100">Credenciales guardadas</Text>
                <Text className="text-sm text-zinc-500">
                  {app.credentialsSaved
                    ? 'Protegidas por el almacén seguro del dispositivo.'
                    : 'No guardadas. El segundo plano no podrá renovar la sesión.'}
                </Text>
              </View>
            </Card>
          ) : null}

          <Card className="gap-3">
            <Text className="text-lg font-bold text-ink dark:text-zinc-50">Copia portable</Text>
            <Text className="text-sm leading-5 text-zinc-600 dark:text-zinc-400">
              Exporta asignaturas, anuncios y el índice de documentos, sin credenciales de acceso.
              Puede contener datos personales y material académico: compártela solo si tienes permiso.
            </Text>
            <View className="gap-2 sm:flex-row">
              <View className="flex-1">
                <Button label="Exportar datos" onPress={() => void app.exportData()} variant="secondary" />
              </View>
              <View className="flex-1">
                <Button label="Importar datos" onPress={() => void app.importData()} variant="secondary" />
              </View>
            </View>
          </Card>

          <Card className="gap-3">
            <Text className="text-lg font-bold text-ink dark:text-zinc-50">Datos locales</Text>
            <Text className="text-sm text-zinc-600 dark:text-zinc-400">
              {app.data.courses.length} asignaturas · {app.data.announcements.length} anuncios ·{' '}
              {Object.keys(app.data.documents).length} documentos indexados
            </Text>
            <Button label="Borrar índice local" onPress={confirmClear} variant="danger" />
            {confirmDesktopClear ? <View className="gap-2">
              <Text className="text-sm text-ember">Se borrará el índice. Los documentos descargados se conservarán.</Text>
              <Button label="Confirmar borrado del índice" variant="danger" onPress={() => { setConfirmDesktopClear(false); void app.clearLocalData(); }} />
              <Button label="Cancelar" variant="secondary" onPress={() => setConfirmDesktopClear(false)} />
            </View> : null}
          </Card>

          {app.status === 'authenticated' || app.status === 'offline' ? (
            <Button label="Cerrar sesión" onPress={() => void app.logout()} variant="ghost" disabled={app.syncing} />
          ) : null}

          <Card className="gap-2">
            <Text className="font-bold text-ink dark:text-zinc-50">Proyecto independiente</Text>
            <Text className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Sakai Client es un cliente de Sakai no oficial. El proyecto y sus responsables no están
              afiliados ni respaldados por la UPV, PoliformaT, el proyecto Sakai o la Fundación Apereo.
            </Text>
            <Text className="text-xs leading-5 text-zinc-500">
              Los materiales pertenecen a sus respectivos titulares. Usa únicamente recursos autorizados
              y consulta siempre la plataforma oficial para información académica importante.
            </Text>
          </Card>

          <Text className="text-center text-xs leading-5 text-zinc-500">
            Sin descargas automáticas. Los avisos en segundo plano dependen de iOS y Android.
          </Text>
        </View>
      </ScrollView>
    </AppShell>
  );
}

function ColorSchemePicker() {
  const app = useApp();
  const selected = app.data.settings.colorScheme ?? 'system';
  return (
    <View className="flex-row gap-2">
      {COLOR_SCHEME_OPTIONS.map((option) => {
        const active = option.id === selected;
        return <Pressable
          key={option.id}
          accessibilityRole="radio"
          accessibilityState={{ checked: active }}
          accessibilityLabel={`Modo ${option.label}`}
          onPress={() => void app.setColorScheme(option.id)}
          className={`flex-1 items-center rounded-xl border px-2 py-3 active:opacity-70 ${
            active ? 'border-pine bg-pine' : 'border-line bg-white dark:bg-zinc-900'
          }`}>
          <Text className={`text-xs font-bold ${active ? 'text-pine-contrast' : 'text-ink dark:text-zinc-200'}`}>
            {option.label}
          </Text>
        </Pressable>;
      })}
    </View>
  );
}

function SettingRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description: string;
  value: boolean;
  onValueChange(value: boolean): void;
}) {
  const colors = usePaletteColors();
  return (
    <View className="flex-row items-center gap-4">
      <View className="flex-1 gap-1">
        <Text className="font-semibold text-ink dark:text-zinc-100">{title}</Text>
        <Text className="text-xs leading-5 text-zinc-500">{description}</Text>
      </View>
      <Switch accessibilityLabel={title} value={value} onValueChange={onValueChange} trackColor={{ true: colors.pine }} />
    </View>
  );
}
