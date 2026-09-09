import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';

import { clearStoredAuthentication, restoreAuthenticatedClient } from '../src/lib/auth.ts';
import * as credentials from '../src/lib/credentials.ts';
import * as files from '../src/lib/files.ts';
import { SakaiClient, SakaiError } from '../src/lib/sakai-client.ts';
import { DOWNLOAD_TIMEOUT_MS, syncResources, selectDownloadResources } from '../src/lib/sync-engine.ts';

const resource = {
  id: '/group/course/Topic/notes.pdf', courseId: 'course', name: 'notes.pdf',
  remotePath: 'Topic/notes.pdf', downloadUrl: 'https://poliformat.upv.es/access/content/group/course/Topic/notes.pdf',
  contentType: 'application/pdf', size: 4,
};

beforeEach(() => { spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => { mock.restore(); });

test('downloads using cookies when Sakai hides the current session ID', async () => {
  const fetch = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ id: null, userId: 'user', userEid: 'eid' }))
    .mockResolvedValueOnce(new Response('%PDF', { headers: { 'Content-Type': 'application/pdf' } }));
  const client = new SakaiClient();
  expect(await client.getCurrentSession()).toMatchObject({ id: '', userId: 'user' });
  expect(new URL(fetch.mock.calls[0][0]).searchParams.has('_')).toBe(true);
  expect(fetch.mock.calls[0][1].headers['Cache-Control']).toBe('no-cache, no-store');
  expect(client.currentSessionId).toBeUndefined();
  const chunks = [];
  await client.downloadResource(resource, new WritableStream({ write(chunk) { chunks.push(chunk); } }));
  expect(new TextDecoder().decode(chunks[0])).toBe('%PDF');
  expect(fetch.mock.calls[1][1].credentials).toBe('include');
  expect(new Headers(fetch.mock.calls[1][1].headers).has('cookie')).toBe(false);
});

test('reports streamed download bytes without exposing response contents', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValue(new Response('%PDF', { headers: { 'Content-Length': '4' } }));
  const progress = mock(() => {});
  await new SakaiClient().downloadResource(resource, new WritableStream(), undefined, progress);
  expect(progress.mock.calls).toEqual([[0, 4], [4, 4]]);
});

test('follows only same-origin document redirects without exposing private URL parameters', async () => {
  const fetch = spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('', { status: 302, headers: { Location: 'renamed.pdf?token=private' } }))
    .mockResolvedValueOnce(new Response('%PDF'));
  const chunks = [];
  await new SakaiClient().downloadResource(resource, new WritableStream({ write(chunk) { chunks.push(chunk); } }));
  expect(new TextDecoder().decode(chunks[0])).toBe('%PDF');
  expect(fetch.mock.calls[1][0]).toBe('https://poliformat.upv.es/access/content/group/course/Topic/renamed.pdf?token=private');
  expect(console.info.mock.calls.flat().join('\n')).not.toContain('private');
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

test.each(['https://cas.upv.es/cas/login', '/portal/login'])('rejects a login redirect during download: %s', async (location) => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 302, headers: { Location: location } }));
  const error = await new SakaiClient().downloadResource(resource, new WritableStream()).catch((error) => error);
  expect(error).toBeInstanceOf(SakaiError);
  expect(error.status).toBe(401);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test('does not forward downloads to another host', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(Response.redirect('https://outside.example/file.pdf'));
  await expect(new SakaiClient().downloadResource(resource, new WritableStream())).rejects.toThrow('fuera del servidor');
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([401, 403, 500])('preserves HTTP failure %i without returning a file', async (status) => {
  spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Error', { status }));
  const error = await new SakaiClient().downloadResource(resource, new WritableStream()).catch((error) => error);
  expect(error.status).toBe(status);
});

test('rejects an HTML login page returned in place of a PDF', async () => {
  spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>Login</html>', { headers: { 'Content-Type': 'text/html' } }));
  await expect(new SakaiClient().downloadResource(resource, new WritableStream())).rejects.toThrow('HTML en lugar');
});

test('restores a cookie session with an empty login marker and no saved credentials', async () => {
  spyOn(credentials, 'loadSessionId').mockResolvedValue('');
  const savedCredentials = spyOn(credentials, 'loadCredentials');
  const login = spyOn(SakaiClient.prototype, 'login');
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: null, userId: 'user' }));
  expect(await restoreAuthenticatedClient()).toBeInstanceOf(SakaiClient);
  expect(savedCredentials).not.toHaveBeenCalled();
  expect(login).not.toHaveBeenCalled();
});

