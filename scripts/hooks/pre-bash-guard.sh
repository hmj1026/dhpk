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

# _guard_cmd_head_idx <start> <end>
#   Advances past reserved words, VAR=VALUE assignments and command wrappers
#   (command, builtin, exec, env, nohup, nice, timeout, stdbuf, sudo, doas,
#   xargs) to locate the executable command word index in DHPK_WORDS.
#   Sets _guard_head_idx to <end> when no command executes (e.g. `command -v`).
_guard_cmd_head_idx() {
    local k="$1" end="$2" w base assign_re='^[A-Za-z_][A-Za-z0-9_]*='
    while [ "$k" -lt "$end" ]; do
        w="${DHPK_WORDS[$k]}"
        case "$w" in
            if|then|elif|else|do|while|until|'!'|'{'|coproc)
                k=$((k + 1)); continue ;;
            time)
                k=$((k + 1))
                [ "$k" -lt "$end" ] && [ "${DHPK_WORDS[$k]}" = "-p" ] && k=$((k + 1))
                continue ;;
            *=*)
                if [[ "$w" =~ $assign_re ]]; then
                    k=$((k + 1)); continue
                fi ;;
        esac
        case "$w" in
            command)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -*[vV]*) _guard_head_idx="$end"; return 0 ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
            builtin)
                k=$((k + 1)); continue ;;
            exec)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -a) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
        esac
        base="${w##*/}"
        case "$base" in
            nohup)
                k=$((k + 1))
                [ "$k" -lt "$end" ] && [ "${DHPK_WORDS[$k]}" = "--" ] && k=$((k + 1))
                continue ;;
            env)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -u|-C|-S|--unset|--chdir|--split-string) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
            nice)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -n|--adjustment) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
            timeout)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -k|-s|--kill-after|--signal) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                [ "$k" -lt "$end" ] && k=$((k + 1))
                continue ;;
            stdbuf)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -i|-o|-e|--input|--output|--error) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
            sudo)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -u|-g|-C|-D|-h|-p|-r|-t|-T|-U) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
            doas)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -u|-C) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
            xargs)
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    case "${DHPK_WORDS[$k]}" in
                        --) k=$((k + 1)); break ;;
                        -I|-J|-L|-l|-n|-P|-s|-d|-a|-E|-e) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                continue ;;
        esac
        _guard_head_idx="$k"
        return 0
    done
    _guard_head_idx="$end"
    return 0
}

# Two tiers for Pattern 1 (D4, harvest-advice-20260711; #1407):
#   - DANGEROUS_ROOT_ANY: system dirs. Deleting the dir itself blocks even
#     without -r/-R/--recursive; deleting a deeper path inside one blocks only
#     when recursive (so `rm -f /usr/local/proj/x.log` passes while
#     `rm -rf /etc/nginx/conf.d` stays blocked).
#   - home/opt/srv/usr shallow tier: blocked at depth <=2 even without -r
#     (/home, /home/u, /usr/local, /usr/bin) so whole-tree deletion stays
#     blocked while deep workspace paths (/home/u/projects/repo/...) pass.
DANGEROUS_ROOT_ANY='(etc|usr|bin|sbin|lib|lib64|boot|proc|sys|dev|run|root|snap)'

