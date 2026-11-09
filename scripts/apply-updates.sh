#!/bin/zsh
# Apply update archives Claude sent (noor-v*.tgz in the project folder), oldest first.
# Each archive is unpacked over the project, then moved to .updates/applied/ so it is
# never applied twice. Called by every build/release command.
cd "$(dirname "$0")/.."
setopt null_glob
archives=(noor-v*.tgz noor-v*.tar.gz)
if (( ${#archives} == 0 )); then
  print "No new updates to apply."
  exit 0
fi
mkdir -p .updates/applied
for a in $(print -l $archives | sort -V); do
  print "• Applying $a"
  tar -xzf "$a" || { print "✖ Could not unpack $a"; exit 1; }
  mv -f "$a" ".updates/applied/$a"
done
chmod +x ./*.command scripts/*.sh 2>/dev/null
print "✔ Updates applied: ${#archives}"
