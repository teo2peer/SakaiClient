const path = require('node:path');
const { createHash } = require('node:crypto');

const APP_URL = 'sakai-app://app/';
const SERVICE_ORIGIN = 'https://poliformat.upv.es';
const CAS_ORIGIN = 'https://cas.upv.es';
const TEXT_LIMIT = 8 * 1024 * 1024;
const FILE_LIMIT = 32 * 1024 * 1024;
const DOWNLOAD_LIMIT = 8 * 1024 * 1024 * 1024;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MESSAGES = {
  INVALID_INPUT: 'Invalid desktop request.',
  FORBIDDEN: 'This operation is not permitted.',
  NOT_FOUND: 'The selected file or folder is no longer available.',
  CANCELLED: 'The operation was cancelled.',
  BUSY: 'Another operation is already in progress.',
  LIMIT_EXCEEDED: 'The operation exceeds the desktop size limit.',
  NETWORK: 'The university server could not be reached.',
  HTTP: 'The university server rejected the request.',
  AUTH_REQUIRED: 'The university session has expired. Sign in again.',
  REDIRECT: 'An unsafe or excessive redirect was blocked.',
  INVALID_DOCUMENT: 'The server did not return the expected document.',
  STORAGE: 'Local storage is unavailable or could not be updated safely.',
  SECURE_STORAGE_UNAVAILABLE: 'An operating-system secret store is required to remember secrets.',
  UNSUPPORTED: 'This operation is not supported on this system.',
  INTERNAL: 'The desktop operation could not be completed.',
};

class DesktopFailure extends Error {
  constructor(code, status) {
    super(MESSAGES[code] || MESSAGES.INTERNAL);
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'INTERNAL';
    if (Number.isInteger(status) && status >= 100 && status <= 599) this.status = status;
  }
}

function publicError(error) {
  if (error instanceof DesktopFailure) {
    return { code: error.code, message: error.message, ...(error.status ? { status: error.status } : {}) };
  }
  const code = error?.name === 'AbortError' ? 'CANCELLED'
    : error?.code === 'ENOENT' ? 'NOT_FOUND'
      : ['EACCES', 'EPERM', 'ENOSPC', 'EIO', 'ELOOP'].includes(error?.code) ? 'STORAGE' : 'INTERNAL';
  return { code, message: MESSAGES[code] };
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DesktopFailure('INVALID_INPUT');
  return value;
}

function text(value, limit, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.length) || Buffer.byteLength(value) > limit) {
    throw new DesktopFailure('INVALID_INPUT');
  }
  return value;
}

function requestId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_:-]{1,128}$/.test(value)) throw new DesktopFailure('INVALID_INPUT');
  return value;
}

function parseUrl(value) {
  text(value, 16384);
  if (/[\s\\\u0000-\u001f\u007f]/u.test(value)) throw new DesktopFailure('FORBIDDEN');
  const authority = value.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  if (!authority || authority.includes('@')) throw new DesktopFailure('FORBIDDEN');
  try { return new URL(value); } catch { throw new DesktopFailure('INVALID_INPUT'); }
}

function isAppUrl(value) {
  try {
    const url = parseUrl(value);
    return url.protocol === 'sakai-app:' && url.host === 'app' && !url.username && !url.password;
  } catch { return false; }
}

function trustedSender(event, contents) {
  try {
    return Boolean(contents && !contents.isDestroyed() && event.sender === contents && event.senderFrame &&
      event.senderFrame === contents.mainFrame && event.senderFrame.parent === null &&
      isAppUrl(event.senderFrame.url) && isAppUrl(contents.getURL()));
  } catch { return false; }
}

