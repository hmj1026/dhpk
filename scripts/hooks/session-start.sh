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
#   6. Announce orchestration worker model tiers and non-default fast-worker selector values

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
ROOT="$(dhpk_root)"

# Overlay project-level pluginConfigs onto CLAUDE_PLUGIN_OPTION_* env vars.
# Claude Code only injects global pluginConfigs; per-project .claude/settings.local.json
# overrides are loaded here so dhpk modules / hook_profile / etc. respect the
# project's intent. See _lib/load-project-config.sh for precedence rules.
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/learning-db.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/payload.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/timestamps.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/portable-stat.sh"
. "$PLUGIN_ROOT/scripts/hooks/_lib/portable-timeout.sh"

# Branch on the SessionStart `source` (startup|resume|clear|compact). Module
# activation + dir creation + the snapshot are cheap and always run (downstream
# hooks need DHPK_ACTIVE_MODULES exported even after compaction). The expensive /
# duplicative work (docker ps, learned-context, handoff surfacing, health
# advisories) only runs on a fresh start — on resume/compact it is wasteful, and
# on compact postcompact-restore.sh already re-injects the handoff.
PAYLOAD="$(dhpk_read_payload)"
SOURCE="$(extract_top_field source "$PAYLOAD")"
case "$SOURCE" in
    resume|compact) FULL_INIT=0 ;;
    *)              FULL_INIT=1 ;;
esac

PROFILE="$(dhpk_config_profile)"
ARTIFACTS="$ROOT/.claude/artifacts"
SESSION_FILE="$ARTIFACTS/sessions/latest.md"

mkdir -p "$ARTIFACTS/reviews" "$ARTIFACTS/plans" "$ARTIFACTS/audits" \
         "$ARTIFACTS/refactors" "$ARTIFACTS/codemaps" "$ARTIFACTS/adr" \
         "$ARTIFACTS/sessions"

# NOTE: orphaned `gitnexus mcp` process reaping moved to session-end.sh
# (SessionEnd event) — the correct lifecycle point. It previously ran on every
# SessionStart; reaping at session teardown avoids killing a live parallel
# session's MCP server and removes per-start overhead.

TS="$(ts_now)"   # _lib/timestamps.sh
BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '(detached)')"
STAGED="$(git -C "$ROOT" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
MODIFIED="$(git -C "$ROOT" diff --name-only 2>/dev/null | wc -l | tr -d ' ')"
UNTRACKED="$(git -C "$ROOT" ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')"

# ---- Docker container check (only when configured) ----
DOCKER_STATUS="(no containers configured)"
DOCKER_WARNS=""
if [ -n "${CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS:-}" ]; then
    if [ "$FULL_INIT" = "0" ]; then
        DOCKER_STATUS="(skipped on $SOURCE)"
    elif command -v docker >/dev/null 2>&1; then
        # Bound the docker call (run_with_timeout → coreutils timeout / perl alarm)
        # so an unresponsive daemon can't consume the 20s SessionStart budget.
        NAMES="$(run_with_timeout 8 docker ps --format '{{.Names}}' 2>/dev/null)"; _dps_rc=$?
        if [ "$_dps_rc" -eq 124 ]; then
            DOCKER_STATUS="(docker ps timed out)"
        else
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
        fi
    else
        DOCKER_STATUS="(docker cli missing)"
    fi
fi

# ---- Module activation ----
# Module-metadata parsing (module.yaml display_name + requires validation) lives
# in _lib/activate-modules.py — a standalone, unit-testable script invoked once.
# This shim consumes its tab-separated protocol (WARN / MODULE / ACTIVE) and
# keeps the DHPK_ACTIVE_MODULES export in the parent shell (a child process can't
# set it). When python3 is unavailable, a degraded bash fallback still activates
# modules (no display names / requires validation) so downstream hooks keep firing.
ACTIVE_MODULES=""
MODULE_LINES=""
# SessionStart is the authority that recomputes the validated active set; do
# not reuse a stale DHPK_ACTIVE_MODULES inherited from a prior session here.
MODULES="$(dhpk_config_csv modules '')"
if [ -n "$MODULES" ]; then
    if command -v python3 >/dev/null 2>&1; then
        while IFS=$'\t' read -r _tag _f1 _f2; do
            case "$_tag" in
                WARN)   echo "[session-start] WARN: $_f1" >&2 ;;
                MODULE) MODULE_LINES="${MODULE_LINES}"$'\n'"[session-start] module enabled: $_f1 — $_f2" ;;
                ACTIVE) ACTIVE_MODULES="$_f1" ;;
            esac
        done < <(python3 "$PLUGIN_ROOT/scripts/hooks/_lib/activate-modules.py" "$PLUGIN_ROOT" "$MODULES" 2>/dev/null)
    else
        echo "[session-start] WARN: modules enabled ($MODULES) but python3 missing — module metadata not parsed; per-module path triggers will not fire. Install python3 to enable full module support." >&2
        # Degraded fallback: dedup + dir-check + activate (display = name, no requires validation).
        IFS=',' read -r -a _mods <<< "$MODULES"
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
            if [ ! -d "$PLUGIN_ROOT/modules/$_m" ]; then
                echo "[session-start] WARN: module '$_m' not found at $PLUGIN_ROOT/modules/$_m" >&2
                continue
            fi
            MODULE_LINES="${MODULE_LINES}"$'\n'"[session-start] module enabled: $_m — $_m"
            ACTIVE_MODULES="${ACTIVE_MODULES}${ACTIVE_MODULES:+,}$_m"
        done
    fi
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

