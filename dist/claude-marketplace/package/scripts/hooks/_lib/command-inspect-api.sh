#!/usr/bin/env bash
# shellcheck disable=SC2154  # state arrays are declared by the sibling modules
# command-inspect-api.sh - trivial-command fast path, parse cache, public inspect entry points.
# Source-only module of command-inspect.sh (#1501); sourced by it, not by hooks.
# bash 3.2. Never executes the command under inspection.

# dhpk_command_is_trivial <command>
#   True when the raw command cannot contain anything the decoder treats
#   specially, so splitting it on spaces and tabs gives the decoder's own
#   result: one simple command with no git invocation, cd, redirect,
#   expansion, quote, comment or separator. Any doubt answers false.
#   Rejected: the substring git in any letter case, .env, a quote,
#   backslash, backtick, $ ( ) { } < > ; & | # * ? [ ] ~, a newline or a
#   carriage return, and any word (or path ending in /word, any letter
#   case) cd, pushd, popd, rm, tee, coproc, eval or source. A blank command
#   is not trivial.
dhpk_command_is_trivial() {
    local w n=0 IFS=$' \t'
    case "$1" in
        *[Gg][Ii][Tt]*|*.[Ee][Nn][Vv]*) return 1 ;;
        *[\'\"\\\`\$\(\)\{\}\<\>\;\&\|\#\*\?\[\]~]*) return 1 ;;
        *$'\n'*|*$'\r'*) return 1 ;;
    esac
    # Word splitting is safe here: no glob, brace or tilde character is left.
    # shellcheck disable=SC2086
    for w in $1; do
        case "$w" in
            [Cc][Dd]|*/[Cc][Dd]|[Rr][Mm]|*/[Rr][Mm]|[Tt][Ee][Ee]|*/[Tt][Ee][Ee]) return 1 ;;
            [Pp][Uu][Ss][Hh][Dd]|*/[Pp][Uu][Ss][Hh][Dd]|[Pp][Oo][Pp][Dd]|*/[Pp][Oo][Pp][Dd]) return 1 ;;
            [Cc][Oo][Pp][Rr][Oo][Cc]|*/[Cc][Oo][Pp][Rr][Oo][Cc]|[Ee][Vv][Aa][Ll]|*/[Ee][Vv][Aa][Ll]) return 1 ;;
            [Aa][Ll][Ii][Aa][Ss]|*/[Aa][Ll][Ii][Aa][Ss]) return 1 ;;
            [Ss][Oo][Uu][Rr][Cc][Ee]|*/[Ss][Oo][Uu][Rr][Cc][Ee]) return 1 ;;
        esac
        n=$((n + 1))
    done
    [ "$n" -gt 0 ]
}

# _dhpk_ci_trivial_fill <command> <start-cwd>
#   The decoder's state for a command dhpk_command_is_trivial accepted: one
#   simple command whose argv is the command split on spaces and tabs, run in
#   <start-cwd>. The caller has already reset every other output.
_dhpk_ci_trivial_fill() {
    local IFS=$' \t'
    # shellcheck disable=SC2206  # split on spaces and tabs; nothing can glob
    local -a words=($1)
    DHPK_STRIPPED="$1"
    DHPK_WORDS=("${words[@]}")
    DHPK_CMD_START=(0)
    DHPK_CMD_LEN=("${#words[@]}")
    # shellcheck disable=SC2034  # read by pre-bash-guard after source
    DHPK_CMD_CWD=("$2")
    # shellcheck disable=SC2034  # read by pre-bash-guard after source
    DHPK_CMD_PIPE_ID=(0)
}

# _dhpk_ci_cache_esc <value>
#   Percent-escapes '%' and newlines so one serialized value occupies one line.
_dhpk_ci_cache_esc() {
    local v="$1"
    case "$v" in
        *[%$'\n']*)
            v="${v//%/%25}"
            v="${v//$'\n'/%0A}"
            ;;
    esac
    _dhpk_ci_esc_out="$v"
}

# _dhpk_ci_cache_unesc <value>
#   Restores values encoded by _dhpk_ci_cache_esc.
_dhpk_ci_cache_unesc() {
    local v="$1"
    case "$v" in
        *%*)
            v="${v//%0A/$'\n'}"
            v="${v//%25/%}"
            ;;
    esac
    _dhpk_ci_esc_out="$v"
}

