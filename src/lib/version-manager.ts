import { getDesktopApi } from '@/lib/desktop';

const RELEASE_API_URL = 'https://api.github.com/repos/teo2peer/SakaiClient/releases/latest';
const RELEASE_PATH_PREFIX = '/teo2peer/SakaiClient/releases/tag/';
const MAX_RELEASE_CHARACTERS = 256 * 1024;
const VERSION_PATTERN = /^(?:v)?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type ParsedVersion = {
  value: string;
  core: [number, number, number];
  prerelease: string[];
};

export type ReleaseInfo = {
  version: string;
  tagName: string;
  title: string;
  url: string;
  publishedAt: string;
};

function parseVersion(value: string): ParsedVersion {
  const match = typeof value === 'string' && value.length <= 128 ? value.match(VERSION_PATTERN) : null;
  const core = match?.slice(1, 4).map(Number);
  const prerelease = match?.[4]?.split('.') ?? [];
  if (!match || !core || core.some((part) => !Number.isSafeInteger(part) || part > 65535) ||
      prerelease.some((part) => /^[0-9]+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error('Invalid application version.');
  }
  return {
    value: `${core.join('.')}${prerelease.length ? `-${prerelease.join('.')}` : ''}`,
    core: core as [number, number, number],
    prerelease,
  };
}

export function normalizeVersion(value: string): string {
  return parseVersion(value).value;
}

export function compareVersions(first: string, second: string): number {
  const a = parseVersion(first);
  const b = parseVersion(second);
  for (let index = 0; index < a.core.length; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] > b.core[index] ? 1 : -1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const left = a.prerelease[index];
    const right = b.prerelease[index];
    if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? -1 : 1;
    if (left === right) continue;
    const leftNumeric = /^[0-9]+$/.test(left);
    const rightNumeric = /^[0-9]+$/.test(right);
    if (leftNumeric && rightNumeric) {
      if (left.length !== right.length) return left.length > right.length ? 1 : -1;
      return left > right ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left > right ? 1 : -1;
  }
  return 0;
}

export function parseLatestReleaseResponse(value: unknown): ReleaseInfo {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid release response.');
  const release = value as Record<string, unknown>;
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== 'string' ||
      !release.tag_name.startsWith('v') ||
      typeof release.html_url !== 'string' || typeof release.published_at !== 'string') {
    throw new Error('Invalid release response.');
  }
  const version = normalizeVersion(release.tag_name);
  const url = new URL(release.html_url);
  if (url.protocol !== 'https:' || url.origin !== 'https://github.com' || url.username || url.password ||
      url.search || url.hash || url.pathname !== `${RELEASE_PATH_PREFIX}${release.tag_name}` ||
      Number.isNaN(Date.parse(release.published_at))) {
    throw new Error('Invalid release response.');
  }
  const title = typeof release.name === 'string' && release.name.trim() && release.name.length <= 256
    ? release.name.trim()
    : release.tag_name;
  return { version, tagName: release.tag_name, title, url: url.href, publishedAt: release.published_at };
}

export async function fetchLatestRelease(fetchImplementation: typeof fetch = fetch): Promise<ReleaseInfo> {
  const desktop = getDesktopApi();
  if (desktop) return parseLatestReleaseResponse(await desktop.getLatestRelease());

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImplementation(RELEASE_API_URL, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json' },
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status !== 200) throw new Error('The latest release could not be checked.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RELEASE_CHARACTERS) {
      throw new Error('The latest release response is too large.');
    }
    const body = await readBoundedResponse(response);
    return parseLatestReleaseResponse(JSON.parse(body));
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (reader && typeof TextDecoder !== 'undefined') {
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_RELEASE_CHARACTERS) {
          throw new Error('The latest release response is too large.');
        }
        body += decoder.decode(value, { stream: true });
      }
      return body + decoder.decode();
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      throw error;
    }
  }

  const body = await response.text();
  if (body.length > MAX_RELEASE_CHARACTERS) throw new Error('The latest release response is too large.');
  return body;
}
