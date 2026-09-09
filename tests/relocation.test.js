import { expect, mock, test } from 'bun:test';
import { relocateDocuments, relocationUriPath } from '../src/lib/relocate-documents.ts';

const document = { id: 'doc', courseId: 'course', name: 'notes.pdf', remotePath: 'Topic/notes.pdf', localUri: 'file:///old/notes.pdf' };
const courses = [{ id: 'course', title: 'Physics', description: '' }];

test('copies once and persists every alias before deleting the original', async () => {
  const calls = [];
  const copy = mock(async (_document, paths) => { calls.push('copy'); expect(paths).toEqual(['Physics', 'Topic', 'notes.pdf']); return 'file:///new/notes.pdf'; });
  const result = await relocateDocuments({ first: document, alias: { ...document, id: 'alias' } }, courses, {
    exists: async () => true,
    copy,
    persist: async (updates) => {
      calls.push('persist');
      expect(updates.first.localUri).toBe('file:///new/notes.pdf');
      expect(updates.alias.localUri).toBe('file:///new/notes.pdf');
    },
    removeOriginal: async () => { calls.push('delete'); },
  });
  expect(calls).toEqual(['copy', 'persist', 'delete']);
  expect(copy).toHaveBeenCalledTimes(1);
  expect(result).toEqual({ retained: 0, missing: 0, cancelled: false });
});

test('never deletes the source when saving the updated index fails', async () => {
  const removeOriginal = mock(async () => {});
  await expect(relocateDocuments({ document }, courses, {
    exists: async () => true,
    copy: async () => 'file:///new/notes.pdf',
    persist: async () => { throw new Error('Storage failed'); },
    removeOriginal,
  })).rejects.toThrow('Storage failed');
  expect(removeOriginal).not.toHaveBeenCalled();
});

test('copies the whole batch before committing or deleting any source', async () => {
  const calls = [];
  await relocateDocuments({ first: document, second: { ...document, localUri: 'file:///old/second.pdf' } }, courses, {
    exists: async () => true,
    copy: async (item) => { calls.push('copy'); return item.localUri.replace('/old/', '/new/'); },
    persist: async (updates) => {
      calls.push('persist');
      expect(Object.values(updates).map((item) => item.localUri)).toEqual(['file:///new/notes.pdf', 'file:///new/second.pdf']);
    },
    removeOriginal: async () => { calls.push('delete'); },
  });
  expect(calls).toEqual(['copy', 'copy', 'persist', 'delete', 'delete']);
});

test('relocation assigns distinct portable destinations to sanitized path collisions', async () => {
  const first = { ...document, id: 'first', name: 'a:b.pdf', remotePath: 'Folder/a:b.pdf' };
  const second = { ...document, id: 'second', name: 'a?b.pdf', remotePath: 'folder/a?b.pdf', localUri: 'file:///old/second.pdf' };
  const destinations = [];
  await relocateDocuments({ first, second }, courses, {
    exists: async () => true,
    copy: async (_item, segments) => { destinations.push(segments.map((part) => part.toLocaleLowerCase('en-US')).join('/')); return `file:///new/${destinations.length}.pdf`; },
    persist: async () => {},
    removeOriginal: async () => {},
  });
  expect(new Set(destinations).size).toBe(2);
});

test('a later copy failure preserves every original and the old index', async () => {
  const persist = mock(async () => {});
  const removeOriginal = mock(async () => {});
  await expect(relocateDocuments({ first: document, second: { ...document, localUri: 'file:///old/second.pdf' } }, courses, {
    exists: async () => true,
    copy: async (item) => {
      if (item.localUri.endsWith('/second.pdf')) throw new Error('Destination conflict');
      return 'file:///new/notes.pdf';
    },
    persist,
    removeOriginal,
  })).rejects.toThrow('Destination conflict');
  expect(persist).not.toHaveBeenCalled();
  expect(removeOriginal).not.toHaveBeenCalled();
});

