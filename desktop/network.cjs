const { randomBytes } = require('node:crypto');
const {
  DesktopFailure, TEXT_LIMIT, REDIRECT_CODES, SERVICE_ORIGIN,
  requestInput, requestId, serviceUrl, redirectTarget,
} = require('./policy.cjs');

const CORRELATION_HEADER = 'X-Sakai-Desktop-Request';

function responseHeaders(input) {
  const headers = new Headers();
  for (const [name, values] of Object.entries(input)) {
    if (['set-cookie', 'set-cookie2'].includes(name.toLowerCase())) continue;
    for (const value of Array.isArray(values) ? values : [values]) headers.append(name, value);
  }
  return headers;
}

function sanitizeResponseHeaders(input) {
  const headers = {};
  let invalidLocation = false;
  for (const [name, values] of Object.entries(input)) {
    const safeValues = [];
    for (const value of Array.isArray(values) ? values : [values]) {
      try {
        if (typeof value !== 'string' || /[^\u0000-\u00ff]/u.test(value)) throw new TypeError('Invalid ByteString');
        new Headers([[name, value]]);
        safeValues.push(value);
      } catch {
        if (name.toLowerCase() === 'location') invalidLocation = true;
      }
    }
    if (safeValues.length) headers[name] = safeValues;
  }
  return { headers, invalidLocation };
}

