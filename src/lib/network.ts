export const sakaiFetch = ((...args: Parameters<typeof globalThis.fetch>) =>
  globalThis.fetch(...args)) as typeof globalThis.fetch;
