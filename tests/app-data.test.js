import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { filterAnnouncements, isWebUrl } from '../src/lib/announcements.ts';
import { documentsInScope } from '../src/lib/downloads.ts';
import { relocateDocuments } from '../src/lib/relocate-documents.ts';
import { checkDocumentAvailability } from '../src/lib/document-availability.ts';
import { canMoveCourse, courseDisplayTitle, moveCourseInOrder, orderedCourses } from '../src/lib/courses.ts';

const stored = new Map();
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key) => stored.get(key) ?? null,
  setItem: async (key, value) => { stored.set(key, value); },
  removeItem: async (key) => { stored.delete(key); },
} }));
const { normalizeAppData, parseImportedAppData, EMPTY_APP_DATA, loadAppData, saveAppData, clearAppData, createAppDataCommitter } = await import('../src/lib/storage.ts');
const { APP_DATA_KEY } = await import('../src/lib/constants.ts');

test('migrates the old automatic-download default without losing local documents or folders', async () => {
  const old = { version: 1, courses: [{ id: 'course' }], documents: { doc: { localUri: 'file:///doc.pdf' } }, resourcesByCourse: { course: [] }, settings: { automaticSync: true, notifications: false, syncRootUri: 'file:///library' } };
  stored.set(APP_DATA_KEY, JSON.stringify(old));
  const data = await loadAppData();
  expect(data.version).toBe(3);
  expect(data.settings).not.toHaveProperty('automaticSync');
  expect(data.documents).toEqual(old.documents);
  expect(data.resourcesByCourse).toEqual(old.resourcesByCourse);
  expect(data.settings.syncRootUri).toBe('file:///library');
  expect(JSON.parse(stored.get(APP_DATA_KEY)).version).toBe(3);
  expect(data.courseOrder).toEqual(['course']);
  expect(data.coursePreferences).toEqual({});
  expect(normalizeAppData(data)).toEqual(data);
});

test('new installs and imported old exports never enable automatic downloads', () => {
  expect(EMPTY_APP_DATA.settings).not.toHaveProperty('automaticSync');
  for (const version of [1, 2, 3]) {
    const data = parseImportedAppData(JSON.stringify({ version, courses: [], settings: { automaticSync: true, notifications: true, syncRootUri: 'file:///other-phone' } }));
    expect(data.version).toBe(3);
    expect(data.settings).toEqual({ notifications: false, syncRootUri: undefined, syncRootName: undefined, downloadLocationChosen: false, palette: 'pine', colorScheme: 'system', folderNavigationMode: 'expandable' });
  }
});

test('an imported index never grants authority over source-device file URIs', () => {
  const imported = parseImportedAppData(JSON.stringify({
    version: 3,
    courses: [{ id: 'course', title: 'Course', description: '' }],
    documents: { doc: { id: 'doc', courseId: 'course', remotePath: 'doc.pdf', name: 'doc.pdf', downloadUrl: '', localUri: 'file:///untrusted.pdf', syncedAt: '', fingerprint: '' } },
  }));
  expect(imported.documents.doc).toMatchObject({ available: false, localUriTrusted: false });
});

test('normalizes course aliases, favorites and a durable order', () => {
  const courses = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }, { id: 'c', title: 'Gamma' }];
  const data = normalizeAppData({
    version: 3,
    courses,
    courseOrder: ['c', 'missing', 'c'],
    coursePreferences: { a: { favorite: true }, b: { alias: '  Custom beta  ' }, c: { alias: ' ' }, invalid: 'bad' },
  });
  expect(data.courseOrder).toEqual(['c', 'a', 'b']);
  expect(data.coursePreferences).toEqual({ a: { favorite: true }, b: { alias: 'Custom beta' } });
  expect(orderedCourses(courses, data.courseOrder, data.coursePreferences).map((course) => course.id)).toEqual(['a', 'c', 'b']);
  expect(courseDisplayTitle(courses[1], data.coursePreferences)).toBe('Custom beta');
  expect(canMoveCourse(courses, data.courseOrder, data.coursePreferences, 'c', 'down')).toBe(true);
  expect(moveCourseInOrder(courses, data.courseOrder, data.coursePreferences, 'c', 'down')).toEqual(['a', 'b', 'c']);
});

test('checks each physical URI once and treats filesystem errors as unavailable', async () => {
  const documents = {
    first: { localUri: 'file:///same.pdf' },
    alias: { localUri: 'file:///same.pdf' },
    missing: { localUri: 'file:///missing.pdf' },
  };
  const exists = mock(async (uri) => {
    if (uri.includes('missing')) throw new Error('Permission lost');
    return true;
  });
  expect(await checkDocumentAvailability(documents, exists, 2)).toEqual({ first: true, alias: true, missing: false });
  expect(exists).toHaveBeenCalledTimes(2);
});