# ---- Orchestration worker config (deep-reasoner / fast-worker model tiers) ----
# Announce only when at least one value differs from the shipped default, or the
# dispatch switch is off — token discipline (silent on the common all-defaults case).
DEEP_MODEL="${CLAUDE_PLUGIN_OPTION_DEEP_REASONER_MODEL:-opus}"
WORKER_MODEL="${CLAUDE_PLUGIN_OPTION_FAST_WORKER_MODEL:-sonnet}"
DEEP_EFFORT="${CLAUDE_PLUGIN_OPTION_DEEP_REASONER_EFFORT:-high}"
WORKER_EFFORT="${CLAUDE_PLUGIN_OPTION_FAST_WORKER_EFFORT:-medium}"
PLANNER_MODEL="${CLAUDE_PLUGIN_OPTION_PLANNER_MODEL:-opus}"
PLANNER_EFFORT="${CLAUDE_PLUGIN_OPTION_PLANNER_EFFORT:-high}"
DISPATCH="${CLAUDE_PLUGIN_OPTION_ORCHESTRATION_DISPATCH:-on}"
# CLI-backed fast-worker variants (codex-fast-worker / agy-fast-worker) — surfaced
# only when overridden from the shipped defaults, same token discipline as above.
CODEX_FW_MODEL="${CLAUDE_PLUGIN_OPTION_CODEX_FAST_WORKER_MODEL:-gpt-5.6-luna}"
CODEX_FW_EFFORT="${CLAUDE_PLUGIN_OPTION_CODEX_FAST_WORKER_EFFORT:-xhigh}"
AGY_FW_MODEL="${CLAUDE_PLUGIN_OPTION_AGY_FAST_WORKER_MODEL:-Gemini 3.5 Flash (High)}"
if [ "$DEEP_MODEL" != "opus" ] || [ "$WORKER_MODEL" != "sonnet" ] || [ "$DEEP_EFFORT" != "high" ] || [ "$WORKER_EFFORT" != "medium" ] || [ "$PLANNER_MODEL" != "opus" ] || [ "$PLANNER_EFFORT" != "high" ] || [ "$DISPATCH" != "on" ] || [ "$CODEX_FW_MODEL" != "gpt-5.6-luna" ] || [ "$CODEX_FW_EFFORT" != "xhigh" ] || [ "$AGY_FW_MODEL" != "Gemini 3.5 Flash (High)" ]; then
    _orch_line="orchestration: deep=$DEEP_MODEL worker=$WORKER_MODEL"
    [ "$DEEP_EFFORT" != "high" ] && _orch_line="${_orch_line} deep_effort=$DEEP_EFFORT"
    [ "$WORKER_EFFORT" != "medium" ] && _orch_line="${_orch_line} worker_effort=$WORKER_EFFORT"
    [ "$PLANNER_MODEL" != "opus" ] && _orch_line="${_orch_line} planner=$PLANNER_MODEL"
    [ "$PLANNER_EFFORT" != "high" ] && _orch_line="${_orch_line} planner_effort=$PLANNER_EFFORT"
    [ "$DISPATCH" != "on" ] && _orch_line="${_orch_line} dispatch=off"
    [ "$CODEX_FW_MODEL" != "gpt-5.6-luna" ] && _orch_line="${_orch_line} codex_worker=$CODEX_FW_MODEL"
    [ "$CODEX_FW_EFFORT" != "xhigh" ] && _orch_line="${_orch_line} codex_worker_effort=$CODEX_FW_EFFORT"
    [ "$AGY_FW_MODEL" != "Gemini 3.5 Flash (High)" ] && _orch_line="${_orch_line} agy_worker=$AGY_FW_MODEL"
    echo "[session-start] $_orch_line"
    unset _orch_line
fi

QUALITY_GATE="$(dhpk_config_get subagent_quality_gate off)"
case "$(printf '%s' "$QUALITY_GATE" | tr '[:upper:]' '[:lower:]')" in
    on|true|1) echo "[session-start] subagent_quality_gate=$QUALITY_GATE (reviewer-sentinel SubagentStop thin-report gate enabled; one corrected retry)" ;;
    *) ;;
esac

