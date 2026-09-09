import { stripHtml } from '@/lib/text';
import type { SakaiAnnouncement } from '@/types/sakai';

export function filterAnnouncements(
  announcements: SakaiAnnouncement[],
  query: string,
  courseId: string,
  unreadOnly: boolean,
  readIds: string[],
): SakaiAnnouncement[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const search = normalize(query.trim());
  const read = new Set(readIds);
  return announcements.filter((item) =>
    (!courseId || item.courseId === courseId) &&
    (!unreadOnly || !read.has(item.id)) &&
    (!search || normalize(`${item.title} ${item.courseTitle} ${item.author} ${stripHtml(item.body)}`).includes(search)),
  );
}

export function isWebUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
