#!/usr/bin/env bash
# stop-dispatch-audit.sh — Stop-time fast-worker dispatch-mandate audit (sourceable).
#
# The PreToolUse edit-batch gate (pre-edit-batch-gate.sh) warns at the 3rd
# distinct inline source file and blocks the 4th while orchestration_dispatch is
# on — but that block is routinely overridden in unattended goal sessions
# (DHPK_INLINE_BATCH_OK=1), so a session can still grind dozens of inline edits
# across many files with zero fast-worker dispatches and the violation only
# surfaces in a later manual audit (issue #80: 58 inline edits, 0 dispatches).
#
# This is the POST-HOC counterpart: at Stop, if orchestration_dispatch is on and
# the session's distinct-inline-file counter (the SAME sidecar the gate maintains)
# shows >=3 files, emit a one-line advisory so the mandate violation is visible
# in-session rather than in a retrospective. Advisory only — never blocks Stop.
#
# dhpk_stop_dispatch_audit <sess-dir> <session-id> — echo the advisory line when
# the threshold is crossed, otherwise stay silent. The caller folds the echoed
# line into its single Stop systemMessage.
dhpk_stop_dispatch_audit() {
    [ "${DHPK_ORCHESTRATION_DISPATCH:-off}" = "on" ] || return 0
    local sess="$1" session="$2" safe counter count
    [ -n "$sess" ] || return 0
    [ -n "$session" ] || session="default-session"
    # Mirror pre-edit-batch-gate.sh's session-id sanitization so we resolve the
    # exact counter file it wrote.
    safe="$(printf '%s' "$session" | tr -c 'A-Za-z0-9._-' '_')" || return 0
    counter="$sess/.edit-batch-${safe}.files"
    [ -f "$counter" ] || return 0
    count="$(awk 'NF {seen[$0]=1} END {for (x in seen) n++; print n+0}' "$counter" 2>/dev/null)" || return 0
    case "$count" in ''|*[!0-9]*) return 0 ;; esac
    [ "$count" -ge 3 ] || return 0
    echo "[dispatch-audit] $count distinct source files were edited inline this session with orchestration_dispatch=on — >=3-file mechanical work should have been ONE fast-worker batch (issue #80). If the work was reasoning-heavy or genuinely inline-eligible (<=2-file steps), disregard; otherwise dispatch the batch next time."
}
