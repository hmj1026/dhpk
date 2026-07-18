#!/usr/bin/env bash
# subagent-stop-verify.sh — SubagentStop hook (non-blocking)
#
# Plugs reviewer dispatch gaps: when a reviewer agent stops SUCCESSFULLY AND a
# fresh matching review doc exists, auto-clear its sentinel on the
# reviewer's behalf — this is the SANCTIONED clearance path (reviewer agent
# definitions no longer instruct a self-run closing clear-sentinel.sh). The
# auto-clear is GATED on a fresh review doc existing (A5 /
# reviewer-liveness-gate): a reviewer that stops exit 0 but produced NO fresh
# review doc this cycle leaves the sentinel ARMED (gate stays unmet so the
# orchestrator re-dispatches) and is logged as a failure — a no-output reviewer
# clearing its own gate was the 2026-07-13 defect this closes. The clear gate
# keys on review-doc existence + freshness ONLY, never on verdict-parseability, so
# a legitimate fresh review whose verdict field can't be parsed still clears
# rather than looping the orchestrator forever. When a fresh review doc with a
# parseable verdict exists the clear is silent (the designed handoff); a fresh
# doc with an unparseable verdict still clears but is noted. When exit status is
# non-zero, leave the sentinel armed and log to
# .claude/artifacts/agent-failures.log for next-session SessionStart / manual
# review.
#
# Design:
# - Sources _lib/payload.sh SSOT (SENTINEL_NAMES / SENTINEL_AGENTS).
# - Reads stdin JSON; tries multiple field names because Claude Code's
#   SubagentStop envelope schema has evolved across versions.
# - Always exits 0 (non-blocking — must not block the next chain step).
# - Profile-aware: minimal profile suppresses stderr summary; failure log is
#   still appended so the trail survives.
#
# Trigger: SubagentStop event (wired once in hooks/hooks.json).
# Cost: file stat + one jq/python3 parse, <50ms.

set -o pipefail

# Project pluginConfigs override must precede payload.sh — payload.sh reads
# CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS at source-time to populate SENTINEL_AGENTS.
. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/learning-db.sh"
. "$(dirname "$0")/_lib/json-out.sh"

ROOT="$(dhpk_root)"
SESS="$(dhpk_sessions_dir "$ROOT")"
LOG="$ROOT/.claude/artifacts/agent-failures.log"
PROFILE="$(dhpk_config_profile)"

# Read stdin payload (JSON envelope from Claude Code SubagentStop event).
PAYLOAD="$(dhpk_read_payload)"

# Try multiple field names — SubagentStop envelope schema differs across
# Claude Code versions. The current (verified) schema delivers the reviewer
# identity in top-level `agent_type`, prefixed with the plugin namespace (e.g.
# `dhpk:doc-reviewer`); other candidates are kept for back-compat / forward-compat.
extract_subagent_name() {
    local payload="$1" out=""
    [ -z "$payload" ] && return 0
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '
            .agent_type // .subagent_type // .subagent // .agent_name // .tool_input.subagent_type // empty
        ' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(
        d.get("agent_type")
        or d.get("subagent_type")
        or d.get("subagent")
        or d.get("agent_name")
        or d.get("tool_input", {}).get("subagent_type")
        or ""
    )
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    printf '%s' "$out"
}

# Maintenance note: if Claude Code adds new failure-status field names (e.g.
# `failed`, `error`, `outcome.status`), extend the candidate list below.
# Missing exit_status is treated as success — intentionally conservative to
# avoid false alarms.
extract_exit_status() {
    local payload="$1" out=""
    [ -z "$payload" ] && { printf '0'; return 0; }
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r '
            .exit_status // .status // .exit_code // empty
        ' 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    v = d.get("exit_status")
    if v is None:
        v = d.get("status")
    if v is None:
        v = d.get("exit_code")
    print("" if v is None else v)
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    [ -z "$out" ] && out="0"
    printf '%s' "$out"
}

remove_matching_active_entry() {
    local file="$1" agent="$2" tmp=""
    [ -f "$file" ] || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    awk -v wanted="${agent##*:}" '
        BEGIN { removed=0 }
        {
            candidate=$2
            sub(/^.*:/, "", candidate)
            if (!removed && candidate == wanted) { removed=1; next }
            print
        }
    ' "$file" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp" "$file"
    fi
}

