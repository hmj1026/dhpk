#!/usr/bin/env bash
# session-start.sh — activate configured modules for subsequent dispatchers and
# print a fixed dispatch delta (#1297).
# The delta is the always-read channel for the model/effort rules the main
# session needs at dispatch time (built-in Explore, general-purpose, role
# reassignment); the tier map and escalation rules stay in
# rules/model-economics.md (SSOT). SessionStart still owns no snapshots, health
# checks, prompt injection, learning, or Docker probes, and the delta is static
# text: no config keys, no project inspection.

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"

# The report script owns the trigger. It reads project, global, and environment
# layers, including legacy *_model keys, and stays silent when every value is
# the default. Forcing the flag here would hide that predicate.
if command -v node >/dev/null 2>&1; then
    SESS="$(dhpk_sessions_dir)"
    node "$PLUGIN_ROOT/scripts/dispatch-config-report.js" --summary --full-out "$SESS/dispatch-config.json" 2>/dev/null | while IFS= read -r report; do
        echo "[session-start] dispatch config: $report"
    done
fi

# Fixed dispatch delta: 4-6 lines, differences only, plus the SSOT pointer.
cat <<'DELTA'
[dhpk dispatch] Explore: always pass model: "haiku" and effort: "low" on the Agent call; never use Explore for review or judgment.
[dhpk dispatch] A skill that only says "dispatch a sub-agent": review → code-reviewer, implementation → fast-worker, docs → docs-writer, DEV QA → qa-executor, search → Explore (haiku, low).
[dhpk dispatch] Any other general-purpose dispatch must pass an explicit model, and never haiku for file edits.
[dhpk dispatch] Escalation and low-first rules: rules/model-economics.md (SSOT).
DELTA

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
