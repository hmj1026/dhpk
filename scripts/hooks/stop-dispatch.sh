#!/usr/bin/env bash
# stop-dispatch.sh — Stop dispatcher for module-contributed Stop hooks.
#
# Mirrors post-edit-dispatch.sh, but for the Stop event. If any DHPK modules are
# active, fires their Stop hooks so a module can run end-of-response batch work
# (e.g. the js module's batched ESLint over all files edited this response).
#
# Convention: module Stop hooks live at
#   modules/<m>/hooks/stop-*.sh
# and are invoked with the same stdin payload Claude Code passed us.
#
# Module Stop hooks run synchronously (Stop is not latency-critical like the
# per-edit pipeline) so their advisory stderr is surfaced in order. Each hook is
# responsible for its own self-skip + must be advisory (exit 0) — this dispatcher
# always exits 0 and never blocks Stop.

set -o pipefail

payload="$(cat 2>/dev/null || true)"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Overlay project pluginConfigs so module selection respects per-project
# .claude/settings.local.json (Claude Code only injects global pluginConfigs).
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh" 2>/dev/null || true

: "${DHPK_ACTIVE_MODULES:=${CLAUDE_PLUGIN_OPTION_MODULES:-}}"

if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    IFS=',' read -r -a _mods <<< "$DHPK_ACTIVE_MODULES"
    for _m in "${_mods[@]}"; do
        _m="$(echo "$_m" | xargs)"
        [ -z "$_m" ] && continue
        for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"stop-*.sh; do
            [ -f "$hook" ] || continue
            printf '%s' "$payload" | bash "$hook" || true
        done
    done
fi

exit 0
