import type { SavedCredentials } from '@/types/sakai';
import { desktopError, getDesktopApi } from '@/lib/desktop';

export async function loadCredentials(): Promise<SavedCredentials | null> {
  try {
    const value = await getDesktopApi()?.getSecret('credentials');
    if (!value) return null;
    const parsed = JSON.parse(value);
    return typeof parsed?.username === 'string' && typeof parsed?.password === 'string' ? parsed : null;
  } catch (cause) { throw desktopError(cause); }
}

export async function saveCredentials(credentials: SavedCredentials): Promise<void> {
  const api = getDesktopApi();
  if (!api) throw new Error('Las credenciales no se guardan en la version web.');
  try { await api.setSecret('credentials', JSON.stringify(credentials)); }
  catch (cause) { throw desktopError(cause); }
}

export async function clearCredentials(): Promise<void> {
  try { await getDesktopApi()?.clearSecret('credentials'); } catch (cause) { throw desktopError(cause); }
}

export async function loadSessionId(): Promise<string | null> {
  try { return await getDesktopApi()?.getSecret('session') ?? null; } catch (cause) { throw desktopError(cause); }
}

export async function saveSessionId(sessionId: string): Promise<void> {
  const api = getDesktopApi();
  if (!api) return;
  try { await api.setSecret('session', sessionId); }
  catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'SECURE_STORAGE_UNAVAILABLE') {
      await api.setSecret('session', '');
      return;
    }
    throw desktopError(cause);
  }
}

export async function clearSessionId(): Promise<void> {
  try { await getDesktopApi()?.clearSecret('session'); } catch (cause) { throw desktopError(cause); }
}
