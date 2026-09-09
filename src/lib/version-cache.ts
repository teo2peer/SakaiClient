import AsyncStorage from '@react-native-async-storage/async-storage';

import { parseLatestReleaseResponse, type ReleaseInfo } from '@/lib/version-manager';

const VERSION_CACHE_KEY = 'sakai-client:version-check:v1';

export type VersionCheckCache = {
  checkedAt: string;
  succeeded: boolean;
  release?: ReleaseInfo;
};

export async function loadVersionCheckCache(): Promise<VersionCheckCache | undefined> {
  const raw = await AsyncStorage.getItem(VERSION_CACHE_KEY);
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (!value || typeof value.checkedAt !== 'string' || typeof value.succeeded !== 'boolean' ||
        Number.isNaN(Date.parse(value.checkedAt))) {
      throw new Error('Invalid version cache.');
    }
    if (value.release === undefined) return { checkedAt: value.checkedAt, succeeded: value.succeeded };
    if (!value.release || typeof value.release !== 'object' || Array.isArray(value.release)) {
      throw new Error('Invalid version cache.');
    }
    const stored = value.release as Record<string, unknown>;
    const release = parseLatestReleaseResponse({
      tag_name: stored.tagName,
      html_url: stored.url,
      name: stored.title,
      published_at: stored.publishedAt,
      draft: false,
      prerelease: false,
    });
    if (stored.version !== release.version) throw new Error('Invalid version cache.');
    return { checkedAt: value.checkedAt, succeeded: value.succeeded, release };
  } catch {
    await AsyncStorage.removeItem(VERSION_CACHE_KEY).catch(() => undefined);
    return undefined;
  }
}

export async function saveVersionCheckCache(value: VersionCheckCache): Promise<void> {
  await AsyncStorage.setItem(VERSION_CACHE_KEY, JSON.stringify(value));
}
