import type { SakaiClient } from '@/lib/sakai-client';
import type { SakaiResource, SyncedDocument } from '@/types/sakai';

export type SyncWorkspace = {
  rootUri: string;
  rootName: string;
  download(resource: SakaiResource, pathSegments: string[], client: SakaiClient, signal?: AbortSignal, onProgress?: (received: number, total?: number) => void): Promise<string>;
  exists(uri: string): boolean | Promise<boolean>;
  validateRelocation(sourceUris: string[], previousRoot?: string): Promise<void>;
  copyExisting(document: SyncedDocument, pathSegments: string[], previousRoot?: string, signal?: AbortSignal): Promise<string>;
};

export const canSyncFiles = false;

export async function createSyncWorkspace(_storedRootUri?: string): Promise<SyncWorkspace> {
  throw new Error('La sincronizacion de archivos no esta disponible en esta plataforma.');
}

export async function pickSyncRoot(_currentUri?: string): Promise<{ uri: string; name: string }> {
  throw new Error('La seleccion de carpetas no esta disponible en esta plataforma.');
}

export async function openSyncRoot(_uri: string): Promise<void> {
  throw new Error('No se puede abrir la carpeta de descargas en esta plataforma.');
}

export async function shareLocalDocument(_uri: string, _mimeType?: string): Promise<void> {
  throw new Error('No se puede abrir el documento en esta plataforma.');
}

export async function localDocumentExists(_uri: string): Promise<boolean> { return false; }

export async function deleteLocalDocument(_uri: string): Promise<void> {
  throw new Error('El borrado de archivos locales no esta disponible en esta plataforma.');
}

export async function removeCopiedOriginal(_source: string, _destination: string, _previousRoot?: string, _signal?: AbortSignal): Promise<void> {
  throw new Error('El traslado de documentos no esta disponible en esta plataforma.');
}
