#!/usr/bin/env bash
# shellcheck disable=SC2154  # state arrays are declared by the sibling modules
# command-inspect-scan.sh - ANSI-C decoding, expansion scan, heredocs, list runner.
# Source-only module of command-inspect.sh (#1501); sourced by it, not by hooks.
# bash 3.2. Never executes the command under inspection.

# _dhpk_ci_ansi_escape <text> <index>
#   Decodes the $'...' escape whose letter is at <index> (just after the
#   backslash). Sets _dhpk_ci_esc_out to the decoded text and _dhpk_ci_esc_len
#   to the number of characters consumed from <index>. Sets _dhpk_ci_esc_nul
#   to 1 when the escape decodes to NUL (\0, \x00, \u0000, \c@, an octal
#   value whose low byte is 0): bash ends the string there, so the caller
#   discards the rest of that $'...' segment. Unknown escapes and non-ASCII
#   \u / \U values keep their backslash form, as bash 3.2 does.
_dhpk_ci_ansi_escape() {
    local text="$1" at="$2" ch digits="" max=0 k d val
    ch="${text:$at:1}"
    _dhpk_ci_esc_len=1
    _dhpk_ci_esc_nul=0
    case "$ch" in
        n) _dhpk_ci_esc_out=$'\n'; return 0 ;;
        t) _dhpk_ci_esc_out=$'\t'; return 0 ;;
        r) _dhpk_ci_esc_out=$'\r'; return 0 ;;
        a) _dhpk_ci_esc_out=$'\a'; return 0 ;;
        b) _dhpk_ci_esc_out=$'\b'; return 0 ;;
        f) _dhpk_ci_esc_out=$'\f'; return 0 ;;
        v) _dhpk_ci_esc_out=$'\v'; return 0 ;;
        e|E) _dhpk_ci_esc_out=$'\033'; return 0 ;;
        \\|"'"|'"'|'?') _dhpk_ci_esc_out="$ch"; return 0 ;;
        c)
            # <text> is the body without its closing quote, so a \c at the
            # end stays literal. \c\\ is one unit; \c\ alone is also 0x1c.
            d="${text:$((at + 1)):1}"
            if [ -z "$d" ]; then
                _dhpk_ci_esc_out="\\c"
                return 0
            fi
            _dhpk_ci_esc_len=2
            if [ "$d" = "\\" ] && [ "${text:$((at + 2)):1}" = "\\" ]; then
                _dhpk_ci_esc_len=3
            fi
            printf -v val '%d' "'$d"
            _dhpk_ci_esc_byte $((val & 31))
            return 0
            ;;
        [01234567]) max=3; k=$at ;;
        x) max=2; k=$((at + 1)) ;;
        u) max=4; k=$((at + 1)) ;;
        U) max=8; k=$((at + 1)) ;;
        *) _dhpk_ci_esc_out="\\$ch"; return 0 ;;
    esac
    while [ "${#digits}" -lt "$max" ]; do
        d="${text:$k:1}"
        case "$ch" in
            # Explicit digit lists: a locale can make a range such as
            # [a-f] match non-ASCII letters, which breaks the arithmetic.
            [01234567]) case "$d" in [01234567]) ;; *) break ;; esac ;;
            *) case "$d" in [0123456789abcdefABCDEF]) ;; *) break ;; esac ;;
        esac
        digits+="$d"
        k=$((k + 1))
    done
    _dhpk_ci_esc_len=$((k - at))
    if [ -z "$digits" ]; then
        _dhpk_ci_esc_out="\\$ch"
        return 0
    fi
    case "$ch" in
        [01234567]) _dhpk_ci_esc_byte $((8#$digits & 255)) ;;
        x) _dhpk_ci_esc_byte $((16#$digits)) ;;
        *)
            val=$((16#$digits))
            if [ "$val" -lt 128 ]; then
                _dhpk_ci_esc_byte "$val"
            else
                _dhpk_ci_esc_out="\\$ch$digits"
            fi
            ;;
    esac
    return 0
}

# _dhpk_ci_ansi_end <index>
#   Sets _dhpk_ci_ansi_close to the index of the quote that closes the $'...'
#   body starting at <index> in the enclosing paged text, using the bash lexer
#   rule that a backslash pairs with exactly one character. Unterminated: len.
_dhpk_ci_ansi_end() {
    local k="$1" ch _pi=-1 _p=""
    while [ "$k" -lt "$len" ]; do
        if [ $((k >> 8)) -ne "$_pi" ]; then
            _pi=$((k >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        ch="${_p:$((k & 255)):1}"
        if [ "$ch" = "\\" ]; then
            k=$((k + 2))
            continue
        fi
        [ "$ch" = "'" ] && break
        k=$((k + 1))
    done
    [ "$k" -le "$len" ] || k="$len"
    _dhpk_ci_ansi_close="$k"
}

# _dhpk_ci_ansi_decode <body>
#   Sets _dhpk_ci_ansi_out to the bash value of a $'...' body (without its
#   quotes). Decoding stops at a NUL, as bash truncates the string there.
_dhpk_ci_ansi_decode() {
    local body="$1" k=0 n="${#1}" ch out=""
    while [ "$k" -lt "$n" ]; do
        ch="${body:$k:1}"
        if [ "$ch" = "\\" ] && [ $((k + 1)) -lt "$n" ]; then
            _dhpk_ci_ansi_escape "$body" $((k + 1))
            [ "$_dhpk_ci_esc_nul" -eq 1 ] && break
            out+="$_dhpk_ci_esc_out"
            k=$((k + 1 + _dhpk_ci_esc_len))
            continue
        fi
        out+="$ch"
        k=$((k + 1))
    done
    _dhpk_ci_ansi_out="$out"
}

# _dhpk_ci_esc_byte <0-255>
#   Sets _dhpk_ci_esc_out to that byte, or flags NUL for 0.
_dhpk_ci_esc_byte() {
    local hex
    if [ "$1" -eq 0 ]; then
        _dhpk_ci_esc_out=""
        _dhpk_ci_esc_nul=1
        return 0
    fi
    printf -v hex '%x' "$1"
    printf -v _dhpk_ci_esc_out '%b' "\\x$hex"
}


# _dhpk_ci_start_redirect
#   Called at an unquoted redirect operator. A pending all-digit word is the
#   fd number and is dropped; any other pending word is an argv word.
_dhpk_ci_start_redirect() {
    case "$_dhpk_ci_word" in
        ""|*[!0-9]*) _dhpk_ci_flush_word ;;
        *) _dhpk_ci_word=""; _dhpk_ci_word_flat=""; _dhpk_ci_word_dyn=0; _dhpk_ci_word_split=0; _dhpk_ci_word_open=0; _dhpk_ci_word_q=0 ;;
    esac
    _dhpk_ci_redir=1
}

# _dhpk_ci_unsupported <reason>
#   Records the first construct the decoder cannot place faithfully. Hooks
#   treat a non-empty DHPK_UNSUPPORTED as a block, not as a guess.
_dhpk_ci_unsupported() {
    [ -n "$DHPK_UNSUPPORTED" ] || DHPK_UNSUPPORTED="$1"
}

# _dhpk_ci_arith <index>
#   <index> is just after '$((' or '((' in the enclosing paged text. Sets
#   _dhpk_ci_end after the closing '))' and returns 0. Returns 1 when the first
#   unmatched ')' is not doubled, because bash then reads the text as a
#   subshell, not arithmetic. Quotes or a command substitution inside
#   arithmetic are reported as unsupported.
_dhpk_ci_arith() {
    local k="$1" depth=0 ch reason="" _pi=-1 _p="" _o
    while [ "$k" -lt "$len" ]; do
        if [ $((k >> 8)) -ne "$_pi" ]; then
            _pi=$((k >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        _o=$((k & 255))
        ch="${_p:$_o:1}"
        case "$ch" in
            '(') depth=$((depth + 1)) ;;
            ')')
                if [ "$depth" -gt 0 ]; then
                    depth=$((depth - 1))
                elif [ "${_p:$((_o + 1)):1}" = ")" ]; then
                    [ -z "$reason" ] || _dhpk_ci_unsupported "$reason"
                    _dhpk_ci_saw_arith_consumer=1
                    _dhpk_ci_end=$((k + 2))
                    return 0
                else
                    return 1
                fi
                ;;
            "'"|'"'|'`') reason="quote or backtick inside arithmetic" ;;
            '$')
                if [ "${_p:$((_o + 1)):1}" = "(" ]; then
                    reason="command substitution inside arithmetic"
                fi
                ;;
        esac
        k=$((k + 1))
    done
    _dhpk_ci_unsupported "unterminated arithmetic"
    _dhpk_ci_end="$len"
    return 0
}

# _dhpk_ci_brack <index>
#   <index> is just after '$[' in the enclosing paged text. Sets _dhpk_ci_end
#   after the matching ']' of this legacy arithmetic form; quotes or
#   substitutions inside it, or no closing bracket, are reported as unsupported.
_dhpk_ci_brack() {
    local k="$1" depth=0 ch _pi=-1 _p="" _o
    while [ "$k" -lt "$len" ]; do
        if [ $((k >> 8)) -ne "$_pi" ]; then
            _pi=$((k >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        _o=$((k & 255))
        ch="${_p:$_o:1}"
        case "$ch" in
            '[') depth=$((depth + 1)) ;;
            ']')
                if [ "$depth" -eq 0 ]; then
                    _dhpk_ci_saw_arith_consumer=1
                    _dhpk_ci_end=$((k + 1))
                    return 0
                fi
                depth=$((depth - 1))
                ;;
            "'"|'"'|'`') _dhpk_ci_unsupported "quote or backtick inside \$[...]" ;;
            '$')
                if [ "${_p:$((_o + 1)):1}" = "(" ]; then
                    _dhpk_ci_unsupported "command substitution inside \$[...]"
                fi
                ;;
        esac
        k=$((k + 1))
    done
    _dhpk_ci_unsupported "unterminated \$[...]"
    _dhpk_ci_end="$len"
}

