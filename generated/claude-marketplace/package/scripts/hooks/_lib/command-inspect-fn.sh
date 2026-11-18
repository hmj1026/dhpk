#!/usr/bin/env bash
# shellcheck disable=SC2154  # state arrays are declared by the sibling modules
# command-inspect-fn.sh - function table, known stdout, pipe, stdin and pin tracking, eval/trap/alias/arith/read-fed state.
# Source-only module of command-inspect.sh (#1501); sourced by it, not by hooks.
# bash 3.2. Never executes the command under inspection.

# The name before () or after `function`. The last flushed command is the
# name, or `function` plus the name.
_dhpk_ci_fn_name_from_last() {
    local ncmd start len w
    _dhpk_ci_fn_pending_name=""
    ncmd="${#DHPK_CMD_START[@]}"
    [ "$ncmd" -gt 0 ] || return 0
    start="${DHPK_CMD_START[$((ncmd - 1))]}"
    len="${DHPK_CMD_LEN[$((ncmd - 1))]}"
    # The name is the word just before `(`. A leading `{`, `then`, or `do`
    # opens a body and is not the name.
    [ "$len" -gt 0 ] || return 0
    w="${DHPK_WORDS[$((start + len - 1))]:-}"
    _dhpk_ci_fn_pending_name="$w"
}

# (#1468) True (and the text is refused) when the function table already holds 64 entries: a text with
# more definitions cannot be walked at a bounded cost, so it fails closed.
_dhpk_ci_fn_table_full() {
    [ "${#_dhpk_ci_shfn_name[@]}" -ge 64 ] || return 1
    _dhpk_ci_fn_overflow=1
    _dhpk_ci_unsupported "too many function definitions"
    return 0
}

# A later definition replaces the body. The call is judged from this text.
# fn_keep: a definition that may not run must not erase a body that is still live.
# frozen is cleared here. A definition that cannot run seals it again.
_dhpk_ci_fn_reset() {
    local name="$1" i=0
    [ -n "$name" ] || return 0
    while [ "$i" -lt "${#_dhpk_ci_shfn_name[@]}" ]; do
        if [ "${_dhpk_ci_shfn_name[$i]}" = "$name" ]; then
            if [ "${_dhpk_ci_fn_keep:-0}" != "1" ]; then
                _dhpk_ci_shfn_body[$i]=""
            fi
            _dhpk_ci_shfn_frozen[$i]=0
            return 0
        fi
        i=$((i + 1))
    done
    _dhpk_ci_fn_table_full && return 0
    _dhpk_ci_shfn_name+=("$name")
    _dhpk_ci_shfn_body+=("")
    _dhpk_ci_shfn_frozen+=("0")
}

# This definition's text is not executed. Keep the body that is still live.
_dhpk_ci_fn_freeze() {
    local name="$1" i=0
    while [ "$i" -lt "${#_dhpk_ci_shfn_name[@]}" ]; do
        if [ "${_dhpk_ci_shfn_name[$i]}" = "$name" ]; then
            _dhpk_ci_shfn_frozen[$i]=1
            return 0
        fi
        i=$((i + 1))
    done
}

# Open the definition named by fn_pending. A conditional keeps the old body.
# A literal `false &&` or `true ||` seals it so the new text is not recorded.
_dhpk_ci_fn_open_def() {
    local name="$1"
    _dhpk_ci_fn_keep=0
    if [ "${_dhpk_ci_fn_pending_cond:-0}" = "1" ] || [ "${_dhpk_ci_fn_pending_dead:-0}" = "1" ]; then
        _dhpk_ci_fn_keep=1
    fi
    _dhpk_ci_fn_reset "$name"
    _dhpk_ci_fn_sealed=0
    if [ "${_dhpk_ci_fn_pending_dead:-0}" = "1" ]; then
        _dhpk_ci_fn_freeze "$name"
        _dhpk_ci_fn_sealed=1
    fi
    _dhpk_ci_fn_keep=0
    _dhpk_ci_fn_pending=0
    _dhpk_ci_fn_pending_cond=0
    _dhpk_ci_fn_pending_dead=0
}

# The previous command is a literal false/true, so this && / || side cannot run.
# The current command is not in DHPK_CMD yet.
_dhpk_ci_note_intro_dead() {
    local ncmd start len w
    _dhpk_ci_cmd_intro_dead=0
    case "${_dhpk_ci_prev_sep:-}" in
        and|or) ;;
        *) return 0 ;;
    esac
    ncmd="${#DHPK_CMD_START[@]}"
    [ "$ncmd" -ge 1 ] || return 0
    start="${DHPK_CMD_START[$((ncmd - 1))]}"
    len="${DHPK_CMD_LEN[$((ncmd - 1))]}"
    [ "$len" -eq 1 ] || return 0
    w="${DHPK_WORDS[$start]:-}"
    case "${_dhpk_ci_prev_sep:-}" in
        and) [ "$w" != "false" ] || _dhpk_ci_cmd_intro_dead=1 ;;
        or) [ "$w" != "true" ] || _dhpk_ci_cmd_intro_dead=1 ;;
    esac
    return 0
}

# if/while/until/for/select/case after `name()` or `function name` is the body.
_dhpk_ci_fn_is_compound_body() {
    local i=0 w skipped_name=0
    while [ "$i" -lt "${#_dhpk_ci_words[@]}" ]; do
        [ "${_dhpk_ci_quoted[$i]:-0}" != "0" ] && return 1
        w="${_dhpk_ci_words[$i]}"
        case "$w" in
            function) skipped_name=1; i=$((i + 1)) ;;
            '!'|time|coproc) i=$((i + 1)) ;;
            if|while|until|for|select|case) return 0 ;;
            *)
                if [ "$skipped_name" -eq 1 ]; then
                    skipped_name=0
                    i=$((i + 1))
                    continue
                fi
                return 1
                ;;
        esac
    done
    return 1
}

_dhpk_ci_fn_compound_open() {
    local d="${_dhpk_ci_fn_cdepth:-0}" name="${_dhpk_ci_fn_pending_name:-}"
    _dhpk_ci_fn_open_def "$name"
    _dhpk_ci_fn_cname[$d]="$name"
    _dhpk_ci_fn_cbase[$d]="${_dhpk_ci_block:-0}"
    _dhpk_ci_fn_cexport[$d]="${_dhpk_ci_allexport:-0}"
    _dhpk_ci_fn_csticky[$d]="${_dhpk_ci_git_env_sticky:-0}"
    _dhpk_ci_fn_clast[$d]="${_dhpk_ci_lastpipe:-0}"
    _dhpk_ci_fn_cifs[$d]="${_dhpk_ci_ifs_custom:-0}"
    _dhpk_ci_fn_cdepth=$((d + 1))
    _dhpk_ci_fn_copened=1
}

_dhpk_ci_fn_compound_close() {
    local top
    while [ "${_dhpk_ci_fn_cdepth:-0}" -gt 0 ] \
        && [ "${_dhpk_ci_block:-0}" -eq "${_dhpk_ci_fn_cbase[$((_dhpk_ci_fn_cdepth - 1))]}" ]; do
        _dhpk_ci_fn_cdepth=$((_dhpk_ci_fn_cdepth - 1))
        top="$_dhpk_ci_fn_cdepth"
        if [ "${_dhpk_ci_allexport:-0}" -eq 0 ]; then
            _dhpk_ci_allexport="${_dhpk_ci_fn_cexport[$top]}"
        fi
        if [ "${_dhpk_ci_fn_csticky[$top]:-0}" = "1" ]; then
            _dhpk_ci_git_env_sticky=1
        fi
        if [ "${_dhpk_ci_lastpipe:-0}" -eq 0 ]; then
            _dhpk_ci_lastpipe="${_dhpk_ci_fn_clast[$top]}"
        fi
        if [ "${_dhpk_ci_fn_cifs[$top]:-0}" = "1" ]; then
            _dhpk_ci_ifs_custom=1
        fi
    done
}

# The live function table, so a subshell can redefine names and then give
# them back. Length prefixes keep names and bodies that contain the separator.
_dhpk_ci_fn_save_live() {
    [ "${_dhpk_ci_fn_overflow:-0}" = 1 ] && return 0
    local i=0 n=0 out="" name body fr sep=$'\x1f'
    n="${#_dhpk_ci_shfn_name[@]}"
    out="$n"
    while [ "$i" -lt "$n" ]; do
        name="${_dhpk_ci_shfn_name[$i]}"
        body="${_dhpk_ci_shfn_body[$i]-}"
        fr="${_dhpk_ci_shfn_frozen[$i]:-0}"
        out+="${sep}${#name}${sep}${name}${sep}${#body}${sep}${body}${sep}${fr}"
        i=$((i + 1))
    done
    _dhpk_ci_shfn_snap[$1]="$out"
}

_dhpk_ci_fn_body_of() {
    local name="$1" i=0
    _dhpk_ci_fn_one=""
    while [ "$i" -lt "${#_dhpk_ci_shfn_name[@]}" ]; do
        if [ "${_dhpk_ci_shfn_name[$i]}" = "$name" ]; then
            _dhpk_ci_fn_one="${_dhpk_ci_shfn_body[$i]-}"
            return 0
        fi
        i=$((i + 1))
    done
    return 1
}

_dhpk_ci_fn_set_body() {
    local name="$1" body="$2" i=0
    while [ "$i" -lt "${#_dhpk_ci_shfn_name[@]}" ]; do
        if [ "${_dhpk_ci_shfn_name[$i]}" = "$name" ]; then
            _dhpk_ci_shfn_body[$i]="$body"
            return 0
        fi
        i=$((i + 1))
    done
    _dhpk_ci_fn_table_full && return 0
    _dhpk_ci_shfn_name+=("$name")
    _dhpk_ci_shfn_body+=("$body")
}
_dhpk_ci_fn_restore_live() {
    [ "${_dhpk_ci_fn_overflow:-0}" = 1 ] && return 0
    local raw="${_dhpk_ci_shfn_snap[$1]-}" sep=$'\x1f' n=0 i=0 len=0 name="" body="" fr=0
    _dhpk_ci_shfn_name=()
    _dhpk_ci_shfn_body=()
    _dhpk_ci_shfn_frozen=()
    [ -n "$raw" ] || return 0
    n="${raw%%"$sep"*}"
    case "$n" in
        ''|*[!0-9]*) return 0 ;;
    esac
    [ "$n" -eq 0 ] && return 0
    [ "$raw" = "$n" ] && return 0
    raw="${raw#*"$sep"}"
    while [ "$i" -lt "$n" ]; do
        len="${raw%%"$sep"*}"
        raw="${raw#*"$sep"}"
        name="${raw:0:$len}"
        raw="${raw:$len}"
        raw="${raw#*"$sep"}"
        len="${raw%%"$sep"*}"
        raw="${raw#*"$sep"}"
        body="${raw:0:$len}"
        raw="${raw:$len}"
        raw="${raw#*"$sep"}"
        fr="${raw%%"$sep"*}"
        case "$fr" in
            1) ;;
            *) fr=0 ;;
        esac
        _dhpk_ci_shfn_name+=("$name")
        _dhpk_ci_shfn_body+=("$body")
        _dhpk_ci_shfn_frozen+=("$fr")
        i=$((i + 1))
        if [ "$i" -lt "$n" ]; then
            raw="${raw#*"$sep"}"
        fi
    done
}

# Innermost `name()` body. Its tokens stay off the live table until `)`.
_dhpk_ci_fn_paren_slot_for() {
    local name="$1" p
    _dhpk_ci_fn_paren_slot=-1
    [ "${_dhpk_ci_fn_depth:-0}" -eq 0 ] || return 1
    [ "${_dhpk_ci_fn_cdepth:-0}" -eq 0 ] || return 1
    [ "${_dhpk_ci_fn_simple:-0}" -eq 0 ] || return 1
    p=$((${_dhpk_ci_paren:-0} - 1))
    while [ "$p" -ge 0 ]; do
        if [ "${_dhpk_ci_shfn_saved[$p]:-0}" = "2" ]; then
            if [ "${_dhpk_ci_fn_paren_stk[$p]:-}" = "$name" ]; then
                _dhpk_ci_fn_paren_slot=$p
                return 0
            fi
            return 1
        fi
        p=$((p - 1))
    done
    return 1
}

# Turn `C name` into S or U from the table as it is before a subshell restore.
_dhpk_ci_fn_resolve_calls() {
    local rest="$1" line="" out="" name=""
    _dhpk_ci_fn_resolved_body=""
    while [ -n "$rest" ]; do
        line="${rest%%$'\n'*}"
        case "$rest" in
            *$'\n'*) rest="${rest#*$'\n'}" ;;
            *) rest="" ;;
        esac
        case "$line" in
            C\ *)
                name="${line#C }"
                _dhpk_ci_fn_kind_of "$name"
                case "${_dhpk_ci_fn_resolved:-none}" in
                    stdin) line="S" ;;
                    opaque) line="U" ;;
                esac
                ;;
        esac
        if [ -n "$out" ]; then
            out="${out}"$'\n'"$line"
        else
            out="$line"
        fi
    done
    _dhpk_ci_fn_resolved_body="$out"
}

# `name` before `()` was recorded as a call. It is the definition, not a call.
_dhpk_ci_fn_strip_line() {
    local text="$1" line="$2" nl=$'\n'
    _dhpk_ci_fn_stripped="$text"
    if [ "$text" = "$line" ]; then
        _dhpk_ci_fn_stripped=""
        return 0
    fi
    case "$text" in
        *"$nl$line") _dhpk_ci_fn_stripped="${text%"$nl$line"}" ;;
    esac
}

