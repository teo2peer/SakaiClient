# Development

[Documentation index](../README.md#documentation) | [Desktop integration](../desktop/INTEGRATION.md) | [CI](../.github/CI.md) | [Validation record](VALIDATION.md)

Run project commands from the repository root unless a different directory is explicitly stated. `package.json`, `bun.lock`, platform scripts and the workflow are authoritative; an existing `dist/` artifact may predate current source. Commands below are operational instructions, not evidence that this documentation audit ran them.

## Toolchain

| Tool | Project/CI baseline |
| --- | --- |
| Bun | 1.3.14 in CI; use the checked-in `bun.lock` |
| Node.js | 24.19.0 in CI; Node 24 is the reproducible baseline for the documented workflow |
| Expo / React Native | `expo ~57.0.21`, `react-native 0.86.3` |
| React / routing / styling | React 19.2.3, Expo Router 57, NativeWind 4.2 |
| Desktop | Root-installed Electron and electron-builder, versions resolved by the lockfile |
| Android | Java 21, Android SDK and generated Gradle wrapper; CI uses Temurin on Ubuntu 24.04 |
| iOS | macOS, Xcode 26.4 or newer and CocoaPods; CI selects Xcode 26.6 on macOS 26 |

For a fresh checkout with no `node_modules`, or after a lockfile change:

```bash
bun install --frozen-lockfile
```

Do not reinstall dependencies by default when the existing installation matches the lockfile. Add SDK dependencies through `bunx expo install <package>` so Expo selects compatible versions. Before changing Expo/React Native APIs, check the SDK-57 documentation required by [AGENTS.md](../AGENTS.md); do not assume an older SDK example still applies.

## Script Reference

| Command | Actual behavior |
| --- | --- |
| `bun run pdf:assets` | Generates the ignored local PDF.js support module from installed assets. |
| `bun run start` | Generates PDF assets and starts Expo/Metro. Does not compile or install native binaries. |
| `bun run android` | Generates PDF assets and runs `expo run:android`, building/launching the native Android app. |
| `bun run ios` | Runs the private local Release signing workflow and requests installation on its configured physical device. |
| `bun run ios:build` | Runs the same local signing workflow without installation. Requires the external signer. |
| `bun run build:ios:ci` | Builds an unsigned device IPA; deliberately restricted to macOS GitHub Actions. |
| `bun run web` | Generates PDF assets and starts the browser-mode development server. |
| `bun run build:web` | Generates PDF assets and exports the static renderer into `dist/web`. |
| `bun run desktop` | Rebuilds `dist/web`, then launches `electron desktop`. |
| `bun run desktop:build` | Runs `desktop/build.cjs`; packages an already exported renderer, not a fresh web build. |
| `bun run lint` | Runs Expo ESLint. |
| `bun run typecheck` | Regenerates PDF assets, then runs `tsc --noEmit`. It is not a read-only command. |
| `bun test` / `bun run test` | Runs the Bun tests. |
| `bun run reset-project` | Destructive starter reset: moves or deletes `src/` and `scripts/`, then creates a blank app. **Not a cache reset or troubleshooting step.** |

## Generated Files

`ios/` and `android/` are generated native projects and are ignored. Do not manually edit or commit them: put native settings in `app.json`, `app.config.ts` and config plugins. Clean prebuilds replace generated native changes. `dist/`, `.expo/` and `src/lib/pdf-assets.generated.ts` are also generated/ignored.

PDF.js CMaps, standard fonts, ICC profiles and WebAssembly decoders are bundled from installed packages so readers do not fetch them from a CDN at runtime. If invoking Expo CLI directly instead of a wrapper, first generate the local support module:

```bash
bun run pdf:assets
bunx expo export --platform web --output-dir dist/web
```

Regenerate assets after PDF.js/dependency changes as well. The normal `start`, `web`, `android`, iOS and web-build scripts already arrange asset generation; `typecheck` does too. The desktop packaging helper does not.

Metro already excludes the repository-root `dist/` tree in `metro.config.js`. Generated build bundles are not application source. Do not use the destructive `reset-project` script to address duplicate build-output discovery.

## Native Development

**Expo Go cannot load `react-native-pdf` and its native dependencies.** Use a native application build for the actual app, and a suitable device/build for notification/background behavior. A JavaScript bundle export does not prove that a native module renders correctly.

For Android development, use `bun run android` with an available SDK and device/emulator. The CI Release workflow separately generates Android and invokes Gradle with `scripts/android-unsigned.init.gradle`, which removes signing configurations, including the debug-key fallback. Its source output is `android/app/build/outputs/apk/release/app-release-unsigned.apk`; CI stages it as `dist/releases/SakaiClient-android-unsigned.apk`. There is no root `build:android` script.

The previously successful local Android Release build used arm64 and Gradle JVM settings `-Xmx4g -XX:MaxMetaspaceSize=1g`. An earlier 512 MiB attempt ran out of memory and a hung daemon required recovery. The workflow now carries those JVM limits, `--no-daemon` and `--max-workers=2`. This is historical build evidence, not a reason to rerun a broad build after every documentation or coordinator-only change.

### Local iOS Signing

`ios` and `ios:build` invoke `scripts/build-sign-ios.sh`. They compile a Release device app with its JavaScript bundle embedded, then use a **private external `FirmadorDeApps` installation**. The signer and its signing material are not distributed with this repository. A fresh clone alone cannot complete this workflow.

- `IOS_SIGNER_DIR` is required and points to the private signer directory.
- `IOS_DEVICE_ID` is required by `ios` and identifies the physical installation target.
- `dist/ios/SakaiClient-unsigned.ipa` is the unsigned local intermediate.
- `dist/ios/SakaiClient-signed.ipa` is the local signed output.
- Local derived data is under `dist/ios/derived-data`.

The local bundle identifier is fixed to `app.ursaminor7619.otter1161` for the existing signing setup. Installing this local build can replace another app using that identifier. Do not treat it as the public distribution identity or install it without understanding that conflict. Do not commit or publish the external signer's files, credentials or device-specific configuration.

`build:ios:ci` is a different path. It checks `GITHUB_ACTIONS=true`, macOS, root files and runner temporary storage, generates the native project and builds a generic Release device app without signing. It uses `dev.sakaiclient.unofficial` and outputs `dist/releases/SakaiClient-ios-unsigned.ipa`. Do not fake the guard to turn it into a local signing shortcut. It neither invokes nor reads the private signer.

The documented release workflow builds on GitHub runners; it does not submit to EAS, TestFlight, an app store or an OTA update channel. Any additional distribution flow needs its own authorized configuration and validation.

## Desktop Development

```bash
bun run desktop
```

This builds the web renderer and launches Electron. Electron serves it at `sakai-app://app/`, not a Metro HTTP URL. There is **no HMR**: re-export after renderer changes and reload/relaunch the shell. Starting `bun run web` exercises the ordinary read-only browser mode, not the privileged desktop bridge.

To package an unpacked application after renderer changes:

```bash
bun run build:web
node desktop/build.cjs --dir
```

The direct Node invocation avoids forwarding an extra literal `--`, which the helper rejects. The helper accepts only its declared options and always passes `--publish never`; see [desktop packaging](../desktop/INTEGRATION.md#packaging-and-validation-commands) for OS targets. Packaging uses the root-installed Electron version and writes `dist/desktop/`.

Windows NSIS and macOS DMG are unsigned; macOS is not notarized. Linux CI builds AppImage only. The optional local `--linux` default also requests deb, which still needs a real approved homepage and maintainer/contact metadata. No repository URL or contact has been invented. Never disable the Electron sandbox to work around a Linux launch failure.

## Source Map

| Path | Responsibility |
| --- | --- |
| `src/app/` | Expo Router routes; the active tabs are defined in `(tabs)/_layout.tsx`. Keep non-route modules outside this tree. |
| `src/providers/app-provider.tsx` | App lifecycle, committed index state, authentication, refresh, explicit scopes and root selection. |
| `src/lib/sakai-client.ts` | Institutional login, permitted redirect handling, metadata/resource discovery and downloads. |
| `src/lib/sync-engine.ts`, `paths.ts`, `resource-tree.ts`, `document-availability.ts` | Explicit download boundaries, per-file timeout/progress, physical availability, safe paths and tree completion. |
| `src/lib/relocate-documents.ts`, `files.native.ts`, `files.web.ts` | Relocation coordination and platform filesystem adapters. |
| `src/lib/storage.ts`, `courses.ts`, `credentials.*`, `data-transfer.*` | Serialized schema-v3 index mutations, course preferences/order, separate secrets and JSON transfer. |
| `src/lib/background-sync.*`, `notifications.*` | Metadata-only polling and opt-in announcement/download-completion alerts. |
| `src/components/pdf-reader*`, `src/lib/document-reader.ts`, `document-files.*` | Platform PDF rendering and bounded local text/Office reading. |
| `desktop/` | Main process, preload, request policy, capability storage, local protocol and packaging. |
| `scripts/`, `.github/workflows/ci.yml` | PDF asset generation, local/CI native builds, version metadata, asset preparation and CI orchestration. |
| `tests/` | Unit/regression tests, including CI helpers and desktop policy. Not all-device integration validation. |

## Validation Workflow

For source changes, normally build web before validation when renderer assets changed, then use the existing checks:

```bash
bun test
bun run lint
bun run typecheck
```

`bunx expo-doctor` is a separate dependency/configuration diagnostic, not proof of runtime behavior. For isolated logic changes, choose focused regression files first rather than repeating all native and desktop builds. The executed relocation checks and their limits are recorded separately from earlier full-suite results in [VALIDATION.md](VALIDATION.md).

Do not claim a build passed because an old artifact exists. Do not claim a phone interaction passed because a native build succeeded. Logs, reports, generated artifacts, private exports and credentials do not belong in source commits.
