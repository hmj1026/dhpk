#!/usr/bin/env bash
# Portable Codex project adapter for the relocated harness-setup Skill.
# The artifact is data; only the synchronized installer beside this file runs.
set -u

ADAPTER_NAME="harness-setup/install-codex-project"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" || {
    printf '[%s] BLOCKED_RESOURCE_MISSING: cannot resolve Skill directory\n' "$ADAPTER_NAME" >&2
    exit 1
}
SKILL_ROOT="$(cd -- "$SCRIPT_DIR/.." 2>/dev/null && pwd -P)" || {
    printf '[%s] BLOCKED_RESOURCE_MISSING: cannot resolve Skill root\n' "$ADAPTER_NAME" >&2
    exit 1
}
INSTALLER="$SCRIPT_DIR/lib/install-codex-skills.sh"
SOURCE_ARTIFACT=""
FORWARDED=()
HELP=0

usage() {
    cat <<'EOF'
Usage: install-codex-project.sh --source-artifact DIR [--copy] [--update] [--migrate] [--uninstall] [--plan] [--json] [--profile ID] [--skill ID]... [--adopt TOKEN]... [--force]

Runs the Skill-local Codex projection installer against the explicit artifact.
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
        "$(json_value "$target")" "$(json_escape "$operation")" "$(json_escape "$INSTALLER")"
}

require_installer() {
    if [ ! -f "$INSTALLER" ] || [ -L "$INSTALLER" ] || path_has_symlink "$INSTALLER"; then
        printf '[%s] BLOCKED_RESOURCE_MISSING: Skill-local Codex installer is missing or not physical\n' "$ADAPTER_NAME" >&2
        emit_result BLOCKED BLOCKED_RESOURCE_MISSING null null codex-project
        exit 1
    fi
    case "$INSTALLER" in
        "$SKILL_ROOT"/*) ;;
        *) printf '[%s] BLOCKED_RESOURCE_MISSING: Codex installer escapes the Skill root\n' "$ADAPTER_NAME" >&2
           emit_result BLOCKED BLOCKED_RESOURCE_MISSING null null codex-project
           exit 1 ;;
    esac
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --source-artifact)
            [ "$#" -ge 2 ] || { usage >&2; exit 64; }
            SOURCE_ARTIFACT="$2"; shift 2 ;;
        --source-artifact=*) SOURCE_ARTIFACT="${1#--source-artifact=}"; shift ;;
        -h|--help) HELP=1; FORWARDED+=("$1"); shift ;;
        *) FORWARDED+=("$1"); shift ;;
    esac
done

require_installer
if [ "$HELP" -eq 1 ]; then
    "$INSTALLER" "${FORWARDED[@]}"
    exit "$?"
fi
if [ -z "$SOURCE_ARTIFACT" ]; then
    printf '[%s] SOURCE_ARTIFACT_REQUIRED: --source-artifact is required\n' "$ADAPTER_NAME" >&2
    emit_result BLOCKED SOURCE_ARTIFACT_REQUIRED null null codex-project
    exit 1
fi
if [ ! -d "$SOURCE_ARTIFACT" ] || [ -L "$SOURCE_ARTIFACT" ] || path_has_symlink "$SOURCE_ARTIFACT"; then
    printf '[%s] SOURCE_ARTIFACT_INVALID: artifact must be an existing physical directory\n' "$ADAPTER_NAME" >&2
    emit_result BLOCKED SOURCE_ARTIFACT_INVALID null null codex-project
    exit 1
fi
SOURCE_ARTIFACT="$(cd -- "$SOURCE_ARTIFACT" && pwd -P)" || {
    printf '[%s] SOURCE_ARTIFACT_INVALID: artifact cannot be resolved\n' "$ADAPTER_NAME" >&2
    emit_result BLOCKED SOURCE_ARTIFACT_INVALID null null codex-project
    exit 1
}
[ -d "$SOURCE_ARTIFACT/codex" ] || {
    printf '[%s] SOURCE_ARTIFACT_INVALID: artifact is missing codex/ payload\n' "$ADAPTER_NAME" >&2
    emit_result BLOCKED SOURCE_ARTIFACT_INVALID "$SOURCE_ARTIFACT" "$PWD/.codex" codex-project
    exit 1
}
# Reject any artifact symlink before the receipt lock or destination is
# opened.  A physical artifact is required so a manifest cannot redirect a
# source path into the relocated Skill or another checkout.
artifact_symlink="$(find "$SOURCE_ARTIFACT" -type l -print -quit 2>/dev/null || true)"
if [ -n "$artifact_symlink" ]; then
    printf '[%s] SOURCE_ARTIFACT_INVALID: pinned artifact root rejects a symlinked source outside the artifact root (%s)\n' "$ADAPTER_NAME" "$artifact_symlink" >&2
    emit_result BLOCKED SOURCE_ARTIFACT_INVALID "$SOURCE_ARTIFACT" "$PWD/.codex" codex-project
    exit 1
fi

operation="codex-project"
for argument in "${FORWARDED[@]}"; do operation="$operation $argument"; done
# Pin both root variables to artifact data while executing the Skill-local copy.
CLAUDE_PLUGIN_ROOT="$SOURCE_ARTIFACT" DHPK_INSTALLER_ROOT="$SOURCE_ARTIFACT" \
    "$INSTALLER" "${FORWARDED[@]}"
installer_status="$?"

if [ "$installer_status" -eq 0 ]; then
    result_status=PASS; result_code=OK
elif [ "$installer_status" -eq 2 ]; then
    result_status=UNAVAILABLE; result_code=WRITER_CAPABILITY_UNAVAILABLE
else
    result_status=BLOCKED; result_code=WRITER_FAILED
fi
emit_result "$result_status" "$result_code" "$SOURCE_ARTIFACT" "$PWD/.codex" "$operation"
exit "$installer_status"
