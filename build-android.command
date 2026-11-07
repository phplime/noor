#!/bin/zsh
# Build the signed Android APK into ./release/ (and install it if a phone is connected with USB debugging).
# Needs src-tauri/gen/android/keystore.properties — never commit it.   Log: build-android.log
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"
setopt pipefail
cd "$(dirname "$0")"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
APK="release/Noor-v$VERSION-android.apk"
mkdir -p release
{
  print "=== Noor v$VERSION — Android build — $(date)"
  [[ -f src-tauri/gen/android/keystore.properties ]] || { print "✖ Missing src-tauri/gen/android/keystore.properties (signing key settings)."; exit 1; }
  npm run tauri android build -- --apk --target aarch64 &&
  cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk "$APK" || { print "✖ Android build failed"; exit 1; }
  if [[ -z "$NOOR_NO_INSTALL" ]] && command -v adb >/dev/null && adb get-state >/dev/null 2>&1; then
    adb install -r "$APK" && print "✔ Installed on the connected Android phone"
  fi
  print "✔ $APK"
  print "=== exit 0 $(date)"
} 2>&1 | tee build-android.log
CODE=$?
[[ -z "$NOOR_CHILD" ]] && { print "\nPress Return to close."; read; }
exit $CODE
