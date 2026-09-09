const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { DesktopStorage } = require('../desktop/storage.cjs');

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'sakai-relocation-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const storage = new DesktopStorage({ directory: path.join(directory, 'private'), documents: path.join(directory, 'documents'), safeStorage: {} });
  await storage.init();
  await fs.mkdir(path.join(directory, 'source'));
  await fs.mkdir(path.join(directory, 'destination'));
  const source = await storage.registerRoot(path.join(directory, 'source'));
  const destination = await storage.registerRoot(path.join(directory, 'destination'));
  const contents = '%PDF-1.7\nrelocation fixture\n';
  const segments = ['Physics', 'Topic', 'notes.pdf'];
  const seed = (root, parts = segments) => storage.download(root.uri, {
    downloadUrl: 'https://poliformat.upv.es/access/content/group/course/notes.pdf', size: contents.length,
  }, parts, { downloadResponse: async () => new Response(contents) }, new AbortController().signal);
  const uri = await seed(source);
  return { storage, source, destination, contents, segments, uri, seed, directory };
}

test('relocation persists a verified destination capability before explicit original removal', async (t) => {
  const { storage, uri, destination, contents, segments } = await fixture(t);
  const copied = await storage.copyLocalFile(uri, destination.uri, {}, segments);
  assert.equal(await fs.readFile(await storage.resolveFile(copied), 'utf8'), contents);
  assert.equal(await storage.exists(uri), true);
  assert.equal(await storage.copyLocalFile(uri, destination.uri, {}, segments), copied);
  const restored = new DesktopStorage({ directory: storage.directory, documents: storage.documents, safeStorage: {} });
  await restored.init();
  assert.equal(await restored.exists(copied), true);
  await storage.removeCopiedOriginal(uri, copied);
  assert.equal(await fs.readFile(await storage.resolveFile(copied), 'utf8'), contents);
  await assert.rejects(storage.resolveFile(uri));
});

test('resolves only a registered directory capability for opening in the file manager', async (t) => {
  const { storage, destination, directory } = await fixture(t);
  assert.equal(await storage.resolveRoot(destination.uri), path.join(directory, 'destination'));
  await assert.rejects(storage.resolveRoot('sakai-root://not-registered'), { code: 'FORBIDDEN' });
  await assert.rejects(storage.resolveRoot('file:///tmp'), { code: 'FORBIDDEN' });
});

test('relocation rejects differing destination contents without overwriting either file', async (t) => {
  const { storage, uri, destination, contents, segments } = await fixture(t);
  const target = await storage.targetPath(destination.uri.slice('sakai-root://'.length), segments, true);
  await fs.writeFile(target, 'unrelated document');
  await assert.rejects(storage.copyLocalFile(uri, destination.uri, {}, segments), { code: 'BUSY' });
  assert.equal(await fs.readFile(target, 'utf8'), 'unrelated document');
  assert.equal(await fs.readFile(await storage.resolveFile(uri), 'utf8'), contents);
});

test('exclusive publication preserves a conflicting file created after preflight', async (t) => {
  const { storage, uri, destination, contents, segments } = await fixture(t);
  const rootId = destination.uri.slice('sakai-root://'.length);
  const targetPath = storage.targetPath.bind(storage);
  let conflict;
  storage.targetPath = async (id, parts, create) => {
    const target = await targetPath(id, parts, create);
    if (id === rootId && !create && !conflict) {
      conflict = target;
      await fs.writeFile(target, 'concurrent external file', { flag: 'wx' });
    }
    return target;
  };
  await assert.rejects(storage.copyLocalFile(uri, destination.uri, {}, segments), { code: 'EEXIST' });
  assert.equal(await fs.readFile(conflict, 'utf8'), 'concurrent external file');
  assert.equal(await fs.readFile(await storage.resolveFile(uri), 'utf8'), contents);
  assert.equal(storage.locks.size, 0);
  assert.equal(Object.keys(storage.state.files).length, 1);
  assert.deepEqual(await fs.readdir(path.dirname(conflict)), ['notes.pdf']);
});

