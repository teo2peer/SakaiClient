const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { DesktopStorage } = require('../desktop/storage.cjs');

async function fixture(t) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'sakai-delete-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const storage = new DesktopStorage({ directory: path.join(directory, 'private'), documents: path.join(directory, 'documents'), safeStorage: {} });
  await storage.init();
  await fs.mkdir(path.join(directory, 'library'));
  const root = await storage.registerRoot(path.join(directory, 'library'));
  const contents = '%PDF-1.7\ndeletion fixture\n';
  const segments = ['Physics', 'Topic', 'notes.pdf'];
  const uri = await storage.download(root.uri, {
    downloadUrl: 'https://poliformat.upv.es/access/content/group/course/notes.pdf', size: contents.length,
  }, segments, { downloadResponse: async () => new Response(contents) }, new AbortController().signal);
  return { storage, root, uri, directory };
}

test('deletes a registered document, drops its capability and keeps the removal after a restart', async (t) => {
  const { storage, uri, root } = await fixture(t);
  const target = await storage.resolveFile(uri);
  await storage.deleteFile(uri);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
  await assert.rejects(storage.resolveFile(uri), { code: 'FORBIDDEN' });
  // A dropped capability is unknown, not merely missing: `exists` rejects forged URIs by contract.
  await assert.rejects(storage.exists(uri), { code: 'FORBIDDEN' });

  const restored = new DesktopStorage({ directory: storage.directory, documents: storage.documents, safeStorage: {} });
  await restored.init();
  await assert.rejects(restored.resolveFile(uri), { code: 'FORBIDDEN' });
  // Only the file goes: its folders stay for the rest of the library.
  assert.equal((await fs.stat(path.dirname(target))).isDirectory(), true);
  assert.equal(await restored.exists(root.uri), true);
});

test('rejects unregistered capabilities instead of removing anything', async (t) => {
  const { storage, uri, directory } = await fixture(t);
  const outsider = path.join(directory, 'outside.pdf');
  await fs.writeFile(outsider, 'unrelated document');
  await assert.rejects(storage.deleteFile(`sakai-file://${'0'.repeat(32)}`), { code: 'FORBIDDEN' });
  await assert.rejects(storage.deleteFile(outsider), { code: 'FORBIDDEN' });
  assert.equal(await fs.readFile(outsider, 'utf8'), 'unrelated document');
  assert.equal(await storage.exists(uri), true);
});

test('forgets a capability whose file disappeared outside the application', async (t) => {
  const { storage, uri } = await fixture(t);
  await fs.unlink(await storage.resolveFile(uri));
  await storage.deleteFile(uri);
  await assert.rejects(storage.resolveFile(uri), { code: 'FORBIDDEN' });
});
