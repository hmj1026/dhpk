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
# per-edit pipeline). Each hook is responsible for its own self-skip + must be
# advisory (exit 0) — this dispatcher always exits 0 and never blocks Stop.
#
# Output handling: module hook stdout/stderr is captured into the per-session
# findings file (the same file post-edit-dispatch.sh appends backgrounded
# per-file lint to). At the end we surface the consolidated findings ONCE via a
# systemMessage and clear the file (exit-0 stderr is inert — see _lib/json-out.sh).
# minimal profile suppresses the surfaced message but still clears the file.

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
payload="$(dhpk_read_payload)"

# Overlay project pluginConfigs so module selection respects per-project
# .claude/settings.local.json (Claude Code only injects global pluginConfigs).
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh" 2>/dev/null || true
. "$PLUGIN_ROOT/scripts/hooks/_lib/json-out.sh" 2>/dev/null || true
. "$PLUGIN_ROOT/scripts/hooks/_lib/modules.sh" 2>/dev/null || true

: "${DHPK_ACTIVE_MODULES:=${CLAUDE_PLUGIN_OPTION_MODULES:-}}"

SESS="$(dhpk_sessions_dir)"
FINDINGS="$SESS/$DHPK_SIDECAR_MODULE_FINDINGS"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

if [ -n "${DHPK_ACTIVE_MODULES:-}" ]; then
    mkdir -p "$SESS" 2>/dev/null || true
    while IFS= read -r _m; do
        for hook in "$PLUGIN_ROOT/modules/$_m/hooks/"stop-*.sh; do
            [ -f "$hook" ] || continue
            printf '%s' "$payload" | bash "$hook" >>"$FINDINGS" 2>&1 || true
        done
    done < <(active_modules_list)
fi

# Surface the consolidated module findings (per-file lint from
# post-edit-dispatch.sh + batch checks above) once, then clear.
if [ -s "$FINDINGS" ]; then
    if [ "$PROFILE" != "minimal" ]; then
        body="$(head -c 6000 "$FINDINGS" 2>/dev/null)"
        [ "$(wc -c < "$FINDINGS" 2>/dev/null || echo 0)" -gt 6000 ] && body="$body
... (truncated)"
        emit_system_message "[module-checks] findings from this turn:
$body"
    fi
    rm -f "$FINDINGS" 2>/dev/null || true
fi

exit 0