SUBAGENT="$(extract_subagent_name "$PAYLOAD")"
EXIT_STATUS="$(extract_exit_status "$PAYLOAD")"

case "${SUBAGENT##*:}" in
    fast-worker|codex-fast-worker|agy-fast-worker)
        remove_matching_active_entry "$SESS/$DHPK_SIDECAR_FAST_WORKER_ACTIVE" "$SUBAGENT"
        exit 0 ;;
esac

# Map subagent name → SENTINEL_AGENTS slot index → sentinel filename.
SLOT=-1
if [ -n "$SUBAGENT" ]; then
    for i in "${!SENTINEL_AGENTS[@]}"; do
        # ##*: strips the plugin namespace (dhpk:doc-reviewer -> doc-reviewer)
        # so plugin-prefixed dispatch identities match bare SENTINEL_AGENTS names.
        if [ "${SENTINEL_AGENTS[$i]##*:}" = "${SUBAGENT##*:}" ]; then
            SLOT="$i"
            break
        fi
    done
fi

# Not a reviewer agent (or schema missing subagent name) → silent exit 0.
if [ "$SLOT" -lt 0 ]; then
    exit 0
fi

SENTINEL_NAME="${SENTINEL_NAMES[$SLOT]}"
SENTINEL_FILE="$SESS/$SENTINEL_NAME"
ACTIVE_NAME="$(dhpk_active_marker "$SENTINEL_NAME")"
ACTIVE_FILE="$SESS/$ACTIVE_NAME"
TIMESTAMP="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
# Namespace-stripped reviewer identity (dhpk:database-reviewer -> database-reviewer)
# for the reviews-dir glob and ldb keys: review docs are named with the bare
# reviewer label (e.g. database-reviewer-*.md), so the raw prefixed $SUBAGENT
# would never match them under the real (agent_type) payload schema.
SUBAGENT_BARE="${SUBAGENT##*:}"

mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

remove_one_active_entry() {
    local file="$1" tmp=""
    [ -f "$file" ] || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    awk 'NR > 1 { print }' "$file" > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 0; }
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp" "$file"
    fi
}

# has_fresh_review_artifact <agent> <sentinel-file> — echo "1" when the latest
# review doc for <agent> EXISTS and is FRESH (its mtime postdates the sentinel
# that armed this review); "0" otherwise (no review doc, or only a stale
# prior-cycle doc). This is the A5 auto-clear gate: the sentinel clears only when
# a fresh matching review doc exists (reviewer-liveness-gate spec). It keys
# on existence + freshness ONLY — deliberately NOT on verdict-parseability, so a
# reviewer that legitimately wrote a fresh review doc whose `verdict:` field the
# regex can't parse still clears the gate rather than looping the orchestrator on
# an endless re-dispatch. Verdict-parseability is a separate concern owned by
# refresh_unresolved_verdict below (the BLOCK/FAIL/severity sidecar). Must be
# called while the sentinel file still exists (before the rm below).
has_fresh_review_artifact() {
    local agent="$1" sentinel="$2" reviews_dir="$ROOT/.claude/artifacts/reviews" latest=""
    [ -d "$reviews_dir" ] || { printf '0'; return 0; }
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || { printf '0'; return 0; }
    # Freshness gate: the newest review doc must postdate the sentinel that armed
    # this cycle. `find -newer` avoids stat(1) GNU-vs-BSD portability differences.
    [ -n "$(find "$latest" -newer "$sentinel" 2>/dev/null)" ] || { printf '0'; return 0; }
    printf '1'
}