# _guard_rm_target_matches <abs-check-fn> <decoded-target>
#   Evaluates <abs-check-fn> on <decoded-target>, and on its normalised form
#   when an absolute path contains a '.' or '..' segment.
_guard_rm_target_matches() {
    local fn="$1" target="$2" dots='/\.\.?(/|$)'
    "$fn" "$target" && return 0
    if [[ "$target" == /* ]] && [[ "$target" =~ $dots ]]; then
        dhpk_norm_path_var / "$target"
        "$fn" "$DHPK_NORM_PATH" && return 0
    fi
    return 1
}

# _guard_rm_relative_matches <abs-check-fn> <decoded-operand> <command-cwd>
#   A relative operand is judged on its absolute form when the command's
#   working directory is known and either the operand climbs with '..' or a
#   literal cd chose that directory. Other relative operands stay inside the
#   session directory and are not judged.
_guard_rm_relative_matches() {
    local fn="$1" operand="$2" cwd="$3" dots='(^|/)\.\.(/|$)'
    [ -n "$cwd" ] || return 1
    if [[ "$operand" =~ $dots ]] || [ "$cwd" != "$DHPK_START_CWD" ]; then
        dhpk_norm_path_var "$cwd" "$operand"
        "$fn" "$DHPK_NORM_PATH" && return 0
    fi
    return 1
}

_guard_rm_target_sysdir() { _guard_rm_target_matches _guard_rm_abs_sysdir "$1"; }
_guard_rm_relative_sysdir() { _guard_rm_relative_matches _guard_rm_abs_sysdir "$1" "$2"; }
_guard_rm_target_dangerous() { _guard_rm_target_matches _guard_rm_abs_dangerous "$1"; }
_guard_rm_relative_dangerous() { _guard_rm_relative_matches _guard_rm_abs_dangerous "$1" "$2"; }

# _guard_rm_abs_sysdir <abs-path>
#   True when <abs-path> is the root, a root/shallow glob or expansion, a
#   DANGEROUS_ROOT_ANY directory itself, or a shallow (depth <=2) path under
#   home/opt/srv/usr.
_guard_rm_abs_sysdir() {
    local root='^/+$' expand='^/+[$*]' sysroot="^/+${DANGEROUS_ROOT_ANY}/*$"
    local shallow='^/+(home|opt|srv|usr)(/+[^/]+)?/*$'
    local glob1='^/+[^/]*[][{*?$`]' glob2='^/+(home|opt|srv|usr)/+[^/]*[][{*?]'
    [[ "$1" =~ $root ]] && return 0
    [[ "$1" =~ $expand ]] && return 0
    [[ "$1" =~ $glob1 ]] && return 0
    [[ "$1" =~ $glob2 ]] && return 0
    [[ "$1" =~ $sysroot ]] && return 0
    [[ "$1" =~ $shallow ]] && return 0
    return 1
}

# _guard_rm_abs_dangerous <abs-path>
#   True for any system directory itself or any path beneath DANGEROUS_ROOT_ANY.
_guard_rm_abs_dangerous() {
    local deep="^/+${DANGEROUS_ROOT_ANY}/+"
    _guard_rm_abs_sysdir "$1" && return 0
    [[ "$1" =~ $deep ]] && return 0
    return 1
}

# _guard_rm_decoded
#   Pattern 1 on decoded argv, so r"m", $'rm', "/" and $'/etc' are judged by
#   their shell value. Blocks when any operand targets a system directory
#   itself (even without -r), or targets a path beneath DANGEROUS_ROOT_ANY
#   when -r/-R/--recursive is present.
_guard_rm_decoded() {
    local c=0 k end w is_recursive operands_only hit_sysdir hit_deep cwd
    while [ "$c" -lt "${#DHPK_CMD_START[@]}" ]; do
        k="${DHPK_CMD_START[$c]}"
        end=$((k + DHPK_CMD_LEN[c]))
        cwd="${DHPK_CMD_CWD[$c]}"
        while [ "$k" -lt "$end" ]; do
            if _guard_word_head_is "${DHPK_WORDS[$k]}" rm; then
                is_recursive=0
                operands_only=0
                hit_sysdir=0
                hit_deep=0
                k=$((k + 1))
                while [ "$k" -lt "$end" ]; do
                    w="${DHPK_WORDS[$k]}"
                    if [ "$operands_only" -eq 0 ] && [ "$w" = "--" ]; then
                        operands_only=1
                    elif [ "$operands_only" -eq 0 ] && [ "${w#-}" != "$w" ]; then
                        case "$w" in
                            --recursive) is_recursive=1 ;;
                            --*) ;;
                            -*[rR]*) is_recursive=1 ;;
                        esac
                    elif _guard_rm_target_sysdir "$w" || { [[ "$w" != /* ]] && _guard_rm_relative_sysdir "$w" "$cwd"; }; then
                        hit_sysdir=1
                        hit_deep=1
                    elif _guard_rm_target_dangerous "$w" || { [[ "$w" != /* ]] && _guard_rm_relative_dangerous "$w" "$cwd"; }; then
                        hit_deep=1
                    fi
                    k=$((k + 1))
                done
                if [ "$hit_sysdir" -eq 1 ] || { [ "$is_recursive" -eq 1 ] && [ "$hit_deep" -eq 1 ]; }; then
                    return 0
                fi
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

# _guard_curl_pipe_decoded
#   Pattern 2 on decoded pipeline stages: blocks curl/wget/fetch piped to a
#   shell (sh, bash, zsh, ksh, dash, ash, mksh), even across intermediate pipe
#   stages, wrappers, line continuations, or quoted/escaped command words.
_guard_curl_pipe_decoded() {
    local c=0 pid start end head curl_pipes=" " _guard_head_idx=0
    while [ "$c" -lt "${#DHPK_CMD_START[@]}" ]; do
        pid="${DHPK_CMD_PIPE_ID[$c]:-0}"
        if [ "$pid" -gt 0 ]; then
            start="${DHPK_CMD_START[$c]}"
            end=$((start + DHPK_CMD_LEN[c]))
            _guard_cmd_head_idx "$start" "$end"
            if [ "$_guard_head_idx" -lt "$end" ]; then
                head="${DHPK_WORDS[$_guard_head_idx]}"
                case "${head##*/}" in
                    curl|wget|fetch)
                        case "$curl_pipes" in
                            *" $pid "*) ;;
                            *) curl_pipes+="$pid " ;;
                        esac
                        ;;
                    sh|bash|zsh|ksh|dash|ash|mksh)
                        case "$curl_pipes" in
                            *" $pid "*) return 0 ;;
                        esac
                        ;;
                esac
            fi
        fi
        c=$((c + 1))
    done
    return 1
}

