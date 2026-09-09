import { useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';

import { AppShell } from '@/components/app-shell';
import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/text';
import { useApp } from '@/providers/app-provider';
import { isDesktop } from '@/lib/desktop';
import { buildResourceTree, resourceTreeSummary } from '@/lib/resource-tree';
import { fileProgressLabel, syncProgressFraction } from '@/lib/download-progress';

export default function SyncScreen() {
  const app = useApp();
  const focused = useIsFocused();
  const [confirmAll, setConfirmAll] = useState(false);
  const checkLocalDocuments = useEffectEvent(() => app.checkLocalDocuments());
  useEffect(() => {
    if (focused && app.canSyncFiles) void checkLocalDocuments();
  }, [focused, app.canSyncFiles]);
  const progress = app.syncProgress;
  const progressValue = syncProgressFraction(progress);
  const percentage = Math.round(progressValue * 100);
  const currentFileBytes = fileProgressLabel(progress);
  const allDownloading = app.activeDownload?.type === 'all';
  const librarySummary = app.data.courses.reduce((total, course) => {
    const documents = Object.values(app.data.documents).filter((document) => document.courseId === course.id);
    const summary = resourceTreeSummary(buildResourceTree(app.data.resourcesByCourse[course.id] ?? [], documents));
    return { downloaded: total.downloaded + summary.downloaded, total: total.total + summary.total };
  }, { downloaded: 0, total: 0 });

  return (
    <AppShell>
      <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <ScreenHeader
          eyebrow="Archivos"
          title="Descargas"
          description="Nada se descarga automáticamente. Elige un documento, una carpeta, una asignatura o toda la biblioteca."
        />
        <View className="gap-4 px-5">
          {Platform.OS === 'web' && !isDesktop() ? (
            <Card className="gap-3">
              <Text className="text-lg font-bold text-ink dark:text-zinc-50">
                Sincronización no disponible en web
              </Text>
              <Text className="leading-6 text-zinc-600 dark:text-zinc-400">
                La versión web funciona como visor. Importa una exportación de Android o iOS para
                consultar la estructura y los metadatos.
              </Text>
              <Button label="Importar exportación" onPress={() => void app.importData()} />
            </Card>
          ) : (
            <>
              <Card className="gap-3">
                <View className="flex-row items-start justify-between gap-4">
                  <View className="flex-1 gap-1">
                    <Text className="text-xs font-bold uppercase tracking-wide text-pine">
                      Carpeta destino
                    </Text>
                    <Text className="font-semibold text-ink dark:text-zinc-50">
                      {app.data.settings.syncRootName ?? (app.data.settings.syncRootUri
                        ? displayUri(app.data.settings.syncRootUri)
                           : isDesktop() ? 'Documentos/Sakai Client' : Platform.OS === 'android'
                           ? 'Carpeta privada de la aplicación'
                           : 'Documentos/Sakai Sync')}
                    </Text>
                  </View>
                </View>
                <>
                  <Button
                    label={app.movingFiles ? 'Trasladando documentos...' : Object.keys(app.data.documents).length ? 'Cambiar carpeta y mover documentos' : 'Elegir carpeta de descarga'}
                    onPress={() => void app.chooseSyncFolder()}
                    variant="secondary"
                    disabled={app.syncing}
                  />
                  <Text className="text-xs leading-5 text-zinc-500">
                    Se conserva la estructura de las asignaturas. Los archivos se copian y se verifica su nueva ubicación antes de retirar los originales. Pueden quedar carpetas vacías en la ruta anterior.
                  </Text>
                  {Platform.OS === 'ios' ? <Text className="text-xs leading-5 text-zinc-500">iOS puede pedirte que vuelvas a autorizar una carpeta externa al reiniciar.</Text> : null}
                </>
              </Card>

              <Card className="gap-4">
                <View className="flex-row items-center justify-between gap-4">
                  <View className="flex-1 gap-1">
                    <Text className="font-bold text-ink dark:text-zinc-50">
                      Descarga bajo demanda
                    </Text>
                    <Text className="text-xs leading-5 text-zinc-500">
                      Los anuncios y el índice de carpetas se actualizan por separado. Los documentos solo se descargan cuando lo pides.
                    </Text>
                  </View>
                </View>
                <Button
                   label={app.movingFiles ? 'Traslado en curso' : confirmAll ? 'Confirmar descarga de toda la biblioteca' : 'Descargar toda la aplicación'}
                  onPress={() => {
                    if (!confirmAll) { setConfirmAll(true); return; }
                    setConfirmAll(false);
                    void app.syncNow({ type: 'all' });
                  }}
                  loading={app.syncing && !allDownloading}
                  progress={allDownloading ? progressValue : undefined}
                  disabled={app.status !== 'authenticated'}
                />
                {confirmAll ? <Text className="text-sm text-ember">Se descargarán los recursos de todas las asignaturas. Puede consumir bastante espacio y datos.</Text> : null}
                {app.activeDownload || app.movingFiles ? <Button label="Cancelar descarga" variant="secondary" onPress={app.cancelDownload} /> : null}
              </Card>

              {progress ? (
                <Card className="gap-4">
                  <View className="flex-row items-end justify-between">
                    <View className="flex-1 gap-1">
                      <Text className="text-xs font-bold uppercase tracking-wide text-pine">
                        {progress.courseTitle ?? 'Preparando recursos'}
                      </Text>
                       <Text numberOfLines={2} className="text-sm text-zinc-600 dark:text-zinc-400">
                         {progress.currentPath ?? 'Consultando la estructura de las asignaturas...'}
                       </Text>
                       {currentFileBytes ? <Text className="text-xs text-zinc-500">{currentFileBytes}</Text> : null}
                    </View>
                    <Text className="text-2xl font-bold text-ink dark:text-zinc-50">{percentage}%</Text>
                  </View>
                  <View
                    accessibilityRole="progressbar"
                    accessibilityLabel="Progreso total de descarga"
                    accessibilityValue={{ min: 0, max: 100, now: percentage }}
                    className="h-2 overflow-hidden rounded-full bg-mint dark:bg-zinc-800">
                    <View className="h-full rounded-full bg-pine" style={{ width: `${percentage}%` }} />
                  </View>
                  <View className="flex-row justify-between">
                     <Metric label={app.movingFiles ? 'Trasladados' : 'Descargados'} value={progress.downloaded} />
                     <Metric label="Sin cambios" value={progress.skipped} />
                     <Metric label="Por tiempo" value={progress.timedOut} danger={progress.timedOut > 0} />
                     <Metric label="Fallidos" value={progress.failed} danger={progress.failed > 0} />
                  </View>
                </Card>
              ) : null}

              <Card className="gap-2">
                <Text className="font-bold text-ink dark:text-zinc-50">Estado</Text>
                <Text className="text-sm text-zinc-600 dark:text-zinc-400">
                  {app.checkingLocalFiles ? 'Comprobando archivos locales...' : `${librarySummary.downloaded} / ${librarySummary.total} descargados`}
                </Text>
                <Text className="text-sm text-zinc-600 dark:text-zinc-400">
                  {app.data.lastSyncAt
                    ? `Última ejecución: ${formatDate(app.data.lastSyncAt)}`
                    : 'Todavía no se ha completado ninguna sincronización.'}
                </Text>
                {app.data.lastSyncError ? (
                  <Text selectable className="mt-2 text-xs leading-5 text-ember">
                    {app.data.lastSyncError}
                  </Text>
                ) : null}
              </Card>
            </>
          )}
        </View>
      </ScrollView>
    </AppShell>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <View className="items-center gap-1">
      <Text className={`text-lg font-bold ${danger ? 'text-ember' : 'text-ink dark:text-zinc-50'}`}>
        {value}
      </Text>
      <Text className="text-[11px] text-zinc-500">{label}</Text>
    </View>
  );
}

function displayUri(uri: string): string {
  if (uri.startsWith('sakai-root:')) return 'Carpeta de descargas del equipo';
  try {
    return decodeURIComponent(uri).replace(/^file:\/\//, '').replace(/^content:\/\//, '');
  } catch {
    return uri;
  }
}