_dhpk_ci_fn_drop_def_token() {
    local name="$1" text="" slot=0
    [ -n "$name" ] || return 0
    _dhpk_ci_fn_defining_name || return 0
    if _dhpk_ci_fn_paren_slot_for "$_dhpk_ci_fn_def_name"; then
        slot="$_dhpk_ci_fn_paren_slot"
        text="${_dhpk_ci_fn_pbuf[$slot]:-}"
        _dhpk_ci_fn_strip_line "$text" "C $name"
        _dhpk_ci_fn_pbuf[$slot]="$_dhpk_ci_fn_stripped"
        return 0
    fi
    _dhpk_ci_fn_body_of "$_dhpk_ci_fn_def_name" || return 0
    text="${_dhpk_ci_fn_one-}"
    _dhpk_ci_fn_strip_line "$text" "C $name"
    _dhpk_ci_fn_set_body "$_dhpk_ci_fn_def_name" "$_dhpk_ci_fn_stripped"
}

_dhpk_ci_fn_add_token() {
    local name="$1" token="$2" i=0 found=0 slot=0 cur=""
    [ -n "$name" ] || return 0
    while [ "$i" -lt "${#_dhpk_ci_shfn_name[@]}" ]; do
        if [ "${_dhpk_ci_shfn_name[$i]}" = "$name" ]; then
            [ "${_dhpk_ci_shfn_frozen[$i]:-0}" = "1" ] && return 0
            found=1
            break
        fi
        i=$((i + 1))
    done
    if _dhpk_ci_fn_paren_slot_for "$name"; then
        slot="$_dhpk_ci_fn_paren_slot"
        cur="${_dhpk_ci_fn_pbuf[$slot]:-}"
        if [ -n "$cur" ]; then
            _dhpk_ci_fn_pbuf[$slot]="${cur}"$'\n'"$token"
        else
            _dhpk_ci_fn_pbuf[$slot]="$token"
        fi
        return 0
    fi
    if [ "$found" -eq 1 ]; then
        if [ -n "${_dhpk_ci_shfn_body[$i]:-}" ]; then
            _dhpk_ci_shfn_body[$i]="${_dhpk_ci_shfn_body[$i]}"$'\n'"$token"
        else
            _dhpk_ci_shfn_body[$i]="$token"
        fi
        return 0
    fi
    _dhpk_ci_fn_table_full && return 0
    _dhpk_ci_shfn_name+=("$name")
    _dhpk_ci_shfn_body+=("$token")
    _dhpk_ci_shfn_frozen+=("0")
}

# stdin: the body runs a shell that reads stdin. opaque: the body may, and
# the command word is not a visible literal. none: it does not.
_dhpk_ci_fn_walk() {
    local name="$1" depth="$2" i=0 body="" rest="" line="" kind="none" saved=""
    _dhpk_ci_fn_resolved="none"
    [ "$depth" -gt 8 ] && { _dhpk_ci_fn_resolved="opaque"; return 0; }
    case "${_dhpk_ci_fn_seen:-}" in
        *"|$name|"*) return 0 ;;
    esac
    _dhpk_ci_fn_seen="${_dhpk_ci_fn_seen:-}|$name|"
    while [ "$i" -lt "${#_dhpk_ci_shfn_name[@]}" ]; do
        if [ "${_dhpk_ci_shfn_name[$i]}" = "$name" ]; then
            body="${_dhpk_ci_shfn_body[$i]:-}"
            break
        fi
        i=$((i + 1))
    done
    [ -n "$body" ] || return 0
    rest="$body"
    while [ -n "$rest" ]; do
        line="${rest%%$'\n'*}"
        case "$rest" in
            *$'\n'*) rest="${rest#*$'\n'}" ;;
            *) rest="" ;;
        esac
        case "$line" in
            S) kind="stdin" ;;
            U)
                [ "$kind" != "stdin" ] && kind="opaque"
                ;;
            C\ *)
                if [ "$kind" != "stdin" ]; then
                    saved="$kind"
                    _dhpk_ci_fn_walk "${line#C }" $((depth + 1))
                    case "${_dhpk_ci_fn_resolved:-none}" in
                        stdin) kind="stdin" ;;
                        opaque) [ "$saved" != "stdin" ] && kind="opaque" ;;
                        *) kind="$saved" ;;
                    esac
                fi
                ;;
        esac
    done
    _dhpk_ci_fn_resolved="$kind"
}

_dhpk_ci_fn_kind_of() {
    _dhpk_ci_fn_seen=""
    _dhpk_ci_fn_walk "$1" 0
}

# Name of the function whose body contains this command, when one is open.
_dhpk_ci_fn_defining_name() {
    local p
    _dhpk_ci_fn_def_name=""
    if [ "${_dhpk_ci_fn_simple:-0}" = "1" ]; then
        _dhpk_ci_fn_def_name="${_dhpk_ci_fn_simple_name:-}"
        [ -n "$_dhpk_ci_fn_def_name" ]
        return $?
    fi
    if [ "${_dhpk_ci_fn_depth:-0}" -gt 0 ]; then
        _dhpk_ci_fn_def_name="${_dhpk_ci_fn_name_stk[$((_dhpk_ci_fn_depth - 1))]:-}"
        [ -n "$_dhpk_ci_fn_def_name" ]
        return $?
    fi
    if [ "${_dhpk_ci_fn_cdepth:-0}" -gt 0 ]; then
        _dhpk_ci_fn_def_name="${_dhpk_ci_fn_cname[$((_dhpk_ci_fn_cdepth - 1))]:-}"
        [ -n "$_dhpk_ci_fn_def_name" ]
        return $?
    fi
    p=$((${_dhpk_ci_paren:-0} - 1))
    while [ "$p" -ge 0 ]; do
        if [ -n "${_dhpk_ci_fn_paren_stk[$p]:-}" ]; then
            _dhpk_ci_fn_def_name="${_dhpk_ci_fn_paren_stk[$p]}"
            return 0
        fi
        p=$((p - 1))
    done
    return 1
}

# echo/printf whose stdout is a literal. Sets _dhpk_ci_out_text.
_dhpk_ci_known_stdout() {
    local base i n script="" fmt="" nflag=0 eflag=0
    _dhpk_ci_out_text=""
    base="${_dhpk_ci_u_head##*/}"
    case "$base" in
        echo|printf) ;;
        *) return 1 ;;
    esac
    n="${#_dhpk_ci_u_words[@]}"
    i="${_dhpk_ci_u_idx:-0}"
    while [ "$i" -lt "$n" ]; do
        [ "${_dhpk_ci_u_dyn[$i]:-0}" = "1" ] && return 1
        i=$((i + 1))
    done
    i=$((${_dhpk_ci_u_idx:-0} + 1))
    if [ "$base" = "echo" ]; then
        while [ "$i" -lt "$n" ] && _dhpk_ci_echo_opt "${_dhpk_ci_u_words[$i]}"; do
            case "${_dhpk_ci_u_words[$i]}" in
                *n*) nflag=1 ;;
                *e*) eflag=1 ;;
            esac
            i=$((i + 1))
        done
        while [ "$i" -lt "$n" ]; do
            if [ -n "$script" ]; then
                script+=" ${_dhpk_ci_u_words[$i]}"
            else
                script="${_dhpk_ci_u_words[$i]}"
            fi
            i=$((i + 1))
        done
        if [ "$eflag" -eq 1 ] && _dhpk_ci_eval_has_backslash "$script"; then
            return 1
        fi
        [ "$nflag" -eq 0 ] && script+=$'\n'
        _dhpk_ci_out_text="$script"
        return 0
    fi
    [ "$i" -lt "$n" ] || return 1
    fmt="${_dhpk_ci_u_words[$i]}"
    i=$((i + 1))
    if [ "$fmt" != '%s' ] && [ "$fmt" != '%s\n' ]; then
        return 1
    fi
    if [ "$fmt" = '%s' ]; then
        while [ "$i" -lt "$n" ]; do
            script+="${_dhpk_ci_u_words[$i]}"
            i=$((i + 1))
        done
    else
        while [ "$i" -lt "$n" ]; do
            script+="${_dhpk_ci_u_words[$i]}"$'\n'
            i=$((i + 1))
        done
    fi
    _dhpk_ci_out_text="$script"
    return 0
}

_dhpk_ci_subst_add() {
    [ "${_dhpk_ci_kind:-}" = "subst" ] || return 0
    if [ "$1" != "1" ]; then
        _dhpk_ci_subst_known=0
        return 0
    fi
    [ "${_dhpk_ci_subst_known:-1}" = "1" ] || return 0
    _dhpk_ci_subst_text+="$2"
}

# Move _dhpk_ci_fetch_j past one wrapper's flags. Returns 1 when this
# command is not a download (command -v, or env -S whose command is inside
# the split string). The flag shapes match the guard's head walk so an
# unsupported block does not hide "piping remote download into shell".
_dhpk_ci_fetch_skip_wrapper() {
    local end="$1" kind="$2" w=""
    _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1))
    case "$kind" in
        builtin) return 0 ;;
        command)
            while [ "$_dhpk_ci_fetch_j" -lt "$end" ]; do
                w="${DHPK_WORDS[$_dhpk_ci_fetch_j]}"
                case "$w" in
                    --) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)); break ;;
                    -*[vV]*) return 1 ;;
                    -*) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)) ;;
                    *) break ;;
                esac
            done
            ;;
        exec)
            while [ "$_dhpk_ci_fetch_j" -lt "$end" ]; do
                w="${DHPK_WORDS[$_dhpk_ci_fetch_j]}"
                case "$w" in
                    --) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)); break ;;
                    -a) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 2)) ;;
                    -*) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)) ;;
                    *) break ;;
                esac
            done
            ;;
        env)
            while [ "$_dhpk_ci_fetch_j" -lt "$end" ]; do
                w="${DHPK_WORDS[$_dhpk_ci_fetch_j]}"
                case "$w" in
                    --) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)); break ;;
                    -S|--split-string|--split-string=*|-S?*|-*S) return 1 ;;
                    --unset=*|--chdir=*) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)) ;;
                    -u|--unset|-C|--chdir) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 2)) ;;
                    -C?*|-u?*) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)) ;;
                    -*C|-*u) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 2)) ;;
                    --*) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)) ;;
                    -*) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)) ;;
                    *) break ;;
                esac
            done
            ;;
        nice)
            while [ "$_dhpk_ci_fetch_j" -lt "$end" ]; do
                w="${DHPK_WORDS[$_dhpk_ci_fetch_j]}"
                case "$w" in
                    --) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)); break ;;
                    -n|--adjustment) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 2)) ;;
                    -*) _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1)) ;;
                    *) break ;;
                esac
            done
            ;;
        nohup)
            if [ "$_dhpk_ci_fetch_j" -lt "$end" ] && [ "${DHPK_WORDS[$_dhpk_ci_fetch_j]}" = "--" ]; then
                _dhpk_ci_fetch_j=$((_dhpk_ci_fetch_j + 1))
            fi
            ;;
    esac
    return 0
}

# curl|sh is already a named guard pattern. Only the command word counts:
# a filename whose basename is curl is not a download. Leading reserved
# words are not that command word; `{ curl; } | sh` stores `{` in the same
# argv, and `then` / `do` do the same. A wrapper flag is not the command
# word either. Missing either sets an unsupported block that hides the
# guard's remote-download message.
_dhpk_ci_pipe_has_fetch() {
    local i=0 ncmd start len j end w base
    [ "${_dhpk_ci_pipe_id:-0}" != "0" ] || return 1
    ncmd="${#DHPK_CMD_START[@]}"
    while [ "$i" -lt "$ncmd" ]; do
        if [ "${DHPK_CMD_PIPE_ID[$i]:-0}" = "$_dhpk_ci_pipe_id" ]; then
            start="${DHPK_CMD_START[$i]}"
            len="${DHPK_CMD_LEN[$i]}"
            end=$((start + len))
            j="$start"
            while [ "$j" -lt "$end" ]; do
                w="${DHPK_WORDS[$j]}"
                case "$w" in
                    '!'|'{'|if|then|else|elif|do|while|until|coproc)
                        j=$((j + 1))
                        continue
                        ;;
                    time)
                        j=$((j + 1))
                        if [ "$j" -lt "$end" ] && [ "${DHPK_WORDS[$j]}" = "-p" ]; then
                            j=$((j + 1))
                        fi
                        continue
                        ;;
                    [A-Za-z_]*=*) j=$((j + 1)); continue ;;
                esac
                base="${w##*/}"
                case "$base" in
                    curl|wget|fetch) return 0 ;;
                    command|builtin|exec|env|nice|nohup)
                        _dhpk_ci_fetch_j="$j"
                        _dhpk_ci_fetch_skip_wrapper "$end" "$base" || break
                        j="$_dhpk_ci_fetch_j"
                        continue
                        ;;
                    *) break ;;
                esac
            done
        fi
        i=$((i + 1))
    done
    return 1
}

# Feed a pipe buffer unless this pipe is the curl|sh family. That family
# already has its own guard message, which runs after an unsupported block.
_dhpk_ci_feed_pipe_buf() {
    local text="$1" known="$2"
    if [ "$known" = "1" ] || ! _dhpk_ci_pipe_has_fetch; then
        _dhpk_ci_feed_text "$text" "$known"
    fi
}

# Visible text that a shell or `.` will run. Unknown text stays unresolved.
_dhpk_ci_feed_text() {
    local text="$1" known="$2" before=0
    if [ "$known" != "1" ]; then
        _dhpk_ci_unsupported "shell input is not visible"
        return 0
    fi
    [ -n "$text" ] || return 0
    before="${DHPK_GIT_COUNT:-0}"
    _dhpk_ci_inspect_body_cwd "$text" "${_dhpk_ci_u_cwd:-}" "${_dhpk_ci_u_cwd_state:-unresolved}"
    if [ "${DHPK_GIT_COUNT:-0}" -gt "$before" ]; then
        _dhpk_ci_saw_shell_feed=1
    fi
}

