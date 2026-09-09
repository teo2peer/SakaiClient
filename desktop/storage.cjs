const fs = require('node:fs/promises');
const { constants, createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const {
  DesktopFailure, FILE_LIMIT, DOWNLOAD_LIMIT, record, text, pathSegments, contained, capabilityId,
} = require('./policy.cjs');

const token = () => randomBytes(16).toString('hex');

async function regularFile(file) {
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new DesktopFailure('FORBIDDEN');
    return stat;
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readBounded(file, limit) {
  if (!(await regularFile(file))) throw new DesktopFailure('NOT_FOUND');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1) throw new DesktopFailure('FORBIDDEN');
    if (stat.size > limit) throw new DesktopFailure('LIMIT_EXCEEDED');
    const chunks = [];
    let length = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, limit - length + 1));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > limit) throw new DesktopFailure('LIMIT_EXCEEDED');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, length);
  } finally { await handle.close(); }
}

async function removeRegular(file) {
  if (await regularFile(file)) await fs.unlink(file);
}

async function sameFile(first, second) {
  const [left, right] = await Promise.all([fs.stat(first, { bigint: true }), fs.stat(second, { bigint: true })]);
  return left.dev === right.dev && left.ino === right.ino;
}

async function checksum(file, signal) {
  signal?.throwIfAborted();
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) { signal?.throwIfAborted(); hash.update(chunk); }
    return hash.digest('hex');
  } finally { await handle.close(); }
}

function replacementPaths(target) {
  const directory = path.dirname(target);
  const name = path.basename(target);
  return {
    target,
    temporary: path.join(directory, `.${name}.sakai-download`),
    backup: path.join(directory, `.${name}.sakai-backup`),
  };
}

async function recoverReplacement(files) {
  const current = await regularFile(files.target);
  const backup = await regularFile(files.backup);
  if (!current && backup) await fs.rename(files.backup, files.target);
  else if (backup) await fs.unlink(files.backup);
  await removeRegular(files.temporary);
}