class DesktopNetwork {
  constructor(session) {
    this.session = session;
    this.operations = new Map();
    this.pending = new Map();
    this.requests = new Map();

    session.webRequest.onBeforeRequest((details, callback) => {
      try {
        serviceUrl(details.url, details.method);
        callback({ cancel: false });
      } catch { callback({ cancel: true }); }
    });
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      const key = Object.keys(headers).find((name) => name.toLowerCase() === CORRELATION_HEADER.toLowerCase());
      const token = key && headers[key];
      const pending = this.pending.get(token);
      if (!pending || pending.url !== details.url || pending.method !== details.method) {
        callback({ cancel: true });
        return;
      }
      delete headers[key];
      this.requests.set(details.id, pending);
      callback({ requestHeaders: headers });
    });
    session.webRequest.onHeadersReceived((details, callback) => {
      const pending = this.requests.get(details.id);
      if (!pending) { callback({ cancel: true }); return; }
      try {
        // Electron copies these values into Undici Headers after this hook. Some Sakai downloads
        // include a malformed filename header, so remove values that are not valid ByteStrings.
        const sanitized = sanitizeResponseHeaders(details.responseHeaders || {});
        if (REDIRECT_CODES.has(details.statusCode)) {
          // session.fetch currently rejects manual redirects. Capture metadata before it cancels,
          // letting Chromium process Set-Cookie without ever following the redirect itself.
          if (sanitized.invalidLocation) pending.failure = new DesktopFailure('REDIRECT');
          else pending.redirect = {
            status: details.statusCode,
            headers: responseHeaders(sanitized.headers),
          };
        }
        callback({ cancel: false, responseHeaders: sanitized.headers });
      } catch {
        pending.failure = new DesktopFailure('NETWORK');
        callback({ cancel: true });
      }
    });
    const completed = (details) => this.requests.delete(details.id);
    session.webRequest.onCompleted(completed);
    session.webRequest.onErrorOccurred(completed);
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', (event) => event.preventDefault());
  }

  run(id, task, download = false) {
    requestId(id);
    if (this.operations.has(id) || this.operations.size >= 24 ||
        download && [...this.operations.values()].filter((item) => item.download).length >= 4) {
      throw new DesktopFailure('BUSY');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new DesktopFailure('NETWORK')), download ? 30 * 60_000 : 60_000);
    const operation = { controller, download };
    this.operations.set(id, operation);
    operation.promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return task(controller.signal);
    }).finally(() => {
      clearTimeout(timeout);
      controller.abort();
      this.operations.delete(id);
    });
    return operation.promise;
  }

  async cancel(id) {
    requestId(id);
    const operation = this.operations.get(id);
    if (!operation) return;
    operation.controller.abort(new DesktopFailure('CANCELLED'));
    await operation.promise.catch(() => undefined);
  }

  async cancelAll() {
    await Promise.all([...this.operations.keys()].map((id) => this.cancel(id)));
  }

  async fetchOne(url, init, signal) {
    signal.throwIfAborted();
    const token = randomBytes(24).toString('hex');
    const pending = { url, method: init.method };
    this.pending.set(token, pending);
    try {
      try {
        const response = await this.session.fetch(url, {
          ...init,
          headers: { ...init.headers, [CORRELATION_HEADER]: token },
          credentials: 'include',
          redirect: 'manual',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal,
        });
        signal.throwIfAborted();
        return response;
      } catch {
        signal.throwIfAborted();
        if (pending.failure) throw pending.failure;
        if (pending.redirect) return new Response(null, pending.redirect);
        throw new DesktopFailure('NETWORK');
      }
    } finally {
      this.pending.delete(token);
      for (const [id, value] of this.requests) if (value === pending) this.requests.delete(id);
    }
  }

  async follow(input, signal, download = false) {
    let { url, method, body } = input;
    let headers = { ...input.headers };
    for (let hop = 0; hop <= 12; hop += 1) {
      url = serviceUrl(url, method, download).href;
      const response = await this.fetchOne(url, { method, headers, body }, signal);
      if (!REDIRECT_CODES.has(response.status)) return { response, url };
      try {
        if (input.redirect === 'error' || hop === 12) throw new DesktopFailure('REDIRECT');
        const next = redirectTarget(url, response.headers.get('location'), response.status, method, body, download);
        if (input.redirect === 'manual') return { response, url };
        if (next.body === undefined) {
          delete headers['content-type'];
          delete headers.depth;
        }
        if (new URL(next.url).origin !== new URL(url).origin) headers = { accept: headers.accept || '*/*' };
        ({ url, method, body } = next);
      } catch (error) {
        await response.body?.cancel().catch(() => undefined);
        throw error;
      }
      await response.body?.cancel().catch(() => undefined);
    }
    throw new DesktopFailure('REDIRECT');
  }

  request(id, value) {
    const input = requestInput(value);
    return this.run(id, async (signal) => {
      if (input.sessionId) {
        await this.session.cookies.set({
          url: SERVICE_ORIGIN, name: 'JSESSIONID', value: input.sessionId,
          path: '/', secure: true, httpOnly: true, sameSite: 'lax',
        });
      }
      signal.throwIfAborted();
      const { response, url } = await this.follow(input, signal);
      const chunks = [];
      let length = 0;
      const reader = response.body?.getReader();
      try {
        if (reader) {
          for (;;) {
            signal.throwIfAborted();
            const { done, value: chunk } = await reader.read();
            if (done) break;
            length += chunk.byteLength;
            if (length > TEXT_LIMIT) throw new DesktopFailure('LIMIT_EXCEEDED');
            chunks.push(Buffer.from(chunk));
          }
        }
        signal.throwIfAborted();
        const headers = [...response.headers].filter(([name]) => !['set-cookie', 'set-cookie2'].includes(name.toLowerCase()));
        if (Buffer.byteLength(JSON.stringify(headers)) > 64 * 1024) throw new DesktopFailure('LIMIT_EXCEEDED');
        return {
          status: response.status, statusText: response.statusText, url, headers,
          body: Buffer.concat(chunks, length).toString('utf8'),
        };
      } finally {
        await reader?.cancel().catch(() => undefined);
        reader?.releaseLock();
      }
    });
  }

  async downloadResponse(url, signal) {
    serviceUrl(url, 'GET', true);
    const { response } = await this.follow({ url, method: 'GET', headers: { accept: '*/*' }, redirect: 'follow' }, signal, true);
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new DesktopFailure([401, 403].includes(response.status) ? 'AUTH_REQUIRED' : 'HTTP', response.status);
    }
    if (!response.body) throw new DesktopFailure('INVALID_DOCUMENT');
    return response;
  }

  async clearSession() {
    await this.cancelAll();
    try {
      await this.request(`logout-${randomBytes(16).toString('hex')}`, {
        url: `${SERVICE_ORIGIN}/portal/logout`, method: 'GET', redirect: 'manual',
      });
    } catch { /* Local logout still completes when the institutional server is unavailable. */ }
    await this.session.clearStorageData({ storages: ['cookies'] });
    await this.session.clearAuthCache();
  }
}

module.exports = { DesktopNetwork, sanitizeResponseHeaders };
