#!/usr/bin/env bash
# dsh-skill-manager installer — macOS / Linux
# Installs the plugin into the dsh web profile, then tells you to restart.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
TARGET="$DSH_HOME/profiles/web/node_modules/dsh-skill-manager"

if [ ! -d "$DSH_HOME/profiles/web" ]; then
  echo "[dsh-skill-manager] web profile not found at $DSH_HOME/profiles/web" >&2
  echo "Start 'dsh web' once so the profile is generated, then re-run this script." >&2
  exit 1
fi

mkdir -p "$TARGET"
cp -r "$REPO_ROOT/lib" "$TARGET/"
cp "$REPO_ROOT/cordis.patch.yml" "$TARGET/"
cp "$REPO_ROOT/package.json" "$TARGET/"

echo "[dsh-skill-manager] installed to $TARGET"
echo "Now FULLY restart 'dsh web' (stop the process, then start it again) - a page refresh is not enough."