_dhpk_ci_is_stdin_op() {
    local w="$1" rest
    case "$w" in
        '<') return 0 ;;
        *'<')
            rest="${w%<}"
            case "$rest" in
                ''|*[!0-9]*) return 1 ;;
                *) return 0 ;;
            esac
            ;;
    esac
    return 1
}

_dhpk_ci_ps_at_index() {
    local idx="$1" i=0
    _dhpk_ci_ps_hit=0
    _dhpk_ci_ps_one_text=""
    _dhpk_ci_ps_one_known=0
    while [ "$i" -lt "${#_dhpk_ci_ps_at[@]}" ]; do
        if [ "${_dhpk_ci_ps_at[$i]}" = "$idx" ]; then
            _dhpk_ci_ps_hit=1
            _dhpk_ci_ps_one_text="${_dhpk_ci_ps_body[$i]:-}"
            _dhpk_ci_ps_one_known="${_dhpk_ci_ps_ok[$i]:-0}"
            return 0
        fi
        i=$((i + 1))
    done
    return 1
}

# /dev/stdin, /dev/fd/0 and /proc/self/fd/0 are the script, not a file.
_dhpk_ci_stdin_device() {
    case "$1" in
        /dev/stdin|/dev/fd/0|/proc/self/fd/0) return 0 ;;
    esac
    return 1
}

# First real operand of `.` or `source`. A redirect is not that operand.
# Sets _dhpk_ci_dot_kind to stdin, opaque, ps, file or none.
_dhpk_ci_dot_scan() {
    local i="$1" seen=0 w
    _dhpk_ci_dot_kind="none"
    _dhpk_ci_dot_ps=-1
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_words[$i]}"
        [ "$w" = "}" ] && break
        if _dhpk_ci_is_stdin_op "$w"; then
            i=$((i + 1))
            [ "$i" -lt "$n" ] && i=$((i + 1))
            continue
        fi
        if [ "$seen" -eq 0 ]; then
            seen=1
            if _dhpk_ci_ps_at_index "$i"; then
                _dhpk_ci_dot_kind="ps"
                _dhpk_ci_dot_ps="$i"
            elif [ "${_dhpk_ci_dyn[$i]:-0}" = "1" ]; then
                _dhpk_ci_dot_kind="opaque"
            elif _dhpk_ci_stdin_device "$w"; then
                _dhpk_ci_dot_kind="stdin"
            else
                _dhpk_ci_dot_kind="file"
            fi
        fi
        i=$((i + 1))
    done
}

# Advance past one wrapper in a `function name { ... }` body, which is one
# simple command. Sets _dhpk_ci_fn_skip_at and _dhpk_ci_fn_skip_how
# (more, stop, or opaque).
_dhpk_ci_fn_skip_one() {
    local i="$1" w base tok
    w="${_dhpk_ci_words[$i]}"
    base="${w##*/}"
    i=$((i + 1))
    _dhpk_ci_fn_skip_how="more"
    case "$base" in
        command)
            while [ "$i" -lt "$n" ]; do
                tok="${_dhpk_ci_words[$i]}"
                [ "$tok" = "}" ] && break
                case "$tok" in
                    --) i=$((i + 1)); break ;;
                    -p) i=$((i + 1)) ;;
                    -*v*|-*V*) _dhpk_ci_fn_skip_how="stop"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    -*) _dhpk_ci_fn_skip_how="opaque"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    *) break ;;
                esac
            done
            ;;
        builtin)
            [ "$i" -lt "$n" ] && [ "${_dhpk_ci_words[$i]}" = "--" ] && i=$((i + 1))
            ;;
        exec)
            while [ "$i" -lt "$n" ]; do
                tok="${_dhpk_ci_words[$i]}"
                [ "$tok" = "}" ] && break
                case "$tok" in
                    --) i=$((i + 1)); break ;;
                    -a) i=$((i + 2)) ;;
                    -a*) i=$((i + 1)) ;;
                    -[cl]*) i=$((i + 1)) ;;
                    -*) _dhpk_ci_fn_skip_how="opaque"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    *) break ;;
                esac
            done
            ;;
        time)
            while [ "$i" -lt "$n" ]; do
                tok="${_dhpk_ci_words[$i]}"
                [ "$tok" = "}" ] && break
                case "$tok" in
                    --) i=$((i + 1)); break ;;
                    --verbose|--quiet|--append|-p|-v|-q|-a) i=$((i + 1)) ;;
                    --output|--format|-o|-f) i=$((i + 2)) ;;
                    --output=*|--format=*|-o?*|-f?*) i=$((i + 1)) ;;
                    -*) _dhpk_ci_fn_skip_how="opaque"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    *) break ;;
                esac
            done
            ;;
        env)
            while [ "$i" -lt "$n" ]; do
                tok="${_dhpk_ci_words[$i]}"
                [ "$tok" = "}" ] && break
                case "$tok" in
                    --) i=$((i + 1)); break ;;
                    -) i=$((i + 1)); continue ;;
                    --help|--version) _dhpk_ci_fn_skip_how="stop"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    --ignore-environment|--null|--debug|--list-signal-handling) i=$((i + 1)) ;;
                    --split-string|--split-string=*|-S|-S*) _dhpk_ci_fn_skip_how="opaque"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    --unset|--argv0|--chdir) i=$((i + 2)) ;;
                    --unset=*|--argv0=*|--chdir=*) i=$((i + 1)) ;;
                    --*) _dhpk_ci_fn_skip_how="opaque"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    -i|-0|-v) i=$((i + 1)) ;;
                    -u|-a|-C) i=$((i + 2)) ;;
                    -u*|-a*|-C*) i=$((i + 1)) ;;
                    -*) _dhpk_ci_fn_skip_how="opaque"; _dhpk_ci_fn_skip_at="$i"; return 0 ;;
                    [A-Za-z_]*=*) i=$((i + 1)) ;;
                    *) break ;;
                esac
            done
            ;;
    esac
    _dhpk_ci_fn_skip_at="$i"
}

# Token for the shell word at $1 inside a function-keyword body.
# -s keeps stdin as the script; a later file or process substitution is $0.
# -c, including a cluster such as -sc, runs that operand and does not read
# the caller's stdin. A following word must not clear either decision.
_dhpk_ci_fn_shell_token() {
    local i="$1" w="" saw_c=0 saw_s=0 sign=1 opt="" oi=0 olen=0 skip_ops=0
    i=$((i + 1))
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_words[$i]}"
        [ "$w" = "}" ] && break
        case "$w" in
            --|-) i=$((i + 1)); break ;;
            --rcfile|--init-file|--startup-cmd) i=$((i + 2)); continue ;;
            --*) i=$((i + 1)); continue ;;
            [-+]*)
                sign=1
                [ "${w:0:1}" = "+" ] && sign=0
                opt="${w#[-+]}"
                oi=0
                olen="${#opt}"
                skip_ops=0
                while [ "$oi" -lt "$olen" ]; do
                    case "${opt:$oi:1}" in
                        c) saw_c=1 ;;
                        s) [ "$sign" -eq 1 ] && saw_s=1 ;;
                        o|O)
                            if [ $((oi + 1)) -lt "$olen" ]; then
                                oi=$olen
                                continue
                            fi
                            skip_ops=$((skip_ops + 1))
                            ;;
                    esac
                    oi=$((oi + 1))
                done
                i=$((i + 1 + skip_ops))
                continue
                ;;
            *) break ;;
        esac
    done
    if [ "$saw_c" -eq 1 ] && [ "$i" -lt "$n" ] && [ "${_dhpk_ci_words[$i]}" != "}" ]; then
        if [ "${_dhpk_ci_dyn[$i]:-0}" = "1" ]; then
            _dhpk_ci_fn_kw_token="U"
        else
            _dhpk_ci_inspect_body_cwd "${_dhpk_ci_words[$i]}" "${_dhpk_ci_u_cwd:-}" "${_dhpk_ci_u_cwd_state:-unresolved}"
            _dhpk_ci_fn_kw_token=""
        fi
        return 0
    fi
    if [ "$saw_s" -eq 1 ]; then
        _dhpk_ci_fn_kw_token="S"
        return 0
    fi
    if [ "$i" -lt "$n" ] && [ "${_dhpk_ci_words[$i]}" != "}" ]; then
        w="${_dhpk_ci_words[$i]}"
        if _dhpk_ci_ps_at_index "$i"; then
            _dhpk_ci_fn_kw_token=""
        elif [ "${_dhpk_ci_dyn[$i]:-0}" = "1" ]; then
            _dhpk_ci_fn_kw_token="U"
        elif _dhpk_ci_stdin_device "$w"; then
            _dhpk_ci_fn_kw_token="S"
        else
            _dhpk_ci_fn_kw_token=""
        fi
        return 0
    fi
    _dhpk_ci_fn_kw_token="S"
}

# The word after `{` in `function name { ... }`, after assignments and wrappers.
_dhpk_ci_fn_keyword_token() {
    local i=0 w base
    _dhpk_ci_fn_kw_token=""
    while [ "$i" -lt "$n" ]; do
        [ "${_dhpk_ci_words[$i]}" = "{" ] && break
        i=$((i + 1))
    done
    i=$((i + 1))
    [ "$i" -lt "$n" ] || return 0
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_words[$i]}"
        [ "$w" = "}" ] && return 0
        case "$w" in
            [A-Za-z_]*=*) i=$((i + 1)); continue ;;
        esac
        break
    done
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_words[$i]}"
        [ "$w" = "}" ] && return 0
        base="${w##*/}"
        case "$base" in
            command|builtin|exec|time|env)
                _dhpk_ci_fn_skip_one "$i"
                case "${_dhpk_ci_fn_skip_how:-more}" in
                    stop) return 0 ;;
                    opaque) _dhpk_ci_fn_kw_token="U"; return 0 ;;
                esac
                i="${_dhpk_ci_fn_skip_at:-$((i + 1))}"
                continue
                ;;
            nice|sudo|timeout|xargs|nohup|stdbuf|doas)
                _dhpk_ci_fn_kw_token="U"
                return 0
                ;;
        esac
        break
    done
    [ "$i" -lt "$n" ] || return 0
    w="${_dhpk_ci_words[$i]}"
    [ "$w" = "}" ] && return 0
    if [ "${_dhpk_ci_dyn[$i]:-0}" = "1" ]; then
        _dhpk_ci_fn_kw_token="U"
        return 0
    fi
    if _dhpk_ci_is_shell_word "$w"; then
        _dhpk_ci_fn_shell_token "$i"
        return 0
    fi
    if [ "$w" = "." ] || [ "$w" = "source" ]; then
        _dhpk_ci_dot_scan $((i + 1))
        case "${_dhpk_ci_dot_kind:-none}" in
            stdin) _dhpk_ci_fn_kw_token="S" ;;
            opaque) _dhpk_ci_fn_kw_token="U" ;;
        esac
        return 0
    fi
    _dhpk_ci_fn_kw_token="C $w"
}

_dhpk_ci_outps_note() {
    case "${_dhpk_ci_outps_acc:-}" in
        feed|spent) return 0 ;;
    esac
    case "$1" in
        feed|opaque|spent) _dhpk_ci_outps_acc="$1" ;;
    esac
}

# A command inside >( ) that runs its stdin as a script.
_dhpk_ci_outps_classify() {
    local base
    [ "${_dhpk_ci_outps_depth:-0}" -gt 0 ] || return 0
    if [ "${_dhpk_ci_u_dyn[${_dhpk_ci_u_idx:-0}]:-0}" = "1" ]; then
        _dhpk_ci_outps_note opaque
        return 0
    fi
    if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head"; then
        _dhpk_ci_extract_shell_c $((_dhpk_ci_u_idx + 1))
        case "${_dhpk_ci_shell_reads_stdin:-0}" in
            1) _dhpk_ci_outps_note feed ;;
            2) _dhpk_ci_outps_note opaque ;;
        esac
    elif [ "$_dhpk_ci_u_head" = "." ] || [ "$_dhpk_ci_u_head" = "source" ]; then
        _dhpk_ci_dot_scan $((h + _dhpk_ci_u_idx + 1))
        case "${_dhpk_ci_dot_kind:-none}" in
            stdin) _dhpk_ci_outps_note feed ;;
            opaque) _dhpk_ci_outps_note opaque ;;
        esac
    else
        _dhpk_ci_fn_kind_of "$_dhpk_ci_u_head"
        case "${_dhpk_ci_fn_resolved:-none}" in
            stdin) _dhpk_ci_outps_note feed ;;
            opaque) _dhpk_ci_outps_note opaque ;;
            *)
                # cat before a shell reads this process substitution.
                # A later function must not be fed the same stdin.
                base="${_dhpk_ci_u_head##*/}"
                case "$base" in
                    cat) _dhpk_ci_cat_reads_pipe && _dhpk_ci_outps_note spent ;;
                    tee|read)
                        [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ] && _dhpk_ci_outps_note spent
                        ;;
                esac
                ;;
        esac
    fi
}

# Bytes written to >(shell). tee copies the pipe; other commands use stdout.
_dhpk_ci_apply_outps() {
    local i=0 nq mode text="" known=0 base
    nq="${#_dhpk_ci_outps_q[@]}"
    [ "$nq" -gt 0 ] || return 0
    base="${_dhpk_ci_u_head##*/}"
    if [ "$base" = "tee" ]; then
        if [ "${_dhpk_ci_after_pipe:-0}" = "1" ] || [ "${_dhpk_ci_pipe_id:-0}" != "0" ]; then
            text="${_dhpk_ci_pipe_text:-}"
            known="${_dhpk_ci_pipe_known:-0}"
        else
            known=0
        fi
    elif _dhpk_ci_known_stdout; then
        text="$_dhpk_ci_out_text"
        known=1
    else
        known=0
    fi
    while [ "$i" -lt "$nq" ]; do
        mode="${_dhpk_ci_outps_q[$i]}"
        if [ "$mode" = "feed" ] && [ "$known" = "1" ]; then
            _dhpk_ci_feed_text "$text" 1
        else
            _dhpk_ci_unsupported "shell input is not visible"
        fi
        i=$((i + 1))
    done
    _dhpk_ci_outps_q=()
}

