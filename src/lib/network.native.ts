import { fetch as expoFetch } from 'expo/fetch';

export const sakaiFetch = expoFetch as unknown as typeof globalThis.fetch;
