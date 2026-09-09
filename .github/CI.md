# CI and Release Contract

[Documentation index](../README.md#documentation) | [Development](../docs/DEVELOPMENT.md) | [Validation record](../docs/VALIDATION.md) | [Unsigned build notice](UNSIGNED-RELEASE.md)

The configured workflow is [workflows/ci.yml](workflows/ci.yml). It triggers on `v*` tag pushes, pull requests, and manual dispatches; ordinary branch pushes do not start a run. Every triggered run exports web and runs unit tests, lint, and typechecking. Native and desktop builds run only for tags and manual dispatches, depend on successful validation, and target Android, iOS, Windows x64, Linux x64, and macOS arm64/x64. This avoids consuming Actions capacity for every commit while retaining pull-request validation and explicit release builds.

This contract is active in the public [teo2peer/SakaiClient](https://github.com/teo2peer/SakaiClient) repository. The current `main` source passed the complete hosted workflow in [run 34338925563](https://github.com/teo2peer/SakaiClient/actions/runs/34338925563), including validation and every documented platform build. Review runner availability, permissions, usage and CI-minute limits, especially for macOS, before changing broad push builds.

Obsolete runs for the same branch or pull request are cancelled. Tag runs are not cancelled by a newer run, and different tags have separate concurrency groups. Only a successful **push of a validated version tag** publishes a GitHub Release; manually dispatching on a tag does not publish.

## Toolchain

- Expo SDK 57.0.21 / React Native 0.86.3 from the root frozen Bun lockfile.
- Bun 1.3.14 and Node.js 24.19.0 on every build runner.
- Android: Ubuntu 24.04, Temurin Java 21, the hosted Android SDK, and the generated Gradle wrapper.
- iOS: macOS 26 with `/Applications/Xcode_26.6.app/Contents/Developer`. SDK 57 requires Xcode 26.4 or newer.
- Desktop: Ubuntu 24.04, Windows 2025, and macOS 26. Both macOS architectures are packaged separately.

All actions are pinned to commit SHAs reviewed/verified in the earlier work and executed successfully in the hosted `main` run; pin provenance was not independently rechecked during that run. The default token permission is `contents: read`, checkout never persists credentials, and only the tag publishing job has `contents: write`. No private signing material, Expo token or custom GitHub token is required. Dependency installation skips the root Electron binary; electron-builder may still download the target Electron runtime while packaging.

## Source Contract

The workflow uses these existing root package scripts:

```json
{
  "build:web": "bun run pdf:assets && expo export --platform web --output-dir dist/web",
  "build:ios:ci": "bash ./scripts/build-ios-ci.sh",
  "desktop:build": "node ./desktop/build.cjs"
}
```

The workflow also uses `pdf:assets`, `lint`, `typecheck`, and Bun tests. The web build runs before tests/lint/typecheck, and its export is reused by all desktop jobs. The desktop packager itself does not refresh `dist/web`.

`app.config.ts` consumes `BUILD_VERSION` as the native marketing version and `BUILD_NUMBER` as Android `versionCode` / iOS `buildNumber`. It honors `IOS_BUNDLE_IDENTIFIER`, preserving the existing local bundle identifier when the variable is absent. The Android package in `app.json` is `dev.sakaiclient.unofficial`. Generated `ios/`, `android/`, and `dist/` are ignored; native configuration belongs in app config/plugins, not manual native edits.

`desktop/build.cjs` honors `BUILD_VERSION`, forces `--publish never`, and supports the workflow's `--appimage`, `--win`, `--mac`, `--x64`, and `--arm64` arguments. The configured artifact pattern is `SakaiClient-${version}-${os}-${arch}.${ext}`, output is `dist/desktop/`, and macOS signing/notarization are disabled. The helper rejects a literal standalone `--`; CI calls it directly with Node. Linux CI explicitly selects AppImage, not the configured local default of AppImage plus deb. The optional deb target still requires a real approved homepage and maintainer/contact metadata; CI does not invent them or build that target.

Android CI runs `:app:assembleRelease` with `scripts/android-unsigned.init.gradle`, `--no-daemon`, `--max-workers=2` and `-Dorg.gradle.jvmargs="-Xmx4g -XX:MaxMetaspaceSize=1g"`. The init script removes signing configurations, rather than allowing a release signed with a debug key. The workflow requires `app-release-unsigned.apk` and rejects an unexpected `app-release.apk` before upload.

## Version Metadata

`node scripts/ci-metadata.mjs` reads GitHub's `GITHUB_REF_TYPE`, `GITHUB_REF_NAME`, and `GITHUB_RUN_NUMBER` from the environment. It falls back to `package.json`'s version on branches and pull requests; branch names are never used to construct a version or a shell command. On any tag run, the tag must be `vX.Y.Z` or `vX.Y.Z-prerelease` with valid SemVer prerelease identifiers. Build metadata (`+...`), leading zero numeric identifiers, whitespace, and shell metacharacters are rejected.

Version strings are limited to 128 characters and each numeric core component to 65535 for Windows compatibility. The run number must be a canonical decimal integer between 1 and 2100000000, Android's maximum version code. Re-running a workflow keeps the same build number. Overflow fails rather than wrapping or reusing a lower number.

The script exports `version`, `native_version`, `build_number`, and `prerelease` as GitHub outputs. Native jobs receive `native_version` without the prerelease suffix; desktop receives the full `version`. The publishing job revalidates metadata before constructing the release tag.

## Outputs

| Build | Files on its runner | Actions artifact |
| --- | --- | --- |
| Web renderer | `dist/web/**` | `web-renderer` (7 days) |
| Web download | `dist/releases/SakaiClient-web.zip` | `release-web` (14 days) |
| Android | `dist/releases/SakaiClient-android-unsigned.apk` | `release-android-unsigned` (14 days) |
| iOS | `dist/releases/SakaiClient-ios-unsigned.ipa` | `release-ios-unsigned` (14 days) |
| Windows x64 | `dist/desktop/SakaiClient-<version>-win-x64.exe` | `release-desktop-windows-x64` (14 days) |
| Linux x64 | `dist/desktop/SakaiClient-<version>-linux-x64.AppImage` | `release-desktop-linux-x64` (14 days) |
| macOS arm64 | `dist/desktop/SakaiClient-<version>-mac-arm64.dmg` | `release-desktop-macos-arm64` (14 days) |
| macOS x64 | `dist/desktop/SakaiClient-<version>-mac-x64.dmg` | `release-desktop-macos-x64` (14 days) |

Build outputs are uploaded only after their producing build step succeeds. **Web artifacts are uploaded before tests/lint/typecheck**, so they may be available even when that validation job ultimately fails; artifact presence alone is not a green validation result. Native and desktop jobs require the complete validation job to pass. Native build directories, node_modules, keystores, unpacked Electron apps, blockmaps, and builder debugging files are not uploaded.

The iOS CI script checks `GITHUB_ACTIONS=true` and macOS and must be run from the repository root with runner temporary storage available. It regenerates the native project, installs pods, compiles a generic iOS device Release with signing disabled, checks `main.jsbundle`, the public bundle identifier and absence of embedded signing data, and archives `Payload/SakaiClient.app` with macOS file metadata disabled. Temporary derived data and IPA staging live under `RUNNER_TEMP` and are removed on exit. It refuses to overwrite an existing output IPA and does not invoke or read the local private signer.

Local `ios` / `ios:build` scripts are a separate private signing path, producing `dist/ios/SakaiClient-signed.ipa` and using the fixed local identifier `app.ursaminor7619.otter1161`. That local installation can replace another app with the same identifier. CI instead uses `dev.sakaiclient.unofficial` and never uploads the local signed IPA. CI APK/IPA outputs require appropriate signing before installation; desktop packages are unsigned and macOS is not notarized. See [UNSIGNED-RELEASE.md](UNSIGNED-RELEASE.md).

## Publishing and Recovery

The release job downloads `release-*` artifacts into separate subdirectories under `dist/release-downloads/`. `scripts/release-assets.mjs` validates regular distributable files, rejects unsafe names and case-insensitive duplicates, creates a new flat `dist/release-assets/`, and generates `SHA256SUMS.txt` by streaming each copied file through SHA-256. It never invokes GitHub or publishes on import or direct execution.

`gh release create --verify-tag --generate-notes` attaches the flat files plus checksums using only the built-in token. Tags with a prerelease suffix use `--prerelease`. The unsigned-build notice is prepended to generated release notes. Existing releases fail explicitly; there is no overwrite, clobber, delete, or automatic tag creation. A failed upload may leave a draft release: inspect it before retrying, and choose recovery deliberately rather than silently replacing assets.

The workflow does not create repositories, deploy a hosted website, submit to App Store/TestFlight/Play Store, or configure EAS/OTA/desktop automatic updates. Signing, store submission, native device smoke tests and desktop installation tests remain separate release responsibilities. Attaching an unsigned artifact is not a claim of OS trust or store approval.

## Validation Status

The earlier `actionlint` v1.7.12 check passed. The current hosted `main` run passed 151 Bun tests, lint, typechecking, web export, Android/iOS unsigned builds and desktop packaging for Windows x64, Linux x64 and macOS arm64/x64. Runtime and installation checks were not performed by packaging jobs. Local checks and remaining boundaries are recorded in [VALIDATION.md](../docs/VALIDATION.md).

For workflow/helper changes, the existing `tests/ci.test.js` covers tag/version/run-number validation and release asset flattening/checksums/duplicate rejection without contacting GitHub. Its temporary files use `os.tmpdir()`; select an approved `TMPDIR` when validating locally. `actionlint` and `bash -n scripts/build-ios-ci.sh` are focused syntax checks. The workflow itself builds web before running `bun test`, `bun run lint` and `bun run typecheck`.

Hosted native/platform packaging passes for the documented targets. Installation, signing and device/runtime validation remain separate. Release [`v1.0.0`](https://github.com/teo2peer/SakaiClient/releases/tag/v1.0.0) was published from the verified artifacts of the green hosted `main` run; its redundant tag rebuild was cancelled rather than compiling every platform a second time.