# _dhpk_ci_cache_append_array <header-prefix> <is-cwd> [elements...]
#   Appends a count-prefixed array section to _dhpk_ci_cache.
_dhpk_ci_cache_append_array() {
    local label="$1" is_cwd="$2" v
    shift 2
    _dhpk_ci_cache+="${label} $#"
    _dhpk_ci_cache+=$'\n'
    for v in "$@"; do
        if [ "$is_cwd" -eq 1 ] && [ "$v" = "$DHPK_START_CWD" ]; then
            _dhpk_ci_cache+="%S"
            _dhpk_ci_cache+=$'\n'
        else
            _dhpk_ci_cache_esc "$v"
            _dhpk_ci_cache+="$_dhpk_ci_esc_out"
            _dhpk_ci_cache+=$'\n'
        fi
    done
}

# _dhpk_ci_cache_read_scalar <prefix>
#   Reads one serialized scalar line and stores its decoded value in _dhpk_ci_tmp_val.
_dhpk_ci_cache_read_scalar() {
    local prefix="$1" line
    IFS= read -r line || return 1
    case "$line" in
        "${prefix}"*)
            _dhpk_ci_cache_unesc "${line#"$prefix"}"
            _dhpk_ci_tmp_val="$_dhpk_ci_esc_out"
            return 0
            ;;
    esac
    return 1
}

# _dhpk_ci_cache_read_int <prefix>
#   Reads one serialized non-negative integer scalar into _dhpk_ci_tmp_val.
_dhpk_ci_cache_read_int() {
    local prefix="$1" line val int_re='^[0-9]+$'
    IFS= read -r line || return 1
    case "$line" in
        "${prefix}"*) val="${line#"$prefix"}" ;;
        *) return 1 ;;
    esac
    [[ "$val" =~ $int_re ]] || return 1
    _dhpk_ci_tmp_val="$val"
    return 0
}

# _dhpk_ci_cache_read_arr <prefix> <is-cwd>
#   Reads one count-prefixed serialized array section into _dhpk_ci_tmp_arr.
_dhpk_ci_cache_read_arr() {
    local prefix="$1" is_cwd="$2" line count n=0 int_re='^[0-9]+$'
    _dhpk_ci_tmp_arr=()
    IFS= read -r line || return 1
    case "$line" in
        "${prefix}"*) count="${line#"$prefix"}" ;;
        *) return 1 ;;
    esac
    [[ "$count" =~ $int_re ]] || return 1
    while [ "$n" -lt "$count" ]; do
        IFS= read -r line || return 1
        if [ "$is_cwd" -eq 1 ] && [ "$line" = "%S" ]; then
            _dhpk_ci_tmp_arr+=("$DHPK_START_CWD")
        else
            _dhpk_ci_cache_unesc "$line"
            _dhpk_ci_tmp_arr+=("$_dhpk_ci_esc_out")
        fi
        n=$((n + 1))
    done
    return 0
}

