import type { SyncedDocument } from '@/types/sakai';

export async function checkDocumentAvailability(
  documents: Record<string, SyncedDocument>,
  exists: (uri: string) => boolean | Promise<boolean>,
  concurrency = 6,
): Promise<Record<string, boolean>> {
  const uris = [...new Set(Object.values(documents).filter((document) => document.localUriTrusted !== false).map((document) => document.localUri).filter(Boolean))];
  const availability = new Map<string, boolean>();
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), uris.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= uris.length) return;
      const uri = uris[index];
      try { availability.set(uri, await exists(uri)); }
      catch { availability.set(uri, false); }
    }
  });
  await Promise.all(workers);
  return Object.fromEntries(Object.entries(documents).map(([key, document]) => [
    key,
    document.localUriTrusted !== false && availability.get(document.localUri) === true,
  ]));
}
