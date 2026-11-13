#!/usr/bin/env bash
# pre-bash-guard.sh — PreToolUse (Bash) hook
# Block dangerous bash patterns. Exit 2 rejects the call.
#
# Patterns:
#   1. rm -rf on root/system dirs (whitelist of known-dangerous top-level dirs)
#   2. Curl/wget piped to shell (typical supply-chain attack)
#   3. chmod 777/666 (almost always a mistake)
#   4. (retired) git push while review sentinels exist — the Review Sentinel
#      mechanism was retired (#376/#377); review-before-push is enforced
#      through reviewer dispatch, not a bash-level file check.
#   5. git commit/push with --no-verify
#   6. shell writes into .env files
#
# Project-extensible:
#   - Add patterns by editing this file or via a downstream hook.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
. "$(dirname "$0")/_lib/payload.sh"
. "$(dirname "$0")/_lib/command-inspect.sh"

PAYLOAD="$(dhpk_read_payload)"
# 原有空命令捷徑會略過原始輸入與設定驗證；先執行憑證讀取檢查，避免無效輸入讓保護失效。
if [ "${DHPK_PROJECT_CONFIG_LOADED:-0}" != 1 ]; then
    . "$(dirname "$0")/_lib/load-project-config.sh"
fi
_credential_guard="$(dirname "$0")/_lib/credential-read.py"
if ! command -v python3 >/dev/null 2>&1 || [ ! -f "$_credential_guard" ]; then
    echo "[bash-guard] blocked: credential inspection unavailable; use controlled extraction or provide non-secret information." >&2
    exit 2
fi
# 保留 Python 端的阻擋原因；只有它沒說明時才補通用訊息。
_credential_reason="$(printf '%s' "$PAYLOAD" | python3 -B "$_credential_guard" 2>&1 >/dev/null)"
_credential_status=$?
if [ "$_credential_status" -ne 0 ]; then
    case "$_credential_reason" in
        "[bash-guard] blocked: "*) printf '%s\n' "$_credential_reason" >&2 ;;
        *) echo "[bash-guard] blocked: credential read or inspection failure; use controlled extraction or provide non-secret information." >&2 ;;
    esac
    exit 2
fi
CMD="$(extract_tool_input command "$PAYLOAD")"
[ -z "$CMD" ] && exit 0

# Quote-aware comment strip. A '#' inside quotes stays data, so it cannot
# hide a later flag or redirect.
dhpk_inspect_command "$CMD"
CMD_STRIPPED="$DHPK_STRIPPED"

# The decoder reports syntax it cannot place (for example a case statement
# inside $(...)). Guessing there could hide a later command, so block.
if [ -n "$DHPK_UNSUPPORTED" ]; then
    echo "[bash-guard] blocked: unsupported shell syntax ($DHPK_UNSUPPORTED); rewrite the command without it." >&2
    exit 2
fi

# _guard_word_head_is <word> <name>
#   True when the decoded argv word is <name> or a path ending in /<name>.
_guard_word_head_is() {
    case "$1" in
        "$2"|*/"$2") return 0 ;;
    esac
    return 1
}

