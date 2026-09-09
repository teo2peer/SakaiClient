import { createSyncWorkspace } from '@/lib/files';
import { courseFolderName, resourceFingerprint, resourcePathPlan } from '@/lib/paths';
import { SakaiError, type SakaiClient } from '@/lib/sakai-client';
import type {
  SakaiCourse,
  DownloadScope,
  SakaiResource,
  SyncProgress,
  SyncResult,
  SyncedDocument,
} from '@/types/sakai';

export const DOWNLOAD_TIMEOUT_MS = 30_000;

export async function syncResources(
  client: SakaiClient,
  courses: SakaiCourse[],
  currentDocuments: Record<string, SyncedDocument>,
  scope: DownloadScope,
  storedRootUri?: string,
  onProgress?: (progress: SyncProgress) => void,
  signal?: AbortSignal,
  onDocument?: (key: string, document: SyncedDocument, previousKey?: string) => Promise<void>,
  downloadTimeoutMs = DOWNLOAD_TIMEOUT_MS,
): Promise<SyncResult & { rootUri: string }> {
  const selectedCourses = scope.type === 'all' ? courses : courses.filter((course) => course.id === scope.courseId);
  if (!selectedCourses.length && scope.type !== 'all') throw new Error('La asignatura seleccionada no esta disponible.');
  console.info(`Sakai sync: started scope=${scope.type} courses=${selectedCourses.length}`);
  const errors: string[] = [];
  const resourcesByCourse: {
    course: SakaiCourse;
    resources: Awaited<ReturnType<SakaiClient['getCourseResources']>>;
  }[] = [];

  for (const course of selectedCourses) {
    if (signal?.aborted) break;
    try {
      resourcesByCourse.push({ course, resources: scope.type === 'file'
        ? [scope.resource] : await client.getCourseResources(course.id, signal) });
    } catch (error) {
      if (signal?.aborted) break;
      if (error instanceof SakaiError && error.status === 401) throw error;
      errors.push(`${course.title}: ${errorMessage(error)}`);
    }
  }

  const total = resourcesByCourse.reduce(
    (sum, item) => sum + selectDownloadResources(item.resources, scope).length, 0,
  );
  const selectedResources = resourcesByCourse.flatMap((item) => selectDownloadResources(item.resources, scope));
  const totalBytes = selectedResources.every((resource) => resource.size !== undefined)
    ? selectedResources.reduce((sum, resource) => sum + (resource.size ?? 0), 0)
    : undefined;
  console.info(`Sakai sync: discovered resources=${total} errors=${errors.length}`);
  const documents = { ...currentDocuments };
  const previousByPath = new Map(Object.values(currentDocuments).map((document) => [`${document.courseId}:${document.remotePath}`, document]));
  const progress: SyncProgress = {
    current: 0,
    total,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    timedOut: 0,
    completedBytes: 0,
    totalBytes,
  };

  onProgress?.({ ...progress });
  const workspace = total && !signal?.aborted ? await createSyncWorkspace(storedRootUri) : undefined;

  downloadLoop: for (const { course, resources } of resourcesByCourse) {
    const courseFolder = courseFolderName(course, courses);
    const courseResources = selectDownloadResources(resources, scope);
    const selectedPaths = new Set(courseResources.map((resource) => resource.remotePath));
    const planningResources = [
      ...courseResources,
      ...Object.values(currentDocuments).filter((document) => document.courseId === course.id && !selectedPaths.has(document.remotePath)),
    ];
    const paths = resourcePathPlan(planningResources);
    for (const resource of courseResources) {
      if (signal?.aborted || !workspace) break downloadLoop;
      const documentKey = `${course.id}:${resource.id}`;
      const fingerprint = resourceFingerprint(resource);
      const previous = documents[documentKey] ?? previousByPath.get(`${course.id}:${resource.remotePath}`);
      const previousKey = previous ? `${previous.courseId}:${previous.id}` : undefined;
      Object.assign(progress, {
        courseId: course.id,
        courseTitle: course.title,
        currentPath: resource.remotePath,
        fileProgress: 0,
        fileBytesReceived: 0,
        fileBytesTotal: resource.size,
      });
      onProgress?.({ ...progress });

      const timed = linkedTimeout(signal, downloadTimeoutMs);
      let previousExists = false;
      try {
        previousExists = previous && previous.localUriTrusted !== false
          ? await abortable(Promise.resolve(workspace.exists(previous.localUri)), timed.signal)
          : false;
        if (previous?.fingerprint === fingerprint && previousExists && previous.localUriTrusted !== false && !(scope.type === 'file' && scope.force)) {
          timed.dispose();
          if (previous.available !== true) {
            const nextDocument = { ...previous, available: true, localUriTrusted: true };
            await onDocument?.(documentKey, nextDocument, previousKey);
            if (previousKey && previousKey !== documentKey) delete documents[previousKey];
            documents[documentKey] = nextDocument;
          }
          progress.skipped += 1;
        } else {
          const localUri = await workspace.download(
            resource,
            [courseFolder, ...(paths.get(resource) ?? [])],
            client,
            timed.signal,
            (received, bytesTotal) => {
              const denominator = bytesTotal && bytesTotal > 0 ? bytesTotal : resource.size;
              progress.fileBytesReceived = received;
              progress.fileBytesTotal = denominator;
              progress.fileProgress = denominator && denominator > 0
                ? Math.max(0, Math.min(1, received / denominator))
                : undefined;
              onProgress?.({ ...progress });
            },
          );
          timed.dispose();
          const nextDocument: SyncedDocument = {
            ...resource,
            localUri,
            fingerprint,
            syncedAt: new Date().toISOString(),
            available: true,
            localUriTrusted: true,
          };
          await onDocument?.(documentKey, nextDocument, previousKey);
          if (previousKey && previousKey !== documentKey) delete documents[previousKey];
          documents[documentKey] = nextDocument;
          progress.downloaded += 1;
        }
      } catch (error) {
        if (signal?.aborted) break downloadLoop;
        if (error instanceof SakaiError && error.status === 401) throw error;
        if (previous && !previousExists && previousKey) {
          documents[previousKey] = { ...previous, available: false };
          if (onDocument) await onDocument(previousKey, documents[previousKey]).catch(() => undefined);
        }
        if (timed.didTimeOut()) {
          progress.timedOut += 1;
          const seconds = Math.ceil(downloadTimeoutMs / 1000);
          errors.push(`${course.title}/${resource.remotePath}: omitido tras ${seconds} ${seconds === 1 ? 'segundo' : 'segundos'}`);
        } else {
          progress.failed += 1;
          errors.push(`${course.title}/${resource.remotePath}: ${errorMessage(error)}`);
        }
      } finally {
        timed.dispose();
      }

      progress.current += 1;
      if (progress.totalBytes !== undefined) progress.completedBytes = (progress.completedBytes ?? 0) + (resource.size ?? 0);
      progress.fileProgress = undefined;
      progress.fileBytesReceived = undefined;
      progress.fileBytesTotal = undefined;
      onProgress?.({ ...progress });
    }
  }

  console.info(`Sakai sync: finished downloaded=${progress.downloaded} skipped=${progress.skipped} failed=${progress.failed}`);
  return {
    ...progress,
    documents,
    resourcesByCourse: Object.fromEntries(
      scope.type === 'file' ? [] : resourcesByCourse.map(({ course, resources }) => [course.id, resources]),
    ),
    errors,
    finishedAt: new Date().toISOString(),
    rootUri: workspace?.rootUri ?? storedRootUri ?? '',
    cancelled: signal?.aborted ?? false,
  };
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function linkedTimeout(parent: AbortSignal | undefined, milliseconds: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', abort, { once: true });
  if (parent?.aborted) abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('Download timeout'));
  }, milliseconds);
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort); },
  };
}

export function selectDownloadResources(resources: SakaiResource[], scope: DownloadScope): SakaiResource[] {
  if (scope.type === 'folder' && (!scope.path || scope.path.split('/').some((part) => part === '..'))) {
    throw new Error('La carpeta seleccionada no es valida.');
  }
  return resources.filter((resource) => !resource.isFolder && (
    scope.type === 'all' ||
    (resource.courseId === scope.courseId && (
      scope.type === 'course' ||
      (scope.type === 'folder' && resource.remotePath.startsWith(`${scope.path.replace(/\/+$/, '')}/`)) ||
      (scope.type === 'file' && resource.remotePath === scope.resource.remotePath)
    ))
  ));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error desconocido';
}
