import type { SavedCredentials } from '@/types/sakai';

export async function loadCredentials(): Promise<SavedCredentials | null> {
  return null;
}

export async function saveCredentials(_credentials: SavedCredentials): Promise<void> {
  throw new Error('El almacenamiento seguro no esta disponible en esta plataforma.');
}

export async function clearCredentials(): Promise<void> {}

export async function loadSessionId(): Promise<string | null> {
  return null;
}

export async function saveSessionId(_sessionId: string): Promise<void> {}

export async function clearSessionId(): Promise<void> {}
