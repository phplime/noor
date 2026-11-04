#!/bin/zsh
# Build the files for a GitHub Release into ./release/
#   Android: signed APK (needs src-tauri/gen/android/keystore.properties — never commit it)
#   iPhone:  IPA for sideloading with AltStore / SideStore / Sideloadly
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
cd "$(dirname "$0")"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
OUT="$PWD/release"
LOG="$PWD/build-release.log"
mkdir -p "$OUT"
{
  echo "=== Noor v$VERSION — start $(date)"
  npm install --no-audit --no-fund &&
  echo "--- Android APK" &&
  npm run tauri android build -- --apk --target aarch64 &&
  cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk "$OUT/Noor-v$VERSION-android.apk" &&
  echo "--- iPhone IPA" &&
  (cd src-tauri/gen/apple && xcodegen generate) &&
  npm run tauri ios build -- --export-method debugging &&
  cp src-tauri/gen/apple/build/arm64/Noor.ipa "$OUT/Noor-v$VERSION-iphone.ipa" &&
  (cd "$OUT" && shasum -a 256 Noor-v$VERSION-* > SHA256SUMS.txt)
  echo "=== exit $? $(date)"
  ls -lh "$OUT"
} 2>&1 | tee "$LOG"
