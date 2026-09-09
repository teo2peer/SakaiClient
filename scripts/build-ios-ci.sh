#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_ACTIONS:-}" != 'true' || "$(uname -s)" != 'Darwin' ]]; then
  printf '%s\n' 'This unsigned iOS script is only for macOS GitHub Actions runners.' >&2
  exit 1
fi

if [[ ! -f app.config.ts || ! -f package.json || ! -d "${RUNNER_TEMP:-}" ]]; then
  printf '%s\n' 'Run from the repository root with app.config.ts and RUNNER_TEMP available.' >&2
  exit 1
fi

: "${BUILD_VERSION:?BUILD_VERSION must contain the validated native version}"
: "${BUILD_NUMBER:?BUILD_NUMBER must contain the validated CI run number}"

export CI=1
export EXPO_NO_DOTENV=1
export IOS_BUNDLE_IDENTIFIER=dev.sakaiclient.unofficial
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode_26.6.app/Contents/Developer}"
export NODE_BINARY
NODE_BINARY="$(command -v node)"
export RCT_NO_LAUNCH_PACKAGER=1
export COPYFILE_DISABLE=1
unset SKIP_BUNDLING

test -d "$DEVELOPER_DIR"
xcodebuild -version

ROOT_DIR="$(pwd -P)"
OUTPUT="$ROOT_DIR/dist/releases/SakaiClient-ios-unsigned.ipa"
if [[ -e "$OUTPUT" ]]; then
  printf '%s\n' 'Refusing to replace an existing IPA; use a fresh CI checkout.' >&2
  exit 1
fi

BUILD_DIR="$(mktemp -d "$RUNNER_TEMP/sakaiclient-ios.XXXXXX")"
trap 'rm -rf -- "$BUILD_DIR"' EXIT

bun run pdf:assets
bunx expo prebuild --platform ios --clean --no-install
pod install --project-directory=ios

xcodebuild build \
  -workspace "$ROOT_DIR/ios/SakaiClient.xcworkspace" \
  -scheme SakaiClient \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY= \
  DEVELOPMENT_TEAM=

APP_PATH="$BUILD_DIR/DerivedData/Build/Products/Release-iphoneos/SakaiClient.app"
test -s "$APP_PATH/main.jsbundle"
test ! -e "$APP_PATH/embedded.mobileprovision"
test ! -e "$APP_PATH/_CodeSignature"
if [[ "$(/usr/bin/plutil -extract CFBundleIdentifier raw -o - "$APP_PATH/Info.plist")" != "$IOS_BUNDLE_IDENTIFIER" ]]; then
  printf '%s\n' 'The generated app did not use the public CI bundle identifier.' >&2
  exit 1
fi

mkdir -p "$BUILD_DIR/Payload" "$ROOT_DIR/dist/releases"
/usr/bin/ditto --norsrc --noextattr --noacl "$APP_PATH" "$BUILD_DIR/Payload/SakaiClient.app"
/usr/bin/ditto -c -k --norsrc --noextattr --noacl --keepParent "$BUILD_DIR/Payload" "$OUTPUT"
test -s "$OUTPUT"
printf 'Unsigned IPA: %s\n' "$OUTPUT"
