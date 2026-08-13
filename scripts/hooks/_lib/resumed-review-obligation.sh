#!/usr/bin/env bash
# resumed-review-obligation.sh — CRUD + reconcile core for the SendMessage-
# resumed reviewer sentinel-clearance fallback (fix-resumed-review-sentinel-clearance).
#
# Background: subagent-stop-verify.sh auto-clears a reviewer's sentinel on a
# native SubagentStop event, and stop-review-reconcile.sh sweeps a background
# dispatch whose SubagentStop never fired (issue #76/#77) — but that sweep is
# scoped to slots with a lingering active-liveness marker (proof of dispatch
# THIS session). A reviewer resumed through SendMessage may already have had
# its first active marker removed by the ORIGINAL dispatch's SubagentStop,
# leaving the sentinel armed with no active marker to key a reconcile off of.
#
# This library records an explicit, session-scoped "resumed-review obligation"
# BEFORE the orchestrator calls SendMessage (dhpk_resumed_obligation_record),
# and reconciles it once a fresh canonical review doc proves the resumed
# reviewer actually finished (dhpk_resumed_reconcile_one /
# dhpk_resumed_reconcile_sweep). Sentinel clearance here is a LIFECYCLE
# transition only — .unresolved-verdict handling is refreshed identically, so
# a resumed BLOCK/FAIL or actionable-severity result stays visible and the
# completion gate stays unmet even though the sentinel clears.
#
# The obligation ledger `.resumed-review-obligations` is newline-delimited
# JSON, one active (state=pending) record per (sentinel, session_id) pair.
# Requires the caller to have already sourced _lib/session-env.sh
# (dhpk_reset_review_backoff, DHPK_SIDECAR_*) and, for the reconcile
# functions, _lib/sentinel-clear-core.sh (sentinel_remove_file). Source-only —
# never execute directly.

# Idempotent source guard.
[ -n "${_DHPK_RESUMED_OBLIGATION_LOADED:-}" ] && return 0
_DHPK_RESUMED_OBLIGATION_LOADED=1

_dhpk_resumed_file() { # <sess>
    printf '%s/%s' "$1" "$DHPK_SIDECAR_RESUMED_OBLIGATIONS"
}

# _dhpk_resumed_field <json-line> <field> — tiny field extractor.
_dhpk_resumed_field() {
    local line="$1" field="$2"
    command -v python3 >/dev/null 2>&1 || { printf ''; return 0; }
    LINE_IN="$line" FIELD_IN="$field" python3 -c '
import os, json
try:
    d = json.loads(os.environ["LINE_IN"])
    v = d.get(os.environ["FIELD_IN"], "")
    print(v if v is not None else "")
except Exception:
    pass
' 2>/dev/null || true
}