async function atomicWrite(target, contents) {
  const files = replacementPaths(target);
  await recoverReplacement(files);
  const handle = await fs.open(files.temporary, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally { await handle.close(); }
  let moved = false;
  try {
    if (await regularFile(target)) { await fs.rename(target, files.backup); moved = true; }
    await fs.rename(files.temporary, target);
  } catch (error) {
    if (moved && !(await regularFile(target))) await fs.rename(files.backup, target);
    await removeRegular(files.temporary);
    throw error;
  }
  await removeRegular(files.backup);
}

class DesktopStorage {
  constructor({ directory, documents, safeStorage, forbiddenRoots = [] }) {
    this.directory = directory;
    this.documents = documents;
    this.safeStorage = safeStorage;
    this.forbiddenRoots = [directory, ...forbiddenRoots];
    this.registryPath = path.join(directory, 'capabilities.json');
    this.state = { version: 1, roots: {}, files: {}, transactions: {} };
    this.queue = Promise.resolve();
    this.secretQueue = Promise.resolve();
    this.memorySession = null;
    this.locks = new Set();
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new DesktopFailure('STORAGE');
    await fs.chmod(this.directory, 0o700);
    this.directory = await fs.realpath(this.directory);
    this.forbiddenRoots = await Promise.all(this.forbiddenRoots.map(async (root) => {
      try { return await fs.realpath(root); } catch { return path.resolve(root); }
    }));
    this.registryPath = path.join(this.directory, 'capabilities.json');
    await recoverReplacement(replacementPaths(this.registryPath));
    if (await regularFile(this.registryPath)) {
      let state;
      try { state = JSON.parse((await readBounded(this.registryPath, FILE_LIMIT)).toString('utf8')); }
      catch { throw new DesktopFailure('STORAGE'); }
      if (state?.version !== 1) throw new DesktopFailure('STORAGE');
      for (const key of ['roots', 'files', 'transactions']) record(state[key]);
      if (Object.keys(state.roots).length > 128 || Object.keys(state.files).length > 100000 ||
          Object.keys(state.transactions).length > 100000) throw new DesktopFailure('STORAGE');
      for (const [id, root] of Object.entries(state.roots)) {
        capabilityId(`sakai-root://${id}`, 'root');
        if (!root || typeof root.path !== 'string' || !path.isAbsolute(root.path)) throw new DesktopFailure('STORAGE');
      }
      for (const [id, file] of Object.entries({ ...state.files, ...state.transactions })) {
        capabilityId(`sakai-file://${id}`, 'file');
        if (!file || !Object.hasOwn(state.roots, file.rootId)) throw new DesktopFailure('STORAGE');
        pathSegments(file.segments);
      }
      this.state = state;
    }
    for (const [id, transaction] of Object.entries(this.state.transactions)) {
      try { await this.recoverTransaction(id, transaction); }
      catch (error) {
        // Removable or user-moved roots can be selected again later. Never follow a replacement symlink.
        if (!(error instanceof DesktopFailure) && error.code !== 'ENOENT' && error.code !== 'EACCES') throw error;
      }
    }
  }

  persist() {
    const result = this.queue.catch(() => undefined).then(() => {
      const bytes = Buffer.from(JSON.stringify(this.state));
      if (bytes.byteLength > FILE_LIMIT) throw new DesktopFailure('LIMIT_EXCEEDED');
      return atomicWrite(this.registryPath, bytes);
    });
    this.queue = result;
    return result;
  }

  async root(id) {
    if (!Object.hasOwn(this.state.roots, id)) throw new DesktopFailure('FORBIDDEN');
    const root = this.state.roots[id];
    if (this.forbiddenRoots.some((forbidden) => contained(forbidden, root.path) || contained(root.path, forbidden))) throw new DesktopFailure('FORBIDDEN');
    const stat = await fs.lstat(root.path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(root.path) !== root.path) {
      throw new DesktopFailure('FORBIDDEN');
    }
    return root;
  }

  async registerRoot(selectedPath) {
    const canonical = await fs.realpath(selectedPath);
    if (!(await fs.stat(canonical)).isDirectory()) throw new DesktopFailure('FORBIDDEN');
    if (this.forbiddenRoots.some((root) => contained(root, canonical) || contained(canonical, root))) throw new DesktopFailure('FORBIDDEN');
    let id = Object.keys(this.state.roots).find((key) => this.state.roots[key].path === canonical);
    if (!id) {
      if (Object.keys(this.state.roots).length >= 128) throw new DesktopFailure('LIMIT_EXCEEDED');
      id = token();
      this.state.roots[id] = { path: canonical };
      try { await this.persist(); } catch (error) { delete this.state.roots[id]; throw error; }
    }
    return { uri: `sakai-root://${id}`, name: path.basename(canonical) || 'Sakai Client' };
  }

  async createWorkspace(uri) {
    if (uri !== undefined) {
      const root = await this.root(capabilityId(uri, 'root'));
      return { rootUri: uri, rootName: path.basename(root.path) || 'Sakai Client' };
    }
    const defaultPath = path.join(this.documents, 'Sakai Client');
    await fs.mkdir(defaultPath, { recursive: true });
    if ((await fs.lstat(defaultPath)).isSymbolicLink()) throw new DesktopFailure('FORBIDDEN');
    const result = await this.registerRoot(defaultPath);
    return { rootUri: result.uri, rootName: result.name };
  }

  async resolveRoot(uri) {
    return (await this.root(capabilityId(uri, 'root'))).path;
  }

  async targetPath(rootId, segments, create = false) {
    pathSegments(segments);
    const root = await this.root(rootId);
    let directory = root.path;
    for (const segment of segments.slice(0, -1)) {
      directory = path.join(directory, segment);
      if (this.forbiddenRoots.some((root) => contained(root, directory))) throw new DesktopFailure('FORBIDDEN');
      if (create) {
        try { await fs.mkdir(directory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) {
        throw new DesktopFailure('FORBIDDEN');
      }
    }
    const target = path.join(directory, segments.at(-1));
    if (!contained(root.path, target) || this.forbiddenRoots.some((root) => contained(root, target))) {
      throw new DesktopFailure('FORBIDDEN');
    }
    await regularFile(target);
    return target;
  }

  async recoverTransaction(id, transaction) {
    const target = await this.targetPath(transaction.rootId, transaction.segments);
    await recoverReplacement(replacementPaths(target));
    delete this.state.transactions[id];
    try { await this.persist(); } catch (error) { this.state.transactions[id] = transaction; throw error; }
  }

  async resolveFile(uri) {
    const id = capabilityId(uri, 'file');
    if (!Object.hasOwn(this.state.files, id)) throw new DesktopFailure('FORBIDDEN');
    const file = this.state.files[id];
    const target = await this.targetPath(file.rootId, file.segments);
    if (this.locks.has(target.toLowerCase())) throw new DesktopFailure('BUSY');
    for (const [key, transaction] of Object.entries(this.state.transactions)) {
      if (transaction.rootId === file.rootId && transaction.segments.join('/') === file.segments.join('/')) {
        await this.recoverTransaction(key, transaction);
      }
    }
    if (!(await regularFile(target))) throw new DesktopFailure('NOT_FOUND');
    return target;
  }

  async exists(uri) {
    try {
      if (typeof uri === 'string' && uri.startsWith('sakai-root://')) await this.root(capabilityId(uri, 'root'));
      else await this.resolveFile(uri);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'NOT_FOUND') return false;
      throw error;
    }
  }

  async readFileBase64(uri) {
    return (await readBounded(await this.resolveFile(uri), FILE_LIMIT)).toString('base64');
  }

  /** Explicit local deletion of one registered document. Never removes directories or unrelated files. */
  async deleteFile(uri) {
    const id = capabilityId(uri, 'file');
    if (!Object.hasOwn(this.state.files, id)) throw new DesktopFailure('FORBIDDEN');
    let target;
    // A file already gone still drops its capability: the renderer is forgetting the same document.
    try { target = await this.resolveFile(uri); }
    catch (error) { if (error.code !== 'NOT_FOUND') throw error; }
    if (target) await removeRegular(target);
    delete this.state.files[id];
    await this.persist();
  }

  async validateRelocation(rootUri, sources) {
    if (!Array.isArray(sources) || sources.length > 100000) throw new DesktopFailure('INVALID_INPUT');
    const target = await this.root(capabilityId(rootUri, 'root'));
    const roots = new Set();
    for (const source of sources) {
      if (typeof source !== 'string' || !source.startsWith('sakai-file://')) continue;
      const file = this.state.files[capabilityId(source, 'file')];
      if (file) roots.add(file.rootId);
    }
    for (const id of roots) {
      const source = this.state.roots[id];
      if (source.path !== target.path && (contained(source.path, target.path) || contained(target.path, source.path))) throw new DesktopFailure('FORBIDDEN');
    }
  }

  async copyLocalFile(sourceUri, rootUri, value, parts, signal = new AbortController().signal) {
    record(value);
    await this.validateRelocation(rootUri, [sourceUri]);
    signal.throwIfAborted();
    const source = await this.resolveFile(sourceUri);
    const rootId = capabilityId(rootUri, 'root');
    const segments = pathSegments(parts);
    const target = await this.targetPath(rootId, segments, true);
    if (source === target) return sourceUri;
    if (await regularFile(target)) {
      if (await sameFile(source, target)) return sourceUri;
      const existing = Object.entries(this.state.files).find(([, file]) => file.rootId === rootId && file.segments.join('/') === segments.join('/'));
      if (await checksum(source, signal) === await checksum(target, signal)) {
        if (existing) return `sakai-file://${existing[0]}`;
        const id = token();
        this.state.files[id] = { rootId, segments };
        try { await this.persist(); } catch (cause) { delete this.state.files[id]; throw cause; }
        return `sakai-file://${id}`;
      }
      throw new DesktopFailure('BUSY');
    }
    const lock = target.toLowerCase();
    if (this.locks.has(lock)) throw new DesktopFailure('BUSY');
    this.locks.add(lock);
    const temporary = path.join(path.dirname(target), `.${path.basename(target)}.sakai-relocate`);
    try {
      await removeRegular(temporary);
      const stat = await regularFile(source);
      if (!stat || stat.size > DOWNLOAD_LIMIT) throw new DesktopFailure('LIMIT_EXCEEDED');
      let copied = 0;
      const bound = new Transform({ transform(chunk, _encoding, callback) {
        copied += chunk.length;
        callback(copied > stat.size ? new DesktopFailure('LIMIT_EXCEEDED') : null, chunk);
      } });
      await pipeline(
        createReadStream(source, { flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0) }),
        bound,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
        { signal },
      );
      if (copied !== stat.size || await checksum(source, signal) !== await checksum(temporary, signal)) throw new DesktopFailure('INVALID_DOCUMENT');
      signal.throwIfAborted();
      await this.targetPath(rootId, segments);
      // Exclusive publication must not replace a file created since the initial conflict check.
      await fs.copyFile(temporary, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      signal.throwIfAborted();
      if (Object.keys(this.state.files).length >= 100000) throw new DesktopFailure('LIMIT_EXCEEDED');
      const id = token();
      this.state.files[id] = { rootId, segments };
      try { await this.persist(); } catch (cause) { delete this.state.files[id]; throw cause; }
      return `sakai-file://${id}`;
    } finally {
      await removeRegular(temporary).catch(() => undefined);
      this.locks.delete(lock);
    }
  }

  async removeCopiedOriginal(sourceUri, destinationUri, signal) {
    if (sourceUri === destinationUri) return;
    const source = await this.resolveFile(sourceUri);
    const destination = await this.resolveFile(destinationUri);
    if (source === destination || await sameFile(source, destination)) return;
    if (await checksum(source, signal) !== await checksum(destination, signal)) throw new DesktopFailure('INVALID_DOCUMENT');
    signal?.throwIfAborted();
    await removeRegular(source);
    delete this.state.files[capabilityId(sourceUri, 'file')];
    await this.persist();
  }

  async download(rootUri, value, parts, network, signal, onProgress) {
    const resource = record(value);
    text(resource.downloadUrl, 16384);
    if (resource.contentType !== undefined) text(resource.contentType, 256, true);
    if (resource.size !== undefined && (!Number.isSafeInteger(resource.size) || resource.size < 0)) throw new DesktopFailure('INVALID_INPUT');
    if (resource.size > DOWNLOAD_LIMIT) throw new DesktopFailure('LIMIT_EXCEEDED');
    const segments = pathSegments(parts);
    const rootId = capabilityId(rootUri, 'root');
    signal.throwIfAborted();
    const target = await this.targetPath(rootId, segments, true);
    const lock = target.toLowerCase();
    if (this.locks.has(lock)) throw new DesktopFailure('BUSY');
    this.locks.add(lock);
    const files = replacementPaths(target);
    const transactionId = token();
    let oldMoved = false;
    let newMoved = false;
    let committed = false;
    let journaled = false;
    let rolledBack = false;
    let reader;
    let handle;
    try {
      for (const [id, transaction] of Object.entries(this.state.transactions)) {
        if (transaction.rootId === rootId && transaction.segments.join('/') === segments.join('/')) {
          await this.recoverTransaction(id, transaction);
        }
      }
      if (await regularFile(files.temporary) || await regularFile(files.backup)) throw new DesktopFailure('STORAGE');
      this.state.transactions[transactionId] = { rootId, segments };
      await this.persist();
      journaled = true;
      signal.throwIfAborted();
      const response = await network.downloadResponse(resource.downloadUrl, signal);
      reader = response.body.getReader();
      handle = await fs.open(files.temporary, 'wx', 0o600);
      let length = 0;
      const declaredLength = response.headers.get('content-length');
      const progressTotal = resource.size ?? (declaredLength && /^\d+$/.test(declaredLength) ? Number(declaredLength) : undefined);
      onProgress?.(0, progressTotal);
      let prefix = Buffer.alloc(0);
      for (;;) {
        signal.throwIfAborted();
        const { done, value: chunk } = await reader.read();
        if (done) break;
        length += chunk.byteLength;
        onProgress?.(length, progressTotal);
        if (length > DOWNLOAD_LIMIT || resource.size !== undefined && length > resource.size) {
          throw new DesktopFailure('LIMIT_EXCEEDED');
        }
        if (prefix.length < 8192) prefix = Buffer.concat([prefix, Buffer.from(chunk.subarray(0, 8192 - prefix.length))]);
        let offset = 0;
        while (offset < chunk.byteLength) {
          signal.throwIfAborted();
          const { bytesWritten } = await handle.write(chunk, offset, chunk.byteLength - offset);
          if (!bytesWritten) throw new DesktopFailure('STORAGE');
          offset += bytesWritten;
        }
      }
      const declared = response.headers.get('content-length');
      if (resource.size !== undefined && length !== resource.size || !length && resource.size !== 0 ||
          !response.headers.get('content-encoding') && declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== length)) {
        throw new DesktopFailure('INVALID_DOCUMENT');
      }
      const beginning = prefix.toString('utf8').replace(/^\uFEFF/u, '').trimStart();
      const html = /^(?:(?:<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>)\s*)*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<form\b)/i.test(beginning) ||
        /(?:text\/html|application\/xhtml\+xml)/i.test(response.headers.get('content-type') || '');
      if (html && /(?:id=["']fm1["']|\/cas\/login|<title>[^<]*(?:log in|sign in))/i.test(beginning)) {
        throw new DesktopFailure('AUTH_REQUIRED', 401);
      }
      if (html && !(/(?:text\/html|application\/xhtml\+xml)/i.test(resource.contentType || '') && /\.html?$/i.test(target))) {
        throw new DesktopFailure('INVALID_DOCUMENT');
      }
      if ((resource.contentType === 'application/pdf' || /\.pdf$/i.test(target)) && !prefix.subarray(0, 1024).includes('%PDF-')) {
        throw new DesktopFailure('INVALID_DOCUMENT');
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.targetPath(rootId, segments);
      signal.throwIfAborted();
      if (await regularFile(target)) { await fs.rename(target, files.backup); oldMoved = true; }
      signal.throwIfAborted();
      await fs.rename(files.temporary, target);
      newMoved = true;
      await this.targetPath(rootId, segments);
      signal.throwIfAborted();
      let fileId = Object.keys(this.state.files).find((id) => {
        const file = this.state.files[id];
        return file.rootId === rootId && file.segments.join('/') === segments.join('/');
      });
      const added = !fileId;
      if (!fileId) {
        if (Object.keys(this.state.files).length >= 100000) throw new DesktopFailure('LIMIT_EXCEEDED');
        fileId = token();
        this.state.files[fileId] = { rootId, segments };
      }
      try {
        await this.persist();
        signal.throwIfAborted();
      } catch (error) { if (added) delete this.state.files[fileId]; throw error; }
      // The durable capability is the commit point. Cancellation after it cannot undo a completed download.
      committed = true;
      await this.recoverTransaction(transactionId, this.state.transactions[transactionId]).catch(() => undefined);
      return `sakai-file://${fileId}`;
    } catch (error) {
      if (journaled && !committed) {
        await this.targetPath(rootId, segments);
        if (newMoved) await removeRegular(target);
        if (oldMoved) await fs.rename(files.backup, target);
        rolledBack = true;
      }
      throw signal.aborted ? signal.reason : error;
    } finally {
      await reader?.cancel().catch(() => undefined);
      reader?.releaseLock();
      await handle?.close().catch(() => undefined);
      if (journaled && !committed && rolledBack) {
        try {
          await this.targetPath(rootId, segments);
          await removeRegular(files.temporary);
          delete this.state.transactions[transactionId];
          await this.persist();
        } catch { /* Keep the on-disk recovery journal if cleanup cannot safely finish. */ }
      } else if (!journaled) delete this.state.transactions[transactionId];
      this.locks.delete(lock);
    }
  }

  secureAvailable() {
    return this.safeStorage.isEncryptionAvailable() &&
      !(process.platform === 'linux' && this.safeStorage.getSelectedStorageBackend() === 'basic_text');
  }

  secret(operation, key, value) {
    if (!['credentials', 'session'].includes(key)) throw new DesktopFailure('FORBIDDEN');
    if (operation === 'set') text(value, 64 * 1024, true);
    const result = this.secretQueue.catch(() => undefined).then(async () => {
      const target = path.join(this.directory, `${key}.encrypted`);
      await recoverReplacement(replacementPaths(target));
      if (operation === 'clear') {
        await removeRegular(target);
        if (key === 'session') this.memorySession = null;
        return;
      }
      if (operation === 'get') {
        if (key === 'session' && this.memorySession !== null) return this.memorySession;
        if (!(await regularFile(target))) return null;
        if (!this.secureAvailable()) throw new DesktopFailure('SECURE_STORAGE_UNAVAILABLE');
        try { return this.safeStorage.decryptString(await readBounded(target, 128 * 1024)); }
        catch { throw new DesktopFailure('SECURE_STORAGE_UNAVAILABLE'); }
      }
      if (!this.secureAvailable()) {
        if (key !== 'session' || value !== '') throw new DesktopFailure('SECURE_STORAGE_UNAVAILABLE');
        await removeRegular(target);
        this.memorySession = '';
        return;
      }
      let encrypted;
      try { encrypted = this.safeStorage.encryptString(value); }
      catch { throw new DesktopFailure('SECURE_STORAGE_UNAVAILABLE'); }
      await atomicWrite(target, encrypted);
      if (key === 'session') this.memorySession = null;
    });
    this.secretQueue = result;
    return result;
  }
}

module.exports = { DesktopStorage, regularFile, readBounded, atomicWrite };
