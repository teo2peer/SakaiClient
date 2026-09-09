import * as SecureStore from 'expo-secure-store';

import { CREDENTIALS_KEY, SESSION_KEY } from '@/lib/constants';
import type { SavedCredentials } from '@/types/sakai';

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

export async function loadCredentials(): Promise<SavedCredentials | null> {
  const value = await SecureStore.getItemAsync(CREDENTIALS_KEY, options);
  return value ? (JSON.parse(value) as SavedCredentials) : null;
}

export async function saveCredentials(credentials: SavedCredentials): Promise<void> {
  await SecureStore.setItemAsync(CREDENTIALS_KEY, JSON.stringify(credentials), options);
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(CREDENTIALS_KEY, options);
}

export async function loadSessionId(): Promise<string | null> {
  return SecureStore.getItemAsync(SESSION_KEY, options);
}

export async function saveSessionId(sessionId: string): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, sessionId, options);
}

export async function clearSessionId(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY, options);
}
