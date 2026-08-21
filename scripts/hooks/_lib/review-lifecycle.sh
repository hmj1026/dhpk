#!/usr/bin/env bash
# review-lifecycle.sh — durable orchestration/reviewer lifecycle primitives.
# Source-only. Durable state is session-scoped under .claude/artifacts/sessions.

[ -n "${_DHPK_REVIEW_LIFECYCLE_LOADED:-}" ] && return 0
_DHPK_REVIEW_LIFECYCLE_LOADED=1

_DHPK_REVIEW_LIFECYCLE_DIR="$(CDPATH= cd -- "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$_DHPK_REVIEW_LIFECYCLE_DIR/review-lifecycle-identity.sh"

: "${DHPK_SIDECAR_LIFECYCLE_EVENTS:=.lifecycle-events.jsonl}"
: "${DHPK_SIDECAR_ARTIFACT_READY:=.producer-ready.jsonl}"
: "${DHPK_SIDECAR_REVIEW_TELEMETRY:=.review-telemetry.jsonl}"
: "${DHPK_SIDECAR_RETRY_STATE:=.review-retry.jsonl}"
: "${DHPK_SIDECAR_QUOTA_STATE:=.quota-resume.jsonl}"
: "${DHPK_SIDECAR_AUDIT_READY:=.audit-ready.jsonl}"

_dhpk_lifecycle_root() {
    if command -v dhpk_root >/dev/null 2>&1; then dhpk_root; else printf '%s' "${CLAUDE_PROJECT_DIR:-$(pwd)}"; fi
}

_dhpk_lifecycle_sessions() {
    if command -v dhpk_sessions_dir >/dev/null 2>&1; then dhpk_sessions_dir "$(_dhpk_lifecycle_root)"; else printf '%s/.claude/artifacts/sessions' "$(_dhpk_lifecycle_root)"; fi
}

_dhpk_lifecycle_hash() {
    if command -v sha256sum >/dev/null 2>&1; then
        printf '%s' "$1" | sha256sum | awk '{print "sha256:" $1}'
    elif command -v shasum >/dev/null 2>&1; then
        printf '%s' "$1" | shasum -a 256 | awk '{print "sha256:" $1}'
    else
        printf '%s' "$1" | cksum | awk '{print "cksum:" $1 ":" $2}'
    fi
}

dhpk_lifecycle_scope_id() {
    local sentinel="$1" body=""
    [ -f "$sentinel" ] && body="$(cat "$sentinel" 2>/dev/null || true)"
    _dhpk_lifecycle_hash "$body"
}

dhpk_lifecycle_diff_id() {
    local root="${1:-$(_dhpk_lifecycle_root)}" body=""
    body="$(git -C "$root" diff HEAD --binary -- . 2>/dev/null || true)
$(git -C "$root" status --porcelain=v1 --untracked-files=all 2>/dev/null || true)"
    _dhpk_lifecycle_hash "$body"
}

dhpk_lifecycle_task_id() {
    local sentinel="$1" session="$2" attempt="${3:-}" value
    # The task is the durable scope identity.  Attempt is deliberately not
    # part of it: a corrected retry is another attempt of the same task, not a
    # second completion.  Keep the positional argument for old callers.
    value="review:${sentinel}:${session:-unknown}"
    printf '%s' "$value" | tr -c 'A-Za-z0-9._:-' '_'
}

dhpk_lifecycle_attempt_id() {
    local task="$1" attempt="${2:-0}"
    [ -n "$task" ] || return 1
    printf '%s:attempt:%s' "$task" "$attempt"
}

_dhpk_lifecycle_allowed_state() {
    case "$1" in
        planned|dispatched|started|artifact-ready|verdicted|failed-start|quota-blocked|blocked|incomplete|retrying) return 0 ;;
        *) return 1 ;;
    esac
}

