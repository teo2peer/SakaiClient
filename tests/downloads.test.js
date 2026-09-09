import { expect, test } from 'bun:test';

import { documentsInScope } from '../src/lib/downloads.ts';

function documents(...paths) {
  return Object.fromEntries(paths.map(([key, courseId, remotePath]) => [key, {
    id: key, courseId, remotePath, name: remotePath.split('/').pop(), downloadUrl: '',
    localUri: `file:///${key}`, fingerprint: 'f', syncedAt: '2026-01-01T00:00:00.000Z',
  }]));
}

const library = documents(
  ['a', 'course', 'Topic 1/notes.pdf'],
  ['b', 'course', 'Topic 1/Exercises/sheet.pdf'],
  ['c', 'course', 'Topic 10/other.pdf'],
  ['d', 'course', 'Topic 2/notes.pdf'],
  ['e', 'other-course', 'Topic 1/notes.pdf'],
);

test('folder scope selects descendants only, never sibling folders sharing a name prefix', () => {
  const keys = documentsInScope(library, { type: 'folder', courseId: 'course', path: 'Topic 1' }).map(([key]) => key);
  expect(keys).toEqual(['a', 'b']);
  expect(documentsInScope(library, { type: 'folder', courseId: 'course', path: 'Topic 1/' }).map(([key]) => key))
    .toEqual(['a', 'b']);
});

test('file scope matches one remote path inside its own course', () => {
  expect(documentsInScope(library, { type: 'file', courseId: 'course', path: 'Topic 1/notes.pdf' }).map(([key]) => key))
    .toEqual(['a']);
  expect(documentsInScope(library, { type: 'file', courseId: 'course', path: 'Topic 1' })).toEqual([]);
});

test('course scope selects every indexed document of that course and no other course', () => {
  expect(documentsInScope(library, { type: 'course', courseId: 'course' }).map(([key]) => key))
    .toEqual(['a', 'b', 'c', 'd']);
  expect(documentsInScope(library, { type: 'course', courseId: 'missing' })).toEqual([]);
});

test('rejects empty paths and traversal instead of selecting a wider set', () => {
  for (const path of ['', '/', '..', 'Topic 1/../..']) {
    expect(() => documentsInScope(library, { type: 'folder', courseId: 'course', path })).toThrow();
    expect(() => documentsInScope(library, { type: 'file', courseId: 'course', path })).toThrow();
  }
});
