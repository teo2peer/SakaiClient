import { router, useIsFocused, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { AppShell } from '@/components/app-shell';
import PdfReader from '@/components/pdf-reader';
import { Button } from '@/components/ui/button';
import { documentKind, type DocumentBlock } from '@/lib/document-reader';
import { syncProgressFraction } from '@/lib/download-progress';
import { readPreviewBase64, readPreviewBlocks } from '@/lib/document-files';
import { localDocumentExists, shareLocalDocument } from '@/lib/files';
import { usePaletteColors } from '@/hooks/use-palette';
import { useApp } from '@/providers/app-provider';

export default function DocumentScreen() {
  const { courseId, path } = useLocalSearchParams<{ courseId: string; path: string }>();
  const app = useApp();
  const focused = useIsFocused();
  const colors = usePaletteColors();
  const document = Object.values(app.data.documents).find((item) => item.courseId === courseId && item.remotePath === path);
  const resource = app.data.resourcesByCourse[courseId]?.find((item) => item.remotePath === path) ?? document;
  const hasResource = Boolean(resource);
  const kind = resource ? documentKind(resource) : 'unsupported';
  const [content, setContent] = useState<{ revision: string; blocks?: DocumentBlock[]; error?: string }>();
  const [openError, setOpenError] = useState('');
  const uri = document?.localUriTrusted === false ? undefined : document?.localUri;
  const revision = `${uri ?? ''}:${document?.fingerprint ?? ''}:${document?.syncedAt ?? ''}`;
  const [availability, setAvailability] = useState<{ revision: string; exists: boolean }>();
  const attempted = useRef('');
  const exists = Boolean(document && availability?.revision === revision && availability.exists);
  const checkLocalFile = useEffectEvent(() => uri ? localDocumentExists(uri) : Promise.resolve(false));
  const reconcileLocalFiles = useEffectEvent((available: boolean) => {
    if (document && document.available !== available) void app.checkLocalDocuments();
  });
  const downloadForOpen = useEffectEvent(async (available: boolean, isActive: () => boolean) => {
    if (!isActive()) return;
    const key = `${courseId}:${path}`;
    if (!available && resource && app.status === 'authenticated' && !app.syncing && attempted.current !== key) {
      attempted.current = key;
      await app.syncNow({ type: 'file', courseId, resource, force: true });
    }
  });

  useEffect(() => {
    if (!focused) return;
    let active = true;
    void checkLocalFile().then((available) => {
      if (!active) return;
      setAvailability({ revision, exists: available });
      reconcileLocalFiles(available);
      void downloadForOpen(available, () => active);
    });
    return () => { active = false; };
  }, [focused, revision, courseId, path, hasResource, app.status, app.syncing]);

  useEffect(() => {
    if (!uri || !exists || kind === 'pdf' || kind === 'unsupported') return;
    let active = true;
    void readPreviewBlocks(uri, kind).then(
      (blocks) => { if (active) { setContent({ revision, blocks }); console.info(`Sakai preview: ready format=${kind} blocks=${blocks.length}`); } },
      (cause: unknown) => { if (active) setContent({ revision, error: cause instanceof Error ? cause.message : 'No se pudo abrir el documento.' }); },
    );
    return () => { active = false; };
  }, [uri, kind, revision, exists]);

  const fileDownloading = app.activeDownload?.type === 'file'
    && app.activeDownload.courseId === courseId
    && app.activeDownload.resource.remotePath === path;
  const fileProgress = app.syncProgress?.fileProgress ?? syncProgressFraction(app.syncProgress);

  return <AppShell>
    <View className="h-12 flex-row items-center gap-1 border-b border-line px-2 dark:border-zinc-800">
      <Pressable accessibilityRole="button" accessibilityLabel="Volver" onPress={() => router.canGoBack() ? router.back() : router.replace('/')} className="h-11 w-11 items-center justify-center active:opacity-60">
        <Image source={require('@/assets/icons/back.svg')} style={{ width: 22, height: 22 }} tintColor={colors.pine} accessible={false} />
      </Pressable>
      <Text numberOfLines={1} ellipsizeMode="middle" className="flex-1 text-sm font-semibold text-ink dark:text-zinc-50">{resource?.name ?? 'Documento'}</Text>
      {resource && app.status === 'authenticated' ? <Pressable accessibilityRole="button" accessibilityLabel="Volver a descargar este archivo" disabled={app.syncing} onPress={() => void app.syncNow({ type: 'file', courseId, resource, force: true })} className="h-11 w-11 items-center justify-center active:opacity-60 disabled:opacity-40">
        <Image source={require('@/assets/icons/download.svg')} style={{ width: 22, height: 22 }} tintColor={colors.pine} accessible={false} />
      </Pressable> : null}
      {document && exists ? <Pressable accessibilityRole="button" accessibilityLabel="Abrir original o compartir" onPress={() => {
          void shareLocalDocument(document.localUri, document.contentType).catch((cause: unknown) => setOpenError(cause instanceof Error ? cause.message : 'No se pudo abrir.'));
        }} className="h-11 w-11 items-center justify-center active:opacity-60">
        <Image source={require('@/assets/icons/share.svg')} style={{ width: 22, height: 22 }} tintColor={colors.pine} accessible={false} />
      </Pressable> : null}
    </View>
    {fileDownloading ? <View className="gap-2 px-4 py-2">
      <Button label="Descargando archivo" progress={fileProgress} onPress={() => undefined} />
      <Button label="Cancelar descarga" variant="secondary" onPress={() => { attempted.current = `${courseId}:${path}`; app.cancelDownload(); }} />
    </View> : null}
    {openError ? <Text className="px-4 py-2 text-sm text-ember">{openError}</Text> : null}
    {!document || !exists ? <View className="gap-4 p-5">
      {app.syncing || availability?.revision !== revision ? <ActivityIndicator color={colors.pine} /> : null}
      <Text className="text-base leading-6 text-zinc-600 dark:text-zinc-300">{app.syncing ? 'Descargando el recurso para abrirlo localmente...' : availability?.revision !== revision ? 'Comprobando el archivo local...' : 'El archivo todavía no está disponible en este dispositivo.'}</Text>
      {resource && app.status === 'authenticated' && !app.syncing ? <Button label="Reintentar descarga de este archivo" onPress={() => void app.syncNow({ type: 'file', courseId, resource, force: true })} /> : null}
      {app.syncing && !fileDownloading ? <Button label="Cancelar descarga" variant="secondary" onPress={() => {
        attempted.current = `${courseId}:${path}`;
        app.cancelDownload();
      }} /> : null}
    </View> : kind === 'pdf' ? <PdfReader
      key={revision}
      documentId={revision}
      uri={document.localUri}
      readData={async () => readPreviewBase64(document.localUri)}
      onReady={async (pages) => { console.info(`Sakai preview: ready format=pdf pages=${pages}`); }}
      dom={{ style: { flex: 1 } }}
    /> : kind === 'unsupported' ? <View className="p-5"><Text className="text-base leading-6 text-zinc-600 dark:text-zinc-300">Este formato no tiene visor integrado. Usa «Abrir original / compartir» para abrirlo con una aplicación compatible.</Text></View> : content?.revision === revision ? (
      content.error ? <Text className="p-5 text-base text-ember">{content.error}</Text> : <FlatList
        data={content.blocks}
        keyExtractor={(_, index) => String(index)}
        contentContainerClassName="gap-4 px-5 pb-10 pt-4"
        ListHeaderComponent={<Text className="text-xs leading-5 text-zinc-500">Vista de lectura local y simplificada. No reproduce imágenes, fórmulas ni toda la maquetación del original.</Text>}
        renderItem={({ item }) => <Text selectable className={item.kind === 'heading' ? 'text-2xl font-bold leading-8 text-ink dark:text-zinc-50' : item.kind === 'table' ? 'rounded-lg bg-mint p-3 font-mono text-sm leading-6 text-ink dark:bg-zinc-900 dark:text-zinc-100' : 'text-base leading-7 text-ink dark:text-zinc-100'}>{item.text}</Text>}
      />
    ) : <ActivityIndicator color={colors.pine} style={{ margin: 24 }} />}
  </AppShell>;
}
