#!/usr/bin/env bash
# command-inspect.sh — bounded command segments and git argv for hook gates.
# Source-only. bash 3.2. Never executes the command under inspection.
#
# Support boundary:
#   Compound separators are unquoted ';', '&&', '||', '&', and newlines.
#   An unquoted '#' at the start of a word starts a comment through the end
#   of that line. A '#' inside a word or inside quotes is data. A carriage
#   return is an ordinary character. Quoted words are single argv elements.
#   Quoting is decoded into each argv word: '...', "...", $'...' (ANSI-C
#   escapes such as \n, \xHH, \NNN and ASCII \uHHHH), $"...", backslashes
#   and concatenation, so g"i"t and $'\x67it' are both the word git. A word
#   with $'...' still counts as dynamic for -C and cd path resolution.
#   An unquoted >, >>, >|, >&, &>, &>> or <> (with an optional fd number)
#   is a redirect: its decoded target goes to DHPK_REDIRECT_TARGETS and is
#   not an argv word. Every command's decoded argv is kept in DHPK_WORDS,
#   indexed by DHPK_CMD_START and DHPK_CMD_LEN.
#   A git command is an argv whose first word is git, 'command git', or a
#   path whose basename is git, after leading VAR=value assignments.
#   Literal 'cd <path>' and 'git -C <path>' select the repository. Each -C is
#   applied in order; a relative -C starts from the directory already chosen.
#   A value of a known option (such as -m or --message) is not a flag.
#   A path containing '$', a backtick, '~', or a glob is unresolved. --git-dir,
#   --work-tree, an unknown global option, or 'cd' in the same pipeline also
#   leaves the repository unresolved. Unresolved does not fall back to the
#   session checkout. Reserved words (such as {, if, then, !, time) before
#   the command word are skipped.
#
#   Nested syntax (#1392):
#   - '(' and ')' are operators. A cd inside a subshell applies to the
#     subshell; after its ')' the directory is unresolved. '((' is
#     arithmetic when it closes with '))'.
#   - $(...), <(...), >(...) and backtick bodies are inspected as their own
#     command lists. Their raw text stays in the outer word, which is
#     dynamic. ${...}, $((...)) and $[...] are single units, so quotes, '>'
#     and '<<' inside them are not redirects or heredocs.
#   - A heredoc body (<<WORD, <<-WORD, quoted delimiters) is skipped up to
#     its delimiter line and never changes quote state. For cat and tee it
#     is data, and only the substitutions of an unquoted body are inspected;
#     any other body, or a cat body whose output can run as a command
#     (pipe, process substitution, FIFO, command position, eval or a shell),
#     is inspected as its own command list. A <<< word is stdin data.
#   - Syntax the decoder cannot place faithfully sets DHPK_UNSUPPORTED (for
#     example a case statement inside $(...)), and the hooks block it.

# dhpk_norm_path <base> <rel>
#   Lexical join. Does not touch the filesystem.
dhpk_norm_path() {
    dhpk_norm_path_var "$1" "$2"
    printf '%s' "$DHPK_NORM_PATH"
    return 0
}

# dhpk_norm_path_var <base> <rel>
#   dhpk_norm_path without a subshell: sets DHPK_NORM_PATH.
dhpk_norm_path_var() {
    local base="$1" rel="$2" path part out=""
    case "$rel" in
        /*) path="$rel" ;;
        *) path="${base%/}/$rel" ;;
    esac
    while [ -n "$path" ]; do
        part="${path%%/*}"
        case "$path" in
            */*) path="${path#*/}" ;;
            *) path="" ;;
        esac
        case "$part" in
            ""|.) ;;
            ..)
                case "$out" in
                    ""|/) out="/" ;;
                    *) out="${out%/*}"; [ -n "$out" ] || out="/" ;;
                esac
                ;;
            *) out+="/$part" ;;
        esac
    done
    [ -n "$out" ] || out="/"
    DHPK_NORM_PATH="$out"
    return 0
}

# Nested lists and ${...} scans recurse; deeper text is reported as
# unsupported instead of exhausting the bash stack.
DHPK_CI_MAX_DEPTH=64
_DHPK_CI_SIMPLE_STOP=$'\\\'"# \t\n;()><&|$`~=*?[]{}!'

# _dhpk_ci_make_pages
#   Splits `text` (length `len`) into overlapping 512-byte pages stepped by
#   256 bytes in _dhpk_ci_pg so per-character and short lookahead reads stay
#   O(1) without scanning strlen(text) on every ${text:$i:1}.
_dhpk_ci_make_pages() {
    _dhpk_ci_pg=()
    local _k=0 _j _c _cl
    while [ "$_k" -lt "$len" ]; do
        _c="${text:$_k:16640}"
        _cl="${#_c}"
        _j=0
        while [ "$_j" -lt "$_cl" ] && [ "$_j" -lt 16384 ]; do
            _dhpk_ci_pg+=("${_c:$_j:512}")
            _j=$((_j + 256))
        done
        _k=$((_k + 16384))
    done
}

_dhpk_ci_reset_words() {
    _dhpk_ci_words=()
    _dhpk_ci_dyn=()
    _dhpk_ci_quoted=()
    _dhpk_ci_words_flat=()
    _dhpk_ci_word=""
    _dhpk_ci_word_flat=""
    _dhpk_ci_word_dyn=0
    _dhpk_ci_word_q=0
    _dhpk_ci_hs_words=()
    _dhpk_ci_hs_dyn=()
    _dhpk_ci_hs_flat=()
}

_dhpk_ci_flush_word() {
    if [ -n "$_dhpk_ci_word" ] || [ "$_dhpk_ci_word_open" -eq 1 ]; then
        if [ "$_dhpk_ci_redir" -eq 1 ]; then
            DHPK_REDIRECT_TARGETS+=("$_dhpk_ci_word")
            _dhpk_ci_redir=0
        elif [ "$_dhpk_ci_redir" -eq 2 ]; then
            # A here-string word is stdin data, not argv, but shell/eval targets execute it.
            _dhpk_ci_hs_words+=("$_dhpk_ci_word")
            _dhpk_ci_hs_dyn+=("$_dhpk_ci_word_dyn")
            _dhpk_ci_hs_flat+=("$_dhpk_ci_word_flat")
            _dhpk_ci_redir=0
        else
            # A case pattern's ')' would end $(...) early and desync quotes.
            if [ "$_dhpk_ci_kind" = "subst" ] && [ "$_dhpk_ci_word" = "case" ]; then
                _dhpk_ci_head_index
                if [ "$_dhpk_ci_head" -eq "${#_dhpk_ci_words[@]}" ]; then
                    _dhpk_ci_unsupported "case statement inside a command substitution"
                fi
            fi
            _dhpk_ci_words+=("$_dhpk_ci_word")
            _dhpk_ci_dyn+=("$_dhpk_ci_word_dyn")
            _dhpk_ci_quoted+=("$_dhpk_ci_word_q")
            _dhpk_ci_words_flat+=("$_dhpk_ci_word_flat")
        fi
    fi
    _dhpk_ci_word=""
    _dhpk_ci_word_flat=""
    _dhpk_ci_word_dyn=0
    _dhpk_ci_word_open=0
    _dhpk_ci_word_q=0
}

# True when $1 is an option whose next argv is its value, not a new flag.
# Joined forms (--message=--dry-run, -m--no-verify) keep the value in $1.
_dhpk_ci_option_consumes_next() {
    case "$1" in
        -m|--message|-F|--file|--author|--date|--trailer|--cleanup|-t|--template|--fixup|--squash|--reuse-message|--reedit-message|--pathspec-from-file|-C|-c)
            return 0
            ;;
        -[a-zA-Z][mFCct]|-[a-zA-Z][a-zA-Z][mFCct])
            return 0
            ;;
    esac
    return 1
}

# True when $1 is a commit short option whose cluster has n before the first
# value-taking letter (m, F, C, c, t). Characters after that letter are the
# attached value, not flags. Long options are ignored; --no-verify is matched
# by the caller. Call only when the subcommand is commit.
_dhpk_ci_commit_short_no_verify() {
    case "$1" in
        --*) return 1 ;;
        -*) ;;
        *) return 1 ;;
    esac
    local cluster="${1#-}"
    local i=0
    local len="${#cluster}"
    local ch
    while [ "$i" -lt "$len" ]; do
        ch="${cluster:$i:1}"
        case "$ch" in
            n) return 0 ;;
            [mFCct]) return 1 ;;
            [A-Za-z]) ;;
            *) return 1 ;;
        esac
        i=$((i + 1))
    done
    return 1
}