# dhpk_resumed_obligation_lookup <sess> <sentinel> <session_id>
# Echoes the matching PENDING record's raw JSON line, or nothing when no
# record exists, python3 is unavailable, or session_id is empty (fail closed —
# never match on an unknown/empty caller identity).
dhpk_resumed_obligation_lookup() {
    local sess="$1" sentinel="$2" sid="$3" file
    [ -n "$sid" ] || return 0
    file="$(_dhpk_resumed_file "$sess")"
    [ -f "$file" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    FILE_IN="$file" SENTINEL_IN="$sentinel" SID_IN="$sid" python3 -c '
import os, json

path = os.environ["FILE_IN"]
sentinel = os.environ["SENTINEL_IN"]
sid = os.environ["SID_IN"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        lines = [l for l in fh.read().splitlines() if l.strip()]
except OSError:
    raise SystemExit(0)
for line in lines:
    try:
        d = json.loads(line)
    except Exception:
        continue
    if d.get("sentinel") == sentinel and d.get("session_id") == sid and d.get("state") == "pending":
        print(line)
' 2>/dev/null || true
}

# dhpk_resumed_obligation_attempt <sess> <sentinel> <session_id> — echo the
# pending record's attempt count, or nothing when no record matches.
dhpk_resumed_obligation_attempt() {
    local record
    record="$(dhpk_resumed_obligation_lookup "$1" "$2" "$3")"
    [ -n "$record" ] || return 1
    _dhpk_resumed_field "$record" attempt
}

# dhpk_resumed_obligation_record <sess> <sentinel> <slot-label> <agent-bare>
#                                 <session_id> <baseline-name> <baseline-mtime>
# Atomically upsert the (sentinel, session_id) record — a repeated resume for
# the same slot/session updates the existing record (attempt += 1) instead of
# appending a second one (design decision 6). Requires python3; returns 1
# (records nothing) when unavailable so callers can surface a clear failure
# rather than silently pretending the obligation exists.
dhpk_resumed_obligation_record() {
    local sess="$1" sentinel="$2" slot="$3" agent="$4" sid="$5" baseline_name="$6" baseline_mtime="$7"
    local task_id="${8:-}" producer="${9:-}" wave="${10:-}" evidence_scope="${11:-}" adapter="${12:-}" stage="${13:-}"
    local plan_fingerprint="${14:-}" artifact_fingerprint="${15:-}" file tmp now dispatch
    [ -n "$sess" ] && [ -n "$sentinel" ] && [ -n "$sid" ] || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    mkdir -p "$sess" 2>/dev/null || return 1
    file="$(_dhpk_resumed_file "$sess")"
    now="$(date -Iseconds 2>/dev/null || date +%Y-%m-%dT%H:%M:%S%z)"
    dispatch="${sid}-$$-$(date +%s%N 2>/dev/null || date +%s)"
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    FILE_IN="$file" TMP_IN="$tmp" SENTINEL_IN="$sentinel" SLOT_IN="$slot" AGENT_IN="$agent" \
    SID_IN="$sid" BASELINE_NAME_IN="$baseline_name" BASELINE_MTIME_IN="$baseline_mtime" \
    NOW_IN="$now" DISPATCH_IN="$dispatch" TASK_ID_IN="$task_id" PRODUCER_IN="$producer" WAVE_IN="$wave" \
    EVIDENCE_SCOPE_IN="$evidence_scope" ADAPTER_IN="$adapter" STAGE_IN="$stage" PLAN_FINGERPRINT_IN="$plan_fingerprint" \
    ARTIFACT_FINGERPRINT_IN="$artifact_fingerprint" python3 -c '
import os, json

path = os.environ["FILE_IN"]
sentinel = os.environ["SENTINEL_IN"]
sid = os.environ["SID_IN"]

lines = []
if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            lines = [l for l in fh.read().splitlines() if l.strip()]
    except OSError:
        lines = []

attempt = 1
kept = []
previous = None
for line in lines:
    try:
        d = json.loads(line)
    except Exception:
        kept.append(line)
        continue
    if d.get("sentinel") == sentinel and d.get("session_id") == sid:
        attempt = int(d.get("attempt") or 0) + 1
        previous = d
        continue
    kept.append(line)

record = {
    "slot": os.environ["SLOT_IN"],
    "sentinel": sentinel,
    "agent": os.environ["AGENT_IN"],
    "session_id": sid,
    "dispatch_id": os.environ["DISPATCH_IN"],
    "resumed_at": os.environ["NOW_IN"],
    "artifact_baseline": os.environ["BASELINE_NAME_IN"],
    "artifact_baseline_mtime": os.environ["BASELINE_MTIME_IN"],
    "attempt": attempt,
    "state": "pending",
}
task_value = os.environ.get("TASK_ID_IN", "")
if task_value:
    record["task_id"] = task_value
    record["attempt_id"] = f"{task_value}:attempt:{attempt}"
# New identity fields are optional so records written by older callers remain
# readable. A corrected resume may replace them for the new attempt, while
# omitted values inherit the previous record when available.
optional = {
    "producer": os.environ.get("PRODUCER_IN", ""),
    "wave": os.environ.get("WAVE_IN", ""),
    "scope": os.environ.get("EVIDENCE_SCOPE_IN", ""),
    "adapter": os.environ.get("ADAPTER_IN", ""),
    "stage": os.environ.get("STAGE_IN", ""),
    "plan_fingerprint": os.environ.get("PLAN_FINGERPRINT_IN", ""),
    "artifact_fingerprint": os.environ.get("ARTIFACT_FINGERPRINT_IN", ""),
}
for key, value in optional.items():
    if not task_value:
        continue
    if value:
        record[key] = value
    elif previous and previous.get(key):
        record[key] = previous[key]
kept.append(json.dumps(record, sort_keys=True))
with open(os.environ["TMP_IN"], "w", encoding="utf-8") as fh:
    fh.write("\n".join(kept) + "\n")
' 2>/dev/null || { rm -f "$tmp"; return 1; }
    mv -f "$tmp" "$file" 2>/dev/null || { rm -f "$tmp"; return 1; }
    return 0
}

# dhpk_resumed_obligation_consume <sess> <sentinel> <session_id> — remove the
# matching (sentinel, session_id) record, whether pending or already
# reconciled. Idempotent: a no-match call is a silent no-op.
dhpk_resumed_obligation_consume() {
    local sess="$1" sentinel="$2" sid="$3" file tmp
    file="$(_dhpk_resumed_file "$sess")"
    [ -f "$file" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    tmp="$(mktemp 2>/dev/null || printf '%s.tmp.%s' "$file" "$$")"
    FILE_IN="$file" TMP_IN="$tmp" SENTINEL_IN="$sentinel" SID_IN="$sid" python3 -c '
import os, json

path = os.environ["FILE_IN"]
sentinel = os.environ["SENTINEL_IN"]
sid = os.environ["SID_IN"]
try:
    with open(path, "r", encoding="utf-8") as fh:
        lines = [l for l in fh.read().splitlines() if l.strip()]
except OSError:
    lines = []
kept = []
for line in lines:
    try:
        d = json.loads(line)
    except Exception:
        kept.append(line)
        continue
    if d.get("sentinel") == sentinel and d.get("session_id") == sid:
        continue
    kept.append(line)
with open(os.environ["TMP_IN"], "w", encoding="utf-8") as fh:
    if kept:
        fh.write("\n".join(kept) + "\n")
' 2>/dev/null || { rm -f "$tmp"; return 0; }
    if [ -s "$tmp" ]; then
        mv -f "$tmp" "$file" 2>/dev/null || rm -f "$tmp"
    else
        rm -f "$tmp" "$file"
    fi
    return 0
}

# _dhpk_resumed_fresh_artifact <root> <agent-bare> <sentinel-file>
#                               <baseline-name> <baseline-mtime>
# Echoes the latest matching canonical review-doc path when it postdates BOTH
# the current sentinel AND the obligation's recorded baseline (design decision
# 8 — freshness stricter than the normal sentinel sweep: a baseline-identical
# doc proves no new review ran during the resume). Nothing otherwise.
_dhpk_resumed_fresh_artifact() {
    local root="$1" agent="$2" sentinel="$3" baseline_name="$4" baseline_mtime="$5"
    local reviews_dir latest latest_base latest_mtime
    reviews_dir="$root/.claude/artifacts/reviews"
    [ -d "$reviews_dir" ] || return 1
    latest="$(ls -t "$reviews_dir/$agent"-*.md 2>/dev/null | head -1 || true)"
    [ -n "$latest" ] || return 1
    [ -n "$(find "$latest" -newer "$sentinel" 2>/dev/null)" ] || return 1
    latest_base="$(basename "$latest")"
    latest_mtime="$(stat -c %Y "$latest" 2>/dev/null || stat -f %m "$latest" 2>/dev/null || echo 0)"
    if [ -n "$baseline_name" ] && [ "$latest_base" = "$baseline_name" ] && [ "$latest_mtime" = "$baseline_mtime" ]; then
        return 1
    fi
    printf '%s' "$latest"
    return 0
}

# _dhpk_resumed_artifact_matches_identity <record-json> <artifact> — optional
# identity fields are strict when present in the obligation. Legacy records
# without them retain the established freshness/verdict contract.
_dhpk_resumed_artifact_matches_identity() {
    local record="$1" artifact="$2"
    [ -f "$artifact" ] || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    RECORD_IN="$record" ARTIFACT_IN="$artifact" python3 - <<'PY' 2>/dev/null
import json, os

try:
    obligation = json.loads(os.environ["RECORD_IN"])
    text = open(os.environ["ARTIFACT_IN"], encoding="utf-8", errors="replace").read()
except Exception:
    raise SystemExit(1)
parts = text.split("---", 2) if text.startswith("---") else []
front = parts[1] if len(parts) >= 3 else ""
values = {}
for line in front.splitlines():
    if ":" in line:
        key, value = line.split(":", 1)
        values[key.strip().lower()] = value.strip().strip("'\"")
aliases = {
    "scope": ("scope", "scope_id"),
    "artifact_fingerprint": ("artifact_fingerprint", "artifact_sha256"),
    "task_id": ("task_id",),
    "attempt_id": ("attempt_id",),
    "producer": ("producer",),
    "wave": ("wave", "wave_id"),
    "adapter": ("adapter", "adapter_id"),
    "stage": ("stage", "verification_stage"),
    "plan_fingerprint": ("plan_fingerprint", "plan_id"),
}
for key, expected in obligation.items():
    if key not in aliases or not expected:
        continue
    if not any(values.get(alias) == str(expected) for alias in aliases[key]):
        raise SystemExit(1)
raise SystemExit(0)
PY
}

# _dhpk_resumed_refresh_unresolved_verdict <sess> <sentinel> <agent-bare> <doc-path>
# Mirrors subagent-stop-verify.sh's refresh_unresolved_verdict so a resumed
# BLOCK/FAIL or nonzero critical/high/medium finding stays visible in
# .unresolved-verdict even though the sentinel lifecycle reconciles (design
# decisions 4/9): message finality only proves the review is DONE, never that
# it PASSED.
_dhpk_resumed_refresh_unresolved_verdict() {
    local sess="$1" sentinel="$2" agent="$3" doc="$4" sidecar
    command -v python3 >/dev/null 2>&1 || return 0
    sidecar="$sess/$DHPK_SIDECAR_UNRESOLVED_VERDICT"
    mkdir -p "$sess" 2>/dev/null || true
    SENTINEL_NAME_IN="$sentinel" AGENT_NAME_IN="$agent" ARTIFACT_IN="$doc" SIDECAR_IN="$sidecar" python3 - <<'PY' 2>/dev/null || true
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
# Resumed-specific divergence from subagent-stop-verify.sh's refresh (design
# decision 9): an unparseable verdict also counts as unresolved here — a
# malformed resumed result must never read as silent approval.
unresolved = (not verdict) or verdict in {"BLOCK", "FAIL"} or critical > 0 or high > 0 or medium > 0

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

# dhpk_resumed_reconcile_one <root> <sess> <sentinel-name> <agent-bare>
#                             <session_id> [label]
# The core reconcile decision for ONE slot. Returns 0 when either (a) already
# clear — idempotent consume, no error (decisions 3/10), or (b) freshly
# reconciled this call. Returns 1 (leaves both sentinel and obligation armed)
# when no matching obligation is owned by this session (decision 11 —
# ownership ambiguity fails closed) or no fresh review doc exists yet.
dhpk_resumed_reconcile_one() {
    local root="$1" sess="$2" name="$3" agent="$4" sid="$5" label="${6:-resumed-reconcile}"
    local sentinel_file="$sess/$name" record baseline_name baseline_mtime fresh
    record="$(dhpk_resumed_obligation_lookup "$sess" "$name" "$sid")"
    [ -n "$record" ] || return 1

    if [ ! -f "$sentinel_file" ]; then
        dhpk_resumed_obligation_consume "$sess" "$name" "$sid"
        echo "[$label] $name already clear — resumed obligation consumed" >&2
        return 0
    fi

    baseline_name="$(_dhpk_resumed_field "$record" artifact_baseline)"
    baseline_mtime="$(_dhpk_resumed_field "$record" artifact_baseline_mtime)"
    fresh="$(_dhpk_resumed_fresh_artifact "$root" "$agent" "$sentinel_file" "$baseline_name" "$baseline_mtime")" || {
        echo "[$label] $name: resumed obligation pending, no fresh review doc since baseline — left armed" >&2
        return 1
    }

    if ! _dhpk_resumed_artifact_matches_identity "$record" "$fresh"; then
        echo "[$label] $name: fresh review doc identity is foreign or incomplete — left armed" >&2
        return 1
    fi

    if [ -n "${CLAUDE_PLUGIN_ROOT:-}" ] && [ -f "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" ]; then
        bash "${CLAUDE_PLUGIN_ROOT}/scripts/hooks/clear-sentinel.sh" "$name" "$label" >/dev/null 2>&1 \
            || { sentinel_remove_file "$sentinel_file"; dhpk_reset_review_backoff "$sess" "$name"; }
    else
        sentinel_remove_file "$sentinel_file"
        dhpk_reset_review_backoff "$sess" "$name"
    fi
    _dhpk_resumed_refresh_unresolved_verdict "$sess" "$name" "$agent" "$fresh"
    dhpk_resumed_obligation_consume "$sess" "$name" "$sid"
    echo "[$label] $name reconciled (resumed SendMessage, fresh review doc: $(basename "$fresh"))" >&2
    return 0
}

# dhpk_resumed_reconcile_sweep <root> <sess> <session_id> — reconcile every
# configured slot's resumed obligation owned by <session_id>. Called from the
# Stop-time sweep alongside the active-marker sweep (stop-review-reconcile.sh)
# so a resumed reviewer whose first active marker already expired still gets
# reconciled without the orchestrator remembering to run the explicit CLI.
dhpk_resumed_reconcile_sweep() {
    local root="$1" sess="$2" sid="$3" i name agent_bare
    [ -n "$sid" ] || return 0
    for i in "${!SENTINEL_NAMES[@]}"; do
        name="${SENTINEL_NAMES[$i]}"
        agent_bare="${SENTINEL_AGENTS[$i]##*:}"
        dhpk_resumed_reconcile_one "$root" "$sess" "$name" "$agent_bare" "$sid" "stop-resumed-reconcile" || true
    done
}
