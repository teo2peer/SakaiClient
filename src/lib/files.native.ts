import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { DEFAULT_SYNC_FOLDER } from '@/lib/constants';
import { SakaiError, type SakaiClient } from '@/lib/sakai-client';
import { relocationUriPath } from '@/lib/relocate-documents';
import type { SakaiResource, SyncedDocument } from '@/types/sakai';

export type SyncWorkspace = {
  rootUri: string;
  rootName: string;
  download(resource: SakaiResource, pathSegments: string[], client: SakaiClient, signal?: AbortSignal, onProgress?: (received: number, total?: number) => void): Promise<string>;
  exists(uri: string): boolean | Promise<boolean>;
  validateRelocation(sourceUris: string[], previousRoot?: string): Promise<void>;
  copyExisting(document: SyncedDocument, pathSegments: string[], previousRoot?: string, signal?: AbortSignal): Promise<string>;
};

export const canSyncFiles = true;
const selectedDirectories = new Map<string, Directory>();

export async function localDocumentExists(uri: string): Promise<boolean> {
  try { return new File(uri).exists; } catch { return false; }
}

export async function createSyncWorkspace(storedRootUri?: string): Promise<SyncWorkspace> {
  let root: Directory;

  if (storedRootUri) {
    root = selectedDirectories.get(storedRootUri) ?? new Directory(storedRootUri);
    if (!root.exists) {
      throw new Error('La carpeta de sincronizacion ya no esta disponible. Seleccionala de nuevo.');
    }
  } else {
    root = new Directory(Paths.document, DEFAULT_SYNC_FOLDER);
    root.create({ idempotent: true, intermediates: true });
  }

  const directoryCache = new Map<string, Directory>([[root.uri, root]]);

  return {
    rootUri: root.uri,
    rootName: root.name || DEFAULT_SYNC_FOLDER,
    exists(uri) {
      try {
        return new File(uri).exists;
      } catch {
        return false;
      }
    },
    async validateRelocation(sourceUris, previousRoot) {
      const roots = [new Directory(Paths.document, DEFAULT_SYNC_FOLDER).uri, ...(previousRoot ? [previousRoot] : []), ...selectedDirectories.keys()];
      for (const sourceRoot of roots) {
        if (!sourceUris.some((uri) => withinRoot(uri, sourceRoot))) continue;
        if (withinRoot(root.uri, sourceRoot) || withinRoot(sourceRoot, root.uri)) {
          throw new Error('Elige una carpeta independiente, no una subcarpeta o carpeta superior del origen.');
        }
      }
    },
    async copyExisting(document, pathSegments, previousRoot, signal) {
      const source = new File(document.localUri);
      const roots = [root.uri, new Directory(Paths.document, DEFAULT_SYNC_FOLDER).uri, ...(previousRoot ? [previousRoot] : []), ...selectedDirectories.keys()];
      if (!roots.some((uri) => withinRoot(source.uri, uri))) throw new Error('Vuelve a autorizar la carpeta de origen antes de trasladar sus archivos.');
      const directory = ensureDirectory(root, pathSegments.slice(0, -1), directoryCache);
      const name = pathSegments.at(-1) ?? document.name;
      const existing = findFile(directory, name);
      if (existing) {
        if (existing.uri === source.uri || await sameContents(source, existing, signal)) return existing.uri;
        throw new Error(`Ya existe otro archivo en el destino: ${name}`);
      }
      const temporaryName = `.${name}.sakai-relocate`;
      deleteFileIfPresent(directory, temporaryName);
      const temporary = directory.createFile(temporaryName, document.contentType ?? null);
      try {
        const input = source.open(FileMode.ReadOnly);
        try {
          const output = temporary.open(FileMode.WriteOnly);
          try {
            let chunks = 0;
            for (;;) {
              if (signal?.aborted) throw new Error('Traslado cancelado.');
              const bytes = input.readBytes(64 * 1024);
              if (!bytes.length) break;
              output.writeBytes(bytes);
              if (++chunks % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
            }
          } finally { output.close(); }
        } finally { input.close(); }
        if (!await sameContents(source, temporary, signal)) throw new Error('No se pudo verificar la copia del documento.');
        if (signal?.aborted) throw new Error('Traslado cancelado.');
        await temporary.move(new File(directory, name), { overwrite: false });
        return temporary.uri;
      } catch (cause) { if (temporary.exists && temporary.name === temporaryName) temporary.delete(); throw cause; }
    },
    async download(resource, pathSegments, client, signal, onProgress) {
      const fileName = pathSegments.at(-1) ?? resource.name;
      const directory = ensureDirectory(root, pathSegments.slice(0, -1), directoryCache);
      restoreInterruptedReplacement(directory, fileName);

      const temporaryName = `.${fileName}.sakai-download`;
      const backupName = `.${fileName}.sakai-backup`;
      deleteFileIfPresent(directory, temporaryName);
      deleteFileIfPresent(directory, backupName);

      const temporaryFile = directory.createFile(temporaryName, resource.contentType ?? null);
      try {
        const handle = temporaryFile.open(FileMode.WriteOnly);
        try {
          await client.downloadResource(resource, new WritableStream<Uint8Array>({
            write(chunk) { handle.writeBytes(chunk); },
          }), signal, onProgress);
        } finally {
          handle.close();
        }
        validateDownload(temporaryFile, resource);

        const currentFile = findFile(directory, fileName);
        if (currentFile) currentFile.rename(backupName);
        temporaryFile.rename(fileName);
        deleteFileIfPresent(directory, backupName);
        return temporaryFile.uri;
      } catch (error) {
        if (temporaryFile.exists) temporaryFile.delete();
        restoreInterruptedReplacement(directory, fileName);
        throw error;
      }
    },
  };
}

export async function pickSyncRoot(currentUri?: string): Promise<{ uri: string; name: string }> {
  const directory = await Directory.pickDirectoryAsync(currentUri);
  selectedDirectories.set(directory.uri, directory);
  return { uri: directory.uri, name: directory.name };
}

export async function openSyncRoot(_uri: string): Promise<void> {
  throw new Error('Abre la carpeta desde la aplicacion Archivos del dispositivo.');
}

export async function shareLocalDocument(uri: string, mimeType?: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('No hay ninguna aplicacion disponible para abrir este documento.');
  }
  await Sharing.shareAsync(uri, { mimeType });
}

