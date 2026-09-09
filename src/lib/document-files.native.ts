import { File } from 'expo-file-system';
import { MAX_PREVIEW_BYTES, readOfficeDocument, type DocumentKind } from '@/lib/document-reader';

function previewFile(uri: string): File {
  if (!/^(file|content):\/\//.test(uri)) throw new Error('El visor solo admite archivos locales.');
  const file = new File(uri);
  if (!file.exists) throw new Error('El archivo ya no esta en el dispositivo. Vuelve a descargarlo.');
  if (file.size > MAX_PREVIEW_BYTES) throw new Error('El archivo supera los 32 MB del visor integrado. Puedes abrir el original en otra app.');
  return file;
}

export async function readPreviewBase64(uri: string): Promise<string> { return previewFile(uri).base64(); }
export async function readPreviewBlocks(uri: string, kind: DocumentKind) {
  return readOfficeDocument(await previewFile(uri).bytes(), kind);
}
