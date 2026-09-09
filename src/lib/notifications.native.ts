import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import type { SakaiAnnouncement } from '@/types/sakai';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    await ensureChannels();
  }
  const current = await Notifications.getPermissionsAsync();
  if (notificationAllowed(current)) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return notificationAllowed(requested);
}

let notificationQueue: Promise<void> = Promise.resolve();

export function notifyNewAnnouncements(announcements: SakaiAnnouncement[], shouldContinue = () => true): Promise<void> {
  notificationQueue = notificationQueue.catch(() => undefined).then(async () => {
    if (!shouldContinue()) return;
    const stored = await AsyncStorage.getItem('sakai-client.notified.v1');
    let previous: string[] = [];
    try { const parsed = JSON.parse(stored ?? '[]'); if (Array.isArray(parsed)) previous = parsed.filter((id) => typeof id === 'string'); } catch {}
    const known = new Set(previous);
    const pending = announcements.filter((announcement) => !known.has(announcement.id));
    for (const announcement of pending.slice(0, 5)) {
      if (!shouldContinue()) return;
    await Notifications.scheduleNotificationAsync({
      identifier: `sakai-announcement-${announcement.id}`,
      content: {
        title: announcement.courseTitle,
        body: announcement.title,
        data: { announcementId: announcement.id },
      },
      trigger: Platform.OS === 'android' ? { channelId: 'announcements' } : null,
    });
    }
    if (!shouldContinue()) return;
    if (pending.length > 5) await Notifications.scheduleNotificationAsync({
      content: { title: 'Más anuncios de PoliformaT', body: `${pending.length - 5} anuncios adicionales en tu bandeja.`, data: { screen: 'announcements' } }, trigger: Platform.OS === 'android' ? { channelId: 'announcements' } : null,
    });
    await AsyncStorage.setItem('sakai-client.notified.v1', JSON.stringify([...new Set([...previous, ...pending.map((item) => item.id)])].slice(-2000)));
  });
  return notificationQueue;
}

export async function notifyDownloadFinished(result: { downloaded: number; skipped: number; failed: number; timedOut: number; total: number; errors?: readonly string[] }): Promise<void> {
  if (Platform.OS === 'android') await ensureChannels();
  const permission = await Notifications.getPermissionsAsync();
  if (!notificationAllowed(permission)) return;
  const issues = Math.max(result.failed + result.timedOut, result.errors?.length ?? 0);
  const otherIssues = Math.max(0, issues - result.failed - result.timedOut);
  await Notifications.scheduleNotificationAsync({
    identifier: `sakai-download-${Date.now()}`,
    content: {
      title: issues ? 'Descarga finalizada con incidencias' : 'Descarga completada',
      body: `${result.downloaded} descargados · ${result.skipped} ya disponibles${result.timedOut ? ` · ${result.timedOut} omitidos por tiempo` : ''}${result.failed ? ` · ${result.failed} fallidos` : ''}${otherIssues ? ` · ${otherIssues} incidencias` : ''}`,
      data: { screen: 'sync' },
    },
    trigger: Platform.OS === 'android' ? { channelId: 'downloads' } : null,
  });
}

export function subscribeAnnouncementOpen(onOpen: (id: string | null) => void): () => void {
  let lastId: string | undefined;
  const handle = (response: Notifications.NotificationResponse) => {
    const request = response.notification.request;
    const data = request.content.data;
    const announcementId = typeof data?.announcementId === 'string' ? data.announcementId : null;
    if (request.identifier === lastId || (!announcementId && !['announcements', 'sync'].includes(String(data?.screen)))) return;
    lastId = request.identifier;
    onOpen(data?.screen === 'sync' ? '__sakai_downloads__' : announcementId);
    Notifications.clearLastNotificationResponse();
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  const initial = Notifications.getLastNotificationResponse();
  if (initial) handle(initial);
  return () => subscription.remove();
}

async function ensureChannels(): Promise<void> {
  await Promise.all([
    Notifications.setNotificationChannelAsync('announcements', {
      name: 'Anuncios de PoliformaT', importance: Notifications.AndroidImportance.DEFAULT,
    }),
    Notifications.setNotificationChannelAsync('downloads', {
      name: 'Descargas completadas', importance: Notifications.AndroidImportance.DEFAULT,
    }),
  ]);
}

function notificationAllowed(status: Notifications.NotificationPermissionsStatus): boolean {
  return status.granted || [
    Notifications.IosAuthorizationStatus.AUTHORIZED,
    Notifications.IosAuthorizationStatus.PROVISIONAL,
    Notifications.IosAuthorizationStatus.EPHEMERAL,
  ].includes(status.ios?.status as Notifications.IosAuthorizationStatus);
}
