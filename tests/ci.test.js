const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('uses validated tags rather than the package version and strips native prerelease suffixes', async () => {
  const { createMetadata } = await import('../scripts/ci-metadata.mjs');
  assert.deepEqual(createMetadata({
    refType: 'tag', refName: 'v2.3.4-rc.1', runNumber: '42', packageVersion: '1.0.0',
  }), {
    version: '2.3.4-rc.1', native_version: '2.3.4', prerelease: true, build_number: '42',
  });
  assert.deepEqual(createMetadata({
    refType: 'tag', refName: 'v2.3.4', runNumber: '42', packageVersion: '1.0.0',
  }), {
    version: '2.3.4', native_version: '2.3.4', prerelease: false, build_number: '42',
  });
});

test('uses only package metadata for branches and pull request refs', async () => {
  const { createMetadata } = await import('../scripts/ci-metadata.mjs');
  for (const refName of ['main', '123/merge', 'v8.8.8', 'feature/$(not-a-command)']) {
    assert.deepEqual(createMetadata({
      refType: 'branch', refName, runNumber: '7', packageVersion: '1.2.0-beta.2',
    }), {
      version: '1.2.0-beta.2', native_version: '1.2.0', prerelease: true, build_number: '7',
    });
  }
  assert.throws(() => createMetadata({
    refType: 'other', refName: 'main', runNumber: '1', packageVersion: '1.0.0',
  }), /ref type/);
});

test('rejects malformed tags without silently falling back to the package version', async () => {
  const { createMetadata, parseTag } = await import('../scripts/ci-metadata.mjs');
  for (const tag of [
    undefined, null, 123, '', '1.2.3', 'V1.2.3', 'v', 'v1.2', 'v1.2.3.4',
    'v01.2.3', 'v1.02.3', 'v1.2.03', 'v1.2.3-01', 'v1.2.3-rc.01',
    'v1.2.3-', 'v1.2.3-rc..1', 'v1.2.3+build.1', 'v1.2.3/extra',
    ' v1.2.3', 'v1.2.3 ', 'v1.2.3\n', 'v1.2.3\r\n', 'v1.2.3\0',
    'v1.2.3-$(id)', 'v1.2.3;false', 'v1.2.3-`id`', 'v1.2.3-"quoted"',
  ]) {
    assert.throws(() => parseTag(tag), Error, String(tag));
    assert.throws(() => createMetadata({
      refType: 'tag', refName: tag, runNumber: '1', packageVersion: '1.0.0',
    }), Error, String(tag));
  }
});

test('enforces portable version bounds while accepting valid prerelease identifiers', async () => {
  const { parseVersion, parseTag } = await import('../scripts/ci-metadata.mjs');
  for (const version of ['0.0.0', '65535.65535.65535', '1.2.3-0', '1.2.3-rc.0', '1.2.3-alpha-1.a01']) {
    assert.equal(parseVersion(version).version, version);
    assert.equal(parseTag(`v${version}`).version, version);
  }
  for (const version of [undefined, 123, '65536.0.0', '1.65536.0', '1.0.65536', '99999999999999999.0.0', `1.2.3-${'a'.repeat(123)}`]) {
    assert.throws(() => parseVersion(version), /Version/);
  }
  assert.equal(parseVersion(`1.2.3-${'a'.repeat(122)}`).version.length, 128);
});

test('enforces canonical positive run numbers and Android version code bounds', async () => {
  const { createMetadata } = await import('../scripts/ci-metadata.mjs');
  const create = (runNumber) => createMetadata({
    refType: 'branch', refName: 'main', runNumber, packageVersion: '1.0.0',
  });
  for (const number of ['1', '9999', '10000', '2100000000']) {
    assert.equal(create(number).build_number, number);
  }
  for (const number of [
    undefined, null, 1, '', '0', '-1', '01', '+1', '1.0', '1e3', '0x10',
    ' 1', '1 ', '1\n', '1\r\n', 'NaN', 'Infinity', '2100000001', '9007199254740992',
  ]) assert.throws(() => create(number), /run number/, String(number));
});

