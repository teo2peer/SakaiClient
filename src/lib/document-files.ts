import type { DocumentBlock, DocumentKind } from '@/lib/document-reader';

export async function readPreviewBase64(_uri: string): Promise<string> {
  throw new Error('La exportacion web solo contiene el indice, no los archivos del dispositivo.');
}
export async function readPreviewBlocks(_uri: string, _kind: DocumentKind): Promise<DocumentBlock[]> {
  throw new Error('Los documentos del dispositivo no estan disponibles en este navegador.');
}
