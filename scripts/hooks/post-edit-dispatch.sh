#!/usr/bin/env bash
# post-edit-dispatch.sh — PostToolUse (Edit|Write|MultiEdit) dispatcher.
#
# Always runs the core post-edit-remind.sh (sentinel routing). Then, if any
# DHPK modules are active, fires their post-edit hooks in the background so
# the edit pipeline never waits on per-file lint / typecheck work.
#
# Convention: module post-edit hooks live at
#   modules/<m>/hooks/post-edit-*.sh
# and are invoked with the same stdin payload Claude Code passed us.

set -o pipefail

payload="$(cat 2>/dev/null || true)"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

# Overlay project pluginConfigs so module selection respects per-project
# .claude/settings.local.json (Claude Code only injects global pluginConfigs).
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh" 2>/dev/null || true

# session-start.sh exports DHPK_ACTIVE_MODULES after validating module
# `requires`. Claude Code propagates that env to subsequent hooks in most
# setups, but fall back to the (now project-overridden) plugin option when it
# doesn't — keeps the dispatcher correct even when env doesn't carry forward.
: "${DHPK_ACTIVE_MODULES:=${CLAUDE_PLUGIN_OPTION_MODULES:-}}"

# Core: synchronous (the sentinel-writing logic must complete before any
# later hook in the same event sees the artifacts/sessions/ state).
printf '%s' "$payload" | bash "$PLUGIN_ROOT/scripts/hooks/post-edit-remind.sh"
core_exit=$?

# Module hooks: backgrounded so they don't stall the edit pipeline. Each
# module hook is responsible for its own self-skip semantics; the dispatcher
# does not gate by tier / file type.
if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    IFS=',' read -r -a _mods <<< "$DHPK_ACTIVE_MODULES"
    for _m in "${_mods[@]}"; do
        _m="$(echo "$_m" | xargs)"
        [ -z "$_m" ] && continue
        for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"post-edit-*.sh; do
            [ -f "$hook" ] || continue
            ( printf '%s' "$payload" | bash "$hook" ) &
        done
    done
fi

exit "$core_exit"