test('flattens distributables into deterministic names and SHA-256 checksums', async () => {
  const { prepareReleaseAssets } = await import('../scripts/release-assets.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sakai-ci-assets-'));
  try {
    const input = path.join(root, 'downloads');
    const output = path.join(root, 'release');
    const first = path.join(input, 'release-web');
    const second = path.join(input, 'release-android');
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(second);
    const entries = [
      ['SakaiClient-web.zip', Buffer.from('web archive')],
      ['SakaiClient-android-unsigned.apk', Buffer.from([0, 1, 2, 128, 255])],
    ];
    await fs.writeFile(path.join(first, entries[0][0]), entries[0][1]);
    await fs.writeFile(path.join(second, entries[1][0]), entries[1][1]);
    const result = await prepareReleaseAssets(input, output);
    const sorted = [...entries].sort(([a], [b]) => a < b ? -1 : 1);
    assert.deepEqual(result.assets, sorted.map(([name]) => path.join(output, name)));
    assert.equal(result.checksumPath, path.join(output, 'SHA256SUMS.txt'));
    assert.equal(await fs.readFile(result.checksumPath, 'utf8'), sorted.map(([name, bytes]) =>
      `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`).join(''));
    for (const [name, bytes] of entries) assert.deepEqual(await fs.readFile(path.join(output, name)), bytes);
    assert.deepEqual((await fs.readdir(output)).sort(), ['SHA256SUMS.txt', ...entries.map(([name]) => name)].sort());
    await assert.rejects(prepareReleaseAssets(input, output), { code: 'EEXIST' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejects duplicate artifact names before copying, including case-only differences', async () => {
  const { prepareReleaseAssets } = await import('../scripts/release-assets.mjs');
  for (const secondName of ['SakaiClient-web.zip', 'SakaiClient-WEB.zip']) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sakai-ci-duplicates-'));
    try {
      const input = path.join(root, 'downloads');
      const output = path.join(root, 'release');
      await fs.mkdir(path.join(input, 'one'), { recursive: true });
      await fs.mkdir(path.join(input, 'two'));
      await fs.writeFile(path.join(input, 'one', 'SakaiClient-web.zip'), 'first');
      await fs.writeFile(path.join(input, 'two', secondName), 'second');
      await assert.rejects(prepareReleaseAssets(input, output), /Duplicate release asset/);
      await assert.rejects(fs.stat(output), { code: 'ENOENT' });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

test('rejects empty inputs, non-distributables, unsafe filenames and overlapping output directories', async () => {
  const { prepareReleaseAssets } = await import('../scripts/release-assets.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sakai-ci-invalid-'));
  try {
    const input = path.join(root, 'downloads');
    const output = path.join(root, 'release');
    await fs.mkdir(input);
    await assert.rejects(prepareReleaseAssets(input, output), /No release assets/);
    await assert.rejects(prepareReleaseAssets(input, input), /overlap/);
    await assert.rejects(prepareReleaseAssets(input, path.join(input, 'output')), /overlap/);
    await assert.rejects(prepareReleaseAssets(input, root), /overlap/);
    for (const name of ['debug.keystore', 'SakaiClient-debug.yml', 'SakaiClient-web.zip\n', 'SakaiClient-web#label.zip', 'SakaiClient-$(id).zip']) {
      const file = path.join(input, name);
      await fs.writeFile(file, 'not a distributable');
      await assert.rejects(prepareReleaseAssets(input, output), /safe SakaiClient/);
      await fs.unlink(file);
    }
    await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('rejects symlinks instead of including files outside the artifact tree', { skip: process.platform === 'win32' }, async () => {
  const { prepareReleaseAssets } = await import('../scripts/release-assets.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sakai-ci-links-'));
  try {
    const input = path.join(root, 'downloads');
    const output = path.join(root, 'release');
    const outside = path.join(root, 'outside.zip');
    await fs.mkdir(input);
    await fs.writeFile(outside, 'outside');
    await fs.symlink(outside, path.join(input, 'SakaiClient-web.zip'));
    await assert.rejects(prepareReleaseAssets(input, output), /symlinks/);
    const linkedRoot = path.join(root, 'linked-downloads');
    await fs.symlink(input, linkedRoot);
    await assert.rejects(prepareReleaseAssets(linkedRoot, output), /not a symlink/);
    await assert.rejects(prepareReleaseAssets(input, path.join(linkedRoot, 'output')), /overlap/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