# _dhpk_ci_backtick <index> <in-double-quotes>
#   <index> is the opening backtick in the enclosing paged text. The body ends
#   at the next unescaped backtick (quotes do not count, as in bash). \$ \` \\
#   (and \" inside double quotes) lose their backslash, then the body is
#   inspected as its own command list, so a quote inside it cannot leak out.
_dhpk_ci_backtick() {
    local k=$(($1 + 1)) indq="$2" ch nx body="" _pi=-1 _p="" _o
    while [ "$k" -lt "$len" ]; do
        if [ $((k >> 8)) -ne "$_pi" ]; then
            _pi=$((k >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        _o=$((k & 255))
        ch="${_p:$_o:1}"
        if [ "$ch" = "\\" ]; then
            nx="${_p:$((_o + 1)):1}"
            case "$nx" in
                '$'|'`'|\\) body+="$nx" ;;
                '"') if [ "$indq" = 1 ]; then body+="$nx"; else body+="\\$nx"; fi ;;
                *) body+="\\$nx" ;;
            esac
            k=$((k + 2))
            continue
        fi
        [ "$ch" = '`' ] && break
        body+="$ch"
        k=$((k + 1))
    done
    [ "$k" -lt "$len" ] && k=$((k + 1))
    [ "$k" -le "$len" ] || k="$len"
    _dhpk_ci_ss_push
    _dhpk_ci_list "$body" 0 body
    _dhpk_ci_ss_pop
    _dhpk_ci_end="$k"
}

# _dhpk_ci_expand <index> <in-double-quotes>
#   Handles $(...), $((...)), $[...], ${...} or a backtick at <index> in the
#   enclosing paged text: commands inside are inspected and _dhpk_ci_end is
#   set after the construct, and _dhpk_ci_expand_stripped holds its stripped
#   representation. Returns 1, without side effects, for any other character.
_dhpk_ci_wrap_subst() {
    local opener="$1" _idx=$((_dhpk_ci_end - 1))
    if [ "$_idx" -ge 0 ] && [ "${_dhpk_ci_pg[$((_idx >> 8))]:$((_idx & 255)):1}" = ")" ]; then
        _dhpk_ci_sub_stripped="${opener}${_dhpk_ci_sub_stripped})"
    else
        _dhpk_ci_sub_stripped="${opener}${_dhpk_ci_sub_stripped}"
    fi
}

