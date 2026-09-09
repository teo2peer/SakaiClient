import { createContext, use, useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import type { ColorSchemePreference, PaletteId } from '@/constants/palettes';
import { clearStoredAuthentication, restoreAuthenticatedClient } from '@/lib/auth';
import { setBackgroundSyncEnabled } from '@/lib/background-sync';
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
  saveSessionId,
} from '@/lib/credentials';
import { exportAppData, importAppData } from '@/lib/data-transfer';
import { moveCourseInOrder } from '@/lib/courses';
import { checkDocumentAvailability } from '@/lib/document-availability';
import { documentsInScope, type LocalDeleteScope } from '@/lib/downloads';
import { canSyncFiles, createSyncWorkspace, deleteLocalDocument, localDocumentExists, openSyncRoot, pickSyncRoot, removeCopiedOriginal } from '@/lib/files';
import { relocateDocuments } from '@/lib/relocate-documents';
import { notifyDownloadFinished, notifyNewAnnouncements, requestNotificationPermission } from '@/lib/notifications';
import { SakaiClient, SakaiError } from '@/lib/sakai-client';
import { clearAppData, createAppDataCommitter, EMPTY_APP_DATA, loadAppData } from '@/lib/storage';
import { syncResources } from '@/lib/sync-engine';
import { getDesktopApi, isDesktop } from '@/lib/desktop';
import type {
  AppData,
  DownloadScope,
  SakaiAnnouncement,
  SavedCredentials,
  SyncProgress,
} from '@/types/sakai';
type AppStatus = 'loading' | 'signed-out' | 'authenticated' | 'offline' | 'web';