# _dhpk_ci_cache_load <expected-start-cwd>
#   Restores DHPK_* outputs from DHPK_INSPECT_CACHE without eval. Returns 1 on
#   any mismatch or structural validation failure so the caller re-parses.
_dhpk_ci_cache_load() {
    local expected_start="$1" _dhpk_ci_esc_out="" _dhpk_ci_tmp_val=""
    local -a _dhpk_ci_tmp_arr
    _dhpk_ci_tmp_arr=()
    {
        local line
        IFS= read -r line || return 1
        [ "$line" = "dhpk-ci-v1" ] || return 1
        _dhpk_ci_cache_read_scalar "S START_CWD " || return 1
        [ "$_dhpk_ci_tmp_val" = "$expected_start" ] || return 1
        DHPK_START_CWD="$_dhpk_ci_tmp_val"
        _dhpk_ci_cache_read_scalar "S STRIPPED " || return 1
        DHPK_STRIPPED="$_dhpk_ci_tmp_val"
        _dhpk_ci_cache_read_scalar "S UNSUPPORTED " || return 1
        DHPK_UNSUPPORTED="$_dhpk_ci_tmp_val"
        _dhpk_ci_cache_read_int "S GIT_COUNT " || return 1
        DHPK_GIT_COUNT="$_dhpk_ci_tmp_val"
        _dhpk_ci_cache_read_int "S HD_FORCE_EXEC " || return 1
        DHPK_HD_FORCE_EXEC="$_dhpk_ci_tmp_val"
        _dhpk_ci_cache_read_int "S INSPECT_FAST " || return 1
        # shellcheck disable=SC2034
        DHPK_INSPECT_FAST="$_dhpk_ci_tmp_val"
        _dhpk_ci_cache_read_arr "A GIT_SUB " 0 || return 1
        DHPK_GIT_SUB=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A GIT_REPO " 0 || return 1
        DHPK_GIT_REPO=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A GIT_REPO_STATE " 0 || return 1
        DHPK_GIT_REPO_STATE=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A GIT_NO_VERIFY " 0 || return 1
        # shellcheck disable=SC2034
        DHPK_GIT_NO_VERIFY=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A GIT_EXEMPT " 0 || return 1
        # shellcheck disable=SC2034
        DHPK_GIT_EXEMPT=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A GIT_SEGMENT " 0 || return 1
        DHPK_GIT_SEGMENT=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A WORDS " 0 || return 1
        DHPK_WORDS=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A CMD_START " 0 || return 1
        DHPK_CMD_START=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A CMD_LEN " 0 || return 1
        DHPK_CMD_LEN=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A CMD_CWD " 1 || return 1
        # shellcheck disable=SC2034
        DHPK_CMD_CWD=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A CMD_PIPE_ID " 0 || return 1
        # shellcheck disable=SC2034
        DHPK_CMD_PIPE_ID=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        _dhpk_ci_cache_read_arr "A REDIRECT_TARGETS " 0 || return 1
        DHPK_REDIRECT_TARGETS=(${_dhpk_ci_tmp_arr[@]+"${_dhpk_ci_tmp_arr[@]}"})
        IFS= read -r line || return 1
        [ "$line" = "END" ] || return 1
    } <<< "$DHPK_INSPECT_CACHE"
    return 0
}