# has_fresh_parseable_verdict <agent> <sentinel-file> — echo "1" when the latest
# review doc for <agent> exists, was produced THIS cycle (its mtime postdates
# the sentinel that armed this review), and its frontmatter carries a parseable
# `verdict:` field; "0" otherwise (no review doc, a stale doc from a prior
# cycle, or one whose frontmatter doesn't parse). Distinct from
# has_fresh_review_artifact above: this ALSO requires a parseable verdict, and is
# used only to decide whether a clear is silent (normal handoff) vs. worth a
# soft note — NOT to gate the clear itself. Must be called while the sentinel
# file still exists (before the rm below). Reuses the same "latest by mtime"
# lookup and verdict regex as refresh_unresolved_verdict below.
has_fresh_parseable_verdict() {
    local agent="$1" sentinel="$2" reviews_dir="$ROOT/.claude/artifacts/reviews" latest=""
    [ -d "$reviews_dir" ] || { printf '0'; return 0; }
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || { printf '0'; return 0; }
    # Freshness gate: the newest review doc must postdate the sentinel that armed
    # this cycle. `find -newer` avoids stat(1) GNU-vs-BSD portability differences.
    [ -n "$(find "$latest" -newer "$sentinel" 2>/dev/null)" ] || { printf '0'; return 0; }
    if command -v python3 >/dev/null 2>&1; then
        ARTIFACT_IN="$latest" python3 - <<'PY' 2>/dev/null || printf '0'
import os
import re
from pathlib import Path

review_doc = Path(os.environ["ARTIFACT_IN"])
try:
    text = review_doc.read_text(encoding="utf-8", errors="replace")
except OSError:
    print(0)
    raise SystemExit(0)

frontmatter = text
if text.startswith("---"):
    parts = text.split("---", 2)
    if len(parts) >= 3:
        frontmatter = parts[1]

verdict_match = re.search(r"(?im)^\s*verdict\s*:\s*['\"]?([A-Za-z_-]+)", frontmatter)
print(1 if verdict_match else 0)
PY
    else
        printf '0'
    fi
}

refresh_unresolved_verdict() {
    local sentinel="$1" agent="$2" reviews_dir="$ROOT/.claude/artifacts/reviews"
    local sidecar="$SESS/$DHPK_SIDECAR_UNRESOLVED_VERDICT" latest=""
    [ -d "$reviews_dir" ] || return 0
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || return 0

    mkdir -p "$SESS" 2>/dev/null || true
    SENTINEL_NAME_IN="$sentinel" AGENT_NAME_IN="$agent" ARTIFACT_IN="$latest" SIDECAR_IN="$sidecar" python3 - <<'PY' 2>/dev/null || true
import os
import re
from pathlib import Path

sentinel = os.environ["SENTINEL_NAME_IN"]
agent = os.environ["AGENT_NAME_IN"]
review_doc = Path(os.environ["ARTIFACT_IN"])
sidecar = Path(os.environ["SIDECAR_IN"])

try:
    text = review_doc.read_text(encoding="utf-8", errors="replace")
except OSError:
    raise SystemExit(0)

frontmatter = text
if text.startswith("---"):
    parts = text.split("---", 2)
    if len(parts) >= 3:
        frontmatter = parts[1]

verdict_match = re.search(r"(?im)^\s*verdict\s*:\s*['\"]?([A-Za-z_-]+)", frontmatter)
verdict = verdict_match.group(1).upper() if verdict_match else ""

def count(name):
    m = re.search(rf"(?i)\b{name}\b\s*:\s*(\d+)", frontmatter)
    return int(m.group(1)) if m else 0

critical = count("critical")
high = count("high")
medium = count("medium")
unresolved = verdict in {"BLOCK", "FAIL"} or critical > 0 or high > 0 or medium > 0

lines = []
if sidecar.exists():
    try:
        lines = [
            line for line in sidecar.read_text(encoding="utf-8", errors="replace").splitlines()
            if line and not line.startswith(sentinel + "\t")
        ]
    except OSError:
        lines = []

if unresolved:
    reason = f"{sentinel}\t{agent}\tverdict={verdict or 'UNKNOWN'} critical={critical} high={high} medium={medium} review_doc={review_doc.name}"
    lines.append(reason)

if lines:
    sidecar.write_text("\n".join(lines) + "\n", encoding="utf-8")
else:
    try:
        sidecar.unlink()
    except FileNotFoundError:
        pass
PY
}

# Liveness is independent of review success: a known reviewer has stopped, so
# exactly one in-flight entry for that slot is no longer active.
remove_one_active_entry "$ACTIVE_FILE"

if [ "$EXIT_STATUS" != "0" ]; then
    # Case A: subagent failed.
    SENTINEL_STATE="none"
    [ -f "$SENTINEL_FILE" ] && SENTINEL_STATE="$SENTINEL_NAME"
    echo "$TIMESTAMP $SUBAGENT exit=$EXIT_STATUS sentinel=$SENTINEL_STATE" >> "$LOG" || true
    ldb_record failure "agent:$SUBAGENT_BARE" "exit=$EXIT_STATUS"
    if [ "$PROFILE" != "minimal" ]; then
        msg="[subagent-verify] SUBAGENT FAILURE: $SUBAGENT (exit=$EXIT_STATUS)"
        if [ -f "$SENTINEL_FILE" ]; then
            msg="$msg
