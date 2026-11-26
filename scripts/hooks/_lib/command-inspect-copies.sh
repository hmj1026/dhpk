#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2154  # globals are shared with the sibling modules
# command-inspect-copies.sh - copies of risky git text (#1515).
# Source-only. bash 3.2. Never executes the command under inspection.
#
# Text that states a risky git value stays risky when it is copied to another
# variable, a loop variable, or the positional parameters. Only values the
# command text states are followed. A value that exists only at run time
# (a decoder, a command's own output) is out of scope (ADR 0037).
#
# State, set per command by _dhpk_ci_scan_copies. A positional entry is <owner>:<index>, where the owner
# is the called function, or = for set:
#   _dhpk_ci_pt_w  entries that run git even when quoted
#   _dhpk_ci_pt_e  entries that hold one risky element (needs word splitting or a shell)
#   _dhpk_ci_pt_x  entries that a case conversion can fold into git
#   _dhpk_ci_pt_shift  1 when the text has shift, so an index can move down
#   _dhpk_ci_fold_names  variables that copy non-ASCII text

_dhpk_ci_copies_clear() {
    _dhpk_ci_pt_w=" "
    _dhpk_ci_pt_e=" "
    _dhpk_ci_pt_x=" "
    _dhpk_ci_pt_shift=0
    _dhpk_ci_fold_names=" "
}

# Sets _dhpk_ci_cp_group to an alternation of the names in $1, and _dhpk_ci_cp_re to a regex that matches
# an expansion of one of them. Both are empty when there is none.
_dhpk_ci_cp_names_re() {
    local name
    _dhpk_ci_cp_group=""
    _dhpk_ci_cp_re=""
    for name in $1; do
        _dhpk_ci_cp_group="$_dhpk_ci_cp_group|$name"
    done
    _dhpk_ci_cp_group="${_dhpk_ci_cp_group#|}"
    [ -n "$_dhpk_ci_cp_group" ] || return 0
    _dhpk_ci_cp_re='\$\{?!?('"$_dhpk_ci_cp_group"')([^A-Za-z0-9_]|$)'
}

# True when value $1 is risky only through the text of its own substitutions, which is run-time output.
_dhpk_ci_cp_runtime_only() {
    local v="$1" pre post k=0
    case "$v" in *'$('*|*'`'*) ;; *) return 1 ;; esac
    # Each round drops one substitution, so the text only shrinks. A backtick or an unclosed
    # substitution ends the readable part.
    while [ "$k" -lt 16 ]; do
        k=$((k + 1))
        case "$v" in *'$('*) ;; *) break ;; esac
        pre="${v%%'$('*}"
        post="${v#*'$('}"
        case "$post" in
            *')'*) v="$pre${post#*')'}" ;;
            *) v="$pre" ;;
        esac
    done
    v="${v%%'`'*}"
    _dhpk_ci_lower "$v"
    case "$_dhpk_ci_lc" in *git*) return 1 ;; esac
    return 0
}

# True when word $1 expands a positional parameter of an entry in set $2. $3 is the function whose body
# holds the word; empty means the owner is not known, so every entry counts.
_dhpk_ci_cp_pos_hit() {
    local re_all='\$\{?[@*]' re_slice='\$\{[@*]:[^-=+?]' re_n='\$\{?([1-9][0-9]*)' entry idx n="" all=0 slice=0
    case "$2" in *:*) ;; *) return 1 ;; esac
    [[ "$1" =~ $re_all ]] && all=1
    [[ "$1" =~ $re_slice ]] && slice=1
    [[ "$1" =~ $re_n ]] && n="${BASH_REMATCH[1]}"
    [ "$all" = "1" ] || [ -n "$n" ] || return 1
    [ "${#n}" -lt 4 ] || n=1
    for entry in $2; do
        case "$entry" in
            =:*) ;;
            *) [ -z "${3:-}" ] || [ "${entry%:*}" = "$3" ] || continue ;;
        esac
        idx="${entry##*:}"
        if [ "$all" = "1" ]; then
            [ "$idx" = "1" ] || [ "$slice" = "1" ] || [ "$_dhpk_ci_pt_shift" = "1" ] && return 0
        fi
        [ -n "$n" ] || continue
        [ "$idx" = "$n" ] && return 0
        [ "$_dhpk_ci_pt_shift" = "1" ] && [ "$idx" -ge "$n" ] && return 0
    done
    return 1
}