_dhpk_lifecycle_current_state() {
    local file="$1" task="$2"
    [ -f "$file" ] || return 0
    command -v python3 >/dev/null 2>&1 || return 0
    FILE_IN="$file" TASK_IN="$task" python3 - <<'PY' 2>/dev/null || true
import json, os
path = os.environ['FILE_IN']; task = os.environ['TASK_IN']; last = ''
try:
    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            try:
                item = json.loads(raw)
            except Exception:
                continue
            # Pre-contract records used task_id=...:<attempt>.  Accept those
            # rows while new records use one stable task_id for every retry.
            if item.get('task_id') == task or str(item.get('task_id', '')).startswith(task + ':'):
                last = item.get('state', '')
except OSError:
    pass
print(last)
PY
}

_dhpk_lifecycle_transition_allowed() {
    local previous="$1" next="$2"
    [ -z "$previous" ] && return 0
    case "$previous:$next" in
        planned:dispatched|planned:quota-blocked|planned:blocked|planned:incomplete|planned:retrying|dispatched:started|dispatched:artifact-ready|dispatched:failed-start|dispatched:quota-blocked|dispatched:blocked|dispatched:incomplete|dispatched:retrying|started:artifact-ready|started:verdicted|started:failed-start|started:quota-blocked|started:blocked|started:incomplete|started:retrying|artifact-ready:verdicted|artifact-ready:blocked|artifact-ready:incomplete|quota-blocked:started|quota-blocked:dispatched|quota-blocked:blocked|quota-blocked:incomplete|retrying:dispatched|retrying:started|retrying:failed-start|retrying:quota-blocked|retrying:blocked|retrying:incomplete)
            return 0 ;;
        *) return 1 ;;
    esac
}

