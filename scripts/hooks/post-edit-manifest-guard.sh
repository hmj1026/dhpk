#!/usr/bin/env bash
# post-edit-manifest-guard.sh — PostToolUse (Edit|Write|MultiEdit) hook (async).
#
# When a package manifest at the repo root is edited, surface a systemMessage
# reminder that the matching lock file must be regenerated before commit.
# Advisory only (always exit 0; exit-0 stderr is inert — see _lib/json-out.sh);
# writes no sentinel — lock sync is a manual ops step, not a
# review, so it must not pollute the reviewer sentinel arrays. Pairs with
# pre-edit-guard.sh, which blocks hand-edits to the lock files themselves.
#
# Project override — userConfig.lockfile_sync_commands, entries shaped
# "<manifest>:<command>" (first ":" splits; commands containing commas are not
# supported because list options are comma-joined into the env var):
#   lockfile_sync_commands:
#     - "composer.json:docker exec -i my_php composer update --lock"
# Unconfigured manifests fall back to the generic default below.

set -o pipefail

. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/json-out.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
. "$(dirname "$0")/_lib/load-project-config.sh" 2>/dev/null || true

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE_PATH="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE_PATH" ] && FILE_PATH="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE_PATH" ] && exit 0

REL="${FILE_PATH#$ROOT/}"

# Root-level manifests only (REL contains no slash) — nested package.json in a
# vendored subtree is not this project's lock-sync responsibility.
case "$REL" in
    */*) exit 0 ;;
esac

DEFAULT_CMD=""
LOCK_NAME=""
case "$REL" in
    composer.json) DEFAULT_CMD="composer update --lock"; LOCK_NAME="composer.lock" ;;
    package.json)  DEFAULT_CMD="npm install";            LOCK_NAME="package-lock.json" ;;
    Gemfile)       DEFAULT_CMD="bundle install";         LOCK_NAME="Gemfile.lock" ;;
    Cargo.toml)    DEFAULT_CMD="cargo build";            LOCK_NAME="Cargo.lock" ;;
    pyproject.toml) DEFAULT_CMD="poetry lock (or uv lock)"; LOCK_NAME="the lock file" ;;
    *) exit 0 ;;
esac

# Look up a project-configured sync command for this manifest.
CMD="$DEFAULT_CMD"
if [ -n "${CLAUDE_PLUGIN_OPTION_LOCKFILE_SYNC_COMMANDS:-}" ]; then
    IFS=',' read -r -a _entries <<< "${CLAUDE_PLUGIN_OPTION_LOCKFILE_SYNC_COMMANDS}"
    for _e in "${_entries[@]}"; do
        _e="$(echo "$_e" | xargs)"
        [ -z "$_e" ] && continue
        _manifest="${_e%%:*}"
        if [ "$_manifest" = "$REL" ]; then
            CMD="${_e#*:}"
            break
        fi
    done
fi

emit_system_message "[manifest-guard] $REL modified — sync $LOCK_NAME before commit:
    $CMD"

exit 0