test('physical availability never probes an imported untrusted URI', async () => {
  const exists = mock(async () => true);
  expect(await checkDocumentAvailability({ imported: { localUri: 'file:///untrusted.pdf', localUriTrusted: false, available: true } }, exists)).toEqual({ imported: false });
  expect(exists).not.toHaveBeenCalled();
});

test('filters a cross-course announcement inbox by course, unread state and accent-insensitive text', () => {
  const items = [
    { id: '1', courseId: 'A', title: 'Examen', courseTitle: 'Matemáticas', author: 'Teacher', body: '<p>Mañana</p>' },
    { id: '2', courseId: 'B', title: 'Examen', courseTitle: 'Physics', author: 'Teacher', body: '<p>Tomorrow</p>' },
    { id: '3', title: 'General', courseTitle: 'PoliformaT', author: '', body: '' },
  ];
  expect(filterAnnouncements(items, '', '', false, [])).toHaveLength(3);
  expect(filterAnnouncements(items, 'matematicas', '', false, []).map((item) => item.id)).toEqual(['1']);
  expect(filterAnnouncements(items, '', 'B', true, ['2'])).toEqual([]);
  expect(filterAnnouncements(items, 'manana', 'A', false, [])).toHaveLength(1);
  expect(isWebUrl('javascript:alert(1)')).toBe(false);
  expect(isWebUrl('https://poliformat.upv.es/access/file.pdf')).toBe(true);
});

test.each([false, true])('concurrent metadata uses the durable relocation result (write fails: %s)', async (fails) => {
  const original = { id: 'doc', courseId: 'course', name: 'notes.pdf', remotePath: 'notes.pdf', localUri: 'file:///old/notes.pdf' };
  let state = { ...EMPTY_APP_DATA, documents: { doc: original }, settings: { ...EMPTY_APP_DATA.settings, syncRootUri: 'file:///old' } };
  const commit = createAppDataCommitter(() => state, (next) => { state = next; });
  const started = Promise.withResolvers();
  const write = Promise.withResolvers();
  const removeOriginal = mock(async () => { expect(state.documents.doc.localUri).toBe('file:///new/notes.pdf'); });
  const relocation = relocateDocuments(state.documents, [], {
    exists: async () => true,
    copy: async () => 'file:///new/notes.pdf',
    persist: (updates) => commit((current) => ({
      ...current, documents: updates, settings: { ...current.settings, syncRootUri: 'file:///new' },
    }), async () => { started.resolve(); await write.promise; }),
    removeOriginal,
  });
  const outcome = relocation.catch((error) => error);
  await started.promise;
  expect(state.documents.doc.localUri).toBe(original.localUri);
  const metadata = commit((current) => ({ ...current, readAnnouncementIds: ['read'], settings: { ...current.settings, notifications: true } }));
  if (fails) write.reject(new Error('Disk full'));
  else write.resolve();
  const result = await outcome;
  await metadata;
  const root = fails ? 'file:///old' : 'file:///new';
  expect(state.settings).toMatchObject({ syncRootUri: root, notifications: true });
  expect(state.documents.doc.localUri).toBe(`${root}/notes.pdf`);
  expect(state.readAnnouncementIds).toEqual(['read']);
  expect(JSON.parse(stored.get(APP_DATA_KEY))).toEqual(state);
  expect(removeOriginal).toHaveBeenCalledTimes(fails ? 0 : 1);
  if (fails) expect(result.message).toBe('Disk full');
});

test('reset shares the commit queue and later changes cannot restore old documents', async () => {
  let state = { ...EMPTY_APP_DATA, documents: { doc: { localUri: 'file:///old.pdf' } } };
  const commit = createAppDataCommitter(() => state, (next) => { state = next; });
  const started = Promise.withResolvers();
  const write = Promise.withResolvers();
  const first = commit((current) => ({ ...current, readAnnouncementIds: ['first'] }), async () => { started.resolve(); await write.promise; });
  await started.promise;
  const reset = commit(() => EMPTY_APP_DATA, clearAppData);
  const last = commit((current) => ({ ...current, readAnnouncementIds: ['last'] }));
  write.resolve();
  await Promise.all([first, reset, last]);
  expect(state.documents).toEqual({});
  expect(state.readAnnouncementIds).toEqual(['last']);
  expect(JSON.parse(stored.get(APP_DATA_KEY))).toEqual(state);
});

test('save, clear and save execute in submission order', async () => {
  const first = saveAppData({ ...EMPTY_APP_DATA, readAnnouncementIds: ['first'] });
  const reset = clearAppData();
  const last = saveAppData({ ...EMPTY_APP_DATA, readAnnouncementIds: ['last'] });
  await Promise.all([first, reset, last]);
  expect((await loadAppData()).readAnnouncementIds).toEqual(['last']);
});

