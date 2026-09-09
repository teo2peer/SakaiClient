const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const {
  APP_URL, DesktopFailure, publicError, serviceUrl, requestInput, redirectTarget,
  isAppUrl, trustedSender, pathSegments, contained, capabilityId, contentSecurityPolicy,
} = require('../desktop/policy.cjs');

const service = 'https://poliformat.upv.es';
const cas = 'https://cas.upv.es';

test('allows the existing Sakai login and discovery endpoints with their exact methods', () => {
  for (const [url, method] of [
    [`${service}/direct/session`, 'POST'],
    [`${service}/direct/session/current.json?_=1`, 'GET'],
    [`${service}/direct/session/session-id`, 'DELETE'],
    [`${service}/direct/site.json?_limit=0`, 'GET'],
    [`${service}/direct/announcement/user.json?n=1000`, 'GET'],
    [`${service}/direct/content/resources/group/course.json?depth=all`, 'GET'],
    [`${service}/dav/group/course/`, 'PROPFIND'],
    [`${service}/portal/login`, 'GET'],
    [`${service}/portal/logout`, 'GET'],
    [`${service}/portal/site/!gateway-es/tool/id`, 'GET'],
    [`${service}/sakai-login-tool/container;jsessionid=opaque?ticket=opaque`, 'GET'],
    [`${cas}/cas/login?service=${encodeURIComponent(`${service}/sakai-login-tool/container`)}`, 'POST'],
    [`${cas}/cas/continue`, 'POST'],
  ]) assert.equal(serviceUrl(url, method).origin, new URL(url).origin);
});

test('rejects origin confusion, malformed paths, userinfo and unrelated APIs', () => {
  for (const url of [
    `${service}.evil.example/direct/site.json`, 'https://evil.example/direct/site.json',
    'http://poliformat.upv.es/direct/site.json', 'https://poliformat.upv.es:444/direct/site.json',
    'https://poliformat.upv.es./direct/site.json', 'https://user:password@poliformat.upv.es/direct/site.json',
    'https://@poliformat.upv.es/direct/site.json', 'https://poliformat.upv.es\\@evil.example/direct/site.json',
    ` ${service}/direct/site.json`, `${service}/direct/site.json\n`, `${service}/direct/site.json#fragment`,
    `${service}/direct/../direct/site.json`, `${service}/direct/%2e%2e/direct/site.json`,
    `${service}/direct/%252e%252e/direct/site.json`, `${service}/dav/group/course/%2fsecret`,
    `${service}/dav/group/course/..;jsessionid=test/private`, `${service}/dav/group/course/%00file`,
    `${service}/direct/user.json`, `${service}/direct/admin.json`, `${service}/other`,
    `${cas}/cas/login?service=${encodeURIComponent('https://evil.example/steal')}`,
    `${cas}/cas/login?service=${encodeURIComponent(`${service}/direct/site.json`)}`,
  ]) assert.throws(() => serviceUrl(url), DesktopFailure, url);
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST', 'PROPFIND', 'CONNECT']) {
    assert.throws(() => serviceUrl(`${service}/direct/site.json`, method), DesktopFailure);
  }
});

test('allows document endpoints but never follows downloads into authentication or off-service URLs', () => {
  for (const location of ['/access/content/group/course/Unit%201/notes.pdf', '/dav/group/course/notes.pdf', '/content/attachment/site/file.pdf']) {
    assert.equal(serviceUrl(`${service}${location}`, 'GET', true).origin, service);
  }
  for (const url of [`${cas}/cas/login`, `${service}/portal/login`, `${service}/sakai-login-tool/container`]) {
    assert.throws(() => serviceUrl(url, 'GET', true), (error) => error.code === 'AUTH_REQUIRED' && error.status === 401);
  }
  for (const url of ['https://evil.example/document.pdf', `${service}/direct/site.json`]) {
    assert.throws(() => serviceUrl(url, 'GET', true), DesktopFailure);
  }
});

test('validates redirects before replaying a body or allowing a caller to follow manually', () => {
  const current = `${cas}/cas/login`;
  assert.deepEqual(redirectTarget(current, `${service}/sakai-login-tool/container?ticket=test`, 302, 'POST', 'secret'), {
    url: `${service}/sakai-login-tool/container?ticket=test`, method: 'GET', body: undefined,
  });
  assert.equal(redirectTarget(current, '/cas/continue', 307, 'POST', 'secret').body, 'secret');
  for (const status of [307, 308]) {
    assert.throws(() => redirectTarget(current, `${service}/sakai-login-tool/container`, status, 'POST', 'secret'), DesktopFailure);
  }
  for (const location of ['https://evil.example/path', '//evil.example/path', 'https://@cas.upv.es/cas/login', '//@cas.upv.es/cas/login', '/cas/../cas/login', '/cas/%252e%252e/login', 'file:///tmp/file', '/cas/login\n']) {
    assert.throws(() => redirectTarget(current, location, 302, 'GET'), DesktopFailure, location);
  }
});