_dhpk_ci_is_wrapper_word() {
    case "$1" in
        command|builtin|exec|time|*/time) return 0 ;;
        env|*/env|nice|*/nice|sudo|*/sudo|timeout|*/timeout|xargs|*/xargs|nohup|*/nohup|stdbuf|*/stdbuf|doas|*/doas) return 0 ;;
    esac
    return 1
}

_dhpk_ci_is_shell_word() {
    case "${1##*/}" in
        sh|bash|zsh|ksh|dash|ash|mksh|csh|tcsh|fish|busybox) return 0 ;;
    esac
    return 1
}

_dhpk_ci_is_git_env_var() {
    case "$1" in
        GIT_DIR=*|GIT_WORK_TREE=*|GIT_COMMON_DIR=*|GIT_INDEX_FILE=*|GIT_OBJECT_DIRECTORY=*|GIT_ALTERNATE_OBJECT_DIRECTORIES=*|GIT_CONFIG=*|GIT_CONFIG_PARAMETERS=*|GIT_CONFIG_COUNT=*|GIT_EXEC_PATH=*|GIT_NAMESPACE=*)
            return 0
            ;;
    esac
    return 1
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

_dhpk_ci_unwrap_head() {
    local k=0 n="${#_dhpk_ci_words[@]}" h="$_dhpk_ci_head"
    local assign_re='^[A-Za-z_][A-Za-z0-9_]*='
    local w base tok opt oi olen och consumed allow_assign=0
    local si sn split_arg split_dyn split_tail
    local -a _dhpk_ci_es_words _dhpk_ci_es_quoted _tail_w _tail_d _tail_q _tail_f
    local _dhpk_ci_es_dyn=0
    _dhpk_ci_u_words=()
    _dhpk_ci_u_dyn=()
    _dhpk_ci_u_quoted=()
    _dhpk_ci_u_flat=()
    _dhpk_ci_u_idx=0
    _dhpk_ci_u_head=""
    _dhpk_ci_u_cwd="$_dhpk_ci_cwd"
    _dhpk_ci_u_cwd_state="$_dhpk_ci_cwd_state"
    _dhpk_ci_u_chdir_set=0
    _dhpk_ci_u_query_only=0
    _dhpk_ci_u_quoted_wrapper=0
    _dhpk_ci_u_git_env_unresolved=0
    _dhpk_ci_u_cdpath=0
    _dhpk_ci_u_has_dyn_split=0
    _dhpk_ci_u_stop_fail=0
    _dhpk_ci_u_via_xargs=0
    _dhpk_ci_u_xrep=""
    _dhpk_ci_u_unsupported=""

    k=0
    while [ "$k" -lt "$h" ]; do
        w="${_dhpk_ci_words[$k]}"
        case "$w" in
            CDPATH=*|CDPATH+=*) _dhpk_ci_u_cdpath=1 ;;
        esac
        _dhpk_ci_is_git_env_var "$w" && _dhpk_ci_u_git_env_unresolved=1
        k=$((k + 1))
    done

    k="$h"
    while [ "$k" -lt "$n" ]; do
        _dhpk_ci_u_words+=("${_dhpk_ci_words[$k]}")
        _dhpk_ci_u_dyn+=("${_dhpk_ci_dyn[$k]}")
        _dhpk_ci_u_quoted+=("${_dhpk_ci_quoted[$k]}")
        _dhpk_ci_u_flat+=("${_dhpk_ci_words_flat[$k]}")
        k=$((k + 1))
    done

    k=0
    n="${#_dhpk_ci_u_words[@]}"
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        if [ "$allow_assign" -eq 1 ]; then
            case "$w" in
                *=*)
                    if [[ "$w" =~ $assign_re ]]; then
                        case "$w" in
                            CDPATH=*|CDPATH+=*) _dhpk_ci_u_cdpath=1 ;;
                        esac
                        _dhpk_ci_is_git_env_var "$w" && _dhpk_ci_u_git_env_unresolved=1
                        k=$((k + 1))
                        continue
                    fi
                    ;;
            esac
            allow_assign=0
        fi

        if [ "$w" = "busybox" ] || [ "${w##*/}" = "busybox" ]; then
            if [ $((k + 1)) -lt "$n" ]; then
                case "${_dhpk_ci_u_words[$((k + 1))]}" in
                    sh|ash)
                        [ "${_dhpk_ci_u_quoted[$k]}" = "1" ] && _dhpk_ci_u_quoted_wrapper=1
                        k=$((k + 1))
                        continue
                        ;;
                esac
            fi
            break
        fi

        _dhpk_ci_is_wrapper_word "$w" || break
        [ "${_dhpk_ci_u_quoted[$k]}" = "1" ] && _dhpk_ci_u_quoted_wrapper=1
        base="${w##*/}"
        case "$w" in
            command|builtin|exec|time) base="$w" ;;
        esac

        case "$base" in
            command)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=1
                            [ "$olen" -gt 0 ] || consumed=0
                            while [ "$oi" -lt "$olen" ]; do
                                case "${opt:$oi:1}" in
                                    p) ;;
                                    v|V) _dhpk_ci_u_query_only=1 ;;
                                    *) consumed=0; break ;;
                                esac
                                oi=$((oi + 1))
                            done
                            if [ "$consumed" -eq 0 ]; then
                                _dhpk_ci_u_stop_fail=1
                                break
                            fi
                            k=$((k + 1))
                            ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            builtin|nohup)
                k=$((k + 1))
                [ "$k" -lt "$n" ] && [ "${_dhpk_ci_u_words[$k]}" = "--" ] && k=$((k + 1))
                continue
                ;;
            exec)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    a)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    c|l) ;;
                                    *)
                                        _dhpk_ci_u_stop_fail=1
                                        consumed=2
                                        break
                                        ;;
                                esac
                                oi=$((oi + 1))
                            done
                            [ "$consumed" -eq 2 ] && break
                            [ "$consumed" -eq 0 ] && k=$((k + 1))
                            ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            time)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --verbose|--quiet|--append|-p|-v|-q|-a) k=$((k + 1)) ;;
                        --output|--format|-o|-f) k=$((k + 2)) ;;
                        --output=*|--format=*|-o?*|-f?*) k=$((k + 1)) ;;
                        -*) _dhpk_ci_u_stop_fail=1; break ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            nice)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        -n|--adjustment) k=$((k + 2)) ;;
                        --adjustment=*|-n?*) k=$((k + 1)) ;;
                        -[0-9]*|+[0-9]*)
                            case "${tok#?}" in
                                *[!0-9]*) _dhpk_ci_u_stop_fail=1; break ;;
                                *) k=$((k + 1)) ;;
                            esac
                            ;;
                        -*) _dhpk_ci_u_stop_fail=1; break ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            timeout)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        --verbose|--foreground|--preserve-status) k=$((k + 1)) ;;
                        --kill-after|--signal) k=$((k + 2)) ;;
                        --kill-after=*|--signal=*) k=$((k + 1)) ;;
                        --*) _dhpk_ci_u_stop_fail=1; break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    k|s)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    v) ;;
                                    *)
                                        _dhpk_ci_u_stop_fail=1
                                        consumed=2
                                        break
                                        ;;
                                esac
                                oi=$((oi + 1))
                            done
                            [ "$consumed" -eq 2 ] && break
                            [ "$consumed" -eq 0 ] && k=$((k + 1))
                            ;;
                        *) break ;;
                    esac
                done
                [ "$k" -lt "$n" ] && k=$((k + 1))
                continue
                ;;
            stdbuf)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        -i|-o|-e|--input|--output|--error) k=$((k + 2)) ;;
                        --input=*|--output=*|--error=*|-i?*|-o?*|-e?*) k=$((k + 1)) ;;
                        -*) _dhpk_ci_u_stop_fail=1; break ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            doas)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    u|C)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    L|n|s) ;;
                                    *)
                                        _dhpk_ci_u_stop_fail=1
                                        consumed=2
                                        break
                                        ;;
                                esac
                                oi=$((oi + 1))
                            done
                            [ "$consumed" -eq 2 ] && break
                            [ "$consumed" -eq 0 ] && k=$((k + 1))
                            ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            sudo)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        --user|--group|--close-from|--chroot|--command-timeout|--other-user|--host|--prompt|--role|--type)
                            k=$((k + 2)) ;;
                        --user=*|--group=*|--close-from=*|--chroot=*|--command-timeout=*|--other-user=*|--host=*|--prompt=*|--role=*|--type=*)
                            k=$((k + 1)) ;;
                        --chdir)
                            _dhpk_ci_apply_u_chdir "${_dhpk_ci_u_words[$((k + 1))]:-}" "${_dhpk_ci_u_dyn[$((k + 1))]:-1}"
                            k=$((k + 2)) ;;
                        --chdir=*)
                            _dhpk_ci_apply_u_chdir "${tok#--chdir=}" "${_dhpk_ci_u_dyn[$k]}"
                            k=$((k + 1)) ;;
                        --askpass|--background|--preserve-env|--edit|--set-home|--login|--reset-timestamp|--remove-timestamp|--list|--non-interactive|--preserve-groups|--stdin|--shell|--validate)
                            k=$((k + 1)) ;;
                        --*) _dhpk_ci_u_stop_fail=1; break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    D)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            _dhpk_ci_apply_u_chdir "${opt:$((oi + 1))}" "${_dhpk_ci_u_dyn[$k]}"
                                            k=$((k + 1))
                                        else
                                            _dhpk_ci_apply_u_chdir "${_dhpk_ci_u_words[$((k + 1))]:-}" "${_dhpk_ci_u_dyn[$((k + 1))]:-1}"
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    u|g|C|R|T|U|h|p|r|t)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    A|b|B|E|e|H|i|k|K|l|n|P|S|s|v|V) ;;
                                    *)
                                        _dhpk_ci_u_stop_fail=1
                                        consumed=2
                                        break
                                        ;;
                                esac
                                oi=$((oi + 1))
                            done
                            [ "$consumed" -eq 2 ] && break
                            [ "$consumed" -eq 0 ] && k=$((k + 1))
                            ;;
                        *) break ;;
                    esac
                done
                allow_assign=1
                continue
                ;;
            xargs)
                _dhpk_ci_u_via_xargs=1
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        --null|--no-run-if-empty|--verbose|--interactive|--exit|--open-tty|--show-limits)
                            k=$((k + 1)) ;;
                        --max-args|--max-chars|--max-procs|--delimiter|--arg-file)
                            k=$((k + 2)) ;;
                        --replace=*) _dhpk_ci_u_xrep="${tok#--replace=}"; k=$((k + 1)) ;;
                        --max-args=*|--max-chars=*|--max-procs=*|--delimiter=*|--arg-file=*|--eof=*|--max-lines=*)
                            k=$((k + 1)) ;;
                        --replace) _dhpk_ci_u_xrep="{}"; k=$((k + 1)) ;;
                        --eof|--max-lines)
                            k=$((k + 1)) ;;
                        --*) _dhpk_ci_u_stop_fail=1; break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    n|L|s|P|I|J|d|E|a)
                                        if [ "$och" = "I" ]; then
                                            _dhpk_ci_u_xrep="${opt:$((oi + 1))}"
                                            [ -n "$_dhpk_ci_u_xrep" ] || _dhpk_ci_u_xrep="${_dhpk_ci_u_words[$((k + 1))]:-}"
                                        fi
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    i|e|l)
                                        if [ "$och" = "i" ]; then
                                            _dhpk_ci_u_xrep="${opt:$((oi + 1))}"
                                            [ -n "$_dhpk_ci_u_xrep" ] || _dhpk_ci_u_xrep="{}"
                                        fi
                                        k=$((k + 1))
                                        consumed=1
                                        break
                                        ;;
                                    0|r|t|p|x|o) ;;
                                    *)
                                        _dhpk_ci_u_stop_fail=1
                                        consumed=2
                                        break
                                        ;;
                                esac
                                oi=$((oi + 1))
                            done
                            [ "$consumed" -eq 2 ] && break
                            [ "$consumed" -eq 0 ] && k=$((k + 1))
                            ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            env)
                k=$((k + 1))
                split_tail=0
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    split_arg=""
                    split_dyn=0
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        -) k=$((k + 1)); continue ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        --ignore-environment|--null|--debug|--list-signal-handling) k=$((k + 1)) ;;
                        --unset=*|--argv0=*|--block-signal=*|--default-signal=*|--ignore-signal=*|--block-signal|--default-signal|--ignore-signal)
                            k=$((k + 1)) ;;
                        --unset|--argv0) k=$((k + 2)) ;;
                        --chdir)
                            _dhpk_ci_apply_u_chdir "${_dhpk_ci_u_words[$((k + 1))]:-}" "${_dhpk_ci_u_dyn[$((k + 1))]:-1}"
                            k=$((k + 2)) ;;
                        --chdir=*)
                            _dhpk_ci_apply_u_chdir "${tok#--chdir=}" "${_dhpk_ci_u_dyn[$k]}"
                            k=$((k + 1)) ;;
                        --split-string)
                            split_arg="${_dhpk_ci_u_words[$((k + 1))]:-}"
                            split_dyn="${_dhpk_ci_u_dyn[$((k + 1))]:-1}"
                            k=$((k + 2))
                            ;;
                        --split-string=*)
                            split_arg="${tok#--split-string=}"
                            split_dyn="${_dhpk_ci_u_dyn[$k]}"
                            k=$((k + 1))
                            ;;
                        --*) _dhpk_ci_u_stop_fail=1; break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    S)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            split_arg="${opt:$((oi + 1))}"
                                            split_dyn="${_dhpk_ci_u_dyn[$k]}"
                                            k=$((k + 1))
                                        else
                                            split_arg="${_dhpk_ci_u_words[$((k + 1))]:-}"
                                            split_dyn="${_dhpk_ci_u_dyn[$((k + 1))]:-1}"
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    C)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            _dhpk_ci_apply_u_chdir "${opt:$((oi + 1))}" "${_dhpk_ci_u_dyn[$k]}"
                                            k=$((k + 1))
                                        else
                                            _dhpk_ci_apply_u_chdir "${_dhpk_ci_u_words[$((k + 1))]:-}" "${_dhpk_ci_u_dyn[$((k + 1))]:-1}"
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    u|a)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    i|0|v) ;;
                                    *)
                                        _dhpk_ci_u_stop_fail=1
                                        consumed=2
                                        break
                                        ;;
                                esac
                                oi=$((oi + 1))
                            done
                            if [ "$consumed" -eq 2 ]; then
                                break
                            fi
                            if [ "$consumed" -eq 0 ]; then
                                k=$((k + 1))
                            fi
                            ;;
                        *) break ;;
                    esac
                    if [ -n "$split_arg" ] || [ "$split_dyn" -eq 1 ]; then
                        _dhpk_ci_env_split_tokenize "$split_arg" "$split_dyn"
                        [ "$_dhpk_ci_es_dyn" -eq 1 ] && _dhpk_ci_u_has_dyn_split=1
                        si=0
                        sn="${#_dhpk_ci_es_words[@]}"
                        while [ "$si" -lt "$sn" ]; do
                            tok="${_dhpk_ci_es_words[$si]}"
                            case "$tok" in
                                --) si=$((si + 1)); break ;;
                                -) si=$((si + 1)); continue ;;
                                --ignore-environment|--null|--debug|--list-signal-handling|--unset=*|--argv0=*|--block-signal*|--default-signal*|--ignore-signal*)
                                    si=$((si + 1)) ;;
                                --unset|--argv0) si=$((si + 2)) ;;
                                --chdir)
                                    _dhpk_ci_apply_u_chdir "${_dhpk_ci_es_words[$((si + 1))]:-}" "$_dhpk_ci_es_dyn"
                                    si=$((si + 2)) ;;
                                --chdir=*)
                                    _dhpk_ci_apply_u_chdir "${tok#--chdir=}" "$_dhpk_ci_es_dyn"
                                    si=$((si + 1)) ;;
                                -*)
                                    opt="${tok#-}"
                                    oi=0
                                    olen="${#opt}"
                                    consumed=0
                                    while [ "$oi" -lt "$olen" ]; do
                                        och="${opt:$oi:1}"
                                        case "$och" in
                                            C)
                                                if [ $((oi + 1)) -lt "$olen" ]; then
                                                    _dhpk_ci_apply_u_chdir "${opt:$((oi + 1))}" "$_dhpk_ci_es_dyn"
                                                    si=$((si + 1))
                                                else
                                                    _dhpk_ci_apply_u_chdir "${_dhpk_ci_es_words[$((si + 1))]:-}" "$_dhpk_ci_es_dyn"
                                                    si=$((si + 2))
                                                fi
                                                consumed=1
                                                break
                                                ;;
                                            u|a|S)
                                                if [ "$och" = "S" ]; then
                                                    _dhpk_ci_u_has_dyn_split=1
                                                fi
                                                if [ $((oi + 1)) -lt "$olen" ]; then
                                                    si=$((si + 1))
                                                else
                                                    si=$((si + 2))
                                                fi
                                                consumed=1
                                                break
                                                ;;
                                            i|0|v) ;;
                                            *)
                                                _dhpk_ci_u_stop_fail=1
                                                consumed=2
                                                break
                                                ;;
                                        esac
                                        oi=$((oi + 1))
                                    done
                                    [ "$consumed" -eq 2 ] && break
                                    [ "$consumed" -eq 0 ] && si=$((si + 1))
                                    ;;
                                *=*)
                                    if [[ "$tok" =~ $assign_re ]]; then
                                        case "$tok" in
                                            CDPATH=*|CDPATH+=*) _dhpk_ci_u_cdpath=1 ;;
                                        esac
                                        _dhpk_ci_is_git_env_var "$tok" && _dhpk_ci_u_git_env_unresolved=1
                                        si=$((si + 1))
                                    else
                                        break
                                    fi
                                    ;;
                                *) break ;;
                            esac
                        done
                        if [ "$si" -gt "$sn" ]; then
                            # An option at the end of the split string takes the
                            # next outer word, as env does; its value is unknown.
                            k=$((k + si - sn))
                            _dhpk_ci_apply_u_chdir "" 1
                            si="$sn"
                        fi
                        while [ "$si" -lt "$sn" ]; do
                            tok="${_dhpk_ci_es_words[$si]}"
                            case "$tok" in
                                *=*)
                                    if [[ "$tok" =~ $assign_re ]]; then
                                        case "$tok" in
                                            CDPATH=*|CDPATH+=*) _dhpk_ci_u_cdpath=1 ;;
                                        esac
                                        _dhpk_ci_is_git_env_var "$tok" && _dhpk_ci_u_git_env_unresolved=1
                                        si=$((si + 1))
                                        continue
                                    fi
                                    ;;
                            esac
                            break
                        done
                        if [ "$si" -lt "$sn" ]; then
                            _tail_w=()
                            _tail_d=()
                            _tail_q=()
                            _tail_f=()
                            while [ "$si" -lt "$sn" ]; do
                                _tail_w+=("${_dhpk_ci_es_words[$si]}")
                                _tail_d+=("$_dhpk_ci_es_dyn")
                                _tail_q+=(0)
                                _tail_f+=("${_dhpk_ci_es_words[$si]}")
                                si=$((si + 1))
                            done
                            while [ "$k" -lt "$n" ]; do
                                _tail_w+=("${_dhpk_ci_u_words[$k]}")
                                _tail_d+=("${_dhpk_ci_u_dyn[$k]}")
                                _tail_q+=("${_dhpk_ci_u_quoted[$k]}")
                                _tail_f+=("${_dhpk_ci_u_flat[$k]}")
                                k=$((k + 1))
                            done
                            _dhpk_ci_u_words=(${_tail_w[@]+"${_tail_w[@]}"})
                            _dhpk_ci_u_dyn=(${_tail_d[@]+"${_tail_d[@]}"})
                            _dhpk_ci_u_quoted=(${_tail_q[@]+"${_tail_q[@]}"})
                            _dhpk_ci_u_flat=(${_tail_f[@]+"${_tail_f[@]}"})
                            k=0
                            n="${#_dhpk_ci_u_words[@]}"
                            split_tail=1
                            break
                        fi
                    fi
                done
                [ "$split_tail" -eq 1 ] && continue
                allow_assign=1
                continue
                ;;
        esac
    done

    _dhpk_ci_u_idx="$k"
    if [ "$k" -lt "$n" ]; then
        _dhpk_ci_u_head="${_dhpk_ci_u_words[$k]}"
    fi

    if [ "$_dhpk_ci_u_via_xargs" -eq 1 ] && [ "$k" -ge "$n" ] && [ "$n" -gt 1 ]; then
        _dhpk_ci_u_unsupported="xargs supplies the wrapped command"
    fi
    local _scan_reason="" _scan_k="$k"
    case "$_dhpk_ci_u_head" in
        git|*/git)
            [ "$_dhpk_ci_u_quoted_wrapper" -eq 1 ] && _dhpk_ci_u_unsupported="quoted wrapper before git"
            ;;
        *)
            if [ "$_dhpk_ci_u_stop_fail" -eq 1 ]; then
                _scan_reason="wrapper with unmodelled options before git"
            elif [ "$k" -lt "$n" ] && [ "${_dhpk_ci_u_dyn[$k]}" = "1" ]; then
                _scan_reason="dynamic command word before git"
            else
                case "${_dhpk_ci_u_head##*/}" in
                    setsid|ionice|chrt|flock|taskset|strace|ltrace|script|unshare|nsenter|chroot|runuser|parallel|numactl|fakeroot|busybox|systemd-run|watch|xvfb-run|dbus-run-session|firejail|unbuffer|eatmydata|faketime|prlimit|pkexec|su)
                        _scan_reason="unmodelled wrapper before git" ;;
                    find)
                        case " ${_dhpk_ci_u_words[*]} " in
                            *" -exec "*|*" -execdir "*|*" -ok "*|*" -okdir "*) _scan_reason="find -exec with git" ;;
                        esac
                        ;;
                esac
            fi
            while [ -n "$_scan_reason" ] && [ "$_scan_k" -lt "$n" ]; do
                case "${_dhpk_ci_u_words[$_scan_k]}" in
                    git|*/git|git\ *|*/git\ *) _dhpk_ci_u_unsupported="$_scan_reason"; break ;;
                esac
                _scan_k=$((_scan_k + 1))
            done
            ;;
    esac

    if [ "$_dhpk_ci_u_has_dyn_split" -eq 1 ] && [ -z "$_dhpk_ci_u_unsupported" ]; then
        case "$_dhpk_ci_u_head" in
            git|*/git) _dhpk_ci_u_unsupported="dynamic env -S with git" ;;
            *)
                local _scan_k="$k"
                while [ "$_scan_k" -lt "$n" ]; do
                    case "${_dhpk_ci_u_words[$_scan_k]}" in
                        git|*/git) _dhpk_ci_u_unsupported="dynamic env -S with git"; break ;;
                    esac
                    _scan_k=$((_scan_k + 1))
                done
                ;;
        esac
    fi
}

