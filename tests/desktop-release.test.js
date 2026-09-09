const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RELEASE_API_URL,
  fetchLatestRelease,
  sanitizeLatestRelease,
} = require('../desktop/release.cjs');

const release = {
  tag_name: 'v1.2.3',
  html_url: 'https://github.com/teo2peer/SakaiClient/releases/tag/v1.2.3',
  name: 'Sakai Client 1.2.3',
  published_at: '2026-09-09T10:00:00Z',
  draft: false,
  prerelease: false,
};

describe('desktop release boundary', () => {
  test('returns only the validated fields needed by the renderer', () => {
    assert.deepEqual(sanitizeLatestRelease({ ...release, body: 'untrusted release notes', assets: [{ token: 'no' }] }), release);
  });

  test('rejects non-project URLs and non-stable releases', () => {
    assert.throws(() => sanitizeLatestRelease({ ...release, prerelease: true }));
    assert.throws(() => sanitizeLatestRelease({ ...release, html_url: `${release.html_url}?download=1` }));
    assert.throws(() => sanitizeLatestRelease({ ...release, html_url: 'https://github.com/other/project/releases/tag/v1.2.3' }));
  });

  test('fetches only the fixed public API endpoint', async () => {
    let request;
    const result = await fetchLatestRelease(async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify(release), { status: 200 });
    });
    assert.deepEqual(result, release);
    assert.equal(request.url, RELEASE_API_URL);
    assert.equal(request.options.method, 'GET');
    assert.equal(request.options.redirect, 'error');
    assert.ok(request.options.signal instanceof AbortSignal);
  });

  test('rejects oversized and unsuccessful responses', async () => {
    await assert.rejects(
      fetchLatestRelease(async () => new Response('x'.repeat(300 * 1024), { status: 200 })),
      (error) => error.code === 'RELEASE_UNAVAILABLE',
    );
    await assert.rejects(
      fetchLatestRelease(async () => new Response('', { status: 403 })),
      (error) => error.code === 'RELEASE_UNAVAILABLE' && error.status === 403,
    );
  });
});
