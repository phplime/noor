#!/usr/bin/env bash
# One-time setup for running Noor on an iPhone (or the Simulator).
#   cd ~/Herd/noor && bash scripts/ios-setup.sh
# Safe to run again: every step checks whether it's already done.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

say() { printf '\n\033[1;33m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

say "Checking Xcode"
xcode-select -p | grep -q "Xcode.app" || die "Full Xcode is required. Install it from the App Store, then run:
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
xcrun --sdk iphoneos --show-sdk-path >/dev/null || die "The iOS SDK is missing — open Xcode once and install the iOS platform (Xcode › Settings › Components)."

say "Checking Rust + iOS targets"
command -v cargo >/dev/null || die "Rust is missing: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
rustup target add aarch64-apple-ios aarch64-apple-ios-sim >/dev/null

say "Checking Node.js"
command -v npm >/dev/null || die "Node.js 20+ is missing (brew install node)."

say "Installing JavaScript packages"
npm install

if [ ! -d src-tauri/gen/apple ]; then
  say "Creating the Xcode project (tauri ios init)"
  npx tauri ios init
fi

# MacKit's image engine links a small Swift library (Apple Vision, used by Remove
# Background). MacKit's Xcode project already has the settings that needs, so reuse
# them — renamed for Noor — when MacKit's generated project is present.
MK="$ROOT/../mackit/src-tauri/gen/apple/project.yml"
NY="$ROOT/src-tauri/gen/apple/project.yml"
if [ -f "$MK" ] && [ -f "$NY" ] && ! grep -q "ALWAYS_EMBED_SWIFT_STANDARD_LIBRARIES" "$NY"; then
  say "Applying MacKit's proven Xcode settings (Swift runtime, PATH for Herd/nvm, no script sandbox)"
  cp "$NY" "$NY.orig"
  sed -e 's/mackit_iOS/noor_iOS/g' \
      -e 's/dev\.mackit\.desktop/dev.nazmul.noor/g' \
      -e 's/PRODUCT_NAME: MacKit/PRODUCT_NAME: Noor/' \
      -e 's/^name: mackit$/name: noor/' \
      -e 's/MacKit opens the photos you choose so you can edit them on your device\./Noor opens the photos you choose so you can edit them on your iPhone./' \
      -e 's/MacKit can save edited photos to your library\./Noor can save edited photos to your library./' \
      -e 's/Documents\/MacKit/Documents\/Noor/; s/On My iPhone › MacKit/On My iPhone › Noor/' \
      "$MK" > "$NY"
  if [ -d "$ROOT/src-tauri/gen/apple/noor_iOS" ]; then
    (cd "$ROOT/src-tauri/gen/apple" && command -v xcodegen >/dev/null && xcodegen generate) || echo "  (xcodegen not found — tauri regenerates the project on the next ios dev)"
  else
    echo "  Project layout differs from MacKit's — keeping the generated project ($NY.orig restored)."
    mv "$NY.orig" "$NY"
  fi
fi

say "Generating app icons"
npx tauri icon app-icon.png >/dev/null

cat <<'MSG'

✅ Ready.

  Simulator:  npm run ios:sim             (or: npx tauri ios dev "iPhone 16 Pro")
  iPhone:     plug it in, unlock it, then  npm run ios:dev
              First time only: Xcode › Settings › Accounts › add your Apple ID,
              and on the iPhone: Settings › Privacy & Security › Developer Mode › On.
              Then trust the developer: Settings › General › VPN & Device Management.
  Release:    npm run ios:build

On first launch, tap "Allow notifications" — prayer times, water, timer and your
reminders then ring with sound even when Noor is closed.
MSG
