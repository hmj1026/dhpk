#!/usr/bin/env bash
# session-start.sh — SessionStart hook
#
# Responsibilities:
#   1. Pre-create .claude/artifacts/{reviews,plans,audits,refactors,codemaps,adr,sessions}/
#   2. Write .claude/artifacts/sessions/latest.md snapshot (branch, staged, modified)
#   3. Check configured docker containers (CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS); empty list skips check
#   4. Activate modules (CLAUDE_PLUGIN_OPTION_MODULES): parse module.yaml, validate requires,
#      print activation line, export DHPK_ACTIVE_MODULES for downstream hooks
#   5. Honour CLAUDE_PLUGIN_OPTION_HOOK_PROFILE={minimal|standard|strict}; strict adds docker WARN lines

set -o pipefail

PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
ARTIFACTS="$ROOT/.claude/artifacts"
SESSION_FILE="$ARTIFACTS/sessions/latest.md"

mkdir -p "$ARTIFACTS/reviews" "$ARTIFACTS/plans" "$ARTIFACTS/audits" \
         "$ARTIFACTS/refactors" "$ARTIFACTS/codemaps" "$ARTIFACTS/adr" \
         "$ARTIFACTS/sessions"

TS="$(date +'%Y-%m-%d %H:%M:%S %Z')"
BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '(detached)')"
STAGED="$(git -C "$ROOT" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
MODIFIED="$(git -C "$ROOT" diff --name-only 2>/dev/null | wc -l | tr -d ' ')"
UNTRACKED="$(git -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')"

# ---- Docker container check (only when configured) ----
DOCKER_STATUS="(no containers configured)"
DOCKER_WARNS=""
if [ -n "${CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS:-}" ]; then
    if command -v docker >/dev/null 2>&1; then
        NAMES="$(docker ps --format '{{.Names}}' 2>/dev/null || true)"
        IFS=',' read -r -a _containers <<< "${CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS}"
        _ok=()
        _bad=()
        for _c in "${_containers[@]}"; do
            _c="$(echo "$_c" | xargs)"
            [ -z "$_c" ] && continue
            if echo "$NAMES" | grep -q "^${_c}$"; then
                _ok+=("$_c")
            else
                _bad+=("$_c")
                [ "$PROFILE" = "strict" ] && DOCKER_WARNS="${DOCKER_WARNS}"$'\n'"- [WARN] container '$_c' not running"
            fi
        done
        if [ ${#_bad[@]} -eq 0 ]; then
            DOCKER_STATUS="ok (${#_ok[@]})"
        elif [ ${#_ok[@]} -eq 0 ]; then
            DOCKER_STATUS="down (${#_bad[@]} missing)"
        else
            DOCKER_STATUS="partial (${#_ok[@]}/${#_containers[@]})"
        fi
    else
        DOCKER_STATUS="(docker cli missing)"
    fi
fi

# ---- Module activation ----
ACTIVE_MODULES=""
MODULE_LINES=""
if [ -n "${CLAUDE_PLUGIN_OPTION_MODULES:-}" ]; then
    if ! command -v python3 >/dev/null 2>&1; then
        echo "[session-start] WARN: modules enabled (${CLAUDE_PLUGIN_OPTION_MODULES}) but python3 missing — module metadata not parsed; per-module path triggers will not fire. Install python3 to enable full module support." >&2
    fi
    IFS=',' read -r -a _mods <<< "${CLAUDE_PLUGIN_OPTION_MODULES}"
    declare -A _enabled
    for _m in "${_mods[@]}"; do
        _m="$(echo "$_m" | xargs)"
        [ -z "$_m" ] && continue
        _enabled["$_m"]=1
    done
    for _m in "${!_enabled[@]}"; do
        _mdir="$PLUGIN_ROOT/modules/$_m"
        if [ ! -d "$_mdir" ]; then
            echo "[session-start] WARN: module '$_m' not found at $_mdir" >&2
            continue
        fi
        _yaml="$_mdir/module.yaml"
        _display="$_m"
        _requires=""
        if [ -f "$_yaml" ] && command -v python3 >/dev/null 2>&1; then
            read -r _display _requires < <(python3 - "$_yaml" <<'PY' 2>/dev/null
import sys
try:
    with open(sys.argv[1]) as f:
        text = f.read()
except Exception:
    print(""); sys.exit(0)
disp = ""
reqs = []
for raw in text.splitlines():
    line = raw.strip()
    if line.startswith("display_name:"):
        v = line.split(":", 1)[1].strip().strip('"').strip("'")
        disp = v
    if line.startswith("requires:"):
        v = line.split(":", 1)[1].strip()
        if v.startswith("[") and v.endswith("]"):
            inner = v[1:-1].strip()
            if inner:
                reqs = [x.strip().strip('"').strip("'") for x in inner.split(",")]
print(disp or "", ",".join(reqs))
PY
)
        fi
        [ -z "$_display" ] && _display="$_m"
        MODULE_LINES="${MODULE_LINES}"$'\n'"[session-start] module enabled: $_m — $_display"
        if [ -n "$_requires" ]; then
            IFS=',' read -r -a _r <<< "$_requires"
            for _req in "${_r[@]}"; do
                if [ -z "${_enabled[$_req]:-}" ]; then
                    echo "[session-start] WARN: module '$_m' requires '$_req' but it is not enabled" >&2
                fi
            done
        fi
        ACTIVE_MODULES="${ACTIVE_MODULES}${ACTIVE_MODULES:+,}$_m"
    done
    export DHPK_ACTIVE_MODULES="$ACTIVE_MODULES"
fi

# ---- Write snapshot ----
cat > "$SESSION_FILE" <<EOF
# Session Snapshot

- generated_at: $TS
- branch: $BRANCH
- staged: $STAGED / modified: $MODIFIED / untracked: $UNTRACKED
- docker: $DOCKER_STATUS
- hook_profile: $PROFILE
- modules: ${ACTIVE_MODULES:-(none)}
$DOCKER_WARNS
EOF

# ---- stdout summary (enters chat) ----
echo "[session-start] branch=$BRANCH docker=$DOCKER_STATUS profile=$PROFILE modules=${ACTIVE_MODULES:-none}"
[ -n "$MODULE_LINES" ] && echo "$MODULE_LINES" | sed '/^$/d'
[ -n "$DOCKER_WARNS" ] && echo "[session-start] strict-profile warnings:$DOCKER_WARNS"

exit 0