# ---- Fast-worker backend selector -----------------------------------------
# Resolve the small selector surface once at session start. Invalid values are
# safe: warn once for this session and use shipped defaults. The full dispatch
# decision and missing-executable-only fallback are implemented by
# scripts/fast-worker-selector.js and documented in the execution policy.
FAST_BACKEND_DEFAULT="claude"
FAST_ORDER_DEFAULT="claude,codex,agy"
FAST_FALLBACK_DEFAULT="none"
FAST_BACKEND="$(dhpk_config_get fast_worker_backend "$FAST_BACKEND_DEFAULT")"
FAST_ORDER="$(dhpk_config_csv fast_worker_backend_order "$FAST_ORDER_DEFAULT")"
FAST_FALLBACK="$(dhpk_config_get fast_worker_fallback "$FAST_FALLBACK_DEFAULT")"
SELECTOR_SESSION="$(extract_top_field session_id "$PAYLOAD")"
[ -n "$SELECTOR_SESSION" ] || SELECTOR_SESSION="startup"
SELECTOR_WARNINGS="$ARTIFACTS/sessions/$DHPK_SIDECAR_FW_SELECTOR_WARNINGS"

selector_warn_once() {
    local key="$1" value="$2" marker="${SELECTOR_SESSION}	${key}=${value}"
    mkdir -p "$ARTIFACTS/sessions" 2>/dev/null || true
    if ! grep -Fqx "$marker" "$SELECTOR_WARNINGS" 2>/dev/null; then
        printf '%s\n' "$marker" >> "$SELECTOR_WARNINGS" 2>/dev/null || true
        echo "[session-start] WARN: invalid fast-worker selector ${key}=${value}; using shipped default" >&2
    fi
}

case "$FAST_BACKEND" in
    claude|codex|agy|auto) ;;
    *) selector_warn_once "fast_worker_backend" "$FAST_BACKEND"; FAST_BACKEND="$FAST_BACKEND_DEFAULT" ;;
esac

_order_valid=1
_order_items=()
IFS=',' read -r -a _order_items <<< "$FAST_ORDER"
[ "${#_order_items[@]}" -gt 0 ] || _order_valid=0
for _backend in "${_order_items[@]}"; do
    case "$(echo "$_backend" | xargs)" in
        claude|codex|agy) ;;
        *) _order_valid=0; break ;;
    esac
done
if [ "$_order_valid" -eq 0 ]; then
    selector_warn_once "fast_worker_backend_order" "$FAST_ORDER"
    FAST_ORDER="$FAST_ORDER_DEFAULT"
fi

case "$FAST_FALLBACK" in
    none|claude) ;;
    *) selector_warn_once "fast_worker_fallback" "$FAST_FALLBACK"; FAST_FALLBACK="$FAST_FALLBACK_DEFAULT" ;;
esac

_selector_line=""
[ "$FAST_BACKEND" != "$FAST_BACKEND_DEFAULT" ] && _selector_line="fast_worker_backend=$FAST_BACKEND"
[ "$FAST_ORDER" != "$FAST_ORDER_DEFAULT" ] && _selector_line="${_selector_line}${_selector_line:+ }fast_worker_backend_order=$FAST_ORDER"
[ "$FAST_FALLBACK" != "$FAST_FALLBACK_DEFAULT" ] && _selector_line="${_selector_line}${_selector_line:+ }fast_worker_fallback=$FAST_FALLBACK"
[ -n "$_selector_line" ] && echo "[session-start] fast-worker selector: $_selector_line"
unset _selector_line _order_valid _order_items _backend

# ---- Cross-session learned context (opt-in via learning_db_enabled) ----
# Surface the top recurring signatures so the model starts the session aware of
# what prior sessions learned. Capped at 5 lines (~well under 500 tokens) to
# keep the context budget small. No-op unless the learning DB is enabled and
# has at least one signature with ≥2 observations.
if [ "$FULL_INIT" = "1" ] && ldb_enabled; then
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

# ---- Resumable work handoff (manual /new resume path) ----
# precompact-archive.sh (PreCompact hook) writes handoff-latest.md when the
# context compacts. On a fresh session started soon after, surface a short
# pointer + summary so a manual /new picks up where the prior session left off.
# Recency-gated (<=12h) so stale handoffs don't spam every startup. Skipped on
# compact/resume — postcompact-restore.sh re-injects the handoff after compaction.
if [ "$FULL_INIT" = "1" ] && [ "$PROFILE" != "minimal" ]; then
    _handoff="$ROOT/.claude/artifacts/checkpoints/handoff-latest.md"
    if [ -f "$_handoff" ]; then
        _mtime="$(file_mtime_epoch "$_handoff")"   # _lib/portable-stat.sh
        _age_min=$(( ( $(ts_epoch) - ${_mtime:-0} ) / 60 ))
        if [ "${_mtime:-0}" -gt 0 ] && [ "$_age_min" -ge 0 ] && [ "$_age_min" -le 720 ]; then
            echo "[session-start] resumable work handoff (${_age_min}m ago) → .claude/artifacts/checkpoints/handoff-latest.md"
            sed -n '3,12p' "$_handoff"
        fi
    fi
    unset _handoff _mtime _age_min
fi

# ---- Harness health advisories (fresh start only; suppressed on minimal) ----
if [ "$FULL_INIT" = "1" ] && [ "$PROFILE" != "minimal" ]; then
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