# Sets _dhpk_ci_cp_next to the function whose body holds the current word, or the one that holds the
# enclosing list. Empty when neither is known.
_dhpk_ci_cp_find_owner() {
    local _dhpk_ci_fn_def_name=""
    _dhpk_ci_cp_next="${_dhpk_ci_cp_owner:-}"
    if [ "${_dhpk_ci_fn_pending:-0}" = "1" ] && [ -n "${_dhpk_ci_fn_pending_name:-}" ]; then
        # The first command of a body is judged before its opening brace is recorded.
        _dhpk_ci_cp_next="$_dhpk_ci_fn_pending_name"
    elif _dhpk_ci_fn_defining_name; then
        _dhpk_ci_cp_next="$_dhpk_ci_fn_def_name"
    fi
    return 0
}

# True when word $1 runs tainted positional text. $2 is 1 for a quoted command word, which cannot split.
_dhpk_ci_cp_pos_taint() {
    local re='\$\{([1-9][0-9]*|[@*])[,^~@]' _dhpk_ci_cp_next=""
    case "${_dhpk_ci_pt_w:-}${_dhpk_ci_pt_e:-}${_dhpk_ci_pt_x:-}" in *:*) ;; *) return 1 ;; esac
    _dhpk_ci_cp_find_owner
    _dhpk_ci_cp_pos_hit "$1" "${_dhpk_ci_pt_w:- }" "$_dhpk_ci_cp_next" && return 0
    if [ "${2:-0}" != "1" ]; then
        _dhpk_ci_cp_pos_hit "$1" "${_dhpk_ci_pt_e:- }" "$_dhpk_ci_cp_next" && return 0
    fi
    [[ "$1" =~ $re ]] || return 1
    _dhpk_ci_cp_pos_hit "$1" "${_dhpk_ci_pt_x:- }${_dhpk_ci_pt_e:- }" "$_dhpk_ci_cp_next"
}

# True when word $1 case-converts a variable that copies non-ASCII text, directly or through a name.
_dhpk_ci_cp_fold_taint() {
    local re
    case "${_dhpk_ci_fold_names:-}" in *[A-Za-z_]*) ;; *) return 1 ;; esac
    re='\$\{![A-Za-z_][A-Za-z0-9_]*[,^~@]'
    [[ "$1" =~ $re ]] && return 0
    _dhpk_ci_cp_names_re "$_dhpk_ci_fold_names"
    re='\$\{('"$_dhpk_ci_cp_group"')(\[[^]]*\])?[,^~@]'
    [[ "$1" =~ $re ]]
}

# Classifies what raw text $1 copies: _dhpk_ci_cp_t (risky git text), _dhpk_ci_cp_g (a value that names
# git), _dhpk_ci_cp_x (non-ASCII text). Uses the regexes prepared for the current pass.
_dhpk_ci_cp_classify() {
    local re_ind='\$\{![A-Za-z_]'
    _dhpk_ci_cp_t=0
    _dhpk_ci_cp_g=0
    _dhpk_ci_cp_x=0
    _dhpk_ci_nonascii "$1" && _dhpk_ci_cp_x=1
    case "$1" in *'$'*) ;; *) return 0 ;; esac
    [ -n "$_dhpk_ci_cp_re_t" ] && [[ "$1" =~ $_dhpk_ci_cp_re_t ]] && _dhpk_ci_cp_t=1
    [ -n "$_dhpk_ci_cp_re_g" ] && [[ "$1" =~ $_dhpk_ci_cp_re_g ]] && _dhpk_ci_cp_g=1
    [ -n "$_dhpk_ci_cp_re_x" ] && [[ "$1" =~ $_dhpk_ci_cp_re_x ]] && _dhpk_ci_cp_x=1
    if [[ "$1" =~ $re_ind ]]; then
        [ -n "$_dhpk_ci_cp_re_t" ] && _dhpk_ci_cp_t=1
        [ -n "$_dhpk_ci_cp_re_x" ] && _dhpk_ci_cp_x=1
    fi
    _dhpk_ci_cp_pos_hit "$1" "$_dhpk_ci_pt_w$_dhpk_ci_pt_e" && _dhpk_ci_cp_t=1
    _dhpk_ci_cp_pos_hit "$1" "$_dhpk_ci_pt_x" && _dhpk_ci_cp_x=1
    return 0
}

