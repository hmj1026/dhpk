#!/usr/bin/env bash
# Canonical source-only review identity construction, parsing and comparison.

[ -n "${_DHPK_REVIEW_LIFECYCLE_IDENTITY_LOADED:-}" ] && return 0
_DHPK_REVIEW_LIFECYCLE_IDENTITY_LOADED=1

DHPK_REVIEW_IDENTITY_FIELDS="task_id attempt_id scope_id diff_id session_id dispatch_attempt dispatch_id producer wave adapter stage plan_fingerprint artifact_fingerprint"
DHPK_REVIEW_IDENTITY_STRONG_FIELDS="task_id attempt_id scope_id diff_id session_id dispatch_attempt dispatch_id"
DHPK_REVIEW_IDENTITY_CONTEXT_FIELDS="producer wave adapter stage plan_fingerprint artifact_fingerprint"

dhpk_identity_normalize_field() {
    case "$1" in
        task|task_id) printf '%s' task_id ;; attempt|attempt_id) printf '%s' attempt_id ;;
        scope|scope_id) printf '%s' scope_id ;; diff|diff_id) printf '%s' diff_id ;;
        session|session_id|origin_session) printf '%s' session_id ;;
        dispatch_attempt|review_attempt) printf '%s' dispatch_attempt ;;
        dispatch_id|dispatch) printf '%s' dispatch_id ;; producer) printf '%s' producer ;;
        wave|wave_id) printf '%s' wave ;; adapter|adapter_id) printf '%s' adapter ;;
        stage|verification_stage) printf '%s' stage ;; plan_fingerprint|plan_id) printf '%s' plan_fingerprint ;;
        artifact_fingerprint|artifact_sha256) printf '%s' artifact_fingerprint ;; *) return 1 ;;
    esac
}

dhpk_identity_field_class() {
    case " $DHPK_REVIEW_IDENTITY_STRONG_FIELDS " in *" $1 "*) printf '%s\n' strong; return 0 ;; esac
    case " $DHPK_REVIEW_IDENTITY_CONTEXT_FIELDS " in *" $1 "*) printf '%s\n' context; return 0 ;; esac
    return 1
}

dhpk_identity_build() {
    [ "$#" -ge 5 ] || return 2
    ID_TASK="$1" ID_ATTEMPT="$2" ID_SCOPE="$3" ID_DIFF="$4" ID_SESSION="$5" \
    ID_DISPATCH_ATTEMPT="${6:-}" ID_DISPATCH_ID="${7:-}" ID_PRODUCER="${8:-}" ID_WAVE="${9:-}" \
    ID_ADAPTER="${10:-}" ID_STAGE="${11:-}" ID_PLAN="${12:-}" ID_ARTIFACT="${13:-}" python3 - <<'PY' 2>/dev/null
import os
fields = [('task_id','ID_TASK'),('attempt_id','ID_ATTEMPT'),('scope_id','ID_SCOPE'),('diff_id','ID_DIFF'),('session_id','ID_SESSION'),('dispatch_attempt','ID_DISPATCH_ATTEMPT'),('dispatch_id','ID_DISPATCH_ID'),('producer','ID_PRODUCER'),('wave','ID_WAVE'),('adapter','ID_ADAPTER'),('stage','ID_STAGE'),('plan_fingerprint','ID_PLAN'),('artifact_fingerprint','ID_ARTIFACT')]
def escape(value): return value.replace('\\','\\\\').replace('\t','\\t').replace('\n','\\n')
print('\t'.join('%s=%s' % (key, escape(os.environ.get(env,''))) for key, env in fields))
PY
}

dhpk_identity_serialize() {
    python3 -c 'import sys
order = "task_id attempt_id scope_id diff_id session_id dispatch_attempt dispatch_id producer wave adapter stage plan_fingerprint artifact_fingerprint".split()
values = {}
for token in sys.stdin.read().replace("\n", "\t").split("\t"):
    if "=" in token:
        key, value = token.split("=", 1); values[key] = value
print("\t".join("%s=%s" % (key, values.get(key, "")) for key in order))'
}

