import type { SakaiAnnouncement } from '@/types/sakai';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { desktopError, getDesktopApi } from '@/lib/desktop';

export async function requestNotificationPermission(): Promise<boolean> {
  try { return await getDesktopApi()?.notificationPermission() ?? false; } catch (cause) { throw desktopError(cause); }
}

export async function notifyNewAnnouncements(announcements: SakaiAnnouncement[], shouldContinue = () => true): Promise<void> {
  const api = getDesktopApi();
  if (!api) return;
  const value = await AsyncStorage.getItem('sakai-client.desktop-notified.v1');
  let previous: string[] = [];
  try { const parsed = JSON.parse(value ?? '[]'); if (Array.isArray(parsed)) previous = parsed.filter((id) => typeof id === 'string'); } catch {}
  const known = new Set(previous);
  const pending = announcements.filter((item) => !known.has(item.id));
  for (const item of pending.slice(0, 5)) {
    if (!shouldContinue()) return;
    try { await api.notify({ id: item.id, title: item.courseTitle, body: item.title }); }
    catch (cause) { throw desktopError(cause); }
  }
  if (!shouldContinue()) return;
  if (pending.length > 5) await api.notify({ id: '__sakai_inbox__', title: 'Mas anuncios de PoliformaT', body: `${pending.length - 5} anuncios adicionales en tu bandeja.` });
  await AsyncStorage.setItem('sakai-client.desktop-notified.v1', JSON.stringify([...new Set([...previous, ...pending.map((item) => item.id)])].slice(-2000)));
}

export async function notifyDownloadFinished(result: { downloaded: number; skipped: number; failed: number; timedOut: number; total: number; errors?: readonly string[] }): Promise<void> {
  const api = getDesktopApi();
  if (!api || !await api.notificationPermission()) return;
  const issues = Math.max(result.failed + result.timedOut, result.errors?.length ?? 0);
  const otherIssues = Math.max(0, issues - result.failed - result.timedOut);
  try {
    await api.notify({
      id: '__sakai_downloads__',
      title: issues ? 'Descarga finalizada con incidencias' : 'Descarga completada',
      body: `${result.downloaded} descargados · ${result.skipped} ya disponibles${result.timedOut ? ` · ${result.timedOut} omitidos por tiempo` : ''}${result.failed ? ` · ${result.failed} fallidos` : ''}${otherIssues ? ` · ${otherIssues} incidencias` : ''}`,
    });
  } catch (cause) { throw desktopError(cause); }
}

export function subscribeAnnouncementOpen(onOpen: (id: string | null) => void): () => void { return getDesktopApi()?.onAnnouncementOpen(onOpen) ?? (() => {}); }