Sentinel still present: $SENTINEL_NAME — the next reviewer in the chain may not fire."
        fi
        msg="$msg
Logged to: .claude/artifacts/agent-failures.log"
        emit_system_message "$msg"
    fi
elif [ -f "$SENTINEL_FILE" ]; then
    # Determine freshness BEFORE any rm below — both helpers compare the latest
    # review doc's mtime against the sentinel file, which must still exist here.
    # FRESH_ARTIFACT (existence + freshness) is the A5 CLEAR gate; FRESH_VERDICT
    # (also requires a parseable verdict) only decides silent-vs-note on a clear.
    FRESH_ARTIFACT="$(has_fresh_review_artifact "$SUBAGENT_BARE" "$SENTINEL_FILE")"
    FRESH_VERDICT="$(has_fresh_parseable_verdict "$SUBAGENT_BARE" "$SENTINEL_FILE")"
    if [ "$FRESH_ARTIFACT" = "1" ]; then
        # Case B (cleared): subagent succeeded AND a fresh matching review
        # review doc exists — auto-clear the sentinel on the reviewer's behalf.
        # This IS the sanctioned clearance path (reviewer agent definitions no
        # longer instruct a self-run closing clear-sentinel.sh — the auto-mode
        # permission classifier blocks a reviewer running it on its own sentinel
        # as "Logging/Audit Tampering"). It fires at the same moment
        # (SubagentStop) the reviewer's own closing clear would have, scoped
        # strictly to this reviewer's own slot. Delegate to the SSOT clearer
        # (SENTINEL_NAMES whitelist + ldb success record); its stdout MUST be
        # suppressed so its plain text cannot corrupt this hook's single JSON
        # systemMessage envelope (a hook may emit at most one JSON object).
        # Both sides resolve ROOT via _lib/session-env.sh (CLAUDE_PROJECT_DIR
        # inherited by the child), so caller and clearer agree on the sentinel
        # path by construction — no defensive second rm needed. The direct rm
        # remains only as the fallback when the clearer is unavailable or fails.
        if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" ]; then
            bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" "$SENTINEL_NAME" "subagent-stop-auto" >/dev/null 2>&1 \
                || rm -f "$SENTINEL_FILE"
        else
            rm -f "$SENTINEL_FILE"
        fi
        if [ "$FRESH_VERDICT" = "1" ]; then
            # Designed handoff: a fresh, parseable review doc exists — the normal
            # path. No failure record, no warning.
            echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (auto-cleared)" >> "$LOG" || true
        else
            # A fresh review doc exists but its verdict didn't parse. The clear
            # still fires (existence + freshness satisfy the gate — do NOT loop
            # the orchestrator on an unparseable-but-present review); note it.
            echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (auto-cleared, verdict unparseable)" >> "$LOG" || true
        fi
    else
        # Case B (left armed) — A5: subagent stopped clean but produced NO fresh
        # matching review doc this cycle. Leave the sentinel ARMED so the
        # review gate stays unmet and the orchestrator re-dispatches per the
        # reviewer-liveness-gate no-op rules; log it and record the failure.
        # This deliberately reverses the prior "always clear (must not block the
        # chain)" behavior: a no-output reviewer clearing its own gate was the
        # 2026-07-13 defect this fix (A5) closes.
        echo "$TIMESTAMP $SUBAGENT exit=0 sentinel=$SENTINEL_NAME (left armed, no review doc)" >> "$LOG" || true
        ldb_record failure "sentinel-uncleared:$SENTINEL_NAME" "$SUBAGENT_BARE"
        if [ "$PROFILE" != "minimal" ]; then
            emit_system_message "[subagent-verify] NO REVIEW DOC: $SUBAGENT stopped clean but wrote no fresh review doc; LEFT $SENTINEL_NAME armed so the gate stays unmet — re-dispatch the reviewer.
Logged to: .claude/artifacts/agent-failures.log"
        fi
    fi
fi

if [ "$EXIT_STATUS" = "0" ]; then
    refresh_unresolved_verdict "$SENTINEL_NAME" "$SUBAGENT_BARE"
fi

# Advisory only — never block the chain.
exit 0
