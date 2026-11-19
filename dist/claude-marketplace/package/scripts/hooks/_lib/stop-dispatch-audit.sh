#!/usr/bin/env bash
# stop-dispatch-audit.sh — Stop-time fast-worker dispatch-mandate audit (sourceable).
#
# The PreToolUse edit-batch gate maintains a session-scoped list of inline source
# files while orchestration_dispatch is on. This post-hoc counterpart surfaces a
# non-blocking outcome review when that list is non-empty, so ownership, coupling,
# and material risk remain visible without turning file count into a routing rule.
#
# dhpk_stop_dispatch_audit <sess-dir> <session-id> — echo the advisory line when
# inline files exist, otherwise stay silent. The caller folds the echoed
# line into its single Stop systemMessage.
dhpk_stop_dispatch_audit() {
    [ "${DHPK_ORCHESTRATION_DISPATCH:-off}" = "on" ] || return 0
    local sess="$1" session="$2" safe counter count marker
    [ -n "$sess" ] || return 0
    [ -n "$session" ] || session="default-session"
    # Mirror pre-edit-batch-gate.sh's session-id sanitization so we resolve the
    # exact counter file it wrote.
    safe="$(printf '%s' "$session" | tr -c 'A-Za-z0-9._-' '_')" || return 0
    counter="$sess/.edit-batch-${safe}.files"
    [ -f "$counter" ] || return 0
    count="$(awk 'NF {seen[$0]=1} END {for (x in seen) n++; print n+0}' "$counter" 2>/dev/null)" || return 0
    case "$count" in ''|*[!0-9]*) return 0 ;; esac
    [ "$count" -gt 0 ] || return 0
    # Fire ONCE per session: the .edit-batch counter persists across Stop turns,
    # so without this marker the advisory would re-emit verbatim every turn — the
    # recurring-noise anti-pattern issue #79 treats as a defect.
    marker="$sess/.dispatch-audit-fired-${safe}"
    [ -f "$marker" ] && return 0
    : > "$marker" 2>/dev/null || true
    echo "[dispatch-audit] $count distinct source files were edited inline this session with orchestration_dispatch=on — review ownership, coupling, and material risk, then delegate when the required outcome needs another owner (issue #80)."
}