function decodedPath(value) {
  // Inspect the unnormalized path: WHATWG URL parsing removes literal and encoded dot segments.
  const raw = value.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]+([^?#]*)/i)?.[1] || '/';
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { throw new DesktopFailure('INVALID_INPUT'); }
  if (/%(?:2e|2f|5c|00|25)/i.test(decoded) || /%2f|%5c/i.test(raw) || /[\\\u0000-\u001f\u007f]/u.test(decoded)) {
    throw new DesktopFailure('FORBIDDEN');
  }
  if (decoded.split('/').some((part) => ['.', '..'].includes(part.split(';')[0]))) throw new DesktopFailure('FORBIDDEN');
  return decoded;
}

function serviceUrl(value, method = 'GET', download = false) {
  const url = parseUrl(value);
  if (url.protocol !== 'https:' || ![SERVICE_ORIGIN, CAS_ORIGIN].includes(url.origin) || url.hash) {
    throw new DesktopFailure('FORBIDDEN');
  }
  const pathname = decodedPath(value).replace(/;jsessionid=[a-zA-Z0-9._-]+(?=\/|$)/g, '');
  const resource = /^\/(?:access\/content|content|dav)\/(?:group|user|attachment|public)\/.+/.test(pathname);
  const auth = url.origin === CAS_ORIGIN || /^\/(?:portal|sakai-login-tool)(?:\/|$)/.test(pathname);
  if (download) {
    if (auth) throw new DesktopFailure('AUTH_REQUIRED', 401);
    if (url.origin !== SERVICE_ORIGIN || method !== 'GET' || !resource) throw new DesktopFailure('FORBIDDEN');
    return url;
  }
  const read = method === 'GET' || method === 'HEAD';
  let allowed = false;
  if (url.origin === CAS_ORIGIN) {
    allowed = /^\/cas\/(?:login|logout|continue)\/?$/.test(pathname) &&
      (read || (method === 'POST' && !pathname.startsWith('/cas/logout')));
    for (const destination of url.searchParams.getAll('service')) {
      const service = parseUrl(destination);
      if (service.origin !== SERVICE_ORIGIN || service.protocol !== 'https:' || service.hash ||
          !/^\/(?:sakai-login-tool\/container|portal(?:\/login)?)\/?$/.test(decodedPath(destination))) {
        throw new DesktopFailure('FORBIDDEN');
      }
    }
  } else {
    allowed = (read && (
      /^\/direct\/session(?:\/[a-zA-Z0-9._-]+)?\/?$/.test(pathname) ||
      /^\/direct\/(?:site|announcement)(?:\.json|\/[^;]+\.json)$/.test(pathname) ||
      /^\/direct\/content\/resources\/(?:group|user)\/[^;]+\.json$/.test(pathname) ||
      /^\/portal(?:\/(?:login|logout)|\/site\/[^;]+)?\/?$/.test(pathname) ||
      /^\/sakai-login-tool\/container\/?$/.test(pathname) || resource
    )) || (method === 'POST' && /^\/(?:direct\/session|portal\/login|sakai-login-tool\/container)\/?$/.test(pathname)) ||
      (method === 'DELETE' && /^\/direct\/session\/[a-zA-Z0-9._-]+$/.test(pathname)) ||
      (method === 'PROPFIND' && /^\/dav\/(?:group|user)\/.+/.test(pathname));
  }
  if (!allowed) throw new DesktopFailure('FORBIDDEN');
  return url;
}

function requestInput(value) {
  const input = record(value);
  const method = input.method === undefined ? 'GET' : text(input.method, 16).toUpperCase();
  const url = serviceUrl(input.url, method);
  const redirect = input.redirect === undefined ? 'follow' : input.redirect;
  if (!['manual', 'follow', 'error'].includes(redirect)) throw new DesktopFailure('INVALID_INPUT');
  const headers = {};
  let sessionId;
  if (input.headers !== undefined) {
    const entries = Object.entries(record(input.headers));
    if (entries.length > 16) throw new DesktopFailure('INVALID_INPUT');
    for (const [name, value] of entries) {
      const key = name.toLowerCase();
      text(value, 8192);
      if (/[\r\n\u0000]/u.test(value) || Object.hasOwn(headers, key)) throw new DesktopFailure('INVALID_INPUT');
      if (key === 'cookie') {
        const match = /^JSESSIONID=([a-zA-Z0-9._-]{1,512})$/.exec(value);
        if (!match || sessionId || url.origin !== SERVICE_ORIGIN) throw new DesktopFailure('FORBIDDEN');
        sessionId = match[1];
        continue;
      }
      if (!['accept', 'content-type', 'cache-control', 'pragma', 'depth'].includes(key)) throw new DesktopFailure('FORBIDDEN');
      if (key === 'depth' && (method !== 'PROPFIND' || !['0', '1', 'infinity'].includes(value))) throw new DesktopFailure('FORBIDDEN');
      headers[key] = value;
    }
  }
  const body = input.body === undefined ? undefined : text(input.body, 1024 * 1024, true);
  if (body !== undefined && !['POST', 'PROPFIND'].includes(method)) throw new DesktopFailure('FORBIDDEN');
  if (method === 'POST' && !/^application\/x-www-form-urlencoded(?:\s*;.*)?$/i.test(headers['content-type'] || '')) {
    throw new DesktopFailure('FORBIDDEN');
  }
  if (method === 'PROPFIND' && !/^(?:application|text)\/xml(?:\s*;.*)?$/i.test(headers['content-type'] || '')) {
    throw new DesktopFailure('FORBIDDEN');
  }
  return { url: url.href, method, headers, body, redirect, sessionId };
}

function redirectTarget(current, location, status, method, body, download = false) {
  text(location, 16384);
  if (/[\\\u0000-\u0020\u007f]/u.test(location)) throw new DesktopFailure('REDIRECT');
  const nextMethod = status === 303 && method !== 'HEAD' || [301, 302].includes(status) && method === 'POST' ? 'GET' : method;
  const nextBody = nextMethod === 'GET' || nextMethod === 'HEAD' ? undefined : body;
  let target;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(location)) { parseUrl(location); decodedPath(location); }
    else if (location.startsWith('//')) { parseUrl(`https:${location}`); decodedPath(`https:${location}`); }
    else decodedPath(`${new URL(current).origin}/${location.replace(/^\/+/, '')}`);
    target = new URL(location, current);
  } catch { throw new DesktopFailure('REDIRECT'); }
  if (nextBody !== undefined && target.origin !== new URL(current).origin) throw new DesktopFailure('REDIRECT');
  serviceUrl(target.href, nextMethod, download);
  return { url: target.href, method: nextMethod, body: nextBody };
}

