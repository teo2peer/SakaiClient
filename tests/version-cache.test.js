import { beforeEach, expect, mock, test } from 'bun:test';

const stored = new Map();
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key) => stored.get(key) ?? null,
  setItem: async (key, value) => { stored.set(key, value); },
  removeItem: async (key) => { stored.delete(key); },
} }));

const { loadVersionCheckCache, saveVersionCheckCache } = await import('../src/lib/version-cache.ts');

const cache = {
  checkedAt: '2026-09-09T10:00:00.000Z',
  succeeded: true,
  release: {
    version: '1.2.3',
    tagName: 'v1.2.3',
    title: 'Sakai Client 1.2.3',
    url: 'https://github.com/teo2peer/SakaiClient/releases/tag/v1.2.3',
    publishedAt: '2026-09-09T09:00:00Z',
  },
};

beforeEach(() => stored.clear());

test('persists only validated public release metadata', async () => {
  await saveVersionCheckCache(cache);
  expect(await loadVersionCheckCache()).toEqual(cache);
});

test('supports caching a failed attempt without release metadata', async () => {
  await saveVersionCheckCache({ checkedAt: cache.checkedAt, succeeded: false });
  expect(await loadVersionCheckCache()).toEqual({ checkedAt: cache.checkedAt, succeeded: false });
});

test('drops cache entries without a recorded outcome', async () => {
  stored.set('sakai-client:version-check:v1', JSON.stringify({ checkedAt: cache.checkedAt }));
  expect(await loadVersionCheckCache()).toBeUndefined();
  expect(stored.size).toBe(0);
});

test('drops malformed or redirected cached release data', async () => {
  stored.set('sakai-client:version-check:v1', JSON.stringify({
    ...cache,
    release: { ...cache.release, url: 'https://example.com/releases/tag/v1.2.3' },
  }));
  expect(await loadVersionCheckCache()).toBeUndefined();
  expect(stored.size).toBe(0);
});