test('does not treat an anonymous cookie session as authenticated', async () => {
  spyOn(credentials, 'loadSessionId').mockResolvedValue('');
  spyOn(credentials, 'loadCredentials').mockResolvedValue(null);
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: null, userId: null, active: true }));
  expect(await restoreAuthenticatedClient()).toBeNull();
});

test('persists the cookie-only login marker after reauthentication', async () => {
  spyOn(credentials, 'loadSessionId').mockResolvedValue('');
  spyOn(credentials, 'loadCredentials').mockResolvedValue({ username: 'user', password: 'secret' });
  const save = spyOn(credentials, 'saveSessionId').mockResolvedValue();
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ id: null, userId: null }));
  spyOn(SakaiClient.prototype, 'login').mockResolvedValue({ id: '', userId: 'user', userEid: 'eid' });
  expect(await restoreAuthenticatedClient()).toBeInstanceOf(SakaiClient);
  expect(save).toHaveBeenCalledWith('');
});

test('does not restore leftover cookies after explicit logout removes the login marker', async () => {
  spyOn(credentials, 'loadSessionId').mockResolvedValue(null);
  spyOn(credentials, 'loadCredentials').mockResolvedValue(null);
  const fetch = spyOn(globalThis, 'fetch');
  expect(await restoreAuthenticatedClient()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test('aborts the native request if writing the destination fails', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('%PDF'));
  const destination = new WritableStream({ write() { throw new Error('Disk full'); } });
  await expect(new SakaiClient().downloadResource(resource, destination)).rejects.toThrow('Disk full');
  expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
});

test('logs out cookie-only sessions through the portal', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 302, headers: { Location: '/portal' } }));
  await new SakaiClient().logout();
  expect(fetch.mock.calls[0][0]).toBe('https://poliformat.upv.es/portal/logout');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual', credentials: 'include' });
});

test('syncs documents without a session ID and keeps folders in the remote tree only', async () => {
  const client = new SakaiClient();
  const folder = { ...resource, id: 'folder', name: 'Topic', remotePath: 'Topic', isFolder: true };
  spyOn(client, 'getCourseResources').mockResolvedValue([folder, resource]);
  const download = mock(async () => 'file:///Topic/notes.pdf');
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', rootName: 'library', exists: () => false, download });
  const result = await syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], {}, { type: 'all' });
  expect(result).toMatchObject({ total: 1, downloaded: 1, failed: 0 });
  expect(download).toHaveBeenCalledWith(resource, ['Physics', 'Topic', 'notes.pdf'], client, expect.any(AbortSignal), expect.any(Function));
  expect(result.resourcesByCourse.course).toEqual([folder, resource]);
  expect(Object.values(result.documents)).toHaveLength(1);
});

test('propagates expired authentication from downloads instead of hiding it as a file failure', async () => {
  const client = new SakaiClient();
  spyOn(client, 'getCourseResources').mockResolvedValue([resource]);
  const error = new SakaiError('Expired', 401);
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', rootName: 'library', exists: () => false, download: async () => { throw error; } });
  await expect(syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], {}, { type: 'all' })).rejects.toBe(error);
});

test('folder downloads respect path segment boundaries and include descendants only', () => {
  const resources = ['Topic 1/a.pdf', 'Topic 1/Sub/b.pdf', 'Topic 10/c.pdf', 'other.pdf'].map((remotePath) => ({ ...resource, remotePath }));
  expect(selectDownloadResources(resources, { type: 'folder', courseId: 'course', path: 'Topic 1' }).map((item) => item.remotePath)).toEqual(['Topic 1/a.pdf', 'Topic 1/Sub/b.pdf']);
});

