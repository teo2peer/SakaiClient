import AsyncStorage from '@react-native-async-storage/async-storage';

import { DEFAULT_PALETTE_ID, isColorSchemePreference, isPaletteId } from '@/constants/palettes';
import { APP_DATA_KEY } from '@/lib/constants';
import type { AppData, CoursePreference, SyncedDocument } from '@/types/sakai';

let pendingWrite: Promise<void> = Promise.resolve();

export const EMPTY_APP_DATA: AppData = {
  version: 3,
  courses: [],
  courseOrder: [],
  coursePreferences: {},
  announcements: [],
  readAnnouncementIds: [],
  documents: {},
  resourcesByCourse: {},
  settings: {
    notifications: false,
    downloadLocationChosen: false,
    palette: DEFAULT_PALETTE_ID,
    colorScheme: 'system',
  },
};

function emptyAppData(): AppData {
  return {
    ...EMPTY_APP_DATA,
    courses: [],
    courseOrder: [],
    coursePreferences: {},
    announcements: [],
    readAnnouncementIds: [],
    documents: {},
    resourcesByCourse: {},
    settings: { ...EMPTY_APP_DATA.settings },
  };
}

export async function loadAppData(): Promise<AppData> {
  const stored = await AsyncStorage.getItem(APP_DATA_KEY);

  if (!stored) {
    return emptyAppData();
  }

  try {
    const parsed = JSON.parse(stored);
    const data = normalizeAppData(parsed);
    if (parsed.version !== 3) await saveAppData(data).catch(() => undefined);
    return data;
  } catch {
    return emptyAppData();
  }
}

export async function saveAppData(data: AppData): Promise<void> {
  const value = JSON.stringify(data);
  pendingWrite = pendingWrite.catch(() => undefined).then(() => AsyncStorage.setItem(APP_DATA_KEY, value));
  await pendingWrite;
}

export async function clearAppData(): Promise<AppData> {
  pendingWrite = pendingWrite.catch(() => undefined).then(() => AsyncStorage.removeItem(APP_DATA_KEY));
  await pendingWrite;
  return emptyAppData();
}

export function createAppDataCommitter(current: () => AppData, publish: (data: AppData) => void) {
  let pending: Promise<void> = Promise.resolve();
  return (update: (data: AppData) => AppData, persist: (data: AppData) => Promise<unknown> = saveAppData): Promise<void> => {
    // Derive each mutation from durable state, never from a pending or rejected write.
    const operation = pending.catch(() => undefined).then(async () => {
      const next = update(current());
      await persist(next);
      publish(next);
    });
    pending = operation;
    return operation;
  };
}

export function parseImportedAppData(value: string): AppData {
  const parsed = JSON.parse(value);
  if (![1, 2, 3].includes(parsed?.version) || !Array.isArray(parsed.courses)) {
    throw new Error('El archivo no es una exportacion valida de Sakai Client.');
  }
  const data = normalizeAppData(parsed);
  const documents = Object.fromEntries(Object.entries(data.documents).map(([key, document]) => [
    key, { ...document, available: false, localUriTrusted: false },
  ])) as Record<string, SyncedDocument>;
  return { ...data, documents, settings: { ...data.settings, syncRootUri: undefined, syncRootName: undefined, downloadLocationChosen: false, notifications: false } };
}

export function normalizeAppData(parsed: Partial<AppData>): AppData {
  const courses = Array.isArray(parsed.courses) ? parsed.courses : [];
  const courseOrder = normalizeCourseOrder(parsed.courseOrder, courses.map((course) => course.id));
  return {
    ...emptyAppData(),
    ...parsed,
    version: 3,
    courses,
    courseOrder,
    coursePreferences: normalizeCoursePreferences(parsed.coursePreferences),
    announcements: Array.isArray(parsed.announcements) ? parsed.announcements : [],
    readAnnouncementIds: Array.isArray(parsed.readAnnouncementIds)
      ? parsed.readAnnouncementIds
      : [],
    documents: parsed.documents && typeof parsed.documents === 'object' ? parsed.documents : {},
    resourcesByCourse: parsed.resourcesByCourse && typeof parsed.resourcesByCourse === 'object'
      ? parsed.resourcesByCourse : {},
    settings: {
      notifications: parsed.settings?.notifications === true,
      syncRootUri: parsed.settings?.syncRootUri,
      syncRootName: parsed.settings?.syncRootName,
      downloadLocationChosen: parsed.settings?.downloadLocationChosen === true,
      palette: isPaletteId(parsed.settings?.palette) ? parsed.settings.palette : DEFAULT_PALETTE_ID,
      colorScheme: isColorSchemePreference(parsed.settings?.colorScheme) ? parsed.settings.colorScheme : 'system',
    },
  };
}

function normalizeCourseOrder(value: unknown, courseIds: string[]): string[] {
  const validIds = new Set(courseIds);
  const order = Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && validIds.has(id)) : [];
  return [...new Set([...order, ...courseIds])];
}

function normalizeCoursePreferences(value: unknown): Record<string, CoursePreference> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const preferences: Record<string, CoursePreference> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const source = raw as Record<string, unknown>;
    const alias = typeof source.alias === 'string' ? source.alias.trim().slice(0, 120) : '';
    if (alias || source.favorite === true) preferences[id] = {
      ...(alias ? { alias } : {}),
      ...(source.favorite === true ? { favorite: true } : {}),
    };
  }
  return preferences;
}
