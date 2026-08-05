#!/usr/bin/env bash
# session-start.sh — activate configured modules for subsequent dispatchers.
# SessionStart deliberately owns no snapshots, health checks, prompt injection,
# learning, Docker probes, or orchestration advice.

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"

MODULES="$(dhpk_config_csv modules '')"
ACTIVE_MODULES=""
[ -n "$MODULES" ] || exit 0

if command -v python3 >/dev/null 2>&1; then
    while IFS=$'\t' read -r tag first second; do
        case "$tag" in
            WARN) echo "[session-start] WARN: $first" >&2 ;;
            MODULE) echo "[session-start] module enabled: $first — $second" ;;
            ACTIVE) ACTIVE_MODULES="$first" ;;
        esac
    done < <(python3 "$PLUGIN_ROOT/scripts/hooks/_lib/activate-modules.py" "$PLUGIN_ROOT" "$MODULES" 2>/dev/null)
else
    IFS=',' read -r -a requested <<< "$MODULES"
    for module in "${requested[@]}"; do
        module="$(echo "$module" | xargs)"
        [ -n "$module" ] || continue
        [ -d "$PLUGIN_ROOT/modules/$module" ] || { echo "[session-start] WARN: module '$module' not found" >&2; continue; }
        case ",$ACTIVE_MODULES," in *",$module,"*) ;; *) ACTIVE_MODULES="${ACTIVE_MODULES:+$ACTIVE_MODULES,}$module" ;; esac
    done
fi

export DHPK_ACTIVE_MODULES="$ACTIVE_MODULES"
exit 0