# True when raw word $1 is a quoted literal that states a whole risky git command: after assignments and
# wrapper words, its first word is git.
_dhpk_ci_cp_literal_risky() {
    local w re_asg='^[A-Za-z_][A-Za-z0-9_]*='
    local -a lit_a=()
    case "$1" in *[\"\'\\]*) ;; *) return 1 ;; esac
    _dhpk_ci_fs_value "$1" || return 1
    case "$_dhpk_ci_fs_uq" in *[[:space:]]*) ;; *) return 1 ;; esac
    read -r -a lit_a <<<"$_dhpk_ci_fs_uq"
    for w in ${lit_a[@]+"${lit_a[@]}"}; do
        [[ "$w" =~ $re_asg ]] && continue
        _dhpk_ci_is_wrapper_word "$w" && continue
        case "$w" in
            git|*/git) break ;;
            *) return 1 ;;
        esac
    done
    _dhpk_ci_git_value_risky "$_dhpk_ci_fs_uq" "${_dhpk_ci_taint_ifs:-0}"
}

# Adds index or name $2 to the set variable named $1. Notes a change for the fixed-point loop.
_dhpk_ci_cp_add() {
    case "${!1}" in *" $2 "*) return 0 ;; esac
    printf -v "$1" '%s%s ' "${!1}" "$2"
    _dhpk_ci_cp_changed=1
}

# Applies what the last classification found to variable $1.
_dhpk_ci_cp_mark_name() {
    if [ "$_dhpk_ci_cp_t" = "1" ]; then
        _dhpk_ci_cp_add _dhpk_ci_git_taint "$1"
        case "$_dhpk_ci_cp_skip" in
            *" $1 "*) _dhpk_ci_cp_skip="${_dhpk_ci_cp_skip/ $1 / }"; _dhpk_ci_cp_changed=1 ;;
        esac
    fi
    [ "$_dhpk_ci_cp_g" = "1" ] && _dhpk_ci_cp_add _dhpk_ci_git_named "$1"
    [ "$_dhpk_ci_cp_x" = "1" ] && _dhpk_ci_cp_add _dhpk_ci_fold_names "$1"
    return 0
}

# for|select NAME [in WORDS]. Without a list the loop reads the positional parameters.
_dhpk_ci_cp_for() {
    local i=3 n raw name re_id='^[A-Za-z_][A-Za-z0-9_]*$'
    local -a raws=()
    _dhpk_ci_fs_split "$1"
    n="${#_dhpk_ci_fs_words[@]}"
    name="${_dhpk_ci_fs_words[1]-}"
    [[ "$name" =~ $re_id ]] || return 0
    if [ "${_dhpk_ci_fs_words[2]-}" = "in" ]; then
        while [ "$i" -lt "$n" ]; do
            raws+=("${_dhpk_ci_fs_raw[$i]}")
            i=$((i + 1))
        done
    else
        # shellcheck disable=SC2016  # raw text, not an expansion
        raws=('"$@"')
    fi
    for raw in ${raws[@]+"${raws[@]}"}; do
        _dhpk_ci_cp_classify "$raw"
        _dhpk_ci_cp_literal_risky "$raw" && _dhpk_ci_cp_t=1
        _dhpk_ci_cp_mark_name "$name"
    done
}

# $1 the owner (= for set, else the function name), $2 the segment. The words of set [options] [--] WORDS, or of a call of a function
# defined in the text, become positional parameters.
_dhpk_ci_cp_args() {
    local i=1 n raw pos=0 joined="" first=0 re_whole='^"?\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)"?$'
    _dhpk_ci_fs_split "$2"
    n="${#_dhpk_ci_fs_words[@]}"
    if [ "$1" = "=" ]; then
        while [ "$i" -lt "$n" ]; do
            case "${_dhpk_ci_fs_words[$i]}" in
                --) i=$((i + 1)); break ;;
                -o|+o) i=$((i + 2)) ;;
                -*|+*) i=$((i + 1)) ;;
                *) break ;;
            esac
        done
    fi
    while [ "$i" -lt "$n" ]; do
        raw="${_dhpk_ci_fs_raw[$i]}"
        pos=$((pos + 1))
        _dhpk_ci_cp_classify "$raw"
        if [ "$pos" = "1" ] && [ "$_dhpk_ci_cp_g" = "1" ] && [[ "$raw" =~ $re_whole ]]; then
            # The first word is a copy of git itself: the words after it are its arguments.
            joined="git "
            first=1
        else
            joined="$joined${_dhpk_ci_fs_words[$i]} "
        fi
        i=$((i + 1))
        [ "$_dhpk_ci_cp_x" = "1" ] && _dhpk_ci_cp_add _dhpk_ci_pt_x "$1:$pos"
        if [ "$_dhpk_ci_cp_t" = "1" ]; then
            # A value that only follows other text in its word is not the command.
            case "$raw" in
                \"\$*) _dhpk_ci_cp_add _dhpk_ci_pt_e "$1:$pos" ;;
                \$*) _dhpk_ci_cp_add _dhpk_ci_pt_w "$1:$pos" ;;
            esac
        elif _dhpk_ci_cp_literal_risky "$raw"; then
            _dhpk_ci_cp_add _dhpk_ci_pt_e "$1:$pos"
        fi
    done
    # The words are a command themselves when the first one is git. A call that names git literally
    # is judged where it stands.
    [ "$1" = "=" ] || [ "$first" = "1" ] || return 0
    case "$joined" in
        git\ *|*/git\ *) _dhpk_ci_git_value_risky "$joined" 0 && _dhpk_ci_cp_add _dhpk_ci_pt_w "$1:1" ;;
    esac
    return 0
}