export async function deleteLocalDocument(uri: string): Promise<void> {
  const file = new File(uri);
  // A file already gone counts as deleted: the caller only has to forget its index entry.
  if (file.exists) file.delete();
}

export async function removeCopiedOriginal(sourceUri: string, destinationUri: string, previousRoot?: string, signal?: AbortSignal): Promise<void> {
  if (sourceUri === destinationUri) return;
  const roots = [new Directory(Paths.document, DEFAULT_SYNC_FOLDER).uri, ...(previousRoot ? [previousRoot] : [])];
  if (!roots.some((uri) => withinRoot(sourceUri, uri))) throw new Error('Se conserva la copia anterior fuera de la carpeta autorizada.');
  const source = new File(sourceUri);
  if (!await sameContents(source, new File(destinationUri), signal)) throw new Error('El original ha cambiado y se conserva.');
  if (signal?.aborted) throw new Error('Traslado cancelado.');
  source.delete();
}

function withinRoot(uri: string, root: string): boolean {
  try {
    return relocationUriPath(uri).startsWith(`${relocationUriPath(root)}/`);
  }
  catch { return false; }
}

async function sameContents(first: File, second: File, signal?: AbortSignal): Promise<boolean> {
  if (first.size !== second.size) return false;
  const left = first.open(FileMode.ReadOnly);
  try {
    const right = second.open(FileMode.ReadOnly);
    try {
      let chunks = 0;
      for (;;) {
        if (signal?.aborted) throw new Error('Traslado cancelado.');
        const a = left.readBytes(64 * 1024);
        const b = right.readBytes(64 * 1024);
        if (a.length !== b.length || a.some((value, index) => value !== b[index])) return false;
        if (!a.length) return true;
        if (++chunks % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
    } finally { right.close(); }
  } finally { left.close(); }
}

function ensureDirectory(
  root: Directory,
  segments: string[],
  cache: Map<string, Directory>,
): Directory {
  let current = root;
  for (const segment of segments) {
    const key = `${current.uri}::${segment}`;
    const cached = cache.get(key);
    if (cached?.exists) {
      current = cached;
      continue;
    }

    const existing = findDirectory(current, segment);
    try {
      current = existing ?? current.createDirectory(segment);
    } catch (cause) {
      // The name may already be taken by an entry the listing reported under a
      // different Unicode normalization than the one the platform stores.
      const created = findDirectory(current, segment);
      if (!created) throw cause;
      current = created;
    }
    cache.set(key, current);
  }
  return current;
}

function findDirectory(directory: Directory, name: string): Directory | undefined {
  return directory.list().find((entry): entry is Directory => entry instanceof Directory && sameName(entry.name, name));
}

function findFile(directory: Directory, name: string): File | undefined {
  return directory.list().find((entry): entry is File => entry instanceof File && sameName(entry.name, name));
}

// iOS reports names decomposed (NFD) while the app sanitizes them to NFC, so accented
// names only match once both sides use the same normalization.
function sameName(left: string, right: string): boolean {
  return left === right || left.normalize('NFC') === right.normalize('NFC');
}

function deleteFileIfPresent(directory: Directory, name: string): void {
  const file = findFile(directory, name);
  if (file) file.delete();
}

function restoreInterruptedReplacement(directory: Directory, fileName: string): void {
  const backupName = `.${fileName}.sakai-backup`;
  const current = findFile(directory, fileName);
  const backup = findFile(directory, backupName);
  if (!current && backup) backup.rename(fileName);
  else if (current && backup) backup.delete();
}

function validateDownload(file: File, resource: SakaiResource): void {
  if (resource.size != null && resource.size > 0 && file.size !== resource.size) {
    throw new Error(`Descarga incompleta: ${resource.remotePath}`);
  }
  if (file.size === 0 && resource.size !== 0) {
    throw new Error(`PoliformaT devolvio un archivo vacio: ${resource.remotePath}`);
  }

  const handle = file.open(FileMode.ReadOnly);
  let bytes: Uint8Array;
  try {
    bytes = handle.readBytes(Math.min(file.size, 1024));
  } finally {
    handle.close();
  }
  const prefix = String.fromCharCode(...bytes).toLowerCase();
  const looksLikeHtml = /^(?:\s|<!--.*?-->|<\?xml.*?\?>)*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<form\b)/s.test(prefix);
  const looksLikeLogin =
    prefix.includes('<title>universitat politecnica de valencia - log in') ||
    (prefix.includes('<html') && (prefix.includes('/cas/login') || prefix.includes('log in')));
  if (looksLikeLogin) {
    throw new SakaiError('La sesion ha caducado al descargar documentos.', 401);
  }
  const expectsHtml = /(?:text\/html|application\/xhtml\+xml)/i.test(resource.contentType ?? '') || /\.html?$/i.test(resource.name);
  if (looksLikeHtml && !expectsHtml) throw new Error(`PoliformaT devolvio HTML en lugar del documento: ${resource.remotePath}`);
  const expectsPdf = resource.contentType === 'application/pdf' || /\.pdf$/i.test(resource.name);
  if (expectsPdf && !prefix.includes('%pdf-')) throw new Error(`El PDF descargado no es valido: ${resource.remotePath}`);
}
