import { SakaiError, type SakaiClient } from '@/lib/sakai-client';
import { desktopError, getDesktopApi, isDesktop } from '@/lib/desktop';
import type { SakaiResource, SyncedDocument } from '@/types/sakai';

export type SyncWorkspace = {
  rootUri: string;
  rootName: string;
  download(resource: SakaiResource, pathSegments: string[], client: SakaiClient, signal?: AbortSignal, onProgress?: (received: number, total?: number) => void): Promise<string>;
  exists(uri: string): boolean | Promise<boolean>;
  validateRelocation(sourceUris: string[], previousRoot?: string): Promise<void>;
  copyExisting(document: SyncedDocument, pathSegments: string[], previousRoot?: string, signal?: AbortSignal): Promise<string>;
};

export const canSyncFiles = isDesktop();

export async function createSyncWorkspace(storedRootUri?: string): Promise<SyncWorkspace> {
  const api = getDesktopApi();
  if (!api) throw new Error('La sincronizacion directa no esta disponible en la version web.');
  try {
    const root = await api.createWorkspace(storedRootUri);
    return { ...root,
      exists: localDocumentExists,
      async validateRelocation(sources) {
        try { await api.validateRelocation(root.rootUri, sources); } catch (cause) { throw desktopError(cause); }
      },
      async copyExisting(document, segments, _previousRoot, signal) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const id = crypto.randomUUID();
        const cancel = () => { void api.cancel(id).catch(() => undefined); };
        const operation = api.copyLocalFile(id, document.localUri, root.rootUri, { contentType: document.contentType }, segments);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        try { return await operation; }
        catch (cause) { throw desktopError(cause); }
        finally { signal?.removeEventListener('abort', cancel); }
      },
      async download(resource, segments, _client, signal, onProgress) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const id = crypto.randomUUID();
        const cancel = () => { void api.cancel(id).catch(() => undefined); };
        const unsubscribe = api.onDownloadProgress((progress) => {
          if (progress.id === id) onProgress?.(progress.received, progress.total);
        });
        const result = api.download(id, root.rootUri, resource, segments);
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        try { return await result; }
        catch (cause) { const error = desktopError(cause); throw new SakaiError(error.message, error.status); }
        finally { signal?.removeEventListener('abort', cancel); unsubscribe(); }
      },
    };
  } catch (cause) { throw desktopError(cause); }
}

export async function pickSyncRoot(_currentUri?: string): Promise<{ uri: string; name: string }> {
  const api = getDesktopApi();
  if (!api) throw new Error('La seleccion de carpetas no esta disponible en la version web.');
  try { return await api.chooseDirectory(); } catch (cause) { throw desktopError(cause); }
}

export async function openSyncRoot(uri: string): Promise<void> {
  const api = getDesktopApi();
  if (!api) throw new Error('No se puede abrir la carpeta de descargas en el navegador.');
  try { await api.openRoot(uri); } catch (cause) { throw desktopError(cause); }
}

export async function shareLocalDocument(uri: string, _mimeType?: string): Promise<void> {
  const api = getDesktopApi();
  if (!api) throw new Error('El documento pertenece a una exportacion movil y no esta disponible en la web.');
  try { await api.openFile(uri); } catch (cause) { throw desktopError(cause); }
}

export async function localDocumentExists(uri: string): Promise<boolean> {
  try { return await getDesktopApi()?.exists(uri) ?? false; } catch { return false; }
}

export async function deleteLocalDocument(uri: string): Promise<void> {
  const api = getDesktopApi();
  if (!api) throw new Error('El borrado de archivos locales no esta disponible en la version web.');
  try { await api.deleteFile(uri); } catch (cause) { throw desktopError(cause); }
}

export async function removeCopiedOriginal(source: string, destination: string, _previousRoot?: string, signal?: AbortSignal): Promise<void> {
  const api = getDesktopApi();
  if (!api) throw new Error('El traslado no esta disponible en el navegador.');
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const id = crypto.randomUUID();
  const cancel = () => { void api.cancel(id).catch(() => undefined); };
  const operation = api.removeCopiedOriginal(id, source, destination);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  try { await operation; } catch (cause) { throw desktopError(cause); }
  finally { signal?.removeEventListener('abort', cancel); }
}
