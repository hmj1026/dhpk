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

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
payload="$(dhpk_read_payload)"

# Overlay project pluginConfigs so module selection respects per-project
# .claude/settings.local.json (Claude Code only injects global pluginConfigs).
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh" 2>/dev/null || true
. "$PLUGIN_ROOT/scripts/hooks/_lib/modules.sh" 2>/dev/null || true

# session-start.sh exports DHPK_ACTIVE_MODULES after validating module
# `requires`. Claude Code propagates that env to subsequent hooks in most
# setups, but fall back to the (now project-overridden) plugin option when it
# doesn't — keeps the dispatcher correct even when env doesn't carry forward.
: "${DHPK_ACTIVE_MODULES:=$(dhpk_config_modules)}"

# Core: synchronous (the sentinel-writing logic must complete before any
# later hook in the same event sees the artifacts/sessions/ state).
printf '%s' "$payload" | bash "$PLUGIN_ROOT/scripts/hooks/post-edit-remind.sh"
core_exit=$?

# Module hooks: backgrounded so they don't stall the edit pipeline. Each
# module hook is responsible for its own self-skip semantics; the dispatcher
# does not gate by tier / file type.
#
# Output handling: a backgrounded child must NOT write to the dispatcher's
# stdout/stderr — those pipes close the instant we `exit "$core_exit"`, so the
# child's lint findings were lost (and exit-0 stderr is inert anyway — see
# _lib/json-out.sh). Instead each child appends to a per-session findings file;
# stop-advisory-dispatch.sh surfaces + clears it via systemMessage at turn end. Findings
# written after this turn's Stop simply surface at the next Stop (advisory,
# eventually-consistent). `disown` detaches the child so it survives our exit.
if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    SESS="$(dhpk_sessions_dir)"
    FINDINGS="$SESS/$DHPK_SIDECAR_MODULE_FINDINGS"
    mkdir -p "$SESS" 2>/dev/null || true
    while IFS= read -r _m; do
        for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"post-edit-*.sh; do
            [ -f "$hook" ] || continue
            ( printf '%s' "$payload" | bash "$hook" >>"$FINDINGS" 2>&1 ) &
            disown 2>/dev/null || true
        done
    done < <(active_modules_list)
fi

exit "$core_exit"
