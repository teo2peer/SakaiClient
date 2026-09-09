import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useEffectEvent, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, Text, View } from 'react-native';

import { AppShell } from '@/components/app-shell';
import { CircularDownloadProgress } from '@/components/circular-download-progress';
import { ResourceActions } from '@/components/resource-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { courseDisplayTitle } from '@/lib/courses';
import { syncProgressFraction } from '@/lib/download-progress';
import { buildResourceTree, resourceTreeSummary, visibleResourceRows } from '@/lib/resource-tree';
import { formatDate } from '@/lib/text';
import { usePaletteColors } from '@/hooks/use-palette';
import { useApp } from '@/providers/app-provider';
import { isDesktop } from '@/lib/desktop';

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const colors = usePaletteColors();
  const [openError, setOpenError] = useState<string>();
  const [refreshingTree, setRefreshingTree] = useState(false);
  const [loadedCourseId, setLoadedCourseId] = useState<string>();
  const loadingTree = app.status === 'authenticated' && (refreshingTree || loadedCourseId !== id);
  const [expandedFolders, setExpandedFolders] = useState({ courseId: id, paths: new Set<string>() });
  const [actionPath, setActionPath] = useState<string>();
  const course = app.data.courses.find((item) => item.id === id);
  const documents = Object.values(app.data.documents)
    .filter((document) => document.courseId === id)
    .sort((a, b) => a.remotePath.localeCompare(b.remotePath, 'es'));
  const resources = app.data.resourcesByCourse[id] ?? documents;
  const tree = buildResourceTree(resources, documents);
  const expanded = expandedFolders.courseId === id ? expandedFolders.paths : new Set<string>();
  const rows = visibleResourceRows(tree, expanded);
  const summary = resourceTreeSummary(tree);
  const title = course ? courseDisplayTitle(course, app.data.coursePreferences) : 'Asignatura no encontrada';
  const courseDownloading = app.activeDownload?.type === 'course' && app.activeDownload.courseId === id;
  // Looked up by path so the sheet follows the tree when a download or a deletion changes it.
  const actionRow = actionPath ? rows.find(({ node }) => node.path === actionPath) : undefined;

  function toggleFolder(path: string) {
    const paths = new Set(expanded);
    if (paths.has(path)) paths.delete(path);
    else paths.add(path);
    setExpandedFolders({ courseId: id, paths });
  }

  async function refreshTree(isActive = () => true) {
    if (app.status !== 'authenticated') return;
    try {
      await app.loadCourseResources(id, true);
      if (isActive()) setOpenError(undefined);
    } catch (error) {
      if (isActive()) setOpenError(error instanceof Error ? error.message : 'No se pudo cargar el árbol.');
    } finally {
      if (isActive()) {
        setLoadedCourseId(id);
        setRefreshingTree(false);
      }
    }
  }

  const loadTree = useEffectEvent(() => app.loadCourseResources(id));
  useEffect(() => {
    if (app.status !== 'authenticated') return;
    let active = true;
    void loadTree().then(
      () => { if (active) setOpenError(undefined); },
      (error: unknown) => {
        if (active) setOpenError(error instanceof Error ? error.message : 'No se pudo cargar el árbol.');
      },
    ).finally(() => {
      if (active) setLoadedCourseId(id);
    });
    return () => { active = false; };
  }, [id, app.status]);

  return (
    <AppShell>
      <FlatList
        data={rows}
        keyExtractor={({ node }) => `${node.isFolder ? 'folder' : 'file'}:${node.path}`}
        contentContainerClassName="pb-8"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={<>
        <View className="gap-4 px-5 pb-5 pt-5">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Volver a asignaturas"
            onPress={() => router.back()}
            className="self-start py-2 active:opacity-60">
            <Text className="font-semibold text-pine">‹ Asignaturas</Text>
          </Pressable>
          <View className="gap-2">
            <Text className="text-xs font-bold uppercase tracking-[2px] text-pine">
              {course?.term ?? 'Asignatura'}
            </Text>
            <Text className="text-3xl font-bold tracking-tight text-ink dark:text-zinc-50">
              {title}
            </Text>
            {course && title !== course.title ? <Text className="text-sm text-zinc-500">{course.title}</Text> : null}
            <Text className="text-sm text-zinc-600 dark:text-zinc-400">
              {summary.downloaded} / {summary.total} descargados
            </Text>
          </View>
          {app.status === 'authenticated' ? (
            <View className="gap-2">
              <Button
                label="Descargar esta asignatura"
                onPress={() => void app.syncNow({ type: 'course', courseId: id })}
                loading={app.syncing && !courseDownloading}
                progress={courseDownloading ? syncProgressFraction(app.syncProgress) : undefined}
              />
              {app.activeDownload ? <Button label="Cancelar descarga" onPress={app.cancelDownload} variant="secondary" /> : null}
              <Button
                label="Actualizar árbol"
                variant="secondary"
                onPress={() => {
                  setRefreshingTree(true);
                  setOpenError(undefined);
                  void refreshTree();
                }}
                loading={loadingTree}
              />
            </View>
          ) : null}
        </View>

        <View className="gap-3 px-5">
          {openError ? (
            <Text className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/40 dark:text-red-100">
              {openError}
            </Text>
          ) : null}
          <View className="flex-row items-center justify-between border-b border-zinc-200 py-3 dark:border-zinc-800">
            <Text className="font-bold text-ink dark:text-zinc-50">Recursos de PoliformaT</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Plegar todas las carpetas"
              onPress={() => setExpandedFolders({ courseId: id, paths: new Set() })}
              className="min-h-11 justify-center px-2 active:opacity-60">
              <Text className="text-sm font-semibold text-pine">Plegar todo</Text>
            </Pressable>
          </View>
        </View>
        </>}
        ListEmptyComponent={
          <Card className="mx-5 items-center gap-2 py-10">
            {loadingTree ? <ActivityIndicator color={colors.pine} /> : null}
            <Text className="text-lg font-bold text-ink dark:text-zinc-50">
              {loadingTree ? 'Cargando carpetas...' : openError ? 'No se pudo cargar el árbol' : 'Sin recursos disponibles'}
            </Text>
            <Text className="text-center leading-5 text-zinc-600 dark:text-zinc-400">
              {app.status !== 'authenticated'
                ? 'Conéctate a PoliformaT para consultar los recursos de esta asignatura.'
                : 'Las carpetas y los documentos aparecerán aquí, aunque aún no estén descargados.'}
            </Text>
          </Card>
        }
        renderItem={({ item: { node, depth } }) => {
          const isExpanded = expanded.has(node.path);
          const document = node.document;
          const disabled = !node.isFolder && Platform.OS === 'web' && !isDesktop();
           const downloaded = node.totalFiles > 0 && node.currentFiles === node.totalFiles;
           const folderDownloading = app.activeDownload?.type === 'folder'
             && app.activeDownload.courseId === id
             && app.activeDownload.path === node.path;
           const downloadDisabled = downloaded || node.totalFiles === 0 || app.syncing || app.status !== 'authenticated';
          return (
            <View className="mx-5" style={{ paddingLeft: Math.min(depth, 5) * 14 }}>
              <View className="flex-row items-center border-b border-zinc-200 dark:border-zinc-800">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${node.isFolder ? 'Carpeta' : 'Documento'} ${node.name}`}
                accessibilityState={node.isFolder ? { expanded: isExpanded } : { disabled }}
                accessibilityHint={`${node.isFolder ? 'Pulsa para mostrar u ocultar su contenido' : document ? 'Abrir el visor' : 'Ver opciones de descarga y lectura'}. Usa el botón de acciones para más opciones`}
                disabled={disabled}
                onPress={() => {
                  if (node.isFolder) toggleFolder(node.path);
                  else router.push({ pathname: '/document', params: { courseId: id, path: node.path } });
                }}
                onLongPress={() => setActionPath(node.path)}
                className="min-h-16 flex-1 flex-row items-center gap-3 py-3 active:bg-mint">
                {node.isFolder ? (
                  <View className="h-10 w-10 items-center justify-center rounded-lg bg-mint">
                    <Text className="text-2xl font-medium text-pine">{isExpanded ? '-' : '+'}</Text>
                  </View>
                ) : (
                  <View className="relative h-10 w-10 items-center justify-center rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                    <Text className="text-[10px] font-bold uppercase text-zinc-600 dark:text-zinc-300">{fileExtension(node.name)}</Text>
                    {node.downloadedFiles === 1 ? (
                      <View className="absolute -bottom-1 -right-1 h-4 w-4 items-center justify-center rounded-full border border-white bg-pine dark:border-zinc-900">
                        <Text className="text-[9px] font-black text-pine-contrast">✓</Text>
                      </View>
                    ) : null}
                  </View>
                )}
                <View className="flex-1 gap-1">
                  <Text className="font-semibold leading-5 text-ink dark:text-zinc-50">{node.name}</Text>
                  <Text className="text-xs leading-4 text-zinc-600 dark:text-zinc-400">
                    {node.isFolder
                       ? node.children.length ? `${node.children.length} ${node.children.length === 1 ? 'elemento' : 'elementos'}` : 'Carpeta vacía'
                       : `${formatBytes(node.resource?.size)} · ${document?.available === true ? node.currentFiles === 1 ? 'Disponible sin conexión' : 'Disponible · actualización pendiente' : document ? 'Archivo local no disponible' : 'Pendiente de descarga'}`}
                  </Text>
                  {depth > 5 ? <Text className="text-xs text-zinc-500">{node.path}</Text> : null}
                  {document ? <Text className="text-[11px] text-zinc-500">Guardado {formatDate(document.syncedAt)}</Text> : null}
                  {node.localOnly ? <Text className="text-xs text-zinc-600 dark:text-zinc-400">Solo en el dispositivo</Text> : null}
                </View>
              </Pressable>
              {node.isFolder ? (
                folderDownloading ? (
                  <CircularDownloadProgress progress={syncProgressFraction(app.syncProgress)} size={48} />
                ) : <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={downloaded ? `Carpeta ${node.name}: descargada` : `Descargar carpeta ${node.name}`}
                  accessibilityHint={downloaded ? 'Todos sus documentos están descargados y actualizados según el índice local' : node.totalFiles === 0 ? 'La carpeta no contiene documentos para descargar' : 'Descarga únicamente esta carpeta y sus subcarpetas'}
                  disabled={downloadDisabled}
                  onPress={() => void app.syncNow({ type: 'folder', courseId: id, path: node.path })}
                  className={`h-12 w-12 items-center justify-center rounded-full active:bg-mint ${downloadDisabled && !downloaded ? 'opacity-40' : ''}`}>
                  <Image
                    source={downloaded ? require('@/assets/icons/downloaded.svg') : require('@/assets/icons/download.svg')}
                    contentFit="contain"
                    tintColor={colors.pine}
                    style={{ width: 24, height: 24 }}
                    accessible={false}
                  />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Acciones de ${node.name}`}
                onPress={() => setActionPath(node.path)}
                className="h-12 w-10 items-center justify-center rounded-full active:bg-mint">
                <Text className="text-lg font-bold tracking-widest text-pine">...</Text>
              </Pressable>
              </View>
            </View>
          );
        }}
      />
      {actionRow ? (
        <ResourceActions
          courseId={id}
          node={actionRow.node}
          expanded={expanded.has(actionRow.node.path)}
          onToggleFolder={() => toggleFolder(actionRow.node.path)}
          onClose={() => setActionPath(undefined)}
        />
      ) : null}
    </AppShell>
  );
}

function fileExtension(name: string): string {
  const extension = name.split('.').pop();
  return extension && extension !== name ? extension.slice(0, 4) : 'FILE';
}

function formatBytes(value?: number): string {
  if (value == null) return 'Tamaño desconocido';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
