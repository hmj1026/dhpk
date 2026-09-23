#!/usr/bin/env bash
# Portable asset adapter for the relocated dhpk-project-setup Skill.
# The source artifact is data; only the synchronized writer beside this file
# is executable.
set -u

ADAPTER_NAME="dhpk-project-setup/install-project-assets"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" || {
    printf '[%s] BLOCKED_RESOURCE_MISSING: cannot resolve Skill directory\n' "$ADAPTER_NAME" >&2
    exit 1
}
SKILL_ROOT="$(cd -- "$SCRIPT_DIR/.." 2>/dev/null && pwd -P)" || {
    printf '[%s] BLOCKED_RESOURCE_MISSING: cannot resolve Skill root\n' "$ADAPTER_NAME" >&2
    exit 1
}
WRITER="$SCRIPT_DIR/lib/install-assets-writer.sh"

SOURCE_ARTIFACT=""
TARGET=""
INSTALL=""
DRY_RUN=0
FORCE=0
HELP=0

usage() {
    cat <<'EOF'
Usage: install-project-assets.sh --source-artifact DIR --target DIR --install hooks|rules|scripts|all [--dry-run] [--force]

Copies selected assets from the explicit distribution artifact into TARGET.
The artifact is read as data; only the Skill-local writer is executed.
EOF
}

path_has_symlink() {
    local candidate="$1" current rest component
    case "$candidate" in
        /*) current="/"; rest="${candidate#/}" ;;
        *) current="$PWD"; rest="$candidate" ;;
    esac
    while [ -n "$rest" ]; do
        component="${rest%%/*}"
        if [ "$rest" = "$component" ]; then rest=""; else rest="${rest#*/}"; fi
        if [ -z "$component" ] || [ "$component" = "." ]; then continue; fi
        if [ "$component" = ".." ]; then current="$(dirname -- "$current")"; continue; fi
        [ -L "$current/$component" ] && return 0
        current="$current/$component"
    done
    return 1
}

