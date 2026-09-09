const { DesktopFailure } = require('./policy.cjs');

const RELEASE_API_URL = 'https://api.github.com/repos/teo2peer/SakaiClient/releases/latest';
const RELEASE_PATH_PREFIX = '/teo2peer/SakaiClient/releases/tag/';
const MAX_RELEASE_BYTES = 256 * 1024;
const VERSION_PATTERN = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function sanitizeLatestRelease(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.draft !== false || value.prerelease !== false) {
    throw new DesktopFailure('RELEASE_UNAVAILABLE');
  }
  const tagName = value.tag_name;
  const match = typeof tagName === 'string' && tagName.length <= 128 ? tagName.match(VERSION_PATTERN) : null;
  if (!match || match.slice(1, 4).some((part) => Number(part) > 65535) ||
      match[4]?.split('.').some((part) => /^[0-9]+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new DesktopFailure('RELEASE_UNAVAILABLE');
  }
  if (typeof value.html_url !== 'string' || value.html_url.length > 512 ||
      typeof value.published_at !== 'string' || value.published_at.length > 64 || Number.isNaN(Date.parse(value.published_at))) {
    throw new DesktopFailure('RELEASE_UNAVAILABLE');
  }
  let url;
  try { url = new URL(value.html_url); } catch { throw new DesktopFailure('RELEASE_UNAVAILABLE'); }
  if (url.protocol !== 'https:' || url.origin !== 'https://github.com' || url.username || url.password ||
      url.search || url.hash || url.pathname !== `${RELEASE_PATH_PREFIX}${tagName}`) {
    throw new DesktopFailure('RELEASE_UNAVAILABLE');
  }
  const name = typeof value.name === 'string' && value.name.trim() && Buffer.byteLength(value.name) <= 512
    ? value.name.trim()
    : tagName;
  return {
    tag_name: tagName,
    html_url: url.href,
    name,
    published_at: value.published_at,
    draft: false,
    prerelease: false,
  };
}

async function fetchLatestRelease(fetchImplementation = globalThis.fetch) {
  if (typeof fetchImplementation !== 'function') throw new DesktopFailure('RELEASE_UNAVAILABLE');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImplementation(RELEASE_API_URL, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'SakaiClient' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (!response || response.status !== 200 || !response.body || typeof response.body.getReader !== 'function') {
      throw new DesktopFailure('RELEASE_UNAVAILABLE', response?.status);
    }
    const declaredLength = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RELEASE_BYTES) {
      throw new DesktopFailure('RELEASE_UNAVAILABLE');
    }
    const chunks = [];
    let length = 0;
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array)) throw new DesktopFailure('RELEASE_UNAVAILABLE');
        length += value.byteLength;
        if (length > MAX_RELEASE_BYTES) throw new DesktopFailure('RELEASE_UNAVAILABLE');
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    return sanitizeLatestRelease(JSON.parse(Buffer.concat(chunks, length).toString('utf8')));
  } catch (cause) {
    if (cause instanceof DesktopFailure) throw cause;
    throw new DesktopFailure('RELEASE_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { RELEASE_API_URL, sanitizeLatestRelease, fetchLatestRelease };
