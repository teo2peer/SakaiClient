import { courseFolderName, resourcePathPlan } from '@/lib/paths';
import type { SakaiCourse, SyncedDocument } from '@/types/sakai';

export function relocationUriPath(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'content:') {
    const marker = url.pathname.includes('/document/') ? '/document/' : '/tree/';
    const id = url.pathname.slice(url.pathname.indexOf(marker) + marker.length);
    return `content://${url.host}/${decodeURIComponent(id).replace(/\/+$/, '').normalize('NFC')}`;
  }
  // Names travel between NFC and NFD depending on the platform, so paths are only
  // comparable once normalized.
  return decodeURIComponent(url.href).replace(/\/private\/var\//, '/var/').replace(/\/+$/, '').normalize('NFC');
}

export async function relocateDocuments(
  documents: Record<string, SyncedDocument>,
  courses: SakaiCourse[],
  operations: {
    exists(uri: string): Promise<boolean>;
    copy(document: SyncedDocument, segments: string[]): Promise<string>;
    persist(updates: Record<string, SyncedDocument>): Promise<void>;
    removeOriginal(source: string, destination: string): Promise<void>;
    progress?(current: number, total: number, path: string): void;
  },
  signal?: AbortSignal,
): Promise<{ retained: number; missing: number; cancelled: boolean }> {
  const groups = new Map<string, [string, SyncedDocument][]>();
  for (const entry of Object.entries(documents)) {
    const existing = groups.get(entry[1].localUri) ?? [];
    existing.push(entry);
    groups.set(entry[1].localUri, existing);
  }
  const representatives = [...groups.values()].map((entries) => entries[0][1]);
  const pathPlans = new Map([...new Set([...courses.map((course) => course.id), ...representatives.map((document) => document.courseId)])].map((courseId) => {
    const resources = representatives.filter((document) => document.courseId === courseId);
    return [courseId, resourcePathPlan(resources)] as const;
  }));
  let current = 0;
  let retained = 0;
  let missing = 0;
  const updates: Record<string, SyncedDocument> = {};
  const originals: { source: string; destination: string }[] = [];
  for (const [source, entries] of groups) {
    if (signal?.aborted) break;
    const document = entries[0][1];
    operations.progress?.(current, groups.size, document.remotePath);
    if (!entries.some(([, value]) => value.localUriTrusted !== false) || !await operations.exists(source)) {
      for (const [key, value] of entries) updates[key] = { ...value, available: false };
      missing += 1;
      current += 1;
      operations.progress?.(current, groups.size, document.remotePath);
      continue;
    }
    const course = courses.find((item) => item.id === document.courseId) ?? { id: document.courseId, title: document.courseId, description: '' };
    const plan = pathPlans.get(document.courseId) ?? resourcePathPlan([document]);
    const destination = await operations.copy(document, [courseFolderName(course, courses), ...(plan.get(document) ?? [])]);
    if (signal?.aborted) break;
    for (const [key, value] of entries) updates[key] = { ...value, localUri: destination, available: true, localUriTrusted: true };
    if (source !== destination) originals.push({ source, destination });
    current += 1;
    operations.progress?.(current, groups.size, document.remotePath);
  }
  if (signal?.aborted) return { retained, missing, cancelled: true };
  // Switch every reference and the selected root together, after all copies are verified.
  await operations.persist(updates);
  const destinations = new Set(Object.values(updates).map((document) => document.localUri));
  for (const { source, destination } of originals) {
    if (signal?.aborted || destinations.has(source)) { retained += 1; continue; }
    try { await operations.removeOriginal(source, destination); } catch { retained += 1; }
  }
  return { retained, missing, cancelled: signal?.aborted ?? false };
}