# dhpk_inspect_export_cache <command>
#   Exports DHPK_INSPECT_CACHE* for child hooks started by pre-bash-dispatch.sh
#   when command and cache size fit safely below Linux MAX_ARG_STRLEN (128 KiB).
dhpk_inspect_export_cache() {
    # shellcheck disable=SC2034
    local LC_ALL=C cmd="$1" _dhpk_ci_cache="" _dhpk_ci_esc_out=""
    if [ "${#cmd}" -ge 98304 ]; then
        unset DHPK_INSPECT_CACHE DHPK_INSPECT_CACHE_CMD DHPK_INSPECT_CACHE_CWD
        return 0
    fi
    _dhpk_ci_cache="dhpk-ci-v1"$'\n'
    _dhpk_ci_cache_esc "${DHPK_START_CWD:-}"; _dhpk_ci_cache+="S START_CWD ${_dhpk_ci_esc_out}"$'\n'
    _dhpk_ci_cache_esc "${DHPK_STRIPPED:-}"; _dhpk_ci_cache+="S STRIPPED ${_dhpk_ci_esc_out}"$'\n'
    _dhpk_ci_cache_esc "${DHPK_UNSUPPORTED:-}"; _dhpk_ci_cache+="S UNSUPPORTED ${_dhpk_ci_esc_out}"$'\n'
    _dhpk_ci_cache+="S GIT_COUNT ${DHPK_GIT_COUNT:-0}"$'\n'
    _dhpk_ci_cache+="S HD_FORCE_EXEC ${DHPK_HD_FORCE_EXEC:-0}"$'\n'
    _dhpk_ci_cache+="S INSPECT_FAST ${DHPK_INSPECT_FAST:-0}"$'\n'
    _dhpk_ci_cache_append_array "A GIT_SUB" 0 ${DHPK_GIT_SUB[@]+"${DHPK_GIT_SUB[@]}"}
    _dhpk_ci_cache_append_array "A GIT_REPO" 0 ${DHPK_GIT_REPO[@]+"${DHPK_GIT_REPO[@]}"}
    _dhpk_ci_cache_append_array "A GIT_REPO_STATE" 0 ${DHPK_GIT_REPO_STATE[@]+"${DHPK_GIT_REPO_STATE[@]}"}
    _dhpk_ci_cache_append_array "A GIT_NO_VERIFY" 0 ${DHPK_GIT_NO_VERIFY[@]+"${DHPK_GIT_NO_VERIFY[@]}"}
    _dhpk_ci_cache_append_array "A GIT_EXEMPT" 0 ${DHPK_GIT_EXEMPT[@]+"${DHPK_GIT_EXEMPT[@]}"}
    _dhpk_ci_cache_append_array "A GIT_SEGMENT" 0 ${DHPK_GIT_SEGMENT[@]+"${DHPK_GIT_SEGMENT[@]}"}
    _dhpk_ci_cache_append_array "A WORDS" 0 ${DHPK_WORDS[@]+"${DHPK_WORDS[@]}"}
    _dhpk_ci_cache_append_array "A CMD_START" 0 ${DHPK_CMD_START[@]+"${DHPK_CMD_START[@]}"}
    _dhpk_ci_cache_append_array "A CMD_LEN" 0 ${DHPK_CMD_LEN[@]+"${DHPK_CMD_LEN[@]}"}
    _dhpk_ci_cache_append_array "A CMD_CWD" 1 ${DHPK_CMD_CWD[@]+"${DHPK_CMD_CWD[@]}"}
    _dhpk_ci_cache_append_array "A CMD_PIPE_ID" 0 ${DHPK_CMD_PIPE_ID[@]+"${DHPK_CMD_PIPE_ID[@]}"}
    _dhpk_ci_cache_append_array "A REDIRECT_TARGETS" 0 ${DHPK_REDIRECT_TARGETS[@]+"${DHPK_REDIRECT_TARGETS[@]}"}
    _dhpk_ci_cache+="END"$'\n'
    if [ "${#_dhpk_ci_cache}" -lt 98304 ]; then
        export DHPK_INSPECT_CACHE="$_dhpk_ci_cache"
        export DHPK_INSPECT_CACHE_CMD="$cmd"
        export DHPK_INSPECT_CACHE_CWD="$DHPK_START_CWD"
    else
        unset DHPK_INSPECT_CACHE DHPK_INSPECT_CACHE_CMD DHPK_INSPECT_CACHE_CWD
    fi
    return 0
}

