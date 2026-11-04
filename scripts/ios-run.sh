#!/usr/bin/env bash
# Runs a Tauri iOS command after making sure the machine is ready.
#   bash scripts/ios-run.sh dev "iPhone 16 Pro"    # Simulator
#   bash scripts/ios-run.sh dev                    # connected iPhone
#   bash scripts/ios-run.sh build                  # release .ipa
set -euo pipefail
cd "$(dirname "$0")/.."

red()  { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; }
step() { printf '\033[1;33m▸ %s\033[0m\n' "$*"; }

# 1) Full Xcode (not just the Command Line Tools) — needed for the Simulator, signing and `tauri ios init`.
XCODE_APP="$(ls -d /Applications/Xcode*.app 2>/dev/null | head -n1 || true)"
if [ -z "$XCODE_APP" ]; then
  red "Xcode is not installed."
  cat <<'MSG'
  iOS apps can only be built with Xcode (free, Mac App Store, ~3 GB download / ~12 GB installed).
    1. Install it:   open "macappstore://apps.apple.com/app/xcode/id497799835"
    2. Open Xcode once and accept the licence; when asked, install the iOS platform
       (or: Xcode › Settings › Components / Platforms › iOS).
    3. Run this command again.
MSG
  exit 1
fi

if ! xcode-select -p 2>/dev/null | grep -q "Xcode.*\.app"; then
  step "Selecting $XCODE_APP (needs your Mac password once)"
  sudo xcode-select -s "$XCODE_APP/Contents/Developer"
fi
if ! xcrun simctl help >/dev/null 2>&1; then
  step "Finishing Xcode's first-run setup"
  sudo xcodebuild -runFirstLaunch || true
  sudo xcodebuild -license accept || true
fi
xcrun --sdk iphoneos --show-sdk-path >/dev/null 2>&1 || {
  red "The iOS platform is not installed in Xcode."
  echo "  Xcode › Settings › Components (or Platforms) › install iOS, then run this again."
  exit 1
}

# 2) Rust iOS targets + JS packages
command -v cargo >/dev/null || { red "Rust is missing: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"; exit 1; }
rustup target add aarch64-apple-ios aarch64-apple-ios-sim >/dev/null
step "Checking JavaScript packages"; npm install --no-audit --no-fund --loglevel=error

# 3) Xcode project (once)
if [ ! -d src-tauri/gen/apple ]; then
  bash scripts/ios-setup.sh
fi

# 4) Go
case "${1:-dev}" in
  dev)   shift || true; exec npx tauri ios dev "$@" ;;
  build) shift || true; exec npx tauri ios build "$@" ;;
  *)     exec npx tauri ios "$@" ;;
esac