test('cancellation after a copy leaves the previous root and index uncommitted', async () => {
  const controller = new AbortController();
  const persist = mock(async () => {});
  const removeOriginal = mock(async () => {});
  const result = await relocateDocuments({ document }, courses, {
    exists: async () => true,
    copy: async () => { controller.abort(); return 'file:///new/notes.pdf'; },
    persist,
    removeOriginal,
  }, controller.signal);
  expect(result.cancelled).toBe(true);
  expect(persist).not.toHaveBeenCalled();
  expect(removeOriginal).not.toHaveBeenCalled();
});

test('cancellation during the durable commit retains originals with the new index', async () => {
  const controller = new AbortController();
  const removeOriginal = mock(async () => {});
  const result = await relocateDocuments({ document }, courses, {
    exists: async () => true,
    copy: async () => 'file:///new/notes.pdf',
    persist: async (updates) => { expect(updates.document.available).toBe(true); controller.abort(); },
    removeOriginal,
  }, controller.signal);
  expect(result).toEqual({ retained: 1, missing: 0, cancelled: true });
  expect(removeOriginal).not.toHaveBeenCalled();
});

test('missing sources stay indexed as unavailable and cleanup failures retain originals', async () => {
  const removeOriginal = mock(async () => { throw new Error('Source changed'); });
  const result = await relocateDocuments({ first: document, missing: { ...document, localUri: 'file:///old/missing.pdf' } }, courses, {
    exists: async (uri) => uri === document.localUri,
    copy: async () => 'file:///new/notes.pdf',
    persist: async (updates) => {
      expect(updates.missing).toMatchObject({ available: false, localUri: 'file:///old/missing.pdf' });
      expect(updates.first).toMatchObject({ available: true, localUri: 'file:///new/notes.pdf' });
    },
    removeOriginal,
  });
  expect(result).toEqual({ retained: 1, missing: 1, cancelled: false });
  expect(removeOriginal).toHaveBeenCalledTimes(1);
});

test('never reads or copies an imported untrusted source URI', async () => {
  const exists = mock(async () => true);
  const copy = mock(async () => 'file:///new/notes.pdf');
  const persist = mock(async (updates) => {
    expect(updates.document).toMatchObject({ localUri: document.localUri, available: false, localUriTrusted: false });
  });
  const result = await relocateDocuments({ document: { ...document, localUriTrusted: false } }, courses, {
    exists,
    copy,
    persist,
    removeOriginal: async () => {},
  });
  expect(exists).not.toHaveBeenCalled();
  expect(copy).not.toHaveBeenCalled();
  expect(result).toEqual({ retained: 0, missing: 1, cancelled: false });
});

test('never removes a source reused as another document destination', async () => {
  const other = { ...document, localUri: 'file:///old/second.pdf' };
  const removeOriginal = mock(async () => {});
  await relocateDocuments({ first: document, other }, courses, {
    exists: async () => true,
    copy: async (item) => item === document ? other.localUri : 'file:///new/second.pdf',
    persist: async () => {},
    removeOriginal,
  });
  expect(removeOriginal).toHaveBeenCalledTimes(1);
  expect(removeOriginal).toHaveBeenCalledWith(document.localUri, other.localUri);
});

test('normalizes iOS path aliases and SAF tree/document IDs without prefix confusion', () => {
  expect(relocationUriPath('file:///private/var/mobile/Sakai%20Sync/')).toBe('file:///var/mobile/Sakai Sync');
  const root = relocationUriPath('content://provider/tree/primary%3ASakai');
  const file = relocationUriPath('content://provider/tree/primary%3ASakai/document/primary%3ASakai%2FCourse%2Fnotes.pdf');
  expect(file.startsWith(`${root}/`)).toBe(true);
  expect(relocationUriPath('content://provider/tree/primary%3ASakai-other').startsWith(`${root}/`)).toBe(false);
  expect(relocationUriPath('content://other/tree/primary%3ASakai%2FCourse').startsWith(`${root}/`)).toBe(false);
});