test('only accepts narrow metadata headers and handles JSESSIONID without forwarding a raw Cookie header', () => {
  const request = requestInput({
    url: `${service}/direct/site.json`, headers: { Accept: 'application/json', Cookie: 'JSESSIONID=opaque-session', 'Cache-Control': 'no-store' },
  });
  assert.equal(request.sessionId, 'opaque-session');
  assert.equal(request.headers.cookie, undefined);
  for (const headers of [
    { Authorization: 'secret' }, { Host: 'evil.example' }, { Origin: 'https://evil.example' },
    { Cookie: 'JSESSIONID=value; CAS=secret' }, { 'X-Sakai-Desktop-Request': 'forged' },
    { Accept: 'application/json\r\nCookie: injected' }, { Depth: 'infinity' },
  ]) assert.throws(() => requestInput({ url: `${service}/direct/site.json`, headers }), DesktopFailure);
  assert.throws(() => requestInput({ url: `${cas}/cas/login`, headers: { Cookie: 'JSESSIONID=value' } }), DesktopFailure);
  assert.throws(() => requestInput({ url: `${service}/direct/session`, method: 'POST', body: 'secret' }), DesktopFailure);
  assert.throws(() => requestInput({ url: `${service}/direct/site.json`, body: 'unexpected' }), DesktopFailure);
  assert.throws(() => requestInput({ url: `${service}/direct/site.json`, redirect: 'unsafe' }), DesktopFailure);
});

test('only accepts the exact application origin and its live main frame for IPC', () => {
  const frame = { url: APP_URL, parent: null };
  const contents = { mainFrame: frame, isDestroyed: () => false, getURL: () => `${APP_URL}course/id` };
  assert.equal(trustedSender({ sender: contents, senderFrame: frame }, contents), true);
  assert.equal(trustedSender({ sender: contents, senderFrame: { url: APP_URL, parent: frame } }, contents), false);
  assert.equal(trustedSender({ sender: {}, senderFrame: frame }, contents), false);
  assert.equal(trustedSender({ sender: contents, senderFrame: undefined }, contents), false);
  assert.equal(trustedSender({ sender: contents, senderFrame: frame }, { ...contents, isDestroyed: () => true }), false);
  for (const url of ['https://app/', 'sakai-app://app.evil/', 'sakai-app://app:444/', 'sakai-app://user@app/', 'sakai-app://@app/', 'file:///index.html', 'about:blank', 'sakai-app://app./']) {
    assert.equal(isAppUrl(url), false, url);
    frame.url = url;
    assert.equal(trustedSender({ sender: contents, senderFrame: frame }, contents), false);
  }
});

test('rejects traversal, reserved Windows names, alternate streams and unsafe resource segments', () => {
  assert.deepEqual(pathSegments(['Course', 'Unit 1', 'notes.pdf']), ['Course', 'Unit 1', 'notes.pdf']);
  for (const segment of ['..', '.', '../file', '/etc', 'C:\\Windows', 'a/b', 'a\\b', '.ssh', 'x:stream', 'NUL', 'CON.txt', 'COM1.pdf', 'LPT9', 'trailing.', 'trailing ', ' leading', 'x\0y', 'a'.repeat(241)]) {
    assert.throws(() => pathSegments(['Course', segment]), DesktopFailure, segment);
  }
  assert.throws(() => pathSegments([]), DesktopFailure);
  assert.throws(() => pathSegments(Array(65).fill('folder')), DesktopFailure);
});

test('constrains native paths on POSIX and Windows without prefix confusion', () => {
  assert.equal(contained('/docs/root', '/docs/root/file.pdf', path.posix), true);
  assert.equal(contained('/docs/root', '/docs/root-other/file.pdf', path.posix), false);
  assert.equal(contained('/docs/root', '/docs/root/../../etc/passwd', path.posix), false);
  assert.equal(contained('C:\\docs', 'C:\\docs\\file.pdf', path.win32), true);
  assert.equal(contained('C:\\docs', 'D:\\docs\\file.pdf', path.win32), false);
  assert.equal(contained('C:\\docs', 'C:\\docs-other\\file.pdf', path.win32), false);
  assert.equal(contained('C:\\docs', '\\\\server\\share\\file.pdf', path.win32), false);
});