test('course scope only discovers the selected course and retains globally disambiguated folder names', async () => {
  const client = new SakaiClient();
  const discover = spyOn(client, 'getCourseResources').mockResolvedValue([resource]);
  const download = mock(async () => 'file:///notes.pdf');
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', exists: () => false, download });
  const catalog = [{ id: 'course', title: 'Physics', description: '' }, { id: 'other', title: 'Physics', description: '' }];
  await syncResources(client, catalog, {}, { type: 'course', courseId: 'course' });
  expect(discover).toHaveBeenCalledTimes(1);
  expect(discover).toHaveBeenCalledWith('course', undefined);
  expect(download.mock.calls[0][1][0]).toStartWith('Physics (');
});

test('file scope does not discover or download the rest of the course', async () => {
  const client = new SakaiClient();
  const discover = spyOn(client, 'getCourseResources');
  const download = mock(async () => 'file:///notes.pdf');
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', exists: () => false, download });
  await syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], {}, { type: 'file', courseId: 'course', resource });
  expect(discover).not.toHaveBeenCalled();
  expect(download).toHaveBeenCalledTimes(1);
});

test('cancelling a download preserves completed documents and stops the next file', async () => {
  const controller = new AbortController();
  const client = new SakaiClient();
  spyOn(client, 'getCourseResources').mockResolvedValue([resource, { ...resource, id: 'second', remotePath: 'Topic/second.pdf' }]);
  const download = mock(async () => { controller.abort(); return 'file:///notes.pdf'; });
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', exists: () => false, download });
  const checkpoint = mock(async () => {});
  const result = await syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], {}, { type: 'course', courseId: 'course' }, undefined, undefined, controller.signal, checkpoint);
  expect(result.cancelled).toBe(true);
  expect(result.downloaded).toBe(1);
  expect(download).toHaveBeenCalledTimes(1);
  expect(checkpoint).toHaveBeenCalledTimes(1);
});

test('times out one file after 30 seconds and continues with the next resource', async () => {
  expect(DOWNLOAD_TIMEOUT_MS).toBe(30_000);
  const client = new SakaiClient();
  const second = { ...resource, id: 'second', name: 'second.pdf', remotePath: 'Topic/second.pdf' };
  spyOn(client, 'getCourseResources').mockResolvedValue([resource, second]);
  let downloadCount = 0;
  const download = mock(async (item, _segments, _client, signal) => {
    downloadCount += 1;
    if (downloadCount > 1) return `file:///${item.name}`;
    return new Promise((_resolve, reject) => {
      const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  });
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', rootName: 'library', exists: () => false, download });
  const updates = [];
  const result = await syncResources(
    client,
    [{ id: 'course', title: 'Physics', description: '' }],
    {},
    { type: 'course', courseId: 'course' },
    undefined,
    (value) => updates.push(value),
    undefined,
    undefined,
    1,
  );
  expect(result).toMatchObject({ total: 2, downloaded: 1, skipped: 0, failed: 0, timedOut: 1, cancelled: false });
  expect(download).toHaveBeenCalledTimes(2);
  expect(updates.some((value) => value.timedOut === 1)).toBe(true);
});

test('the per-file timeout also bounds a stalled physical existence check', async () => {
  const client = new SakaiClient();
  const second = { ...resource, id: 'second', name: 'second.pdf', remotePath: 'Topic/second.pdf' };
  spyOn(client, 'getCourseResources').mockResolvedValue([resource, second]);
  const exists = mock((uri) => uri.includes('old') ? new Promise(() => {}) : false);
  const download = mock(async (item) => `file:///${item.name}`);
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', rootName: 'library', exists, download });
  const previous = { ...resource, localUri: 'file:///old/notes.pdf', fingerprint: 'old', available: true };
  const result = await syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], { 'course:/group/course/Topic/notes.pdf': previous }, { type: 'course', courseId: 'course' }, undefined, undefined, undefined, undefined, 1);
  expect(result).toMatchObject({ total: 2, downloaded: 1, timedOut: 1, failed: 0, cancelled: false });
  expect(download).toHaveBeenCalledTimes(1);
  expect(download.mock.calls[0][0]).toBe(second);
});

