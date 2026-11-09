#!/bin/zsh
# Same as build-release.command (kept so the old name still works).
cd "$(dirname "$0")"
exec ./build-release.command