# dhpk_inspect_command <command> [start-cwd]
#   Fills DHPK_GIT_*, DHPK_WORDS, DHPK_CMD_*, DHPK_REDIRECT_TARGETS,
#   DHPK_STRIPPED and DHPK_UNSUPPORTED. start-cwd defaults to the process pwd.
#   A command dhpk_command_is_trivial accepts skips the per-character scan;
#   DHPK_INSPECT_FAST is 1 then and 0 when the full decoder ran.
dhpk_inspect_command() {
    # Byte indexing keeps ${#var} and ${var:i:n} O(1) instead of scanning UTF-8.
    # shellcheck disable=SC2034
    local LC_ALL=C
    local cmd="$1"
    local start="${2:-}"
    local unresolved_start="${DHPK_INSPECT_CWD_UNRESOLVED:-0}"
    [ -n "$start" ] || [ "$unresolved_start" = "1" ] || start="$(pwd -P 2>/dev/null || pwd)"
    if [ "$unresolved_start" != "1" ] && \
       [ -n "${DHPK_INSPECT_CACHE:-}" ] && \
       [ "${DHPK_INSPECT_CACHE_CMD+set}" = "set" ] && \
       [ "$cmd" = "$DHPK_INSPECT_CACHE_CMD" ] && \
       [ "$start" = "${DHPK_INSPECT_CACHE_CWD:-}" ] && \
       _dhpk_ci_cache_load "$start"; then
        # shellcheck disable=SC2034  # observability for tests confirming shared parse
        DHPK_INSPECT_CACHE_HIT=1
        return 0
    fi
    # shellcheck disable=SC2034
    DHPK_INSPECT_CACHE_HIT=0
    DHPK_GIT_COUNT=0
    DHPK_GIT_SUB=()
    DHPK_GIT_REPO=()
    DHPK_GIT_REPO_STATE=()
    # shellcheck disable=SC2034  # filled for pre-bash-guard / pretool-git-gate after source
    DHPK_GIT_NO_VERIFY=()
    # shellcheck disable=SC2034  # filled for pre-bash-guard / pretool-git-gate after source
    DHPK_GIT_EXEMPT=()
    DHPK_GIT_SEGMENT=()
    DHPK_STRIPPED=""
    DHPK_WORDS=()
    DHPK_CMD_START=()
    DHPK_CMD_LEN=()
    # shellcheck disable=SC2034  # read by pre-bash-guard after source
    DHPK_CMD_CWD=()
    # shellcheck disable=SC2034  # read by pre-bash-guard after source
    DHPK_CMD_PIPE_ID=()
    if [ "$unresolved_start" = "1" ]; then
        DHPK_START_CWD=""
    else
        # shellcheck disable=SC2034  # read by pre-bash-guard after source
        DHPK_START_CWD="$start"
    fi
    DHPK_REDIRECT_TARGETS=()
    DHPK_UNSUPPORTED=""
    # A process substitution or a FIFO can carry a cat heredoc into a shell.
    DHPK_HD_FORCE_EXEC=0
    case "$cmd" in
        *'>('*|*mkfifo*) DHPK_HD_FORCE_EXEC=1 ;;
    esac
    if dhpk_command_is_trivial "$cmd"; then
        _dhpk_ci_trivial_fill "$cmd" "$DHPK_START_CWD"
        # shellcheck disable=SC2034  # 1 when the fast path decoded the command
        DHPK_INSPECT_FAST=1
        return 0
    fi
    # shellcheck disable=SC2034  # 0 when the full decoder ran
    DHPK_INSPECT_FAST=0
    if [ "$unresolved_start" = "1" ]; then
        _dhpk_ci_cwd=""
        _dhpk_ci_cwd_state="unresolved"
    else
        _dhpk_ci_cwd="$start"
        _dhpk_ci_cwd_state="literal"
    fi
    _dhpk_ci_exec_next=0
    _dhpk_ci_depth=0
    _dhpk_ci_next_pipe_id=0
    _dhpk_ci_sub_stripped=""
    _dhpk_ci_expand_stripped=""
    _dhpk_ci_saw_eval=0
    _dhpk_ci_saw_source=0
    _dhpk_ci_saw_cd_dash=0
    _dhpk_ci_saw_cdpath=0
    _dhpk_ci_saw_shell_hs=0
    _dhpk_ci_saw_shell_feed=0
    _dhpk_ci_outps_depth=0
    _dhpk_ci_outps_acc=""
    _dhpk_ci_all_hs_flat=()
    _dhpk_ci_saw_shell_head=0
    _dhpk_ci_saw_shell_assign=0
    _dhpk_ci_git_taint=" "
    _dhpk_ci_git_named=" "
    _dhpk_ci_flag_clear
    _dhpk_ci_scan_git_taint "$cmd"
    _dhpk_ci_saw_arith_consumer=0
    _dhpk_ci_arith_texts=()
    # Any SHELL mention other than a plain $SHELL or ${SHELL} expansion
    # (for SHELL in, printf -v SHELL, ${SHELL:=x}, getopts, mapfile) may
    # reassign it, so the $SHELL -c allow is withdrawn for the command.
    _dhpk_ci_shell_rest="${cmd//\$\{SHELL\}/}"
    _dhpk_ci_shell_rest="${_dhpk_ci_shell_rest//\$SHELL/}"
    case "$_dhpk_ci_shell_rest" in
        *SHELL*) _dhpk_ci_saw_shell_assign=1 ;;
    esac
    unset _dhpk_ci_shell_rest
    _dhpk_ci_list "$cmd" 0 top
    unset _dhpk_ci_cwd _dhpk_ci_cwd_state _dhpk_ci_end _dhpk_ci_head _dhpk_ci_exec_next _dhpk_ci_depth
    unset _dhpk_ci_next_pipe_id _dhpk_ci_hd_word _dhpk_ci_hd_quoted _dhpk_ci_sub_stripped _dhpk_ci_expand_stripped
    _dhpk_ci_flag_clear
    unset _dhpk_ci_saw_eval _dhpk_ci_saw_source _dhpk_ci_saw_cd_dash _dhpk_ci_saw_cdpath _dhpk_ci_saw_shell_hs _dhpk_ci_saw_shell_feed _dhpk_ci_all_hs_flat _dhpk_ci_saw_shell_head _dhpk_ci_saw_shell_assign _dhpk_ci_git_taint _dhpk_ci_git_named _dhpk_ci_flag_names _dhpk_ci_flag_hit _dhpk_ci_cmd_text _dhpk_ci_pos_pool _dhpk_ci_pos_opaque _dhpk_ci_pos_segs _dhpk_ci_pos_words _dhpk_ci_bound_names _dhpk_ci_fs_anyname _dhpk_ci_fs_overflow _dhpk_ci_taint_overflow _dhpk_ci_fn_overflow _dhpk_ci_fs_rest_len _dhpk_ci_fs_uq _dhpk_ci_fs_uncertain _dhpk_ci_fs_sv _dhpk_ci_fs_pw _dhpk_ci_fs_pr _dhpk_ci_fs_funcs _dhpk_ci_fs_nfn _dhpk_ci_fs_raw _dhpk_ci_fs_words _dhpk_ci_fs_seg _dhpk_ci_taint_ifs _dhpk_ci_taint_gitassign _dhpk_ci_outps_depth _dhpk_ci_outps_acc _dhpk_ci_saw_arith_consumer _dhpk_ci_arith_texts
    return 0
}

