import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  const version = process.env.BUILD_VERSION ?? config.version ?? '1.0.0';
  if (version.trim() !== version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('BUILD_VERSION must be a semantic version.');
  const build = Number(process.env.BUILD_NUMBER ?? config.android?.versionCode ?? 1);
  if (!Number.isSafeInteger(build) || build < 1 || build > 2_100_000_000) throw new Error('BUILD_NUMBER is outside the supported range.');
  const bundleIdentifier = process.env.IOS_BUNDLE_IDENTIFIER ?? config.ios?.bundleIdentifier;
  if (bundleIdentifier && (bundleIdentifier.trim() !== bundleIdentifier || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleIdentifier))) throw new Error('Invalid iOS bundle identifier.');
  return {
    ...config,
    name: config.name ?? 'SakaiClient',
    slug: config.slug ?? 'SakaiClient',
    version: version.split('-')[0],
    ios: { ...config.ios, bundleIdentifier, buildNumber: String(build) },
    android: { ...config.android, versionCode: build },
  };
};
