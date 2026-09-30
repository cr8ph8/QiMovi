#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIRECTORY="${QI_APP_DIRECTORY:-/Applications}"
APP_BUNDLE="$INSTALL_DIRECTORY/QiMovi.app"
BACKUP_DIRECTORY="${QI_APP_BACKUP_DIRECTORY:-$HOME/Applications/QiMovi Backups}"
NODE_BIN="${QI_NODE_BIN:-$(command -v node || true)}"
BUN_BIN="${QI_BUN_BIN:-$(command -v bun || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "Build requires Node 24.10+ on PATH. Set QI_NODE_BIN to its executable path if needed." >&2; exit 1
fi
if ! "$NODE_BIN" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 24 || (major === 24 && minor >= 10) ? 0 : 1)'; then
  echo "Build requires Node 24.10 or newer. Select a compatible executable with QI_NODE_BIN." >&2; exit 1
fi
case "$MODE" in run|--verify|--build-only|--stage-only|--debug|--logs|--telemetry) ;; *) echo "usage: $0 [--verify|--build-only|--stage-only|--debug|--logs|--telemetry]" >&2; exit 2 ;; esac
if [[ "$MODE" == --stage-only ]]; then
  if [[ "${QI_STAGE_DIRECTORY:-}" != /* || -e "$QI_STAGE_DIRECTORY/QiMovi.app" ]]; then
    echo "Set QI_STAGE_DIRECTORY to an absolute directory without an existing app candidate." >&2; exit 1
  fi
fi
if [[ "$MODE" != --stage-only && -d "$INSTALL_DIRECTORY" && ! -w "$INSTALL_DIRECTORY" ]]; then
  echo "Application directory is not writable: $INSTALL_DIRECTORY. Set QI_APP_DIRECTORY to a writable Applications folder." >&2; exit 1
fi
if [[ "$MODE" != --stage-only ]] && pgrep -x QiMovieSlate >/dev/null; then
  /usr/bin/osascript -e 'tell application id "com.hampton.qimovieslate.local" to quit'
  for attempt in {1..60}; do if ! pgrep -x QiMovieSlate >/dev/null; then break; fi; sleep 0.25; done
  if pgrep -x QiMovieSlate >/dev/null; then echo "App remains open. Save drafts and quit before rebuilding." >&2; exit 1; fi
fi
cd "$ROOT_DIR"
if [[ -n "$BUN_BIN" && -x "$BUN_BIN" ]]; then
  "$BUN_BIN" run build:local
else
  # Use this checkout's installed Vite when Bun is not on the desktop PATH.
  # Building the native app must not download a package manager at runtime.
  "$NODE_BIN" "$ROOT_DIR/node_modules/vite/bin/vite.js" build --config vite.local.config.ts
fi
swift build --package-path desktop
BUILD_PATH="$(swift build --package-path desktop --show-bin-path)"
STAGING_DIRECTORY="$(mktemp -d /private/tmp/qi-movie-slate-app.XXXXXX)"
trap 'rm -rf "$STAGING_DIRECTORY"' EXIT
"$NODE_BIN" script/stage_desktop.mjs "$BUILD_PATH/QiMovieSlate" "$NODE_BIN" "$STAGING_DIRECTORY"
STAGED_APP="$STAGING_DIRECTORY/QiMovi.app"
# Finder metadata inherited from local dependency folders is not part of the generated app.
/usr/bin/xattr -cr "$STAGED_APP"
/usr/bin/codesign --force --sign - "$STAGED_APP/Contents/Resources/node"
/usr/bin/codesign --force --sign - "$STAGED_APP/Contents/Resources/CanIScreenwriteMediaProbe"
/usr/bin/codesign --force --sign - "$STAGED_APP"
/usr/bin/codesign --verify --deep --strict "$STAGED_APP"
if [[ "$MODE" == --stage-only ]]; then
  mkdir -p "$QI_STAGE_DIRECTORY"
  ditto "$STAGED_APP" "$QI_STAGE_DIRECTORY/QiMovi.app"
  /usr/bin/xattr -cr "$QI_STAGE_DIRECTORY/QiMovi.app"
  /usr/bin/codesign --verify --deep --strict "$QI_STAGE_DIRECTORY/QiMovi.app"
  echo "Signed candidate staged at $QI_STAGE_DIRECTORY/QiMovi.app. Running app and drafts preserved."
  exit 0
fi
mkdir -p "$INSTALL_DIRECTORY"
# Prepare and verify the replacement before moving any installed app. The hidden
# temporary directory is not a launchable .app and is local to the final volume.
INSTALL_CANDIDATE="$(mktemp -d "$INSTALL_DIRECTORY/.QiMovi-install-XXXXXX")"
trap 'rm -rf "$STAGING_DIRECTORY" "${INSTALL_CANDIDATE:-}"' EXIT
ditto "$STAGED_APP" "$INSTALL_CANDIDATE/QiMovi.installing"
/usr/bin/codesign --verify --deep --strict "$INSTALL_CANDIDATE/QiMovi.installing"
# One continuing app identity: retire known legacy filenames, while preferences
# and project databases remain outside the bundle and keep their existing IDs.
ARCHIVE_APPS=()
for EXISTING_APP in "$APP_BUNDLE" "$INSTALL_DIRECTORY/Qi Movie Slate.app" "$HOME/Applications/Qi Movie Slate.app" "/Applications/Qi Movie Slate.app"; do
  if [[ ! -e "$EXISTING_APP" ]]; then continue; fi
  ALREADY_LISTED=false
  for LISTED_APP in ${ARCHIVE_APPS[@]+"${ARCHIVE_APPS[@]}"}; do if [[ "$LISTED_APP" == "$EXISTING_APP" ]]; then ALREADY_LISTED=true; break; fi; done
  if [[ "$ALREADY_LISTED" == true ]]; then continue; fi
  EXISTING_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$EXISTING_APP/Contents/Info.plist")"
  if [[ "$EXISTING_ID" != com.hampton.qimovieslate.local ]]; then echo "Existing application has a different identity; leaving it untouched: $EXISTING_APP" >&2; exit 1; fi
  ARCHIVE_APPS+=("$EXISTING_APP")
done
ARCHIVE_PATHS=()
restore_archived_apps() {
  for (( index=${#ARCHIVE_PATHS[@]}-1; index>=0; index-- )); do
    mv "${ARCHIVE_PATHS[$index]}" "${ARCHIVE_APPS[$index]}" || echo "Restore the prior app from ${ARCHIVE_PATHS[$index]}" >&2
  done
}
mkdir -p "$BACKUP_DIRECTORY"
for EXISTING_APP in ${ARCHIVE_APPS[@]+"${ARCHIVE_APPS[@]}"}; do
  if ! BACKUP_SLOT="$(mktemp -d "$BACKUP_DIRECTORY/build-$(date +%Y%m%dT%H%M%S)-XXXXXX")"; then restore_archived_apps; exit 1; fi
  ARCHIVE_PATH="$BACKUP_SLOT/$(basename "$EXISTING_APP").archived"
  if ! mv "$EXISTING_APP" "$ARCHIVE_PATH"; then restore_archived_apps; exit 1; fi
  ARCHIVE_PATHS+=("$ARCHIVE_PATH")
done
if ! mv "$INSTALL_CANDIDATE/QiMovi.installing" "$APP_BUNDLE"; then restore_archived_apps; exit 1; fi
/usr/bin/codesign --verify --deep --strict "$APP_BUNDLE"
if [[ "$MODE" == --build-only ]]; then exit 0; fi
if [[ "$MODE" == --debug ]]; then lldb -- "$APP_BUNDLE/Contents/MacOS/QiMovieSlate"; exit; fi
/usr/bin/open "$APP_BUNDLE"
if [[ "$MODE" == --verify ]]; then
  for attempt in {1..40}; do if pgrep -x QiMovieSlate >/dev/null; then echo "QiMovi process launched; inspect the native window for workspace readiness."; exit 0; fi; sleep 0.25; done
  echo "App process did not launch." >&2; exit 1
fi
if [[ "$MODE" == --logs || "$MODE" == --telemetry ]]; then
  /usr/bin/log stream --info --style compact --predicate 'process == "QiMovieSlate"'
fi
