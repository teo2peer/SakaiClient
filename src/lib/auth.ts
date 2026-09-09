import { clearCredentials, clearSessionId, loadCredentials, loadSessionId, saveSessionId } from '@/lib/credentials';
import { SakaiClient } from '@/lib/sakai-client';

let generation = 0;
let clearing = false;
let pendingPersistence: Promise<void> = Promise.resolve();
const restorations = new Map<AbortController, Promise<SakaiClient | null>>();

export async function clearStoredAuthentication(): Promise<void> {
  generation += 1;
  clearing = true;
  try {
    for (const controller of restorations.keys()) controller.abort();
    await Promise.allSettled([...restorations.values()]);
    await pendingPersistence.catch(() => undefined);
    await Promise.all([clearCredentials(), clearSessionId()]);
  } finally { clearing = false; }
}

export function restoreAuthenticatedClient(isCurrent = () => true): Promise<SakaiClient | null> {
  if (clearing) return Promise.resolve(null);
  const controller = new AbortController();
  const result = restoreClient(isCurrent, controller.signal).finally(() => restorations.delete(controller));
  restorations.set(controller, result);
  return result;
}

async function restoreClient(isCurrent: () => boolean, signal: AbortSignal): Promise<SakaiClient | null> {
  const revision = generation;
  const active = () => !clearing && revision === generation && isCurrent();
  const sessionId = await loadSessionId();
  const client = new SakaiClient(undefined, sessionId || undefined);
  // An empty ID marks a cookie-only login; a missing key means the user signed out.
  if (sessionId !== null && await client.getCurrentSession(signal)) return active() ? client : null;

  const credentials = await loadCredentials();
  if (!credentials || !active()) return null;

  const session = await client.login(credentials.username, credentials.password, signal);
  pendingPersistence = pendingPersistence.catch(() => undefined).then(async () => {
    if (active()) await saveSessionId(session.id);
  });
  await pendingPersistence;
  return active() ? client : null;
}
