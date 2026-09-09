export type DesktopSecretKey = 'credentials' | 'session';

export type DesktopRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: 'manual' | 'follow' | 'error';
};

export type DesktopResponse = {
  status: number;
  statusText: string;
  url: string;
  headers: [string, string][];
  body: string;
};

export type DesktopErrorCode =
  | 'INVALID_INPUT' | 'FORBIDDEN' | 'NOT_FOUND' | 'CANCELLED' | 'BUSY'
  | 'LIMIT_EXCEEDED' | 'NETWORK' | 'HTTP' | 'AUTH_REQUIRED' | 'REDIRECT'
  | 'INVALID_DOCUMENT' | 'STORAGE' | 'SECURE_STORAGE_UNAVAILABLE' | 'UNSUPPORTED' | 'INTERNAL';

/** Plain rejection data: Electron does not preserve custom properties on Error instances. */
export type DesktopError = {
  name: 'DesktopError' | 'AbortError';
  message: string;
  code: DesktopErrorCode;
  status?: number;
};

/** Privileged operations are available only in the desktop application's main frame. */
export interface DesktopApi {
  readonly apiVersion: 1;
  request(id: string, input: DesktopRequest): Promise<DesktopResponse>;
  cancel(id: string): Promise<void>;
  getSecret(key: DesktopSecretKey): Promise<string | null>;
  setSecret(key: DesktopSecretKey, value: string): Promise<void>;
  clearSecret(key: DesktopSecretKey): Promise<void>;
  createWorkspace(storedRootUri?: string): Promise<{ rootUri: string; rootName: string }>;
  chooseDirectory(): Promise<{ uri: string; name: string }>;
  openRoot(uri: string): Promise<void>;
  exists(uri: string): Promise<boolean>;
  validateRelocation(rootUri: string, sources: string[]): Promise<void>;
  copyLocalFile(id: string, source: string, rootUri: string, resource: { contentType?: string }, pathSegments: string[]): Promise<string>;
  removeCopiedOriginal(id: string, source: string, destination: string): Promise<void>;
  download(
    id: string,
    rootUri: string,
    resource: { downloadUrl: string; size?: number; contentType?: string },
    pathSegments: string[],
  ): Promise<string>;
  onDownloadProgress(callback: (progress: { id: string; received: number; total?: number }) => void): () => void;
  readFileBase64(uri: string): Promise<string>;
  openFile(uri: string): Promise<void>;
  deleteFile(uri: string): Promise<void>;
  importData(): Promise<string>;
  exportData(contents: string): Promise<void>;
  notificationPermission(): Promise<boolean>;
  notify(input: { id: string; title: string; body: string }): Promise<void>;
  onAnnouncementOpen(callback: (id: string | null) => void): () => void;
  setBackgroundRefresh(enabled: boolean): Promise<boolean>;
  onMetadataRefresh(callback: () => void): () => void;
}

export function getDesktopApi(): DesktopApi | undefined {
  if (typeof window === 'undefined') return undefined;
  const api = (window as Window & { sakaiDesktop?: DesktopApi }).sakaiDesktop;
  return api?.apiVersion === 1 ? api : undefined;
}

export function isDesktop(): boolean {
  return getDesktopApi() !== undefined;
}

export function desktopError(cause: unknown): Error & { status?: number } {
  const value = cause && typeof cause === 'object' ? cause as Partial<DesktopError> : {};
  const message = value.code === 'SECURE_STORAGE_UNAVAILABLE'
    ? 'El almacen seguro del sistema no esta disponible. Desactiva Recordar credenciales o configura el llavero del sistema.'
    : value.code === 'CANCELLED' ? 'Operacion cancelada.' : value.message ?? 'No se pudo completar la operacion de escritorio.';
  return Object.assign(new Error(message), { name: value.name ?? 'Error', status: value.status });
}
