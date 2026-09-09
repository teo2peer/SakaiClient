import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useEffectEvent, useMemo, useState } from 'react';
import { BackHandler, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { usePaletteColors } from '@/hooks/use-palette';
import { isDesktop } from '@/lib/desktop';
import { documentsInScope, type LocalDeleteScope } from '@/lib/downloads';
import { localDocumentExists, shareLocalDocument } from '@/lib/files';
import type { ResourceTreeNode } from '@/lib/resource-tree';
import { useApp } from '@/providers/app-provider';

const ICONS = {
  open: require('@/assets/icons/open.svg'),
  folder: require('@/assets/icons/folder.svg'),
  download: require('@/assets/icons/download.svg'),
  share: require('@/assets/icons/share.svg'),
  trash: require('@/assets/icons/trash.svg'),
};

type QuickAction = {
  id: string;
  icon: keyof typeof ICONS;
  label: string;
  hint?: string;
  disabled?: boolean;
  destructive?: boolean;
  onPress(): void;
};

type ResourceActionsProps = {
  courseId: string;
  node: ResourceTreeNode;
  expanded: boolean;
  onToggleFolder(): void;
  onClose(): void;
};

/**
 * Quick actions for one row of the resource tree, opened with a long press.
 * Every action here is explicit and local: nothing is deleted on PoliformaT.
 */
export function ResourceActions({ courseId, node, expanded, onToggleFolder, onClose }: ResourceActionsProps) {
  const app = useApp();
  const colors = usePaletteColors();
  const [available, setAvailable] = useState<boolean>();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string>();
  const closeActions = useEffectEvent(onClose);
  const document = node.document;
  const localUri = document?.localUriTrusted === false ? undefined : document?.localUri;
  const scope: LocalDeleteScope = node.isFolder
    ? { type: 'folder', courseId, path: node.path }
    : { type: 'file', courseId, path: node.path };
  const localCount = useMemo(() => {
    try {
      return documentsInScope(app.data.documents, node.isFolder
        ? { type: 'folder', courseId, path: node.path }
        : { type: 'file', courseId, path: node.path }).length;
    } catch { return 0; }
  }, [app.data.documents, courseId, node.isFolder, node.path]);

  useEffect(() => {
    if (!localUri) return;
    let active = true;
    void localDocumentExists(localUri).then((value) => { if (active) setAvailable(value); });
    return () => { active = false; };
  }, [localUri]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { closeActions(); return true; });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof globalThis.document === 'undefined') return;
    const webDocument = globalThis.document;
    const previous = webDocument.activeElement instanceof HTMLElement ? webDocument.activeElement : undefined;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeActions(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...webDocument.querySelectorAll<HTMLElement>('[data-testid="resource-actions-sheet"] button, [data-testid="resource-actions-sheet"] [role="button"], [data-testid="resource-actions-sheet"] input')]
        .filter((element) => element.getAttribute('aria-disabled') !== 'true');
      const first = controls.at(0);
      const last = controls.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && webDocument.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && webDocument.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    webDocument.addEventListener('keydown', keydown);
    requestAnimationFrame(() => webDocument.querySelector<HTMLElement>('[data-testid="resource-actions-sheet"] [role="button"]')?.focus());
    return () => { webDocument.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);

  const viewerUnavailable = Platform.OS === 'web' && !isDesktop();
  const pending = node.totalFiles - node.currentFiles;
  const actions: QuickAction[] = [];

  if (node.isFolder) {
    actions.push({
      id: 'toggle',
      icon: 'folder',
      label: expanded ? 'Plegar carpeta' : 'Desplegar carpeta',
      hint: node.children.length ? `${node.children.length} elementos directos` : 'Carpeta vacía',
      onPress: () => { onToggleFolder(); onClose(); },
    });
  } else {
    actions.push({
      id: 'open',
      icon: 'open',
      label: 'Abrir en el visor',
      hint: viewerUnavailable ? 'Solo en las versiones móvil y de escritorio' : undefined,
      disabled: viewerUnavailable,
      onPress: () => { onClose(); router.push({ pathname: '/document', params: { courseId, path: node.path } }); },
    });
  }

  if (node.isFolder || node.resource) {
    const resource = node.resource;
    actions.push({
      id: 'download',
      icon: 'download',
      label: node.isFolder ? 'Descargar carpeta' : node.downloadedFiles ? 'Actualizar copia local' : 'Descargar archivo',
      hint: app.status !== 'authenticated' ? 'Conéctate a PoliformaT para descargar'
        : app.syncing ? 'Hay otra operación en curso'
        : node.isFolder ? (node.totalFiles === 0 ? 'La carpeta no contiene documentos' : pending ? `${pending} sin descargar` : 'Todo al día')
        : undefined,
      disabled: app.status !== 'authenticated' || app.syncing || (node.isFolder ? pending === 0 : !resource),
      onPress: () => {
        onClose();
        void app.syncNow(node.isFolder
          ? { type: 'folder', courseId, path: node.path }
          : { type: 'file', courseId, resource: resource!, force: true });
      },
    });
  }

  if (!node.isFolder && document) {
    actions.push({
      id: 'share',
      icon: 'share',
      label: 'Compartir o abrir original',
      hint: available === false ? 'El archivo ya no está en este dispositivo'
        : available === undefined ? 'Comprobando el archivo local...'
        : undefined,
      disabled: available !== true,
      onPress: () => {
        void shareLocalDocument(document.localUri, document.contentType).then(
          () => onClose(),
          (cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo compartir el documento.'),
        );
      },
    });
  }

  // An ordinary browser manages no local files: it could only fail, so the action is not offered.
  if (localCount > 0 && app.canSyncFiles) {
    actions.push({
      id: 'delete',
      icon: 'trash',
      destructive: true,
      label: node.isFolder ? 'Eliminar descargas de la carpeta' : 'Eliminar de este dispositivo',
      hint: app.syncing ? 'Hay otra operación en curso' : `${localCount} ${localCount === 1 ? 'archivo local' : 'archivos locales'}`,
      disabled: app.syncing,
      onPress: () => setConfirmingDelete(true),
    });
  }

  return (
    <View className="absolute inset-0 justify-end">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cerrar acciones rápidas"
        testID="resource-actions-close"
        onPress={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <View
        accessibilityViewIsModal
        testID="resource-actions-sheet"
        className="max-h-[80%] rounded-t-3xl border-t border-line bg-paper px-5 pb-8 pt-4">
        <View className="mb-3 flex-row items-center gap-3">
          <View className="h-10 w-10 items-center justify-center rounded-lg bg-mint">
            <Image
              source={ICONS[node.isFolder ? 'folder' : 'open']}
              contentFit="contain"
              tintColor={colors.pine}
              style={{ width: 20, height: 20 }}
              accessible={false}
            />
          </View>
          <View className="flex-1">
            <Text numberOfLines={2} className="font-bold leading-5 text-ink">{node.name}</Text>
            <Text numberOfLines={1} ellipsizeMode="middle" className="text-xs leading-5 text-zinc-500">{node.path}</Text>
          </View>
        </View>
        {error ? <Text className="pb-2 text-sm text-ember">{error}</Text> : null}
        {confirmingDelete ? (
          <View className="gap-3 py-2">
            <Text className="text-base font-semibold leading-6 text-ink">
              ¿Eliminar {localCount} {localCount === 1 ? 'archivo' : 'archivos'} de este dispositivo?
            </Text>
            <Text className="text-sm leading-5 text-zinc-600">
              Solo se borran las copias locales y su entrada en el índice. El material sigue en PoliformaT
              y puedes volver a descargarlo cuando quieras.
            </Text>
            <Button
              label="Eliminar copias locales"
              variant="danger"
              onPress={() => { onClose(); void app.deleteDownloads(scope); }}
            />
            <Button label="Cancelar" variant="secondary" onPress={() => setConfirmingDelete(false)} />
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {actions.map((action) => (
              <Pressable
                key={action.id}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityHint={action.hint}
                accessibilityState={{ disabled: Boolean(action.disabled) }}
                disabled={action.disabled}
                onPress={action.onPress}
                className={`min-h-14 flex-row items-center gap-3 border-b border-line py-3 active:bg-mint ${action.disabled ? 'opacity-40' : ''}`}>
                <Image
                  source={ICONS[action.icon]}
                  contentFit="contain"
                  tintColor={action.destructive ? colors.ember : colors.pine}
                  style={{ width: 22, height: 22 }}
                  accessible={false}
                />
                <View className="flex-1">
                  <Text className={`font-semibold leading-5 ${action.destructive ? 'text-ember' : 'text-ink'}`}>
                    {action.label}
                  </Text>
                  {action.hint ? <Text className="text-xs leading-4 text-zinc-500">{action.hint}</Text> : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}
