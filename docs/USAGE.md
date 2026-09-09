# Usage

[Documentation index](../README.md#documentation) | [Storage and recovery](STORAGE-PRIVACY.md) | [Validation limits](VALIDATION.md)

Sakai Client is an independent, unofficial client currently configured for UPV PoliformaT. Use only your own authorized access and treat the official platform as authoritative. The interface currently uses Spanish labels.

## First Launch

1. On Android, iOS or desktop, choose the default download folder or use the system folder picker. Selecting a location does not start any downloads.
2. Sign in with your institutional credentials. The client tries EntityBroker direct login and uses the institutional portal/CAS flow when direct login is rejected. It checks that the resulting session is authenticated.
3. Choose whether to remember credentials. They are stored separately from the index using the platform's secure store. On desktop without OS encryption, turn off remember or configure the OS keyring; there is no plaintext password fallback.
4. Open a course to inspect its resource tree. Download only the files or scopes you need.

The folder prompt is not an every-launch prompt: it appears while the choice is unconfirmed. Importing an index or clearing it resets this confirmation. A temporarily inaccessible stored root remains selected and reports an error in Descargas instead of blocking the app with the first-launch prompt. iOS external folders can still require reauthorization after relaunch.

The default folder is app-private `Sakai Sync` on Android, the app's `Documents/Sakai Sync` on iOS (visible in Files), and the OS Documents folder's `Sakai Client` on desktop. The picker can select a different accessible root. [Moving an existing library](STORAGE-PRIVACY.md#folder-relocation) has different cancellation rules from downloading.

## Navigation

The four screens are real Expo Router tabs, not decorative navigation buttons:

| Tab | Purpose |
| --- | --- |
| Asignaturas | Course list and nested resource trees |
| Anuncios | Cross-course inbox, local search, course filter and unread filter |
| Descargas | Selected root, whole-library download, progress and cancellation |
| Ajustes | Automatic/light/dark appearance, palettes, version checks, open the desktop download folder, notification opt-in, import/export, clear index and sign out |

Courses, announcement details and document readers have their own routes. The announcement tab badge reflects local unread flags.

Course cards can be marked as favorites, moved up or down within their favorite/non-favorite group, and assigned a local alias. Favorites are shown first. When an alias exists, it is the primary title and the original PoliformaT title remains visible below it. These preferences are part of the local index and JSON export; they do not modify PoliformaT.

## Downloads

**There are no automatic document downloads.** This includes startup, foreground refresh, background checks and migration from version-1 data. Opening a resource is an explicit request for that file, not permission to download its course.

| Scope | Action and boundary |
| --- | --- |
| File | Tap a resource to check the local file, download it if missing, then open it. The viewer download action explicitly forces a new copy. |
| Folder | Use the folder download icon for that subtree only, including descendants but not siblings. |
| Course | Use the course download action for that course's resources. |
| Whole application | In Descargas, select the whole-library action and confirm. This can use substantial disk space and network data. |

Use a row's visible actions button, or long-press the row, for quick actions: open in the viewer, download or update that file, download the folder subtree, share/open the original, expand or collapse a folder, and delete local copies. The sheet lists why an action is unavailable (no session, another operation in progress, nothing pending or no local file) instead of hiding it. Desktop/web users can close the sheet with Escape and keyboard focus returns to the previous control.

Deleting asks for confirmation, then removes the local copies of that file or subtree and their index entries. **It is a local action only:** the resource stays in PoliformaT and can be downloaded again. Empty download directories are left in place, and previous exports, caches or external backups are not touched.

Course resource discovery combines recursive EntityBroker and WebDAV results in parallel, deduplicated by remote path. If one provider fails, the other can still supply a listing. These are authenticated institutional resources, not public data.

The course request currently uses `/direct/site.json?_limit=0` without pagination. Do not interpret zero as guaranteed unlimited results: the server can apply its own page limit. Whole-library download means the accessible courses and resources returned to this client, not a guaranteed exhaustive archive of the institutional account.

Ordinary batch downloads refresh the selected remote listing and reuse files when the local file exists and its manifest fingerprint matches the reported modification time, size and download URL. This is not a server-content checksum. Simply opening an existing file does not check for a newer server version. Use the viewer's force-download action when freshness matters; that action also refreshes the resource metadata.

Download counts and file ticks require a local file confirmed to exist. A folder's completed state additionally requires every descendant copy to match the current manifest fingerprint, so an outdated but readable copy remains counted as physically downloaded without disabling its update action. The app rechecks indexed URIs at startup, when returning to the foreground and when focusing the course/download lists. This is still a point-in-time check, not a continuous filesystem monitor or a guarantee that the server has not changed. Empty folders do not count as completed downloads. Missing or inaccessible files stay in metadata as unavailable and do not count toward completion.

Cancellation stops subsequent work and retains completed ordinary downloads. Each file attempt has a 30-second timeout; an expired attempt is cancelled, its temporary data is cleaned up, the file is reported as omitted by time and the batch continues. Failed or timed-out files can be retried by running the same scope again. Ordinary sync never uploads edits or prunes remote/local files, but downloading a new version can replace a local copy, including local edits. Keep edits elsewhere if you need to preserve them.

The initiating course/library button becomes a percentage bar while its scope runs. A folder download icon becomes a segmented circular indicator, and the Descargas screen shows aggregate, current-file and timeout progress. Byte percentages depend on a reported file size; when the size is unknown, aggregate progress still advances after each file completes.

Course folders retain nested remote paths with filesystem-safe names. Empty remote folders can be shown in the index without materializing an empty download directory. Locally indexed documents can remain visible after disappearing from a remote listing.

## Local Readers

| Format/platform | Behavior |
| --- | --- |
| PDF on iOS/Android | Native `react-native-pdf`, local files, page counter and zoom. Not available in Expo Go. Android `content://` sources may first be copied to a temporary local cache file. |
| PDF on desktop | Bundled PDF.js and support assets. No CDN or remote conversion service; 32 MiB raw-file limit. |
| DOCX, ODT, PPTX | Local, read-only, text-oriented extraction, not an Office editor or a faithful page/slide renderer. |
| TXT, MD, CSV | Read-only text. Markdown and CSV are not rich Markdown or spreadsheet editors. |
| Other formats | No integrated preview; use the original with a compatible external app. |
| Ordinary browser | Imported indexes do not include another device's local bytes, so those document URIs cannot be previewed. |

Office/text inputs are limited to 32 MiB. Text is limited to 2,000,000 characters. Office extraction allows at most 4,000 archive entries, 4 MiB per selected decompressed XML part, 12 MiB total selected decompressed content, 5,000 output blocks and a nesting depth of 64. A file below 32 MiB can still be rejected. Encrypted, malformed or image-only documents may not provide readable text. Images, formulas and exact layout are omitted.

The native PDF path does not read the entire PDF into a JavaScript/base64 buffer and does not share the PDF.js 32 MiB input cap. It still depends on device memory and native renderer support; this is not a promise to open PDFs of arbitrary size.

Use the compact viewer header to go back, force-download this resource, or open/share the original. Native sharing hands the file to the app you select. Desktop opens only registered files after native confirmation and blocks executable/shell formats. An external application has its own permissions and privacy behavior.

## Announcements

The inbox fetches the global user query `/direct/announcement/user.json?n=1000&d=3650`: it requests up to 1,000 announcements over a 3,650-day window. It is not an unlimited archive, and the server can impose its own restrictions.

Search is local and case/accent-insensitive across titles, course titles, authors and stripped body text. Course and unread filters apply only to the visible inbox. Opening a detail marks the announcement read locally; this does not update an institutional read receipt. Details show the full cached text, not the original HTML layout. Attachment links are restricted to HTTPS and open externally; they are not automatically downloaded into the resource library and may need browser authentication.

Use the refresh action for current course/announcement metadata. Startup and returning to the foreground can also refresh metadata. Offline access uses the existing index and available local files; it does not guarantee current announcements, deadlines or attachment access.

## Notifications

Enable notifications in Ajustes and grant OS permission. They are off by default. A discovery batch produces at most five individual notifications plus a summary for additional new announcements, with local ID deduplication. Initial metadata loading is not treated as a new-announcement broadcast. A user-requested download batch also sends one local completion notification, including failures/timeouts, unless it was cancelled or found neither files nor discovery errors.

- Notifications are local alerts after polling, not institutional push or a guaranteed deadline reminder.
- Inbox search, course and unread filters do not limit which new announcements can notify.
- The current application enables scheduled checks only with notification opt-in and remembered credentials. Manual/foreground refresh can still discover announcements in an active session.
- iOS/Android request a minimum background interval of 60 minutes. OS scheduling, permissions, connectivity and session availability decide actual execution.
- The native background task fetches announcements and sends notifications only; it does not overwrite `AppData`, download documents or refresh the foreground index on disk.
- Desktop emits metadata refresh events every 15 minutes while the app remains open and configured. There is no closed-app scheduler, tray service or login item.
- Opening an individual announcement notification routes to its detail; an announcement summary routes to the inbox; a download completion routes to Descargas. If an announcement detail is absent locally, the app can refresh it when authenticated.

## Version Updates

The app loads the last version result on launch and refreshes it from the latest stable, non-draft GitHub Release when the last successful cached check is at least 24 hours old. A failed cached check is retried after relaunch; the same successful-check interval applies when returning to the foreground. **Comprobar actualizaciones** always requests an immediate check. This is independent of PoliformaT authentication and does not block startup, login or offline data when GitHub cannot be reached.

When a newer semantic version is available, the app shows a dismissible banner and an indicator on Ajustes. The **Actualizaciones** card displays the installed version, allows an immediate manual check, and opens the validated release page. Dismissing the banner lasts for the current app session; the update remains visible in Ajustes.

The version manager is notification-only. It does not download, sign, install or replace the application, and the latest endpoint intentionally ignores prereleases. Follow the platform-specific steps in [Installation](../INSTALL.md), including checksum and signing requirements.

## Imports and Local Data

Export from Ajustes to obtain `sakai-client-export.json` on native/browser, or choose a filename through the desktop save dialog. Import replaces the current index rather than merging it. Version-1, version-2 and version-3 exports are accepted and normalized to version 3; import resets root confirmation, marks imported file URIs unavailable and untrusted, and disables notifications. Imported URIs are never probed, opened, moved, shared, reused or deleted as local files. Import does not copy files or restore authentication; explicitly download authorized resources into a selected root on the receiving installation.

Import, clear-index, download and relocation operations cannot run simultaneously. Finish or cancel the active operation before starting another. An open import picker holds this guard until it completes or is dismissed.

In an ordinary browser, import an export to read courses, announcements and document metadata. Direct authenticated PoliformaT access is unavailable because of CORS; importing does not bypass that restriction. Serve the web export as a static site, not as an Electron application.

**Changing accounts does not erase local data.** There is one local index, not one per user. Signing out clears authentication but retains indexes/files; clearing the index does not sign out or delete files. Read [storage and privacy](STORAGE-PRIVACY.md) before sharing a device or exporting data.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Folder prompt returns after relaunch | The root confirmation was reset, normally by an import or clear-index action, or the previous selection never committed. A provider-access failure alone should appear in Descargas without reopening this prompt. |
| Relocation is cancelled or reports retained originals | Check the selected root and the index-commit phase before removing anything. Follow the recovery guide; verified copies can remain on both sides. |
| File shows unavailable | Restore provider access or explicitly download it. Metadata alone does not contain the file. |
| Existing file appears outdated | Opening reuses it. Use the viewer's force-download action and verify the official source. |
| Preview fails | Check file availability, format and reader limits. Use the original in a trusted compatible app. |
| Desktop remember fails | Configure the OS keyring/encryption or disable remember. Plaintext storage is deliberately refused. |
| No notification | Check opt-in and OS permission. Announcement polling additionally needs remembered credentials and OS scheduling; download completion requires a non-cancelled requested batch. Filters are not notification subscriptions. |
| Browser cannot log in or open exported files | This is the read-only browser mode, not the full Electron client. The JSON has no document bytes. |

Physical-device folder pickers, external providers and the latest native UI have not been validated by this documentation audit. See the [validation record](VALIDATION.md) for the precise evidence boundary.