absolute_path() {
    case "$1" in
        /*) printf '%s' "$1" ;;
        *) printf '%s/%s' "$PWD" "$1" ;;
    esac
}

json_escape() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    value="${value//$'\n'/\\n}"
    value="${value//$'\r'/\\r}"
    value="${value//$'\t'/\\t}"
    printf '%s' "$value"
}

json_value() {
    if [ "$1" = "null" ]; then printf 'null'; else printf '"%s"' "$(json_escape "$1")"; fi
}

emit_result() {
    local status="$1" code="$2" source="$3" target="$4" operation="$5"
    printf '{"status":"%s","code":"%s","source_artifact":%s,"target":%s,"operation":"%s","writer":"%s"}\n' \
        "$(json_escape "$status")" "$(json_escape "$code")" "$(json_value "$source")" \
        "$(json_value "$target")" "$(json_escape "$operation")" "$(json_escape "$WRITER")"
}

operation_value() {
    local operation="install=$INSTALL"
    [ "$DRY_RUN" -eq 1 ] && operation="$operation dry-run=true"
    [ "$FORCE" -eq 1 ] && operation="$operation force=true"
    printf '%s' "$operation"
}

fail_result() {
    local code="$1" message="$2" exit_code="${3:-1}"
    printf '[%s] %s\n' "$ADAPTER_NAME" "$message" >&2
    emit_result BLOCKED "$code" "${SOURCE_ARTIFACT:-null}" "${TARGET:-null}" \
        "$(operation_value)"
    exit "$exit_code"
}

require_writer() {
    if [ ! -f "$WRITER" ] || [ -L "$WRITER" ] || path_has_symlink "$WRITER"; then
        fail_result BLOCKED_RESOURCE_MISSING 'Skill-local install-assets writer is missing or not physical'
    fi
    case "$WRITER" in
        "$SKILL_ROOT"/*) ;;
        *) fail_result BLOCKED_RESOURCE_MISSING 'install-assets writer escapes the Skill root' ;;
    esac
}

valid_payload() {
    case "$INSTALL" in
        hooks)
            [ -f "$SOURCE_ARTIFACT/hooks/hooks.json" ] &&
              [ ! -L "$SOURCE_ARTIFACT/hooks/hooks.json" ] &&
              [ -d "$SOURCE_ARTIFACT/scripts/hooks" ] ;;
        rules) [ -d "$SOURCE_ARTIFACT/rules" ] ;;
        scripts)
            [ -d "$SOURCE_ARTIFACT/scripts" ] &&
              [ -d "$SOURCE_ARTIFACT/skills/precommit/scripts" ] &&
              [ -d "$SOURCE_ARTIFACT/skills/repo-verify/scripts" ] &&
              [ -d "$SOURCE_ARTIFACT/skills/harness-audit/scripts" ] ;;
        all)
            [ -f "$SOURCE_ARTIFACT/hooks/hooks.json" ] &&
              [ ! -L "$SOURCE_ARTIFACT/hooks/hooks.json" ] &&
              [ -d "$SOURCE_ARTIFACT/scripts/hooks" ] &&
              [ -d "$SOURCE_ARTIFACT/rules" ] &&
              [ -d "$SOURCE_ARTIFACT/scripts" ] &&
              [ -d "$SOURCE_ARTIFACT/skills/precommit/scripts" ] &&
              [ -d "$SOURCE_ARTIFACT/skills/repo-verify/scripts" ] &&
              [ -d "$SOURCE_ARTIFACT/skills/harness-audit/scripts" ] ;;
        *) return 1 ;;
    esac
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --source-artifact)
            [ "$#" -ge 2 ] || { usage >&2; exit 64; }
            SOURCE_ARTIFACT="$2"; shift 2 ;;
        --source-artifact=*) SOURCE_ARTIFACT="${1#--source-artifact=}"; shift ;;
        --target)
            [ "$#" -ge 2 ] || { usage >&2; exit 64; }
            TARGET="$2"; shift 2 ;;
        --target=*) TARGET="${1#--target=}"; shift ;;
        --install)
            [ "$#" -ge 2 ] || { usage >&2; exit 64; }
            INSTALL="$2"; shift 2 ;;
        --install=*) INSTALL="${1#--install=}"; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        --force) FORCE=1; shift ;;
        -h|--help) HELP=1; shift ;;
        *) printf '[%s] unknown argument: %s\n' "$ADAPTER_NAME" "$1" >&2; usage >&2; exit 64 ;;
    esac
done

if [ "$HELP" -eq 1 ]; then usage; exit 0; fi
require_writer
[ -n "$SOURCE_ARTIFACT" ] || fail_result SOURCE_ARTIFACT_REQUIRED '--source-artifact is required'
[ -n "$TARGET" ] || fail_result SOURCE_ARTIFACT_INVALID '--target is required'
case "$INSTALL" in hooks|rules|scripts|all) ;; *) fail_result SOURCE_ARTIFACT_INVALID '--install must be hooks, rules, scripts, or all' 64 ;; esac

if [ ! -d "$SOURCE_ARTIFACT" ] || [ -L "$SOURCE_ARTIFACT" ] || path_has_symlink "$SOURCE_ARTIFACT"; then
    fail_result SOURCE_ARTIFACT_INVALID 'source artifact must be an existing physical directory'
fi
SOURCE_ARTIFACT="$(cd -- "$SOURCE_ARTIFACT" && pwd -P)" ||
    fail_result SOURCE_ARTIFACT_INVALID 'source artifact cannot be resolved'
TARGET="$(absolute_path "$TARGET")"
valid_payload ||
    fail_result SOURCE_ARTIFACT_INVALID "selected '$INSTALL' payload is missing or invalid"

stdout_file="$(mktemp "${TMPDIR:-/tmp}/dhpk-project-assets.XXXXXX")" ||
    fail_result WRITER_FAILED 'cannot allocate writer output buffer'
stderr_file="$(mktemp "${TMPDIR:-/tmp}/dhpk-project-assets.XXXXXX")" || {
    rm -f "$stdout_file"
    fail_result WRITER_FAILED 'cannot allocate writer error buffer'
}
cleanup() { rm -f "$stdout_file" "$stderr_file"; }
trap cleanup EXIT

writer_args=(--source "$SOURCE_ARTIFACT" --target "$TARGET" --install "$INSTALL")
[ "$DRY_RUN" -eq 1 ] && writer_args+=(--dry-run)
[ "$FORCE" -eq 1 ] && writer_args+=(--force)
"$WRITER" "${writer_args[@]}" >"$stdout_file" 2>"$stderr_file"
writer_status="$?"
cat "$stdout_file"
cat "$stderr_file" >&2

case "$writer_status" in
    0) result_status=PASS; result_code=OK ;;
    2) result_status=UNAVAILABLE; result_code=WRITER_CAPABILITY_UNAVAILABLE ;;
    *) result_status=BLOCKED; result_code=WRITER_FAILED ;;
esac
emit_result "$result_status" "$result_code" "$SOURCE_ARTIFACT" "$TARGET" "$(operation_value)"
exit "$writer_status"