# Drop the pin selected by _dhpk_ci_pin_take. slot is paren or group.
_dhpk_ci_pin_drop() {
    if [ "$1" = "paren" ]; then
        _dhpk_ci_pin_live[$2]=0
    else
        _dhpk_ci_gpin_live[$2]=0
    fi
}

# cat with only file operands does not read the inherited pipe.
# Returns 0 when this cat consumes that pipe.
_dhpk_ci_cat_reads_pipe() {
    local i=$((_dhpk_ci_u_idx + 1)) n="${#_dhpk_ci_u_words[@]}" w saw=0
    [ "${#_dhpk_ci_hs_words[@]}" -gt 0 ] && return 1
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$i]}"
        case "$w" in
            --) i=$((i + 1)); break ;;
            # A lone dash is stdin, not an option. `cat - file` still reads the pipe.
            -) break ;;
            -*) i=$((i + 1)); continue ;;
            *) break ;;
        esac
    done
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$i]}"
        saw=1
        if [ "$w" = "-" ] || _dhpk_ci_stdin_device "$w"; then
            return 0
        fi
        i=$((i + 1))
    done
    [ "$saw" -eq 0 ]
}

# A subshell or a compound command that is a pipeline stage keeps the
# incoming pipe. Walk groups from the inside out so a `{` or if pin is
# nearer than an outer subshell pin. echo and a shell that redirects its
# own stdin do not consume it. An inner pipe's right-hand stage reads that
# pipe; finish already judged it.
_dhpk_ci_pin_take() {
    local p base slot text known g pp
    _dhpk_ci_pin_took=0
    if [ "${_dhpk_ci_after_pipe:-0}" = "1" ]; then
        return 0
    fi
    slot=""
    g=$((${_dhpk_ci_grp_depth:-0} - 1))
    while [ "$g" -ge 0 ]; do
        if [ "${_dhpk_ci_grp_kind[$g]:-}" = "paren" ]; then
            pp="${_dhpk_ci_grp_pidx[$g]:--1}"
            if [ "$pp" -ge 0 ] && [ "${_dhpk_ci_pin_live[$pp]:-0}" = "1" ]; then
                slot="paren"
                p="$pp"
                text="${_dhpk_ci_pin_text[$pp]:-}"
                known="${_dhpk_ci_pin_known[$pp]:-0}"
                break
            fi
        elif [ "${_dhpk_ci_gpin_live[$g]:-0}" = "1" ]; then
            slot="group"
            p="$g"
            text="${_dhpk_ci_gpin_text[$g]:-}"
            known="${_dhpk_ci_gpin_known[$g]:-0}"
            break
        fi
        g=$((g - 1))
    done
    [ -n "$slot" ] || return 0
    # "$fn" may be the shell that reads this pin. The name is not visible.
    if [ "${_dhpk_ci_u_dyn[${_dhpk_ci_u_idx:-0}]:-0}" = "1" ]; then
        _dhpk_ci_unsupported "shell input is not visible"
        return 0
    fi
    if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head"; then
        _dhpk_ci_extract_shell_c $((_dhpk_ci_u_idx + 1))
        # -c, a script file, or a here-string replaces this command's stdin
        # only. The inherited pipe is still there for a later command.
        if [ "${_dhpk_ci_shell_reads_stdin:-0}" = "1" ] && [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ]; then
            _dhpk_ci_feed_pipe_buf "$text" "$known"
            _dhpk_ci_pin_drop "$slot" "$p"
            _dhpk_ci_pin_took=1
        fi
        return 0
    fi
    if [ "$_dhpk_ci_u_head" = "." ] || [ "$_dhpk_ci_u_head" = "source" ]; then
        _dhpk_ci_dot_scan $((h + _dhpk_ci_u_idx + 1))
        case "${_dhpk_ci_dot_kind:-none}" in
            stdin)
                if [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ]; then
                    # `.` is not a shell word the curl|sh guard recognises.
                    _dhpk_ci_feed_text "$text" "$known"
                    _dhpk_ci_pin_drop "$slot" "$p"
                    _dhpk_ci_pin_took=1
                fi
                ;;
            opaque)
                _dhpk_ci_unsupported "shell input is not visible"
                _dhpk_ci_pin_drop "$slot" "$p"
                ;;
        esac
        return 0
    fi
    # A call whose body reads stdin inherits this pin. A body that does not
    # is an ordinary command and may consume the pipe below.
    _dhpk_ci_fn_kind_of "$_dhpk_ci_u_head"
    case "${_dhpk_ci_fn_resolved:-none}" in
        stdin)
            if [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ]; then
                # The guard only treats a literal shell as the right-hand
                # side of curl|sh. A function call has to block on its own.
                _dhpk_ci_feed_text "$text" "$known"
                _dhpk_ci_pin_drop "$slot" "$p"
                _dhpk_ci_pin_took=1
            fi
            return 0
            ;;
        opaque)
            _dhpk_ci_unsupported "shell input is not visible"
            _dhpk_ci_pin_drop "$slot" "$p"
            return 0
            ;;
    esac
    # echo, a compound keyword, and a file-only cat leave the pipe for a
    # later command. cat, tee, and read are what consume it. Another word
    # such as ls does not, so `echo git | { ls; bash; }` still runs git.
    base="${_dhpk_ci_u_head##*/}"
    case "$base" in
        echo|printf|true|false|:|test|'['|for|select|case|'fi'|'done'|'esac') return 0 ;;
        cat)
            _dhpk_ci_cat_reads_pipe || return 0
            _dhpk_ci_pin_drop "$slot" "$p"
            return 0
            ;;
        tee|read)
            [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ] && _dhpk_ci_pin_drop "$slot" "$p"
            return 0
            ;;
    esac
    return 0
}

# BASH_ENV=, ENV=, --rcfile and --init-file name a script a shell runs before
# its own input, whether or not -i or -c is given (Debian can read BASH_ENV or
# an rcfile for a non-interactive shell too). Text the command itself carries,
# a process substitution or the stdin device fed by a pipe, is judged like any
# other shell input. A path is not read (ADR 0037).
_dhpk_ci_feed_startup_files() {
    local i=0 w prev="" kind val stdin_startup=0 shell_head=0
    _dhpk_ci_is_shell_word "$_dhpk_ci_u_head" && shell_head=1
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_words[$i]}"
        kind=""
        case "$w" in
            BASH_ENV=*|BASH_ENV+=*|ENV=*|ENV+=*) kind=1; val="${w#*=}" ;;
            *)
                if [ "$shell_head" -eq 1 ]; then
                    case "$prev" in
                        --rcfile|--init-file) kind=1; val="$w" ;;
                    esac
                fi
                ;;
        esac
        prev="$w"
        i=$((i + 1))
        [ -n "$kind" ] || continue
        if _dhpk_ci_ps_at_index $((i - 1)); then
            _dhpk_ci_feed_text "$_dhpk_ci_ps_one_text" "$_dhpk_ci_ps_one_known"
        elif _dhpk_ci_stdin_device "$val"; then
            stdin_startup=1
        fi
    done
    [ "$stdin_startup" -eq 1 ] || return 0
    i=0
    while [ "$i" -lt "$n" ]; do
        if _dhpk_ci_is_stdin_op "${_dhpk_ci_words[$i]}" && _dhpk_ci_ps_at_index $((i + 1)); then
            _dhpk_ci_feed_text "$_dhpk_ci_ps_one_text" "$_dhpk_ci_ps_one_known"
            return 0
        fi
        i=$((i + 1))
    done
    if [ "${_dhpk_ci_after_pipe:-0}" = "1" ] && [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ]; then
        _dhpk_ci_feed_pipe_buf "${_dhpk_ci_pipe_text:-}" "${_dhpk_ci_pipe_known:-0}"
    fi
}

# Record a function body, then judge stdin that reaches a shell or `.`.
_dhpk_ci_finish_command_input() {
    local def="" token="" reads=0 i=0 w fed=0 stdin_at=-1 kind="none" file_at=-1
    if _dhpk_ci_fn_defining_name; then
        def="$_dhpk_ci_fn_def_name"
        case "$head" in
            ''|'{'|'}'|'('|')'|'fi'|'done'|'esac') ;;
            function)
                _dhpk_ci_fn_keyword_token
                [ -n "${_dhpk_ci_fn_kw_token:-}" ] && _dhpk_ci_fn_add_token "$def" "$_dhpk_ci_fn_kw_token"
                ;;
            *)
                if [ "${_dhpk_ci_u_dyn[$_dhpk_ci_u_idx]:-0}" = "1" ]; then
                    token="U"
                elif _dhpk_ci_is_shell_word "$_dhpk_ci_u_head"; then
                    _dhpk_ci_extract_shell_c $((_dhpk_ci_u_idx + 1))
                    case "${_dhpk_ci_shell_reads_stdin:-0}" in
                        1) token="S" ;;
                        2) token="U" ;;
                        *) token="" ;;
                    esac
                elif [ "$_dhpk_ci_u_head" = "." ] || [ "$_dhpk_ci_u_head" = "source" ]; then
                    _dhpk_ci_dot_scan $((h + _dhpk_ci_u_idx + 1))
                    case "${_dhpk_ci_dot_kind:-none}" in
                        stdin) token="S" ;;
                        opaque) token="U" ;;
                        *) token="" ;;
                    esac
                else
                    token="C ${_dhpk_ci_u_head}"
                fi
                [ -n "$token" ] && _dhpk_ci_fn_add_token "$def" "$token"
                ;;
        esac
    fi
    if [ "${#_dhpk_ci_hs_words[@]}" -gt 0 ] || [ "${_dhpk_ci_after_pipe:-0}" = "1" ] || [ "${#_dhpk_ci_ps_at[@]}" -gt 0 ]; then
        i=0
        while [ "$i" -lt "$n" ]; do
            w="${_dhpk_ci_words[$i]}"
            if _dhpk_ci_is_stdin_op "$w" && _dhpk_ci_ps_at_index $((i + 1)); then
                stdin_at=$((i + 1))
                break
            fi
            i=$((i + 1))
        done
        if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head"; then
            _dhpk_ci_extract_shell_c $((_dhpk_ci_u_idx + 1))
            reads="${_dhpk_ci_shell_reads_stdin:-0}"
            file_at=-1
            if [ "${_dhpk_ci_shell_file_idx:--1}" -ge 0 ]; then
                file_at=$((h + _dhpk_ci_shell_file_idx))
            fi
            # A stdin redirect is the script only when this shell reads stdin.
            # -c and a real script file do not.
            if [ "$reads" = "1" ] && [ "$stdin_at" -ge 0 ]; then
                _dhpk_ci_ps_at_index "$stdin_at"
                _dhpk_ci_feed_text "$_dhpk_ci_ps_one_text" "$_dhpk_ci_ps_one_known"
                fed=1
            fi
            if [ "$fed" -eq 0 ] && [ "$reads" != "1" ] && [ -z "${_dhpk_ci_shell_c_payload:-}" ] && [ "$file_at" -ge 0 ] && _dhpk_ci_ps_at_index "$file_at"; then
                _dhpk_ci_feed_text "$_dhpk_ci_ps_one_text" "$_dhpk_ci_ps_one_known"
                fed=1
            fi
            if [ "$fed" -eq 0 ] && [ "$reads" = "1" ] && [ "${_dhpk_ci_after_pipe:-0}" = "1" ] && [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ]; then
                _dhpk_ci_feed_pipe_buf "${_dhpk_ci_pipe_text:-}" "${_dhpk_ci_pipe_known:-0}"
                fed=1
            fi
            if [ "$fed" -eq 0 ] && [ "$reads" = "2" ] && [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ]; then
                if [ "${_dhpk_ci_after_pipe:-0}" != "1" ] || ! _dhpk_ci_pipe_has_fetch; then
                    _dhpk_ci_unsupported "shell input is not visible"
                fi
            fi
        elif [ "$_dhpk_ci_u_head" = "." ] || [ "$_dhpk_ci_u_head" = "source" ]; then
            _dhpk_ci_dot_scan $((h + _dhpk_ci_u_idx + 1))
            case "${_dhpk_ci_dot_kind:-none}" in
                ps)
                    _dhpk_ci_ps_at_index "$_dhpk_ci_dot_ps"
                    _dhpk_ci_feed_text "$_dhpk_ci_ps_one_text" "$_dhpk_ci_ps_one_known"
                    ;;
                stdin)
                    if [ "$stdin_at" -ge 0 ]; then
                        _dhpk_ci_ps_at_index "$stdin_at"
                        _dhpk_ci_feed_text "$_dhpk_ci_ps_one_text" "$_dhpk_ci_ps_one_known"
                    elif [ "${_dhpk_ci_after_pipe:-0}" = "1" ] && [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ]; then
                        # `.` is not a shell word the curl|sh guard recognises.
                        _dhpk_ci_feed_text "${_dhpk_ci_pipe_text:-}" "${_dhpk_ci_pipe_known:-0}"
                    fi
                    ;;
                opaque)
                    if [ "$stdin_at" -ge 0 ] || [ "${#_dhpk_ci_hs_words[@]}" -gt 0 ] || [ "${_dhpk_ci_after_pipe:-0}" = "1" ] || [ "${#_dhpk_ci_ps_at[@]}" -gt 0 ]; then
                        _dhpk_ci_unsupported "shell input is not visible"
                    fi
                    ;;
            esac
        else
            if [ "${_dhpk_ci_u_dyn[${_dhpk_ci_u_idx:-0}]:-0}" = "1" ]; then
                _dhpk_ci_unsupported "shell input is not visible"
            else
            _dhpk_ci_fn_kind_of "$_dhpk_ci_u_head"
            kind="${_dhpk_ci_fn_resolved:-none}"
            if [ "$kind" = "stdin" ]; then
                if [ "$stdin_at" -ge 0 ]; then
                    _dhpk_ci_ps_at_index "$stdin_at"
                    _dhpk_ci_feed_text "$_dhpk_ci_ps_one_text" "$_dhpk_ci_ps_one_known"
                elif [ "${#_dhpk_ci_hs_words[@]}" -gt 0 ]; then
                    i=0
                    while [ "$i" -lt "${#_dhpk_ci_hs_words[@]}" ]; do
                        if [ "${_dhpk_ci_hs_dyn[$i]:-0}" = "1" ] || [ -z "${_dhpk_ci_hs_flat[$i]:-}" ]; then
                            _dhpk_ci_unsupported "shell input is not visible"
                        else
                            _dhpk_ci_feed_text "${_dhpk_ci_hs_flat[$i]}" "1"
                        fi
                        i=$((i + 1))
                    done
                elif [ "${_dhpk_ci_after_pipe:-0}" = "1" ]; then
                    _dhpk_ci_feed_text "${_dhpk_ci_pipe_text:-}" "${_dhpk_ci_pipe_known:-0}"
                fi
            elif [ "$kind" = "opaque" ]; then
                if [ "$stdin_at" -ge 0 ] || [ "${#_dhpk_ci_hs_words[@]}" -gt 0 ] || [ "${_dhpk_ci_after_pipe:-0}" = "1" ] || [ "${#_dhpk_ci_ps_at[@]}" -gt 0 ]; then
                    _dhpk_ci_unsupported "shell input is not visible"
                fi
            fi
            fi
        fi
    fi
    if [ "${#_dhpk_ci_ps_at[@]}" -gt 0 ] || [ "${_dhpk_ci_after_pipe:-0}" = "1" ]; then
        _dhpk_ci_feed_startup_files
    fi
    _dhpk_ci_outps_classify
    _dhpk_ci_pin_take
    # tee must see the previous stage. Its own stdout replaces that buffer below.
    _dhpk_ci_apply_outps
    # A subshell stage clears after_pipe, but its pipe id is still the
    # surrounding pipeline. Its stdout replaces the previous stage.
    if [ "$sep" = "pipe" ] || [ "${_dhpk_ci_after_pipe:-0}" = "1" ] || [ "${_dhpk_ci_pipe_id:-0}" != "0" ]; then
        if _dhpk_ci_known_stdout; then
            _dhpk_ci_pipe_text="$_dhpk_ci_out_text"
            _dhpk_ci_pipe_known=1
        else
            _dhpk_ci_pipe_text=""
            _dhpk_ci_pipe_known=0
        fi
    elif [ "${_dhpk_ci_kind:-}" = "subst" ]; then
        if _dhpk_ci_known_stdout; then
            _dhpk_ci_subst_add 1 "$_dhpk_ci_out_text"
        else
            _dhpk_ci_subst_add 0 ""
        fi
    fi
}

