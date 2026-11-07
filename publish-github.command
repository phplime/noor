#!/bin/zsh
# One click: new version → build Android APK + iPhone IPA → commit, tag, push → GitHub Release with
# both files and install instructions.   Log: publish-github.log
#
# Version: if the current version already has a release tag, the patch number goes up (0.1.0 → 0.1.1)
# in package.json, tauri.conf.json, Cargo.toml and project.yml. If a build fails, the version is put back
# and nothing is pushed. First run: installs the GitHub CLI (gh) and asks you to sign in once.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"
setopt pipefail
cd "$(dirname "$0")"
ROOT="$PWD"
REPO="phplime/noor"
VFILES=(package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/gen/apple/project.yml)
BAK=/tmp/noor-vbak; BUMPED=""

step() { print -P "\n%F{green}▶ $1%f"; }
restore_version() { [[ -n "$BUMPED" ]] || return; for f in $VFILES; do cp "$BAK/${f//\//_}" "$f"; done; print "Version change undone (still v$OLD)."; }
fail() { print -P "\n%F{red}✖ $1%f"; restore_version; print "=== exit 1 $(date)"; exit 1; }

{
  print "=== publish start $(date)"
  rm -f noor-v*.tgz 2>/dev/null

  step "Checking GitHub sign-in"
  if ! command -v gh >/dev/null; then
    command -v brew >/dev/null || fail "Homebrew is missing. Install it from https://brew.sh, then run this again."
    brew install gh || fail "Could not install the GitHub CLI (gh)."
  fi
  if ! gh auth status -h github.com >/dev/null 2>&1; then
    print "Sign in to GitHub in the browser window that opens (one time only)…"
    gh auth login -h github.com -p https -w </dev/tty >/dev/tty 2>&1 || fail "GitHub sign-in did not finish."
  fi
  gh auth setup-git >/dev/null 2>&1

  OLD=$(node -p "require('./src-tauri/tauri.conf.json').version")
  git fetch --tags -q origin 2>/dev/null
  if git rev-parse -q --verify "refs/tags/v$OLD" >/dev/null; then
    NEW=$(node -e "const [a,b,c]=process.argv[1].split('.').map(Number);console.log([a,b,c+1].join('.'))" "$OLD")
    step "New version v$NEW (was v$OLD)"
    mkdir -p $BAK; for f in $VFILES; do cp "$f" "$BAK/${f//\//_}"; done; BUMPED=1
    node -e '
      const fs=require("fs"),n=process.argv[1];
      for (const f of ["package.json","src-tauri/tauri.conf.json"]) {
        const j=JSON.parse(fs.readFileSync(f,"utf8")); j.version=n; fs.writeFileSync(f, JSON.stringify(j,null,2)+"\n");
      }
      const c="src-tauri/Cargo.toml"; fs.writeFileSync(c, fs.readFileSync(c,"utf8").replace(/^version = "[^"]*"/m, `version = "${n}"`));
      const y="src-tauri/gen/apple/project.yml";
      fs.writeFileSync(y, fs.readFileSync(y,"utf8")
        .replace(/CFBundleShortVersionString: .*/g, `CFBundleShortVersionString: ${n}`)
        .replace(/CFBundleVersion: .*/g, `CFBundleVersion: "${n}"`));
    ' "$NEW" || fail "Could not update the version number."
  else
    NEW=$OLD
    step "Version v$NEW"
  fi

  OUT="$ROOT/release"; mkdir -p "$OUT"
  rm -f "$OUT"/Noor-v*.apk "$OUT"/Noor-v*.ipa "$OUT"/SHA256SUMS.txt "$OUT"/notes.md

  step "Building Android"
  NOOR_CHILD=1 NOOR_NO_INSTALL=1 ./build-android.command || fail "Android build failed — see build-android.log"
  step "Building iPhone"
  if [[ -x ./build-iphone.command ]]; then
    NOOR_CHILD=1 ./build-iphone.command || fail "iPhone build failed — see build-iphone.log"
  else
    print "No build-iphone.command on this Mac — publishing without the iPhone file."
  fi
  (cd "$OUT" && shasum -a 256 Noor-v$NEW-* > SHA256SUMS.txt)

  step "Pushing to GitHub"
  git add -A
  if git diff --cached --name-only | grep -Eiq '(keystore\.properties|\.jks$|\.keystore$|\.p12$|\.mobileprovision$|build-iphone\.command)'; then
    git reset -q
    fail "A signing key or private file was about to be committed. Nothing was pushed — check .gitignore."
  fi
  git diff --cached --quiet || git commit -q -m "Noor v$NEW" || fail "git commit failed."
  git tag -f "v$NEW" >/dev/null
  git push -q origin HEAD || fail "git push failed."
  git push -q -f origin "v$NEW" || fail "Pushing the tag failed."
  BUMPED=""

  step "Publishing release v$NEW"
  PREV=$(git tag --sort=-v:refname | grep -v "^v$NEW\$" | head -1)
  cat > "$OUT/notes.md" <<NOTES
## Noor v$NEW

### 📱 Android
1. On the phone, download **Noor-v$NEW-android.apk** below.
2. Open it. If asked, allow *Install unknown apps* for your browser or Files app.
3. Updating: install the new APK over the old one — your data stays.

### 🍎 iPhone
Apple only lets App Store apps install with one tap. Until Noor is on the App Store, sideload it:
1. On a Mac or PC, install **Sideloadly** (sideloadly.io) or **AltStore** (altstore.io).
2. Download **Noor-v$NEW-iphone.ipa** below and drag it into Sideloadly (or open it in AltStore).
3. Sign in with your Apple ID and connect the iPhone — the tool installs Noor.
4. On the iPhone: **Settings → General → VPN & Device Management** → trust your Apple ID.
   Also turn on **Settings → Privacy & Security → Developer Mode** (restart when asked).
5. With a free Apple ID the app must be re-signed every 7 days (AltStore can do this automatically).

### ✅ Check the download
\`SHA256SUMS.txt\` lists the checksums of both files.
NOTES
  if [[ -n "$PREV" ]]; then
    print "\n### Changes since $PREV" >> "$OUT/notes.md"
    git log --pretty='- %s' "$PREV..v$NEW" >> "$OUT/notes.md"
  fi
  ASSETS=("$OUT"/Noor-v$NEW-* "$OUT/SHA256SUMS.txt")
  if gh release view "v$NEW" -R "$REPO" >/dev/null 2>&1; then
    gh release upload "v$NEW" $ASSETS -R "$REPO" --clobber || fail "Uploading files to the release failed."
    gh release edit "v$NEW" -R "$REPO" --title "Noor v$NEW" --notes-file "$OUT/notes.md" --latest >/dev/null
  else
    gh release create "v$NEW" $ASSETS -R "$REPO" --title "Noor v$NEW" --notes-file "$OUT/notes.md" --latest || fail "Creating the GitHub release failed."
  fi

  step "Done — https://github.com/$REPO/releases/tag/v$NEW"
  print "=== exit 0 $(date)"
} 2>&1 | tee publish-github.log

print "\nPress Return to close."
read