# Parse frontmatter into canonical key=value lines. Conflicting aliases fail.
dhpk_identity_parse_frontmatter() {
    [ -f "$1" ] || return 1
    ID_ARTIFACT="$1" python3 - <<'PY' 2>/dev/null
import os
aliases = {'task':'task_id','task_id':'task_id','attempt':'attempt_id','attempt_id':'attempt_id','scope':'scope_id','scope_id':'scope_id','diff':'diff_id','diff_id':'diff_id','session':'session_id','session_id':'session_id','origin_session':'session_id','dispatch_attempt':'dispatch_attempt','review_attempt':'dispatch_attempt','dispatch_id':'dispatch_id','dispatch':'dispatch_id','producer':'producer','wave':'wave','wave_id':'wave','adapter':'adapter','adapter_id':'adapter','stage':'stage','verification_stage':'stage','plan_fingerprint':'plan_fingerprint','plan_id':'plan_fingerprint','artifact_fingerprint':'artifact_fingerprint','artifact_sha256':'artifact_fingerprint'}
text = open(os.environ['ID_ARTIFACT'], encoding='utf-8', errors='replace').read()
parts = text.split('---', 2) if text.startswith('---') else []
front = parts[1] if len(parts) >= 3 else ''
raw_values = {}
for line in front.splitlines():
    if ':' not in line: continue
    raw_key, raw_value = line.split(':', 1); key = raw_key.strip().lower()
    if key not in aliases: continue
    value = raw_value.strip().strip("'\"")
    if key in raw_values and raw_values[key] != value: raise SystemExit(2)
    raw_values[key] = value
values = {}
for key in ('task_id','attempt_id','scope_id','diff_id','session_id','dispatch_attempt','dispatch_id','producer','wave','adapter','stage','plan_fingerprint','artifact_fingerprint'):
    candidates = [name for name, canonical in aliases.items() if canonical == key]
    selected = key if key in raw_values else next((name for name in candidates if name in raw_values), None)
    if selected: print('%s=%s' % (key, raw_values[selected]))
PY
}

# Compare an artifact while preserving the legacy scope/diff call boundary.
dhpk_identity_artifact_matches() {
    [ "$#" -ge 3 ] || return 1
    local artifact="$1" scope="$2" diff="$3" producer="${4:-}" wave="${5:-}" evidence_scope="${6:-}" adapter="${7:-}" stage="${8:-}" plan="${9:-}" artifact_fp="${10:-}" attempt="${11:-}" session="${12:-}" dispatch_attempt="${13:-}" dispatch_id="${14:-}" task="${15:-}" parsed key want actual declared new_identity
    [ -f "$artifact" ] || return 1
    parsed="$(dhpk_identity_parse_frontmatter "$artifact")" || return 1
    [ -n "$parsed" ] && declared=1 || declared=0
    new_identity=0
    while IFS= read -r key; do
        case "$key" in scope_id|diff_id|'') ;; *) new_identity=1 ;; esac
    done <<EOF
$(printf '%s\n' "$parsed" | awk -F= '{print $1}')
EOF
    for key in task_id scope_id diff_id producer wave adapter stage plan_fingerprint artifact_fingerprint attempt_id session_id dispatch_attempt dispatch_id; do
        case "$key" in
            task_id) want="$task";; scope_id) want="$scope";; diff_id) want="$diff";; producer) want="$producer";; wave) want="$wave";;
            adapter) want="$adapter";; stage) want="$stage";; plan_fingerprint) want="$plan";; artifact_fingerprint) want="$artifact_fp";;
            attempt_id) want="$attempt";; session_id) want="$session";; dispatch_attempt) want="$dispatch_attempt";; dispatch_id) want="$dispatch_id";;
        esac
        [ -n "$want" ] || continue
        actual="$(printf '%s\n' "$parsed" | awk -F= -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1); exit }')"
        if [ -n "$actual" ] && [ "$actual" != "$want" ]; then return 1; fi
        if [ "$key" = scope_id ] || [ "$key" = diff_id ]; then [ "$actual" = "$want" ] || return 1; fi
        if [ -z "$actual" ] && [ "$new_identity" -eq 1 ] && { [ "$key" = task_id ] || [ "$key" = attempt_id ] || [ "$key" = session_id ] || [ "$key" = dispatch_attempt ] || [ "$key" = dispatch_id ]; }; then return 1; fi
    done
    return 0
}

# Compare a JSON obligation with a frontmatter artifact. Legacy obligations
# without canonical fields remain on their established compatibility path.
dhpk_identity_artifact_matches_record() {
    [ "$#" -eq 2 ] || return 1
    local record="$1" artifact="$2" parsed key want actual identity=0
    parsed="$(dhpk_identity_parse_frontmatter "$artifact")" || return 1
    for key in $DHPK_REVIEW_IDENTITY_FIELDS; do
        want="$(ID_RECORD="$record" ID_KEY="$key" python3 -c 'import json,os; d=json.loads(os.environ["ID_RECORD"]); k=os.environ["ID_KEY"]; print(d.get(k, d.get("scope", "")) if k == "scope_id" else d.get(k, ""))' 2>/dev/null)"
        [ -n "$want" ] || continue
        identity=1
        actual="$(printf '%s\n' "$parsed" | awk -F= -v k="$key" '$1 == k { print substr($0, index($0, "=") + 1); exit }')"
        [ "$actual" = "$want" ] || return 1
    done
    [ "$identity" -eq 1 ] || return 0
    return 0
}