_dhpk_lifecycle_telemetry() {
    local state="$1" task="$2" scope="$3" diff="$4" verdict="$5" file
    file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_REVIEW_TELEMETRY"
    mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
    command -v python3 >/dev/null 2>&1 || return 0
    FILE_IN="$file" STATE_IN="$state" TASK_IN="$task" SCOPE_IN="$scope" DIFF_IN="$diff" VERDICT_IN="$verdict" \
    python3 - <<'PY' 2>/dev/null
import datetime, json, os
path = os.environ['FILE_IN']
totals = {'attempts': 0, 'started': 0, 'completed_verdicts': 0, 'fresh_artifacts': 0, 'retries': 0, 'unresolved_obligations': 0, 'resolved_obligations': 0}
try:
    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            try:
                item = json.loads(raw)
                for key in totals: totals[key] = int(item.get(key, totals[key]) or 0)
            except Exception:
                continue
except OSError:
    pass
state = os.environ['STATE_IN']; verdict = os.environ.get('VERDICT_IN', '').upper()
if state == 'dispatched': totals['attempts'] += 1
if state == 'started': totals['started'] += 1
if state == 'verdicted' and verdict: totals['completed_verdicts'] += 1
if state == 'artifact-ready': totals['fresh_artifacts'] += 1
if state == 'retrying': totals['retries'] += 1
if state in {'failed-start', 'quota-blocked', 'blocked', 'incomplete'}: totals['unresolved_obligations'] += 1
if state == 'verdicted' and verdict in {'PASS', 'APPROVE'}: totals['resolved_obligations'] += 1
totals.update({'schema_version': 1, 'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'last_state': state, 'last_task_id': os.environ['TASK_IN'], 'last_scope_id': os.environ['SCOPE_IN'], 'last_diff_id': os.environ['DIFF_IN']})
with open(path, 'a', encoding='utf-8') as fh:
    fh.write(json.dumps(totals, sort_keys=True) + '\n'); fh.flush(); os.fsync(fh.fileno())
PY
}

# dhpk_lifecycle_emit <state> <task> <agent> <session> <attempt> <scope_id>
#   <diff_id> <verdict> <artifact> [producer] [wave] [scope] [adapter]
#   [stage] [plan_fingerprint] [artifact_fingerprint] [adapter_version]
dhpk_lifecycle_emit() {
    local state="${1:-}" task="${2:-}" agent="${3:-}" session="${4:-}" attempt="${5:-0}"
    local scope="${6:-}" diff="${7:-}" verdict="${8:-}" artifact="${9:-}" file previous
    local producer="${10:-}" wave="${11:-}" evidence_scope="${12:-}" adapter="${13:-}"
    local stage="${14:-}" plan_fingerprint="${15:-}" artifact_fingerprint="${16:-}" adapter_version="${17:-}"
    _dhpk_lifecycle_allowed_state "$state" || return 2
    [ -n "$task" ] || return 2
    file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_LIFECYCLE_EVENTS"
    previous="$(_dhpk_lifecycle_current_state "$file" "$task")"
    _dhpk_lifecycle_transition_allowed "$previous" "$state" || return 2
    mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" STATE_IN="$state" TASK_IN="$task" AGENT_IN="$agent" SESSION_IN="$session" \
    ATTEMPT_IN="$attempt" SCOPE_IN="$scope" DIFF_IN="$diff" VERDICT_IN="$verdict" ARTIFACT_IN="$artifact" \
    PRODUCER_IN="$producer" WAVE_IN="$wave" EVIDENCE_SCOPE_IN="$evidence_scope" ADAPTER_IN="$adapter" \
    STAGE_IN="$stage" PLAN_FINGERPRINT_IN="$plan_fingerprint" ARTIFACT_FINGERPRINT_IN="$artifact_fingerprint" \
    ADAPTER_VERSION_IN="$adapter_version" \
    RESUMED_IN="${DHPK_LIFECYCLE_RESUMED:-false}" python3 - <<'PY' 2>/dev/null
import datetime, json, os, uuid
task = os.environ['TASK_IN']
attempt = int(os.environ.get('ATTEMPT_IN') or 0)
record = {'schema_version': 1, 'event_id': uuid.uuid4().hex, 'event_type': 'review-lifecycle', 'state': os.environ['STATE_IN'], 'task_id': task, 'attempt_id': f'{task}:attempt:{attempt}', 'agent': os.environ['AGENT_IN'], 'session_id': os.environ['SESSION_IN'], 'attempt': attempt, 'scope_id': os.environ['SCOPE_IN'], 'diff_id': os.environ['DIFF_IN'], 'verdict': os.environ['VERDICT_IN'], 'artifact': os.environ['ARTIFACT_IN'], 'occurred_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
optional = {
    'producer': os.environ.get('PRODUCER_IN', ''),
    'wave': os.environ.get('WAVE_IN', ''),
    'scope': os.environ.get('EVIDENCE_SCOPE_IN', ''),
    'adapter': os.environ.get('ADAPTER_IN', ''),
    'stage': os.environ.get('STAGE_IN', ''),
    'plan_fingerprint': os.environ.get('PLAN_FINGERPRINT_IN', ''),
    'artifact_fingerprint': os.environ.get('ARTIFACT_FINGERPRINT_IN', ''),
    'adapter_version': os.environ.get('ADAPTER_VERSION_IN', ''),
}
record.update({key: value for key, value in optional.items() if value})
if os.environ.get('RESUMED_IN') == 'true': record['resumed'] = True
with open(os.environ['FILE_IN'], 'a', encoding='utf-8') as fh:
    fh.write(json.dumps(record, sort_keys=True) + '\n'); fh.flush(); os.fsync(fh.fileno())
PY
    local rc=$?
    [ "$rc" -eq 0 ] || return "$rc"
    _dhpk_lifecycle_telemetry "$state" "$task" "$scope" "$diff" "$verdict" || true
    return 0
}

# Producer readiness marker.  The report is opened and fsynced before this
# record is appended, so a consumer can depend on the marker without a sleep.
dhpk_lifecycle_mark_artifact_ready() {
    local task="${1:-}" agent="${2:-}" session="${3:-}" attempt="${4:-0}" scope="${5:-}" diff="${6:-}" artifact="${7:-}"
    local producer="${8:-}" wave="${9:-}" evidence_scope="${10:-}" adapter="${11:-}" stage="${12:-}"
    local plan_fingerprint="${13:-}" artifact_fingerprint="${14:-}" adapter_version="${15:-}"
    local file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_ARTIFACT_READY"
    [ -n "$task" ] && [ -s "$artifact" ] || return 1
    mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" TASK_IN="$task" AGENT_IN="$agent" SESSION_IN="$session" ATTEMPT_IN="$attempt" \
    SCOPE_IN="$scope" DIFF_IN="$diff" ARTIFACT_IN="$artifact" PRODUCER_IN="$producer" WAVE_IN="$wave" \
    EVIDENCE_SCOPE_IN="$evidence_scope" ADAPTER_IN="$adapter" STAGE_IN="$stage" PLAN_FINGERPRINT_IN="$plan_fingerprint" \
    ARTIFACT_FINGERPRINT_IN="$artifact_fingerprint" ADAPTER_VERSION_IN="$adapter_version" python3 - <<'PY' 2>/dev/null
import datetime, hashlib, json, os
artifact = os.environ['ARTIFACT_IN']
with open(artifact, 'rb') as fh:
    data = fh.read()
    digest = hashlib.sha256(data).hexdigest()
task = os.environ['TASK_IN']
attempt = int(os.environ.get('ATTEMPT_IN') or 0)
record = {'schema_version': 1, 'state': 'artifact-ready', 'event_id': hashlib.sha256((task + artifact + digest).encode()).hexdigest(), 'task_id': task, 'attempt_id': f'{task}:attempt:{attempt}', 'agent': os.environ['AGENT_IN'], 'session_id': os.environ['SESSION_IN'], 'attempt': attempt, 'scope_id': os.environ['SCOPE_IN'], 'diff_id': os.environ['DIFF_IN'], 'artifact': artifact, 'artifact_sha256': digest, 'occurred_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
optional = {
    'producer': os.environ.get('PRODUCER_IN', ''),
    'wave': os.environ.get('WAVE_IN', ''),
    'scope': os.environ.get('EVIDENCE_SCOPE_IN', ''),
    'adapter': os.environ.get('ADAPTER_IN', ''),
    'stage': os.environ.get('STAGE_IN', ''),
    'plan_fingerprint': os.environ.get('PLAN_FINGERPRINT_IN', ''),
    'artifact_fingerprint': os.environ.get('ARTIFACT_FINGERPRINT_IN', ''),
    'adapter_version': os.environ.get('ADAPTER_VERSION_IN', ''),
}
record.update({key: value for key, value in optional.items() if value})
with open(os.environ['FILE_IN'], 'a', encoding='utf-8') as fh:
    fh.write(json.dumps(record, sort_keys=True) + '\n'); fh.flush(); os.fsync(fh.fileno())
PY
    [ "$?" -eq 0 ] || return 1
    dhpk_lifecycle_emit artifact-ready "$task" "$agent" "$session" "$attempt" "$scope" "$diff" "" "$artifact" \
        "$producer" "$wave" "$evidence_scope" "$adapter" "$stage" "$plan_fingerprint" "$artifact_fingerprint" "$adapter_version"
}

dhpk_lifecycle_require_ready() {
    local task="${1:-}" expected_attempt_id="${2:-}" expected_producer="${3:-}" expected_wave="${4:-}"
    local expected_scope="${5:-}" expected_adapter="${6:-}" expected_stage="${7:-}" expected_plan="${8:-}" expected_artifact="${9:-}"
    local file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_ARTIFACT_READY"
    [ -n "$task" ] && [ -f "$file" ] || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" TASK_IN="$task" ATTEMPT_ID_IN="$expected_attempt_id" PRODUCER_IN="$expected_producer" WAVE_IN="$expected_wave" \
    SCOPE_EXPECTED_IN="$expected_scope" ADAPTER_IN="$expected_adapter" STAGE_IN="$expected_stage" PLAN_IN="$expected_plan" ARTIFACT_FP_IN="$expected_artifact" \
    python3 - <<'PY' 2>/dev/null
import json, os
found = None
try:
    with open(os.environ['FILE_IN'], encoding='utf-8') as fh:
        for raw in fh:
            try:
                item = json.loads(raw)
                if item.get('task_id') == os.environ['TASK_IN']: found = item
            except Exception:
                continue
except OSError:
    pass
expected = {
    'attempt_id': os.environ.get('ATTEMPT_ID_IN', ''),
    'producer': os.environ.get('PRODUCER_IN', ''),
    'wave': os.environ.get('WAVE_IN', ''),
    'scope': os.environ.get('SCOPE_EXPECTED_IN', ''),
    'adapter': os.environ.get('ADAPTER_IN', ''),
    'stage': os.environ.get('STAGE_IN', ''),
    'plan_fingerprint': os.environ.get('PLAN_IN', ''),
    'artifact_fingerprint': os.environ.get('ARTIFACT_FP_IN', ''),
}
identity_ok = all(not value or found.get(key) == value for key, value in expected.items()) if found else False
ok = bool(found and identity_ok and found.get('state') == 'artifact-ready' and os.path.isfile(found.get('artifact', '')) and os.path.getsize(found['artifact']) > 0)
raise SystemExit(0 if ok else 1)
PY
}

# Audit reports use the same producer/consumer boundary but are not reviewer
# tasks.  These helpers deliberately keep a separate marker stream so an audit
# consumer cannot accidentally consume a review artifact marker.
dhpk_lifecycle_mark_report_ready() {
    local report_id="$1" report="$2" file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_AUDIT_READY"
    [ -n "$report_id" ] && [ -s "$report" ] || return 1
    mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" ID_IN="$report_id" REPORT_IN="$report" python3 - <<'PY' 2>/dev/null
import datetime, hashlib, json, os
report = os.environ['REPORT_IN']
with open(report, 'rb') as fh: digest = hashlib.sha256(fh.read()).hexdigest()
record = {'schema_version': 1, 'state': 'audit-report-ready', 'report_id': os.environ['ID_IN'], 'report': report, 'report_sha256': digest, 'occurred_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
with open(os.environ['FILE_IN'], 'a', encoding='utf-8') as fh:
    fh.write(json.dumps(record, sort_keys=True) + '\n'); fh.flush(); os.fsync(fh.fileno())
PY
}

dhpk_lifecycle_require_report_ready() {
    local report_id="$1" file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_AUDIT_READY"
    [ -n "$report_id" ] && [ -f "$file" ] || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" ID_IN="$report_id" python3 - <<'PY' 2>/dev/null
import json, os
found = None
with open(os.environ['FILE_IN'], encoding='utf-8') as fh:
    for raw in fh:
        try:
            item = json.loads(raw)
            if item.get('report_id') == os.environ['ID_IN']: found = item
        except Exception: continue
raise SystemExit(0 if found and found.get('state') == 'audit-report-ready' and os.path.isfile(found.get('report', '')) and os.path.getsize(found['report']) > 0 else 1)
PY
}

dhpk_lifecycle_artifact_has_identity() {
    local artifact="$1"
    command -v python3 >/dev/null 2>&1 || return 1
    ARTIFACT_IN="$artifact" python3 - <<'PY' 2>/dev/null
import os
text = open(os.environ['ARTIFACT_IN'], encoding='utf-8', errors='replace').read()
parts = text.split('---', 2) if text.startswith('---') else []
front = parts[1] if len(parts) >= 3 else ''
values = {}
for line in front.splitlines():
    if ':' in line:
        key, value = line.split(':', 1); values[key.strip().lower()] = value.strip().strip("'\"")
raise SystemExit(0 if values.get('scope_id') and values.get('diff_id') else 1)
PY
}

dhpk_lifecycle_artifact_matches() {
    local artifact="$1" scope="$2" diff="$3" expected_producer="${4:-}" expected_wave="${5:-}"
    local expected_scope="${6:-}" expected_adapter="${7:-}" expected_stage="${8:-}" expected_plan="${9:-}"
    local expected_artifact="${10:-}" expected_attempt_id="${11:-}" expected_session="${12:-}"
    local expected_dispatch_attempt="${13:-}" expected_dispatch_id="${14:-}" expected_task="${15:-}"
    dhpk_identity_artifact_matches "$artifact" "$scope" "$diff" "$expected_producer" "$expected_wave" \
        "$expected_scope" "$expected_adapter" "$expected_stage" "$expected_plan" "$expected_artifact" \
        "$expected_attempt_id" "$expected_session" "$expected_dispatch_attempt" "$expected_dispatch_id" "$expected_task"
}

dhpk_lifecycle_artifact_verdict() {
    local artifact="$1"
    command -v python3 >/dev/null 2>&1 || return 1
    ARTIFACT_IN="$artifact" python3 - <<'PY' 2>/dev/null
import os, re
text = open(os.environ['ARTIFACT_IN'], encoding='utf-8', errors='replace').read()
parts = text.split('---', 2) if text.startswith('---') else []
front = parts[1] if len(parts) >= 3 else ''
m = re.search(r'(?im)^\s*verdict\s*:\s*["\']?([A-Za-z_-]+)', front)
print(m.group(1).upper() if m else '')
PY
}

# dhpk_lifecycle_artifact_is_passing <artifact> <reviewer> — validate the
# canonical reviewer artifact contract before a consumer treats it as a
# passing completion. Freshness and lifecycle scope/diff identity are
# deliberately checked by the caller; this helper owns the shared
# frontmatter, filename, reviewer ownership, and passing-verdict checks.
dhpk_lifecycle_artifact_is_passing() {
    local artifact="$1" reviewer="$2"
    [ -f "$artifact" ] || return 1
    [ -n "$reviewer" ] || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    ARTIFACT_IN="$artifact" REVIEWER_IN="$reviewer" python3 - <<'PY' 2>/dev/null
import os
import re
from pathlib import Path

review_doc = Path(os.environ["ARTIFACT_IN"])
reviewer = os.environ["REVIEWER_IN"]
try:
    text = review_doc.read_text(encoding="utf-8", errors="replace")
except OSError:
    raise SystemExit(1)

filename = re.compile(
    rf"^{re.escape(reviewer)}-\d{{8}}-\d{{6}}-[a-z0-9][a-z0-9._-]*\.md$",
    re.IGNORECASE,
)
frontmatter_match = re.match(r"\A---\r?\n(.*?)\r?\n---(?:\r?\n|\Z)", text, re.DOTALL)
if not filename.fullmatch(review_doc.name) or not frontmatter_match:
    raise SystemExit(1)

frontmatter = frontmatter_match.group(1)
def field(name):
    return re.search(rf"(?im)^\s*{name}\s*:\s*(.+?)\s*$", frontmatter)

agent_match = field("agent")
generated_at = field("generated_at")
commit = field("commit")
scope = field("scope")
severity = field("severity_summary")
verdict_match = field("verdict")
required = all((agent_match, generated_at, commit, scope, severity, verdict_match))
timestamp_ok = bool(generated_at and re.match(r"\d{4}-\d{2}-\d{2}T", generated_at.group(1)))
agent_ok = bool(agent_match and agent_match.group(1).strip().strip("'\"") == reviewer)
verdict = verdict_match.group(1).strip().strip("'\"").upper() if verdict_match else ""
raise SystemExit(0 if required and timestamp_ok and agent_ok and verdict in {"APPROVE", "PASS"} else 1)
PY
}

# dhpk_lifecycle_dispatch_record <sentinel> <agent> <session> — return the
# newest exact dispatch-attempt row for this reviewer slot. A Stop-time
# fallback has no SubagentStop payload to establish ownership, so an active
# marker alone is insufficient; callers must bind the artifact to this row.
dhpk_lifecycle_dispatch_record() {
    local sentinel="$1" agent="$2" session="$3"
    local file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_REVIEW_DISPATCH" row=""
    [ -n "$sentinel" ] && [ -n "$agent" ] && [ -n "$session" ] && [ "$session" != "unknown" ] || return 1
    [ -f "$file" ] || return 1
    row="$(awk -F '\t' -v n="$sentinel" -v a="$agent" -v s="$session" \
        '$1 == n && $3 == s && $6 == a { row = $0 } END { if (row != "") print row; else exit 1 }' \
        "$file" 2>/dev/null || true)"
    [ -n "$row" ] || return 1
    printf '%s' "$row"
}

# dhpk_lifecycle_artifact_matches_dispatch <artifact> <session> <attempt>
# <dispatch> — require explicit artifact provenance for a Stop-time fallback.
# Legacy freshness-only evidence is intentionally not accepted here: without
# the session/attempt/dispatch tuple, a concurrent session can satisfy the
# shared canonical review glob by accident.
dhpk_lifecycle_artifact_matches_dispatch() {
    local artifact="$1" session="$2" attempt="$3" dispatch="$4"
    [ -f "$artifact" ] && [ -n "$session" ] && [ -n "$attempt" ] && [ -n "$dispatch" ] || return 1
    dhpk_identity_artifact_matches "$artifact" "" "" "" "" "" "" "" "" "" "" \
        "$session" "$attempt" "$dispatch"
}

dhpk_lifecycle_context() {
    local agent="$1" session="${2:-}" file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_LIFECYCLE_EVENTS"
    [ -f "$file" ] || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" AGENT_IN="$agent" SESSION_IN="$session" python3 - <<'PY' 2>/dev/null
import json, os
found = None
try:
    with open(os.environ['FILE_IN'], encoding='utf-8') as fh:
        for raw in fh:
            try: item = json.loads(raw)
            except Exception: continue
            if item.get('agent') == os.environ['AGENT_IN'] and (not os.environ['SESSION_IN'] or item.get('session_id') == os.environ['SESSION_IN']) and item.get('state') in {'planned','dispatched','started','retrying','quota-blocked'}:
                found = item
except OSError:
    pass
if found:
    print('\t'.join(str(found.get(k, '')) for k in (
        'task_id', 'attempt', 'scope_id', 'diff_id', 'session_id',
        'producer', 'wave', 'scope', 'adapter', 'stage',
        'plan_fingerprint', 'artifact_fingerprint', 'adapter_version',
    )))
PY
}

# Exactly one corrected retry per task/scope/diff identity.  The keyed ledger
# is atomically replaced, so concurrent consumers cannot spend an unbounded
# retry budget by racing an append-only log.
dhpk_lifecycle_retry_once() {
    local task="$1" session="$2" scope="$3" diff="$4" reason="${5:-incomplete}"
    local file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_RETRY_STATE" result
    [ -n "$task" ] || return 2
    case "$reason" in missing-start|missing-artifact|failed-start|incomplete|quota-blocked) ;; *) return 2 ;; esac
    mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" TASK_IN="$task" SESSION_IN="$session" SCOPE_IN="$scope" DIFF_IN="$diff" REASON_IN="$reason" python3 - <<'PY' 2>/dev/null
import datetime, json, os, tempfile
path = os.environ['FILE_IN']; key = (os.environ['TASK_IN'], os.environ['SESSION_IN'], os.environ['SCOPE_IN'], os.environ['DIFF_IN']); rows = []; found = None
try:
    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            try: row = json.loads(raw)
            except Exception: continue
            if (row.get('task_id'), row.get('session_id'), row.get('scope_id'), row.get('diff_id')) == key: found = row
            else: rows.append(row)
except OSError: pass
count = int((found or {}).get('retry_count', 0) or 0)
if count >= 1: raise SystemExit(3)
rows.append({'schema_version': 1, 'task_id': key[0], 'session_id': key[1], 'scope_id': key[2], 'diff_id': key[3], 'retry_count': count + 1, 'max_retries': 1, 'corrected': True, 'reason': os.environ['REASON_IN'], 'state': 'retrying', 'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
tmp = tempfile.NamedTemporaryFile('w', encoding='utf-8', delete=False, dir=os.path.dirname(path))
try:
    tmp.write('\n'.join(json.dumps(row, sort_keys=True) for row in rows) + '\n'); tmp.flush(); os.fsync(tmp.fileno()); tmp.close(); os.replace(tmp.name, path)
except Exception:
    try: os.unlink(tmp.name)
    except OSError: pass
    raise
PY
    result=$?
    [ "$result" -eq 0 ] || return "$result"
    dhpk_lifecycle_emit retrying "$task" "" "$session" 0 "$scope" "$diff" "" "$reason" || true
    return 0
}

dhpk_lifecycle_quota_block() {
    local task="$1" session="$2" scope="$3" diff="$4" file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_QUOTA_STATE"
    [ -n "$task" ] || return 2
    mkdir -p "$(dirname "$file")" 2>/dev/null || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    FILE_IN="$file" TASK_IN="$task" SESSION_IN="$session" SCOPE_IN="$scope" DIFF_IN="$diff" python3 - <<'PY' 2>/dev/null
import datetime, json, os, tempfile
path = os.environ['FILE_IN']; key = (os.environ['TASK_IN'], os.environ['SESSION_IN']); rows = []
try:
    with open(path, encoding='utf-8') as fh:
        for raw in fh:
            try: row = json.loads(raw)
            except Exception: continue
            if (row.get('task_id'), row.get('session_id')) != key: rows.append(row)
except OSError: pass
rows.append({'schema_version': 1, 'task_id': key[0], 'session_id': key[1], 'scope_id': os.environ['SCOPE_IN'], 'diff_id': os.environ['DIFF_IN'], 'state': 'quota-blocked', 'resumed': False, 'updated_at': datetime.datetime.now(datetime.timezone.utc).isoformat()})
tmp = tempfile.NamedTemporaryFile('w', encoding='utf-8', delete=False, dir=os.path.dirname(path))
tmp.write('\n'.join(json.dumps(row, sort_keys=True) for row in rows) + '\n'); tmp.flush(); os.fsync(tmp.fileno()); tmp.close(); os.replace(tmp.name, path)
PY
    [ "$?" -eq 0 ] || return 1
    dhpk_lifecycle_emit quota-blocked "$task" "" "$session" 0 "$scope" "$diff" "" "" || true
}

dhpk_lifecycle_quota_resume() {
    local task="$1" session="$2" file="$(_dhpk_lifecycle_sessions)/$DHPK_SIDECAR_QUOTA_STATE" result scope diff
    [ -n "$task" ] && [ -f "$file" ] || return 1
    command -v python3 >/dev/null 2>&1 || return 1
    result="$(FILE_IN="$file" TASK_IN="$task" SESSION_IN="$session" python3 - <<'PY' 2>/dev/null
import datetime, json, os, tempfile
path = os.environ['FILE_IN']; task = os.environ['TASK_IN']; session = os.environ['SESSION_IN']; rows = []; found = None
with open(path, encoding='utf-8') as fh:
    for raw in fh:
        try: row = json.loads(raw)
        except Exception: continue
        if row.get('task_id') == task and row.get('session_id') == session: found = row
        else: rows.append(row)
if not found or found.get('state') != 'quota-blocked': raise SystemExit(3)
found['state'] = 'resumed'; found['resumed'] = True; found['resumed_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat(); rows.append(found)
tmp = tempfile.NamedTemporaryFile('w', encoding='utf-8', delete=False, dir=os.path.dirname(path))
tmp.write('\n'.join(json.dumps(row, sort_keys=True) for row in rows) + '\n'); tmp.flush(); os.fsync(tmp.fileno()); tmp.close(); os.replace(tmp.name, path)
print(found.get('scope_id', '') + '\t' + found.get('diff_id', ''))
PY
    )"
    [ -n "$result" ] || return 1
    IFS=$'\t' read -r scope diff <<< "$result"
    DHPK_LIFECYCLE_RESUMED=true dhpk_lifecycle_emit started "$task" "" "$session" 0 "$scope" "$diff" "" "" || return 1
}
