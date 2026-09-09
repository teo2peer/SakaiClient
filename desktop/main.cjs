const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, protocol, safeStorage, session, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const {
  APP_URL, FILE_LIMIT, DesktopFailure, publicError, isAppUrl, trustedSender, parseUrl, record, text, contained,
} = require('./policy.cjs');
const { DesktopNetwork } = require('./network.cjs');
const { DesktopStorage, readBounded, regularFile, atomicWrite } = require('./storage.cjs');
const { installProtocol } = require('./protocol.cjs');
const { fetchLatestRelease } = require('./release.cjs');

app.setName('Sakai Client');
const testProfile = !app.isPackaged && process.argv.find((argument) => argument.startsWith('--sakai-test-profile='))?.slice('--sakai-test-profile='.length);
if (testProfile) {
  app.setPath('userData', path.join(path.resolve(testProfile), 'user-data'));
  app.setPath('documents', path.join(path.resolve(testProfile), 'documents'));
}
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{
  scheme: 'sakai-app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

let mainWindow;
let network;
let storage;
let rendererSession;
let backgroundTimer;
let notificationEnabled = false;
let notificationPreferencesPath;
let notificationEpoch = 0;
let dialogActive = false;
let quitting = false;
let quitReady = false;
const notifications = new Set();

function contents() {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : undefined;
}

function send(channel, value) {
  const target = contents();
  if (target && !target.isDestroyed() && isAppUrl(target.mainFrame.url)) target.send(channel, value);
}

async function withDialog(callback) {
  if (dialogActive || !mainWindow || mainWindow.isDestroyed()) throw new DesktopFailure('BUSY');
  dialogActive = true;
  try { return await callback(mainWindow); } finally { dialogActive = false; }
}

async function confirmExternal(value) {
  try {
    const url = parseUrl(value);
    if (url.protocol !== 'https:') return;
    const accepted = await withDialog(async (window) => {
      const result = await dialog.showMessageBox(window, {
        type: 'question', title: 'Open external website?',
        message: `Open ${url.origin} in your default browser?`,
        detail: 'The complete link will be sent to your browser. This site is outside Sakai Client.',
        buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0, noLink: true,
      });
      return result.response === 1;
    });
    if (accepted) await shell.openExternal(url.href);
  } catch { /* Navigation stays blocked when confirmation fails or another dialog is active. */ }
}

function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (!trustedSender(event, contents()) || quitting) throw new DesktopFailure('FORBIDDEN');
      if (args.length > 4) throw new DesktopFailure('INVALID_INPUT');
      return { ok: true, value: await callback(...args) };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
}

