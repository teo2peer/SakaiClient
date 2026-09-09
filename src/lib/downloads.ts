import type { SyncedDocument } from '@/types/sakai';

/**
 * Scope of a local-only removal. It never touches PoliformaT: it selects the
 * indexed copies stored on this device so they can be deleted and forgotten.
 */
export type LocalDeleteScope =
  | { type: 'course'; courseId: string }
  | { type: 'folder'; courseId: string; path: string }
  | { type: 'file'; courseId: string; path: string };

/** Indexed documents the scope selects, as `[documentKey, document]` entries. */
export function documentsInScope(
  documents: Record<string, SyncedDocument>,
  scope: LocalDeleteScope,
): [string, SyncedDocument][] {
  const path = scope.type === 'course' ? '' : scope.path.replace(/\/+$/, '');
  if (scope.type !== 'course' && (!path || path.split('/').some((part) => part === '..'))) {
    throw new Error('La ruta seleccionada no es válida.');
  }
  return Object.entries(documents).filter(([, document]) => document.courseId === scope.courseId && (
    scope.type === 'course' ||
    (scope.type === 'folder' && document.remotePath.startsWith(`${path}/`)) ||
    (scope.type === 'file' && document.remotePath === path)
  ));
}