# _guard_chmod_decoded
#   Pattern 3 on decoded argv: blocks chmod 777/666 (mode operand only, with
#   or without options or wrappers) while leaving commit messages, data text,
#   and filenames like `chmod 755 777` allowed.
_guard_chmod_decoded() {
    local c=0 start end k w operands_only _guard_head_idx=0
    local mode_re='^0*[0-7]?(777|666)$' opt_re='^-[RcfvHLP]+$'
    while [ "$c" -lt "${#DHPK_CMD_START[@]}" ]; do
        start="${DHPK_CMD_START[$c]}"
        end=$((start + DHPK_CMD_LEN[c]))
        _guard_cmd_head_idx "$start" "$end"
        if [ "$_guard_head_idx" -lt "$end" ] && _guard_word_head_is "${DHPK_WORDS[$_guard_head_idx]}" chmod; then
            operands_only=0
            k=$((_guard_head_idx + 1))
            while [ "$k" -lt "$end" ]; do
                w="${DHPK_WORDS[$k]}"
                if [ "$operands_only" -eq 0 ] && [ "$w" = "--" ]; then
                    operands_only=1
                    k=$((k + 1))
                    continue
                fi
                if [ "$operands_only" -eq 0 ]; then
                    case "$w" in
                        --reference|--reference=*) break ;;
                        --*) k=$((k + 1)); continue ;;
                        -*)
                            if [[ "$w" =~ $opt_re ]]; then
                                k=$((k + 1))
                                continue
                            fi
                            ;;
                    esac
                fi
                [[ "$w" =~ $mode_re ]] && return 0
                break
            done
        fi
        c=$((c + 1))
    done
    return 1
}

# _guard_env_quoted_redirect_hit
#   Conservative fallback for Pattern 6: catches redirect syntax to a non-template
#   .env path inside double/single-quoted command text (for example `echo "a > .env"`
#   or `sh -c "echo x > .env"`) on DHPK_STRIPPED with zero external forks.
#   Heredoc data bodies were already stripped from DHPK_STRIPPED.
_guard_env_quoted_redirect_hit() {
    case "$DHPK_STRIPPED" in
        *'>'*'.'[Ee][Nn][Vv]*) ;;
        *) return 1 ;;
    esac
    local rest="$DHPK_STRIPPED"
    local re='>>?[[:space:]]*["'\'']{0,2}(([^[:space:];&|"'\'']*/)?\.[Ee][Nn][Vv](\.[A-Za-z0-9_.-]+)?)["'\'']{0,2}([[:space:];&|]|$)'
    while [[ "$rest" =~ $re ]]; do
        _guard_env_secret_name "${BASH_REMATCH[1]}" && return 0
        rest="${rest#*"${BASH_REMATCH[0]}"}"
    done
    return 1
}

# Pattern 1: rm on root or sensitive top-level dirs (decoded argv in _guard_rm_decoded).
if _guard_rm_decoded; then
    echo "[bash-guard] blocked: rm -rf against root or system directory. Narrow the path or run outside Claude." >&2
    exit 2
fi

# Pattern 2: curl|sh / wget|bash / fetch|zsh family (decoded pipeline stages).
if _guard_curl_pipe_decoded; then
    echo "[bash-guard] blocked: piping remote download into shell. Save to file, inspect, then run." >&2
    exit 2
fi

# Pattern 3: chmod 777 / 666 (decoded chmod mode operand).
if _guard_chmod_decoded; then
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
if _guard_env_write_decoded || _guard_env_quoted_redirect_hit; then
    echo "[bash-guard] blocked: writing to .env via shell redirection/tee. .env files hold secrets and must not be written via Bash. Ask the user for the value, or use .env.example/.env.template as a template." >&2
    exit 2
fi

exit 0
