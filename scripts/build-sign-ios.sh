#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SIGNER_DIR="${IOS_SIGNER_DIR:-}"
SIGNER_SCRIPT="$SIGNER_DIR/sign-app.sh"
DEVICE_ID="${IOS_DEVICE_ID:-}"
SCHEME="SakaiClient"
DERIVED_DATA="$PROJECT_ROOT/dist/ios/derived-data"
UNSIGNED_APP="$DERIVED_DATA/Build/Products/Release-iphoneos/$SCHEME.app"
PACKAGE_ROOT="$DERIVED_DATA/unsigned-package"
UNSIGNED_IPA="$PROJECT_ROOT/dist/ios/$SCHEME-unsigned.ipa"
SIGNED_IPA="$PROJECT_ROOT/dist/ios/$SCHEME-signed.ipa"
INSTALL=0
SKIP_BUILD=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install) INSTALL=1 ;;
    --skip-build) SKIP_BUILD=1 ;;
    *)
      printf 'Usage: %s [--install] [--skip-build]\n' "$0" >&2
      exit 1
      ;;
  esac
  shift
done

if [ -z "$SIGNER_DIR" ]; then
  printf 'IOS_SIGNER_DIR is required and must point to the private signing utility.\n' >&2
  exit 1
fi

if [ "$INSTALL" -eq 1 ] && [ -z "$DEVICE_ID" ]; then
  printf 'IOS_DEVICE_ID is required when installing on a physical device.\n' >&2
  exit 1
fi

if [ ! -x "$SIGNER_SCRIPT" ]; then
  printf 'Signing utility not found or not executable: %s\n' "$SIGNER_SCRIPT" >&2
  exit 1
fi

if [ "$SKIP_BUILD" -eq 0 ]; then
  bun "$PROJECT_ROOT/scripts/generate-pdf-assets.mjs"
  /bin/rm -rf "$UNSIGNED_APP/www.bundle"
  bunx expo prebuild --platform ios

  xcodebuild \
    -workspace "$PROJECT_ROOT/ios/SakaiClient.xcworkspace" \
    -scheme "$SCHEME" \
    -configuration Release \
    -destination 'generic/platform=iOS' \
    -derivedDataPath "$DERIVED_DATA" \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    "CODE_SIGN_IDENTITY=" \
    build
fi

if [ ! -f "$UNSIGNED_APP/main.jsbundle" ]; then
  printf 'Release JavaScript bundle not found: %s/main.jsbundle\n' "$UNSIGNED_APP" >&2
  exit 1
fi

/bin/rm -rf "$PACKAGE_ROOT"
/bin/rm -f "$UNSIGNED_IPA" "$SIGNED_IPA"
/bin/mkdir -p "$PACKAGE_ROOT/Payload"
/usr/bin/ditto --norsrc --noextattr --noqtn --noacl "$UNSIGNED_APP" "$PACKAGE_ROOT/Payload/$SCHEME.app"
/usr/bin/ditto -c -k --norsrc --noextattr --noqtn --noacl --keepParent "$PACKAGE_ROOT/Payload" "$UNSIGNED_IPA"

SIGN_ARGS=(-o "$SIGNED_IPA")
if [ "$INSTALL" -eq 1 ]; then
  SIGN_ARGS+=(--install -D "$DEVICE_ID")
fi
SIGN_ARGS+=("$UNSIGNED_IPA")

(
  cd "$SIGNER_DIR"
  bash "$SIGNER_SCRIPT" "${SIGN_ARGS[@]}"
)

printf 'Signed IPA: %s\n' "$SIGNED_IPA"
