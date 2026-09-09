import { expect, mock, test } from 'bun:test';

// The native module reports names decomposed (NFD) and the filesystem itself is
// normalization-insensitive, exactly like iCloud Drive on iOS.
const tree = new Map();
const key = (uri) => uri.replace(/\/+$/, '').normalize('NFC');
const parentOf = (uri) => uri.slice(0, uri.lastIndexOf('/'));

function joinUri(parts) {
  return parts.reduce((base, part) => {
    const value = typeof part === 'string' ? part : part.uri;
    if (!base) return value.replace(/\/+$/, '');
    return `${base}/${value.replace(/^\/+|\/+$/g, '').normalize('NFD')}`;
  }, '');
}

class Entry {
  constructor(...parts) { this.uri = joinUri(parts); }
  get name() { return this.uri.split('/').filter(Boolean).pop() ?? ''; }
  get exists() { return tree.get(key(this.uri))?.type === this.type; }
  delete() { tree.delete(key(this.uri)); }
  rename(newName) {
    const node = tree.get(key(this.uri));
    tree.delete(key(this.uri));
    this.uri = joinUri([parentOf(this.uri), newName]);
    if (tree.has(key(this.uri))) throw new Error('FileAlreadyExistsException');
    tree.set(key(this.uri), { ...node, uri: this.uri });
  }
}

class Directory extends Entry {
  get type() { return 'dir'; }
  create(options = {}) {
    if (tree.has(key(this.uri))) {
      if (options.idempotent) return;
      throw new Error(`FileAlreadyExistsException: ${this.uri}`);
    }
    tree.set(key(this.uri), { uri: this.uri, type: 'dir' });
  }
  list() {
    const prefix = `${key(this.uri)}/`;
    return [...tree.values()]
      .filter((node) => key(node.uri).startsWith(prefix) && !key(node.uri).slice(prefix.length).includes('/'))
      .map((node) => (node.type === 'dir' ? new Directory(node.uri) : new File(node.uri)));
  }
  createDirectory(name) {
    const child = new Directory(this, name);
    child.create();
    return child;
  }
  createFile(name) {
    const child = new File(this, name);
    child.create();
    return child;
  }
}

class File extends Entry {
  get type() { return 'file'; }
  create() {
    if (tree.has(key(this.uri))) throw new Error(`FileAlreadyExistsException: ${this.uri}`);
    tree.set(key(this.uri), { uri: this.uri, type: 'file', bytes: [] });
  }
  get size() { return tree.get(key(this.uri))?.bytes.length ?? 0; }
  open() {
    const node = tree.get(key(this.uri));
    let offset = 0;
    return {
      writeBytes: (chunk) => { node.bytes.push(...chunk); },
      readBytes: (count) => {
        const slice = node.bytes.slice(offset, offset + count);
        offset += slice.length;
        return Uint8Array.from(slice);
      },
      close: () => {},
    };
  }
}

mock.module('expo-file-system', () => ({
  Directory,
  File,
  FileMode: { ReadOnly: 'r', WriteOnly: 'w' },
  Paths: { document: 'file:///documents' },
}));
mock.module('expo-sharing', () => ({ isAvailableAsync: async () => false, shareAsync: async () => {} }));

const { createSyncWorkspace } = await import('../src/lib/files.native.ts');

const ROOT = 'file:///icloud/DescargasUPV';
const CONTENT = Uint8Array.from([37, 80, 68, 70, 45]);
const client = {
  downloadResource: async (_resource, stream) => {
    const writer = stream.getWriter();
    await writer.write(CONTENT);
    await writer.close();
  },
};

function seed(uris) {
  tree.clear();
  for (const uri of uris) tree.set(key(uri), { uri: uri.normalize('NFD'), type: 'dir' });
}

function resource(name) {
  return { name, remotePath: `Aldc/Teoría/${name}`, size: CONTENT.length, contentType: 'application/pdf', downloadUrl: `https://poliformat/${name}` };
}

test('reuses a folder the platform lists decomposed instead of creating it again', async () => {
  seed([ROOT, `${ROOT}/Aldc`, `${ROOT}/Aldc/Teoría`]);
  const workspace = await createSyncWorkspace(ROOT);
  const segments = ['Aldc', 'Teoría'.normalize('NFC'), 'Marco estratégico.pdf'.normalize('NFC')];

  const localUri = await workspace.download(resource('Marco estratégico.pdf'), segments, client);

  expect(localUri.normalize('NFC')).toBe(`${ROOT}/Aldc/Teoría/Marco estratégico.pdf`.normalize('NFC'));
  const directories = [...tree.values()].filter((node) => node.type === 'dir').map((node) => node.uri.normalize('NFC'));
  expect(directories).toEqual([ROOT, `${ROOT}/Aldc`, `${ROOT}/Aldc/Teoría`].map((uri) => uri.normalize('NFC')));
  expect(tree.get(key(`${ROOT}/Aldc/Teoría/Marco estratégico.pdf`)).bytes).toEqual([...CONTENT]);
});

test('replaces a stored document whose name is listed under another normalization', async () => {
  seed([ROOT, `${ROOT}/Aldc`, `${ROOT}/Aldc/Teoría`]);
  const stored = `${ROOT}/Aldc/Teoría/Relación Española.pdf`.normalize('NFD');
  tree.set(key(stored), { uri: stored, type: 'file', bytes: [0] });
  const workspace = await createSyncWorkspace(ROOT);
  const segments = ['Aldc', 'Teoría'.normalize('NFC'), 'Relación Española.pdf'.normalize('NFC')];

  await workspace.download(resource('Relación Española.pdf'), segments, client);

  const files = [...tree.values()].filter((node) => node.type === 'file');
  expect(files).toHaveLength(1);
  expect(files[0].bytes).toEqual([...CONTENT]);
});
