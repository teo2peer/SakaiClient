# Storage and Privacy

[Documentation index](../README.md#documentation) | [Usage](USAGE.md) | [Validation record](VALIDATION.md)

These are implementation notes, not a complete privacy policy, a backup guarantee or a claim of regulatory compliance. The [README legal notice](../README.md#legal-notice) applies, including the project's independent status and restrictions on institutional content.

## Data Locations

| Data | Storage and limits |
| --- | --- |
| Courses, local aliases/favorites/order, announcements, read flags, resource trees, document index and settings | One `AppData` JSON record in AsyncStorage, under `sakai-client.data.v1`. The current schema version is 3 despite the key suffix. This is ordinary local data, not an encrypted credential vault. |
| Native login secrets | `expo-secure-store`, separately from `AppData`: Android's protected storage or iOS Keychain. Remember controls stored credentials; session state is separate. |
| Desktop login secrets | Electron OS encryption under the app's private userData storage. Unavailable encryption and Linux `basic_text` are not accepted for nonempty secrets. |
| Downloaded documents | Android app-private `Sakai Sync`, iOS app `Documents/Sakai Sync`, desktop OS `Documents/Sakai Client`, or a root explicitly selected through the system picker. No application-level encryption of document contents is provided. |
| Desktop file access registry | Private userData metadata mapping random `sakai-root://` and `sakai-file://` capabilities to authorized local roots and files. These capabilities belong to this installation. |
| Notification state | Local notification-ID deduplication records, plus the desktop native permission preference. OS notification history is outside the document index. |
| Temporary reader/export data | Native cache can contain a JSON export and a temporary PDF copy for a provider URI. This is not a secure-erasure mechanism. |

Keep downloaded material, exports and backups protected with suitable device access controls and disk protection. Files in a shared folder or cloud-backed provider are subject to that provider's access, synchronization and retention policies. Selecting such a folder is not equivalent to keeping all data only on one device.

## Ordinary Downloads

Only an explicit file, folder, course or application scope downloads documents. Version-1 migration preserves existing indexes/files while removing the old automatic-download behavior. Metadata refresh and notification polling do not download documents.

The download engine compares the manifest fingerprint with current metadata and checks file existence before reusing a file. Fingerprints combine reported modification time, size and download URL; they are not content hashes or a guarantee of server freshness. Tapping an existing file just opens that copy. A forced file update refreshes its metadata and downloads again.

Indexed file existence is rechecked with bounded concurrency at startup, foregrounding and relevant screen focus. Unknown, inaccessible and missing URIs are not counted as downloaded. A physically available outdated copy is counted as downloaded but not current, so its folder remains eligible for an update. This status is a point-in-time observation: another process or storage provider can change immediately afterward.

Download replacement validates temporary data before replacing an older local version. Native downloads reserve `.<name>.sakai-download` and `.<name>.sakai-backup`; desktop downloads also use a persisted replacement recovery journal. Each file receives 30 seconds for the complete attempt. Timeout aborts the request, removes or rolls back temporary replacement state and continues the batch without replacing a valid prior copy. These safeguards do not make the filesystem and application index a single atomic transaction.

Ordinary sync never uploads local edits, deletes remote resources or prunes local files because they disappeared from a remote listing. It can replace a local file when explicitly updating it, so keep valuable edits separately. Completed ordinary downloads survive batch cancellation. Folder relocation deliberately has a different cleanup phase.

Local deletion is the one explicit removal path for downloaded documents. The quick actions of a file or folder delete the selected local copies after confirmation and drop their index entries; a physical URI shared by several selected entries is removed once, and it is preserved while an entry outside the selected scope still references it. Untrusted imported URIs are forgotten without filesystem access. Desktop deletes only files registered as capabilities of a selected root, and a file already gone still drops its entry. Directories, sibling files, exports and unrelated data are never removed, and nothing is deleted on the server. This is ordinary deletion, not secure erasure: OS trash, snapshots, backups and synchronization services keep their own copies.

## Folder Relocation

The coordinator is `relocateDocuments` in `src/lib/relocate-documents.ts`, called by `chooseSyncFolder` in `src/providers/app-provider.tsx`. The adapters implement `validateRelocation`, `copyExisting` and `removeCopiedOriginal`; desktop exposes corresponding restricted IPC operations.

1. Resolve the selected root and validate relocation before copying. A source and destination root must be independent: ancestor/descendant roots are rejected. Selecting the same root is a file no-op and can confirm the current location.
2. Group document entries by their source `localUri`. Aliases to the same source are copied once, with every alias receiving the verified destination URI.
3. Check each source. Missing or inaccessible sources stay in metadata with `available: false`; they are not counted as successfully downloaded or given a completed checkmark.
4. Copy every available source and verify its contents. An identical destination can be reused. An unrelated file with different contents at the destination causes a conflict rather than being overwritten.
5. After every copy succeeds and cancellation has not stopped the operation, persist all document updates and the selected root together in one `AppData` write. The visible application state is updated only after persistence succeeds. A failed write does not switch the visible root/index to the proposed values.
6. Only after that index commit, verify originals against their destination copies again and remove eligible originals. Changed, unauthorized, unavailable, still-referenced or undeletable originals are retained. Desktop also compares physical file identity so differently cased paths or capabilities for the same file are not deleted as redundant originals. Old empty directories and unrelated files are not removed.

On native platforms, copies use bounded chunks in reserved `.<name>.sakai-relocate` temporary files, content comparison and a move with `overwrite: false`. On desktop, copies stream to exclusive temporary files, are checked with checksums, and are published with exclusive destination creation. Relocation never intentionally replaces an unrelated destination file. These temporary names are reserved for application recovery, not user documents.

The desktop file-capability registry can persist a verified destination before the application index switches. A capability registration is not the library's index commit: all document references and root settings still switch together at the application layer.

Index mutations are serialized and calculated from the last committed state when their turn starts. Metadata, read flags or notification settings cannot inherit the proposed destination of a failed relocation write. Downloads, relocation, index import and index deletion share an exclusive operation guard, acquired before opening a picker or waiting for cleanup. Import/reset cannot replace the index while relocation is removing originals; ordinary metadata changes still use the commit queue. This is application-level coordination, not a cross-process filesystem lock.

### Cancellation and Failure

| Phase | Index/root | Files |
| --- | --- | --- |
| Preflight rejects nested roots | Old values remain | No originals are removed. |
| Copy/verification is cancelled or fails before the index commit, including a destination-file conflict | Old values remain | Originals remain; already verified destination copies may remain and can be reused on retry. |
| Persisting the new index/root fails | Old committed values remain | Originals remain; verified destination copies may remain. |
| Cancellation/failure during post-commit cleanup | Destination index/root remain committed | Completed destination copies remain; originals not yet safely removed remain alongside them. Earlier successful removals are not undone. |
| Successful cleanup with missing sources | Destination root committed; missing entries remain unavailable | Only available, verified originals were eligible for removal. Missing data is not reconstructed. |

Cancellation during a persistence operation can be observed after that commit has completed; it is not a promise to roll back a durable commit. Read the selected root and reported result rather than assuming every cancellation means the old location is still active.

This is **not a fully atomic filesystem operation**. There is no all-files filesystem transaction spanning native providers, desktop capabilities and AsyncStorage, nor a promise of a durable relocation journal that rolls everything back after power loss. Provider behavior, concurrent external file edits, process termination and storage faults may require manual recovery. Tests of the coordinator do not establish physical-provider durability.

### Recovery

1. Stop further downloads or moves. Keep both source and destination folders until you have checked the outcome; do not remove either solely because a progress counter reached the end.
2. Check the selected root in Descargas. If the application index did not commit, restore access to the original root before retrying. If it did commit, confirm that the indexed destination files open.
3. Reauthorize inaccessible external folders through the system picker, particularly after an iOS relaunch. Persistent iOS security-scoped bookmarks are not promised by this implementation.
4. Retry against the same independent destination when appropriate. Verified identical copies can be reused. Resolve differing destination-file conflicts manually without discarding the only valid copy.
5. Compare originals and destination files before manually deleting retained duplicates or old empty folders. Changed originals can contain edits absent from the committed copy. Back up material you must retain, subject to its access and copyright restrictions.
6. Treat reserved temporary/backup files conservatively after forced termination. Do not bulk-delete application recovery files while an operation is running. An unavailable source cannot be recovered from metadata; restore a real backup or explicitly download it if still authorized and available remotely.

The app does not implement a cross-platform filesystem transaction or protection against a malicious process running with the same user's filesystem privileges. See [desktop security boundaries](../desktop/INTEGRATION.md#security-and-recovery) for capability and path restrictions.

## Authentication Boundaries

Authentication requests go to the configured institutional services, currently PoliformaT and its permitted CAS flow, not through a maintainer-operated proxy. Direct-login failure can invoke CAS; this is not an EntityBroker-only login implementation. Readers process local documents without a remote conversion service. Explicit HTTPS attachment links and open/share actions leave that local-reader boundary.

The version manager makes a public, unauthenticated request to `api.github.com/repos/teo2peer/SakaiClient/releases/latest` when its last successful cached check is at least 24 hours old, after relaunching following a failed check, plus checks explicitly requested in Ajustes. It locally caches only the attempt time, outcome and validated public release metadata. It sends no PoliformaT credentials, course index or document data. GitHub still receives ordinary connection metadata such as the device's public IP address; its own privacy terms apply. The desktop main process limits this bridge method to that fixed endpoint and returns only validated release metadata.

The application keeps passwords/session secrets out of its normal index and generated exports. Native secure-store settings use `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY` where applicable. On desktop, university cookies are kept in a nonpersistent network session; remembered encrypted credentials can support reauthentication after relaunch.

Without desktop OS encryption, nonempty secrets cannot be persisted. A remember-disabled running session can use cookies with an **empty in-memory session marker**. This marker is not a plaintext password or token fallback and does not restore authentication after process exit. Trying to remember credentials without secure storage fails and the login flow clears the failed authentication state.

Do not include raw cookies, ticket-bearing URLs, passwords, credential files or private course material in logs, screenshots, issues or tests. Sanitized status/count logging is not a reason to publish unreviewed device logs.

## Accounts and Deletion

**There is no per-account data partition.** `AppData`, notification deduplication and document storage are not keyed by the current institutional account. Signing into another account does not wipe the previous account's local data. Later metadata refreshes can replace listings, but old document entries, files or read flags can remain. Do not treat account switching as a privacy boundary.

| Action | What it does | What it does not do |
| --- | --- | --- |
| Sign out | Clears stored credentials/session state and disables background work. Desktop also clears university cookies/auth cache, aborts network work and closes its active notifications. | Does not clear the course/announcement/document index, downloaded files, exports or external backups. |
| Clear local index | Removes the `AppData` record, resets settings/root confirmation and disables background work. | Does not sign out, delete downloaded files, wipe desktop capabilities/secrets, remove separate notification deduplication records or erase exports. |
| Delete local copies | Deletes the downloaded files of the selected document or folder subtree and forgets their index entries. | Does not delete remote resources, other courses, empty directories, exports or OS-level copies, and is not secure erasure. |
| Import an index | Replaces local `AppData`; resets root selection and disables notifications. | Does not import document bytes, log in, partition accounts or delete the previous files. |
| Change root | Copies/commits/cleans up as described above. | Does not upload files, erase unrelated files or guarantee secure deletion. |

For a shared-device handover, signing out and clearing the index are separate actions. Files, exported copies, OS notifications, caches and backups also need separate review using the relevant OS/provider controls. Neither button is a complete data wipe. Do not rely on uninstall behavior to clear external folders or backups; the Windows installer is configured to retain app data on uninstall.

## Exports and Browser Mode

Exports contain courses, announcements (including bodies, authors and attachments), read flags, resource trees, document metadata, local URIs and settings. They contain **indexes, not document bytes or authentication secrets**. They can still disclose personal information, private academic content, copyrighted text and local path names.

Export is not anonymization, encryption or a document backup. Review recipients and rights before sharing. Native export writes a JSON file into cache and invokes the OS share sheet; desktop uses a native save dialog; browser export creates a local JSON download. No maintainer upload service is involved in these actions.

Imports accept schema versions 1, 2 and 3 and normalize to version 3. The selected root is reset, notifications are disabled and imported document URIs are marked unavailable and untrusted. They are not probed, opened, moved, shared, reused or deleted by native/desktop file adapters. Source-device file URIs do not grant cross-device access. Desktop capabilities from another installation are not valid locally, even if a file happens to exist at a similar path. Select an authorized root and explicitly download missing resources as needed.

An ordinary browser only reads imported data because authenticated PoliformaT responses are restricted by CORS. It does not store application login credentials and cannot recover document bytes from exported URIs. Do not disable browser/Electron web security to bypass this boundary.