function pathSegments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64) throw new DesktopFailure('INVALID_INPUT');
  for (const segment of value) {
    text(segment, 240);
    if (/^[. ]|[. ]$|[<>:"/\\|?*\u0000-\u001f\u007f]/u.test(segment) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)) throw new DesktopFailure('FORBIDDEN');
  }
  if (Buffer.byteLength(value.join('/')) > 4096) throw new DesktopFailure('LIMIT_EXCEEDED');
  return [...value];
}

function contained(root, target, pathApi = path) {
  const relative = pathApi.relative(root, target);
  return relative === '' || (!pathApi.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${pathApi.sep}`));
}

function capabilityId(uri, kind) {
  if (!['root', 'file'].includes(kind) || typeof uri !== 'string') throw new DesktopFailure('FORBIDDEN');
  const match = new RegExp(`^sakai-${kind}://([a-f0-9]{32})$`).exec(uri);
  if (!match) throw new DesktopFailure('FORBIDDEN');
  return match[1];
}

function contentSecurityPolicy(html = '') {
  const hashes = new Set();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1]) && match[2]) {
      hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
    }
  }
  return [
    "default-src 'none'", `script-src 'self' 'wasm-unsafe-eval' ${[...hashes].join(' ')}`,
    "script-src-attr 'none'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "font-src 'self' data: blob:", "connect-src 'self' blob:", "worker-src 'self' blob:",
    "media-src 'self' blob:", "frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'",
    "base-uri 'none'", "form-action 'none'",
  ].join('; ');
}

module.exports = {
  APP_URL, SERVICE_ORIGIN, CAS_ORIGIN, TEXT_LIMIT, FILE_LIMIT, DOWNLOAD_LIMIT, REDIRECT_CODES,
  DesktopFailure, publicError, record, text, requestId, parseUrl, isAppUrl, trustedSender,
  decodedPath, serviceUrl, requestInput, redirectTarget, pathSegments, contained, capabilityId, contentSecurityPolicy,
};
