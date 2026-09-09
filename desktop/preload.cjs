const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  let result;
  try {
    result = await ipcRenderer.invoke(channel, ...args);
  } catch {
    return Promise.reject({
      name: 'DesktopError', code: 'INTERNAL', message: 'The desktop operation could not be completed.',
    });
  }
  if (!result.ok) {
    // contextBridge drops custom Error properties. A plain rejection preserves the safe code/status.
    return Promise.reject({
      name: result.error.code === 'CANCELLED' ? 'AbortError' : 'DesktopError', ...result.error,
    });
  }
  return result.value;
}

function subscribe(channel, callback, announcement) {
  if (typeof callback !== 'function') throw new TypeError('A callback is required.');
  const listener = (_event, value) => {
    if (announcement) {
      if (value === null || typeof value === 'string') callback(value);
    } else callback();
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function subscribeDownloadProgress(callback) {
  if (typeof callback !== 'function') throw new TypeError('A callback is required.');
  const listener = (_event, value) => {
    if (!value || typeof value.id !== 'string' || !Number.isSafeInteger(value.received) || value.received < 0) return;
    if (value.total !== undefined && (!Number.isSafeInteger(value.total) || value.total < 0)) return;
    callback({ id: value.id, received: value.received, total: value.total });
  };
  ipcRenderer.on('sakai:download-progress', listener);
  return () => ipcRenderer.removeListener('sakai:download-progress', listener);
}

// A sandboxed preload cannot import local Node modules. Keep channel names fixed here.
if (process.isMainFrame && location.protocol === 'sakai-app:' && location.host === 'app') {
  contextBridge.exposeInMainWorld('sakaiDesktop', Object.freeze({
    apiVersion: 1,
    request: (id, input) => invoke('sakai:request', id, input),
    cancel: (id) => invoke('sakai:cancel', id),
    getLatestRelease: () => invoke('sakai:get-latest-release'),
    getSecret: (key) => invoke('sakai:get-secret', key),
    setSecret: (key, value) => invoke('sakai:set-secret', key, value),
    clearSecret: (key) => invoke('sakai:clear-secret', key),
    createWorkspace: (storedRootUri) => invoke('sakai:create-workspace', storedRootUri),
    chooseDirectory: () => invoke('sakai:choose-directory'),
    openRoot: (uri) => invoke('sakai:open-root', uri),
    exists: (uri) => invoke('sakai:exists', uri),
    validateRelocation: (rootUri, sources) => invoke('sakai:validate-relocation', rootUri, sources),
    copyLocalFile: (id, source, rootUri, resource, segments) => invoke('sakai:copy-local-file', { id, source, rootUri, resource, segments }),
    removeCopiedOriginal: (id, source, destination) => invoke('sakai:remove-copied-original', id, source, destination),
    download: (id, rootUri, resource, pathSegments) => invoke('sakai:download', id, rootUri, resource, pathSegments),
    onDownloadProgress: (callback) => subscribeDownloadProgress(callback),
    readFileBase64: (uri) => invoke('sakai:read-file-base64', uri),
    openFile: (uri) => invoke('sakai:open-file', uri),
    deleteFile: (uri) => invoke('sakai:delete-file', uri),
    importData: () => invoke('sakai:import-data'),
    exportData: (contents) => invoke('sakai:export-data', contents),
    notificationPermission: () => invoke('sakai:notification-permission'),
    notify: (input) => invoke('sakai:notify', input),
    onAnnouncementOpen: (callback) => subscribe('sakai:announcement-open', callback, true),
    setBackgroundRefresh: (enabled) => invoke('sakai:set-background-refresh', enabled),
    onMetadataRefresh: (callback) => subscribe('sakai:metadata-refresh', callback, false),
  }));
}
