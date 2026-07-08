#!/usr/bin/env bash
# post-edit-advisory.sh — PostToolUse (Edit|Write|MultiEdit) hook (async).
#
# Merges post-write-crlf-fix.sh + post-edit-manifest-guard.sh into one script
# that extracts file_path once and evaluates two disjoint triggers against
# the shared value:
#
#   CRLF normalization — Normalise CRLF -> LF in .sh files written from WSL
#     hosts (bash refuses CRLF scripts: $'\r': command not found). Reports via
#     a plain stdout echo (not systemMessage) — unchanged from
#     post-write-crlf-fix.sh, which never called json-out.sh.
#
#   Root-manifest lockfile-sync reminder — when a package manifest at the
#     repo root is edited, surface a systemMessage reminder that the matching
#     lock file must be regenerated before commit. Advisory only; writes no
#     sentinel. Pairs with pre-edit-guard.sh, which blocks hand-edits to the
#     lock files themselves.
#
# Project override — userConfig.lockfile_sync_commands, entries shaped
# "<manifest>:<command>" (first ":" splits; commands containing commas are
# not supported because list options are comma-joined into the env var):
#   lockfile_sync_commands:
#     - "composer.json:docker exec -i my_php composer update --lock"
# Unconfigured manifests fall back to the generic default below.
#
# Always exits 0 regardless of which advisories fire — async hooks must
# never block.

set -o pipefail

. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/json-out.sh"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
. "$(dirname "$0")/_lib/load-project-config.sh" 2>/dev/null || true

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

FILE="$(extract_tool_input file_path "$PAYLOAD")"
[ -z "$FILE" ] && FILE="$(extract_tool_input filePath "$PAYLOAD")"
[ -z "$FILE" ] && exit 0

# ---------------------------------------------------------------------------
# CRLF normalization trigger — ported unchanged from post-write-crlf-fix.sh
# ---------------------------------------------------------------------------
case "$FILE" in
    *.sh)
        if [ -f "$FILE" ] && grep -q $'\r' "$FILE" 2>/dev/null; then
            if [ "$(uname)" = "Darwin" ]; then
                if sed -i '' 's/\r$//' "$FILE"; then
                    echo "[crlf-fix] normalised line endings: $FILE"
                else
                    echo "[crlf-fix] WARN: sed failed for $FILE" >&2
                fi
            else
                if sed -i 's/\r$//' "$FILE"; then
                    echo "[crlf-fix] normalised line endings: $FILE"
                else
                    echo "[crlf-fix] WARN: sed failed for $FILE" >&2
                fi
            fi
        fi
        ;;
esac

# ---------------------------------------------------------------------------
# Root-manifest lockfile-sync reminder — ported unchanged from
# post-edit-manifest-guard.sh
# ---------------------------------------------------------------------------
REL="${FILE#$ROOT/}"

# Root-level manifests only (REL contains no slash) — nested package.json in a
# vendored subtree is not this project's lock-sync responsibility.
case "$REL" in
    */*) ;;
    *)
        DEFAULT_CMD=""
        LOCK_NAME=""
        case "$REL" in
            composer.json) DEFAULT_CMD="composer update --lock"; LOCK_NAME="composer.lock" ;;
            package.json)  DEFAULT_CMD="npm install";            LOCK_NAME="package-lock.json" ;;
            Gemfile)       DEFAULT_CMD="bundle install";         LOCK_NAME="Gemfile.lock" ;;
            Cargo.toml)    DEFAULT_CMD="cargo build";            LOCK_NAME="Cargo.lock" ;;
            pyproject.toml) DEFAULT_CMD="poetry lock (or uv lock)"; LOCK_NAME="the lock file" ;;
            *) DEFAULT_CMD="" ;;
        esac

        if [ -n "$DEFAULT_CMD" ]; then
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
        fi
        ;;
esac

exit 0