# Collects the loops, set commands and function calls of text $1 into _dhpk_ci_cp_kind and
# _dhpk_ci_cp_seg. The text is cut as in _dhpk_ci_scan_flag_sources.
_dhpk_ci_cp_collect() {
    local text="$1" seg head nl re_shift='(^|[^A-Za-z0-9_-])shift([^A-Za-z0-9_-]|$)'
    local opaque="${_dhpk_ci_pos_opaque:-0}"
    local -a segs=()
    [[ "$text" =~ $re_shift ]] && _dhpk_ci_pt_shift=1
    text="${text//\(\)/$'\002'}"
    case "$text" in
        *'for '*|*'select '*|*'set '*|*$'\002'*|*'function '*) ;;
        *) return 0 ;;
    esac
    text="${text//[;&|()\`]/$'\n'}"
    nl="${text//[^$'\n']/}"
    # A text this long is not followed: with a risky value in it, every dynamic command word is risky.
    if [ "${#nl}" -gt 1024 ]; then
        _dhpk_ci_cp_seed_names
        [ -n "$_dhpk_ci_cp_re" ] && _dhpk_ci_taint_overflow=1
        return 0
    fi
    _dhpk_ci_fs_funcs=" "
    _dhpk_ci_fs_nfn=0
    while IFS= read -r seg; do
        segs+=("$seg")
        case "$seg" in
            *$'\002'*|*'function '*) _dhpk_ci_fs_strip "$seg" 1 ;;
        esac
    done <<<"$text"
    for seg in ${segs[@]+"${segs[@]}"}; do
        [[ "$seg" == *[![:space:]]* ]] || continue
        _dhpk_ci_fs_strip "$seg" 0
        seg="$_dhpk_ci_fs_seg"
        head="${seg%%[[:space:]]*}"
        head="${head//[\"\'\\]/}"
        case "$head" in
            '') continue ;;
            for|select) _dhpk_ci_cp_kind+=("") ;;
            set) _dhpk_ci_cp_kind+=("=") ;;
            *)
                case "$_dhpk_ci_fs_funcs" in
                    *" $head "*) _dhpk_ci_cp_kind+=("$head") ;;
                    *) continue ;;
                esac
                ;;
        esac
        _dhpk_ci_cp_seg+=("$seg")
    done
    _dhpk_ci_pos_opaque="$opaque"
}

# Sets _dhpk_ci_cp_attr to the names that declare, typeset or local gives the -l or -u attribute. Each
# command is read once. Past 256 names the scan is cut and fails closed.
_dhpk_ci_cp_attr_names() {
    local text="$1" line w on k=0 sq="'" re_id='^[A-Za-z_][A-Za-z0-9_]*$' re_opt='^-[A-Za-z]*[lu][A-Za-z]*$'
    local -a ws_a=()
    _dhpk_ci_cp_attr=" "
    case "$text" in *declare*|*typeset*|*local*) ;; *) return 0 ;; esac
    text="${text//[;&|()\`]/$'\n'}"
    while IFS= read -r line; do
        case "$line" in *declare*|*typeset*|*local*) ;; *) continue ;; esac
        on=-1
        read -r -a ws_a <<<"$line"
        for w in ${ws_a[@]+"${ws_a[@]}"}; do
            case "$w" in
                declare|typeset|local) on=0; continue ;;
                -*|+*) [ "$on" = "0" ] && [[ "$w" =~ $re_opt ]] && on=1; continue ;;
            esac
            [ "$on" = "1" ] || continue
            w="${w%%=*}"
            w="${w//[\"$sq]/}"
            [[ "$w" =~ $re_id ]] || continue
            case "$_dhpk_ci_cp_attr" in *" $w "*) continue ;; esac
            k=$((k + 1))
            if [ "$k" -gt 256 ]; then
                _dhpk_ci_taint_overflow=1
                return 0
            fi
            _dhpk_ci_cp_attr="$_dhpk_ci_cp_attr$w "
        done
    done <<<"$text"
}