_dhpk_ci_record_git() {
    [ "$_dhpk_ci_u_query_only" -eq 0 ] || return 0
    local i="$_dhpk_ci_u_idx" n="${#_dhpk_ci_u_words[@]}" sub="" state="cwd"
    local repo="$_dhpk_ci_u_cwd" c_path="" c_base="" no_verify=0 exempt=0
    local word dyn
    [ "$i" -lt "$n" ] || return 0
    word="${_dhpk_ci_u_words[$i]}"
    case "$word" in
        git|*/git) ;;
        *) return 0 ;;
    esac
    i=$((i + 1))
    while [ "$i" -lt "$n" ]; do
        word="${_dhpk_ci_u_words[$i]}"
        dyn="${_dhpk_ci_u_dyn[$i]}"
        case "$word" in
            --) i=$((i + 1)); break ;;
            --help|-h|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks)
                [ "$word" = "--help" ] || [ "$word" = "-h" ] && exempt=1
                i=$((i + 1))
                ;;
            -p|-P) i=$((i + 1)) ;;
            -C)
                i=$((i + 1))
                if [ "$i" -ge "$n" ] || [ "${_dhpk_ci_u_dyn[$i]}" = "1" ]; then
                    state="unresolved"
                else
                    [ -n "$c_base" ] || c_base="$_dhpk_ci_u_cwd"
                    dhpk_norm_path_var "$c_base" "${_dhpk_ci_u_words[$i]}"
                    c_base="$DHPK_NORM_PATH"
                    c_path="$c_base"
                fi
                i=$((i + 1))
                ;;
            -C*)
                if [ "$dyn" = "1" ]; then
                    state="unresolved"
                else
                    [ -n "$c_base" ] || c_base="$_dhpk_ci_u_cwd"
                    dhpk_norm_path_var "$c_base" "${word#-C}"
                    c_base="$DHPK_NORM_PATH"
                    c_path="$c_base"
                fi
                i=$((i + 1))
                ;;
            --git-dir|--work-tree|--exec-path|--namespace|--super-prefix|--config-env|--list-cmds|-c)
                state="unresolved"
                i=$((i + 1))
                [ "$i" -lt "$n" ] && i=$((i + 1))
                ;;
            --git-dir=*|--work-tree=*|--exec-path=*|--namespace=*|--super-prefix=*|--config-env=*|--list-cmds=*|-c*)
                state="unresolved"
                i=$((i + 1))
                ;;
            -*)
                state="unresolved"
                i=$((i + 1))
                ;;
            *) break ;;
        esac
    done
    if [ "$i" -lt "$n" ]; then
        sub="${_dhpk_ci_u_words[$i]}"
        # A subcommand built by an expansion cannot be judged.
        if [ "${_dhpk_ci_u_dyn[$i]}" = "1" ]; then
            sub="commit"
            state="unresolved"
        fi
    fi
    if [ "$_dhpk_ci_u_via_xargs" -eq 1 ]; then
        # xargs may supply the subcommand, flags or directory from stdin.
        local xj="$((_dhpk_ci_u_idx + 1))" xrep="${_dhpk_ci_u_xrep:-{\}}"
        while [ "$xj" -lt "$n" ]; do
            case "${_dhpk_ci_u_words[$xj]}" in
                *"$xrep"*|*'{}'*)
                    state="unresolved"
                    [ "$xj" -eq "$i" ] && sub="commit"
                    ;;
            esac
            xj=$((xj + 1))
        done
        [ -n "$sub" ] || { sub="commit"; state="unresolved"; }
        [ -n "$c_path" ] && state="unresolved"
        [ "$_dhpk_ci_u_chdir_set" -eq 1 ] && state="unresolved"
    fi
    [ -n "$sub" ] || return 0
    local j="$((_dhpk_ci_u_idx + 1))"
    while [ "$j" -lt "$n" ]; do
        word="${_dhpk_ci_u_words[$j]}"
        case "$word" in
            --no-verify|--no-verify=*) no_verify=1 ;;
            --help|-h|--dry-run|--abort|--continue|--skip|--quit) exempt=1 ;;
        esac
        if [ "$sub" = "commit" ] && _dhpk_ci_commit_short_no_verify "$word"; then
            no_verify=1
        fi
        if _dhpk_ci_option_consumes_next "$word"; then
            j=$((j + 2))
        else
            j=$((j + 1))
        fi
    done
    if [ "$_dhpk_ci_u_via_xargs" -eq 1 ]; then
        case "$sub" in commit|push|merge|rebase|cherry-pick|am) no_verify=2; state="unresolved" ;; esac
    fi
    if [ "$_dhpk_ci_pipeline_cd" -eq 1 ] || [ "$_dhpk_ci_u_cwd_state" != "literal" ] || [ "$_dhpk_ci_u_git_env_unresolved" -eq 1 ]; then
        state="unresolved"
    fi
    if [ "$state" != "unresolved" ] && [ -n "$c_path" ]; then
        dhpk_norm_path_var "$_dhpk_ci_u_cwd" "$c_path"
        repo="$DHPK_NORM_PATH"
        state="literal"
    elif [ "$state" != "unresolved" ] && [ "$_dhpk_ci_u_chdir_set" -eq 1 ]; then
        repo="$_dhpk_ci_u_cwd"
        state="literal"
    elif [ "$state" != "unresolved" ]; then
        repo="$_dhpk_ci_u_cwd"
        state="cwd"
    else
        repo=""
    fi
    DHPK_GIT_SUB[$DHPK_GIT_COUNT]="$sub"
    DHPK_GIT_REPO[$DHPK_GIT_COUNT]="$repo"
    DHPK_GIT_REPO_STATE[$DHPK_GIT_COUNT]="$state"
    DHPK_GIT_NO_VERIFY[$DHPK_GIT_COUNT]="$no_verify"
    DHPK_GIT_EXEMPT[$DHPK_GIT_COUNT]="$exempt"
    DHPK_GIT_SEGMENT[$DHPK_GIT_COUNT]="$_dhpk_ci_seg"
    DHPK_GIT_COUNT=$((DHPK_GIT_COUNT + 1))
}