# _guard_rm_target_dangerous <decoded-target>
#   Mirrors the Pattern 1 regex on one decoded rm operand: the root, a root
#   glob or expansion, any path under a DANGEROUS_ROOT_ANY directory, or a
#   DANGEROUS_ROOT_SHALLOW path at depth 2 or less. An expansion character
#   ({, *, ?, [, $ or a backtick) in the first segment, or a glob or brace in
#   the second segment under a shallow root, can reach a protected directory
#   and blocks too. An absolute operand with a '.' or '..' segment is judged
#   on both its raw and its normalised form.
_guard_rm_target_dangerous() {
    local dots='/\.\.?(/|$)'
    _guard_rm_abs_dangerous "$1" && return 0
    if [[ "$1" == /* ]] && [[ "$1" =~ $dots ]]; then
        dhpk_norm_path_var / "$1"
        _guard_rm_abs_dangerous "$DHPK_NORM_PATH" && return 0
    fi
    return 1
}

# _guard_rm_relative_dangerous <decoded-operand> <command-cwd>
#   A relative operand is judged on its absolute form when the command's
#   working directory is known and either the operand climbs with '..' or a
#   literal cd chose that directory. Other relative operands stay inside the
#   session directory and are not judged.
_guard_rm_relative_dangerous() {
    local dots='(^|/)\.\.(/|$)'
    [ -n "$2" ] || return 1
    if [[ "$1" =~ $dots ]] || [ "$2" != "$DHPK_START_CWD" ]; then
        dhpk_norm_path_var "$2" "$1"
        _guard_rm_abs_dangerous "$DHPK_NORM_PATH" && return 0
    fi
    return 1
}

_guard_rm_abs_dangerous() {
    local root='^/+$' expand='^/+[$*]' any="^/+${DANGEROUS_ROOT_ANY}(/|\$)"
    local shallow='^/+(home|opt|srv)(/+[^/]+)?/*$'
    local glob1='^/+[^/]*[][{*?$`]' glob2='^/+(home|opt|srv)/+[^/]*[][{*?]'
    [[ "$1" =~ $root ]] && return 0
    [[ "$1" =~ $expand ]] && return 0
    [[ "$1" =~ $glob1 ]] && return 0
    [[ "$1" =~ $glob2 ]] && return 0
    [[ "$1" =~ $any ]] && return 0
    [[ "$1" =~ $shallow ]] && return 0
    return 1
}

# _guard_rm_decoded
#   Pattern 1 on decoded argv, so r"m", $'rm', "/" and $'/etc' are judged by
#   their shell value. An rm word with at least one option blocks when any
#   operand is dangerous, including a relative operand that resolves to a
#   dangerous path from a known working directory (cd /tmp && rm -rf ../etc).
_guard_rm_decoded() {
    local c=0 k end w has_flag operands_only hit cwd
    while [ "$c" -lt "${#DHPK_CMD_START[@]}" ]; do
        k="${DHPK_CMD_START[$c]}"
        end=$((k + DHPK_CMD_LEN[c]))
        cwd="${DHPK_CMD_CWD[$c]}"
        while [ "$k" -lt "$end" ]; do
            if _guard_word_head_is "${DHPK_WORDS[$k]}" rm; then
                has_flag=0
                operands_only=0
                hit=0
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    w="${DHPK_WORDS[$k]}"
                    if [ "$operands_only" -eq 0 ] && [ "$w" = "--" ]; then
                        operands_only=1
                    elif [ "$operands_only" -eq 0 ] && [ "${w#-}" != "$w" ]; then
                        has_flag=1
                    elif _guard_rm_target_dangerous "$w"; then
                        hit=1
                    elif [[ "$w" != /* ]] && _guard_rm_relative_dangerous "$w" "$cwd"; then
                        hit=1
                    fi
                    k=$((k + 1))
                done
                [ "$has_flag" -eq 1 ] && [ "$hit" -eq 1 ] && return 0
            fi
            k=$((k + 1))
        done
        c=$((c + 1))
    done
    return 1
}

# _guard_env_secret_name <decoded-path>
#   True when the basename is .env or .env.* (any letter case) and is not one
#   of the version-controlled templates.
_guard_env_secret_name() {
    local base="${1##*/}"
    case "$base" in
        .[Ee][Nn][Vv]) return 0 ;;
        .[Ee][Nn][Vv].*) ;;
        *) return 1 ;;
    esac
    case "${base#.[Ee][Nn][Vv].}" in
        [Ee][Xx][Aa][Mm][Pp][Ll][Ee]|[Ss][Aa][Mm][Pp][Ll][Ee]|[Dd][Ii][Ss][Tt]|[Tt][Ee][Mm][Pp][Ll][Aa][Tt][Ee]) return 1 ;;
    esac
    return 0
}

# _guard_env_write_decoded
#   Pattern 6 on decoded redirect targets and tee operands, so ".e"nv,
#   $'.env' and "dir with space/.env" are judged by their shell value.
_guard_env_write_decoded() {
    local t c=0 k end operands_only
    for t in ${DHPK_REDIRECT_TARGETS[@]+"${DHPK_REDIRECT_TARGETS[@]}"}; do
        _guard_env_secret_name "$t" && return 0
    done
    while [ "$c" -lt "${#DHPK_CMD_START[@]}" ]; do
        k="${DHPK_CMD_START[$c]}"
        end=$((k + DHPK_CMD_LEN[c]))
        while [ "$k" -lt "$end" ]; do
            if _guard_word_head_is "${DHPK_WORDS[$k]}" tee; then
                operands_only=0
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    t="${DHPK_WORDS[$k]}"
                    if [ "$operands_only" -eq 0 ] && [ "$t" = "--" ]; then
                        operands_only=1
                    elif [ "$operands_only" -eq 1 ] || [ "${t#-}" = "$t" ]; then
                        _guard_env_secret_name "$t" && return 0
                    fi
                    k=$((k + 1))
                done
            fi
            k=$((k + 1))
        done
        c=$((c + 1))
    done
    return 1
}

# Pattern 1: rm -rf on root or sensitive top-level dirs.
# Whitelist approach: only block known-dangerous targets to avoid false-positives
# on /tmp, /var/tmp, /var/log cleanups.
#
# Two tiers (D4, harvest-advice-20260711):
#   - DANGEROUS_ROOT_ANY: system dirs, blocked at any depth (rm -rf /etc/nginx/conf.d
#     stays blocked — these never legitimately need recursive deletion under Claude).
#   - DANGEROUS_ROOT_SHALLOW: user-data dirs (home/opt/srv), blocked only at depth <=2
#     (/home, /home/, /home/<seg>, /home/<seg>/) so whole-home deletion stays blocked
#     while workspace-internal paths (/home/<user>/projects/<repo>/...) pass.
DANGEROUS_ROOT_ANY='(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|run|root|snap)'
DANGEROUS_ROOT_SHALLOW="(home|opt|srv)(/+[^/[:space:]]+)?/*[\"']?([[:space:];&|]|$)"
if printf '%s' "$CMD_STRIPPED" | grep -Eq \
    "(^|[[:space:];&|])rm[[:space:]]+(-[a-zA-Z]+[[:space:]]+)+(--[[:space:]]+)?[\"']?/+([[:space:]\$\*]|$|${DANGEROUS_ROOT_ANY}([/[:space:]]|[\"']?([[:space:];&|]|$))|${DANGEROUS_ROOT_SHALLOW})" || \
    _guard_rm_decoded; then
    echo "[bash-guard] blocked: rm -rf against root or system directory. Narrow the path or run outside Claude." >&2
    exit 2