# `{` of a function body. The body is scanned because a later call may run
# it, so allexport and sticky can turn on and stay on. They must not turn
# off on the way out: an uncalled `set +a` would otherwise hide a relocation
# that is still exported in the caller.
_dhpk_ci_fn_see_open_brace() {
    local top
    if [ "${_dhpk_ci_fn_pending:-0}" -eq 1 ]; then
        _dhpk_ci_fn_name_stk[${_dhpk_ci_fn_depth}]="${_dhpk_ci_fn_pending_name:-}"
        # &&, ||, and a conditional block may not run this definition.
        _dhpk_ci_fn_open_def "${_dhpk_ci_fn_pending_name:-}"
        _dhpk_ci_fn_allexport_stk[${_dhpk_ci_fn_depth}]="${_dhpk_ci_allexport:-0}"
        _dhpk_ci_fn_sticky_stk[${_dhpk_ci_fn_depth}]="${_dhpk_ci_git_env_sticky:-0}"
        _dhpk_ci_fn_lastpipe_stk[${_dhpk_ci_fn_depth}]="${_dhpk_ci_lastpipe:-0}"
        _dhpk_ci_fn_ifs_stk[${_dhpk_ci_fn_depth}]="${_dhpk_ci_ifs_custom:-0}"
        _dhpk_ci_fn_brace[${_dhpk_ci_fn_depth}]=1
        _dhpk_ci_fn_depth=$((_dhpk_ci_fn_depth + 1))
        _dhpk_ci_fn_pending=0
    elif [ "${_dhpk_ci_fn_depth:-0}" -gt 0 ]; then
        top=$((_dhpk_ci_fn_depth - 1))
        _dhpk_ci_fn_brace[$top]=$((${_dhpk_ci_fn_brace[$top]} + 1))
    fi
}

_dhpk_ci_fn_see_close_brace() {
    local top
    [ "${_dhpk_ci_fn_depth:-0}" -gt 0 ] || return 0
    top=$((_dhpk_ci_fn_depth - 1))
    _dhpk_ci_fn_brace[$top]=$((${_dhpk_ci_fn_brace[$top]} - 1))
    if [ "${_dhpk_ci_fn_brace[$top]}" -le 0 ]; then
        _dhpk_ci_fn_depth=$top
        if [ "${_dhpk_ci_allexport:-0}" -eq 0 ]; then
            _dhpk_ci_allexport="${_dhpk_ci_fn_allexport_stk[$top]}"
        fi
        if [ "${_dhpk_ci_fn_sticky_stk[$top]}" -eq 1 ]; then
            _dhpk_ci_git_env_sticky=1
        fi
        if [ "${_dhpk_ci_lastpipe:-0}" -eq 0 ]; then
            _dhpk_ci_lastpipe="${_dhpk_ci_fn_lastpipe_stk[$top]}"
        fi
        # An uncalled body must not clear a custom IFS that is still in effect.
        if [ "${_dhpk_ci_fn_ifs_stk[$top]:-0}" = "1" ]; then
            _dhpk_ci_ifs_custom=1
        fi
    fi
}

_dhpk_ci_fn_simple_leave() {
    [ "${_dhpk_ci_fn_simple:-0}" -eq 1 ] || return 0
    if [ "${_dhpk_ci_allexport:-0}" -eq 0 ]; then
        _dhpk_ci_allexport="${_dhpk_ci_fn_simple_allexport:-0}"
    fi
    if [ "${_dhpk_ci_fn_simple_sticky:-0}" -eq 1 ]; then
        _dhpk_ci_git_env_sticky=1
    fi
    if [ "${_dhpk_ci_lastpipe:-0}" -eq 0 ]; then
        _dhpk_ci_lastpipe="${_dhpk_ci_fn_simple_lastpipe:-0}"
    fi
    _dhpk_ci_fn_simple=0
}

# Command substitution, process substitution, a pipeline stage, and a
# background command run in a subshell. They inherit allexport and sticky
# and must not write those flags back to the caller.
_dhpk_ci_ss_push() {
    local d="${_dhpk_ci_ss_depth:-0}"
    _dhpk_ci_ss_allexport_stk[$d]="${_dhpk_ci_allexport:-0}"
    _dhpk_ci_ss_sticky_stk[$d]="${_dhpk_ci_git_env_sticky:-0}"
    _dhpk_ci_ss_lastpipe_stk[$d]="${_dhpk_ci_lastpipe:-0}"
    # Only the pipeline-stage frame needs the value from before this
    # command's assignment. A substitution nested inside the command sees
    # the IFS already in force, and must not roll that back on pop.
    if [ "${1:-}" = "stage" ]; then
        _dhpk_ci_ss_ifs_stk[$d]="${_dhpk_ci_cmd_ifs:-0}"
        # unwrap already applied this command's prefix. Keep the stamp
        # from before that prefix so the stage pop can drop it.
        _dhpk_ci_ss_ifs_stamp_stk[$d]="${_dhpk_ci_ifs_stamp_at:-0}"
    else
        _dhpk_ci_ss_ifs_stk[$d]="${_dhpk_ci_ifs_custom:-0}"
        _dhpk_ci_ss_ifs_stamp_stk[$d]="${_dhpk_ci_ifs_stamp:-0}"
    fi
    # Reads inside this frame belong to a subshell unless the caller keeps
    # the frame (lastpipe). The mark is the caller's array length.
    _dhpk_ci_ss_rf_stk[$d]="${#_dhpk_ci_rf_name[@]}"
    _dhpk_ci_ss_depth=$((d + 1))
}

_dhpk_ci_ss_pop() {
    local d="${_dhpk_ci_ss_depth:-0}"
    [ "$d" -gt 0 ] || return 0
    d=$((d - 1))
    _dhpk_ci_ss_depth=$d
    _dhpk_ci_allexport="${_dhpk_ci_ss_allexport_stk[$d]}"
    _dhpk_ci_git_env_sticky="${_dhpk_ci_ss_sticky_stk[$d]}"
    _dhpk_ci_lastpipe="${_dhpk_ci_ss_lastpipe_stk[$d]}"
    _dhpk_ci_ifs_custom="${_dhpk_ci_ss_ifs_stk[$d]}"
    _dhpk_ci_ifs_stamp="${_dhpk_ci_ss_ifs_stamp_stk[$d]}"
    _dhpk_ci_rf_keep "${_dhpk_ci_ss_rf_stk[$d]}"
}

# allexport exports the name printf -v and read assign.
_dhpk_ci_allexport_printf() {
    [ "${_dhpk_ci_allexport:-0}" -eq 1 ] || return 0
    local k=$((_dhpk_ci_u_idx + 1)) n="${#_dhpk_ci_u_words[@]}" w name
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            --) k=$((k + 1)); break ;;
            -v)
                name="${_dhpk_ci_u_words[$((k + 1))]:-}"
                _dhpk_ci_word_sets_git_env "$name" && _dhpk_ci_git_env_sticky=1
                _dhpk_ci_note_exported_shell_var "$name"
                k=$((k + 2))
                ;;
            -v*)
                name="${w#-v}"
                _dhpk_ci_word_sets_git_env "$name" && _dhpk_ci_git_env_sticky=1
                _dhpk_ci_note_exported_shell_var "$name"
                k=$((k + 1))
                ;;
            -*) k=$((k + 1)) ;;
            *) break ;;
        esac
    done
}

# echo treats a leading -[neE]+ word as a flag, not text.
_dhpk_ci_echo_opt() {
    local f="$1" i=1 n="${#1}" ch=""
    [ "${f:0:1}" = "-" ] || return 1
    [ "$n" -ge 2 ] || return 1
    while [ "$i" -lt "$n" ]; do
        ch="${f:$i:1}"
        case "$ch" in
            n|e|E) ;;
            *) return 1 ;;
        esac
        i=$((i + 1))
    done
    return 0
}

# Quote-split echo/printf text. Sets _dhpk_ci_ev_words. Returns 1 when the
# printed text still contains a parameter or command substitution: eval
# would expand it, and the command is not visible here.
_dhpk_ci_eval_split() {
    local s="$1" i=0 n="${#1}" ch="" word="" in_sq=0 in_dq=0 dyn=0 meta=0
    _dhpk_ci_ev_words=()
    _dhpk_ci_ev_dyn=0
    _dhpk_ci_ev_meta=0
    while [ "$i" -lt "$n" ]; do
        ch="${s:$i:1}"
        if [ "$in_sq" -eq 1 ]; then
            if [ "$ch" = "'" ]; then
                in_sq=0
            else
                word+="$ch"
                [ "$ch" = '$' ] || [ "$ch" = $'\x60' ] && dyn=1
            fi
        elif [ "$in_dq" -eq 1 ]; then
            if [ "$ch" = '"' ]; then
                in_dq=0
            elif [ "$ch" = "\\" ] && [ $((i + 1)) -lt "$n" ]; then
                i=$((i + 1))
                ch="${s:$i:1}"
                case "$ch" in
                    '"'|'\\'|'$'|$'\x60') word+="$ch" ;;
                    *) word+="\\$ch" ;;
                esac
                [ "$ch" = '$' ] || [ "$ch" = $'\x60' ] && dyn=1
            else
                word+="$ch"
                [ "$ch" = '$' ] || [ "$ch" = $'\x60' ] && dyn=1
            fi
        else
            case "$ch" in
                "'") in_sq=1 ;;
                '"') in_dq=1 ;;
                ' '|$'\t')
                    if [ -n "$word" ]; then
                        _dhpk_ci_ev_words+=("$word")
                        word=""
                    fi
                    ;;
                $'\n')
                    if [ -n "$word" ]; then
                        _dhpk_ci_ev_words+=("$word")
                        word=""
                    fi
                    meta=1
                    ;;
                "\\")
                    if [ $((i + 1)) -lt "$n" ]; then
                        i=$((i + 1))
                        ch="${s:$i:1}"
                        if [ "$ch" != $'\n' ]; then
                            word+="$ch"
                            [ "$ch" = '$' ] || [ "$ch" = $'\x60' ] && dyn=1
                        fi
                    fi
                    ;;
                ';'|'|'|'&')
                    if [ -n "$word" ]; then
                        _dhpk_ci_ev_words+=("$word")
                        word=""
                    fi
                    meta=1
                    ;;
                *)
                    word+="$ch"
                    [ "$ch" = '$' ] || [ "$ch" = $'\x60' ] && dyn=1
                    ;;
            esac
        fi
        i=$((i + 1))
    done
    [ -n "$word" ] && _dhpk_ci_ev_words+=("$word")
    _dhpk_ci_ev_dyn=$dyn
    _dhpk_ci_ev_meta=$meta
    return 0
}