# _dhpk_ci_head_index
#   Sets _dhpk_ci_head to the index of the command word in _dhpk_ci_words,
#   after reserved words (such as {, if, then, !, time -p) and VAR=value
#   assignments. Equals the word count when there is no command word.
#   A reserved word counts only when unquoted and before any assignment, as
#   in bash; _dhpk_ci_head_kw is 1 when the head word itself could be one.
_dhpk_ci_head_index() {
    local h=0 n="${#_dhpk_ci_words[@]}" assigned=0
    while [ "$h" -lt "$n" ]; do
        if [ "$assigned" -eq 0 ] && [ "${_dhpk_ci_quoted[$h]}" = "0" ]; then
            case "${_dhpk_ci_words[$h]}" in
                '!'|'{'|if|then|else|elif|do|while|until|coproc) h=$((h + 1)); continue ;;
                time)
                    [ "${_dhpk_ci_words[$((h + 1))]:-}" = "-p" ] && h=$((h + 1))
                    [ "${_dhpk_ci_words[$((h + 1))]:-}" = "--" ] && h=$((h + 1))
                    h=$((h + 1))
                    continue
                    ;;
            esac
        fi
        case "${_dhpk_ci_words[$h]}" in
            *=*) assigned=1 ;;
            *) break ;;
        esac
        h=$((h + 1))
    done
    _dhpk_ci_head="$h"
    _dhpk_ci_head_kw=0
    if [ "$h" -lt "$n" ] && [ "$assigned" -eq 0 ] && [ "${_dhpk_ci_quoted[$h]}" = "0" ]; then
        _dhpk_ci_head_kw=1
    fi
}

