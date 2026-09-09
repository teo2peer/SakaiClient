# Validation Record

[Documentation index](../README.md#documentation) | [Development](DEVELOPMENT.md) | [CI contract](../.github/CI.md)

Snapshot: **2026-09-09**, current uncommitted working tree on `main`. This record separates checks executed for download-state/progress, course preferences and relocation from historical evidence. No institutional credentials were used for the current checks, and no hosted workflow or release was triggered.

## Current Audit

| Item | Status |
| --- | --- |
| Documentation/source comparison | Reviewed physical availability, progress/timeout, explicit download scopes, course preferences, imported-URI trust, authentication, notifications, relocation, package scripts and CI. |
| Current regressions | Full `bun test`: 151 passed across 16 files. Focused desktop Node run: 28 passed. The desktop files overlap the Bun suite. |
| Latest lint/typecheck | Both passed after the implementation, dependency alignment and release-hygiene changes. `expo-doctor` passed all 21 checks. |
| Current frontend export | `dist/web` rebuilt successfully, including 14 static routes and 187 local PDF support assets. |
| README screenshots | Responsive fixture navigation, filters, physical download state, resource actions and local PDF rendering passed at 390/1280 px. A synthetic desktop-bridge browser flow verified favorite-first order, alias persistence and controls at 390 px. Mobile captures were regenerated. |
| Real Electron relaunch | Not established for this change. Two Playwright launches reached Electron's debugger/DevTools endpoints but timed out before the first window attached. The older synthetic desktop PDF image remains; current IPC/storage behavior is covered by Node tests, not this failed runtime attempt. |
| Native/desktop package rebuilds | Not repeated in this audit, by request. Existing IPA/APK/DMG artifacts predate these changes. |
| Physical-device picker/move/UI validation | Not established. The latest phone installation attempt failed because the target device was unavailable. |
| Hosted GitHub Actions | Never run at handoff; no configured Git remote was reported. |

The checks below validate the current source within their stated boundaries. They do not replace physical-device or packaged-application validation.

### Current Commands

```bash
bun run build:web --max-workers 2
bun test
node --test "tests/desktop-"*.test.js
bun run lint
bun run typecheck
bunx expo-doctor
git diff --check
```

All commands above passed. Filesystem fixtures are isolated and removed after each test. Bun reported 151 passes, zero failures and 528 `expect()` calls; Node reported 28 passes, zero failures and zero skips. `expo-doctor` passed all 21 checks after aligning the Expo SDK patch versions.

The responsive harness also passed against the rebuilt export: app navigation, announcement filters/read state and resource tree at 390/1280 px; local PDF page/zoom and two offline scanned-PDF fixtures; and authenticated course alias/favorite/order persistence at 390 px. The separate real-Electron harness failed during Playwright launch twice with a 60-second first-window attachment timeout. It used an isolated temporary profile and removed it afterward; no institutional credentials were submitted.

- Download regressions cover 30-second configuration, cooperative timeout/continuation, stalled existence checks, checkpoint failures, byte progress, imported-URI trust and physical/current count separation. The timeout tests use a short injected duration while separately asserting the production 30,000 ms constant.
- Path/relocation regressions cover sanitized and case-insensitive collisions, all-copies-before-commit ordering, shared-source aliases, copy/persistence failure, cancellation, retained changed originals, missing/untrusted sources and preservation of reused destinations.
- Persistence regressions combine the real relocation coordinator with queued mutations. A rejected relocation write cannot leak its proposed root into later metadata writes; successful relocation survives concurrent changes. Reset participates in the same queue.
- Provider action tests use mocked React hooks/platform effects for import/reset/delete exclusion, shared physical references and same-root reauthorization. They do not mount native dialogs.
- Desktop tests use actual temporary filesystem files for relocation and aborted-download cleanup, including recovery-journal removal. The preload progress contract is exercised in an isolated VM, not a newly launched Electron shell.
- Resource-tree regressions verify that missing/unverified files do not count as downloaded and that physically available stale copies count as downloaded without counting as current.
- Notification regressions verify desktop opt-in gating, summary counts and omission of raw failure details. Native OS delivery/click routing remains device-dependent.
- The committed README images contain synthetic data. Mobile images are current responsive browser captures rather than physical-device evidence. The desktop image is historical and was not regenerated in this pass because the Electron harness did not attach.
- A separate read-only review found the identified speculative-state, import/cleanup and unordered-reset races corrected. Review is supporting evidence, not an additional runtime test.

## Historical Evidence

These results were reported from earlier tool runs, before the latest relocation audit changes. They are useful baselines, not certification of the current tree or every target.

| Check | Earlier result | Evidence boundary |
| --- | --- | --- |
| Full unit suite | 84 tests passed. | Predates the latest relocation changes; not the current regression count. |
| Lint and typecheck | Passed. | Earlier source state; typecheck also generated PDF support assets. |
| iOS Release with `react-native-pdf` | Signed IPA built, approximately 16.7 MB. | Build/signing success, not physical-device UI, PDF, picker or relocation validation. |
| Android arm64 unsigned Release | Build succeeded using `-Xmx4g -XX:MaxMetaspaceSize=1g`. | Initial 512 MiB JVM attempt ran out of memory; a hung daemon was recovered. No all-ABI or latest device-runtime claim. |
| macOS arm64 desktop | DMG built. | Packaging success for that target, not notarization, trusted distribution or every desktop OS. |
| Real Electron on macOS, isolated public-portal check | Observed a public portal HTTP 302 and verified cookie presence as a boolean, without credentials. | Confirms that narrow redirect/cookie behavior, not authenticated production course access. |
| Real Electron on macOS, synthetic full-client flow | Synthetic login, download, local PDF, CSP, logout, secure-storage-failure rollback and notification preference after relaunch passed. | Fixture-based behavior in a real Electron runtime; not a live institutional account or all-OS test. |
| Web UI fixtures | Exercised widths of 390 and 1280 pixels. | Browser fixture layout evidence, not physical-phone navigation or native dialogs. |
| Local PDF fixtures | Ordinary, CCITT and JPEG2000 PDFs rendered without external runtime fetches. | Tested fixture set, not universal PDF compatibility or the latest native build. |
| Workflow syntax | `actionlint` v1.7.12 passed. | Syntax validation, not a hosted workflow run or successful artifact upload/release. |
| Workflow action references | Commit SHAs were reviewed/verified in the earlier work. | Not rechecked over the network by this documentation pass. |

Generated native/desktop binaries from those runs are stale relative to this audit. `dist/web` was rebuilt by the current commands above, but signed IPA, APK and DMG artifacts were not. The source, lockfile and scripts are authoritative; the existence of an older binary does not establish that it contains these fixes.

## Unvalidated Boundaries

- Windows and Linux desktop packaging/runtime and macOS x64 were not run locally. Workflow matrix entries do not prove those targets pass.
- Hosted GitHub validation, runner availability, artifact upload and version-tag publication have not been exercised. There is no released CI result or release URL to cite.
- The latest actual phone install failed because the device was unavailable. Do not claim the latest native UI, native PDF interaction, system picker or document move was verified on a physical device.
- Android external providers and iOS folder reauthorization need real-device checks. No persistent iOS bookmark or cross-provider durability guarantee is established.
- Native background scheduling, download-completion notifications and OS click routing remain OS-dependent; fixture/unit checks do not establish delivery timing.
- The current alias/favorite/order UI and progress indicators passed responsive browser fixtures, not touch, screen-reader or physical-device validation.
- The current Electron renderer did not attach to Playwright in two attempts; do not claim a current real-shell UI run from the passing Node/VM checks.
- Power loss, external provider faults and concurrent external filesystem changes are not covered by a claim of all-files atomicity. Manual recovery can still be needed.

## Focused Verification Scope

Keep these boundaries covered when changing relocation; broad platform rebuilds are not a substitute for targeted regressions:

1. Reject ancestor/descendant relocation roots before copying; preserve same-root no-op behavior.
2. Copy shared-source aliases once, verify all available sources, then persist every document URI and the selected root together before deleting any original.
3. Preserve the old committed index/root and all originals when copying or index persistence fails or cancellation stops work before commit; allow verified destination copies to remain/reuse.
4. Keep the committed destination index/root if cleanup is cancelled or fails, retaining originals not safely removed; preserve missing-source metadata with `available: false` and no completed checkmark.
5. Refuse differing destination-file conflicts, including files created after preflight; keep native no-overwrite moves and desktop exclusive publication.
6. Recheck provider integration separately on devices before claiming picker, permission, move or restart behavior. Unit tests of a coordinator do not establish those properties.

The six focused test files are listed in the executed commands above. Native provider integration, actual UI mounting and the untested operating systems still require separate checks.

For a later release, also verify installation/signing on each target, offline reader assets, notification routing and secure-storage behavior on that OS. Keep that release validation separate from this limited audit. See [unsigned build limitations](../.github/UNSIGNED-RELEASE.md).