_dhpk_ci_expand() {
    local i="$1" indq="$2" _p _o _ch _nx _rest _sp _l
    _p="${_dhpk_ci_pg[$((i >> 8))]}"
    _o=$((i & 255))
    _ch="${_p:$_o:1}"
    if [ "$_ch" = '`' ]; then
        _dhpk_ci_exec_context $((1 - indq))
        _dhpk_ci_backtick "$i" "$indq"
        _dhpk_ci_expand_stripped="\`$_dhpk_ci_sub_stripped\`"
        return 0
    fi
    [ "$_ch" = '$' ] || return 1
    _nx="${_p:$((_o + 1)):1}"
    case "$_nx" in
        '(')
            if [ "${_p:$((_o + 2)):1}" = "(" ]; then
                if _dhpk_ci_arith $((i + 3)); then
                    _l=$((_dhpk_ci_end - i))
                    if [ "$_l" -le 257 ]; then
                        _dhpk_ci_expand_stripped="${_p:$_o:$_l}"
                    else
                        _dhpk_ci_expand_stripped="${text:$i:$_l}"
                    fi
                    return 0
                fi
            elif [ "$_dhpk_ci_depth" -lt "$DHPK_CI_MAX_DEPTH" ]; then
                # Fast path for simple single-word $(cmd) within the current page.
                _rest="${_p:$((_o + 2)):256}"
                case "$_rest" in
                    *')'*)
                        _sp="${_rest%%\)*}"
                        if [ -n "$_sp" ]; then
                            case "$_sp" in
                                *["$_DHPK_CI_SIMPLE_STOP"]*) ;;
                                git|*/git|cd|*/cd|pushd|popd|command|builtin|case|function|for|select|if|while|until|'fi'|'done'|'esac'|time|coproc) ;;
                                *)
                                    _dhpk_ci_exec_next=0
                                    DHPK_CMD_START+=("${#DHPK_WORDS[@]}")
                                    DHPK_CMD_LEN+=(1)
                                    DHPK_CMD_PIPE_ID+=(0)
                                    DHPK_WORDS+=("$_sp")
                                    if [ "$_dhpk_ci_cwd_state" = "literal" ]; then
                                        DHPK_CMD_CWD+=("$_dhpk_ci_cwd")
                                    else
                                        DHPK_CMD_CWD+=("")
                                    fi
                                    _dhpk_ci_end=$((i + 3 + ${#_sp}))
                                    _dhpk_ci_expand_stripped="\$($_sp)"
                                    return 0
                                    ;;
                            esac
                        fi
                        ;;
                esac
            fi
            _dhpk_ci_exec_context $((1 - indq))
            _dhpk_ci_ss_push
            _dhpk_ci_list "" $((i + 2)) subst
            _dhpk_ci_ss_pop
            _dhpk_ci_wrap_subst "\$("
            _dhpk_ci_expand_stripped="$_dhpk_ci_sub_stripped"
            return 0
            ;;
        '{')
            if [ "$_dhpk_ci_depth" -lt "$DHPK_CI_MAX_DEPTH" ]; then
                _rest="${_p:$((_o + 2)):256}"
                case "$_rest" in
                    *'}'*)
                        _sp="${_rest%%\}*}"
                        case "$_sp" in
                            *[\'\"\\$\`]*) ;;
                            *)
                                _dhpk_ci_end=$((i + 3 + ${#_sp}))
                                _dhpk_ci_expand_stripped="\${$_sp}"
                                return 0
                                ;;
                        esac
                        ;;
                esac
            fi
            _dhpk_ci_scan "" $((i + 2)) param "$indq"
            _l=$((_dhpk_ci_end - i))
            if [ "$_l" -le 257 ]; then
                _dhpk_ci_expand_stripped="${_p:$_o:$_l}"
            else
                _dhpk_ci_expand_stripped="${text:$i:$_l}"
            fi
            return 0
            ;;
        '[')
            _dhpk_ci_brack $((i + 2))
            _l=$((_dhpk_ci_end - i))
            if [ "$_l" -le 257 ]; then
                _dhpk_ci_expand_stripped="${_p:$_o:$_l}"
            else
                _dhpk_ci_expand_stripped="${text:$i:$_l}"
            fi
            return 0
            ;;
    esac
    return 1
}

# _dhpk_ci_scan <text-or-empty> <index> <kind> [<indq>]
#   Finds the end of text that holds no commands of its own and inspects the
#   substitutions inside it. Sets _dhpk_ci_end after the end.
#   param: a ${...} body (in enclosing paged text). '...', $'...' and "..."
#          quote (bash 5.2 rules, in and out of double quotes); the first
#          unquoted } ends it.
#   pdq:   a "..." nested in a ${...}; ends after the closing quote.
#   hbody: an unquoted-delimiter heredoc body ($1); quotes are data.
_dhpk_ci_scan() {
    if [ "$_dhpk_ci_depth" -ge "$DHPK_CI_MAX_DEPTH" ]; then
        _dhpk_ci_unsupported "nesting too deep"
        if [ "$3" = "hbody" ]; then
            _dhpk_ci_end="${#1}"
        else
            _dhpk_ci_end="$len"
        fi
        return 0
    fi
    _dhpk_ci_depth=$((_dhpk_ci_depth + 1))
    _dhpk_ci_scan_run "$@"
    _dhpk_ci_depth=$((_dhpk_ci_depth - 1))
    return 0
}

_dhpk_ci_scan_run() {
    local k="$2" kind="$3" indq="${4:-0}" ch rest sq=0 _pi=-1 _p="" _o scan_indq=1
    [ "$kind" = "param" ] && scan_indq="$indq"
    if [ "$kind" = "hbody" ]; then
        local text="$1" len="${#1}"
        local -a _dhpk_ci_pg
        _dhpk_ci_make_pages
    fi
    while [ "$k" -lt "$len" ]; do
        if [ $((k >> 8)) -ne "$_pi" ]; then
            _pi=$((k >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        _o=$((k & 255))
        ch="${_p:$_o:1}"
        if [ "$sq" -eq 1 ]; then
            # '...' in a double-quoted ${...}: it hides } and ", but bash
            # still runs the substitutions inside it. A backslash is literal
            # there, so '\' ends at its second quote (bash 5.2).
            case "$ch" in
                "'") sq=0 ;;
                '$'|'`')
                    if _dhpk_ci_expand "$k" 1; then
                        k="$_dhpk_ci_end"
                        continue
                    fi
                    ;;
            esac
            k=$((k + 1))
            continue
        fi
        case "$ch" in
            \\) k=$((k + 2)); continue ;;
            '$'|'`')
                if [ "$kind" = "param" ] && [ "$indq" -eq 0 ] && [ "${_p:$((_o + 1)):1}" = "'" ]; then
                    _dhpk_ci_ansi_end $((k + 2))
                    k=$((_dhpk_ci_ansi_close + 1))
                    continue
                fi
                if _dhpk_ci_expand "$k" "$scan_indq"; then
                    if [ "$kind" = "hbody" ]; then
                        DHPK_STRIPPED+="${_dhpk_ci_expand_stripped}"$'\n'
                    fi
                    k="$_dhpk_ci_end"
                    continue
                fi
                ;;
            "'")
                if [ "$kind" = "param" ] && [ "$indq" -eq 1 ]; then
                    sq=1
                    k=$((k + 1))
                    continue
                fi
                if [ "$kind" = "param" ]; then
                    rest="${_p:$((_o + 1)):256}"
                    case "$rest" in
                        *"'"*) rest="${rest%%\'*}"; k=$((k + 2 + ${#rest})) ;;
                        *)
                            rest="${text:$((k + 1))}"
                            case "$rest" in
                                *"'"*) rest="${rest%%\'*}"; k=$((k + 2 + ${#rest})) ;;
                                *) k="$len" ;;
                            esac
                            ;;
                    esac
                    continue
                fi
                ;;
            '"')
                if [ "$kind" = "param" ]; then
                    _dhpk_ci_scan "" $((k + 1)) pdq
                    k="$_dhpk_ci_end"
                    continue
                fi
                if [ "$kind" = "pdq" ]; then
                    _dhpk_ci_end=$((k + 1))
                    return 0
                fi
                ;;
            '}')
                if [ "$kind" = "param" ]; then
                    _dhpk_ci_end=$((k + 1))
                    return 0
                fi
                ;;
        esac
        k=$((k + 1))
    done
    _dhpk_ci_end="$len"
}

# _dhpk_ci_hd_delim <index>
#   <index> is just after '<<' or '<<-' in the enclosing paged text. Reads the
#   delimiter word with quote removal into _dhpk_ci_hd_word, sets
#   _dhpk_ci_hd_quoted to 1 when any part was quoted, and _dhpk_ci_end after
#   the word.
_dhpk_ci_hd_delim() {
    local k="$1" ch nx word="" quoted=0 rest _pi=-1 _p="" _o
    while [ "$k" -lt "$len" ]; do
        if [ $((k >> 8)) -ne "$_pi" ]; then
            _pi=$((k >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        case "${_p:$((k & 255)):1}" in
            ' '|$'\t') k=$((k + 1)) ;;
            *) break ;;
        esac
    done
    while [ "$k" -lt "$len" ]; do
        if [ $((k >> 8)) -ne "$_pi" ]; then
            _pi=$((k >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        _o=$((k & 255))
        ch="${_p:$_o:1}"
        case "$ch" in
            ' '|$'\t'|$'\n'|';'|'&'|'|'|'<'|'>'|'('|')') break ;;
            "'")
                quoted=1
                rest="${_p:$((_o + 1)):256}"
                case "$rest" in
                    *"'"*) rest="${rest%%\'*}"; word+="$rest"; k=$((k + 2 + ${#rest})) ;;
                    *)
                        rest="${text:$((k + 1))}"
                        case "$rest" in
                            *"'"*) rest="${rest%%\'*}"; word+="$rest"; k=$((k + 2 + ${#rest})) ;;
                            *) word+="$rest"; k="$len" ;;
                        esac
                        ;;
                esac
                continue
                ;;
            '"')
                quoted=1
                k=$((k + 1))
                while [ "$k" -lt "$len" ]; do
                    if [ $((k >> 8)) -ne "$_pi" ]; then
                        _pi=$((k >> 8))
                        _p="${_dhpk_ci_pg[$_pi]}"
                    fi
                    _o=$((k & 255))
                    ch="${_p:$_o:1}"
                    [ "$ch" = '"' ] && break
                    if [ "$ch" = "\\" ]; then
                        nx="${_p:$((_o + 1)):1}"
                        case "$nx" in
                            '$'|'`'|'"'|\\) word+="$nx"; k=$((k + 2)); continue ;;
                        esac
                    fi
                    case "$ch" in
                        '$'|'`') _dhpk_ci_unsupported "expansion in a heredoc delimiter" ;;
                    esac
                    word+="$ch"
                    k=$((k + 1))
                done
                k=$((k + 1))
                continue
                ;;
            \\)
                quoted=1
                nx="${_p:$((_o + 1)):1}"
                [ "$nx" = $'\n' ] && _dhpk_ci_unsupported "line continuation in a heredoc delimiter"
                word+="$nx"
                k=$((k + 2))
                continue
                ;;
            '`') _dhpk_ci_unsupported "expansion in a heredoc delimiter" ;;
            '$')
                case "${_p:$((_o + 1)):1}" in
                    "'"|'"'|'('|'{') _dhpk_ci_unsupported "expansion in a heredoc delimiter" ;;
                esac
                ;;
        esac
        word+="$ch"
        k=$((k + 1))
    done
    [ "$k" -le "$len" ] || k="$len"
    if [ -z "$word" ] && [ "$quoted" -eq 0 ]; then
        _dhpk_ci_unsupported "heredoc without a delimiter"
    fi
    _dhpk_ci_hd_word="$word"
    _dhpk_ci_hd_quoted="$quoted"
    _dhpk_ci_end="$k"
}

