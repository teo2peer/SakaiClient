import Constants from 'expo-constants';
import { openBrowserAsync, WebBrowserPresentationStyle } from 'expo-web-browser';
import { createContext, use, useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { isDesktop } from '@/lib/desktop';
import { loadVersionCheckCache, saveVersionCheckCache } from '@/lib/version-cache';
import {
  compareVersions,
  fetchLatestRelease,
  normalizeVersion,
  type ReleaseInfo,
} from '@/lib/version-manager';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_ERROR_MESSAGE = 'No se pudo comprobar la última versión. Revisa la conexión e inténtalo de nuevo.';

type VersionContextValue = {
  currentVersion: string;
  latestRelease?: ReleaseInfo;
  updateAvailable: boolean;
  showUpdateBanner: boolean;
  checking: boolean;
  checkError?: string;
  lastCheckedAt?: string;
  checkForUpdates(): Promise<void>;
  openLatestRelease(): Promise<void>;
  dismissUpdate(): void;
};

const VersionContext = createContext<VersionContextValue | null>(null);

function configuredVersion(): string | undefined {
  const releaseVersion = Constants.expoConfig?.extra?.releaseVersion;
  const values = [
    process.env.EXPO_PUBLIC_RELEASE_VERSION,
    typeof releaseVersion === 'string' ? releaseVersion : undefined,
    Constants.expoConfig?.version,
  ];
  for (const value of values) {
    if (!value) continue;
    try { return normalizeVersion(value); } catch {}
  }
  return undefined;
}

export function VersionProvider({ children }: { children: React.ReactNode }) {
  const currentVersion = configuredVersion();
  const [latestRelease, setLatestRelease] = useState<ReleaseInfo>();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string>();
  const [lastCheckedAt, setLastCheckedAt] = useState<string>();
  const [dismissedVersion, setDismissedVersion] = useState<string>();
  const latestReleaseRef = useRef<ReleaseInfo | undefined>(undefined);
  const checkingRef = useRef(false);
  const lastAttemptAt = useRef(0);
  const checkGeneration = useRef(0);

  async function check(force = true): Promise<void> {
    const now = Date.now();
    if (checkingRef.current || !force && now - lastAttemptAt.current < CHECK_INTERVAL_MS) return;
    lastAttemptAt.current = now;
    checkingRef.current = true;
    const generation = ++checkGeneration.current;
    const checkedAt = new Date(now).toISOString();
    setChecking(true);
    setCheckError(undefined);
    try {
      if (!currentVersion) throw new Error('No se pudo determinar la versión instalada.');
      const release = await fetchLatestRelease();
      if (generation !== checkGeneration.current) return;
      latestReleaseRef.current = release;
      setLatestRelease(release);
      setLastCheckedAt(checkedAt);
      void saveVersionCheckCache({ checkedAt, succeeded: true, release }).catch(() => undefined);
    } catch {
      if (generation === checkGeneration.current) {
        setLastCheckedAt(checkedAt);
        setCheckError(CHECK_ERROR_MESSAGE);
        void saveVersionCheckCache({
          checkedAt,
          succeeded: false,
          release: latestReleaseRef.current,
        }).catch(() => undefined);
      }
    } finally {
      if (generation === checkGeneration.current) {
        checkingRef.current = false;
        setChecking(false);
      }
    }
  }

  const runAutomaticCheck = useEffectEvent(() => {
    void check(false);
  });
  const initializeVersionCheck = useEffectEvent(async () => {
    const generation = checkGeneration.current;
    const cached = await loadVersionCheckCache().catch(() => undefined);
    if (generation !== checkGeneration.current) return;
    if (cached) {
      lastAttemptAt.current = cached.succeeded
        ? Math.min(Date.parse(cached.checkedAt), Date.now())
        : 0;
      latestReleaseRef.current = cached.release;
      setLatestRelease(cached.release);
      setLastCheckedAt(cached.checkedAt);
      setCheckError(cached.succeeded ? undefined : CHECK_ERROR_MESSAGE);
    }
    runAutomaticCheck();
  });

  useEffect(() => {
    const initialCheck = setTimeout(() => void initializeVersionCheck(), 0);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') runAutomaticCheck();
    });
    return () => {
      clearTimeout(initialCheck);
      checkGeneration.current += 1;
      checkingRef.current = false;
      subscription.remove();
    };
  }, []);

  const updateAvailable = Boolean(
    currentVersion && latestRelease && compareVersions(latestRelease.version, currentVersion) > 0,
  );

  async function openLatestRelease(): Promise<void> {
    if (!latestRelease) return;
    try {
      if (Platform.OS === 'web' && !isDesktop() && typeof window !== 'undefined') {
        const popup = window.open('', '_blank');
        if (popup) {
          popup.opener = null;
          popup.location.replace(latestRelease.url);
        } else window.location.assign(latestRelease.url);
        return;
      }
      await openBrowserAsync(latestRelease.url, {
        presentationStyle: WebBrowserPresentationStyle.AUTOMATIC,
      });
    } catch {
      setCheckError('No se pudo abrir la página de la nueva versión.');
    }
  }

  const value: VersionContextValue = {
    currentVersion: currentVersion ?? 'desconocida',
    latestRelease,
    updateAvailable,
    showUpdateBanner: updateAvailable && dismissedVersion !== latestRelease?.version,
    checking,
    checkError,
    lastCheckedAt,
    checkForUpdates: () => check(true),
    openLatestRelease,
    dismissUpdate: () => setDismissedVersion(latestRelease?.version),
  };

  return <VersionContext value={value}>{children}</VersionContext>;
}

export function useVersionManager(): VersionContextValue {
  const context = use(VersionContext);
  if (!context) throw new Error('useVersionManager debe usarse dentro de VersionProvider.');
  return context;
}