type AppContextValue = {
  status: AppStatus;
  data: AppData;
  error?: string;
  syncing: boolean;
  movingFiles: boolean;
  refreshing: boolean;
  syncProgress?: SyncProgress;
  activeDownload?: DownloadScope;
  checkingLocalFiles: boolean;
  credentialsSaved: boolean;
  canSyncFiles: boolean;
  login(credentials: SavedCredentials, remember: boolean): Promise<void>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  loadCourseResources(courseId: string, force?: boolean): Promise<void>;
  syncNow(scope: DownloadScope): Promise<void>;
  checkLocalDocuments(): Promise<void>;
  deleteDownloads(scope: LocalDeleteScope): Promise<void>;
  cancelDownload(): void;
  chooseSyncFolder(useDefault?: boolean): Promise<void>;
  openSyncFolder(): Promise<void>;
  setNotifications(value: boolean): Promise<void>;
  setPalette(palette: PaletteId): Promise<void>;
  setColorScheme(colorScheme: ColorSchemePreference): Promise<void>;
  setCourseAlias(courseId: string, alias: string): Promise<void>;
  setCourseFavorite(courseId: string, favorite: boolean): Promise<void>;
  moveCourse(courseId: string, direction: 'up' | 'down'): Promise<void>;
  markAnnouncementRead(id: string): Promise<void>;
  exportData(): Promise<void>;
  importData(): Promise<void>;
  clearLocalData(): Promise<void>;
  clearError(): void;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AppStatus>('loading');
  const [data, setData] = useState<AppData>(EMPTY_APP_DATA);
  const [error, setError] = useState<string>();
  const [syncing, setSyncing] = useState(false);
  const [movingFiles, setMovingFiles] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress>();
  const [activeDownload, setActiveDownload] = useState<DownloadScope>();
  const [checkingLocalFiles, setCheckingLocalFiles] = useState(false);
  const [credentialsSaved, setCredentialsSaved] = useState(false);
  const clientRef = useRef<SakaiClient | null>(null);
  const dataRef = useRef<AppData>(EMPTY_APP_DATA);
  const commitRef = useRef<ReturnType<typeof createAppDataCommitter> | null>(null);
  const syncingRef = useRef(false);
  const downloadController = useRef<AbortController | null>(null);
  const refreshingRef = useRef(false);
  const operationVersion = useRef(0);
  const availabilityVersion = useRef(0);

  if (commitRef.current === null) {
    commitRef.current = createAppDataCommitter(() => dataRef.current, (next) => {
      dataRef.current = next;
      setData(next);
    });
  }
  const commit = commitRef.current;

  const initialize = useEffectEvent(async (storedData: AppData, isActive: () => boolean) => {
    const version = operationVersion.current;
    if (!isActive()) return;
    dataRef.current = storedData;
    setData(storedData);

    if (Platform.OS === 'web' && !isDesktop()) {
      setStatus('web');
      return;
    }

    if (storedData.settings.downloadLocationChosen && storedData.settings.syncRootUri) {
      try { await createSyncWorkspace(storedData.settings.syncRootUri); }
      catch (cause) {
        setError(`${errorMessage(cause)} Puedes cambiarla desde Descargas.`);
      }
    }
    if (Object.keys(storedData.documents).length > 0) await checkLocalDocuments();

    const saved = await loadCredentials().catch(() => null);
    setCredentialsSaved(Boolean(saved));
    await setBackgroundSyncEnabled(false).catch(() => false);
    try {
      const client = await restoreAuthenticatedClient(() => isActive() && version === operationVersion.current);
      if (!isActive() || version !== operationVersion.current) return;
      clientRef.current = client;
      setStatus(client ? 'authenticated' : 'signed-out');
      if (client) {
        try {
          await refreshWithClient(client, storedData, false);
        } catch (cause) {
          setError(`Sin conexión con PoliformaT. Mostrando datos locales. ${errorMessage(cause)}`);
        }
        await setBackgroundSyncEnabled(Boolean(saved) && storedData.settings.notifications).catch(
          () => false,
        );
      }
    } catch (cause) {
      if (!isActive() || version !== operationVersion.current) return;
      const hasOfflineData = storedData.courses.length > 0 || storedData.announcements.length > 0;
      setStatus(hasOfflineData ? 'offline' : 'signed-out');
      setError(
        hasOfflineData
          ? `Sin conexión con PoliformaT. Mostrando datos locales. ${errorMessage(cause)}`
          : errorMessage(cause),
      );
    }
  });

  const runActiveRefresh = useEffectEvent(() => {
    void refresh();
  });
  const runAvailabilityCheck = useEffectEvent(() => {
    void checkLocalDocuments();
  });

  useEffect(() => getDesktopApi()?.onMetadataRefresh(() => {
    if (clientRef.current && dataRef.current.settings.notifications) runActiveRefresh();
  }), []);

  useEffect(() => {
    let active = true;
    void loadAppData()
      .then((storedData) => initialize(storedData, () => active))
      .catch((cause) => {
        if (active) {
          setStatus('signed-out');
          setError(errorMessage(cause));
        }
      });
    return () => {
      active = false;
      downloadController.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (status !== 'authenticated' && status !== 'offline') return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const lastRefresh = data.lastRefreshAt ? new Date(data.lastRefreshAt).getTime() : 0;
      if (nextState === 'active') {
        runAvailabilityCheck();
        if (status === 'authenticated' && Date.now() - lastRefresh > 15 * 60 * 1000) runActiveRefresh();
      }
    });
    return () => subscription.remove();
  }, [status, data.lastRefreshAt]);

  async function login(credentials: SavedCredentials, remember: boolean): Promise<void> {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setError(undefined);
    setRefreshing(true);
    try {
      const client = new SakaiClient();
      const session = await client.login(credentials.username, credentials.password);
      clientRef.current = client;
      await saveSessionId(session.id);
      if (remember) await saveCredentials(credentials);
      else await clearCredentials();
      setCredentialsSaved(remember);
      setStatus('authenticated');
      await refreshWithClient(client, dataRef.current, false).catch((cause) => setError(errorMessage(cause)));
      await setBackgroundSyncEnabled(remember && dataRef.current.settings.notifications).catch(() => false);
    } catch (cause) {
      const failedClient = clientRef.current;
      clientRef.current = null;
      await setBackgroundSyncEnabled(false).catch(() => false);
      await clearStoredAuthentication().catch(() => undefined);
      if (!isDesktop()) await failedClient?.logout().catch(() => undefined);
      setCredentialsSaved(false);
      setStatus('signed-out');
      setError(errorMessage(cause));
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  async function logout(): Promise<void> {
    if (syncingRef.current) { setError('Termina la operación de archivos antes de cerrar sesión.'); return; }
    operationVersion.current += 1;
    availabilityVersion.current += 1;
    setCheckingLocalFiles(false);
    downloadController.current?.abort();
    setError(undefined);
    setStatus('loading');
    await setBackgroundSyncEnabled(false).catch(() => false);
    await clearStoredAuthentication();
    if (!isDesktop()) await clientRef.current?.logout().catch(() => undefined);
    clientRef.current = null;
    setCredentialsSaved(false);
    setStatus(Platform.OS === 'web' && !isDesktop() ? 'web' : 'signed-out');
  }

  async function getClient(): Promise<SakaiClient> {
    if (clientRef.current) return clientRef.current;
    const version = operationVersion.current;
    const client = await restoreAuthenticatedClient(() => version === operationVersion.current);
    if (version !== operationVersion.current) throw new Error('La operacion se ha cancelado.');
    if (!client) throw new Error('Inicia sesion para conectar con PoliformaT.');
    clientRef.current = client;
    setStatus('authenticated');
    return client;
  }

  async function refresh(): Promise<void> {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setError(undefined);
    const version = operationVersion.current;
    try {
      await refreshWithClient(await getClient(), dataRef.current, true);
    } catch (cause) {
      if (version === operationVersion.current) await handleRemoteError(cause);
    } finally {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  }

  async function refreshWithClient(
    client: SakaiClient,
    current: AppData,
    sendNotifications: boolean,
  ): Promise<AppData> {
    const version = operationVersion.current;
    const [courses, announcements] = await Promise.all([
      client.getCourses(),
      client.getAnnouncements(),
    ]);
    if (version !== operationVersion.current) return dataRef.current;
    const known = new Set(current.announcements.map((item) => item.id));
    const newAnnouncements = announcements.filter((item) => !known.has(item.id));
    await commit((latest) => version !== operationVersion.current ? latest : ({
      ...latest,
      courses,
      announcements,
      lastRefreshAt: new Date().toISOString(),
    }));
    if (version !== operationVersion.current) return dataRef.current;
    setStatus('authenticated');
    if (
      sendNotifications &&
      current.lastRefreshAt &&
      current.settings.notifications &&
      newAnnouncements.length > 0
    ) {
      await notifyNewAnnouncements(newAnnouncements, () => version === operationVersion.current);
    }
    return dataRef.current;
  }

  async function syncNow(scope: DownloadScope): Promise<void> {
    setError(undefined);
    const version = operationVersion.current;
    try {
      await syncWithClient(await getClient(), dataRef.current, scope);
    } catch (cause) {
      if (version === operationVersion.current) await handleRemoteError(cause);
    }
  }

  async function checkLocalDocuments(force = false): Promise<void> {
    if (!canSyncFiles || syncingRef.current && !force) return;
    const check = ++availabilityVersion.current;
    const version = operationVersion.current;
    const snapshot = dataRef.current.documents;
    setCheckingLocalFiles(true);
    try {
      const availability = await checkDocumentAvailability(snapshot, localDocumentExists);
      if (check !== availabilityVersion.current || version !== operationVersion.current) return;
      if (!Object.entries(availability).some(([key, available]) => snapshot[key]?.available !== available)) return;
      await commit((latest) => {
        if (check !== availabilityVersion.current || version !== operationVersion.current) return latest;
        const documents = { ...latest.documents };
        for (const [key, available] of Object.entries(availability)) {
          const original = snapshot[key];
          const current = documents[key];
          if (original && current?.localUri === original.localUri && current.available !== available) {
            documents[key] = { ...current, available };
          }
        }
        return { ...latest, documents };
      });
    } catch (cause) {
      if (check === availabilityVersion.current && version === operationVersion.current) setError(errorMessage(cause));
    } finally {
      if (check === availabilityVersion.current) setCheckingLocalFiles(false);
    }
  }

  /** Explicit local cleanup: deletes downloaded copies and forgets them, never remote resources. */
  async function deleteDownloads(scope: LocalDeleteScope): Promise<void> {
    if (syncingRef.current) { setError('Termina o cancela la descarga antes de eliminar archivos.'); return; }
    syncingRef.current = true;
    availabilityVersion.current += 1;
    setCheckingLocalFiles(false);
    setSyncing(true);
    setSyncProgress(undefined);
    setError(undefined);
    const version = operationVersion.current;
    try {
      const targets = documentsInScope(dataRef.current.documents, scope);
      const targetKeys = new Set(targets.map(([key]) => key));
      const groups = new Map<string, typeof targets>();
      for (const entry of targets) {
        const group = groups.get(entry[1].localUri) ?? [];
        group.push(entry);
        groups.set(entry[1].localUri, group);
      }
      const removed = new Set<string>();
      const errors: string[] = [];
      for (const [localUri, entries] of groups) {
        const referencedOutsideScope = Object.entries(dataRef.current.documents).some(
          ([key, document]) => !targetKeys.has(key) && document.localUri === localUri,
        );
        try {
          if (!referencedOutsideScope && entries.some(([, document]) => document.localUriTrusted !== false)) {
            await deleteLocalDocument(localUri);
          }
          for (const [key] of entries) removed.add(key);
        } catch (cause) {
          errors.push(`${entries[0][1].remotePath}: ${errorMessage(cause)}`);
        }
      }
      if (version !== operationVersion.current) return;
      if (removed.size > 0) {
        await commit((latest) => {
          if (version !== operationVersion.current) return latest;
          const documents = { ...latest.documents };
          for (const key of removed) delete documents[key];
          return { ...latest, documents };
        });
      }
      if (errors.length > 0) setError(`No se pudieron eliminar ${errors.length} archivos. ${errors[0]}`);
    } catch (cause) {
      if (version === operationVersion.current) setError(errorMessage(cause));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  async function loadCourseResources(courseId: string, force = false): Promise<void> {
    if (!force && dataRef.current.resourcesByCourse[courseId]) return;
    const version = operationVersion.current;
    const resources = await (await getClient()).getCourseResources(courseId);
    if (version !== operationVersion.current) return;
    await commit((latest) => version !== operationVersion.current ? latest : ({
      ...latest,
      resourcesByCourse: { ...latest.resourcesByCourse, [courseId]: resources },
    }));
  }

  async function syncWithClient(client: SakaiClient, current: AppData, scope: DownloadScope): Promise<void> {
    if (syncingRef.current) return;
    syncingRef.current = true;
    availabilityVersion.current += 1;
    setCheckingLocalFiles(false);
    setSyncing(true);
    setSyncProgress(undefined);
    const controller = new AbortController();
    downloadController.current = controller;
    const version = operationVersion.current;
    setActiveDownload(scope);
    try {
      const courses = current.courses.length > 0 ? current.courses : await client.getCourses(controller.signal);
      if (scope.type === 'file' && scope.force) {
        const path = scope.resource.remotePath;
        const resources = await client.getCourseResources(scope.courseId, controller.signal);
        const resource = resources.find((item) => item.remotePath === path);
        if (!resource) throw new Error('Este documento ya no aparece en los recursos de la asignatura.');
        scope = { ...scope, resource };
        setActiveDownload(scope);
        if (version !== operationVersion.current) return;
        const courseId = scope.courseId;
        await commit((latest) => version !== operationVersion.current ? latest : ({
          ...latest, resourcesByCourse: { ...latest.resourcesByCourse, [courseId]: resources },
        }));
      }
      const result = await syncResources(
        client,
        courses,
        current.documents,
        scope,
        current.settings.syncRootUri,
        setSyncProgress,
        controller.signal,
        async (key, document, previousKey) => {
          if (version !== operationVersion.current) return;
          await commit((latest) => {
            if (version !== operationVersion.current) return latest;
            const documents = { ...latest.documents, [key]: document };
            if (previousKey && previousKey !== key) delete documents[previousKey];
            return { ...latest, documents };
          });
        },
      );
      if (version !== operationVersion.current) return;
      await commit((latest) => version !== operationVersion.current ? latest : ({
        ...latest,
        courses,
        resourcesByCourse: { ...latest.resourcesByCourse, ...result.resourcesByCourse },
        lastSyncAt: result.finishedAt,
        lastSyncError: result.errors.length > 0 ? result.errors.join('\n') : undefined,
        settings: {
          ...latest.settings,
          syncRootUri: result.rootUri || latest.settings.syncRootUri,
        },
      }));
      if (version !== operationVersion.current) return;
      if (result.cancelled) setError('Descarga cancelada. Los documentos completados se han conservado.');
      if (result.errors.length > 0) {
        setError(`La sincronización terminó con ${result.errors.length} incidencias: ${result.failed} fallos y ${result.timedOut} archivos omitidos por tiempo.`);
      }
      if (!result.cancelled && (result.total > 0 || result.errors.length > 0) && dataRef.current.settings.notifications) {
        await notifyDownloadFinished(result).catch(() => undefined);
      }
    } catch (cause) {
      if (!controller.signal.aborted) throw cause;
      if (version === operationVersion.current) setError('Descarga cancelada.');
    } finally {
      syncingRef.current = false;
      downloadController.current = null;
      setActiveDownload(undefined);
      setSyncing(false);
      await checkLocalDocuments();
    }
  }

  async function chooseSyncFolder(useDefault = false): Promise<void> {
    if (syncingRef.current) return;
    syncingRef.current = true;
    availabilityVersion.current += 1;
    setCheckingLocalFiles(false);
    setSyncing(true);
    setMovingFiles(true);
    setError(undefined);
    setSyncProgress(undefined);
    const controller = new AbortController();
    downloadController.current = controller;
    const version = operationVersion.current;
    try {
      const current = dataRef.current;
      const selected = useDefault ? undefined : await pickSyncRoot(current.settings.syncRootUri);
      const workspace = await createSyncWorkspace(selected?.uri);
      if (workspace.rootUri === current.settings.syncRootUri) {
        if (version !== operationVersion.current || controller.signal.aborted) return;
        await commit((latest) => {
          if (version !== operationVersion.current || controller.signal.aborted) throw new Error('Traslado cancelado.');
          return { ...latest, settings: { ...latest.settings, syncRootName: workspace.rootName, downloadLocationChosen: true } };
        });
        await checkLocalDocuments(true);
        return;
      }
      await workspace.validateRelocation(
        Object.values(current.documents).filter((document) => document.localUriTrusted !== false).map((document) => document.localUri),
        current.settings.syncRootUri,
      );
      const result = await relocateDocuments(current.documents, current.courses, {
        exists: localDocumentExists,
        copy: (document, segments) => workspace.copyExisting(document, segments, current.settings.syncRootUri, controller.signal),
        persist: async (updates) => {
          await commit((latest) => {
            if (version !== operationVersion.current || controller.signal.aborted) throw new Error('Traslado cancelado.');
            return {
              ...latest,
              documents: { ...latest.documents, ...updates },
              settings: { ...latest.settings, syncRootUri: workspace.rootUri, syncRootName: workspace.rootName, downloadLocationChosen: true },
            };
          });
        },
        removeOriginal: (source, destination) => removeCopiedOriginal(source, destination, current.settings.syncRootUri, controller.signal),
        progress: (done, total, path) => setSyncProgress({ current: done, total, downloaded: done, failed: 0, skipped: 0, timedOut: 0, currentPath: path, courseTitle: 'Trasladando archivos' }),
      }, controller.signal);
      if (version !== operationVersion.current) return;
      if (result.cancelled) { setError('Traslado cancelado. Se conservan los originales que no se han retirado y las copias verificadas.'); return; }
      if (result.retained || result.missing) setError(`Carpeta cambiada. ${result.retained} originales se han conservado por seguridad; ${result.missing} archivos no estaban disponibles.`);
    } catch (cause) {
      if (version === operationVersion.current) setError(errorMessage(cause));
    } finally {
      syncingRef.current = false;
      downloadController.current = null;
      setMovingFiles(false);
      setSyncing(false);
    }
  }

  async function setNotifications(value: boolean): Promise<void> {
    try {
      const enabled = value ? await requestNotificationPermission() : false;
      if (value && !enabled) setError('No se concedio permiso para mostrar notificaciones.');
      await commit((current) => ({ ...current, settings: { ...current.settings, notifications: enabled } }));
      await setBackgroundSyncEnabled(enabled && credentialsSaved).catch(() => false);
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function setPalette(palette: PaletteId): Promise<void> {
    await commit((current) => ({ ...current, settings: { ...current.settings, palette } }));
  }

  async function setColorScheme(colorScheme: ColorSchemePreference): Promise<void> {
    await commit((current) => ({ ...current, settings: { ...current.settings, colorScheme } }));
  }

  async function openSyncFolder(): Promise<void> {
    setError(undefined);
    const uri = dataRef.current.settings.syncRootUri;
    if (!uri) { setError('Selecciona primero una carpeta de descargas.'); return; }
    try { await openSyncRoot(uri); }
    catch (cause) { setError(errorMessage(cause)); }
  }

  async function setCourseAlias(courseId: string, alias: string): Promise<void> {
    const value = alias.trim().slice(0, 120);
    try {
      await commit((current) => {
        const coursePreferences = { ...current.coursePreferences };
        const preference = { ...coursePreferences[courseId], ...(value ? { alias: value } : {}) };
        if (!value) delete preference.alias;
        if (preference.alias || preference.favorite) coursePreferences[courseId] = preference;
        else delete coursePreferences[courseId];
        return { ...current, coursePreferences };
      });
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function setCourseFavorite(courseId: string, favorite: boolean): Promise<void> {
    try {
      await commit((current) => {
        const coursePreferences = { ...current.coursePreferences };
        const preference = { ...coursePreferences[courseId] };
        if (favorite) preference.favorite = true;
        else delete preference.favorite;
        if (preference.alias || preference.favorite) coursePreferences[courseId] = preference;
        else delete coursePreferences[courseId];
        return { ...current, coursePreferences };
      });
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function moveCourse(courseId: string, direction: 'up' | 'down'): Promise<void> {
    try {
      await commit((current) => ({
        ...current,
        courseOrder: moveCourseInOrder(current.courses, current.courseOrder, current.coursePreferences, courseId, direction),
      }));
    } catch (cause) { setError(errorMessage(cause)); }
  }

  async function markAnnouncementRead(id: string): Promise<void> {
    await commit((current) => current.readAnnouncementIds.includes(id) ? current : ({
      ...current, readAnnouncementIds: [...current.readAnnouncementIds, id],
    }));
  }

  async function exportData(): Promise<void> {
    setError(undefined);
    try {
      await exportAppData(dataRef.current);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  async function importData(): Promise<void> {
    if (syncingRef.current) { setError('Termina o cancela la descarga antes de importar datos.'); return; }
    syncingRef.current = true;
    availabilityVersion.current += 1;
    setCheckingLocalFiles(false);
    setSyncing(true);
    setError(undefined);
    const version = operationVersion.current;
    try {
      const imported = await importAppData();
      if (version !== operationVersion.current) return;
      operationVersion.current += 1;
      await commit(() => imported);
      await setBackgroundSyncEnabled(false).catch(() => false);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  async function clearLocalData(): Promise<void> {
    if (syncingRef.current) { setError('Termina o cancela la descarga antes de borrar el indice.'); return; }
    syncingRef.current = true;
    setSyncing(true);
    operationVersion.current += 1;
    availabilityVersion.current += 1;
    setCheckingLocalFiles(false);
    try {
      await setBackgroundSyncEnabled(false).catch(() => false);
      await commit(() => EMPTY_APP_DATA, clearAppData);
      setSyncProgress(undefined);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  async function handleRemoteError(cause: unknown): Promise<void> {
    setError(errorMessage(cause));
    if (cause instanceof SakaiError && (cause.status === 401 || cause.status === 403)) {
      clientRef.current = null;
      const version = operationVersion.current;
      const restored = await restoreAuthenticatedClient(() => version === operationVersion.current).catch(() => null);
      if (version !== operationVersion.current) return;
      if (!restored) {
        const current = dataRef.current;
        const hasOfflineData = current.courses.length > 0 || current.announcements.length > 0;
        setStatus(hasOfflineData ? 'offline' : 'signed-out');
      }
      else clientRef.current = restored;
    }
  }

  const value: AppContextValue = {
    status,
    data,
    error,
    syncing,
    movingFiles,
    refreshing,
    syncProgress,
    activeDownload,
    checkingLocalFiles,
    credentialsSaved,
    canSyncFiles,
    login,
    logout,
    refresh,
    loadCourseResources,
    syncNow,
    checkLocalDocuments,
    deleteDownloads,
    chooseSyncFolder,
    openSyncFolder,
    cancelDownload: () => downloadController.current?.abort(),
    setNotifications,
    setPalette,
    setColorScheme,
    setCourseAlias,
    setCourseFavorite,
    moveCourse,
    markAnnouncementRead,
    exportData,
    importData,
    clearLocalData,
    clearError: () => setError(undefined),
  };

  return <AppContext value={value}>{children}</AppContext>;
}

export function useApp(): AppContextValue {
  const context = use(AppContext);
  if (!context) throw new Error('useApp debe usarse dentro de AppProvider.');
  return context;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Se produjo un error inesperado.';
}

export function unreadAnnouncements(data: AppData): SakaiAnnouncement[] {
  const read = new Set(data.readAnnouncementIds);
  return data.announcements.filter((announcement) => !read.has(announcement.id));
}