# dhpk_command_has_commit
#   True when any inspected invocation's subcommand is exactly commit.
dhpk_command_has_commit() {
    local i=0
    while [ "$i" -lt "${DHPK_GIT_COUNT:-0}" ]; do
        [ "${DHPK_GIT_SUB[$i]}" = "commit" ] && return 0
        i=$((i + 1))
    done
    return 1
}

# dhpk_commit_targets <marker>
#   Prints `repo<TAB>path` or `unresolved` for each git commit whose own
#   segment does not contain the marker. Returns 1 when nothing remains.
dhpk_commit_targets() {
    local marker="$1" i=0 found=0 segment
    while [ "$i" -lt "${DHPK_GIT_COUNT:-0}" ]; do
        if [ "${DHPK_GIT_SUB[$i]}" = "commit" ]; then
            segment="${DHPK_GIT_SEGMENT[$i]}"
            if [ -n "$marker" ] && grep -Fq -- "$marker" < <(printf '%s' "$segment"); then
                i=$((i + 1))
                continue
            fi
            found=1
            if [ "${DHPK_GIT_REPO_STATE[$i]}" = "unresolved" ]; then
                printf 'unresolved\n'
            else
                printf 'repo\t%s\n' "${DHPK_GIT_REPO[$i]}"
            fi
        fi
        i=$((i + 1))
    done
    [ "$found" -eq 1 ]
    return $?
}

# dhpk_load_commit_roots <marker> <label>
#   Fills DHPK_COMMIT_ROOTS with toplevels for commit invocations that do not
#   carry the marker. Each skipped commit prints a diagnostic that includes
#   the marker. Unresolved targets are reported and are not replaced with the
#   session checkout. Returns 1 when there is nothing to check.
dhpk_load_commit_roots() {
    local marker="$1" label="$2" targets line repo top i=0 segment
    DHPK_COMMIT_ROOTS=()
    if [ -n "$marker" ]; then
        while [ "$i" -lt "${DHPK_GIT_COUNT:-0}" ]; do
            if [ "${DHPK_GIT_SUB[$i]}" = "commit" ]; then
                segment="${DHPK_GIT_SEGMENT[$i]}"
                if grep -Fq -- "$marker" < <(printf '%s' "$segment"); then
                    echo "[$label] $marker skip marker found in command; bypassing" >&2
                fi
            fi
            i=$((i + 1))
        done
    fi
    targets="$(dhpk_commit_targets "$marker")" || return 1
    while IFS= read -r line; do
        [ -n "$line" ] || continue
        case "$line" in
            unresolved)
                echo "[$label] target repository is not a literal path; not checking the session checkout" >&2
                ;;
            repo$'\t'*)
                repo="${line#repo$'\t'}"
                top="$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null || true)"
                [ -n "$top" ] && DHPK_COMMIT_ROOTS+=("$top")
                ;;
        esac
    done <<EOF
$targets
EOF
    [ "${#DHPK_COMMIT_ROOTS[@]}" -gt 0 ]
    return $?
}