function installBridge() {
  handle('sakai:request', (id, input) => network.request(id, input));
  handle('sakai:cancel', (id) => network.cancel(id));
  handle('sakai:get-latest-release', () => fetchLatestRelease());
  handle('sakai:get-secret', (key) => storage.secret('get', key));
  handle('sakai:set-secret', (key, value) => storage.secret('set', key, value));
  handle('sakai:clear-secret', async (key) => {
    if (key === 'session') notificationEpoch += 1;
    await storage.secret('clear', key);
    if (key === 'session') {
      clearInterval(backgroundTimer);
      backgroundTimer = undefined;
      for (const notification of notifications) notification.close();
      notifications.clear();
      await network.clearSession();
    }
  });
  handle('sakai:create-workspace', (uri) => storage.createWorkspace(uri));
  handle('sakai:choose-directory', () => withDialog(async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a Sakai Client document folder', properties: ['openDirectory', 'createDirectory'],
      message: 'Explicit document syncs can replace matching files in this folder.',
    });
    if (result.canceled || result.filePaths.length !== 1) throw new DesktopFailure('CANCELLED');
    return storage.registerRoot(result.filePaths[0]);
  }));
  handle('sakai:open-root', async (uri) => {
    if (await shell.openPath(await storage.resolveRoot(uri))) throw new DesktopFailure('UNSUPPORTED');
  });
  handle('sakai:exists', (uri) => storage.exists(uri));
  handle('sakai:validate-relocation', (rootUri, sources) => storage.validateRelocation(rootUri, sources));
  handle('sakai:copy-local-file', (value) => {
    const { id, source, rootUri, resource, segments } = record(value);
    return network.run(id, (signal) => storage.copyLocalFile(source, rootUri, resource, segments, signal), true);
  });
  handle('sakai:remove-copied-original', (id, source, destination) => network.run(id, (signal) => storage.removeCopiedOriginal(source, destination, signal), true));
  handle('sakai:download', (id, rootUri, resource, segments) => network.run(
    id, (signal) => storage.download(rootUri, resource, segments, network, signal, (received, total) => {
      send('sakai:download-progress', { id, received, total });
    }), true,
  ));
  handle('sakai:read-file-base64', (uri) => storage.readFileBase64(uri));
  handle('sakai:delete-file', (uri) => storage.deleteFile(uri));
  handle('sakai:open-file', (uri) => withDialog(async (window) => {
    let target = await storage.resolveFile(uri);
    // Opening executable or shell-associated formats would turn a document capability into code execution.
    if (/\.(?:exe|com|bat|cmd|msi|msp|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|lnk|url|reg|cpl|app|command|sh|bash|zsh|fish|desktop|appimage|jar|py|pl|rb|workflow|scpt|webloc|dmg|pkg|deb|rpm)$/i.test(target)) {
      throw new DesktopFailure('FORBIDDEN');
    }
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: 'Open document?', message: `Open ${path.basename(target)} in its default application?`,
      detail: 'Only open documents you trust. External applications have their own security policies.',
      buttons: ['Cancel', 'Open document'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response !== 1) throw new DesktopFailure('CANCELLED');
    target = await storage.resolveFile(uri);
    if (await shell.openPath(target)) throw new DesktopFailure('UNSUPPORTED');
  }));
  handle('sakai:import-data', () => withDialog(async (window) => {
    const result = await dialog.showOpenDialog(window, {
      title: 'Import Sakai Client data', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length !== 1) throw new DesktopFailure('CANCELLED');
    const target = result.filePaths[0];
    if (path.extname(target).toLowerCase() !== '.json') throw new DesktopFailure('FORBIDDEN');
    const contents = (await readBounded(target, FILE_LIMIT)).toString('utf8');
    try { JSON.parse(contents); } catch { throw new DesktopFailure('INVALID_INPUT'); }
    return contents;
  }));
  handle('sakai:export-data', (contents) => {
    text(contents, FILE_LIMIT);
    try { JSON.parse(contents); } catch { throw new DesktopFailure('INVALID_INPUT'); }
    return withDialog(async (window) => {
      const result = await dialog.showSaveDialog(window, {
        title: 'Export Sakai Client data', defaultPath: 'sakai-client.json',
        filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) throw new DesktopFailure('CANCELLED');
      const directory = await fs.realpath(path.dirname(result.filePath));
      const target = path.join(directory, path.basename(result.filePath));
      if (path.extname(target).toLowerCase() !== '.json' || storage.forbiddenRoots.some((root) => contained(root, target))) {
        throw new DesktopFailure('FORBIDDEN');
      }
      await regularFile(target);
      const temporary = path.join(directory, `.sakai-export-${randomBytes(16).toString('hex')}`);
      let handle;
      try {
        handle = await fs.open(temporary, 'wx', 0o600);
        await handle.writeFile(contents, 'utf8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await regularFile(target);
        await fs.rename(temporary, target);
      } finally {
        await handle?.close().catch(() => undefined);
        await fs.unlink(temporary).catch(() => undefined);
      }
    });
  });
  handle('sakai:notification-permission', async () => {
    if (!Notification.isSupported()) return false;
    if (notificationEnabled) return true;
    return withDialog(async (window) => {
      const result = await dialog.showMessageBox(window, {
        type: 'question', title: 'Sakai Client notifications', message: 'Show notifications for new announcements and completed downloads?',
        detail: 'Announcement checks require Sakai Client to remain open. System settings can also suppress notifications.',
        buttons: ['Not now', 'Allow'], defaultId: 0, cancelId: 0, noLink: true,
      });
      notificationEnabled = result.response === 1;
      await atomicWrite(notificationPreferencesPath, Buffer.from(JSON.stringify({ version: 1, allowed: notificationEnabled })));
      return notificationEnabled;
    });
  });
  handle('sakai:notify', async (value) => {
    const epoch = notificationEpoch;
    const input = record(value);
    const id = text(input.id, 1024);
    const title = text(input.title, 512);
    const body = text(input.body, 4096, true);
    if (/[\u0000-\u001f\u007f]/u.test(id)) throw new DesktopFailure('INVALID_INPUT');
    if (!notificationEnabled || !Notification.isSupported()) throw new DesktopFailure('FORBIDDEN');
    if (await storage.secret('get', 'session') === null || epoch !== notificationEpoch) throw new DesktopFailure('AUTH_REQUIRED', 401);
    if (notifications.size >= 20) {
      const oldest = notifications.values().next().value;
      oldest.close();
      notifications.delete(oldest);
    }
    const notification = new Notification({ title, body, silent: true });
    notifications.add(notification);
    notification.on('click', () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      send('sakai:announcement-open', id === '__sakai_inbox__' ? null : id);
    });
    notification.on('close', () => notifications.delete(notification));
    notification.on('failed', () => notifications.delete(notification));
    notification.show();
  });
  handle('sakai:set-background-refresh', (enabled) => {
    if (typeof enabled !== 'boolean') throw new DesktopFailure('INVALID_INPUT');
    clearInterval(backgroundTimer);
    backgroundTimer = enabled ? setInterval(() => send('sakai:metadata-refresh'), 15 * 60_000) : undefined;
    backgroundTimer?.unref();
    return enabled;
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Sakai Client', width: 1220, height: 840, minWidth: 360, minHeight: 480, show: false,
    backgroundColor: '#FAFAF7',
    webPreferences: {
      session: rendererSession, preload: path.join(__dirname, 'preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false,
      nodeIntegrationInWorker: false, nodeIntegrationInSubFrames: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      plugins: false, navigateOnDragDrop: false, safeDialogs: true, disableDialogs: true,
      devTools: !app.isPackaged,
    },
  });
  const target = mainWindow.webContents;
  target.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(target.getURL())) void confirmExternal(url);
    return { action: 'deny' };
  });
  target.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isAppUrl(event.url)) {
      event.preventDefault();
      if (event.isMainFrame && isAppUrl(target.getURL())) void confirmExternal(event.url);
    }
  });
  target.on('will-navigate', (event) => {
    if (!isAppUrl(event.url)) {
      event.preventDefault();
    }
  });
  target.on('will-redirect', (event) => { if (!event.isMainFrame || !isAppUrl(event.url)) event.preventDefault(); });
  target.on('will-attach-webview', (event) => event.preventDefault());
  target.on('will-prevent-unload', (event) => event.preventDefault());
  target.on('render-process-gone', () => { void network.cancelAll(); });
  target.on('did-start-navigation', (event) => {
    if (event.isMainFrame && !event.isSameDocument) void network.cancelAll();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = undefined;
    clearInterval(backgroundTimer);
    backgroundTimer = undefined;
    for (const notification of notifications) notification.close();
    notifications.clear();
    void network.cancelAll();
  });
  await mainWindow.loadURL(APP_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  app.on('login', (event, _contents, _details, _authInfo, callback) => { event.preventDefault(); callback(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (quitReady || !network) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    clearInterval(backgroundTimer);
    void network.cancelAll().then(() => Promise.allSettled([storage.queue, storage.secretQueue])).finally(() => {
      quitReady = true;
      app.quit();
    });
  });
  app.whenReady().then(async () => {
    app.setAppUserModelId('dev.sakaiclient.unofficial');
    const rendererRoot = app.isPackaged ? path.join(process.resourcesPath, 'renderer') : path.join(__dirname, '..', 'dist', 'web');
    rendererSession = session.fromPartition('persist:sakai-renderer');
    // University cookies never persist outside safeStorage. Metadata and downloads share this session.
    network = new DesktopNetwork(session.fromPartition('sakai-authenticated', { cache: false }));
    storage = new DesktopStorage({
      directory: path.join(app.getPath('userData'), 'desktop'), documents: app.getPath('documents'), safeStorage,
      forbiddenRoots: [app.getPath('userData'), app.getAppPath(), rendererRoot],
    });
    await storage.init();
    notificationPreferencesPath = path.join(storage.directory, 'notification-preferences.json');
    try {
      const preferences = JSON.parse((await readBounded(notificationPreferencesPath, 64 * 1024)).toString('utf8'));
      notificationEnabled = preferences?.version === 1 && preferences.allowed === true;
    } catch { notificationEnabled = false; }
    rendererSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    rendererSession.setPermissionCheckHandler(() => false);
    rendererSession.setDevicePermissionHandler(() => false);
    rendererSession.on('will-download', (event) => event.preventDefault());
    rendererSession.webRequest.onBeforeRequest((details, callback) => {
      const localBlob = details.url.startsWith('blob:sakai-app://app/');
      callback({ cancel: !isAppUrl(details.url) && !localBlob });
    });
    await installProtocol(rendererSession, rendererRoot);
    installBridge();
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' }, { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]));
    await createWindow();
  }).catch(() => {
    dialog.showErrorBox('Sakai Client could not start', 'The desktop renderer or local storage is unavailable. Export the web application to dist/web before starting a development shell.');
    app.quit();
  });
}
