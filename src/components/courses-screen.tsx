import { router, useIsFocused } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppShell } from '@/components/app-shell';
import { ErrorBanner } from '@/components/error-banner';
import { ScreenHeader } from '@/components/screen-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { VersionUpdateBanner } from '@/components/version-update-banner';
import { usePaletteColors } from '@/hooks/use-palette';
import { canMoveCourse, courseDisplayTitle, orderedCourses } from '@/lib/courses';
import { buildResourceTree, resourceTreeSummary } from '@/lib/resource-tree';
import { formatDate, stripHtml } from '@/lib/text';
import { unreadAnnouncements, useApp } from '@/providers/app-provider';

export default function CoursesScreen() {
  const app = useApp();
  const colors = usePaletteColors();
  const focused = useIsFocused();
  const [editingCourseId, setEditingCourseId] = useState<string>();
  const [aliasDraft, setAliasDraft] = useState('');
  const checkLocalDocuments = useEffectEvent(() => app.checkLocalDocuments());

  useEffect(() => {
    if (focused && (app.status === 'authenticated' || app.status === 'offline')) void checkLocalDocuments();
  }, [focused, app.status]);

  if (app.status === 'loading') {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-paper dark:bg-zinc-950">
        <ActivityIndicator size="large" color={colors.pine} />
        <Text className="text-zinc-600 dark:text-zinc-400">Cargando biblioteca local...</Text>
      </View>
    );
  }

  if (app.status === 'signed-out') return <LoginScreen />;
  if (app.status === 'web') return <WebLibrary />;

  const unread = unreadAnnouncements(app.data).length;
  const courses = orderedCourses(app.data.courses, app.data.courseOrder, app.data.coursePreferences);
  return (
    <AppShell>
      <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        <ScreenHeader
          eyebrow="PoliformaT UPV"
          title="Tus asignaturas"
          description={`${app.data.courses.length} asignaturas · ${unread} anuncios sin leer${
            app.status === 'offline' ? ' · modo sin conexión' : ''
          }`}
        />

        <View className="gap-3 px-5">
          <View className="flex-row gap-3">
            <View className="flex-1">
              <Button
                label="Actualizar"
                onPress={() => void app.refresh()}
                loading={app.refreshing}
                disabled={app.status !== 'authenticated'}
              />
            </View>
            <View className="flex-1">
              <Button
                label="Descargas"
                onPress={() => router.push('/sync')}
                variant="secondary"
                disabled={app.status !== 'authenticated'}
              />
            </View>
          </View>

          {app.data.courses.length === 0 ? (
            <Card className="items-center gap-2 py-10">
              <Text className="text-lg font-bold text-ink dark:text-zinc-50">Sin asignaturas</Text>
              <Text className="text-center leading-5 text-zinc-600 dark:text-zinc-400">
                Actualiza para consultar los sitios a los que tienes acceso en PoliformaT.
              </Text>
            </Card>
          ) : (
            courses.map((course) => {
              const resources = app.data.resourcesByCourse[course.id] ?? [];
              const documents = Object.values(app.data.documents).filter((document) => document.courseId === course.id);
              const summary = resourceTreeSummary(buildResourceTree(resources, documents));
              const alias = courseDisplayTitle(course, app.data.coursePreferences);
              const favorite = app.data.coursePreferences[course.id]?.favorite === true;
              const editing = editingCourseId === course.id;
              return (
                <Card key={course.id} className="overflow-hidden p-0">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Abrir ${alias}`}
                    onPress={() => router.push({ pathname: '/course/[id]', params: { id: course.id } })}
                    className="gap-3 p-4 active:opacity-70">
                    <View className="flex-row items-start gap-4">
                      <View className={`h-11 w-1 rounded-full ${favorite ? 'bg-pine' : 'bg-line'}`} />
                      <View className="flex-1 gap-1">
                        <Text className="text-lg font-bold leading-6 text-ink dark:text-zinc-50">
                          {alias}
                        </Text>
                        {alias !== course.title ? (
                          <Text className="text-xs leading-4 text-zinc-500">{course.title}</Text>
                        ) : null}
                        {course.term ? (
                          <Text className="text-xs font-semibold uppercase tracking-wide text-pine">
                            {course.term}
                          </Text>
                        ) : null}
                        {course.description ? (
                          <Text numberOfLines={2} className="text-sm leading-5 text-zinc-600 dark:text-zinc-400">
                            {stripHtml(course.description)}
                          </Text>
                        ) : null}
                      </View>
                      <Text className="text-xl text-zinc-400">›</Text>
                    </View>
                    <Text className="text-xs text-zinc-500 dark:text-zinc-500">
                      {summary.downloaded} / {summary.total} descargados
                    </Text>
                  </Pressable>

                  {editing ? (
                    <View className="mx-4 mb-3 gap-2 rounded-xl bg-paper p-3 dark:bg-zinc-950">
                      <Text className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Alias de la asignatura</Text>
                      <TextInput
                        autoFocus
                        value={aliasDraft}
                        onChangeText={setAliasDraft}
                        onSubmitEditing={() => { void app.setCourseAlias(course.id, aliasDraft); setEditingCourseId(undefined); }}
                        placeholder={course.title}
                        placeholderTextColor={colors.line}
                        maxLength={120}
                        returnKeyType="done"
                        className="min-h-11 rounded-xl border border-line bg-white px-3 text-sm text-ink dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      />
                      <View className="flex-row gap-2">
                        <View className="flex-1"><Button label="Cancelar" variant="ghost" onPress={() => setEditingCourseId(undefined)} /></View>
                        <View className="flex-1"><Button label="Guardar" onPress={() => { void app.setCourseAlias(course.id, aliasDraft); setEditingCourseId(undefined); }} /></View>
                      </View>
                    </View>
                  ) : null}

                  <View className="flex-row flex-wrap items-center border-t border-line px-2 py-1 dark:border-zinc-800">
                    <CourseControl label={favorite ? 'Favorita' : 'Favorito'} active={favorite} onPress={() => void app.setCourseFavorite(course.id, !favorite)} />
                    <CourseControl label="Alias" onPress={() => { setAliasDraft(app.data.coursePreferences[course.id]?.alias ?? ''); setEditingCourseId(editing ? undefined : course.id); }} />
                    <View className="flex-1" />
                    <CourseControl label="Subir" disabled={!canMoveCourse(courses, app.data.courseOrder, app.data.coursePreferences, course.id, 'up')} onPress={() => void app.moveCourse(course.id, 'up')} />
                    <CourseControl label="Bajar" disabled={!canMoveCourse(courses, app.data.courseOrder, app.data.coursePreferences, course.id, 'down')} onPress={() => void app.moveCourse(course.id, 'down')} />
                  </View>
                </Card>
              );
            })
          )}

          {app.data.lastSyncAt ? (
            <Text className="pt-2 text-center text-xs text-zinc-500">
              Ultima sincronizacion: {formatDate(app.data.lastSyncAt)}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </AppShell>
  );
}

function CourseControl({ label, onPress, disabled = false, active = false }: { label: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      className={`min-h-10 justify-center rounded-lg px-2.5 active:bg-mint dark:active:bg-zinc-800 ${active ? 'bg-mint dark:bg-zinc-800' : ''} ${disabled ? 'opacity-30' : ''}`}>
      <Text className="text-xs font-semibold text-pine">{label}</Text>
    </Pressable>
  );
}

export function LoginScreen() {
  const app = useApp();
  const colors = usePaletteColors();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);

  const submit = async () => {
    if (!username.trim() || !password) return;
    await app.login({ username, password }, remember).catch(() => undefined);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-paper dark:bg-zinc-950">
      <SafeAreaView className="flex-1">
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="mx-auto w-full max-w-lg flex-grow justify-center px-6 py-10">
          <View className="mb-8 gap-4">
            <View className="h-12 w-12 items-center justify-center rounded-2xl bg-pine">
              <Text className="text-xl font-black text-pine-contrast">S</Text>
            </View>
            <View className="gap-2">
              <Text className="text-4xl font-bold tracking-tight text-ink dark:text-zinc-50">
                Sakai Client
              </Text>
              <Text className="text-base leading-6 text-zinc-600 dark:text-zinc-400">
                Tus asignaturas, anuncios y documentos de PoliformaT disponibles sin conexion.
              </Text>
            </View>
          </View>

          <VersionUpdateBanner />
          <ErrorBanner message={app.error} onDismiss={app.clearError} />
          <Card className="gap-4">
            <View className="gap-2">
              <Text className="text-sm font-semibold text-ink dark:text-zinc-100">
                Usuario, email o DNI
              </Text>
              <TextInput
                accessibilityLabel="Usuario, email o DNI"
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="username"
                value={username}
                onChangeText={setUsername}
                placeholder="usuario@upv.es"
                placeholderTextColor="#8A918C"
                className="min-h-12 rounded-xl border border-line bg-paper px-4 text-base text-ink dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </View>
            <View className="gap-2">
              <Text className="text-sm font-semibold text-ink dark:text-zinc-100">Contrasena</Text>
              <TextInput
                accessibilityLabel="Contrasena"
                secureTextEntry
                textContentType="password"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={() => void submit()}
                placeholder="Contrasena de la UPV"
                placeholderTextColor="#8A918C"
                className="min-h-12 rounded-xl border border-line bg-paper px-4 text-base text-ink dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
              />
            </View>
            <View className="flex-row items-center justify-between gap-4">
              <View className="flex-1">
                <Text className="font-semibold text-ink dark:text-zinc-100">Recordar credenciales</Text>
                <Text className="text-xs leading-4 text-zinc-500">
                   Permite renovar la sesión y comprobar anuncios sin descargar documentos.
                </Text>
              </View>
              <Switch accessibilityLabel="Recordar credenciales" value={remember} onValueChange={setRemember} trackColor={{ true: colors.pine }} />
            </View>
            <Button
              label="Entrar en PoliformaT"
              onPress={() => void submit()}
              loading={app.refreshing}
              disabled={!username.trim() || !password}
            />
          </Card>
          <Text className="mt-5 text-center text-xs leading-5 text-zinc-500">
            Las credenciales se guardan en el almacen seguro del dispositivo y nunca se incluyen en
            las exportaciones.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

function WebLibrary() {
  const app = useApp();
  const courses = orderedCourses(app.data.courses, app.data.courseOrder, app.data.coursePreferences);
  return (
    <AppShell>
      <ScrollView contentContainerClassName="pb-8">
        <ScreenHeader
          eyebrow="Visor web"
          title="Biblioteca importada"
          description="PoliformaT bloquea el acceso directo desde otros dominios. Importa una copia creada por la app movil para consultar sus datos."
        />
        <View className="gap-4 px-5">
          <Button label="Importar datos" onPress={() => void app.importData()} />
          <Card className="gap-1">
            <Text className="text-3xl font-bold text-ink dark:text-zinc-50">
              {app.data.courses.length}
            </Text>
            <Text className="text-zinc-600 dark:text-zinc-400">asignaturas importadas</Text>
          </Card>
          {courses.map((course) => {
            const title = courseDisplayTitle(course, app.data.coursePreferences);
            return (
              <Pressable
                key={course.id}
                accessibilityRole="button"
                accessibilityLabel={`Abrir ${title}`}
                onPress={() => router.push({ pathname: '/course/[id]', params: { id: course.id } })}
                className="active:opacity-70">
                <Card>
                  <Text className="font-bold text-ink dark:text-zinc-50">{title}</Text>
                  {title !== course.title ? <Text className="mt-1 text-xs text-zinc-500">{course.title}</Text> : null}
                </Card>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </AppShell>
  );
}