# eval "$(echo git commit)" runs the echo output. A bare parameter, a
# parameter with a suffix, or echo/printf whose output is not literal stays
# unresolved. The file named by a variable is not read.
_dhpk_ci_eval_see_word() {
    local w="$1" inner="" first="" last="" i=0 fmt="" script="" n=0 base=""
    _dhpk_ci_eval_piece=""
    [ "${#w}" -ge 2 ] || return 0
    first="${w:0:2}"
    last="${w:$((${#w} - 1)):1}"
    if [ "$first" = '$(' ] && [ "$last" = ')' ]; then
        inner="${w:2:$((${#w} - 3))}"
    elif [ "${w:0:1}" = $'\x60' ] && [ "$last" = $'\x60' ]; then
        inner="${w:1:$((${#w} - 2))}"
    else
        return 0
    fi
    _dhpk_ci_eval_split "$inner"
    n="${#_dhpk_ci_ev_words[@]}"
    [ "$n" -gt 0 ] || return 0
    if [ "${_dhpk_ci_ev_meta:-0}" = "1" ]; then
        i=0
        while [ "$i" -lt "$n" ]; do
            case "${_dhpk_ci_ev_words[$i]##*/}" in
                echo|printf)
                    _dhpk_ci_unsupported "unresolved eval"
                    return 0
                    ;;
            esac
            i=$((i + 1))
        done
    fi
    i=0
    while [ "$i" -lt "$n" ]; do
        case "${_dhpk_ci_ev_words[$i]}" in
            command)
                i=$((i + 1))
                while [ "$i" -lt "$n" ]; do
                    case "${_dhpk_ci_ev_words[$i]}" in
                        --) i=$((i + 1)); break ;;
                        -*)
                            fmt="${_dhpk_ci_ev_words[$i]#-}"
                            [ -n "$fmt" ] || { _dhpk_ci_unsupported "unresolved eval"; return 0; }
                            last=0
                            while [ "$last" -lt "${#fmt}" ]; do
                                case "${fmt:$last:1}" in
                                    p|v|V) ;;
                                    *) _dhpk_ci_unsupported "unresolved eval"; return 0 ;;
                                esac
                                last=$((last + 1))
                            done
                            i=$((i + 1))
                            ;;
                        *) break ;;
                    esac
                done
                ;;
            builtin)
                i=$((i + 1))
                if [ "$i" -lt "$n" ] && [ "${_dhpk_ci_ev_words[$i]}" = "--" ]; then
                    i=$((i + 1))
                fi
                ;;
            *) break ;;
        esac
    done
    [ "$i" -lt "$n" ] || return 0
    base="${_dhpk_ci_ev_words[$i]##*/}"
    case "$base" in
        echo)
            i=$((i + 1))
            first=0
            while [ "$i" -lt "$n" ] && _dhpk_ci_echo_opt "${_dhpk_ci_ev_words[$i]}"; do
                case "${_dhpk_ci_ev_words[$i]}" in
                    *e*) first=1 ;;
                esac
                i=$((i + 1))
            done
            script=""
            while [ "$i" -lt "$n" ]; do
                if [ -n "$script" ]; then
                    script+=" ${_dhpk_ci_ev_words[$i]}"
                else
                    script="${_dhpk_ci_ev_words[$i]}"
                fi
                i=$((i + 1))
            done
            if [ "$first" -eq 1 ] && _dhpk_ci_eval_has_backslash "$script"; then
                _dhpk_ci_unsupported "unresolved eval"
                return 0
            fi
            ;;
        printf)
            i=$((i + 1))
            [ "$i" -lt "$n" ] || return 0
            fmt="${_dhpk_ci_ev_words[$i]}"
            i=$((i + 1))
            # \"%s\" prints a quoted word. eval does not run the argument.
            if [ "$fmt" = '"%s"' ]; then
                # The format wraps each argument in quotes. A quote, slash,
                # or expansion inside the argument is executed by eval.
                if [ "${_dhpk_ci_ev_dyn:-0}" != "0" ]; then
                    _dhpk_ci_unsupported "unresolved eval"
                    return 0
                fi
                while [ "$i" -lt "$n" ]; do
                    if _dhpk_ci_eval_arg_breaks_quote "${_dhpk_ci_ev_words[$i]}"; then
                        _dhpk_ci_unsupported "unresolved eval"
                        return 0
                    fi
                    i=$((i + 1))
                done
                return 0
            fi
            if [ "$fmt" != '%s' ] && [ "$fmt" != '%s\n' ]; then
                _dhpk_ci_unsupported "unresolved eval"
                return 0
            fi
            script=""
            if [ "$fmt" = '%s' ]; then
                while [ "$i" -lt "$n" ]; do
                    script+="${_dhpk_ci_ev_words[$i]}"
                    i=$((i + 1))
                done
            else
                while [ "$i" -lt "$n" ]; do
                    if [ -n "$script" ]; then
                        script+=$'\n'
                    fi
                    script+="${_dhpk_ci_ev_words[$i]}"
                    i=$((i + 1))
                done
            fi
            ;;
        *) return 0 ;;
    esac
    if [ "${_dhpk_ci_ev_dyn:-0}" != "0" ]; then
        _dhpk_ci_unsupported "unresolved eval"
        return 0
    fi
    [ -n "$script" ] || return 0
    # The caller joins this with the rest of eval's arguments. Eval
    # concatenates those arguments with one space before it parses them.
    _dhpk_ci_eval_piece="$script"
    return 0
}

# True when printf '"%s"' would not leave one quoted word for eval.
_dhpk_ci_eval_arg_breaks_quote() {
    local s="$1" i=0 ch=""
    while [ "$i" -lt "${#s}" ]; do
        ch="${s:$i:1}"
        if [ "$ch" = '"' ] || [ "$ch" = "\\" ] || [ "$ch" = '$' ] || [ "$ch" = $'\x60' ]; then
            return 0
        fi
        i=$((i + 1))
    done
    return 1
}

# True when the visible echo text still contains a backslash. echo -e would
# turn that into a character this inspector does not decode.
_dhpk_ci_eval_has_backslash() {
    local s="$1" i=0
    while [ "$i" -lt "${#s}" ]; do
        [ "${s:$i:1}" = "\\" ] && return 0
        i=$((i + 1))
    done
    return 1
}

# True when eval's command word is a parameter expansion. A following
# suffix or extra argument does not make that command visible. $(...) is a
# command substitution and is handled by _dhpk_ci_eval_see_word.
_dhpk_ci_eval_starts_unseen() {
    local s="$1" c=""
    s="${s#"${s%%[![:space:]]*}"}"
    case "$s" in
        '$('*) return 1 ;;
        '${'*) return 0 ;;
        '$'*) ;;
        *) return 1 ;;
    esac
    c="${s:1:1}"
    [ -n "$c" ] || return 1
    return 0
}

# $(...), backticks and process substitution are inspected when the word is
# parsed. Eval must not inspect that raw word again.
_dhpk_ci_eval_word_seen() {
    local w="$1" two="" first="" last=""
    [ "${#w}" -ge 2 ] || return 1
    two="${w:0:2}"
    first="${w:0:1}"
    last="${w:$((${#w} - 1)):1}"
    case "$two" in
        '$('|'<('|'>(')
            [ "$last" = ')' ] && return 0
            return 1
            ;;
    esac
    # A whole-word backtick command was already inspected.
    if [ "$first" = $'\x60' ] && [ "$last" = $'\x60' ]; then
        return 0
    fi
    return 1
}

# --- Execution entrances equivalent to eval (#1448) -------------------------
# A trap action, an alias value and an arithmetic consumer's subscript run
# command text the way eval does. They are judged with the same rules: visible
# text is inspected as a body, an action that starts with a parameter has no
# visible command and is unresolved.

# _dhpk_ci_trap_action
#   Judges the action of `trap [--] ACTION SIGNAL...` in _dhpk_ci_u_words.
#   `trap -`, `trap ''`, `trap -p` and `trap -l` run nothing and are allowed.
_dhpk_ci_trap_action() {
    local k=$((_dhpk_ci_u_idx + 1)) n="${#_dhpk_ci_u_words[@]}" action="" payload="" before="$DHPK_GIT_COUNT"
    while [ "$k" -lt "$n" ]; do
        case "${_dhpk_ci_u_words[$k]}" in
            --) k=$((k + 1)); break ;;
            -?*) k=$((k + 1)) ;;
            *) break ;;
        esac
    done
    [ "$k" -lt "$n" ] || return 0
    action="${_dhpk_ci_u_words[$k]}"
    case "$action" in
        ''|-) return 0 ;;
    esac
    if _dhpk_ci_eval_starts_unseen "$action"; then
        _dhpk_ci_unsupported "unresolved trap action"
        return 0
    fi
    _dhpk_ci_eval_piece=""
    _dhpk_ci_eval_see_word "$action"
    if [ -n "${_dhpk_ci_eval_piece:-}" ]; then
        payload="$_dhpk_ci_eval_piece"
    elif ! _dhpk_ci_eval_word_seen "$action"; then
        payload="$action"
    fi
    [ -n "$payload" ] || return 0
    _dhpk_ci_inspect_body_cwd "$payload" "" "unresolved" 1
    # The action runs later, in a state this decoder does not follow.
    [ "$DHPK_GIT_COUNT" -gt "$before" ] && _dhpk_ci_unsupported "git with trap"
    return 0
}

# _dhpk_ci_alias_value_risky <value> <dynamic>
#   True when an alias value rebinds a name to eval, source, a shell, a
#   wrapper, git or a parameter. The alias name is then a command word the
#   decoder cannot see through.
_dhpk_ci_alias_value_risky() {
    local value="$1" dyn="$2" seg="" w="" base="" rest="" before=0
    [ -n "$value" ] || return 1
    if [ "$dyn" = "1" ]; then
        case "$value" in
            '$'*|*'`'*) return 0 ;;
        esac
    fi
    rest="${value//$'\n'/;}"
    rest="${rest//&/;}"
    rest="${rest//|/;}"
    rest="${rest//(/;}"
    rest="${rest//\{/;}"
    while [ -n "$rest" ]; do
        seg="${rest%%;*}"
        if [ "$seg" = "$rest" ]; then
            rest=""
        else
            rest="${rest#*;}"
        fi
        seg="${seg#"${seg%%[![:space:]]*}"}"
        # Leading NAME=value assignments do not change the command word.
        while :; do
            w="${seg%%[[:space:]]*}"
            case "$w" in
                [A-Za-z_]*=*) seg="${seg#"$w"}"; seg="${seg#"${seg%%[![:space:]]*}"}" ;;
                *) break ;;
            esac
        done
        w="${seg%%[[:space:]]*}"
        w="${w//[\'\"\\]/}"
        [ -n "$w" ] || continue
        base="${w##*/}"
        case "$base" in
            eval|source|.|trap|let|git|exec|xargs|find|ssh|*'$'*|*'`'*) return 0 ;;
        esac
        if _dhpk_ci_is_shell_word "$w" || _dhpk_ci_is_wrapper_word "$w" || _dhpk_ci_is_wrapper_word "$base"; then
            return 0
        fi
    done
    # git deeper in the value, after a separator or an option word.
    case "${value,,}" in
        *git*) ;;
        *) return 1 ;;
    esac
    before="$DHPK_GIT_COUNT"
    _dhpk_ci_inspect_body_cwd "$value" "" "unresolved" 1
    [ "$DHPK_GIT_COUNT" -gt "$before" ] && return 0
    return 1
}

# _dhpk_ci_alias_see <name=value>
_dhpk_ci_alias_see() {
    local w="$1" dyn="$2"
    case "$w" in
        *=*) ;;
        *) return 0 ;;
    esac
    if _dhpk_ci_alias_value_risky "${w#*=}" "$dyn"; then
        _dhpk_ci_unsupported "alias rebinding eval, git, a shell or a wrapper"
    fi
}

# _dhpk_ci_alias_words
#   `alias [-p] [--] name=value...` and `BASH_ALIASES[name]=value` assignments.
_dhpk_ci_alias_words() {
    local k=$((_dhpk_ci_u_idx + 1)) n="${#_dhpk_ci_u_words[@]}"
    while [ "$k" -lt "$n" ]; do
        case "${_dhpk_ci_u_words[$k]}" in
            --|-p) ;;
            *) _dhpk_ci_alias_see "${_dhpk_ci_u_words[$k]}" "${_dhpk_ci_u_dyn[$k]:-0}" ;;
        esac
        k=$((k + 1))
    done
}

# _dhpk_ci_arith_note_inert <text> <dynamic>
#   Quoted text that carries a command substitution is only data until an
#   arithmetic consumer reads it. Remember it for the end-of-command check.
_dhpk_ci_arith_note_inert() {
    [ "$2" = "1" ] && return 0
    case "$1" in
        *'$('*|*'`'*) _dhpk_ci_arith_texts+=("$1") ;;
    esac
}

# _dhpk_ci_arith_collect_assignments
#   Records prefix assignments, BASH_ALIASES assignments, and the NAME=value
#   arguments of export, declare, typeset, local and readonly.
_dhpk_ci_arith_collect_assignments() {
    local k=0 w=""
    while [ "$k" -lt "$h" ]; do
        w="${_dhpk_ci_words[$k]}"
        case "$w" in
            BASH_ALIASES\[*\]=*) _dhpk_ci_alias_see "${w#*\]}" "${_dhpk_ci_dyn[$k]:-0}" ;;
        esac
        case "$w" in
            [A-Za-z_]*=*) _dhpk_ci_arith_note_inert "${w#*=}" "${_dhpk_ci_dyn[$k]:-0}" ;;
        esac
        k=$((k + 1))
    done
    case "$_dhpk_ci_u_head" in
        export|declare|typeset|local|readonly)
            k=$((_dhpk_ci_u_idx + 1))
            while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
                w="${_dhpk_ci_u_words[$k]}"
                case "$w" in
                    [A-Za-z_]*=*) _dhpk_ci_arith_note_inert "${w#*=}" "${_dhpk_ci_u_dyn[$k]:-0}" ;;
                esac
                k=$((k + 1))
            done
            ;;
    esac
}

