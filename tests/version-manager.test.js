import { describe, expect, test } from 'bun:test';

import {
  compareVersions,
  fetchLatestRelease,
  normalizeVersion,
  parseLatestReleaseResponse,
} from '../src/lib/version-manager.ts';
import { requireVersion } from '../app.config.ts';

const release = {
  tag_name: 'v1.2.3',
  html_url: 'https://github.com/teo2peer/SakaiClient/releases/tag/v1.2.3',
  name: 'Sakai Client 1.2.3',
  published_at: '2026-09-09T10:00:00Z',
  draft: false,
  prerelease: false,
};

describe('version comparison', () => {
  test('normalizes release tags and compares stable versions', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
    expect(compareVersions('1.9.9', '1.10.0')).toBe(-1);
  });

  test('implements SemVer prerelease precedence', () => {
    expect(compareVersions('1.2.3', '1.2.3-rc.1')).toBe(1);
    expect(compareVersions('1.2.3-beta.11', '1.2.3-beta.2')).toBe(1);
    expect(compareVersions('1.2.3-beta', '1.2.3-1')).toBe(1);
    expect(compareVersions('1.2.3-beta.1', '1.2.3-beta')).toBe(1);
  });

  test('rejects malformed or ambiguous versions', () => {
    expect(() => normalizeVersion('1.02.3')).toThrow();
    expect(() => normalizeVersion('1.2.3-01')).toThrow();
    expect(() => normalizeVersion('65536.0.0')).toThrow();
    expect(() => normalizeVersion('release-1.2.3')).toThrow();
    expect(() => requireVersion('BUILD_VERSION', '1.2.3-rc..1')).toThrow();
    expect(() => requireVersion('RELEASE_VERSION', '1.2.3-01')).toThrow();
  });
});

describe('GitHub release validation', () => {
  test('accepts the expected stable project release', () => {
    expect(parseLatestReleaseResponse(release)).toEqual({
      version: '1.2.3',
      tagName: 'v1.2.3',
      title: 'Sakai Client 1.2.3',
      url: release.html_url,
      publishedAt: release.published_at,
    });
  });

  test('rejects prereleases, drafts and unrelated download URLs', () => {
    expect(() => parseLatestReleaseResponse({ ...release, prerelease: true })).toThrow();
    expect(() => parseLatestReleaseResponse({ ...release, draft: true })).toThrow();
    expect(() => parseLatestReleaseResponse({ ...release, tag_name: '1.2.3' })).toThrow();
    expect(() => parseLatestReleaseResponse({
      ...release,
      html_url: 'https://example.com/teo2peer/SakaiClient/releases/tag/v1.2.3',
    })).toThrow();
  });

  test('blocks redirects and oversized native or web responses', async () => {
    let request;
    const result = await fetchLatestRelease(async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify(release), { status: 200 });
    });
    expect(result.version).toBe('1.2.3');
    expect(request.url).toBe('https://api.github.com/repos/teo2peer/SakaiClient/releases/latest');
    expect(request.options.redirect).toBe('error');
    await expect(fetchLatestRelease(async () => new Response('x'.repeat(300 * 1024), { status: 200 }))).rejects.toThrow();
  });
});