test('opaque capabilities have no path, query, fragment or userinfo escape hatch', () => {
  const id = 'a'.repeat(32);
  assert.equal(capabilityId(`sakai-root://${id}`, 'root'), id);
  assert.equal(capabilityId(`sakai-file://${id}`, 'file'), id);
  for (const uri of [`sakai-file://${id}/../secret`, `sakai-file://${id}/`, `sakai-file://${id}?path=secret`, `sakai-file://${id}#secret`, `sakai-file://user@${id}`, `sakai-root://${id}`, 'file:///etc/passwd']) {
    assert.throws(() => capabilityId(uri, 'file'), DesktopFailure);
  }
});

test('CSP hashes the static bootstrap without unsafe-eval, remote scripts or inline event handlers', () => {
  const bootstrap = 'window.__BOOTSTRAP__ = {};';
  const policy = contentSecurityPolicy(`<script>${bootstrap}</script><script src="/_expo/app.js"></script>`);
  const hash = createHash('sha256').update(bootstrap).digest('base64');
  assert.ok(policy.includes(`'sha256-${hash}'`));
  assert.ok(policy.includes("'wasm-unsafe-eval'"));
  assert.ok(!policy.includes("'unsafe-eval'"));
  assert.ok(!policy.split(';').find((part) => part.trim().startsWith('script-src ')).includes("'unsafe-inline'"));
  assert.ok(policy.includes("script-src-attr 'none'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
  assert.ok(policy.includes("form-action 'none'"));
  assert.ok(!policy.includes('https:'));
});

test('errors cross the bridge as fixed messages and optional HTTP status, never raw details', () => {
  const error = new Error('https://cas.upv.es/cas/login?ticket=secret Authorization: secret /private/path');
  assert.deepEqual(publicError(error), { code: 'INTERNAL', message: 'The desktop operation could not be completed.' });
  assert.deepEqual(publicError(new DesktopFailure('AUTH_REQUIRED', 401)), {
    code: 'AUTH_REQUIRED', message: 'The university session has expired. Sign in again.', status: 401,
  });
  assert.equal(publicError(Object.assign(error, { name: 'AbortError' })).code, 'CANCELLED');
});

test('preload exposes fixed methods and uses plain rejections so Electron keeps HTTP status', async () => {
  let api;
  const calls = [];
  const listeners = new Map();
  const source = fs.readFileSync(path.join(__dirname, '../desktop/preload.cjs'), 'utf8');
  vm.runInNewContext(source, {
    process: { isMainFrame: true }, location: { protocol: 'sakai-app:', host: 'app' },
    require(name) {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name, bridge) => { assert.equal(name, 'sakaiDesktop'); api = bridge; } },
         ipcRenderer: {
          on(channel, listener) { listeners.set(channel, listener); },
          removeListener(channel, listener) { if (listeners.get(channel) === listener) listeners.delete(channel); },
           async invoke(...args) {
            calls.push(args);
            return { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Sign in again.', status: 401 } };
          },
        },
      };
    },
  });
  assert.equal(api.apiVersion, 1);
  assert.equal(api.invoke, undefined);
  const progress = [];
  const unsubscribe = api.onDownloadProgress((value) => progress.push(value));
  listeners.get('sakai:download-progress')(null, { id: 'download-1', received: 25, total: 100 });
  listeners.get('sakai:download-progress')(null, { id: 'download-1', received: -1, total: 100 });
  assert.deepEqual(JSON.parse(JSON.stringify(progress)), [{ id: 'download-1', received: 25, total: 100 }]);
  unsubscribe();
  assert.equal(listeners.has('sakai:download-progress'), false);
  await assert.rejects(api.request('request-1', { url: `${service}/direct/site.json` }), (error) => {
    assert.equal(Object.prototype.toString.call(error), '[object Object]');
    assert.equal(error.code, 'AUTH_REQUIRED');
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(calls[0][0], 'sakai:request');
  await assert.rejects(api.openRoot('root'));
  await assert.rejects(api.validateRelocation('root', ['source']));
  await assert.rejects(api.copyLocalFile('copy-1', 'source', 'root', {}, ['notes.pdf']));
  await assert.rejects(api.removeCopiedOriginal('remove-1', 'source', 'destination'));
  await assert.rejects(api.deleteFile('source'));
  assert.deepEqual(JSON.parse(JSON.stringify(calls.slice(1))), [
    ['sakai:open-root', 'root'],
    ['sakai:validate-relocation', 'root', ['source']],
    ['sakai:copy-local-file', { id: 'copy-1', source: 'source', rootUri: 'root', resource: {}, segments: ['notes.pdf'] }],
    ['sakai:remove-copied-original', 'remove-1', 'source', 'destination'],
    ['sakai:delete-file', 'source'],
  ]);
});
