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
# State, set per command by _dhpk_ci_scan_copies:
#   _dhpk_ci_pt_w  positional indexes that run git even when quoted
#   _dhpk_ci_pt_e  positional indexes that hold one risky element (needs word splitting or a shell)
#   _dhpk_ci_pt_x  positional indexes that a case conversion can fold into git
#   _dhpk_ci_pt_shift  1 when the text has shift, so an index can move down

_dhpk_ci_copies_clear() {
    _dhpk_ci_pt_w=" "
    _dhpk_ci_pt_e=" "
    _dhpk_ci_pt_x=" "
    _dhpk_ci_pt_shift=0
}

# Sets _dhpk_ci_cp_re to a regex that matches an expansion of a name in $1. Empty when there is none.
_dhpk_ci_cp_names_re() {
    local name
    _dhpk_ci_cp_re=""
    for name in $1; do
        _dhpk_ci_cp_re="$_dhpk_ci_cp_re|$name"
    done
    [ -n "$_dhpk_ci_cp_re" ] || return 0
    _dhpk_ci_cp_re='\$\{?!?('"${_dhpk_ci_cp_re#|}"')([^A-Za-z0-9_]|$)'
}

# True when word $1 expands a positional parameter whose index is in set $2.
_dhpk_ci_cp_pos_hit() {
    local re_all='\$\{?[@*]' re_slice='\$\{[@*]:' re_n='\$\{?([1-9][0-9]*)' idx n
    case "$2" in *[0-9]*) ;; *) return 1 ;; esac
    if [[ "$1" =~ $re_all ]]; then
        [ "$_dhpk_ci_pt_shift" = "1" ] && return 0
        case "$2" in *" 1 "*) return 0 ;; esac
        [[ "$1" =~ $re_slice ]] && return 0
    fi
    [[ "$1" =~ $re_n ]] || return 1
    n="${BASH_REMATCH[1]}"
    for idx in $2; do
        [ "$idx" = "$n" ] && return 0
        [ "$_dhpk_ci_pt_shift" = "1" ] && [ "${#n}" -lt 4 ] && [ "$idx" -ge "$n" ] && return 0
    done
    return 1
}

# True when word $1 runs tainted positional text. $2 is 1 for a quoted command word, which cannot split.
_dhpk_ci_cp_pos_taint() {
    local re='\$\{([1-9][0-9]*|[@*])[/#%:@^,~]'
    _dhpk_ci_cp_pos_hit "$1" "${_dhpk_ci_pt_w:- }" && return 0
    if [ "${2:-0}" != "1" ]; then
        _dhpk_ci_cp_pos_hit "$1" "${_dhpk_ci_pt_e:- }" && return 0
    fi
    [[ "$1" =~ $re ]] || return 1
    _dhpk_ci_cp_pos_hit "$1" "${_dhpk_ci_pt_x:- }${_dhpk_ci_pt_e:- }"
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

# True when raw word $1 is a quoted literal that states a whole risky git command.
_dhpk_ci_cp_literal_risky() {
    case "$1" in *[\"\'\\]*) ;; *) return 1 ;; esac
    _dhpk_ci_fs_value "$1" || return 1
    case "$_dhpk_ci_fs_uq" in *[[:space:]]*) ;; *) return 1 ;; esac
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
    [ "$_dhpk_ci_cp_t" = "1" ] && _dhpk_ci_cp_add _dhpk_ci_git_taint "$1"
    [ "$_dhpk_ci_cp_g" = "1" ] && _dhpk_ci_cp_add _dhpk_ci_git_named "$1"
    [ "$_dhpk_ci_cp_x" = "1" ] && _dhpk_ci_cp_add _dhpk_ci_nonascii_names "$1"
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

# $1 set or call, $2 the segment. The words of set [options] [--] WORDS, or of a call of a function
# defined in the text, become positional parameters.
_dhpk_ci_cp_args() {
    local i=1 n raw pos=0 joined=""
    _dhpk_ci_fs_split "$2"
    n="${#_dhpk_ci_fs_words[@]}"
    if [ "$1" = "set" ]; then
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
        joined="$joined${_dhpk_ci_fs_words[$i]} "
        i=$((i + 1))
        _dhpk_ci_cp_classify "$raw"
        [ "$_dhpk_ci_cp_x" = "1" ] && _dhpk_ci_cp_add _dhpk_ci_pt_x "$pos"
        if [ "$_dhpk_ci_cp_t" = "1" ]; then
            case "$raw" in
                \"*) _dhpk_ci_cp_add _dhpk_ci_pt_e "$pos" ;;
                *) _dhpk_ci_cp_add _dhpk_ci_pt_w "$pos" ;;
            esac
        elif _dhpk_ci_cp_literal_risky "$raw"; then
            _dhpk_ci_cp_add _dhpk_ci_pt_e "$pos"
        fi
    done
    # The words of a set are a command themselves when the first one is git.
    [ "$1" = "set" ] || return 0
    case "$joined" in
        git\ *|*/git\ *) _dhpk_ci_git_value_risky "$joined" 0 && _dhpk_ci_cp_add _dhpk_ci_pt_w 1 ;;
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
    text="${text//\(\)/$'\001'}"
    case "$text" in
        *'for '*|*'select '*|*'set '*|*$'\001'*|*'function '*) ;;
        *) return 0 ;;
    esac
    text="${text//[;&|()\`]/$'\n'}"
    nl="${text//[^$'\n']/}"
    [ "${#nl}" -le 1024 ] || return 0
    _dhpk_ci_fs_funcs=" "
    _dhpk_ci_fs_nfn=0
    while IFS= read -r seg; do
        segs+=("$seg")
        case "$seg" in
            *$'\001'*|*'function '*) _dhpk_ci_fs_strip "$seg" 1 ;;
        esac
    done <<<"$text"
    for seg in "${segs[@]}"; do
        [[ "$seg" == *[![:space:]]* ]] || continue
        _dhpk_ci_fs_strip "$seg" 0
        seg="$_dhpk_ci_fs_seg"
        head="${seg%%[[:space:]]*}"
        head="${head//[\"\'\\]/}"
        case "$head" in
            '') continue ;;
            for|select) _dhpk_ci_cp_kind+=(for) ;;
            set) _dhpk_ci_cp_kind+=(set) ;;
            *)
                case "$_dhpk_ci_fs_funcs" in
                    *" $head "*) _dhpk_ci_cp_kind+=(call) ;;
                    *) continue ;;
                esac
                ;;
        esac
        _dhpk_ci_cp_seg+=("$seg")
    done
    _dhpk_ci_pos_opaque="$opaque"
}

