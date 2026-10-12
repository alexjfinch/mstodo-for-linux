#!/usr/bin/env bash
# Build the Flatpak and export a single-file bundle installable on any distro/desktop.
#
# Build state lives in ~/.cache rather than the repo so editors don't index it.
#
# Whenever Cargo.lock or package-lock.json change, regenerate the offline sources or the
# build will fail (CI checks this). Use https://github.com/flatpak/flatpak-builder-tools at
# commit caca92bc, the version CI pins so the output matches. Install the generators with
#   pip install --user <checkout>/cargo <checkout>/node
# and then run:
#   python3 <checkout>/cargo/flatpak-cargo-generator.py src-tauri/Cargo.lock -o flatpak/cargo-sources.json
#   flatpak-node-generator npm package-lock.json -o flatpak/node-sources.json
# The node generator must run where no node_modules directory exists (e.g. a temp
# directory containing only package.json and package-lock.json).
set -euo pipefail

APP_ID=io.github.alexjfinch.mstodo-for-linux
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${XDG_CACHE_HOME:-$HOME/.cache}/mstodo-flatpak"
BUNDLE="$ROOT/mstodo-for-linux.flatpak"

git -C "$ROOT" submodule update --init flatpak/shared-modules
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

flatpak-builder --user --install-deps-from=flathub --force-clean \
  --state-dir="$WORK/state" --repo="$WORK/repo" \
  "$WORK/build" "$ROOT/flatpak/$APP_ID.yml"

# --runtime-repo embeds where to get the GNOME runtime, so `flatpak install` on a
# machine without it (e.g. a KDE desktop) can fetch it from Flathub automatically.
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "$WORK/repo" "$BUNDLE" "$APP_ID"

echo "Bundle written to $BUNDLE"
echo "Install with: flatpak install --user $BUNDLE"
