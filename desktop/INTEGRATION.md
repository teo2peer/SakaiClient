# Desktop integration contract

This directory implements one full Electron shell. The existing application supplies the renderer and platform adapters; this is not an export-only viewer. Shell runtime modules use Electron and built-in Node APIs only.

[Documentation index](../README.md#documentation) | [Development](../docs/DEVELOPMENT.md) | [Storage and privacy](../docs/STORAGE-PRIVACY.md) | [Validation record](../docs/VALIDATION.md)

## Integration

The web adapters detect the restricted desktop bridge at runtime. The same React interface uses native mobile adapters on iOS/Android, desktop IPC in Electron, and read-only import behavior in an ordinary browser.

## Public API

Import `getDesktopApi()`, `isDesktop()`, and the types from `src/lib/desktop.ts`. Detection is SSR-safe. The preload exposes `window.sakaiDesktop` only to the trusted main frame, with `apiVersion: 1`. Do not use platform detection alone: desktop runs the web bundle, but an ordinary browser has no bridge.

| Method | Result and semantics |
| --- | --- |
| `request(id, { url, method?, headers?, body?, redirect? })` | `Promise<{ status, statusText, url, headers: [string, string][], body: string }>`; text capped at 8 MiB. Non-success HTTP responses are returned, not thrown. |
| `cancel(id)` | `Promise<void>`; cancels a request, download or registered relocation operation and waits for its cleanup. Unknown IDs are harmless. |
| `getSecret(key)` | `Promise<string \| null>` for `credentials` or `session` only. |
| `setSecret(key, value)` | `Promise<void>`; OS-encrypted storage only, subject to the fallback below. |
| `clearSecret(key)` | `Promise<void>`; clearing `session` also aborts network work, clears university cookies and HTTP auth cache, stops background events, and closes notifications. |
| `createWorkspace(storedRootUri?)` | `Promise<{ rootUri, rootName }>`; restores a registered root or creates Documents/Sakai Client. |
| `chooseDirectory()` | `Promise<{ uri, name }>`; native directory picker and persistent capability registration. |
| `exists(uri)` | `Promise<boolean>`; asynchronous, not the synchronous native-files interface. Forged capabilities reject rather than returning false. |
| `validateRelocation(rootUri, sources)` | `Promise<void>`; rejects ancestor/descendant roots referenced by registered sources before a move starts. The same root is permitted. |
| `copyLocalFile(id, source, rootUri, { contentType? }, pathSegments)` | `Promise<string>`; streams and verifies a local source, reuses an identical destination or publishes a new file exclusively, then returns its file capability. Does not remove the original or commit the application index. |
| `removeCopiedOriginal(id, source, destination)` | `Promise<void>`; verifies the registered source and destination contents before removing the original. Call only after the application index/root commit. Supports cancellation through the operation ID. |
| `download(id, rootUri, { downloadUrl, size?, contentType? }, pathSegments)` | `Promise<string>` containing the registered file capability after a successful streamed download and replacement. No renderer buffering. |
| `onDownloadProgress(callback)` | Subscribes to validated `{ id, received, total? }` byte events. Returns an unsubscribe function; adapters must correlate the transfer ID and unsubscribe after settlement. |
| `readFileBase64(uri)` | `Promise<string>`; registered resource only, hard 32 MiB raw-file limit. |
| `openFile(uri)` | `Promise<void>`; registered resource only, native confirmation, executable/shell formats blocked. |
| `deleteFile(uri)` | `Promise<void>`; deletes one registered file and drops its capability. Unknown capabilities reject; a file already missing still drops its capability. Directories and unrelated files are never removed. The renderer confirms the action. |
| `importData()` | `Promise<string>`; native JSON picker, valid JSON, hard 32 MiB limit. Schema validation belongs in the adapter. |
| `exportData(contents)` | `Promise<void>`; valid JSON, 32 MiB limit, native save picker and atomic replacement. |
| `notificationPermission()` | `Promise<boolean>`; native application opt-in. System settings can still suppress delivery. |
| `notify({ id, title, body })` | `Promise<void>`; only after opt-in; native click focuses the app and emits the provided ID, never a URL. |
| `onAnnouncementOpen(callback)` | Callback receives an announcement ID, `__sakai_downloads__` for download completion, or `null` for the inbox summary; returns an unsubscribe function. |
| `setBackgroundRefresh(enabled)` | `Promise<boolean>` containing the resulting enabled state. |
| `onMetadataRefresh(callback)` | Returns an unsubscribe function. Events occur every 15 minutes while background refresh is enabled and the app remains open. The application enables it with notification opt-in and remembered credentials. |

Request/transfer IDs must be unique while active, 1-128 ASCII alphanumerics, `_`, `:`, or `-`. UUIDs work. There are at most 24 active operations; downloads, relocation copies and original-removal operations share a four-operation transfer limit. Text requests time out after 60 seconds and the main-process transfer ceiling is 30 minutes. The renderer download engine imposes the user-facing 30-second per-file attempt timeout and calls `cancel(id)`; cancellation waits for storage rollback/cleanup before the adapter settles. Downloads and newly streamed local copies have an 8 GiB limit. A supplied expected download size, including zero, is enforced.

Failures reject with **plain structured `DesktopError` data**, not an `Error` instance: `{ name: 'DesktopError' | 'AbortError', code, message, status? }`. This is deliberate: Electron drops custom properties on `Error` values crossing `contextBridge`. Adapters should reconstruct local `Error`, `SakaiError`, or `DOMException` instances. Map `status` for HTTP/auth failures and `code === 'CANCELLED'` for cancellation. The full finite code union is exported in `src/lib/desktop.ts`; messages contain no raw network or filesystem error details.

## Adapter requirements

- Electron and electron-builder are root devDependencies. Keep the root Expo Router entry unchanged; the Electron entry is `desktop/package.json`.
- Route desktop metadata requests through `request`. Convert supported `RequestInit` data to the serializable contract; forward only string or URL-encoded bodies and supported headers. Wire `AbortSignal` to `cancel`, including already-aborted signals, and remove listeners when settled.
- Build the renderer-side `Response` with a null body for HEAD and statuses 204, 205 and 304. Preserve the returned URL without logging it; login may include a ticket or session ID. Redirect metadata has an empty body and may have an empty status text.
- Supported headers are Accept, Content-Type, Cache-Control, Pragma, Depth, and the existing exact `Cookie: JSESSIONID=<id>`. The latter becomes an HttpOnly university cookie, never a forwarded raw Cookie header. Arbitrary Cookie, Authorization, Origin, Referer, and Host headers are rejected.
- Direct/session, portal login/logout/site landing pages, CAS login/continue/logout, site/announcement JSON, content discovery, access/content, content, and WebDAV are allowed with specific methods. CAS `service` destinations must point back to the permitted PoliformaT login endpoints. All network I/O uses one nonpersistent authenticated session. Ordinary renderer fetch cannot contact the internet.
- Use `download` for explicit file synchronization, not `request` or browser fetch. Subscribe to progress before invoking it, correlate by operation ID, wire `AbortSignal` to `cancel`, and unsubscribe after settlement. Await `exists`, preserve returned capability URIs in local metadata, and keep sync-engine cancellation semantics. Capabilities are installation-specific; imported URIs are marked untrusted and must never be passed to `exists`, read, open, move or delete operations on the receiving installation.
- Path segments reject hidden names, leading/trailing spaces, traversal, separators, Windows device names even with extensions, and alternate data streams. Keep `src/lib/paths.ts` consistent with these restrictions and surface failures rather than weakening the policy.
- Route document preview reads, JSON transfer, notifications and background hooks through the bridge only when detected. Ordinary browsers retain read-only index import behavior, with no direct authenticated requests or access to another device's document bytes.
- Linux `basic_text` and unavailable OS encryption cannot persist nonempty secrets. For remember-disabled login, an adapter may catch `SECURE_STORAGE_UNAVAILABLE` when saving a session and save an empty session marker instead. That marker lives in memory only; shared cookies still authenticate this running app. Never fall back to localStorage for credentials or session tokens.
- Clear the `session` secret on logout even if server logout fails. University cookies are memory-only, so cookie-only CAS sessions need login again on restart; remembered encrypted credentials can support the existing explicit reauthentication flow.
- Restore background opt-in from existing application preferences on launch. This hook requests metadata refresh only: the subscriber must not start document downloads. There is no tray, login item, closed-app scheduler, or auto updater.
- Render PDF in the main web renderer, using local assets and WASM. CSP allows `wasm-unsafe-eval`, not JavaScript `unsafe-eval`, remote JS, iframes, or inline event handlers. The current PDF.js integration uses a local `BinaryDataFactory` and `useWorkerFetch: false`; do not introduce remote asset fetching or weaken CSP.

## Security and recovery

The app is served only from `sakai-app://app/`, with sandboxing, context isolation and web security enabled. Every IPC handler verifies the exact live main frame and application origin. Chromium permissions, child windows, subframes, webviews and renderer downloads are denied. External HTTPS navigation can leave the app only after an explicit native confirmation.

Static HTML bootstrap scripts receive SHA-256 CSP hashes derived from the local exported HTML. Styles allow inline declarations for React Native Web. Renderer assets come from `dist/web` in development or `resources/renderer` in a package; client-side routes fall back to the exported index. Missing script/style assets return 404, not HTML.

Current Electron `session.fetch` rejects manual redirects rather than yielding a normal redirect response. The network module captures redirect metadata through session webRequest hooks, leaves cookie processing to Chromium, and never lets Chromium automatically follow. An internal random request-correlation header is removed in `onBeforeSendHeaders`; the renderer cannot supply it. Each next destination is independently validated. Earlier isolated real-Electron macOS checks covered a public portal 302/cookie-presence boolean and synthetic login/download flows; repeat the narrow runtime check after Electron/network changes. This is not evidence of live authenticated access on every OS.

Roots and successfully downloaded files use independent random `sakai-root://<id>` and `sakai-file://<id>` capabilities. The registry and encrypted secrets are mode 0600 under userData; the private directory is mode 0700. Resource resolution rejects symlinks, hardlinks, nonregular files, canonical-root changes and paths into application/private storage. Ordinary network downloads use exclusive temporary files, validation, backup/rename replacement, and a persisted recovery journal. Cancellation before their durable capability commit restores an existing file and removes partial data. A completed commit is not undone by a late cancellation. These ordinary-download guarantees must not be confused with library relocation.

Relocation first rejects nested roots and groups source aliases in `relocateDocuments`. `copyLocalFile` streams into a reserved `.<name>.sakai-relocate` temporary file, verifies it and publishes using exclusive creation, never replacing an unrelated destination. An identical destination can be reused. Copy and cleanup compare device/inode identity to avoid removing a destination reached through differently cased paths on case-insensitive filesystems. The application persists **all** document URI changes and the selected root together after every copy succeeds, then calls `removeCopiedOriginal` for verified cleanup. File-capability registration can precede this application-level commit.

Before the application index commit, cancellation/failure keeps the old index/root and originals; verified destination copies may remain for retry. After commit, cancellation or cleanup failure keeps the destination index/root and leaves remaining originals alongside those copies. Missing sources remain indexed as unavailable rather than complete. This is not a fully atomic filesystem operation or a durable all-files relocation transaction. See [recovery](../docs/STORAGE-PRIVACY.md#recovery), particularly for power loss and external providers.

Credential encryption does not encrypt course indexes or downloaded documents. There is no per-account partition; signing out or switching accounts leaves the index/files, and clearing the index does not clear authentication or the desktop capability registry. JSON exports contain personal/course content and local URIs despite excluding authentication secrets and document bytes.

Path checks are repeated before replacement and file opens use no-follow flags where supported. Built-in portable Node APIs do not provide a cross-platform `openat`/directory-handle transaction: this is not protection against a separate malicious process with the same OS user's filesystem privileges racing directory renames. Windows mode bits do not replace Windows ACLs. Forced termination or power loss on an unreliable filesystem cannot guarantee durability beyond OS filesystem guarantees.

## Packaging and validation commands

Run from the repository root with dependencies installed. Bun 1.3.14 and Node 24 match the CI baseline. These are operational commands, not a claim they were rerun during the documentation audit.

```sh
bun run build:web
bun run lint
bun run typecheck
node --test tests/desktop-relocation.test.js tests/desktop-policy.test.js
bunx electron desktop
node desktop/build.cjs --dir
```

`bun run desktop` combines the web export and Electron launch. Packaging itself requires a fresh `dist/web` and does not generate one. Before direct Expo CLI commands, run `bun run pdf:assets`; the `build:web` wrapper already does so. The build helper rejects an extra literal `--`, so use `node desktop/build.cjs --dir` rather than relying on package-manager argument forwarding.

The shell does not load a Metro HTTP origin or provide HMR. Re-export and reload after renderer changes. Metro already excludes the root `dist/` tree. Packaged artifacts always use the root-installed Electron version and `--publish never`.

Run installer builds on their corresponding OS runner:

```sh
node desktop/build.cjs --win --x64
node desktop/build.cjs --mac --arm64
node desktop/build.cjs --mac --x64
node desktop/build.cjs --appimage --x64
```

The configured Linux default includes AppImage and deb (`node desktop/build.cjs --linux --x64`). **A real project homepage is still required for electron-builder's deb metadata validation.** None was provided or invented. Supply an actual approved HTTPS project URL through the helper's `--homepage=` option or real homepage metadata in `desktop/package.json`. An actual maintainer contact should also replace the generic contributors label before public distribution. AppImage can be built separately using `--appimage`; CI selects AppImage only and does not publish a deb.

Outputs go to `dist/desktop`. Windows NSIS and macOS DMG are unsigned and macOS is not notarized; OS reputation/Gatekeeper warnings are expected. Linux AppImage requires an appropriate sandbox/user-namespace setup; never work around failures with `--no-sandbox`. No publication provider or remote/repository URL is configured.

The beforePack hook collects notices from the installed renderer dependency tree into ignored `desktop/.generated/THIRD_PARTY_NOTICES.txt`, including PDF CMaps/fonts/WASM notices where supplied. Root LICENSE and these notices are copied into package resources. Electron/Chromium's bundled license files are not excluded. Audit the resulting notices before a public release; this is a conservative inventory, not a legal completeness assertion.

## Validation Boundaries

The current temporary-filesystem and IPC-contract regressions, earlier macOS arm64 DMG build and isolated real-Electron/synthetic checks are recorded separately in [VALIDATION.md](../docs/VALIDATION.md). The latest relocation audit passed under both Bun and Node but did not relaunch Electron or rebuild an installer. Windows/Linux/macOS-x64 runtime support remains untested locally, and hosted CI has never run at handoff.

After relevant changes, use focused checks for direct/CAS redirects and cookies, logout/relaunch, secure-storage failure, explicit downloads and cancellation, capability/root rejection, reader limits/CSP and notification routing. Root relocation additionally needs copy/conflict/persistence/cleanup regressions before claiming safety. Before distributing a platform package, launch and test that actual package on its target OS; do not substitute a successful archive build for installation/runtime validation.
