# Installation

[Documentation index](README.md#documentation) | [Usage](docs/USAGE.md) | [Unsigned release notice](.github/UNSIGNED-RELEASE.md) | [Development](docs/DEVELOPMENT.md)

Sakai Client releases are available from the [GitHub Releases page](https://github.com/teo2peer/SakaiClient/releases). They are independent, unofficial builds and are not distributed through Microsoft Store, the Mac App Store, Google Play, App Store or TestFlight.

The desktop packages are not code-signed, the macOS packages are not notarized, and the Android and iOS packages are unsigned. Read the platform section before downloading: the mobile packages require your own signing credentials and cannot be installed merely by accepting an operating-system warning.

## Contents

| Section | What it covers |
| --- | --- |
| [Choose an Asset](#choose-an-asset) | Select the correct release file for the device and architecture |
| [Verify the Download](#verify-the-download) | Compare the release SHA-256 checksum before installation |
| [Windows](#windows) | Installer, SmartScreen, file unblocking and common errors |
| [macOS](#macos) | DMG installation, Gatekeeper, quarantine and `xattr` |
| [Linux](#linux) | AppImage permissions, FUSE and architecture errors |
| [Android](#android) | APK signing, unknown-source permission, Play Protect and updates |
| [iPhone and iPad](#iphone-and-ipad) | IPA signing, Feather, provisioning, trust and Developer Mode |
| [Web Viewer](#web-viewer) | Local HTTP server and browser-mode limitations |
| [After Installation](#after-installation) | Usage documentation, updates and source builds |

## Choose an Asset

The current `v1.0.0` release contains:

| Platform | Asset | Can be installed as downloaded? |
| --- | --- | --- |
| Windows 10/11 x64 | `SakaiClient-1.0.0-win-x64.exe` | Yes, after reviewing the unsigned-publisher warning |
| Apple silicon Mac | `SakaiClient-1.0.0-mac-arm64.dmg` | Yes, after explicitly approving the unnotarized app |
| Intel Mac | `SakaiClient-1.0.0-mac-x64.dmg` | Yes, after explicitly approving the unnotarized app |
| Linux x86_64 | `SakaiClient-1.0.0-linux-x86_64.AppImage` | Yes, after making the AppImage executable |
| Android | `SakaiClient-android-unsigned.apk` | No; sign it first with your own key |
| iPhone/iPad | `SakaiClient-ios-unsigned.ipa` | No; sign and provision it first |
| Browser | `SakaiClient-web.zip` | Yes, but only as a read-only local import viewer |

Replace `1.0.0` in the examples when installing a newer release. Windows and Linux releases are x64-only. On macOS, run `uname -m`: `arm64` means Apple silicon and `x86_64` means Intel.

## Verify the Download

Download `SHA256SUMS.txt` from the same release as the selected asset. A checksum confirms that the downloaded bytes match the published release asset; it does not establish the identity of an unsigned publisher.

On Windows PowerShell:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\SakaiClient-1.0.0-win-x64.exe
Get-Content .\SHA256SUMS.txt
```

On macOS:

```bash
shasum -a 256 SakaiClient-1.0.0-mac-arm64.dmg
grep 'SakaiClient-1.0.0-mac-arm64.dmg' SHA256SUMS.txt
```

On Linux:

```bash
sha256sum SakaiClient-1.0.0-linux-x86_64.AppImage
grep 'SakaiClient-1.0.0-linux-x86_64.AppImage' SHA256SUMS.txt
```

The calculated and published hexadecimal values must be identical. Stop if they differ: delete the file and download it again from the official release page. Do not bypass an OS warning for a file whose checksum does not match.

## Windows

1. Download the x64 `.exe` and verify its checksum.
2. Double-click the installer.
3. Select the installation directory in the setup wizard and finish the installation.
4. Launch **Sakai Client** from the Start menu or the selected directory.

### Microsoft Defender SmartScreen

The installer has no Authenticode signature, so SmartScreen can display **Windows protected your PC** or identify the publisher as unknown. After verifying the SHA-256 checksum:

1. Select **More info** in the SmartScreen dialog.
2. Confirm that the file name is the release asset you verified.
3. Select **Run anyway**.

If Windows marked the downloaded file as blocked but does not show that action:

1. Right-click the `.exe`, select **Properties**, and open the **General** tab.
2. If an **Unblock** checkbox appears, enable it, select **Apply**, and run the installer again.

The equivalent targeted PowerShell command is:

```powershell
Unblock-File -LiteralPath .\SakaiClient-1.0.0-win-x64.exe
```

Run it only for the asset whose checksum you verified. Do not disable SmartScreen globally. This diagnostic command is expected to report `NotSigned` for this release:

```powershell
Get-AuthenticodeSignature -LiteralPath .\SakaiClient-1.0.0-win-x64.exe
```

### Windows Troubleshooting

| Symptom | Resolution |
| --- | --- |
| **Run anyway** is unavailable | Verify the checksum, use the file's **Properties > Unblock** option if present, or use the targeted `Unblock-File` command above. A managed PC can prohibit exceptions; contact its administrator instead of disabling security controls. |
| Windows is in S mode | S mode permits Microsoft Store applications only. Use another supported device or make an informed decision using Microsoft's official S-mode instructions; switching out is one-way. |
| Antivirus quarantines the installer | Confirm the release URL and checksum, update the scanner, and submit the public file as a possible false positive. Do not turn antivirus protection off to install it. |
| A different architecture is required | The published Windows build is x64-only. Build from source for another supported target; see [Development](docs/DEVELOPMENT.md). |
| Remembered credentials fail | Configure the Windows credential encryption/keyring or disable **remember credentials**. The app deliberately refuses plaintext password storage. |

See Microsoft's [Defender SmartScreen documentation](https://learn.microsoft.com/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/) for the purpose and administration of these checks.

## macOS

1. Download the `arm64` DMG for Apple silicon or the `x64` DMG for an Intel Mac.
2. Verify its checksum.
3. Open the DMG and drag **Sakai Client** to **Applications**.
4. In Finder, Control-click **Sakai Client** and select **Open**.
5. Review the warning and select **Open** again when macOS offers that choice.

If macOS does not offer **Open**, first try to launch the app once. Then open **System Settings > Privacy & Security**, find the message that Sakai Client was blocked, select **Open Anyway**, authenticate, and confirm. macOS shows this exception only after a blocked launch attempt and may remove it after a limited time.

### Quarantine and `xattr`

Use Finder or **Open Anyway** first. If Gatekeeper still reports that the verified app cannot be opened, inspect its quarantine attribute:

```bash
xattr -p com.apple.quarantine "/Applications/Sakai Client.app"
```

After verifying the DMG checksum and confirming that the app came from this project's release page, remove quarantine only from this application bundle and launch it:

```bash
xattr -dr com.apple.quarantine "/Applications/Sakai Client.app"
open "/Applications/Sakai Client.app"
```

Adjust the path if the app was installed elsewhere. `xattr` reporting that the attribute does not exist means there is no quarantine attribute to remove. Do not run a broad command against `/Applications`, your home directory or the whole disk, and do not disable Gatekeeper with `spctl --master-disable`.

### macOS Troubleshooting

| Symptom | Resolution |
| --- | --- |
| **Apple could not verify...** or **developer cannot be verified** | Use Control-click **Open** or **Privacy & Security > Open Anyway** after checksum verification. This warning is expected because the DMG is not signed or notarized. |
| App is reported as damaged | Check the DMG checksum first. Redownload on mismatch. If it matches, copy the app to `/Applications` and use the targeted quarantine procedure above. |
| App cannot run on this Mac | Confirm `uname -m` and use `arm64` for Apple silicon or `x64` for Intel. Do not use the iOS IPA on macOS. |
| App is repeatedly launched from the DMG | Drag it to **Applications**, eject the DMG, and launch the installed copy. |
| A managed Mac blocks the exception | Ask its administrator to review the package. Do not remove management profiles or globally weaken Gatekeeper. |

Apple documents the supported exception flow in [Safely open apps on your Mac](https://support.apple.com/en-us/102445).

## Linux

The published AppImage targets x86_64. Confirm the architecture with `uname -m`; an ARM device needs a source build for its architecture.

```bash
chmod +x SakaiClient-1.0.0-linux-x86_64.AppImage
./SakaiClient-1.0.0-linux-x86_64.AppImage
```

You can keep the file in a user-owned location such as `~/Applications`. No Debian, RPM or system-wide package is currently published.

### Linux Troubleshooting

| Symptom | Resolution |
| --- | --- |
| `Permission denied` | Run `chmod +x` and make sure the file is on a filesystem mounted with execution allowed. Moving it to a user-owned local directory can avoid a removable drive mounted with `noexec`. |
| FUSE library or mount error | Install the FUSE compatibility package appropriate to the distribution, or use `./SakaiClient-1.0.0-linux-x86_64.AppImage --appimage-extract-and-run`. |
| Wrong executable format | The release is x86_64-only. Check `uname -m`; do not attempt to run it on ARM as if it were a native ARM binary. |
| Chromium sandbox error | Do not run the app as root and do not use `--no-sandbox`. Correct the local AppImage/FUSE or filesystem configuration instead. |

The AppImage is not cryptographically signed. Verify `SHA256SUMS.txt` whenever it is downloaded or transferred.

## Android

`SakaiClient-android-unsigned.apk` is deliberately unsigned. Android will reject it even if **Install unknown apps** is enabled. You must first sign it with a key that you control.

### Sign the APK

Install a JDK and the Android SDK Build Tools. Set `BUILD_TOOLS` below to the installed Build Tools directory containing `zipalign` and `apksigner`.

Create and securely retain a release keystore:

```bash
keytool -genkeypair -v \
  -keystore sakaiclient-release.jks \
  -storetype PKCS12 \
  -alias sakaiclient \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Align, sign and verify the APK:

```bash
export BUILD_TOOLS="$ANDROID_HOME/build-tools/<installed-version>"

"$BUILD_TOOLS/zipalign" -P 16 -f -v 4 \
  SakaiClient-android-unsigned.apk \
  SakaiClient-android-aligned.apk

"$BUILD_TOOLS/apksigner" sign \
  --ks sakaiclient-release.jks \
  --ks-key-alias sakaiclient \
  --out SakaiClient-android-signed.apk \
  SakaiClient-android-aligned.apk

"$BUILD_TOOLS/apksigner" verify --verbose --print-certs \
  SakaiClient-android-signed.apk
```

On Windows, invoke `zipalign.exe` and `apksigner.bat` from the corresponding Build Tools directory. Keep the keystore and its passwords private and backed up: Android updates must be signed with the same key. Do not commit or upload signing material to this repository.

### Install the Signed APK

1. Transfer `SakaiClient-android-signed.apk` to the Android device.
2. Open it from the browser or file manager used for the transfer.
3. If prompted, open settings for that source and enable **Allow from this source** under **Install unknown apps**.
4. Return to the installer, install the app, and disable that source permission afterward if it is no longer needed.

Menu names vary by manufacturer and Android version. Grant the exception only to the browser or file manager used for this verified APK. Leave Google Play Protect enabled.

With Android platform tools and USB debugging already configured, installation can instead be requested with:

```bash
adb install -r SakaiClient-android-signed.apk
```

### Android Troubleshooting

| Symptom | Resolution |
| --- | --- |
| **There was a problem parsing the package** | Make sure you installed the signed output, not `SakaiClient-android-unsigned.apk`. Recheck the release checksum and run `apksigner verify`. |
| **App not installed** or incompatible signature | An installed app with package ID `dev.sakaiclient.unofficial` may use another signing key. Sign with that original key or uninstall the existing app first. Uninstalling deletes its app-private data, so export or back up authorized local data first. |
| Unknown-source permission is blocked | Use the per-source **Install unknown apps** setting. A managed device can prohibit sideloading; contact its administrator rather than bypassing policy. |
| Play Protect warns | Reconfirm the source, checksum and signing certificate. Keep Play Protect enabled and cancel if the file or certificate is not the one you expect. |
| Updates fail | Sign every update with the same keystore and package ID. Losing the key requires uninstalling the previous app before installing a differently signed build. |

See Android's official [`apksigner` documentation](https://developer.android.com/tools/apksigner) and [Google Play Protect guidance](https://support.google.com/android/answer/2812853).

## iPhone and iPad

`SakaiClient-ios-unsigned.ipa` is an unsigned physical-device archive, not an App Store, TestFlight or simulator package. It cannot be installed by opening the downloaded file. It must be signed with an Apple certificate and a provisioning profile valid for the target device.

This project does not provide certificates, private keys, provisioning profiles, Apple accounts or registered device identifiers. Obtain and use signing material only through an Apple developer setup you control and are authorized to use.

### Sign with Feather

[Feather](https://github.com/claration/Feather) is an independent, open-source on-device signing tool. Installing and trusting Feather itself is a separate prerequisite; follow its [official site](https://feather.claration.dev) and repository instructions rather than a repackaged copy.

The exact labels can change between Feather releases, but the required flow is:

1. Download the unsigned Sakai Client IPA and verify its SHA-256 checksum before transferring it to the device.
2. In Feather, import a signing certificate with its private key, normally a password-protected `.p12`, and the matching `.mobileprovision` profile.
3. Import `SakaiClient-ios-unsigned.ipa` into Feather's application library.
4. Confirm that the bundle identifier is covered by the provisioning profile. The public unsigned IPA uses `dev.sakaiclient.unofficial`; if the profile does not cover it, use Feather's identifier option to select a unique App ID that the profile does cover.
5. Sign the imported application and review Feather's verification/result details.
6. Request installation of the signed result and approve the iOS installation prompts.

Do not reuse the repository's private local-development identifier `app.ursaminor7619.otter1161`; it belongs to a separate, undistributed signing workflow.

Depending on the certificate/profile type and iOS version, the device can also require:

1. **Settings > General > VPN & Device Management**: trust only the developer identity you expect, if it appears there.
2. **Settings > Privacy & Security > Developer Mode**: enable it, restart when requested, and confirm after restart.

Do not install unknown management profiles, trust an unexpected organization, or send a certificate/private key to an untrusted signing service.

### iOS Troubleshooting

| Symptom | Resolution |
| --- | --- |
| **Unable to verify app integrity** | The IPA is still unsigned, the certificate/profile pair is invalid, the profile or certificate expired or was revoked, or the device is not included. Correct the signing setup and sign again. |
| **Unable to install** or application verification failed | Check that the bundle ID is allowed by the profile, the certificate matches it, required devices are registered, and the profile is valid for a device build. Remove a conflicting prior installation only after preserving needed local data. |
| **Untrusted Developer** | Trust only your expected developer identity under **VPN & Device Management**. If no expected identity is present, fix the signing configuration instead of trusting unrelated profiles. |
| Developer Mode is required | Enable **Developer Mode** under **Privacy & Security**, restart, confirm, and retry the signed app. Managed devices can prohibit this. |
| App stops opening after previously working | Check certificate/profile expiration or revocation and sign/install it again with valid material. Local sideloaded installations are not maintained by this project's release workflow. |
| Feather cannot install itself | Resolve Feather's own signing/installation prerequisite using its official documentation. The unsigned Sakai Client IPA cannot bootstrap Feather. |

Apple documents manual trust behavior for applicable organization-distributed apps in [Install custom enterprise apps on iOS](https://support.apple.com/en-us/118254). Only trust an identity that belongs to your own expected signing setup.

## Web Viewer

The web ZIP is a static, read-only import viewer. It cannot authenticate to PoliformaT because the institutional service does not permit this independent browser origin through CORS, and an imported JSON index does not contain another device's downloaded document bytes.

Serve the files over local HTTP instead of opening `index.html` through a `file://` URL:

```bash
mkdir SakaiClient-web
unzip SakaiClient-web.zip -d SakaiClient-web
python3 -m http.server 8080 --directory SakaiClient-web
```

Then open `http://localhost:8080`. Stop the server with Control-C. If port `8080` is occupied, choose another unused local port.

Do not publish an imported index without reviewing it. Exports exclude authentication secrets but can contain names, announcements, local paths, and personal or copyrighted course metadata.

## After Installation

Read [Usage](docs/USAGE.md) before choosing storage, signing in, importing data or enabling notifications. The app can indicate when a newer stable GitHub Release is available, but there is no automatic update channel: review each new release, verify its checksum, and repeat the applicable installation or signing process.

For source builds and development prerequisites, use [Development](docs/DEVELOPMENT.md). Build success alone does not prove that signing, installation, folder providers, notifications or native rendering work on every device.
