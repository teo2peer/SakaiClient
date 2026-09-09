import { Link, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { isWebUrl } from '@/lib/announcements';
import { formatDate, stripHtml } from '@/lib/text';
import { useApp } from '@/providers/app-provider';

export default function AnnouncementScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const item = app.data.announcements.find((announcement) => announcement.id === id);
  const markRead = useEffectEvent(() => app.markAnnouncementRead(id));
  const loadMissing = useEffectEvent(() => app.refresh());
  useEffect(() => { if (item) void markRead(); }, [id, item]);
  useEffect(() => { if (!item && app.status === 'authenticated') void loadMissing(); }, [id, item, app.status]);
  return <AppShell><ScrollView contentContainerClassName="gap-4 px-5 pb-10 pt-4">
    <Button label="Volver a anuncios" variant="secondary" onPress={() => router.canGoBack() ? router.back() : router.replace('/announcements')} />
    {item ? <>
      <Text className="text-xs font-bold uppercase text-pine">{item.courseTitle}</Text>
      <Text className="text-3xl font-bold leading-9 text-ink dark:text-zinc-50">{item.title}</Text>
      <Text className="text-sm text-zinc-600 dark:text-zinc-400">{item.author} · {formatDate(item.createdAt)}</Text>
      <Card><Text selectable className="text-base leading-7 text-ink dark:text-zinc-100">{stripHtml(item.body) || 'Sin contenido.'}</Text></Card>
      {item.attachments.length ? <View className="gap-3">
        <Text className="text-lg font-bold text-ink dark:text-zinc-50">Adjuntos</Text>
        {item.attachments.filter((attachment) => isWebUrl(attachment.url)).map((attachment, index) => <Link key={`${attachment.url}:${index}`} href={attachment.url as `https://${string}`} asChild>
          <Pressable accessibilityRole="link" accessibilityLabel={`Abrir adjunto ${attachment.name} en el navegador`} className="min-h-12 justify-center rounded-xl border border-line px-4 py-3 dark:border-zinc-700"><Text className="font-semibold text-pine">{attachment.name}</Text><Text className="text-xs text-zinc-500">Abrir en el navegador</Text></Pressable>
        </Link>)}
      </View> : null}
    </> : <Card className="gap-3"><Text className="text-lg font-bold text-ink dark:text-zinc-50">Anuncio no disponible en el índice local</Text><Button label="Actualizar anuncios" onPress={() => void app.refresh()} loading={app.refreshing} /></Card>}
  </ScrollView></AppShell>;
}