# _dhpk_ci_arith_consumer_words
#   `let` and `[[ a -eq b ]]` evaluate an operand as arithmetic, subscripts
#   included. A quoted operand that carries a command substitution is run.
_dhpk_ci_arith_consumer_words() {
    local k=$((_dhpk_ci_u_idx + 1)) n="${#_dhpk_ci_u_words[@]}" before="$DHPK_GIT_COUNT" w=""
    if [ "$_dhpk_ci_u_head" = "[[" ]; then
        case " ${_dhpk_ci_u_words[*]} " in
            *" -eq "*|*" -ne "*|*" -lt "*|*" -le "*|*" -gt "*|*" -ge "*) ;;
            *) return 0 ;;
        esac
    fi
    _dhpk_ci_saw_arith_consumer=1
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        if [ "${_dhpk_ci_u_dyn[$k]:-0}" != "1" ]; then
            case "$w" in
                *'$('*|*'`'*) _dhpk_ci_inspect_body_cwd "$w" "" "unresolved" 1 ;;
            esac
        fi
        k=$((k + 1))
    done
    [ "$DHPK_GIT_COUNT" -gt "$before" ] && _dhpk_ci_unsupported "git with arithmetic subscript"
    return 0
}

# _dhpk_ci_arith_resolve
#   End of the command: when an arithmetic consumer ran and quoted text with a
#   command substitution was assigned, inspect that text. Git inside it runs.
_dhpk_ci_arith_resolve() {
    local before="$DHPK_GIT_COUNT" t=""
    [ "${_dhpk_ci_saw_arith_consumer:-0}" -eq 1 ] || return 0
    for t in ${_dhpk_ci_arith_texts[@]+"${_dhpk_ci_arith_texts[@]}"}; do
        _dhpk_ci_inspect_body_cwd "$t" "" "unresolved" 1
    done
    [ "$DHPK_GIT_COUNT" -gt "$before" ] && _dhpk_ci_unsupported "git with arithmetic subscript"
    return 0
}

# A read here-string is the later unquoted command word's visible text.
# Bash uses only the last here-string. An expansion in that text, or a
# read with no here-string, has no visible command.
_dhpk_ci_note_read_fed() {
    [ "${_dhpk_ci_u_head:-}" = "read" ] || return 0
    local body="" opaque=0 k=0 w name="" nflat="${#_dhpk_ci_hs_flat[@]}" last=0
    if [ "$nflat" -eq 0 ]; then
        opaque=1
    else
        last=$((nflat - 1))
        body="${_dhpk_ci_hs_flat[$last]}"
        case "$body" in
            *'$'*|*'`'*) opaque=1; body="" ;;
            *)
                if [ "${_dhpk_ci_hs_dyn[$last]:-0}" = "1" ] && [ -z "$body" ]; then
                    opaque=1
                fi
                ;;
        esac
    fi
    if [ "${_dhpk_ci_ifs_custom:-0}" = "1" ]; then
        opaque=1
        body=""
    fi
    local -a names=()
    k=$((_dhpk_ci_u_idx + 1))
    while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            --) k=$((k + 1)); continue ;;
            -a)
                name="${_dhpk_ci_u_words[$((k + 1))]:-}"
                k=$((k + 2))
                ;;
            -d|-i|-n|-N|-p|-t|-u) k=$((k + 2)); continue ;;
            -*) k=$((k + 1)); continue ;;
            *) name="$w"; k=$((k + 1)) ;;
        esac
        [ -n "$name" ] || continue
        [ "$name" = "SHELL" ] && _dhpk_ci_saw_shell_assign=1
        names+=("$name")
        name=""
    done
    [ "${#names[@]}" -gt 0 ] || return 0
    _dhpk_ci_rf_store "$body" "$opaque" "${names[@]}"
}

# First n-1 names get one IFS field. The last name gets the remainder.
# Leading and trailing IFS on the whole line is not part of any field.
_dhpk_ci_rf_store() {
    local body="$1" opaque="$2"
    shift 2
    local nnames=$# ni=0 nfields=0 body_i="" j=0 part="" rest=""
    local -a fields=()
    if [ "$opaque" = "1" ]; then
        while [ "$ni" -lt "$nnames" ]; do
            _dhpk_ci_rf_name+=("$1")
            _dhpk_ci_rf_body+=("")
            _dhpk_ci_rf_opaque+=(1)
            shift
            ni=$((ni + 1))
        done
        return 0
    fi
    rest="$body"
    rest="${rest#"${rest%%[![:space:]]*}"}"
    rest="${rest%"${rest##*[![:space:]]}"}"
    while [ -n "$rest" ]; do
        part="${rest%%[[:space:]]*}"
        fields+=("$part")
        if [ "$part" = "$rest" ]; then
            rest=""
        else
            rest="${rest#"$part"}"
            rest="${rest#"${rest%%[![:space:]]*}"}"
        fi
    done
    nfields="${#fields[@]}"
    while [ "$ni" -lt "$nnames" ]; do
        if [ "$ni" -lt $((nnames - 1)) ]; then
            body_i="${fields[$ni]:-}"
        else
            body_i=""
            j=$ni
            while [ "$j" -lt "$nfields" ]; do
                if [ -n "$body_i" ]; then
                    body_i+=" ${fields[$j]}"
                else
                    body_i="${fields[$j]}"
                fi
                j=$((j + 1))
            done
        fi
        _dhpk_ci_rf_name+=("$1")
        _dhpk_ci_rf_body+=("$body_i")
        _dhpk_ci_rf_opaque+=(0)
        shift
        ni=$((ni + 1))
    done
}

# Builtin operands that assign IFS remain after the command. A prefix
# assignment on the same command does not.
_dhpk_ci_ifs_apply_operands() {
    local k=$((_dhpk_ci_u_idx + 1)) w=""
    while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            IFS=*|IFS+=*) _dhpk_ci_note_assign "$w" ;;
        esac
        k=$((k + 1))
    done
}

# A read whose field split does not match the IFS still in force afterwards.
_dhpk_ci_rf_mark_since() {
    local i="${1:-0}"
    while [ "$i" -lt "${#_dhpk_ci_rf_name[@]}" ]; do
        _dhpk_ci_rf_opaque[$i]=1
        _dhpk_ci_rf_body[$i]=""
        i=$((i + 1))
    done
}

# A subshell's read bindings do not survive its closing paren.
_dhpk_ci_rf_keep() {
    local n="${1:-0}" i=0
    local -a names=() bodies=() opaque=()
    [ "$n" -ge 0 ] || n=0
    while [ "$i" -lt "$n" ] && [ "$i" -lt "${#_dhpk_ci_rf_name[@]}" ]; do
        names+=("${_dhpk_ci_rf_name[$i]}")
        bodies+=("${_dhpk_ci_rf_body[$i]}")
        opaque+=("${_dhpk_ci_rf_opaque[$i]}")
        i=$((i + 1))
    done
    _dhpk_ci_rf_name=(${names[@]+"${names[@]}"})
    _dhpk_ci_rf_body=(${bodies[@]+"${bodies[@]}"})
    _dhpk_ci_rf_opaque=(${opaque[@]+"${opaque[@]}"})
}

_dhpk_ci_apply_read_fed() {
    local head="$1" name="" base="" mode="plain" body="" i=0
    case "$head" in
        \$\{*\}) name="${head#'${'}"; name="${name%'}'}" ;;
        \$*) name="${head#'$'}" ;;
        *) return 0 ;;
    esac
    case "$name" in
        '!'*)
            base="${name#!}"
            base="${base%%[!A-Za-z0-9_]*}"
            mode="opaque"
            ;;
        *'[*]'|*'[@]')
            base="${name%%'['*}"
            ;;
        *'['*)
            base="${name%%'['*}"
            mode="opaque"
            ;;
        *[!A-Za-z0-9_]*)
            base="${name%%[!A-Za-z0-9_]*}"
            mode="opaque"
            ;;
        *) base="$name" ;;
    esac
    case "$base" in
        ''|*[!A-Za-z0-9_]*) return 0 ;;
    esac
    while [ "$i" -lt "${#_dhpk_ci_rf_name[@]}" ]; do
        if [ "${_dhpk_ci_rf_name[$i]}" = "$base" ]; then
            if [ "$mode" = "opaque" ] || [ "${_dhpk_ci_rf_opaque[$i]:-0}" = "1" ]; then
                _dhpk_ci_unsupported "read-fed command word"
            else
                body="${_dhpk_ci_rf_body[$i]}"
                if [ -n "$body" ]; then
                    _dhpk_ci_inspect_body_cwd "$body" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                fi
            fi
        fi
        i=$((i + 1))
    done
}

_dhpk_ci_allexport_read() {
    [ "${_dhpk_ci_allexport:-0}" -eq 1 ] || return 0
    local k=$((_dhpk_ci_u_idx + 1)) n="${#_dhpk_ci_u_words[@]}" w
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            --) k=$((k + 1)); continue ;;
            -a)
                w="${_dhpk_ci_u_words[$((k + 1))]:-}"
                _dhpk_ci_word_sets_git_env "$w" && _dhpk_ci_git_env_sticky=1
                _dhpk_ci_note_exported_shell_var "$w"
                k=$((k + 2))
                ;;
            -d|-i|-n|-N|-p|-t|-u) k=$((k + 2)) ;;
            -*) k=$((k + 1)) ;;
            *)
                _dhpk_ci_word_sets_git_env "$w" && _dhpk_ci_git_env_sticky=1
                _dhpk_ci_note_exported_shell_var "$w"
                k=$((k + 1))
                ;;
        esac
    done
}

_dhpk_ci_apply_u_chdir() {
    local dir="$1" dyn="${2:-0}"
    if [ "$dyn" = "1" ] || [ -z "$dir" ]; then
        _dhpk_ci_u_cwd_state="unresolved"
        _dhpk_ci_u_cwd=""
    elif [ "$_dhpk_ci_u_cwd_state" = "literal" ] || [[ "$dir" == /* ]]; then
        dhpk_norm_path_var "${_dhpk_ci_u_cwd:-/}" "$dir"
        _dhpk_ci_u_cwd="$DHPK_NORM_PATH"
        _dhpk_ci_u_cwd_state="literal"
        _dhpk_ci_u_chdir_set=1
    else
        _dhpk_ci_u_cwd_state="unresolved"
        _dhpk_ci_u_cwd=""
    fi
}

_dhpk_ci_env_split_tokenize() {
    local s="$1" outer_dyn="${2:-0}" i=0 len="${#1}" ch nx
    local in_sq=0 in_dq=0 tok="" has_tok=0 tok_q=0
    _dhpk_ci_es_words=()
    _dhpk_ci_es_quoted=()
    _dhpk_ci_es_dyn="$outer_dyn"
    while [ "$i" -lt "$len" ]; do
        ch="${s:$i:1}"
        if [ "$in_sq" -eq 1 ]; then
            if [ "$ch" = "'" ]; then
                in_sq=0
            elif [ "$ch" = "\\" ] && [ $((i + 1)) -lt "$len" ]; then
                nx="${s:$((i + 1)):1}"
                case "$nx" in
                    "'"|\\) tok+="$nx"; i=$((i + 2)); continue ;;
                    *) tok+="\\" ;;
                esac
            else
                tok+="$ch"
            fi
            i=$((i + 1))
            continue
        fi
        if [ "$in_dq" -eq 1 ]; then
            if [ "$ch" = '"' ]; then
                in_dq=0
            elif [ "$ch" = "\\" ] && [ $((i + 1)) -lt "$len" ]; then
                nx="${s:$((i + 1)):1}"
                case "$nx" in
                    n) tok+=$'\n' ;;
                    t) tok+=$'\t' ;;
                    r) tok+=$'\r' ;;
                    f) tok+=$'\f' ;;
                    v) tok+=$'\v' ;;
                    _) tok+=" " ;;
                    c) _dhpk_ci_es_dyn=1 ;;
                    '$'|'#'|'"'|"'"|\\) tok+="$nx" ;;
                    *) tok+="$nx" ;;
                esac
                i=$((i + 2))
                continue
            else
                case "$ch" in
                    '$'|'`') _dhpk_ci_es_dyn=1 ;;
                esac
                tok+="$ch"
            fi
            i=$((i + 1))
            continue
        fi
        case "$ch" in
            ' '|$'\t'|$'\n')
                if [ "$has_tok" -eq 1 ]; then
                    _dhpk_ci_es_words+=("$tok")
                    _dhpk_ci_es_quoted+=("$tok_q")
                    tok=""
                    has_tok=0
                    tok_q=0
                fi
                ;;
            '#')
                if [ "$has_tok" -eq 0 ]; then
                    break
                fi
                tok+="$ch"
                ;;
            "'")
                in_sq=1
                has_tok=1
                tok_q=1
                ;;
            '"')
                in_dq=1
                has_tok=1
                tok_q=1
                ;;
            \\)
                has_tok=1
                tok_q=1
                if [ $((i + 1)) -lt "$len" ]; then
                    nx="${s:$((i + 1)):1}"
                    case "$nx" in
                        n) tok+=$'\n' ;;
                        t) tok+=$'\t' ;;
                        r) tok+=$'\r' ;;
                        f) tok+=$'\f' ;;
                        v) tok+=$'\v' ;;
                        _) _dhpk_ci_es_dyn=1; tok+=" " ;;
                        c) _dhpk_ci_es_dyn=1 ;;
                        '$'|'#'|'"'|"'"|\\) tok+="$nx" ;;
                        *) tok+="$nx" ;;
                    esac
                    i=$((i + 2))
                    continue
                fi
                ;;
            '$'|'`')
                _dhpk_ci_es_dyn=1
                tok+="$ch"
                has_tok=1
                ;;
            *)
                tok+="$ch"
                has_tok=1
                ;;
        esac
        i=$((i + 1))
    done
    if [ "$in_sq" -eq 1 ] || [ "$in_dq" -eq 1 ]; then
        _dhpk_ci_es_dyn=1
    fi
    if [ "$has_tok" -eq 1 ]; then
        _dhpk_ci_es_words+=("$tok")
        _dhpk_ci_es_quoted+=("$tok_q")
    fi
}

# True when this command's operands are text or paths, never a command it
# executes. awk and sed are not listed: a later git command word is judged
# like any other unfamiliar wrapper, not waved through because of the name.
_dhpk_ci_operands_are_data() {
    case "$1" in
        echo|printf|grep|egrep|fgrep|rg|cat|ls) return 0 ;;
    esac
    return 1
}

# True when some word at or after index $1 is git, or a path ending in git,
# and that invocation's words show a mutating subcommand, --no-verify, or a
# commit short option with n. `--` ends global options; the next word is the
# subcommand. A dynamic subcommand counts as commit.
_dhpk_ci_tail_has_wrapped_git_risk() {
    local i="$1" n="${#_dhpk_ci_u_words[@]}" j word sub k ended
    while [ "$i" -lt "$n" ]; do
        case "${_dhpk_ci_u_words[$i]}" in
            git|*/git)
                j=$((i + 1))
                sub=""
                ended=0
                while [ "$j" -lt "$n" ]; do
                    word="${_dhpk_ci_u_words[$j]}"
                    case "$word" in
                        --no-verify|--no-verify=*) return 0 ;;
                        --)
                            j=$((j + 1))
                            ended=1
                            break
                            ;;
                        --help|-h|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|-p|-P)
                            j=$((j + 1)) ;;
                        -C|--git-dir|--work-tree|--exec-path|--namespace|--super-prefix|--config-env|--list-cmds|--attr-source|--shallow-file|-c)
                            j=$((j + 2)) ;;
                        -C*|--git-dir=*|--work-tree=*|--exec-path=*|--namespace=*|--super-prefix=*|--config-env=*|--list-cmds=*|--attr-source=*|--shallow-file=*|-c*)
                            j=$((j + 1)) ;;
                        -*) j=$((j + 1)) ;;
                        *)
                            ended=1
                            break
                            ;;
                    esac
                done
                if [ "$ended" -eq 1 ] && [ "$j" -lt "$n" ]; then
                    word="${_dhpk_ci_u_words[$j]}"
                    case "$word" in
                        --no-verify|--no-verify=*) return 0 ;;
                    esac
                    sub="$word"
                    if [ "${_dhpk_ci_u_dyn[$j]}" = "1" ]; then
                        sub="commit"
                    fi
                    j=$((j + 1))
                fi
                if [ "$sub" = "commit" ]; then
                    k="$j"
                    while [ "$k" -lt "$n" ]; do
                        word="${_dhpk_ci_u_words[$k]}"
                        if _dhpk_ci_commit_short_no_verify "$word"; then
                            return 0
                        fi
                        if _dhpk_ci_option_consumes_next "$word"; then
                            k=$((k + 2))
                        else
                            k=$((k + 1))
                        fi
                    done
                fi
                case "$sub" in
                    commit|merge|rebase|cherry-pick|reset|push) return 0 ;;
                esac
                while [ "$j" -lt "$n" ]; do
                    word="${_dhpk_ci_u_words[$j]}"
                    case "$word" in
                        --no-verify|--no-verify=*) return 0 ;;
                    esac
                    j=$((j + 1))
                done
                ;;
        esac
        i=$((i + 1))
    done
    return 1
}

