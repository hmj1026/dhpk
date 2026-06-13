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

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Overlay project-level pluginConfigs onto CLAUDE_PLUGIN_OPTION_* env vars.
# Claude Code only injects global pluginConfigs; per-project .claude/settings.local.json
# overrides are loaded here so dhpk modules / hook_profile / etc. respect the
# project's intent. See _lib/load-project-config.sh for precedence rules.
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/learning-db.sh"

PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"
ARTIFACTS="$ROOT/.claude/artifacts"
SESSION_FILE="$ARTIFACTS/sessions/latest.md"

mkdir -p "$ARTIFACTS/reviews" "$ARTIFACTS/plans" "$ARTIFACTS/audits" \
         "$ARTIFACTS/refactors" "$ARTIFACTS/codemaps" "$ARTIFACTS/adr" \
         "$ARTIFACTS/sessions"

# ---- Optional: reap ORPHANED gitnexus MCP processes ----
# Each session may spawn a fresh `gitnexus mcp` process; when a session exits
# uncleanly the child is reparented to init (ppid 1) and lingers. Concurrent
# writers contending for the same DB lock can corrupt the FTS index. Opt-in via
# userConfig.reap_stale_mcp_processes — disabled by default so projects that
# don't use gitnexus see no behaviour change.
# CAUTION: only orphans are reaped (parent gone / reparented to pid 1). A
# process still owned by a live parallel session in the same repo must NOT be
# killed — that would disconnect THAT session's MCP server ("1 failed" on its
# next call, and a prompt-cache bust on prefix-loaded tool setups). Reaping
# cannot safely resolve two live sessions sharing one DB; it only clears orphans.
# Liveness is probed with `ps -p` (ownership-agnostic) rather than `kill -0`,
# which returns EPERM for a live cross-user parent (sudo / container root) and
# would mis-reap it. On systemd-user hosts an orphan may reparent to
# `systemd --user` (ppid≠1, still alive) and go undetected — a benign miss.
if [ "${CLAUDE_PLUGIN_OPTION_REAP_STALE_MCP_PROCESSES:-false}" = "true" ] \
   && command -v pgrep >/dev/null 2>&1 && command -v ps >/dev/null 2>&1; then
    _gn_reaped=0
    for _gn_pid in $(pgrep -f "gitnexus mcp" 2>/dev/null); do
        _gn_ppid="$(ps -o ppid= -p "$_gn_pid" 2>/dev/null | tr -d ' ')"
        if [ -z "$_gn_ppid" ] || [ "$_gn_ppid" = "1" ] || ! ps -p "$_gn_ppid" >/dev/null 2>&1; then
            kill "$_gn_pid" 2>/dev/null && _gn_reaped=$((_gn_reaped + 1))
        fi
    done
    [ "$_gn_reaped" -gt 0 ] && echo "[session-start] reaped $_gn_reaped orphaned gitnexus mcp processes"
    unset _gn_pid _gn_ppid _gn_reaped
fi

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
    # Dedup while preserving declaration order. Space-delimited membership
    # check instead of `declare -A` — associative arrays are bash 4+ and stock
    # macOS ships bash 3.2 (module names never contain spaces).
    _enabled_list=""
    for _m in "${_mods[@]}"; do
        _m="$(echo "$_m" | xargs)"
        [ -z "$_m" ] && continue
        case " $_enabled_list " in
            *" $_m "*) ;;
            *) _enabled_list="$_enabled_list $_m" ;;
        esac
    done
    for _m in $_enabled_list; do
        _mdir="$PLUGIN_ROOT/modules/$_m"
        if [ ! -d "$_mdir" ]; then
            echo "[session-start] WARN: module '$_m' not found at $_mdir" >&2
            continue
        fi
        _yaml="$_mdir/module.yaml"
        _display="$_m"
        _requires=""
        if [ -f "$_yaml" ] && command -v python3 >/dev/null 2>&1; then
            # Tab-separated: display_name may contain spaces ("Yii 1.1 Framework"),
            # so a whitespace read would truncate it and corrupt the requires list.
            IFS=$'\t' read -r _display _requires < <(python3 - "$_yaml" <<'PY' 2>/dev/null
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
print((disp or "") + "\t" + ",".join(reqs))
PY
)
        fi
        [ -z "$_display" ] && _display="$_m"
        MODULE_LINES="${MODULE_LINES}"$'\n'"[session-start] module enabled: $_m — $_display"
        if [ -n "$_requires" ]; then
            IFS=',' read -r -a _r <<< "$_requires"
            for _req in "${_r[@]}"; do
                case " $_enabled_list " in
                    *" $_req "*) ;;
                    *) echo "[session-start] WARN: module '$_m' requires '$_req' but it is not enabled" >&2 ;;
                esac
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

# ---- Cross-session learned context (opt-in via learning_db_enabled) ----
# Surface the top recurring signatures so the model starts the session aware of
# what prior sessions learned. Capped at 5 lines (~well under 500 tokens) to
# keep the context budget small. No-op unless the learning DB is enabled and
# has at least one signature with ≥2 observations.
if ldb_enabled; then
    _ldb_top="$(ldb_top 5 2 2>/dev/null || true)"
    if [ -n "$_ldb_top" ]; then
        echo "[learned-context] cross-session patterns (confidence/observations — higher confidence = more established):"
        while IFS=$'\t' read -r _conf _obs _days _kind _sig; do
            [ -z "$_sig" ] && continue
            echo "  - ${_conf}% (${_obs}x, ${_days}d idle) ${_kind}: ${_sig}"
        done <<< "$_ldb_top"
    fi
    unset _ldb_top
fi

# ---- Harness health advisories (suppressed on minimal profile) ----
if [ "$PROFILE" != "minimal" ]; then
    # Broken symlinks directly under .claude/ — projects that deploy the
    # harness via symlinks (e.g. from a version-controlled prompts repo) see
    # this when the link target moved. harness_restore_hint (userConfig)
    # carries the project's restore command; empty = no hint line.
    _broken="$(find "$ROOT/.claude" -maxdepth 1 -type l ! -exec test -e {} \; -print 2>/dev/null | tr '\n' ' ')"
    if [ -n "${_broken// /}" ]; then
        echo "[session-start] WARN: broken symlink(s) under .claude/: $_broken" >&2
        [ -n "${CLAUDE_PLUGIN_OPTION_HARNESS_RESTORE_HINT:-}" ] && \
            echo "[session-start] restore hint: ${CLAUDE_PLUGIN_OPTION_HARNESS_RESTORE_HINT}" >&2
    fi
    unset _broken

    # Plugin-version pin advisory (silent unless .claude/dhpk-versions.json exists).
    bash "$PLUGIN_ROOT/scripts/hooks/check-plugin-version.sh" || true

    # Cross-CLI harness drift (silent unless .codex/ or .gemini/ exists).
    bash "$PLUGIN_ROOT/scripts/check-cross-cli-drift.sh" || true
fi

exit 0
