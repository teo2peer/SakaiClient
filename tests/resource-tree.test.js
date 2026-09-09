import { expect, test } from 'bun:test';

import { buildResourceTree, resourceFolderView, visibleResourceRows } from '../src/lib/resource-tree.ts';
import { resourceFingerprint } from '../src/lib/paths.ts';

function resource(path, isFolder = false) {
  return { id: path, courseId: 'course', remotePath: path, name: path.split('/').pop(), downloadUrl: '', isFolder };
}

test('reconstructs nested folders, empty directories and duplicate filenames without flattening', () => {
  const tree = buildResourceTree([
    resource('Topic 1/Exercises/notes.pdf'), resource('Topic 2/notes.pdf'), resource('Empty', true),
  ], []);
  expect(tree.map((node) => node.name)).toEqual(['Topic 1', 'Topic 2', 'Empty']);
  expect(tree[0].children[0]).toMatchObject({ name: 'Exercises', isFolder: true });
  expect(tree[0].children[0].children[0].path).toBe('Topic 1/Exercises/notes.pdf');
  expect(tree[1].children[0].path).toBe('Topic 2/notes.pdf');
  expect(tree[2].children).toEqual([]);
});

test('preserves server order and display names when explicit folders follow their children', () => {
  const tree = buildResourceTree([
    resource('Topic/b.pdf'), resource('Topic/a.pdf'), { ...resource('Topic', true), name: 'Teaching materials' },
  ], []);
  expect(tree).toHaveLength(1);
  expect(tree[0].name).toBe('Teaching materials');
  expect(tree[0].children.map((node) => node.name)).toEqual(['b.pdf', 'a.pdf']);
});

test('links local files by path when API and WebDAV use different IDs', () => {
  const remote = resource('Topic/notes.pdf');
  const local = { ...remote, id: 'different-id', localUri: 'file:///notes.pdf' };
  const tree = buildResourceTree([remote, resource('Topic/pending.pdf')], [local]);
  expect(tree[0].children[0].document).toBe(local);
  expect(tree[0].children[1].document).toBeUndefined();
});

test('only renders expanded branches and keeps each row at its original depth', () => {
  const tree = buildResourceTree([resource('A/B/file.pdf'), resource('root.txt')], []);
  expect(visibleResourceRows(tree, new Set()).map(({ node }) => node.path)).toEqual(['A', 'root.txt']);
  expect(visibleResourceRows(tree, new Set(['A', 'A/B'])).map(({ node, depth }) => [node.path, depth])).toEqual([
    ['A', 0], ['A/B', 1], ['A/B/file.pdf', 2], ['root.txt', 0],
  ]);
  expect(visibleResourceRows(tree, new Set(['A/B']))).toHaveLength(2);
});

test('renders one folder level with display-name breadcrumbs in screen mode', () => {
  const tree = buildResourceTree([
    resource('Topic/Exercises/notes.pdf'),
    resource('Topic/slides.pdf'),
    { ...resource('Topic', true), name: 'Teaching materials' },
  ], []);
  const view = resourceFolderView(tree, 'Topic/Exercises');
  expect(view.breadcrumbs.map((node) => node.name)).toEqual(['Teaching materials', 'Exercises']);
  expect(view.rows.map(({ node, depth }) => [node.path, depth])).toEqual([
    ['Topic/Exercises/notes.pdf', 0],
  ]);
  expect(resourceFolderView(tree, 'Missing').rows.map(({ node }) => node.path)).toEqual(['Topic']);
});

test('keeps downloaded files accessible when a remote listing no longer includes them', () => {
  const local = { ...resource('Old/notes.pdf'), localUri: 'file:///notes.pdf' };
  const tree = buildResourceTree([], [local]);
  expect(tree[0].children[0]).toMatchObject({ localOnly: true, document: local });
});

test('counts physical downloads separately from files that are current', () => {
  const first = { ...resource('Topic/a.pdf'), size: 10 };
  const second = { ...resource('Topic/Sub/b.pdf'), size: 20 };
  const downloaded = (item) => ({ ...item, localUri: `file:///${item.name}`, fingerprint: resourceFingerprint(item), available: true });
  const partial = buildResourceTree([first, second], [downloaded(first)]);
  expect(partial[0]).toMatchObject({ totalFiles: 2, downloadedFiles: 1, currentFiles: 1 });
  const complete = buildResourceTree([first, second], [downloaded(first), downloaded(second)]);
  expect(complete[0]).toMatchObject({ totalFiles: 2, downloadedFiles: 2, currentFiles: 2 });
  expect(complete[0].children[1]).toMatchObject({ totalFiles: 1, downloadedFiles: 1, currentFiles: 1 });
  const stale = buildResourceTree([first, { ...second, size: 21 }], [downloaded(first), downloaded(second)]);
  expect(stale[0]).toMatchObject({ totalFiles: 2, downloadedFiles: 2, currentFiles: 1 });
});

test('does not mark an empty folder as a completed download', () => {
  expect(buildResourceTree([resource('Empty', true)], [])[0]).toMatchObject({ totalFiles: 0, downloadedFiles: 0, currentFiles: 0 });
});

test('unverified or unavailable local files never complete a folder even with a current fingerprint', () => {
  const remote = resource('Topic/notes.pdf');
  for (const available of [undefined, false]) {
    const local = { ...remote, localUri: 'file:///missing.pdf', available, fingerprint: resourceFingerprint(remote) };
    expect(buildResourceTree([remote], [local])[0]).toMatchObject({ totalFiles: 1, downloadedFiles: 0, currentFiles: 0 });
    expect(buildResourceTree([], [local])[0]).toMatchObject({ totalFiles: 1, downloadedFiles: 0, currentFiles: 0 });
  }
});
