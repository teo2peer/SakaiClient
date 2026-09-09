import type { SakaiAnnouncement } from '@/types/sakai';

export async function requestNotificationPermission(): Promise<boolean> {
  return false;
}

export async function notifyNewAnnouncements(_announcements: SakaiAnnouncement[], _shouldContinue?: () => boolean): Promise<void> {}

export async function notifyDownloadFinished(_result: { downloaded: number; skipped: number; failed: number; timedOut: number; total: number; errors?: readonly string[] }): Promise<void> {}

export function subscribeAnnouncementOpen(_onOpen: (id: string | null) => void): () => void { return () => {}; }