test('identical unregistered destination copies are verified, registered and reused', async (t) => {
  const { storage, uri, destination, contents, segments } = await fixture(t);
  const target = await storage.targetPath(destination.uri.slice('sakai-root://'.length), segments, true);
  await fs.writeFile(target, contents);
  const copied = await storage.copyLocalFile(uri, destination.uri, {}, segments);
  assert.equal(await storage.resolveFile(copied), target);
  assert.equal(await storage.copyLocalFile(uri, destination.uri, {}, segments), copied);
  assert.equal(await storage.exists(uri), true);
});

test('preflight rejects overlapping roots in both directions but permits the same root', async (t) => {
  const { storage, source, uri, directory, segments, seed } = await fixture(t);
  const nestedPath = path.join(directory, 'source', 'Nested');
  await fs.mkdir(nestedPath);
  const nested = await storage.registerRoot(nestedPath);
  const nestedUri = await seed(nested);
  await assert.rejects(storage.validateRelocation(nested.uri, [uri]), { code: 'FORBIDDEN' });
  await assert.rejects(storage.validateRelocation(source.uri, [nestedUri]), { code: 'FORBIDDEN' });
  await assert.rejects(storage.copyLocalFile(uri, nested.uri, {}, segments), { code: 'FORBIDDEN' });
  assert.equal(await storage.copyLocalFile(uri, source.uri, {}, segments), uri);
});

test('an aborted relocation does not remove originals or register destination capabilities', async (t) => {
  const { storage, uri, destination, contents, segments } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(storage.copyLocalFile(uri, destination.uri, {}, segments, controller.signal), { name: 'AbortError' });
  assert.equal(await fs.readFile(await storage.resolveFile(uri), 'utf8'), contents);
  assert.equal(Object.keys(storage.state.files).length, 1);
});

test('cleanup preserves an original that changed after the verified copy', async (t) => {
  const { storage, uri, destination, segments } = await fixture(t);
  const copied = await storage.copyLocalFile(uri, destination.uri, {}, segments);
  const original = await storage.resolveFile(uri);
  await fs.writeFile(original, '%PDF-1.7\nupdated locally\n');
  await assert.rejects(storage.removeCopiedOriginal(uri, copied), { code: 'INVALID_DOCUMENT' });
  assert.equal(await fs.readFile(original, 'utf8'), '%PDF-1.7\nupdated locally\n');
});

test('case aliases of one physical file are never removed as redundant originals', async (t) => {
  const { storage, source, uri, segments, seed } = await fixture(t);
  const aliasSegments = [...segments.slice(0, -1), 'NOTES.pdf'];
  const original = await storage.resolveFile(uri);
  const aliasPath = path.join(path.dirname(original), 'NOTES.pdf');
  const caseAliasExists = await fs.stat(aliasPath).then(() => true, (error) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (!caseAliasExists) return;
  assert.equal(await storage.copyLocalFile(uri, source.uri, {}, aliasSegments), uri);
  const alias = await seed(source, aliasSegments);
  assert.notEqual(alias, uri);
  await storage.removeCopiedOriginal(uri, alias);
  assert.equal(await storage.exists(uri), true);
  assert.equal(await storage.exists(alias), true);
});

test('an aborted desktop download removes partial data and its recovery transaction', async (t) => {
  const { storage, destination, segments } = await fixture(t);
  const controller = new AbortController();
  const started = Promise.withResolvers();
  const network = { downloadResponse: async (_url, signal) => new Response(new ReadableStream({
    start(value) {
      value.enqueue(new TextEncoder().encode('%PDF-1.7\npartial'));
      started.resolve();
      signal.addEventListener('abort', () => value.error(signal.reason), { once: true });
    },
    cancel() {},
  }), { headers: { 'Content-Type': 'application/pdf' } }) };
  const operation = storage.download(destination.uri, {
    downloadUrl: 'https://poliformat.upv.es/access/content/group/course/slow.pdf',
    size: 10_000,
    contentType: 'application/pdf',
  }, segments, network, controller.signal);
  await started.promise;
  controller.abort(new Error('Download timeout'));
  await assert.rejects(operation, /Download timeout/);
  const target = await storage.targetPath(destination.uri.slice('sakai-root://'.length), segments, true);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  assert.equal(storage.locks.size, 0);
  assert.equal(Object.keys(storage.state.transactions).length, 0);
});