test('a failed document checkpoint is reported only as failed, never also downloaded', async () => {
  const client = new SakaiClient();
  spyOn(client, 'getCourseResources').mockResolvedValue([resource]);
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', rootName: 'library', exists: () => false, download: async () => 'file:///notes.pdf' });
  const result = await syncResources(
    client,
    [{ id: 'course', title: 'Physics', description: '' }],
    {},
    { type: 'course', courseId: 'course' },
    undefined,
    undefined,
    undefined,
    async () => { throw new Error('Index write failed'); },
  );
  expect(result).toMatchObject({ total: 1, downloaded: 0, failed: 1, timedOut: 0 });
  expect(Object.keys(result.documents)).toEqual([]);
});

test('an untrusted imported URI is never probed or reused during download', async () => {
  const client = new SakaiClient();
  spyOn(client, 'getCourseResources').mockResolvedValue([resource]);
  const exists = mock(async () => true);
  const download = mock(async () => 'file:///safe.pdf');
  spyOn(files, 'createSyncWorkspace').mockResolvedValue({ rootUri: 'file:///', rootName: 'library', exists, download });
  const previous = { ...resource, localUri: 'file:///untrusted.pdf', fingerprint: resource.downloadUrl, available: false, localUriTrusted: false };
  const result = await syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], { 'course:/group/course/Topic/notes.pdf': previous }, { type: 'course', courseId: 'course' });
  expect(exists).not.toHaveBeenCalled();
  expect(download).toHaveBeenCalledTimes(1);
  expect(Object.values(result.documents)[0]).toMatchObject({ localUri: 'file:///safe.pdf', available: true, localUriTrusted: true });
});

test('empty folders do not create a download workspace', async () => {
  const client = new SakaiClient();
  spyOn(client, 'getCourseResources').mockResolvedValue([]);
  const workspace = spyOn(files, 'createSyncWorkspace');
  const result = await syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], {}, { type: 'folder', courseId: 'course', path: 'Empty' });
  expect(result.total).toBe(0);
  expect(workspace).not.toHaveBeenCalled();
});

test('cancels resource discovery without creating a workspace', async () => {
  const controller = new AbortController();
  const client = new SakaiClient();
  const ready = Promise.withResolvers();
  spyOn(client, 'getCourseResources').mockImplementation((_id, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    ready.resolve();
  }));
  const workspace = spyOn(files, 'createSyncWorkspace');
  const result = syncResources(client, [{ id: 'course', title: 'Physics', description: '' }], {}, { type: 'course', courseId: 'course' }, undefined, undefined, controller.signal);
  await ready.promise;
  controller.abort();
  expect((await result).cancelled).toBe(true);
  expect(workspace).not.toHaveBeenCalled();
});

test('a restoration completing after logout cannot save or return a session', async () => {
  spyOn(credentials, 'loadSessionId').mockResolvedValue('');
  spyOn(credentials, 'loadCredentials').mockResolvedValue({ username: 'user', password: 'secret' });
  spyOn(credentials, 'clearCredentials').mockResolvedValue();
  spyOn(credentials, 'clearSessionId').mockResolvedValue();
  const save = spyOn(credentials, 'saveSessionId').mockResolvedValue();
  spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ userId: null }));
  const pending = Promise.withResolvers();
  const started = Promise.withResolvers();
  spyOn(SakaiClient.prototype, 'login').mockImplementation(() => { started.resolve(); return pending.promise; });
  const restoration = restoreAuthenticatedClient();
  await started.promise;
  const cleared = clearStoredAuthentication();
  pending.resolve({ id: '', userId: 'user', userEid: 'user' });
  await cleared;
  expect(await restoration).toBeNull();
  expect(save).not.toHaveBeenCalled();
});