# _dhpk_ci_grp_push <kind> <cmd0> <pipe_id>
#   Pushes an open compound group (subshell, brace, if, loop, case) so its
#   commands can be linked if the group feeds or sits inside a pipeline.
_dhpk_ci_grp_push() {
    _dhpk_ci_grp_kind[$_dhpk_ci_grp_depth]="$1"
    _dhpk_ci_grp_cmd0[$_dhpk_ci_grp_depth]="$2"
    _dhpk_ci_grp_pipe[$_dhpk_ci_grp_depth]="$3"
    _dhpk_ci_grp_depth=$((_dhpk_ci_grp_depth + 1))
}

# _dhpk_ci_grp_pop <kind>
#   Closes the innermost open group matching <kind>, setting
#   _dhpk_ci_last_group_cmd0 and restoring _dhpk_ci_pipe_id to that group's
#   enclosing pipeline id. Unmatched closers clear _dhpk_ci_last_group_cmd0.
_dhpk_ci_grp_pop() {
    local idx=$((_dhpk_ci_grp_depth - 1))
    while [ "$idx" -ge 0 ]; do
        if [ "${_dhpk_ci_grp_kind[$idx]}" = "$1" ]; then
            _dhpk_ci_last_group_cmd0="${_dhpk_ci_grp_cmd0[$idx]}"
            _dhpk_ci_pipe_id="${_dhpk_ci_grp_pipe[$idx]}"
            _dhpk_ci_grp_depth="$idx"
            return 0
        fi
        idx=$((idx - 1))
    done
    _dhpk_ci_last_group_cmd0=-1
    return 1
}

# _dhpk_ci_unify_pipe <cmd0> <target_pid>
#   Assigns <target_pid> across [cmd0..end), unifying unpiped and nested-pipe
#   commands inside a LHS compound group with the enclosing pipeline.
_dhpk_ci_unify_pipe() {
    local k="$1" target="$2" end="${#DHPK_CMD_PIPE_ID[@]}"
    while [ "$k" -lt "$end" ]; do
        DHPK_CMD_PIPE_ID[$k]="$target"
        k=$((k + 1))
    done
}

# _dhpk_ci_flush_command <sep>
#   sep is the separator that ends the command: compound (; newline ( ) or
#   the end), and (&&), or (||), bg (&) or pipe (| |&).
_dhpk_ci_inspect_body_cwd() {
    local _dhpk_ci_cwd="$2" _dhpk_ci_cwd_state="$3"
    _dhpk_ci_list "$1" 0 body
}

_dhpk_ci_extract_shell_c() {
    local k="$1" n="${#_dhpk_ci_u_words[@]}" saw_c=0 w opt oi olen skip_ops fallback=-1
    _dhpk_ci_shell_c_payload=""
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            --|-) k=$((k + 1)); break ;;
            --rcfile|--init-file|--startup-cmd) k=$((k + 2)) ;;
            --*) k=$((k + 1)) ;;
            [-+]*)
                opt="${w#[-+]}"
                oi=0
                olen="${#opt}"
                skip_ops=0
                while [ "$oi" -lt "$olen" ]; do
                    case "${opt:$oi:1}" in
                        c) saw_c=1 ;;
                        o|O) skip_ops=$((skip_ops + 1)) ;;
                    esac
                    oi=$((oi + 1))
                done
                # A cluster such as -oc takes the next word as the option
                # name; inspect it as the script when nothing follows (fail closed).
                [ "$saw_c" -eq 1 ] && [ "$skip_ops" -gt 0 ] && [ "$fallback" -lt 0 ] && fallback=$((k + 1))
                k=$((k + 1 + skip_ops))
                ;;
            *) break ;;
        esac
    done
    if [ "$saw_c" -eq 1 ] && [ "$k" -lt "$n" ]; then
        _dhpk_ci_shell_c_payload="${_dhpk_ci_u_flat[$k]}"
    elif [ "$saw_c" -eq 1 ] && [ "$fallback" -ge 0 ] && [ "$fallback" -lt "$n" ]; then
        _dhpk_ci_shell_c_payload="${_dhpk_ci_u_flat[$fallback]}"
    fi
}