# Sets _dhpk_ci_cp_attr to the names that declare, typeset or local gives the -l or -u attribute.
_dhpk_ci_cp_attr_names() {
    local rest="$1" w on sq="'" re_id='^[A-Za-z_][A-Za-z0-9_]*$'
    local re='(declare|typeset|local)[[:space:]]+([^;&|]*)'
    local -a ws_a
    _dhpk_ci_cp_attr=" "
    while [[ "$rest" =~ $re ]]; do
        w="${BASH_REMATCH[2]%%$'\n'*}"
        rest="${rest#*"${BASH_REMATCH[1]}"}"
        on=0
        read -r -a ws_a <<<"$w"
        for w in ${ws_a[@]+"${ws_a[@]}"}; do
            case "$w" in
                -*[lu]*) on=1; continue ;;
                -*) continue ;;
            esac
            [ "$on" = "1" ] || continue
            w="${w%%=*}"
            w="${w//[\"$sq]/}"
            [[ "$w" =~ $re_id ]] && _dhpk_ci_cp_attr="$_dhpk_ci_cp_attr$w "
        done
    done
}

# A flag value behind a case attribute is not the text that git sees: it cannot be compared literally.
_dhpk_ci_cp_attr_flags() {
    local name var
    for name in $_dhpk_ci_cp_attr; do
        var="_dhpk_ci_tv_$name"
        case "$_dhpk_ci_flag_names" in
            *" $name "*) _dhpk_ci_flag_force "$name" "@opaque"; continue ;;
        esac
        case " ${!var:-}" in
            *' -'*) _dhpk_ci_flag_force "$name" "@opaque" ;;
        esac
    done
}

# Follows copies in text $1 until nothing changes. $2 lists the assigned names, whose values are in
# _dhpk_ci_tv_<name> and whose substitution text is in _dhpk_ci_cx_<name>. A chain longer than the
# pass limit fails closed.
_dhpk_ci_scan_copies() {
    local name var sub i pass=0
    local -a _dhpk_ci_cp_kind=() _dhpk_ci_cp_seg=()
    local _dhpk_ci_cp_re _dhpk_ci_cp_re_t _dhpk_ci_cp_re_g _dhpk_ci_cp_re_x _dhpk_ci_cp_attr=" "
    local _dhpk_ci_cp_t _dhpk_ci_cp_g _dhpk_ci_cp_x _dhpk_ci_cp_changed=1
    case "$1" in *'$'*) ;; *) return 0 ;; esac
    _dhpk_ci_cp_collect "$1"
    _dhpk_ci_cp_attr_names "$1"
    while [ "$_dhpk_ci_cp_changed" = "1" ]; do
        pass=$((pass + 1))
        if [ "$pass" -gt 16 ]; then
            _dhpk_ci_taint_overflow=1
            break
        fi
        _dhpk_ci_cp_changed=0
        _dhpk_ci_cp_names_re "${_dhpk_ci_git_taint:-}"
        _dhpk_ci_cp_re_t="$_dhpk_ci_cp_re"
        _dhpk_ci_cp_names_re "${_dhpk_ci_git_named:-}"
        _dhpk_ci_cp_re_g="$_dhpk_ci_cp_re"
        _dhpk_ci_cp_names_re "${_dhpk_ci_nonascii_names:-}"
        _dhpk_ci_cp_re_x="$_dhpk_ci_cp_re"
        for name in $2; do
            var="_dhpk_ci_tv_$name"
            sub="_dhpk_ci_cx_$name"
            _dhpk_ci_cp_classify "${!var:-} ${!sub:-}"
            _dhpk_ci_cp_mark_name "$name"
        done
        for name in $_dhpk_ci_cp_attr; do
            case "$_dhpk_ci_nonascii_names" in
                *" $name "*) _dhpk_ci_cp_add _dhpk_ci_git_taint "$name" ;;
            esac
        done
        i=0
        while [ "$i" -lt "${#_dhpk_ci_cp_kind[@]}" ]; do
            case "${_dhpk_ci_cp_kind[$i]}" in
                for) _dhpk_ci_cp_for "${_dhpk_ci_cp_seg[$i]}" ;;
                *) _dhpk_ci_cp_args "${_dhpk_ci_cp_kind[$i]}" "${_dhpk_ci_cp_seg[$i]}" ;;
            esac
            i=$((i + 1))
        done
    done
    _dhpk_ci_cp_attr_flags
}
