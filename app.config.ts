import type { ConfigContext, ExpoConfig } from 'expo/config';

const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function requireVersion(name: string, value: string): string {
  const match = value.length <= 128 ? value.match(VERSION_PATTERN) : null;
  if (!match || match.slice(1, 4).some((part) => Number(part) > 65535) ||
      match[4]?.split('.').some((part) => /^[0-9]+$/.test(part) && part.length > 1 && part.startsWith('0'))) {
    throw new Error(`${name} must be a semantic version.`);
  }
  return value;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const version = requireVersion('BUILD_VERSION', process.env.BUILD_VERSION ?? config.version ?? '1.0.0');
  const releaseVersion = requireVersion('RELEASE_VERSION', process.env.RELEASE_VERSION ?? version);
  const publicReleaseVersion = requireVersion(
    'EXPO_PUBLIC_RELEASE_VERSION',
    process.env.EXPO_PUBLIC_RELEASE_VERSION ?? releaseVersion,
  );
  if (publicReleaseVersion !== releaseVersion) {
    throw new Error('EXPO_PUBLIC_RELEASE_VERSION must match RELEASE_VERSION.');
  }
  const build = Number(process.env.BUILD_NUMBER ?? config.android?.versionCode ?? 1);
  if (!Number.isSafeInteger(build) || build < 1 || build > 2_100_000_000) throw new Error('BUILD_NUMBER is outside the supported range.');
  const bundleIdentifier = process.env.IOS_BUNDLE_IDENTIFIER ?? config.ios?.bundleIdentifier;
  if (bundleIdentifier && (bundleIdentifier.trim() !== bundleIdentifier || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier))) throw new Error('Invalid iOS bundle identifier.');
  return {
    ...config,
    name: config.name ?? 'SakaiClient',
    slug: config.slug ?? 'SakaiClient',
    version: version.split('-')[0],
    extra: { ...config.extra, releaseVersion },
    ios: { ...config.ios, bundleIdentifier, buildNumber: String(build) },
    android: { ...config.android, versionCode: build },
  };
};