fi

# Pattern 2: curl|sh / wget|bash / fetch|zsh family.
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(curl|wget|fetch)[^|]*\|[[:space:]]*(sh|bash|zsh|ksh)([[:space:]]|$|;|\|)'; then
    echo "[bash-guard] blocked: piping remote download into shell. Save to file, inspect, then run." >&2
    exit 2
fi

# Pattern 3: chmod 777 / 666 (including -R777 etc).
if printf '%s' "$CMD_STRIPPED" | grep -Eq '(^|[[:space:];&|])chmod[[:space:]]+(-[a-zA-Z]*[[:space:]]*)?[0-7]?(777|666)([[:space:]]|$)'; then
    echo "[bash-guard] blocked: chmod 777/666. Use stricter perms (750/640) or narrower paths." >&2
    exit 2
fi

# Pattern 5: git commit / push with --no-verify. The flag must be an argv of
# that invocation. A quoted message, a real comment, or push -n (dry-run) does
# not count, and one segment cannot exempt another. Commit -n raises the same
# signal.
# Opt out for a session: DHPK_ALLOW_NO_VERIFY=1
if [ "${DHPK_ALLOW_NO_VERIFY:-0}" = "0" ]; then
    _nv_i=0
    while [ "$_nv_i" -lt "${DHPK_GIT_COUNT:-0}" ]; do
        case "${DHPK_GIT_SUB[$_nv_i]}" in
            commit|push)
                if [ "${DHPK_GIT_NO_VERIFY[$_nv_i]}" = "1" ]; then
                    echo "[bash-guard] blocked: '--no-verify' bypasses the pre-commit/pre-push gates. Fix the failing check; if you must bypass, set DHPK_ALLOW_NO_VERIFY=1 or run outside Claude." >&2
                    exit 2
                fi
                ;;
        esac
        _nv_i=$((_nv_i + 1))
    done
    unset _nv_i
fi

# Pattern 6: shell writes into .env files (redirection / tee) — closes the
# bypass where a blocked Write/Edit against .env is retried via Bash
# (D6, harvest-advice-20260711). Mirrors pre-edit-guard.sh's allowlist:
# .env.example / .env.sample / .env.dist / .env.template are version-controlled
# templates carrying no secrets and remain writable.
#
# Target-scoped allowlisting (fix, harvest-advice-20260711 fix round): the
# allowlist must only exempt commands whose write TARGET is an allowlisted
# file, not any command that merely mentions an allowlisted filename anywhere
# in its text — otherwise `echo SECRET=x > .env ; cat .env.example` bypasses
# the block because the whole-command grep sees `.env.example` and skips.
# Strip allowlisted redirection targets and template path mentions from a copy
# of the command first. Preserve `tee` and its other arguments so every output
# target is still checked; allowing one template must not hide another target.
#
# Path-prefix tolerance (fix round 2, harvest-advice-20260711): the redirect
# target may carry a directory prefix (`api/.env`, `./.env`, `/tmp/foo/.env`,
# `../.env`) — match an optional leading path segment before `.env` in both
# the allowlist-strip patterns and the block patterns below, so `> .env` and
# `> some/dir/.env` are treated identically.
_env_cmd="$(printf '%s' "$CMD_STRIPPED" | sed -E \
    -e "s/(>>?)[[:space:]]*[\"']?([^[:space:];&|]*\/)?\.env\.(example|sample|dist|template)[\"']?([[:space:];&|]|\$)/ /g" \
    -e "s/[\"']?([^[:space:];&|]*\/)?\.env\.(example|sample|dist|template)[\"']?([[:space:];&|]|\$)/\3/g")"
if printf '%s' "$_env_cmd" | grep -Eq "(>>?)[[:space:]]*[\"']?([^[:space:];&|]*/)?\.env(\.[A-Za-z0-9_.-]+)?[\"']?([[:space:];&|]|\$)" || \
   printf '%s' "$_env_cmd" | grep -Eq "(^|[[:space:];&|])tee[[:space:]]+(-a[[:space:]]+)?([^;&|]*[[:space:]])*[\"']?([^[:space:];&|]*/)?\.env(\.[A-Za-z0-9_.-]+)?[\"']?([[:space:];&|]|\$)" || \
   _guard_env_write_decoded; then
    echo "[bash-guard] blocked: writing to .env via shell redirection/tee. .env files hold secrets and must not be written via Bash. Ask the user for the value, or use .env.example/.env.template as a template." >&2
    exit 2
fi

exit 0