_dhpk_ci_flush_command() {
    local sep="$1" n h head k cond kwhead="" git_has_c cmd_idx="${#DHPK_CMD_START[@]}"
    local -a _dhpk_ci_u_words _dhpk_ci_u_dyn _dhpk_ci_u_quoted _dhpk_ci_u_flat
    local _dhpk_ci_u_idx=0 _dhpk_ci_u_head="" _dhpk_ci_u_cwd="$_dhpk_ci_cwd" _dhpk_ci_u_cwd_state="$_dhpk_ci_cwd_state"
    local _dhpk_ci_u_chdir_set=0 _dhpk_ci_u_query_only=0 _dhpk_ci_u_quoted_wrapper=0
    local _dhpk_ci_u_git_env_unresolved=0 _dhpk_ci_u_cdpath=0 _dhpk_ci_u_has_dyn_split=0 _dhpk_ci_u_stop_fail=0 _dhpk_ci_u_via_xargs=0 _dhpk_ci_u_xrep="" _dhpk_ci_u_unsupported=""
    local _dhpk_ci_shell_c_payload="" _eval_payload="" _hs_i=0 _git_before=0 _cd_i=0 _cd_opts=1 _cd_w="" _cd_is_dash=0
    _dhpk_ci_flush_word
    _dhpk_ci_redir=0
    n="${#_dhpk_ci_words[@]}"
    head=""
    if [ "$n" -eq 0 ] && [ "${#_dhpk_ci_hs_flat[@]}" -gt 0 ]; then
        _dhpk_ci_all_hs_flat+=("${_dhpk_ci_hs_flat[@]}")
    fi
    if [ "$n" -gt 0 ]; then
        _dhpk_ci_last_group_cmd0=-1
        _dhpk_ci_head_index
        h="$_dhpk_ci_head"
        [ "$h" -lt "$n" ] && head="${_dhpk_ci_words[$h]}"
        DHPK_CMD_START+=("${#DHPK_WORDS[@]}")
        DHPK_CMD_LEN+=("$n")
        DHPK_CMD_PIPE_ID+=("$_dhpk_ci_pipe_id")
        DHPK_WORDS+=("${_dhpk_ci_words[@]}")
        if [ "$_dhpk_ci_cwd_state" = "literal" ]; then
            DHPK_CMD_CWD+=("$_dhpk_ci_cwd")
        else
            DHPK_CMD_CWD+=("")
        fi
        _dhpk_ci_unwrap_head
        [ -n "$_dhpk_ci_u_unsupported" ] && _dhpk_ci_unsupported "$_dhpk_ci_u_unsupported"
        [ "$_dhpk_ci_u_cdpath" -eq 1 ] && _dhpk_ci_saw_cdpath=1
        if [[ "$_dhpk_ci_seg" == *'${CDPATH'* ]]; then
            _dhpk_ci_saw_cdpath=1
        else
            case "$_dhpk_ci_u_head" in
                printf|read|map?ile|readarray|declare|export|local|typeset|readonly)
                    [[ "${_dhpk_ci_words_flat[*]}" == *CDPATH* ]] && _dhpk_ci_saw_cdpath=1
                    ;;
            esac
        fi
        case "$_dhpk_ci_u_head" in
            eval|source|'.') _dhpk_ci_saw_shell_head=1 ;;
            *)
                if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head" || [ "${_dhpk_ci_u_dyn[$_dhpk_ci_u_idx]:-0}" = "1" ]; then
                    _dhpk_ci_saw_shell_head=1
                fi
                ;;
        esac
        # A here-string attached to a group or to a bare exec redirect may feed a shell.
        if [ "${#_dhpk_ci_hs_flat[@]}" -gt 0 ] && { [ -z "$_dhpk_ci_u_head" ] || case "$_dhpk_ci_u_head" in "}"|"done"|"fi"|"esac") true ;; *) false ;; esac; }; then
            _dhpk_ci_all_hs_flat+=("${_dhpk_ci_hs_flat[@]}")
        fi
        if [ "$_dhpk_ci_u_query_only" -eq 0 ]; then
            case "$_dhpk_ci_u_head" in
                export|declare|typeset|local|readonly)
                    k=$((_dhpk_ci_u_idx + 1))
                    while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
                        case "${_dhpk_ci_u_words[$k]}" in
                            CDPATH|CDPATH=*|CDPATH+=*) _dhpk_ci_saw_cdpath=1; break ;;
                        esac
                        k=$((k + 1))
                    done
                    ;;
            esac
        fi
        _dhpk_ci_record_git
        _git_before="$DHPK_GIT_COUNT"
        if [ "$_dhpk_ci_u_query_only" -eq 0 ]; then
            case "$_dhpk_ci_u_head" in
                eval)
                    _dhpk_ci_saw_eval=1
                    k=$((_dhpk_ci_u_idx + 1))
                    if [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ] && [ "${_dhpk_ci_u_words[$k]}" = "--" ]; then
                        k=$((k + 1))
                    fi
                    _eval_payload=""
                    while [ "$k" -lt "${#_dhpk_ci_u_flat[@]}" ]; do
                        if [ -n "$_eval_payload" ]; then
                            _eval_payload+=" ${_dhpk_ci_u_flat[$k]}"
                        else
                            _eval_payload="${_dhpk_ci_u_flat[$k]}"
                        fi
                        k=$((k + 1))
                    done
                    if [ -n "$_eval_payload" ]; then
                        _dhpk_ci_inspect_body_cwd "$_eval_payload" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                    fi
                    _hs_i=0
                    while [ "$_hs_i" -lt "${#_dhpk_ci_hs_flat[@]}" ]; do
                        if [ -n "${_dhpk_ci_hs_flat[$_hs_i]}" ]; then
                            _dhpk_ci_inspect_body_cwd "${_dhpk_ci_hs_flat[$_hs_i]}" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                        fi
                        _hs_i=$((_hs_i + 1))
                    done
                    ;;
                source|'.')
                    _dhpk_ci_saw_source=1
                    _hs_i=0
                    while [ "$_hs_i" -lt "${#_dhpk_ci_hs_flat[@]}" ]; do
                        if [ -n "${_dhpk_ci_hs_flat[$_hs_i]}" ]; then
                            _dhpk_ci_inspect_body_cwd "${_dhpk_ci_hs_flat[$_hs_i]}" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                        fi
                        _hs_i=$((_hs_i + 1))
                    done
                    ;;
                *)
                    if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head"; then
                        if [ "${#_dhpk_ci_hs_words[@]}" -gt 0 ]; then
                            _dhpk_ci_saw_shell_hs=1
                            _hs_i=0
                            while [ "$_hs_i" -lt "${#_dhpk_ci_hs_flat[@]}" ]; do
                                if [ -n "${_dhpk_ci_hs_flat[$_hs_i]}" ]; then
                                    _dhpk_ci_inspect_body_cwd "${_dhpk_ci_hs_flat[$_hs_i]}" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                                fi
                                _hs_i=$((_hs_i + 1))
                            done
                        fi
                        _dhpk_ci_extract_shell_c $((_dhpk_ci_u_idx + 1))
                        if [ -n "$_dhpk_ci_shell_c_payload" ] && ! dhpk_command_is_trivial "$_dhpk_ci_shell_c_payload"; then
                            if [ "$_dhpk_ci_u_via_xargs" -eq 1 ]; then
                                _dhpk_ci_inspect_body_cwd "$_dhpk_ci_shell_c_payload" "" "unresolved"
                            else
                                _dhpk_ci_inspect_body_cwd "$_dhpk_ci_shell_c_payload" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                            fi
                        fi
                    elif [ "${#_dhpk_ci_hs_flat[@]}" -gt 0 ]; then
                        if [ "$_dhpk_ci_xctx" -eq 1 ] || [ "$DHPK_HD_FORCE_EXEC" -eq 1 ]; then
                            _dhpk_ci_saw_shell_hs=1
                            _hs_i=0
                            while [ "$_hs_i" -lt "${#_dhpk_ci_hs_flat[@]}" ]; do
                                if [ -n "${_dhpk_ci_hs_flat[$_hs_i]}" ]; then
                                    _dhpk_ci_inspect_body_cwd "${_dhpk_ci_hs_flat[$_hs_i]}" "" "unresolved"
                                fi
                                _hs_i=$((_hs_i + 1))
                            done
                        elif [ "$sep" = "pipe" ] || [ "$_dhpk_ci_pipe_id" -gt 0 ]; then
                            _hs_i=0
                            while [ "$_hs_i" -lt "${#_dhpk_ci_hs_flat[@]}" ]; do
                                _dhpk_ci_pipe_hs_flat+=("${_dhpk_ci_hs_flat[$_hs_i]}")
                                _hs_i=$((_hs_i + 1))
                            done
                        fi
                    fi
                    ;;
            esac
            if [ "$sep" = "pipe" ] || [ "$_dhpk_ci_pipe_id" -gt 0 ]; then
                if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head" || [ "$_dhpk_ci_u_head" = "eval" ] || [ "$_dhpk_ci_u_head" = "source" ] || [ "$_dhpk_ci_u_head" = "." ]; then
                    _dhpk_ci_pipe_has_shell=1
                fi
            fi
            if [ "$_dhpk_ci_u_quoted_wrapper" -eq 1 ] && [ "$DHPK_GIT_COUNT" -gt "$_git_before" ]; then
                _dhpk_ci_unsupported "quoted wrapper before git"
            fi
        fi
        _dhpk_ci_paren_empty=0
        # command cd and builtin cd are cd; any other use of cd, pushd or
        # popd through them is not tracked.
        case "$head" in
            command|builtin)
                if [ "${_dhpk_ci_words[$((h + 1))]:-}" = "cd" ]; then
                    h=$((h + 1))
                    head="cd"
                else
                    k=0
                    while [ "$k" -lt "$n" ]; do
                        case "${_dhpk_ci_words[$k]}" in
                            cd)
                                _dhpk_ci_cwd_state="unresolved"
                                _dhpk_ci_cwd=""
                                _cd_i=$((k + 1))
                                _cd_opts=1
                                while [ "$_cd_i" -lt "$n" ]; do
                                    _cd_w="${_dhpk_ci_words[$_cd_i]}"
                                    if [ "$_cd_opts" -eq 1 ]; then
                                        case "$_cd_w" in
                                            --) _cd_opts=0; _cd_i=$((_cd_i + 1)); continue ;;
                                            -[LPe@]*) _cd_i=$((_cd_i + 1)); continue ;;
                                        esac
                                    fi
                                    [ "$_cd_w" = "-" ] && _dhpk_ci_saw_cd_dash=1
                                    break
                                done
                                ;;
                            pushd|popd) _dhpk_ci_cwd_state="unresolved"; _dhpk_ci_cwd="" ;;
                        esac
                        k=$((k + 1))
                    done
                fi
                ;;
            pushd|popd)
                _dhpk_ci_any_cd=1
                _dhpk_ci_cwd_state="unresolved"
                _dhpk_ci_cwd=""
                ;;
        esac
        [ "$head" = "case" ] && [ "$_dhpk_ci_head_kw" -eq 1 ] && _dhpk_ci_case=1
        # A cd runs conditionally inside if/while/until/for/select/case, a
        # function body, after || or after && (until the && chain ends), and
        # not at all in the current shell when backgrounded with &.
        cond=0
        k=0
        while [ "$k" -lt "$h" ]; do
            case "${_dhpk_ci_words[$k]}" in
                '{') _dhpk_ci_grp_push brace "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
                if) cond=1; _dhpk_ci_block=$((_dhpk_ci_block + 1)); _dhpk_ci_grp_push if "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
                while|until) cond=1; _dhpk_ci_block=$((_dhpk_ci_block + 1)); _dhpk_ci_grp_push loop "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
                # coproc runs its command in an async subshell.
                then|else|elif|do|'!'|coproc) cond=1 ;;
            esac
            k=$((k + 1))
        done
        # Openers and closers count only as unquoted keywords in head
        # position: "fi", \fi and x=1 fi do not close a block in bash.
        [ "$_dhpk_ci_head_kw" -eq 1 ] || kwhead=""
        [ "$_dhpk_ci_head_kw" -eq 1 ] && kwhead="$head"
        case "$kwhead" in
            for|select) _dhpk_ci_block=$((_dhpk_ci_block + 1)); _dhpk_ci_grp_push loop "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
            case) _dhpk_ci_block=$((_dhpk_ci_block + 1)); _dhpk_ci_grp_push case "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
            'fi') [ "$_dhpk_ci_block" -gt 0 ] && _dhpk_ci_block=$((_dhpk_ci_block - 1)); _dhpk_ci_grp_pop if ;;
            'done') [ "$_dhpk_ci_block" -gt 0 ] && _dhpk_ci_block=$((_dhpk_ci_block - 1)); _dhpk_ci_grp_pop loop ;;
            'esac') [ "$_dhpk_ci_block" -gt 0 ] && _dhpk_ci_block=$((_dhpk_ci_block - 1)); _dhpk_ci_grp_pop case ;;
            '}') _dhpk_ci_grp_pop brace ;;
            function)
                # "function f { cd X; }" keeps the body's cd out of head
                # position, and a later call may run it.
                _dhpk_ci_func=1
                _dhpk_ci_cwd_state="unresolved"
                _dhpk_ci_cwd=""
                ;;
        esac
        if [ "$_dhpk_ci_block" -gt 0 ] || [ "$_dhpk_ci_func" -eq 1 ] || [ "$_dhpk_ci_prev_sep" = "or" ] || [ "$sep" = "bg" ]; then
            cond=1
        fi
        if [ "$head" = "cd" ]; then
            _dhpk_ci_any_cd=1
            _cd_i=$((h + 1))
            _cd_opts=1
            _cd_is_dash=0
            while [ "$_cd_i" -lt "$n" ]; do
                _cd_w="${_dhpk_ci_words[$_cd_i]}"
                if [ "$_cd_opts" -eq 1 ]; then
                    case "$_cd_w" in
                        --) _cd_opts=0; _cd_i=$((_cd_i + 1)); continue ;;
                        -[LPe@]*) _cd_i=$((_cd_i + 1)); continue ;;
                    esac
                fi
                if [ "$_cd_w" = "-" ]; then
                    _cd_is_dash=1
                    _dhpk_ci_saw_cd_dash=1
                fi
                break
            done
            if [ "$_cd_is_dash" -eq 1 ] || [ "$cond" -eq 1 ]; then
                _dhpk_ci_cwd_state="unresolved"
                _dhpk_ci_cwd=""
            elif [ "$sep" = "pipe" ]; then
                _dhpk_ci_pipeline_cd=1
            elif [ $((n - h)) -eq 2 ] && [ "${_dhpk_ci_dyn[$((h + 1))]}" != "1" ] \
                && { [ "$_dhpk_ci_cwd_state" = "literal" ] || [[ "${_dhpk_ci_words[$((h + 1))]}" == /* ]]; }; then
                dhpk_norm_path_var "${_dhpk_ci_cwd:-/}" "${_dhpk_ci_words[$((h + 1))]}"
                _dhpk_ci_cwd="$DHPK_NORM_PATH"
                _dhpk_ci_cwd_state="literal"
                [ "$_dhpk_ci_prev_sep" = "and" ] && _dhpk_ci_cd_cond=1
            else
                _dhpk_ci_cwd_state="unresolved"
                _dhpk_ci_cwd=""
            fi
        fi
        # A cd after && holds only for commands in the same && chain.
        if [ "$_dhpk_ci_cd_cond" -eq 1 ] && [ "$sep" != "and" ]; then
            _dhpk_ci_cd_cond=0
            _dhpk_ci_cwd_state="unresolved"
            _dhpk_ci_cwd=""
        fi
        _dhpk_ci_prev_sep="$sep"
    fi
    # Heredocs opened by this command: the body is data for cat, tee, and
    # git (without -c/--config-env/--exec-path before the subcommand) unless
    # the command pipes into another one, its output can run as a command, or
    # the text writes into a process or a FIFO. Any other body is a script.
    if [ "$_dhpk_ci_hd_seen" -lt "${#_dhpk_ci_hd_d[@]}" ]; then
        git_has_c=0
        case "$_dhpk_ci_u_head" in
            git|*/git)
                k=$((_dhpk_ci_u_idx + 1))
                while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
                    case "${_dhpk_ci_u_words[$k]}" in
                        --) break ;;
                        -c|-c*|--config-env|--config-env=*|--exec-path|--exec-path=*) git_has_c=1; break ;;
                        -C|--git-dir|--work-tree|--namespace|--super-prefix|--list-cmds) k=$((k + 2)) ;;
                        -*) k=$((k + 1)) ;;
                        *) break ;;
                    esac
                done
                ;;
        esac
        while [ "$_dhpk_ci_hd_seen" -lt "${#_dhpk_ci_hd_d[@]}" ]; do
            case "$_dhpk_ci_u_head" in
                cat|*/cat|tee|*/tee|git|*/git)
                    if [ "$git_has_c" -eq 1 ] || [ "$sep" = "pipe" ] || [ "$_dhpk_ci_xctx" -eq 1 ] || [ "$DHPK_HD_FORCE_EXEC" -eq 1 ]; then
                        _dhpk_ci_hd_x[$_dhpk_ci_hd_seen]=1
                    else
                        _dhpk_ci_hd_x[$_dhpk_ci_hd_seen]=0
                    fi
                    ;;
                *) _dhpk_ci_hd_x[$_dhpk_ci_hd_seen]=1 ;;
            esac
            _dhpk_ci_hd_seen=$((_dhpk_ci_hd_seen + 1))
        done
    fi
    if [ "$sep" = "pipe" ]; then
        if [ "$_dhpk_ci_pipe_id" -eq 0 ]; then
            _dhpk_ci_next_pipe_id=$((_dhpk_ci_next_pipe_id + 1))
            _dhpk_ci_pipe_id="$_dhpk_ci_next_pipe_id"
        fi
        if [ "$_dhpk_ci_last_group_cmd0" -ge 0 ]; then
            _dhpk_ci_unify_pipe "$_dhpk_ci_last_group_cmd0" "$_dhpk_ci_pipe_id"
            _dhpk_ci_last_group_cmd0=-1
        elif [ "$n" -gt 0 ]; then
            DHPK_CMD_PIPE_ID[$cmd_idx]="$_dhpk_ci_pipe_id"
        fi
        _dhpk_ci_after_pipe=1
    else
        _dhpk_ci_pipeline_cd=0
        _dhpk_ci_seg=""
        if [ "$n" -gt 0 ] || [ "$_dhpk_ci_after_pipe" -eq 0 ]; then
            _dhpk_ci_after_pipe=0
            _dhpk_ci_last_group_cmd0=-1
            if [ "$_dhpk_ci_grp_depth" -gt 0 ]; then
                _dhpk_ci_pipe_id="${_dhpk_ci_grp_pipe[$((_dhpk_ci_grp_depth - 1))]}"
            else
                if [ "$_dhpk_ci_pipe_has_shell" -eq 1 ] && [ "${#_dhpk_ci_pipe_hs_flat[@]}" -gt 0 ]; then
                    _dhpk_ci_saw_shell_hs=1
                    _hs_i=0
                    while [ "$_hs_i" -lt "${#_dhpk_ci_pipe_hs_flat[@]}" ]; do
                        if [ -n "${_dhpk_ci_pipe_hs_flat[$_hs_i]}" ]; then
                            _dhpk_ci_inspect_body_cwd "${_dhpk_ci_pipe_hs_flat[$_hs_i]}" "" "unresolved"
                        fi
                        _hs_i=$((_hs_i + 1))
                    done
                fi
                _dhpk_ci_pipe_hs_flat=()
                _dhpk_ci_pipe_has_shell=0
                _dhpk_ci_pipe_id=0
            fi
        fi
    fi
    _dhpk_ci_reset_words
}

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
        *) _dhpk_ci_word=""; _dhpk_ci_word_flat=""; _dhpk_ci_word_dyn=0; _dhpk_ci_word_open=0; _dhpk_ci_word_q=0 ;;
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
    _dhpk_ci_list "$body" 0 body
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
            _dhpk_ci_list "" $((i + 2)) subst
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
            _dhpk_ci_list "$body" 0 body
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
    if [ "$_dhpk_ci_kind" != "subst" ]; then
        local text="$1" len="${#1}"
        local -a _dhpk_ci_pg
        _dhpk_ci_make_pages
    fi
    local ch next matched _pi=-1 _p="" _o
    local _dhpk_ci_mode="normal" _dhpk_ci_word="" _dhpk_ci_word_flat="" _dhpk_ci_word_dyn=0 _dhpk_ci_word_open=0 _dhpk_ci_redir=0
    local -a _dhpk_ci_words _dhpk_ci_dyn _dhpk_ci_quoted _dhpk_ci_words_flat
    local -a _dhpk_ci_hs_words _dhpk_ci_hs_dyn _dhpk_ci_hs_flat _dhpk_ci_pipe_hs_flat
    local _dhpk_ci_word_q=0 _dhpk_ci_pipe_has_shell=0
    local _dhpk_ci_seg="" _dhpk_ci_pipeline_cd=0 _dhpk_ci_paren=0 _dhpk_ci_any_cd=0 _dhpk_ci_case=0
    local _dhpk_ci_pipe_id=0 _dhpk_ci_last_group_cmd0=-1 _dhpk_ci_after_pipe=0 _dhpk_ci_grp_depth=0
    # Conditional-cd tracking: open if/loop/case blocks, a function body
    # seen, the separator before this command, a cd held by an && chain.
    local _dhpk_ci_block=0 _dhpk_ci_func=0 _dhpk_ci_prev_sep="" _dhpk_ci_cd_cond=0 _dhpk_ci_paren_empty=0
    # Directory/state saved at each open '(' and open compound group stack.
    local -a _dhpk_ci_cwd_stk _dhpk_ci_state_stk _dhpk_ci_grp_cmd0 _dhpk_ci_grp_pipe _dhpk_ci_grp_kind
    _dhpk_ci_cwd_stk=()
    _dhpk_ci_state_stk=()
    _dhpk_ci_grp_cmd0=()
    _dhpk_ci_grp_pipe=()
    _dhpk_ci_grp_kind=()
    _dhpk_ci_pipe_hs_flat=()
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
                    '$'|'`') _dhpk_ci_word_dyn=1 ;;
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
                _dhpk_ci_after_pipe=0
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
                _dhpk_ci_cwd_stk[$_dhpk_ci_paren]="$_dhpk_ci_cwd"
                _dhpk_ci_state_stk[$_dhpk_ci_paren]="$_dhpk_ci_cwd_state"
                _dhpk_ci_grp_push paren "${#DHPK_CMD_START[@]}" "$_dhpk_ci_pipe_id"
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
                    _dhpk_ci_sub_stripped="$DHPK_STRIPPED"
                    _dhpk_ci_end=$((i + 1))
                    return 0
                fi
                # A subshell's cd does not outlive it: its ) restores the
                # directory saved at its (. A case pattern's ) is not a
                # subshell's, so after a case and a cd, or at an unmatched )
                # after a cd, the directory is unresolved.
                # "name()" defines a function: its body may never run.
                [ "$_dhpk_ci_paren_empty" -eq 1 ] && _dhpk_ci_func=1
                _dhpk_ci_paren_empty=0
                if [ "$_dhpk_ci_paren" -gt 0 ] && [ "$_dhpk_ci_grp_depth" -gt 0 ] \
                    && [ "${_dhpk_ci_grp_kind[$((_dhpk_ci_grp_depth - 1))]}" = "paren" ]; then
                    _dhpk_ci_paren=$((_dhpk_ci_paren - 1))
                    _dhpk_ci_cwd="${_dhpk_ci_cwd_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_cwd_state="${_dhpk_ci_state_stk[$_dhpk_ci_paren]}"
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
                    _dhpk_ci_list "" $((i + 2)) subst
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
                        _dhpk_ci_list "" $((i + 2)) subst
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
    if [ "$_dhpk_ci_kind" = "top" ] && [ "$_dhpk_ci_saw_shell_head" -eq 1 ] && [ "${#_dhpk_ci_all_hs_flat[@]}" -gt 0 ]; then
        # A here-string may reach a shell through a group or exec redirect.
        local _hs_all=("${_dhpk_ci_all_hs_flat[@]}") _hs_j=0
        _dhpk_ci_saw_shell_hs=1
        while [ "$_hs_j" -lt "${#_hs_all[@]}" ]; do
            [ -n "${_hs_all[$_hs_j]}" ] && _dhpk_ci_inspect_body_cwd "${_hs_all[$_hs_j]}" "" "unresolved"
            _hs_j=$((_hs_j + 1))
        done
    fi
    if [ "$_dhpk_ci_kind" = "top" ] && [ "${DHPK_GIT_COUNT:-0}" -gt 0 ]; then
        if [ "$_dhpk_ci_saw_eval" -eq 1 ]; then
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
    _dhpk_ci_all_hs_flat=()
    _dhpk_ci_saw_shell_head=0
    _dhpk_ci_list "$cmd" 0 top
    unset _dhpk_ci_cwd _dhpk_ci_cwd_state _dhpk_ci_end _dhpk_ci_head _dhpk_ci_exec_next _dhpk_ci_depth
    unset _dhpk_ci_next_pipe_id _dhpk_ci_hd_word _dhpk_ci_hd_quoted _dhpk_ci_sub_stripped _dhpk_ci_expand_stripped
    unset _dhpk_ci_saw_eval _dhpk_ci_saw_source _dhpk_ci_saw_cd_dash _dhpk_ci_saw_cdpath _dhpk_ci_saw_shell_hs _dhpk_ci_all_hs_flat _dhpk_ci_saw_shell_head
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
            if [ -n "$marker" ] && printf '%s' "$segment" | grep -Fq -- "$marker"; then
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
                if printf '%s' "$segment" | grep -Fq -- "$marker"; then
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