# _dhpk_ci_hd_bodies <index>
#   <index> is just after the newline that ends a line with pending heredocs
#   in the enclosing paged text. Consumes each body in order, up to its
#   delimiter line (or the end of the text, as bash does). With an unquoted
#   delimiter a line that ends in an odd number of backslashes joins the next
#   line first. A body that _dhpk_ci_flush_command classified as data (cat or
#   tee whose output does not run) is skipped, except the substitutions of an
#   unquoted body. Any other body is inspected as its own command list. Sets
#   _dhpk_ci_end.
_dhpk_ci_hd_bodies() {
    local k="$1" j=0 count="${#_dhpk_ci_hd_d[@]}"
    local delim quoted strip isexec start lstart rest line logical bs body cont chunk _p _o
    while [ "$j" -lt "$count" ]; do
        delim="${_dhpk_ci_hd_d[$j]}"
        quoted="${_dhpk_ci_hd_q[$j]}"
        strip="${_dhpk_ci_hd_t[$j]}"
        isexec="${_dhpk_ci_hd_x[$j]:-1}"
        start="$k"
        lstart="$k"
        logical=""
        cont=0
        body=""
        while [ "$k" -lt "$len" ]; do
            [ "$cont" -eq 1 ] || lstart="$k"
            cont=0
            line=""
            while [ "$k" -lt "$len" ]; do
                _p="${_dhpk_ci_pg[$((k >> 8))]}"
                _o=$((k & 255))
                rest="${_p:$_o}"
                chunk="${rest%%$'\n'*}"
                if [ "${#chunk}" -lt "${#rest}" ]; then
                    line+="$chunk"
                    k=$((k + ${#chunk} + 1))
                    break
                fi
                line+="$rest"
                k=$((k + ${#rest}))
            done
            if [ "$strip" -eq 1 ]; then
                while [ "${line:0:1}" = $'\t' ]; do line="${line:1}"; done
            fi
            if [ "$quoted" -eq 0 ]; then
                bs=0
                while [ "$bs" -lt "${#line}" ] && [ "${line:$((${#line} - 1 - bs)):1}" = "\\" ]; do
                    bs=$((bs + 1))
                done
                if [ $((bs % 2)) -eq 1 ] && [ "$k" -lt "$len" ]; then
                    logical+="${line%\\}"
                    cont=1
                    continue
                fi
            fi
            logical+="$line"
            if [ "$logical" = "$delim" ]; then
                body="${text:$start:$((lstart - start))}"
                lstart=-1
                break
            fi
            if [ "$_dhpk_ci_kind" = "subst" ] && [ "${logical#"$delim")}" != "$logical" ]; then
                _dhpk_ci_unsupported "heredoc delimiter followed by ) inside a command substitution"
            fi
            logical=""
        done
        [ "$lstart" -ge 0 ] && body="${text:$start:$((len - start))}"
        if [ "$isexec" = 1 ]; then
            DHPK_STRIPPED+="$body"
            _dhpk_ci_ss_push
            _dhpk_ci_list "$body" 0 body
            _dhpk_ci_ss_pop
        elif [ "$quoted" -eq 0 ]; then
            _dhpk_ci_scan "$body" 0 hbody
        fi
        j=$((j + 1))
    done
    _dhpk_ci_hd_d=()
    _dhpk_ci_hd_q=()
    _dhpk_ci_hd_t=()
    _dhpk_ci_hd_x=()
    _dhpk_ci_hd_seen=0
    _dhpk_ci_end="$k"
}

# _dhpk_ci_exec_context <unquoted>
#   Sets _dhpk_ci_exec_next to 1 when a substitution starting now produces
#   text that runs as a command: an unquoted command word, or an argument of
#   eval, source or a shell. The nested list then treats its heredocs as
#   scripts.
_dhpk_ci_exec_context() {
    local h
    _dhpk_ci_exec_next=0
    _dhpk_ci_head_index
    h="$_dhpk_ci_head"
    if [ "$h" -ge "${#_dhpk_ci_words[@]}" ]; then
        if [ "$1" -eq 1 ] && [ -z "$_dhpk_ci_word" ] && [ "$_dhpk_ci_word_open" -eq 0 ]; then
            _dhpk_ci_exec_next=1
        fi
        return 0
    fi
    case "${_dhpk_ci_words[$h]##*/}" in
        eval|source|.|sh|bash|zsh|dash|ksh|ash|mksh|csh|tcsh|fish|busybox) _dhpk_ci_exec_next=1 ;;
    esac
    return 0
}

# _dhpk_ci_sub_word <start> <end> [stripped]
#   Adds the raw text of a substitution in the enclosing paged text that ended
#   at <end> to the current word and segment, and <stripped> (defaulting to
#   raw) to DHPK_STRIPPED. A substitution that spans a newline while a heredoc
#   is pending cannot be placed and is reported.
# (#1468) Marks the pending word when expansion text $1 can yield several words: any expansion outside
# double quotes, or inside them one that expands to a word list ("$@", "${a[@]}", "${!a[@]}", "${!p@}").
_dhpk_ci_note_word_split() {
    local re_list='\$@|\$\{@|\[@\]|@\}'
    if [ "$_dhpk_ci_mode" != "double" ] || [[ "$1" =~ $re_list ]]; then
        _dhpk_ci_word_split=1
    fi
}

_dhpk_ci_sub_word() {
    local _s="$1" _e="$2" _l raw stripped
    _l=$((_e - _s))
    if [ "$_l" -le 257 ]; then
        raw="${_dhpk_ci_pg[$((_s >> 8))]:$((_s & 255)):$_l}"
    else
        raw="${text:$_s:$_l}"
    fi
    stripped="${3-$raw}"
    _dhpk_ci_word+="$raw"
    _dhpk_ci_word_open=1
    _dhpk_ci_word_dyn=1
    _dhpk_ci_note_word_split "$raw"
    _dhpk_ci_seg+="$raw"
    DHPK_STRIPPED+="$stripped"
    if [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ]; then
        case "$raw" in
            *$'\n'*) _dhpk_ci_unsupported "substitution spans a pending heredoc" ;;
        esac
    fi
}

# _dhpk_ci_list <text-or-empty> <index> <kind>
#   Inspects a command list. kind is top (the whole command), subst (the
#   body of $(...) or <(...), ending at its unmatched ')'; reuses enclosing
#   text/len/_dhpk_ci_pg), or body (a heredoc script or backtick body, a
#   separate text). Parser state is local, so a nested list starts clean and
#   its cd or quotes cannot leak out. Only the top list writes the outer
#   DHPK_STRIPPED; nested lists build a local DHPK_STRIPPED and return it via
#   _dhpk_ci_sub_stripped. Sets _dhpk_ci_end after the list.
_dhpk_ci_list() {
    if [ "$_dhpk_ci_depth" -ge "$DHPK_CI_MAX_DEPTH" ]; then
        _dhpk_ci_unsupported "nesting too deep"
        _dhpk_ci_sub_stripped=""
        if [ "$3" = "subst" ]; then
            _dhpk_ci_end="$len"
        else
            _dhpk_ci_end="${#1}"
        fi
        return 0
    fi
    _dhpk_ci_depth=$((_dhpk_ci_depth + 1))
    _dhpk_ci_list_run "$@"
    _dhpk_ci_depth=$((_dhpk_ci_depth - 1))
    return 0
}

_dhpk_ci_list_run() {
    local i="$2" _dhpk_ci_kind="$3"
    # Each top-level inspection starts clean. Nested lists keep a visible
    # export so a later simple command in the same inspection still sees it.
    # set -a is the same kind of shell state for later commands here.
    if [ "$_dhpk_ci_kind" = "top" ]; then
        _dhpk_ci_git_env_sticky=0
        _dhpk_ci_allexport=0
        _dhpk_ci_ss_depth=0
        _dhpk_ci_bash_env_on=0
        _dhpk_ci_shellopts_exported=0
        _dhpk_ci_lastpipe=0
    fi
    if [ "$_dhpk_ci_kind" != "subst" ]; then
        local text="$1" len="${#1}"
        local -a _dhpk_ci_pg
        _dhpk_ci_make_pages
    fi
    local ch next matched _pi=-1 _p="" _o
    local _dhpk_ci_mode="normal" _dhpk_ci_word="" _dhpk_ci_word_flat="" _dhpk_ci_word_dyn=0 _dhpk_ci_word_split=0 _dhpk_ci_word_open=0 _dhpk_ci_redir=0
    local -a _dhpk_ci_words _dhpk_ci_dyn _dhpk_ci_quoted _dhpk_ci_words_flat _dhpk_ci_split
    local -a _dhpk_ci_hs_words _dhpk_ci_hs_dyn _dhpk_ci_hs_flat _dhpk_ci_pipe_hs_flat
    local _dhpk_ci_word_q=0 _dhpk_ci_pipe_has_shell=0
    local _dhpk_ci_seg="" _dhpk_ci_pipeline_cd=0 _dhpk_ci_paren=0 _dhpk_ci_any_cd=0 _dhpk_ci_case=0
    local _dhpk_ci_pipe_id=0 _dhpk_ci_last_group_cmd0=-1 _dhpk_ci_after_pipe=0 _dhpk_ci_grp_depth=0
    # Conditional-cd tracking: open if/loop/case blocks, a function body
    # seen, the separator before this command, a cd held by an && chain.
    local _dhpk_ci_block=0 _dhpk_ci_func=0 _dhpk_ci_prev_sep="" _dhpk_ci_cd_cond=0 _dhpk_ci_paren_empty=0
    # Directory/state saved at each open '(' and open compound group stack.
    # Subshells restore allexport and sticky fully. Function bodies merge
    # fail-closed so an uncalled body cannot clear a relocation.
    local -a _dhpk_ci_cwd_stk _dhpk_ci_state_stk _dhpk_ci_grp_cmd0 _dhpk_ci_grp_pipe _dhpk_ci_grp_kind _dhpk_ci_grp_pidx
    local -a _dhpk_ci_grp_lastpipe _dhpk_ci_grp_sticky _dhpk_ci_grp_allexport _dhpk_ci_grp_ifs
    local -a _dhpk_ci_allexport_stk _dhpk_ci_sticky_stk _dhpk_ci_lastpipe_stk
    local -a _dhpk_ci_fn_allexport_stk _dhpk_ci_fn_sticky_stk _dhpk_ci_fn_lastpipe_stk _dhpk_ci_fn_ifs_stk _dhpk_ci_fn_brace
    local -a _dhpk_ci_rf_mark _dhpk_ci_ifs_stk _dhpk_ci_paren_stamp
    local _dhpk_ci_share_here="${_dhpk_ci_share_rf:-0}"
    _dhpk_ci_share_rf=0
    # eval and source run in this shell, so their IFS assignment and read
    # bindings remain. A child shell keeps its own read bindings.
    if [ "$_dhpk_ci_kind" != "body" ] || [ "$_dhpk_ci_share_here" != "1" ]; then
        local -a _dhpk_ci_rf_name _dhpk_ci_rf_body _dhpk_ci_rf_opaque
        # Bash 3.2 binds the local name before expanding the same name.
        local _dhpk_ci_ifs_outer="${_dhpk_ci_ifs_custom:-0}"
        local _dhpk_ci_ifs_custom="$_dhpk_ci_ifs_outer"
    fi
    local _dhpk_ci_fn_pending=0 _dhpk_ci_fn_depth=0 _dhpk_ci_fn_cdepth=0 _dhpk_ci_stage_open=0 _dhpk_ci_stage_lastpipe=0
    local _dhpk_ci_fn_pending_name="" _dhpk_ci_fn_pending_dead=0 _dhpk_ci_cmd_intro_dead=0
    local _dhpk_ci_pipe_text="" _dhpk_ci_pipe_known=1
    local _dhpk_ci_subst_text="" _dhpk_ci_subst_known=1 _dhpk_ci_ps_hold=0
    # A nested list inherits functions already defined outside it. Copy
    # before the local arrays below hide the caller's table. Definitions
    # inside this list stay here, unless eval or source runs in this shell.
    local _dhpk_ci_share_fns=0
    if [ "$_dhpk_ci_kind" = "body" ] && [ "$_dhpk_ci_share_here" = "1" ]; then
        _dhpk_ci_share_fns=1
    fi
    if [ "$_dhpk_ci_share_fns" = "0" ]; then
        local -a _dhpk_ci_shfn_name_in _dhpk_ci_shfn_body_in
        _dhpk_ci_shfn_name_in=()
        _dhpk_ci_shfn_body_in=()
        if [ -n "${_dhpk_ci_shfn_name+x}" ]; then
            _dhpk_ci_shfn_name_in=("${_dhpk_ci_shfn_name[@]+"${_dhpk_ci_shfn_name[@]}"}")
            _dhpk_ci_shfn_body_in=("${_dhpk_ci_shfn_body[@]+"${_dhpk_ci_shfn_body[@]}"}")
        fi
        local -a _dhpk_ci_shfn_name _dhpk_ci_shfn_body _dhpk_ci_shfn_frozen
    fi
    local -a _dhpk_ci_fn_name_stk _dhpk_ci_fn_paren_stk
    local -a _dhpk_ci_shfn_snap _dhpk_ci_shfn_saved
    local -a _dhpk_ci_fn_pbuf _dhpk_ci_fn_pkeep
    local -a _dhpk_ci_fn_cname _dhpk_ci_fn_cbase _dhpk_ci_fn_cexport _dhpk_ci_fn_csticky _dhpk_ci_fn_clast _dhpk_ci_fn_cifs
    local -a _dhpk_ci_ps_at _dhpk_ci_ps_body _dhpk_ci_ps_ok _dhpk_ci_outps_q
    local -a _dhpk_ci_pin_text _dhpk_ci_pin_known _dhpk_ci_pin_live
    local -a _dhpk_ci_gpin_text _dhpk_ci_gpin_known _dhpk_ci_gpin_live
    _dhpk_ci_cwd_stk=()
    _dhpk_ci_state_stk=()
    _dhpk_ci_grp_cmd0=()
    _dhpk_ci_grp_pipe=()
    _dhpk_ci_grp_kind=()
    _dhpk_ci_grp_pidx=()
    _dhpk_ci_pipe_hs_flat=()
    _dhpk_ci_rf_mark=()
    _dhpk_ci_ifs_stk=()
    _dhpk_ci_paren_stamp=()
    if [ "$_dhpk_ci_share_fns" = "0" ]; then
        _dhpk_ci_shfn_name=("${_dhpk_ci_shfn_name_in[@]+"${_dhpk_ci_shfn_name_in[@]}"}")
        _dhpk_ci_shfn_body=("${_dhpk_ci_shfn_body_in[@]+"${_dhpk_ci_shfn_body_in[@]}"}")
        _dhpk_ci_shfn_frozen=()
        local _dhpk_ci_fr_i=0
        while [ "$_dhpk_ci_fr_i" -lt "${#_dhpk_ci_shfn_name[@]}" ]; do
            _dhpk_ci_shfn_frozen+=("0")
            _dhpk_ci_fr_i=$((_dhpk_ci_fr_i + 1))
        done
    fi
    _dhpk_ci_shfn_snap=()
    _dhpk_ci_shfn_saved=()
    _dhpk_ci_fn_name_stk=()
    _dhpk_ci_fn_paren_stk=()
    _dhpk_ci_fn_pbuf=()
    _dhpk_ci_fn_pkeep=()
    _dhpk_ci_fn_cname=()
    _dhpk_ci_fn_cbase=()
    _dhpk_ci_fn_cexport=()
    _dhpk_ci_fn_csticky=()
    _dhpk_ci_fn_clast=()
    _dhpk_ci_fn_cifs=()
    _dhpk_ci_ps_at=()
    _dhpk_ci_ps_body=()
    _dhpk_ci_ps_ok=()
    _dhpk_ci_outps_q=()
    _dhpk_ci_pin_text=()
    _dhpk_ci_pin_known=()
    _dhpk_ci_pin_live=()
    _dhpk_ci_gpin_text=()
    _dhpk_ci_gpin_known=()
    _dhpk_ci_gpin_live=()
    if [ "$_dhpk_ci_kind" != "body" ] || [ "$_dhpk_ci_share_here" != "1" ]; then
        _dhpk_ci_rf_name=()
        _dhpk_ci_rf_body=()
        _dhpk_ci_rf_opaque=()
    fi
    local _dhpk_ci_cwd="$_dhpk_ci_cwd" _dhpk_ci_cwd_state="$_dhpk_ci_cwd_state"
    local -a _dhpk_ci_hd_d _dhpk_ci_hd_q _dhpk_ci_hd_t _dhpk_ci_hd_x
    local _dhpk_ci_hd_seen=0
    # Set by the caller when this list's output runs as a command.
    local _dhpk_ci_xctx="${_dhpk_ci_exec_next:-0}"
    _dhpk_ci_exec_next=0
    _dhpk_ci_hd_d=()
    _dhpk_ci_hd_q=()
    _dhpk_ci_hd_t=()
    _dhpk_ci_hd_x=()
    _dhpk_ci_reset_words
    if [ "$_dhpk_ci_kind" != "top" ]; then
        local DHPK_STRIPPED=""
    fi

    while [ "$i" -lt "$len" ]; do
        if [ $((i >> 8)) -ne "$_pi" ]; then
            _pi=$((i >> 8))
            _p="${_dhpk_ci_pg[$_pi]}"
        fi
        _o=$((i & 255))
        ch="${_p:$_o:1}"
        next="${_p:$((_o + 1)):1}"
        if [ "$_dhpk_ci_mode" = "comment" ]; then
            if [ "$ch" = $'\n' ]; then
                _dhpk_ci_flush_command compound
                _dhpk_ci_mode="normal"
                DHPK_STRIPPED+=$'\n'
                if [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ]; then
                    _dhpk_ci_hd_bodies $((i + 1))
                    i="$_dhpk_ci_end"
                    continue
                fi
            fi
            i=$((i + 1))
            continue
        fi
        if [ "$_dhpk_ci_mode" = "single" ]; then
            DHPK_STRIPPED+="$ch"
            _dhpk_ci_seg+="$ch"
            if [ "$ch" = "'" ]; then
                _dhpk_ci_mode="normal"
            else
                _dhpk_ci_word+="$ch"
                _dhpk_ci_word_flat+="$ch"
                _dhpk_ci_word_open=1
            fi
            i=$((i + 1))
            continue
        fi
        if [ "$_dhpk_ci_mode" = "double" ]; then
            if [ "$ch" = "\\" ] && [ -n "$next" ]; then
                DHPK_STRIPPED+="$ch"
                _dhpk_ci_seg+="$ch"
                # Inside "...", backslash-newline is a line continuation and a
                # backslash escapes only $, `, " and \; before anything else
                # it stays part of the word.
                case "$next" in
                    $'\n') ;;
                    '$'|'`'|'"'|\\) _dhpk_ci_word+="$next"; _dhpk_ci_word_flat+="$next" ;;
                    *) _dhpk_ci_word+="\\$next"; _dhpk_ci_word_flat+="\\$next" ;;
                esac
                _dhpk_ci_word_open=1
                DHPK_STRIPPED+="$next"
                _dhpk_ci_seg+="$next"
                i=$((i + 2))
                continue
            fi
            if _dhpk_ci_expand "$i" 1; then
                _dhpk_ci_sub_word "$i" "$_dhpk_ci_end" "$_dhpk_ci_expand_stripped"
                i="$_dhpk_ci_end"
                continue
            fi
            DHPK_STRIPPED+="$ch"
            _dhpk_ci_seg+="$ch"
            if [ "$ch" = '"' ]; then
                _dhpk_ci_mode="normal"
            else
                _dhpk_ci_word+="$ch"
                _dhpk_ci_word_flat+="$ch"
                _dhpk_ci_word_open=1
                case "$ch" in
                    '$')
                        _dhpk_ci_word_dyn=1
                        if [ "$next" = "@" ]; then _dhpk_ci_word_split=1; fi
                        ;;
                    '`') _dhpk_ci_word_dyn=1 ;;
                esac
            fi
            i=$((i + 1))
            continue
        fi
        case "$ch" in
            \\)
                if [ "$next" = $'\n' ]; then
                    i=$((i + 2))
                    continue
                fi
                if [ -n "$next" ]; then
                    _dhpk_ci_word+="$next"
                    _dhpk_ci_word_flat+="$next"
                    _dhpk_ci_word_open=1
                    _dhpk_ci_word_q=1
                    DHPK_STRIPPED+="$next"
                    _dhpk_ci_seg+="$next"
                    i=$((i + 2))
                    continue
                fi
                ;;
            "'")
                _dhpk_ci_mode="single"
                _dhpk_ci_word_open=1
                _dhpk_ci_word_q=1
                DHPK_STRIPPED+="$ch"
                _dhpk_ci_seg+="$ch"
                i=$((i + 1))
                continue
                ;;
            '"')
                _dhpk_ci_mode="double"
                _dhpk_ci_word_open=1
                _dhpk_ci_word_q=1
                DHPK_STRIPPED+="$ch"
                _dhpk_ci_seg+="$ch"
                i=$((i + 1))
                continue
                ;;
            '#')
                # A comment starts only at the start of a word. Any quote
                # ('', "", $'') or backslash has already opened the word,
                # even when its decoded value is empty.
                if [ -z "$_dhpk_ci_word" ] && [ "$_dhpk_ci_word_open" -eq 0 ]; then
                    _dhpk_ci_mode="comment"
                    i=$((i + 1))
                    continue
                fi
                ;;
            ' '|$'\t')
                _dhpk_ci_flush_word
                DHPK_STRIPPED+="$ch"
                _dhpk_ci_seg+="$ch"
                i=$((i + 1))
                continue
                ;;
            $'\n')
                _dhpk_ci_flush_command compound
                DHPK_STRIPPED+=$'\n'
                i=$((i + 1))
                if [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ]; then
                    _dhpk_ci_hd_bodies "$i"
                    i="$_dhpk_ci_end"
                fi
                continue
                ;;
            ';')
                # The command this semicolon ends may be the last stage of a
                # pipeline. Clearing after_pipe first made `echo | bash;`
                # look like it had no stdin.
                _dhpk_ci_flush_command compound
                DHPK_STRIPPED+=";"
                i=$((i + 1))
                continue
                ;;
            '(')
                # (( is arithmetic when it closes with )); otherwise each ( is
                # a subshell. Both are operators, so a # after ( is a comment.
                if [ "$next" = "(" ] && [ -z "$_dhpk_ci_word" ] && [ "$_dhpk_ci_word_open" -eq 0 ] \
                    && _dhpk_ci_arith $((i + 2)); then
                    _dhpk_ci_sub_word "$i" "$_dhpk_ci_end"
                    i="$_dhpk_ci_end"
                    continue
                fi
                _dhpk_ci_flush_command compound
                # A `(` after `name()` is the function body. It is a subshell,
                # so it must not also be scanned as a simple function body.
                if [ "${_dhpk_ci_fn_pending:-0}" -eq 1 ]; then
                    _dhpk_ci_fn_paren_stk[$_dhpk_ci_paren]="${_dhpk_ci_fn_pending_name:-}"
                    _dhpk_ci_fn_open_def "${_dhpk_ci_fn_pending_name:-}"
                    _dhpk_ci_fn_pbuf[$_dhpk_ci_paren]=""
                    _dhpk_ci_fn_pkeep[$_dhpk_ci_paren]=0
                    [ "${_dhpk_ci_fn_sealed:-0}" = "1" ] && _dhpk_ci_fn_pkeep[$_dhpk_ci_paren]=1
                    # The body runs in a subshell when called. Tokens stay in
                    # pbuf so an inner definition cannot replace them. `)`
                    # resolves calls, then puts every other name back.
                    _dhpk_ci_fn_save_live "$_dhpk_ci_paren"
                    _dhpk_ci_shfn_saved[$_dhpk_ci_paren]=2
                else
                    _dhpk_ci_fn_paren_stk[$_dhpk_ci_paren]=""
                    _dhpk_ci_fn_save_live "$_dhpk_ci_paren"
                    _dhpk_ci_shfn_saved[$_dhpk_ci_paren]=1
                fi
                _dhpk_ci_cwd_stk[$_dhpk_ci_paren]="$_dhpk_ci_cwd"
                _dhpk_ci_state_stk[$_dhpk_ci_paren]="$_dhpk_ci_cwd_state"
                _dhpk_ci_allexport_stk[$_dhpk_ci_paren]="${_dhpk_ci_allexport:-0}"
                _dhpk_ci_sticky_stk[$_dhpk_ci_paren]="${_dhpk_ci_git_env_sticky:-0}"
                _dhpk_ci_lastpipe_stk[$_dhpk_ci_paren]="${_dhpk_ci_lastpipe:-0}"
                _dhpk_ci_rf_mark[$_dhpk_ci_paren]="${#_dhpk_ci_rf_name[@]}"
                _dhpk_ci_ifs_stk[$_dhpk_ci_paren]="${_dhpk_ci_ifs_custom:-0}"
                _dhpk_ci_paren_stamp[$_dhpk_ci_paren]="${_dhpk_ci_ifs_stamp:-0}"
                _dhpk_ci_grp_push paren "${#DHPK_CMD_START[@]}" "$_dhpk_ci_pipe_id"
                # Only a subshell that is itself a pipeline stage gets a new
                # snapshot. A nested subshell inherits the outer pin; copying
                # the buffer here would feed echo's stdout instead of the pipe.
                if [ "${_dhpk_ci_after_pipe:-0}" = "1" ]; then
                    _dhpk_ci_pin_text[$_dhpk_ci_paren]="${_dhpk_ci_pipe_text:-}"
                    _dhpk_ci_pin_known[$_dhpk_ci_paren]="${_dhpk_ci_pipe_known:-0}"
                    _dhpk_ci_pin_live[$_dhpk_ci_paren]=1
                else
                    _dhpk_ci_pin_text[$_dhpk_ci_paren]=""
                    _dhpk_ci_pin_known[$_dhpk_ci_paren]=0
                    _dhpk_ci_pin_live[$_dhpk_ci_paren]=0
                fi
                _dhpk_ci_after_pipe=0
                _dhpk_ci_paren=$((_dhpk_ci_paren + 1))
                _dhpk_ci_paren_empty=1
                DHPK_STRIPPED+="("
                i=$((i + 1))
                continue
                ;;
            ')')
                _dhpk_ci_flush_command compound
                if [ "$_dhpk_ci_paren" -eq 0 ] && [ "$_dhpk_ci_kind" = "subst" ]; then
                    [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ] && _dhpk_ci_unsupported "heredoc left open inside a command substitution"
                    _dhpk_ci_ps_text="${_dhpk_ci_subst_text:-}"
                    _dhpk_ci_ps_known="${_dhpk_ci_subst_known:-0}"
                    _dhpk_ci_sub_stripped="$DHPK_STRIPPED"
                    _dhpk_ci_end=$((i + 1))
                    return 0
                fi
                # A subshell's cd does not outlive it: its ) restores the
                # directory saved at its (. A case pattern's ) is not a
                # subshell's, so after a case and a cd, or at an unmatched )
                # after a cd, the directory is unresolved.
                # "name()" defines a function: its body may never run.
                if [ "$_dhpk_ci_paren_empty" -eq 1 ]; then
                    _dhpk_ci_func=1
                    _dhpk_ci_fn_pending=1
                    _dhpk_ci_fn_pending_cond="${_dhpk_ci_cmd_intro_cond:-0}"
                    _dhpk_ci_fn_pending_dead="${_dhpk_ci_cmd_intro_dead:-0}"
                    _dhpk_ci_fn_name_from_last
                    _dhpk_ci_fn_drop_def_token "${_dhpk_ci_fn_pending_name:-}"
                fi
                _dhpk_ci_paren_empty=0
                if [ "$_dhpk_ci_paren" -gt 0 ] && [ "$_dhpk_ci_grp_depth" -gt 0 ] \
                    && [ "${_dhpk_ci_grp_kind[$((_dhpk_ci_grp_depth - 1))]}" = "paren" ]; then
                    _dhpk_ci_paren=$((_dhpk_ci_paren - 1))
                    if [ "${_dhpk_ci_shfn_saved[$_dhpk_ci_paren]:-0}" = "2" ]; then
                        _dhpk_ci_fn_paren_name="${_dhpk_ci_fn_paren_stk[$_dhpk_ci_paren]:-}"
                        if [ "${_dhpk_ci_fn_pkeep[$_dhpk_ci_paren]:-0}" != "1" ]; then
                            _dhpk_ci_fn_resolve_calls "${_dhpk_ci_fn_pbuf[$_dhpk_ci_paren]:-}"
                            _dhpk_ci_fn_kept="${_dhpk_ci_fn_resolved_body-}"
                        fi
                        _dhpk_ci_fn_restore_live "$_dhpk_ci_paren"
                        if [ "${_dhpk_ci_fn_pkeep[$_dhpk_ci_paren]:-0}" != "1" ] && [ -n "$_dhpk_ci_fn_paren_name" ]; then
                            _dhpk_ci_fn_set_body "$_dhpk_ci_fn_paren_name" "$_dhpk_ci_fn_kept"
                        fi
                    elif [ "${_dhpk_ci_shfn_saved[$_dhpk_ci_paren]:-0}" = "1" ]; then
                        _dhpk_ci_fn_restore_live "$_dhpk_ci_paren"
                    fi
                    _dhpk_ci_cwd="${_dhpk_ci_cwd_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_cwd_state="${_dhpk_ci_state_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_allexport="${_dhpk_ci_allexport_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_git_env_sticky="${_dhpk_ci_sticky_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_lastpipe="${_dhpk_ci_lastpipe_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_rf_keep "${_dhpk_ci_rf_mark[$_dhpk_ci_paren]}"
                    _dhpk_ci_ifs_custom="${_dhpk_ci_ifs_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_ifs_stamp="${_dhpk_ci_paren_stamp[$_dhpk_ci_paren]}"
                    _dhpk_ci_grp_pop paren
                    _dhpk_ci_after_pipe=0
                    matched=1
                else
                    _dhpk_ci_last_group_cmd0=-1
                    matched=0
                fi
                if [ "$_dhpk_ci_any_cd" -eq 1 ] && { [ "$_dhpk_ci_case" -eq 1 ] || [ "$matched" -eq 0 ]; }; then
                    _dhpk_ci_cwd_state="unresolved"
                    _dhpk_ci_cwd=""
                fi
                DHPK_STRIPPED+=")"
                i=$((i + 1))
                continue
                ;;
            '>')
                if [ "$next" = "(" ]; then
                    _dhpk_ci_outps_saved_acc="${_dhpk_ci_outps_acc:-}"
                    _dhpk_ci_outps_saved_depth="${_dhpk_ci_outps_depth:-0}"
                    _dhpk_ci_outps_acc=""
                    _dhpk_ci_outps_depth=$((_dhpk_ci_outps_saved_depth + 1))
                    _dhpk_ci_ss_push
                    _dhpk_ci_list "" $((i + 2)) subst
                    _dhpk_ci_ss_pop
                    _dhpk_ci_outps_result="${_dhpk_ci_outps_acc:-}"
                    _dhpk_ci_outps_acc="$_dhpk_ci_outps_saved_acc"
                    _dhpk_ci_outps_depth="$_dhpk_ci_outps_saved_depth"
                    case "$_dhpk_ci_outps_result" in
                        feed|opaque) _dhpk_ci_outps_q+=("$_dhpk_ci_outps_result") ;;
                    esac
                    _dhpk_ci_wrap_subst ">("
                    _dhpk_ci_sub_word "$i" "$_dhpk_ci_end" "$_dhpk_ci_sub_stripped"
                    i="$_dhpk_ci_end"
                    continue
                fi
                _dhpk_ci_start_redirect
                case "$next" in
                    '>'|'|'|'&') ch+="$next" ;;
                esac
                DHPK_STRIPPED+="$ch"
                _dhpk_ci_seg+="$ch"
                i=$((i + ${#ch}))
                continue
                ;;
            '<')
                case "$next" in
                    '>')
                        _dhpk_ci_start_redirect
                        DHPK_STRIPPED+="<>"
                        _dhpk_ci_seg+="<>"
                        i=$((i + 2))
                        continue
                        ;;
                    '(')
                        _dhpk_ci_ps_text=""
                        _dhpk_ci_ps_known=0
                        _dhpk_ci_ss_push
                        _dhpk_ci_list "" $((i + 2)) subst
                        _dhpk_ci_ss_pop
                        _dhpk_ci_ps_hold=1
                        _dhpk_ci_ps_hold_text="${_dhpk_ci_ps_text:-}"
                        _dhpk_ci_ps_hold_known="${_dhpk_ci_ps_known:-0}"
                        _dhpk_ci_wrap_subst "<("
                        _dhpk_ci_sub_word "$i" "$_dhpk_ci_end" "$_dhpk_ci_sub_stripped"
                        i="$_dhpk_ci_end"
                        continue
                        ;;
                    '<')
                        _dhpk_ci_start_redirect
                        if [ "${_p:$((_o + 2)):1}" = "<" ]; then
                            # Here-string: the next word is stdin data.
                            _dhpk_ci_redir=2
                            ch="<<<"
                        else
                            _dhpk_ci_redir=0
                            ch="<<"
                            [ "${_p:$((_o + 2)):1}" = "-" ] && ch="<<-"
                            _dhpk_ci_hd_delim $((i + ${#ch}))
                            _dhpk_ci_hd_d+=("$_dhpk_ci_hd_word")
                            _dhpk_ci_hd_q+=("$_dhpk_ci_hd_quoted")
                            if [ "$ch" = "<<-" ]; then _dhpk_ci_hd_t+=(1); else _dhpk_ci_hd_t+=(0); fi
                            local _hl=$((_dhpk_ci_end - i))
                            if [ "$_hl" -le 257 ]; then
                                ch="${_p:$_o:$_hl}"
                            else
                                ch="${text:$i:$_hl}"
                            fi
                        fi
                        DHPK_STRIPPED+="$ch"
                        _dhpk_ci_seg+="$ch"
                        i=$((i + ${#ch}))
                        continue
                        ;;
                esac
                ;;
            '&')
                if [ "$next" = ">" ]; then
                    _dhpk_ci_start_redirect
                    ch="&>"
                    [ "${_p:$((_o + 2)):1}" = ">" ] && ch="&>>"
                    DHPK_STRIPPED+="$ch"
                    _dhpk_ci_seg+="$ch"
                    i=$((i + ${#ch}))
                    continue
                fi
                if [ "$next" = "&" ]; then
                    _dhpk_ci_flush_command and
                    DHPK_STRIPPED+="&&"
                    i=$((i + 2))
                else
                    _dhpk_ci_flush_command bg
                    DHPK_STRIPPED+="&"
                    i=$((i + 1))
                fi
                continue
                ;;
            '|')
                if [ "$next" = "|" ]; then
                    _dhpk_ci_flush_command or
                    DHPK_STRIPPED+="||"
                    i=$((i + 2))
                elif [ "$next" = "&" ]; then
                    _dhpk_ci_flush_command pipe
                    DHPK_STRIPPED+="|&"
                    i=$((i + 2))
                else
                    _dhpk_ci_flush_command pipe
                    DHPK_STRIPPED+="|"
                    i=$((i + 1))
                fi
                continue
                ;;
            '$')
                if _dhpk_ci_expand "$i" 0; then
                    _dhpk_ci_sub_word "$i" "$_dhpk_ci_end" "$_dhpk_ci_expand_stripped"
                    i="$_dhpk_ci_end"
                    continue
                fi
                _dhpk_ci_word_dyn=1
                if [ "$next" = '$' ]; then
                    # $$ is the PID parameter: the second $ cannot start a
                    # $'...' string, so a following quote is an ordinary one.
                    _dhpk_ci_word+="\$\$"
                    _dhpk_ci_word_flat+="\$\$"
                    _dhpk_ci_word_open=1
                    DHPK_STRIPPED+="\$\$"
                    _dhpk_ci_seg+="\$\$"
                    i=$((i + 2))
                    continue
                fi
                if [ "$next" = "'" ]; then
                    _dhpk_ci_ansi_end $((i + 2))
                    local _al=$((_dhpk_ci_ansi_close - i - 2)) _araw
                    if [ "$_al" -le 254 ]; then
                        _dhpk_ci_ansi_decode "${_p:$((_o + 2)):$_al}"
                        _araw="${_p:$_o:$((_al + 3))}"
                    else
                        _dhpk_ci_ansi_decode "${text:$((i + 2)):$_al}"
                        _araw="${text:$i:$((_al + 3))}"
                    fi
                    _dhpk_ci_word+="$_dhpk_ci_ansi_out"
                    _dhpk_ci_word_flat+="$_dhpk_ci_ansi_out"
                    _dhpk_ci_word_open=1
                    _dhpk_ci_word_q=1
                    DHPK_STRIPPED+="$_araw"
                    _dhpk_ci_seg+="$_araw"
                    i=$((_dhpk_ci_ansi_close + 1))
                    continue
                fi
                if [ "$next" = '"' ]; then
                    _dhpk_ci_mode="double"
                    _dhpk_ci_word_open=1
                    _dhpk_ci_word_q=1
                    DHPK_STRIPPED+="\$${next}"
                    _dhpk_ci_seg+="\$${next}"
                    i=$((i + 2))
                    continue
                fi
                _dhpk_ci_word_split=1
                ;;
            '`')
                _dhpk_ci_expand "$i" 0
                _dhpk_ci_sub_word "$i" "$_dhpk_ci_end" "$_dhpk_ci_expand_stripped"
                i="$_dhpk_ci_end"
                continue
                ;;
            '~')
                if [ -z "$_dhpk_ci_word" ]; then
                    _dhpk_ci_word_dyn=1
                fi
                ;;
        esac
        _dhpk_ci_word+="$ch"
        _dhpk_ci_word_flat+="$ch"
        _dhpk_ci_word_open=1
        DHPK_STRIPPED+="$ch"
        _dhpk_ci_seg+="$ch"
        i=$((i + 1))
    done
    _dhpk_ci_flush_command compound
    if [ "$_dhpk_ci_kind" = "subst" ]; then
        _dhpk_ci_ps_text="${_dhpk_ci_subst_text:-}"
        _dhpk_ci_ps_known="${_dhpk_ci_subst_known:-0}"
    fi
    if [ "$_dhpk_ci_kind" = "top" ] && [ "$_dhpk_ci_saw_shell_head" -eq 1 ] && [ "${#_dhpk_ci_all_hs_flat[@]}" -gt 0 ]; then
        # A here-string may reach a shell through a group or exec redirect.
        local _hs_all=("${_dhpk_ci_all_hs_flat[@]}") _hs_j=0
        _dhpk_ci_saw_shell_hs=1
        while [ "$_hs_j" -lt "${#_hs_all[@]}" ]; do
            [ -n "${_hs_all[$_hs_j]}" ] && _dhpk_ci_inspect_body_cwd "${_hs_all[$_hs_j]}" "" "unresolved"
            _hs_j=$((_hs_j + 1))
        done
    fi
    if [ "$_dhpk_ci_kind" = "top" ]; then
        _dhpk_ci_arith_resolve
    fi
    if [ "$_dhpk_ci_kind" = "top" ] && [ "${DHPK_GIT_COUNT:-0}" -gt 0 ]; then
        # A shell fed git text wins: an eval that only defined the shell
        # function must not soften the reason.
        if [ "${_dhpk_ci_saw_shell_feed:-0}" -eq 1 ]; then
            _dhpk_ci_unsupported "git fed to a shell"
        elif [ "$_dhpk_ci_saw_eval" -eq 1 ]; then
            _dhpk_ci_unsupported "git with eval"
        elif [ "$_dhpk_ci_saw_source" -eq 1 ]; then
            _dhpk_ci_unsupported "git with source"
        elif [ "$_dhpk_ci_saw_cd_dash" -eq 1 ]; then
            _dhpk_ci_unsupported "git with cd -"
        elif [ "$_dhpk_ci_saw_cdpath" -eq 1 ]; then
            _dhpk_ci_unsupported "git with CDPATH"
        elif [ "$_dhpk_ci_saw_shell_hs" -eq 1 ]; then
            _dhpk_ci_unsupported "git with here-string fed to shell"
        fi
    fi
    if [ "$_dhpk_ci_kind" != "top" ]; then
        _dhpk_ci_sub_stripped="$DHPK_STRIPPED"
    fi
    _dhpk_ci_end="$len"
    return 0
}
