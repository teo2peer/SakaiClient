## Unsigned Build Notice

These are unsigned CI builds of an unofficial Sakai/PoliformaT client, not store releases.

The project is independent and is not affiliated with or endorsed by UPV, PoliformaT, the Sakai project or the Apereo Foundation. Use only accounts and resources you are authorized to access; the official institutional platform remains authoritative.

- Android: the release APK is deliberately unsigned, never signed with the debug key. It requires your own signing process before installation.
- iOS: the device IPA is deliberately unsigned and uses `dev.sakaiclient.unofficial`. It requires appropriate signing and provisioning before installation; it is not a simulator or App Store package.
- Windows: the installer is not code-signed; Windows SmartScreen may warn or block it.
- macOS: the DMGs are not code-signed or notarized; Gatekeeper may block them.
- Linux: the x64 AppImage is not signed. No Debian package is included.
- Web: the ZIP contains a static read-only import viewer, not a desktop application or an authenticated browser client. Serve it from a suitable web server. JSON indexes do not contain another device's document bytes.

`SHA256SUMS.txt` contains the SHA-256 digest of every attached distributable. Checksums detect changed downloads; they are not a code-signing signature.

No App Store, TestFlight, Play Store, hosted-web deployment or automatic-update channel is configured by this workflow. Packaging success does not establish installation, native picker/move behavior or all-device runtime validation. Signing and target-platform testing remain the distributor's responsibility; do not disable platform security protections as an installation workaround.

The unsigned CI IPA uses a different identity from the private local signing workflow. It contains no private local signing material. Course indexes, downloaded files and JSON exports may contain personal or copyrighted information even though generated exports exclude authentication secrets. Signing out does not erase these local files or indexes, and account switching does not partition them by user.
