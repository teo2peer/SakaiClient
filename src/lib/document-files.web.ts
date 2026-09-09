import { desktopError, getDesktopApi } from '@/lib/desktop';
import { readOfficeDocument, type DocumentKind } from '@/lib/document-reader';

export async function readPreviewBase64(uri: string): Promise<string> {
  const api = getDesktopApi();
  if (!api) throw new Error('La exportacion web solo contiene el indice, no los archivos del dispositivo.');
  try { return await api.readFileBase64(uri); } catch (cause) { throw desktopError(cause); }
}

export async function readPreviewBlocks(uri: string, kind: DocumentKind) {
  const encoded = await readPreviewBase64(uri);
  return readOfficeDocument(Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)), kind);
}