# A flag value behind a case attribute is judged in lower case. A non-ASCII value may fold into any
# flag, so it cannot be compared.
_dhpk_ci_cp_attr_flags() {
    local name var
    for name in $_dhpk_ci_cp_attr; do
        case "$_dhpk_ci_flag_names" in *" $name "*) ;; *) continue ;; esac
        var="_dhpk_ci_fv_$name"
        [ "${!var}" = "@opaque" ] && continue
        if _dhpk_ci_nonascii "${!var}"; then
            printf -v "$var" '%s' "@opaque"
            continue
        fi
        _dhpk_ci_lower "${!var}"
        printf -v "$var" '%s' "$_dhpk_ci_lc"
    done
}

# Sets _dhpk_ci_cp_re for the risky names whose value is stated by the text.
_dhpk_ci_cp_seed_names() {
    local name seeds=" "
    for name in ${_dhpk_ci_git_taint:-}; do
        case "$_dhpk_ci_cp_skip" in *" $name "*) ;; *) seeds="$seeds$name " ;; esac
    done
    _dhpk_ci_cp_names_re "$seeds"
}

# Follows copies in text $1 until nothing changes. $2 lists the assigned names, whose values are in
# _dhpk_ci_tv_<name> and whose substitution text is in _dhpk_ci_cx_<name>. A chain longer than the
# pass limit fails closed.
_dhpk_ci_scan_copies() {
    local name var sub i pass=0
    local -a _dhpk_ci_cp_kind=() _dhpk_ci_cp_seg=()
    local _dhpk_ci_cp_group _dhpk_ci_cp_skip=" "
    local _dhpk_ci_cp_re _dhpk_ci_cp_re_t _dhpk_ci_cp_re_g _dhpk_ci_cp_re_x _dhpk_ci_cp_attr=" "
    local _dhpk_ci_cp_t _dhpk_ci_cp_g _dhpk_ci_cp_x _dhpk_ci_cp_changed=1
    case "$1" in *'$'*) ;; *) return 0 ;; esac
    _dhpk_ci_fold_names="${_dhpk_ci_fold_names:- }${_dhpk_ci_nonascii_names# }"
    for name in $2; do
        var="_dhpk_ci_tv_$name"
        _dhpk_ci_cp_runtime_only "${!var:-}" && _dhpk_ci_cp_skip="$_dhpk_ci_cp_skip$name "
    done
    _dhpk_ci_cp_collect "$1"
    _dhpk_ci_cp_attr_names "$1"
    while [ "$_dhpk_ci_cp_changed" = "1" ]; do
        pass=$((pass + 1))
        if [ "$pass" -gt 16 ]; then
            _dhpk_ci_taint_overflow=1
            break
        fi
        _dhpk_ci_cp_changed=0
        _dhpk_ci_cp_seed_names
        _dhpk_ci_cp_re_t="$_dhpk_ci_cp_re"
        _dhpk_ci_cp_names_re "${_dhpk_ci_git_named:-}"
        _dhpk_ci_cp_re_g="$_dhpk_ci_cp_re"
        _dhpk_ci_cp_names_re "$_dhpk_ci_fold_names"
        _dhpk_ci_cp_re_x="$_dhpk_ci_cp_re"
        for name in $2; do
            var="_dhpk_ci_tv_$name"
            sub="_dhpk_ci_cx_$name"
            _dhpk_ci_cp_classify "${!var:-} ${!sub:-}"
            _dhpk_ci_cp_mark_name "$name"
        done
        for name in $_dhpk_ci_cp_attr; do
            case "$_dhpk_ci_fold_names" in
                *" $name "*) _dhpk_ci_cp_add _dhpk_ci_git_taint "$name" ;;
            esac
        done
        i=0
        while [ "$i" -lt "${#_dhpk_ci_cp_kind[@]}" ]; do
            case "${_dhpk_ci_cp_kind[$i]}" in
                '') _dhpk_ci_cp_for "${_dhpk_ci_cp_seg[$i]}" ;;
                *) _dhpk_ci_cp_args "${_dhpk_ci_cp_kind[$i]}" "${_dhpk_ci_cp_seg[$i]}" ;;
            esac
            i=$((i + 1))
        done
    done
    _dhpk_ci_cp_attr_flags
}