function providerActions({ importAppData, setBackgroundSyncEnabled = async () => false, removeCopiedOriginal = async () => {}, deleteLocalDocument = async () => {}, openSyncRoot = async () => {} }) {
  const source = ts.transpileModule(readFileSync(new URL('../src/providers/app-provider.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ESNext },
  }).outputText;
  const workspace = {
    rootUri: 'file:///new', rootName: 'new', validateRelocation: async () => {},
    copyExisting: async () => 'file:///new/notes.pdf',
  };
  const createSyncWorkspace = mock(async () => workspace);
  const clear = mock(clearAppData);
  const module = { exports: {} };
  runInNewContext(source, {
    module, exports: module.exports, AbortController,
    require(name) {
      if (name === 'react/jsx-runtime') return { jsx: (_type, props) => ({ props }) };
      // Test action coordination without mounting UI or executing platform lifecycle effects.
      if (name === 'react') return {
        createContext: () => ({}), useRef: (current) => ({ current }), useState: (value) => [value, () => {}],
        useEffect: () => {}, useEffectEvent: (callback) => callback,
      };
      if (name === '@/lib/storage') return { EMPTY_APP_DATA, createAppDataCommitter, clearAppData: clear };
      if (name === '@/lib/files') return { createSyncWorkspace, canSyncFiles: true, localDocumentExists: async () => true, removeCopiedOriginal, deleteLocalDocument, openSyncRoot };
      if (name === '@/lib/downloads') return { documentsInScope };
      if (name === '@/lib/courses') return { moveCourseInOrder };
      if (name === '@/lib/document-availability') return { checkDocumentAvailability };
      if (name === '@/lib/notifications') return { notifyDownloadFinished: async () => {}, notifyNewAnnouncements: async () => {}, requestNotificationPermission: async () => false };
      if (name === '@/lib/data-transfer') return { importAppData };
      if (name === '@/lib/background-sync') return { setBackgroundSyncEnabled };
      if (name === '@/lib/relocate-documents') return { relocateDocuments };
      return {};
    },
  });
  return { actions: module.exports.AppProvider({ children: null }).props.value, createSyncWorkspace, clear };
}

test('persists display preferences and opens only the configured download root', async () => {
  const openSyncRoot = mock(async () => {});
  const { actions } = providerActions({
    importAppData: async () => ({
      ...EMPTY_APP_DATA,
      settings: { ...EMPTY_APP_DATA.settings, syncRootUri: 'sakai-root://authorized', syncRootName: 'Downloads' },
    }),
    openSyncRoot,
  });
  await actions.importData();
  await actions.setColorScheme('dark');
  await actions.setFolderNavigationMode('screen');
  await actions.openSyncFolder();
  expect((await loadAppData()).settings.colorScheme).toBe('dark');
  expect((await loadAppData()).settings.folderNavigationMode).toBe('screen');
  expect(openSyncRoot).toHaveBeenCalledWith('sakai-root://authorized');
});

test('a pending import blocks relocation and index deletion until the picker settles', async () => {
  const selected = Promise.withResolvers();
  const { actions, createSyncWorkspace, clear } = providerActions({ importAppData: () => selected.promise });
  const importing = actions.importData();
  await actions.chooseSyncFolder(true);
  await actions.clearLocalData();
  expect(createSyncWorkspace).not.toHaveBeenCalled();
  expect(clear).not.toHaveBeenCalled();
  selected.resolve(EMPTY_APP_DATA);
  await importing;
  await actions.chooseSyncFolder(true);
  expect(createSyncWorkspace).toHaveBeenCalledTimes(1);
});

test('a pending index reset blocks relocation and releases the lock after completion', async () => {
  const background = Promise.withResolvers();
  const { actions, createSyncWorkspace } = providerActions({ setBackgroundSyncEnabled: () => background.promise });
  const clearing = actions.clearLocalData();
  await actions.chooseSyncFolder(true);
  expect(createSyncWorkspace).not.toHaveBeenCalled();
  background.resolve(false);
  await clearing;
  await actions.chooseSyncFolder(true);
  expect(createSyncWorkspace).toHaveBeenCalledTimes(1);
});

test('imports and resets cannot replace committed destinations during relocation cleanup', async () => {
  const cleanupStarted = Promise.withResolvers();
  const cleanup = Promise.withResolvers();
  const original = { id: 'doc', courseId: 'course', name: 'notes.pdf', remotePath: 'notes.pdf', localUri: 'file:///old/notes.pdf' };
  const importAppData = mock(async () => ({ ...EMPTY_APP_DATA, documents: { doc: original } }));
  const { actions, clear } = providerActions({
    importAppData,
    removeCopiedOriginal: async () => { cleanupStarted.resolve(); await cleanup.promise; },
  });
  await actions.importData();
  const relocation = actions.chooseSyncFolder(true);
  await cleanupStarted.promise;
  await actions.importData();
  await actions.clearLocalData();
  expect(importAppData).toHaveBeenCalledTimes(1);
  expect(clear).not.toHaveBeenCalled();
  cleanup.resolve();
  await relocation;
  expect((await loadAppData()).documents.doc.localUri).toBe('file:///new/notes.pdf');
});

function localLibrary() {
  return {
    a: { id: 'a', courseId: 'course', name: 'notes.pdf', remotePath: 'Topic/notes.pdf', localUri: 'file:///old/notes.pdf' },
    b: { id: 'b', courseId: 'course', name: 'slides.pdf', remotePath: 'Topic/slides.pdf', localUri: 'file:///old/slides.pdf' },
    c: { id: 'c', courseId: 'course', name: 'other.pdf', remotePath: 'Other/other.pdf', localUri: 'file:///old/other.pdf' },
  };
}

test('local deletion forgets only the copies it removed and keeps the ones that failed', async () => {
  const deleted = [];
  const { actions } = providerActions({
    importAppData: async () => ({ ...EMPTY_APP_DATA, documents: localLibrary() }),
    deleteLocalDocument: async (uri) => {
      deleted.push(uri);
      if (uri.endsWith('slides.pdf')) throw new Error('El archivo esta en uso.');
    },
  });
  await actions.importData();
  await actions.deleteDownloads({ type: 'folder', courseId: 'course', path: 'Topic' });
  expect(deleted).toEqual(['file:///old/notes.pdf', 'file:///old/slides.pdf']);
  expect(Object.keys((await loadAppData()).documents)).toEqual(['b', 'c']);
});

test('local deletion keeps a shared physical file while another index entry still references it', async () => {
  const remove = mock(async () => {});
  const shared = 'file:///old/shared.pdf';
  const { actions } = providerActions({
    importAppData: async () => ({ ...EMPTY_APP_DATA, documents: {
      selected: { id: 'selected', courseId: 'course', name: 'a.pdf', remotePath: 'Topic/a.pdf', localUri: shared },
      retained: { id: 'retained', courseId: 'other', name: 'b.pdf', remotePath: 'b.pdf', localUri: shared },
    } }),
    deleteLocalDocument: remove,
  });
  await actions.importData();
  await actions.deleteDownloads({ type: 'file', courseId: 'course', path: 'Topic/a.pdf' });
  expect(remove).not.toHaveBeenCalled();
  expect(Object.keys((await loadAppData()).documents)).toEqual(['retained']);
});

test('local deletion removes one shared physical file once when all references are selected', async () => {
  const remove = mock(async () => {});
  const shared = 'file:///old/shared.pdf';
  const { actions } = providerActions({
    importAppData: async () => ({ ...EMPTY_APP_DATA, documents: {
      first: { id: 'first', courseId: 'course', name: 'a.pdf', remotePath: 'Topic/a.pdf', localUri: shared },
      second: { id: 'second', courseId: 'course', name: 'b.pdf', remotePath: 'Topic/b.pdf', localUri: shared },
    } }),
    deleteLocalDocument: remove,
  });
  await actions.importData();
  await actions.deleteDownloads({ type: 'folder', courseId: 'course', path: 'Topic' });
  expect(remove).toHaveBeenCalledTimes(1);
  expect((await loadAppData()).documents).toEqual({});
});

test('reauthorizing the same selected root immediately restores physical availability', async () => {
  const document = { id: 'doc', courseId: 'course', name: 'notes.pdf', remotePath: 'notes.pdf', localUri: 'file:///new/notes.pdf', available: false };
  const { actions } = providerActions({
    importAppData: async () => ({
      ...EMPTY_APP_DATA,
      documents: { doc: document },
      settings: { ...EMPTY_APP_DATA.settings, syncRootUri: 'file:///new', downloadLocationChosen: false },
    }),
  });
  await actions.importData();
  await actions.chooseSyncFolder(true);
  expect((await loadAppData()).documents.doc.available).toBe(true);
  expect((await loadAppData()).settings.downloadLocationChosen).toBe(true);
});

test('a pending local deletion blocks relocation and releases the lock after completion', async () => {
  const removal = Promise.withResolvers();
  const { actions, createSyncWorkspace } = providerActions({
    importAppData: async () => ({ ...EMPTY_APP_DATA, documents: localLibrary() }),
    deleteLocalDocument: () => removal.promise,
  });
  await actions.importData();
  const deleting = actions.deleteDownloads({ type: 'course', courseId: 'course' });
  await actions.chooseSyncFolder(true);
  expect(createSyncWorkspace).not.toHaveBeenCalled();
  removal.resolve();
  await deleting;
  expect((await loadAppData()).documents).toEqual({});
  await actions.chooseSyncFolder(true);
  expect(createSyncWorkspace).toHaveBeenCalledTimes(1);
});