# A dynamic command word can still show a git write after global options.
# The option walk matches _dhpk_ci_tail_has_wrapped_git_risk. A missing
# value for an option that takes one is unresolved: the subcommand is not
# in the text. A dynamic subcommand is treated as a write, same as a
# literal git whose subcommand is expanded.
_dhpk_ci_dynamic_head_is_write() {
    local j=$(($1 + 1)) n="${#_dhpk_ci_u_words[@]}" word=""
    while [ "$j" -lt "$n" ]; do
        word="${_dhpk_ci_u_words[$j]}"
        case "$word" in
            --) j=$((j + 1)); break ;;
            --help|-h|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|-p|-P)
                j=$((j + 1)) ;;
            -C|--git-dir|--work-tree|--exec-path|--namespace|--super-prefix|--config-env|--list-cmds|--attr-source|--shallow-file|-c)
                if [ $((j + 1)) -ge "$n" ]; then
                    return 0
                fi
                j=$((j + 2))
                ;;
            -C*|--git-dir=*|--work-tree=*|--exec-path=*|--namespace=*|--super-prefix=*|--config-env=*|--list-cmds=*|--attr-source=*|--shallow-file=*|-c*)
                j=$((j + 1)) ;;
            --no-verify|--no-verify=*) return 0 ;;
            -*) j=$((j + 1)) ;;
            *) break ;;
        esac
    done
    [ "$j" -lt "$n" ] || return 1
    if [ "${_dhpk_ci_u_dyn[$j]}" = "1" ]; then
        return 0
    fi
    case "${_dhpk_ci_u_words[$j]}" in
        commit|merge|rebase|cherry-pick|reset|push) return 0 ;;
    esac
    while [ "$j" -lt "$n" ]; do
        case "${_dhpk_ci_u_words[$j]}" in
            --no-verify|--no-verify=*) return 0 ;;
        esac
        j=$((j + 1))
    done
    return 1
}

# Helpers for #1435 read-only / data wrapper semantics.
_dhpk_ci_word_mentions_git() {
    case "$1" in
        git|*/git|git\ *|*/git\ *) return 0 ;;
        *git*)
            local _re='(^|[^A-Za-z0-9_-])git($|[^A-Za-z0-9_-])'
            [[ "$1" =~ $_re ]] && return 0
            ;;
    esac
    return 1
}

_dhpk_ci_find_exec_has_git() {
    local i="$1" n="${#_dhpk_ci_u_words[@]}" w exec_head="" is_data=0 is_shell=0 has_git=0 in_exec=0
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$i]}"
        if [ "$in_exec" -eq 0 ]; then
            case "$w" in
                -exec|-execdir|-ok|-okdir)
                    in_exec=1
                    exec_head=""
                    is_data=0
                    is_shell=0
                    has_git=0
                    ;;
            esac
        else
            if [ "$w" = ";" ] || [ "$w" = "+" ]; then
                [ "$has_git" -eq 1 ] && [ "$is_data" -eq 0 ] && return 0
                in_exec=0
            elif [ -z "$exec_head" ]; then
                exec_head="$w"
                if [ "${_dhpk_ci_u_dyn[$i]:-0}" != "1" ]; then
                    _dhpk_ci_operands_are_data "${exec_head##*/}" && is_data=1
                    _dhpk_ci_is_shell_word "${exec_head##*/}" && is_shell=1
                fi
                # A dynamic or {} command word cannot be shown to be data.
                if [ "${_dhpk_ci_u_dyn[$i]:-0}" = "1" ]; then
                    has_git=1
                fi
                case "$w" in
                    git|*/git|'{}') has_git=1 ;;
                esac
            else
                if [ "$is_shell" -eq 1 ] && [ "${_dhpk_ci_u_dyn[$i]:-0}" = "1" ] \
                    && _dhpk_ci_word_uses_taint "$w"; then
                    has_git=1
                fi
                case "$w" in
                    git|*/git|git\ *|*/git\ *) has_git=1 ;;
                    *git*)
                        if [ "$is_shell" -eq 1 ] || [ "${exec_head##*/}" = "eval" ]; then
                            _dhpk_ci_word_mentions_git "$w" && has_git=1
                        fi
                        ;;
                esac
            fi
        fi
        i=$((i + 1))
    done
    [ "$in_exec" -eq 1 ] && [ "$has_git" -eq 1 ] && [ "$is_data" -eq 0 ] && return 0
    return 1
}

_dhpk_ci_parse_su_c() {
    local j=$(($1 + 1)) n="${#_dhpk_ci_u_words[@]}" tok opt oi olen och consumed
    local su_login=0 su_c_set=0 su_c_payload="" su_user_seen=0
    while [ "$j" -lt "$n" ]; do
        tok="${_dhpk_ci_u_words[$j]}"
        case "$tok" in
            --)
                j=$((j + 1))
                if [ "$j" -lt "$n" ]; then
                    [ "$su_user_seen" -eq 0 ] || return 1
                    [ $((j + 1)) -eq "$n" ] || return 1
                fi
                break
                ;;
            -)
                su_login=1
                j=$((j + 1))
                ;;
            --help|--version)
                [ "$su_c_set" -eq 0 ] || return 1
                _dhpk_ci_u_query_only=1
                return 0
                ;;
            --login|--preserve-environment|--pty)
                [ "$tok" = "--login" ] && su_login=1
                j=$((j + 1))
                ;;
            --shell=*|--group=*|--supp-group=*|--whitelist-environment=*)
                j=$((j + 1))
                ;;
            --shell|--group|--supp-group|--whitelist-environment)
                j=$((j + 2))
                [ "$j" -le "$n" ] || return 1
                ;;
            --command=*|--session-command=*)
                [ "$su_c_set" -eq 0 ] || return 1
                [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ] && return 1
                su_c_payload="${tok#*=}"
                su_c_set=1
                j=$((j + 1))
                ;;
            --command|--session-command)
                [ "$su_c_set" -eq 0 ] || return 1
                j=$((j + 1))
                [ "$j" -lt "$n" ] || return 1
                [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ] && return 1
                su_c_payload="${_dhpk_ci_u_flat[$j]}"
                su_c_set=1
                j=$((j + 1))
                ;;
            --*)
                return 1
                ;;
            -*)
                opt="${tok#-}"
                oi=0
                olen="${#opt}"
                consumed=0
                while [ "$oi" -lt "$olen" ]; do
                    och="${opt:$oi:1}"
                    case "$och" in
                        l) su_login=1 ;;
                        m|p|P) ;;
                        h|V)
                            [ "$su_c_set" -eq 0 ] || return 1
                            _dhpk_ci_u_query_only=1
                            return 0
                            ;;
                        s|g|G|w)
                            if [ $((oi + 1)) -lt "$olen" ]; then
                                j=$((j + 1))
                            else
                                j=$((j + 2))
                                [ "$j" -le "$n" ] || return 1
                            fi
                            consumed=1
                            break
                            ;;
                        c)
                            [ "$su_c_set" -eq 0 ] || return 1
                            if [ $((oi + 1)) -lt "$olen" ]; then
                                [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ] && return 1
                                su_c_payload="${opt:$((oi + 1))}"
                                su_c_set=1
                                j=$((j + 1))
                            else
                                j=$((j + 1))
                                [ "$j" -lt "$n" ] || return 1
                                [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ] && return 1
                                su_c_payload="${_dhpk_ci_u_flat[$j]}"
                                su_c_set=1
                                j=$((j + 1))
                            fi
                            consumed=1
                            break
                            ;;
                        *)
                            return 1
                            ;;
                    esac
                    oi=$((oi + 1))
                done
                [ "$consumed" -eq 0 ] && j=$((j + 1))
                ;;
            *)
                [ "$su_user_seen" -eq 0 ] || return 1
                su_user_seen=1
                j=$((j + 1))
                ;;
        esac
    done
    [ "$su_c_set" -eq 1 ] || return 1
    [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ] || return 1
    [ "${#_dhpk_ci_ps_at[@]}" -eq 0 ] || return 1
    _dhpk_ci_u_su_c_payload="$su_c_payload"
    _dhpk_ci_u_su_login="$su_login"
    return 0
}

_dhpk_ci_tail_uses_taint() {
    local j="$1" n="${#_dhpk_ci_u_words[@]}"
    while [ "$j" -lt "$n" ]; do
        if [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ] && _dhpk_ci_word_uses_taint "${_dhpk_ci_u_words[$j]}"; then
            return 0
        fi
        j=$((j + 1))
    done
    return 1
}

_dhpk_ci_dyn_shell_c_literal() {
    local j=$(($1 + 1)) n="${#_dhpk_ci_u_words[@]}" w opt oi olen skip_ops saw_c=0
    [ "${_dhpk_ci_saw_shell_assign:-0}" -eq 0 ] || return 1
    [ "${#_dhpk_ci_hs_words[@]}" -eq 0 ] || return 1
    [ "${#_dhpk_ci_ps_at[@]}" -eq 0 ] || return 1
    case "${_dhpk_ci_u_words[$1]}" in
        '$SHELL'|'${SHELL}') ;;
        *) return 1 ;;
    esac
    while [ "$j" -lt "$n" ]; do
        [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ] && return 1
        w="${_dhpk_ci_u_words[$j]}"
        case "$w" in
            --|-) j=$((j + 1)); break ;;
            --rcfile|--init-file|--startup-cmd|--rcfile=*|--init-file=*|--startup-cmd=*) return 1 ;;
            --*) j=$((j + 1)) ;;
            [-+]*)
                opt="${w#[-+]}"
                oi=0
                olen="${#opt}"
                skip_ops=0
                while [ "$oi" -lt "$olen" ]; do
                    case "${opt:$oi:1}" in
                        c) saw_c=1 ;;
                        o|O)
                            if [ $((oi + 1)) -lt "$olen" ]; then
                                oi=$olen
                                continue
                            fi
                            skip_ops=$((skip_ops + 1))
                            ;;
                    esac
                    oi=$((oi + 1))
                done
                while [ "$skip_ops" -gt 0 ]; do
                    j=$((j + 1))
                    [ "$j" -lt "$n" ] || return 1
                    [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ] && return 1
                    skip_ops=$((skip_ops - 1))
                done
                j=$((j + 1))
                ;;
            *) break ;;
        esac
    done
    [ "$saw_c" -eq 1 ] || return 1
    [ "$j" -lt "$n" ] || return 1
    [ "${_dhpk_ci_u_dyn[$j]:-0}" != "1" ] || return 1
    # Words after the payload are positional parameters, and a reassigned
    # SHELL would run them as arguments; only a sole payload is modelled.
    [ $((j + 1)) -eq "$n" ] || return 1
    _dhpk_ci_u_dyn_shell_c=1
    return 0
}
