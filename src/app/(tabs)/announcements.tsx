import { router } from 'expo-router';
import { useDeferredValue, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { AppShell } from '@/components/app-shell';
import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { filterAnnouncements } from '@/lib/announcements';
import { formatDate, stripHtml } from '@/lib/text';
import { useApp } from '@/providers/app-provider';

export default function AnnouncementsScreen() {
  const app = useApp();
  const [query, setQuery] = useState('');
  const [courseId, setCourseId] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const deferredQuery = useDeferredValue(query);
  const read = new Set(app.data.readAnnouncementIds);
  const filtered = filterAnnouncements(app.data.announcements, deferredQuery, courseId, unreadOnly, app.data.readAnnouncementIds);
  const courses = new Map(app.data.courses.map((course) => [course.id, course.title]));
  for (const item of app.data.announcements) if (item.courseId && !courses.has(item.courseId)) courses.set(item.courseId, item.courseTitle);

  return <AppShell>
    <FlatList
      data={filtered}
      keyExtractor={(item) => item.id}
      contentContainerClassName="pb-8"
      ListHeaderComponent={<View className="gap-3 pb-4">
        <ScreenHeader eyebrow="Actividad" title="Anuncios" description="Todas las asignaturas, en una sola bandeja." />
        <View className="gap-3 px-5">
          <TextInput accessibilityLabel="Buscar anuncios" value={query} onChangeText={setQuery} placeholder="Buscar en títulos, contenido o autores" placeholderTextColor="#71717A" className="min-h-12 rounded-xl border border-line bg-white px-4 text-base text-ink dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50" />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2">
            {[['', 'Todas las asignaturas'], ...courses.entries()].map(([id, title]) => <Pressable
              key={id} accessibilityRole="button" accessibilityState={{ selected: courseId === id }}
              onPress={() => setCourseId(id)} className={`min-h-11 justify-center rounded-full border px-4 ${courseId === id ? 'border-pine bg-mint' : 'border-line bg-white dark:border-zinc-700 dark:bg-zinc-900'}`}>
              <Text numberOfLines={1} className="max-w-60 text-sm font-semibold text-ink dark:text-zinc-100">{title}</Text>
            </Pressable>)}
          </ScrollView>
          <View className="flex-row items-center justify-between gap-3">
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: unreadOnly }} onPress={() => setUnreadOnly(!unreadOnly)} className="min-h-11 justify-center px-1">
              <Text className="font-semibold text-pine">{unreadOnly ? '[x]' : '[ ]'} Solo no leídos</Text>
            </Pressable>
            <Text className="text-sm text-zinc-600 dark:text-zinc-400">{filtered.length} resultados</Text>
          </View>
          {app.status === 'authenticated' ? <Button label="Actualizar anuncios" onPress={() => void app.refresh()} loading={app.refreshing} variant="secondary" /> : null}
        </View>
      </View>}
      ListEmptyComponent={<Card className="mx-5 gap-2 py-8"><Text className="text-lg font-bold text-ink dark:text-zinc-50">Sin anuncios para este filtro</Text><Text className="text-zinc-600 dark:text-zinc-400">Prueba otra asignatura o borra la búsqueda.</Text></Card>}
      renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${read.has(item.id) ? 'Leído' : 'No leído'}: ${item.title}`} onPress={() => router.push({ pathname: '/announcement/[id]', params: { id: item.id } })} className="mx-5 mb-3 active:opacity-70">
        <Card className="gap-2">
          <Text className="text-xs font-bold uppercase text-pine">{item.courseTitle}{read.has(item.id) ? '' : ' · No leído'}</Text>
          <Text className="text-lg font-bold leading-6 text-ink dark:text-zinc-50">{item.title}</Text>
          <Text numberOfLines={3} className="text-sm leading-5 text-zinc-600 dark:text-zinc-300">{stripHtml(item.body)}</Text>
          <Text className="text-xs text-zinc-500">{item.author} · {formatDate(item.createdAt)}</Text>
        </Card>
      </Pressable>}
    />
  </AppShell>;
}
