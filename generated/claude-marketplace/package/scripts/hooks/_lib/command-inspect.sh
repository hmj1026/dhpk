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
            *) out="$out/$part" ;;
        esac
    done
    [ -n "$out" ] || out="/"
    DHPK_NORM_PATH="$out"
    return 0
}

# Nested lists and ${...} scans recurse; deeper text is reported as
# unsupported instead of exhausting the bash stack.
DHPK_CI_MAX_DEPTH=64

_dhpk_ci_reset_words() {
    _dhpk_ci_words=()
    _dhpk_ci_dyn=()
    _dhpk_ci_quoted=()
    _dhpk_ci_word=""
    _dhpk_ci_word_dyn=0
    _dhpk_ci_word_q=0
}

_dhpk_ci_flush_word() {
    if [ -n "$_dhpk_ci_word" ] || [ "$_dhpk_ci_word_open" -eq 1 ]; then
        if [ "$_dhpk_ci_redir" -eq 1 ]; then
            DHPK_REDIRECT_TARGETS+=("$_dhpk_ci_word")
            _dhpk_ci_redir=0
        elif [ "$_dhpk_ci_redir" -eq 2 ]; then
            # A here-string word is stdin data, not argv.
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
        fi
    fi
    _dhpk_ci_word=""
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

_dhpk_ci_record_git() {
    local i=0 n="${#_dhpk_ci_words[@]}" sub="" state="cwd" repo="$_dhpk_ci_cwd" c_path="" c_base="" no_verify=0 exempt=0
    local word dyn
    _dhpk_ci_head_index
    i="$_dhpk_ci_head"
    [ "$i" -lt "$n" ] || return 0
    word="${_dhpk_ci_words[$i]}"
    if [ "$word" = "command" ]; then
        i=$((i + 1))
        [ "$i" -lt "$n" ] || return 0
        word="${_dhpk_ci_words[$i]}"
    fi
    case "$word" in
        git|*/git) ;;
        *) return 0 ;;
    esac
    i=$((i + 1))
    while [ "$i" -lt "$n" ]; do
        word="${_dhpk_ci_words[$i]}"
        dyn="${_dhpk_ci_dyn[$i]}"
        case "$word" in
            --) i=$((i + 1)); break ;;
            --help|-h|--paginate|--no-pager|--bare|--no-replace-objects|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks)
                [ "$word" = "--help" ] || [ "$word" = "-h" ] && exempt=1
                i=$((i + 1))
                ;;
            -p|-P) i=$((i + 1)) ;;
            -C)
                i=$((i + 1))
                if [ "$i" -ge "$n" ] || [ "${_dhpk_ci_dyn[$i]}" = "1" ]; then
                    state="unresolved"
                else
                    [ -n "$c_base" ] || c_base="$_dhpk_ci_cwd"
                    dhpk_norm_path_var "$c_base" "${_dhpk_ci_words[$i]}"
                    c_base="$DHPK_NORM_PATH"
                    c_path="$c_base"
                fi
                i=$((i + 1))
                ;;
            -C*)
                if [ "$dyn" = "1" ]; then
                    state="unresolved"
                else
                    [ -n "$c_base" ] || c_base="$_dhpk_ci_cwd"
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
        sub="${_dhpk_ci_words[$i]}"
    fi
    [ -n "$sub" ] || return 0
    local j=0
    while [ "$j" -lt "$n" ]; do
        word="${_dhpk_ci_words[$j]}"
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
    if [ "$_dhpk_ci_pipeline_cd" -eq 1 ] || [ "$_dhpk_ci_cwd_state" != "literal" ]; then
        state="unresolved"
    fi
    if [ "$state" != "unresolved" ] && [ -n "$c_path" ]; then
        dhpk_norm_path_var "$_dhpk_ci_cwd" "$c_path"
        repo="$DHPK_NORM_PATH"
        state="literal"
    elif [ "$state" != "unresolved" ]; then
        repo="$_dhpk_ci_cwd"
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

# _dhpk_ci_flush_command <sep>
#   sep is the separator that ends the command: compound (; newline ( ) or
#   the end), and (&&), or (||), bg (&) or pipe (| |&).
_dhpk_ci_flush_command() {
    local sep="$1" n h head k cond kwhead=""
    _dhpk_ci_flush_word
    _dhpk_ci_redir=0
    n="${#_dhpk_ci_words[@]}"
    head=""
    if [ "$n" -gt 0 ]; then
        _dhpk_ci_head_index
        h="$_dhpk_ci_head"
        [ "$h" -lt "$n" ] && head="${_dhpk_ci_words[$h]}"
        DHPK_CMD_START+=("${#DHPK_WORDS[@]}")
        DHPK_CMD_LEN+=("$n")
        DHPK_WORDS+=("${_dhpk_ci_words[@]}")
        if [ "$_dhpk_ci_cwd_state" = "literal" ]; then
            DHPK_CMD_CWD+=("$_dhpk_ci_cwd")
        else
            DHPK_CMD_CWD+=("")
        fi
        _dhpk_ci_record_git
        _dhpk_ci_paren_empty=0
        # command cd and builtin cd are cd; any other use of cd, pushd or
        # popd through them is not tracked.
        case "$head" in
            command|builtin)
                if [ "${_dhpk_ci_words[$((h + 1))]:-}" = "cd" ]; then
                    h=$((h + 1))
                    head="cd"
                else
                    for k in "${_dhpk_ci_words[@]}"; do
                        case "$k" in cd|pushd|popd) _dhpk_ci_cwd_state="unresolved"; _dhpk_ci_cwd="" ;; esac
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
                if|while|until) cond=1; _dhpk_ci_block=$((_dhpk_ci_block + 1)) ;;
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
            for|select|case) _dhpk_ci_block=$((_dhpk_ci_block + 1)) ;;
            'fi'|'done'|'esac') [ "$_dhpk_ci_block" -gt 0 ] && _dhpk_ci_block=$((_dhpk_ci_block - 1)) ;;
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
            if [ "$cond" -eq 1 ]; then
                _dhpk_ci_cwd_state="unresolved"
                _dhpk_ci_cwd=""
            elif [ "$sep" = "pipe" ]; then
                _dhpk_ci_pipeline_cd=1
            elif [ "$_dhpk_ci_cwd_state" = "literal" ] && [ $((n - h)) -eq 2 ] && [ "${_dhpk_ci_dyn[$((h + 1))]}" != "1" ]; then
                dhpk_norm_path_var "$_dhpk_ci_cwd" "${_dhpk_ci_words[$((h + 1))]}"
                _dhpk_ci_cwd="$DHPK_NORM_PATH"
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
    # Heredocs opened by this command: the body is data for cat and tee
    # unless the command pipes into another one, its output can run as a
    # command, or the text writes into a process or a FIFO. Any other body
    # is a script.
    while [ "$_dhpk_ci_hd_seen" -lt "${#_dhpk_ci_hd_d[@]}" ]; do
        case "$head" in
            cat|*/cat|tee|*/tee)
                if [ "$sep" = "pipe" ] || [ "$_dhpk_ci_xctx" -eq 1 ] || [ "$DHPK_HD_FORCE_EXEC" -eq 1 ]; then
                    _dhpk_ci_hd_x[$_dhpk_ci_hd_seen]=1
                else
                    _dhpk_ci_hd_x[$_dhpk_ci_hd_seen]=0
                fi
                ;;
            *) _dhpk_ci_hd_x[$_dhpk_ci_hd_seen]=1 ;;
        esac
        _dhpk_ci_hd_seen=$((_dhpk_ci_hd_seen + 1))
    done
    if [ "$sep" != "pipe" ]; then
        _dhpk_ci_pipeline_cd=0
        _dhpk_ci_seg=""
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
        digits="$digits$d"
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

# _dhpk_ci_ansi_end <text> <index>
#   Sets _dhpk_ci_ansi_close to the index of the quote that closes the $'...'
#   body starting at <index>, using the bash lexer rule that a backslash
#   pairs with exactly one character. Unterminated: the text length.
_dhpk_ci_ansi_end() {
    local text="$1" k="$2" n="${#1}" ch
    while [ "$k" -lt "$n" ]; do
        ch="${text:$k:1}"
        if [ "$ch" = "\\" ]; then
            k=$((k + 2))
            continue
        fi
        [ "$ch" = "'" ] && break
        k=$((k + 1))
    done
    [ "$k" -le "$n" ] || k="$n"
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
            out="$out$_dhpk_ci_esc_out"
            k=$((k + 1 + _dhpk_ci_esc_len))
            continue
        fi
        out="$out$ch"
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
        *) _dhpk_ci_word=""; _dhpk_ci_word_dyn=0; _dhpk_ci_word_open=0; _dhpk_ci_word_q=0 ;;
    esac
    _dhpk_ci_redir=1
}

# _dhpk_ci_unsupported <reason>
#   Records the first construct the decoder cannot place faithfully. Hooks
#   treat a non-empty DHPK_UNSUPPORTED as a block, not as a guess.
_dhpk_ci_unsupported() {
    [ -n "$DHPK_UNSUPPORTED" ] || DHPK_UNSUPPORTED="$1"
}

# _dhpk_ci_arith <text> <index>
#   <index> is just after '$((' or '(('. Sets _dhpk_ci_end after the closing
#   '))' and returns 0. Returns 1 when the first unmatched ')' is not doubled,
#   because bash then reads the text as a subshell, not arithmetic. Quotes or
#   a command substitution inside arithmetic are reported as unsupported.
_dhpk_ci_arith() {
    local text="$1" k="$2" n="${#1}" depth=0 ch reason=""
    while [ "$k" -lt "$n" ]; do
        ch="${text:$k:1}"
        case "$ch" in
            '(') depth=$((depth + 1)) ;;
            ')')
                if [ "$depth" -gt 0 ]; then
                    depth=$((depth - 1))
                elif [ "${text:$((k + 1)):1}" = ")" ]; then
                    [ -z "$reason" ] || _dhpk_ci_unsupported "$reason"
                    _dhpk_ci_end=$((k + 2))
                    return 0
                else
                    return 1
                fi
                ;;
            "'"|'"'|'`') reason="quote or backtick inside arithmetic" ;;
            '$')
                if [ "${text:$((k + 1)):1}" = "(" ]; then
                    reason="command substitution inside arithmetic"
                fi
                ;;
        esac
        k=$((k + 1))
    done
    _dhpk_ci_unsupported "unterminated arithmetic"
    _dhpk_ci_end="$n"
    return 0
}

# _dhpk_ci_brack <text> <index>
#   <index> is just after '$['. Sets _dhpk_ci_end after the matching ']' of
#   this legacy arithmetic form; quotes or substitutions inside it, or no
#   closing bracket, are reported as unsupported.
_dhpk_ci_brack() {
    local text="$1" k="$2" n="${#1}" depth=0 ch
    while [ "$k" -lt "$n" ]; do
        ch="${text:$k:1}"
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
                if [ "${text:$((k + 1)):1}" = "(" ]; then
                    _dhpk_ci_unsupported "command substitution inside \$[...]"
                fi
                ;;
        esac
        k=$((k + 1))
    done
    _dhpk_ci_unsupported "unterminated \$[...]"
    _dhpk_ci_end="$n"
}

# _dhpk_ci_backtick <text> <index> <in-double-quotes>
#   <index> is the opening backtick. The body ends at the next unescaped
#   backtick (quotes do not count, as in bash). \$ \` \\ (and \" inside
#   double quotes) lose their backslash, then the body is inspected as its
#   own command list, so a quote inside it cannot leak out.
_dhpk_ci_backtick() {
    local text="$1" k=$(($2 + 1)) indq="$3" n="${#1}" ch nx body=""
    while [ "$k" -lt "$n" ]; do
        ch="${text:$k:1}"
        if [ "$ch" = "\\" ]; then
            nx="${text:$((k + 1)):1}"
            case "$nx" in
                '$'|'`'|\\) body="$body$nx" ;;
                '"') if [ "$indq" = 1 ]; then body="$body$nx"; else body="$body\\$nx"; fi ;;
                *) body="$body\\$nx" ;;
            esac
            k=$((k + 2))
            continue
        fi
        [ "$ch" = '`' ] && break
        body="$body$ch"
        k=$((k + 1))
    done
    [ "$k" -lt "$n" ] && k=$((k + 1))
    [ "$k" -le "$n" ] || k="$n"
    _dhpk_ci_list "$body" 0 body
    _dhpk_ci_end="$k"
}

# _dhpk_ci_expand <text> <index> <in-double-quotes>
#   Handles $(...), $((...)), $[...], ${...} or a backtick at <index>: commands
#   inside are inspected and _dhpk_ci_end is set after the construct.
#   Returns 1, without side effects, for any other character.
_dhpk_ci_expand() {
    local text="$1" i="$2" indq="$3"
    if [ "${text:$i:1}" = '`' ]; then
        _dhpk_ci_backtick "$text" "$i" "$indq"
        return 0
    fi
    [ "${text:$i:1}" = '$' ] || return 1
    case "${text:$((i + 1)):1}" in
        '(')
            if [ "${text:$((i + 2)):1}" = "(" ] && _dhpk_ci_arith "$text" $((i + 3)); then
                return 0
            fi
            _dhpk_ci_list "$text" $((i + 2)) subst
            return 0
            ;;
        '{')
            _dhpk_ci_scan "$text" $((i + 2)) param "$indq"
            return 0
            ;;
        '[')
            _dhpk_ci_brack "$text" $((i + 2))
            return 0
            ;;
    esac
    return 1
}

# _dhpk_ci_scan <text> <index> <kind>
#   Finds the end of text that holds no commands of its own and inspects the
#   substitutions inside it. Sets _dhpk_ci_end after the end.
#   param: a ${...} body. '...', $'...' and "..." quote (bash 5.2 rules, in
#          and out of double quotes); the first unquoted } ends it.
#   pdq:   a "..." nested in a ${...}; ends after the closing quote.
#   hbody: an unquoted-delimiter heredoc body; quotes are data.
_dhpk_ci_scan() {
    if [ "$_dhpk_ci_depth" -ge "$DHPK_CI_MAX_DEPTH" ]; then
        _dhpk_ci_unsupported "nesting too deep"
        _dhpk_ci_end="${#1}"
        return 0
    fi
    _dhpk_ci_depth=$((_dhpk_ci_depth + 1))
    _dhpk_ci_scan_run "$@"
    _dhpk_ci_depth=$((_dhpk_ci_depth - 1))
    return 0
}

_dhpk_ci_scan_run() {
    local text="$1" k="$2" kind="$3" indq="${4:-0}" n="${#1}" ch rest sq=0
    while [ "$k" -lt "$n" ]; do
        ch="${text:$k:1}"
        if [ "$sq" -eq 1 ]; then
            # '...' in a double-quoted ${...}: it hides } and ", but bash
            # still runs the substitutions inside it. A backslash is literal
            # there, so '\' ends at its second quote (bash 5.2).
            case "$ch" in
                "'") sq=0 ;;
                '$'|'`')
                    if _dhpk_ci_expand "$text" "$k" 1; then
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
                if [ "$kind" = "param" ] && [ "$indq" -eq 0 ] && [ "${text:$((k + 1)):1}" = "'" ]; then
                    _dhpk_ci_ansi_end "$text" $((k + 2))
                    k=$((_dhpk_ci_ansi_close + 1))
                    continue
                fi
                if _dhpk_ci_expand "$text" "$k" 1; then
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
                    rest="${text:$((k + 1))}"
                    case "$rest" in
                        *"'"*) rest="${rest%%\'*}"; k=$((k + 2 + ${#rest})) ;;
                        *) k="$n" ;;
                    esac
                    continue
                fi
                ;;
            '"')
                if [ "$kind" = "param" ]; then
                    _dhpk_ci_scan "$text" $((k + 1)) pdq
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
    _dhpk_ci_end="$n"
}

# _dhpk_ci_hd_delim <text> <index>
#   <index> is just after '<<' or '<<-'. Reads the delimiter word with quote
#   removal into _dhpk_ci_hd_word, sets _dhpk_ci_hd_quoted to 1 when any part
#   was quoted, and _dhpk_ci_end after the word.
_dhpk_ci_hd_delim() {
    local text="$1" k="$2" n="${#1}" ch nx word="" quoted=0 rest
    while [ "$k" -lt "$n" ]; do
        case "${text:$k:1}" in
            ' '|$'\t') k=$((k + 1)) ;;
            *) break ;;
        esac
    done
    while [ "$k" -lt "$n" ]; do
        ch="${text:$k:1}"
        case "$ch" in
            ' '|$'\t'|$'\n'|';'|'&'|'|'|'<'|'>'|'('|')') break ;;
            "'")
                quoted=1
                rest="${text:$((k + 1))}"
                case "$rest" in
                    *"'"*) rest="${rest%%\'*}"; word="$word$rest"; k=$((k + 2 + ${#rest})) ;;
                    *) word="$word$rest"; k="$n" ;;
                esac
                continue
                ;;
            '"')
                quoted=1
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    ch="${text:$k:1}"
                    [ "$ch" = '"' ] && break
                    if [ "$ch" = "\\" ]; then
                        nx="${text:$((k + 1)):1}"
                        case "$nx" in
                            '$'|'`'|'"'|\\) word="$word$nx"; k=$((k + 2)); continue ;;
                        esac
                    fi
                    case "$ch" in
                        '$'|'`') _dhpk_ci_unsupported "expansion in a heredoc delimiter" ;;
                    esac
                    word="$word$ch"
                    k=$((k + 1))
                done
                k=$((k + 1))
                continue
                ;;
            \\)
                quoted=1
                nx="${text:$((k + 1)):1}"
                [ "$nx" = $'\n' ] && _dhpk_ci_unsupported "line continuation in a heredoc delimiter"
                word="$word$nx"
                k=$((k + 2))
                continue
                ;;
            '`') _dhpk_ci_unsupported "expansion in a heredoc delimiter" ;;
            '$')
                case "${text:$((k + 1)):1}" in
                    "'"|'"'|'('|'{') _dhpk_ci_unsupported "expansion in a heredoc delimiter" ;;
                esac
                ;;
        esac
        word="$word$ch"
        k=$((k + 1))
    done
    [ "$k" -le "$n" ] || k="$n"
    if [ -z "$word" ] && [ "$quoted" -eq 0 ]; then
        _dhpk_ci_unsupported "heredoc without a delimiter"
    fi
    _dhpk_ci_hd_word="$word"
    _dhpk_ci_hd_quoted="$quoted"
    _dhpk_ci_end="$k"
}

# _dhpk_ci_hd_bodies <text> <index>
#   <index> is just after the newline that ends a line with pending heredocs.
#   Consumes each body in order, up to its delimiter line (or the end of the
#   text, as bash does). With an unquoted delimiter a line that ends in an odd
#   number of backslashes joins the next line first. A body that
#   _dhpk_ci_flush_command classified as data (cat or tee whose output does
#   not run) is skipped, except the substitutions of an unquoted body. Any
#   other body is inspected as its own command list. Sets _dhpk_ci_end.
_dhpk_ci_hd_bodies() {
    local text="$1" k="$2" n="${#1}" j=0 count="${#_dhpk_ci_hd_d[@]}"
    local delim quoted strip isexec start lstart rest line logical bs body cont
    while [ "$j" -lt "$count" ]; do
        delim="${_dhpk_ci_hd_d[$j]}"
        quoted="${_dhpk_ci_hd_q[$j]}"
        strip="${_dhpk_ci_hd_t[$j]}"
        isexec="${_dhpk_ci_hd_x[$j]:-1}"
        start="$k"
        lstart="$k"
        logical=""
        cont=0
        body="${text:$start}"
        while [ "$k" -lt "$n" ]; do
            [ "$cont" -eq 1 ] || lstart="$k"
            cont=0
            rest="${text:$k}"
            line="${rest%%$'\n'*}"
            if [ "$line" = "$rest" ]; then
                k="$n"
            else
                k=$((k + ${#line} + 1))
            fi
            if [ "$strip" -eq 1 ]; then
                while [ "${line:0:1}" = $'\t' ]; do line="${line:1}"; done
            fi
            if [ "$quoted" -eq 0 ]; then
                bs=0
                while [ "$bs" -lt "${#line}" ] && [ "${line:$((${#line} - 1 - bs)):1}" = "\\" ]; do
                    bs=$((bs + 1))
                done
                if [ $((bs % 2)) -eq 1 ] && [ "$k" -lt "$n" ]; then
                    logical="$logical${line%\\}"
                    cont=1
                    continue
                fi
            fi
            logical="$logical$line"
            if [ "$logical" = "$delim" ]; then
                body="${text:$start:$((lstart - start))}"
                break
            fi
            if [ "$_dhpk_ci_kind" = "subst" ] && [ "${logical#"$delim")}" != "$logical" ]; then
                _dhpk_ci_unsupported "heredoc delimiter followed by ) inside a command substitution"
            fi
            logical=""
        done
        if [ "$isexec" = 1 ]; then
            DHPK_STRIPPED="$DHPK_STRIPPED$body"
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
        eval|source|.|sh|bash|zsh|dash|ksh|ash|mksh) _dhpk_ci_exec_next=1 ;;
    esac
    return 0
}

# _dhpk_ci_sub_word <text> <start> <end>
#   Adds the raw text of a substitution that ended at <end> to the current
#   word, segment and stripped text. A substitution that spans a newline
#   while a heredoc is pending cannot be placed and is reported.
_dhpk_ci_sub_word() {
    local raw="${1:$2:$(($3 - $2))}"
    _dhpk_ci_word="$_dhpk_ci_word$raw"
    _dhpk_ci_word_open=1
    _dhpk_ci_word_dyn=1
    _dhpk_ci_seg="$_dhpk_ci_seg$raw"
    DHPK_STRIPPED="$DHPK_STRIPPED$raw"
    if [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ]; then
        case "$raw" in
            *$'\n'*) _dhpk_ci_unsupported "substitution spans a pending heredoc" ;;
        esac
    fi
}

# _dhpk_ci_list <text> <index> <kind>
#   Inspects a command list. kind is top (the whole command), subst (the
#   body of $(...) or <(...), ending at its unmatched ')'), or body (a
#   heredoc script or backtick body, a separate text). Parser state is local,
#   so a nested list starts clean and its cd or quotes cannot leak out.
#   Only the top list writes DHPK_STRIPPED; a caller adds a nested list's raw
#   text instead. Sets _dhpk_ci_end after the list.
_dhpk_ci_list() {
    if [ "$_dhpk_ci_depth" -ge "$DHPK_CI_MAX_DEPTH" ]; then
        _dhpk_ci_unsupported "nesting too deep"
        _dhpk_ci_end="${#1}"
        return 0
    fi
    _dhpk_ci_depth=$((_dhpk_ci_depth + 1))
    _dhpk_ci_list_run "$@"
    _dhpk_ci_depth=$((_dhpk_ci_depth - 1))
    return 0
}

_dhpk_ci_list_run() {
    local text="$1" i="$2" _dhpk_ci_kind="$3"
    local len="${#1}" ch next matched
    local _dhpk_ci_mode="normal" _dhpk_ci_word="" _dhpk_ci_word_dyn=0 _dhpk_ci_word_open=0 _dhpk_ci_redir=0
    local -a _dhpk_ci_words _dhpk_ci_dyn _dhpk_ci_quoted
    local _dhpk_ci_word_q=0
    local _dhpk_ci_seg="" _dhpk_ci_pipeline_cd=0 _dhpk_ci_paren=0 _dhpk_ci_any_cd=0 _dhpk_ci_case=0
    # Conditional-cd tracking: open if/loop/case blocks, a function body
    # seen, the separator before this command, a cd held by an && chain.
    local _dhpk_ci_block=0 _dhpk_ci_func=0 _dhpk_ci_prev_sep="" _dhpk_ci_cd_cond=0 _dhpk_ci_paren_empty=0
    # Directory and state saved at each open subshell '('.
    local -a _dhpk_ci_cwd_stk _dhpk_ci_state_stk
    _dhpk_ci_cwd_stk=()
    _dhpk_ci_state_stk=()
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
        ch="${text:$i:1}"
        next="${text:$((i + 1)):1}"
        if [ "$_dhpk_ci_mode" = "comment" ]; then
            if [ "$ch" = $'\n' ]; then
                _dhpk_ci_flush_command compound
                _dhpk_ci_mode="normal"
                DHPK_STRIPPED="${DHPK_STRIPPED}"$'\n'
                if [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ]; then
                    _dhpk_ci_hd_bodies "$text" $((i + 1))
                    i="$_dhpk_ci_end"
                    continue
                fi
            fi
            i=$((i + 1))
            continue
        fi
        if [ "$_dhpk_ci_mode" = "single" ]; then
            DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
            _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
            if [ "$ch" = "'" ]; then
                _dhpk_ci_mode="normal"
            else
                _dhpk_ci_word="${_dhpk_ci_word}${ch}"
                _dhpk_ci_word_open=1
            fi
            i=$((i + 1))
            continue
        fi
        if [ "$_dhpk_ci_mode" = "double" ]; then
            if [ "$ch" = "\\" ] && [ -n "$next" ]; then
                DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                # Inside "...", backslash-newline is a line continuation and a
                # backslash escapes only $, `, " and \; before anything else
                # it stays part of the word.
                case "$next" in
                    $'\n') ;;
                    '$'|'`'|'"'|\\) _dhpk_ci_word="${_dhpk_ci_word}${next}" ;;
                    *) _dhpk_ci_word="${_dhpk_ci_word}\\${next}" ;;
                esac
                _dhpk_ci_word_open=1
                DHPK_STRIPPED="${DHPK_STRIPPED}${next}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${next}"
                i=$((i + 2))
                continue
            fi
            case "$ch" in
                '$'|'`') _dhpk_ci_exec_context 0 ;;
            esac
            if _dhpk_ci_expand "$text" "$i" 1; then
                _dhpk_ci_sub_word "$text" "$i" "$_dhpk_ci_end"
                i="$_dhpk_ci_end"
                continue
            fi
            DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
            _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
            if [ "$ch" = '"' ]; then
                _dhpk_ci_mode="normal"
            else
                _dhpk_ci_word="${_dhpk_ci_word}${ch}"
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
                    _dhpk_ci_word="${_dhpk_ci_word}${next}"
                    _dhpk_ci_word_open=1
                    _dhpk_ci_word_q=1
                    DHPK_STRIPPED="${DHPK_STRIPPED}${next}"
                    _dhpk_ci_seg="${_dhpk_ci_seg}${next}"
                    i=$((i + 2))
                    continue
                fi
                ;;
            "'")
                _dhpk_ci_mode="single"
                _dhpk_ci_word_open=1
                _dhpk_ci_word_q=1
                DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                i=$((i + 1))
                continue
                ;;
            '"')
                _dhpk_ci_mode="double"
                _dhpk_ci_word_open=1
                _dhpk_ci_word_q=1
                DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
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
                DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                i=$((i + 1))
                continue
                ;;
            $'\n')
                _dhpk_ci_flush_command compound
                DHPK_STRIPPED="${DHPK_STRIPPED}"$'\n'
                i=$((i + 1))
                if [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ]; then
                    _dhpk_ci_hd_bodies "$text" "$i"
                    i="$_dhpk_ci_end"
                fi
                continue
                ;;
            ';')
                _dhpk_ci_flush_command compound
                DHPK_STRIPPED="${DHPK_STRIPPED};"
                i=$((i + 1))
                continue
                ;;
            '(')
                # (( is arithmetic when it closes with )); otherwise each ( is
                # a subshell. Both are operators, so a # after ( is a comment.
                if [ "$next" = "(" ] && [ -z "$_dhpk_ci_word" ] && [ "$_dhpk_ci_word_open" -eq 0 ] \
                    && _dhpk_ci_arith "$text" $((i + 2)); then
                    _dhpk_ci_sub_word "$text" "$i" "$_dhpk_ci_end"
                    i="$_dhpk_ci_end"
                    continue
                fi
                _dhpk_ci_flush_command compound
                _dhpk_ci_cwd_stk[$_dhpk_ci_paren]="$_dhpk_ci_cwd"
                _dhpk_ci_state_stk[$_dhpk_ci_paren]="$_dhpk_ci_cwd_state"
                _dhpk_ci_paren=$((_dhpk_ci_paren + 1))
                _dhpk_ci_paren_empty=1
                DHPK_STRIPPED="${DHPK_STRIPPED}("
                i=$((i + 1))
                continue
                ;;
            ')')
                _dhpk_ci_flush_command compound
                if [ "$_dhpk_ci_paren" -eq 0 ] && [ "$_dhpk_ci_kind" = "subst" ]; then
                    [ "${#_dhpk_ci_hd_d[@]}" -gt 0 ] && _dhpk_ci_unsupported "heredoc left open inside a command substitution"
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
                if [ "$_dhpk_ci_paren" -gt 0 ]; then
                    _dhpk_ci_paren=$((_dhpk_ci_paren - 1))
                    _dhpk_ci_cwd="${_dhpk_ci_cwd_stk[$_dhpk_ci_paren]}"
                    _dhpk_ci_cwd_state="${_dhpk_ci_state_stk[$_dhpk_ci_paren]}"
                    matched=1
                else
                    matched=0
                fi
                if [ "$_dhpk_ci_any_cd" -eq 1 ] && { [ "$_dhpk_ci_case" -eq 1 ] || [ "$matched" -eq 0 ]; }; then
                    _dhpk_ci_cwd_state="unresolved"
                    _dhpk_ci_cwd=""
                fi
                DHPK_STRIPPED="${DHPK_STRIPPED})"
                i=$((i + 1))
                continue
                ;;
            '>')
                if [ "$next" = "(" ]; then
                    _dhpk_ci_list "$text" $((i + 2)) subst
                    _dhpk_ci_sub_word "$text" "$i" "$_dhpk_ci_end"
                    i="$_dhpk_ci_end"
                    continue
                fi
                _dhpk_ci_start_redirect
                case "$next" in
                    '>'|'|'|'&') ch="${ch}${next}" ;;
                esac
                DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                i=$((i + ${#ch}))
                continue
                ;;
            '<')
                case "$next" in
                    '>')
                        _dhpk_ci_start_redirect
                        DHPK_STRIPPED="${DHPK_STRIPPED}<>"
                        _dhpk_ci_seg="${_dhpk_ci_seg}<>"
                        i=$((i + 2))
                        continue
                        ;;
                    '(')
                        _dhpk_ci_list "$text" $((i + 2)) subst
                        _dhpk_ci_sub_word "$text" "$i" "$_dhpk_ci_end"
                        i="$_dhpk_ci_end"
                        continue
                        ;;
                    '<')
                        _dhpk_ci_start_redirect
                        if [ "${text:$((i + 2)):1}" = "<" ]; then
                            # Here-string: the next word is stdin data.
                            _dhpk_ci_redir=2
                            ch="<<<"
                        else
                            _dhpk_ci_redir=0
                            ch="<<"
                            [ "${text:$((i + 2)):1}" = "-" ] && ch="<<-"
                            _dhpk_ci_hd_delim "$text" $((i + ${#ch}))
                            _dhpk_ci_hd_d+=("$_dhpk_ci_hd_word")
                            _dhpk_ci_hd_q+=("$_dhpk_ci_hd_quoted")
                            if [ "$ch" = "<<-" ]; then _dhpk_ci_hd_t+=(1); else _dhpk_ci_hd_t+=(0); fi
                            ch="${text:$i:$((_dhpk_ci_end - i))}"
                        fi
                        DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                        _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                        i=$((i + ${#ch}))
                        continue
                        ;;
                esac
                ;;
            '&')
                if [ "$next" = ">" ]; then
                    _dhpk_ci_start_redirect
                    ch="&>"
                    [ "${text:$((i + 2)):1}" = ">" ] && ch="&>>"
                    DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                    _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                    i=$((i + ${#ch}))
                    continue
                fi
                if [ "$next" = "&" ]; then
                    _dhpk_ci_flush_command and
                    DHPK_STRIPPED="${DHPK_STRIPPED}&&"
                    i=$((i + 2))
                else
                    _dhpk_ci_flush_command bg
                    DHPK_STRIPPED="${DHPK_STRIPPED}&"
                    i=$((i + 1))
                fi
                continue
                ;;
            '|')
                if [ "$next" = "|" ]; then
                    _dhpk_ci_flush_command or
                    DHPK_STRIPPED="${DHPK_STRIPPED}||"
                    i=$((i + 2))
                elif [ "$next" = "&" ]; then
                    _dhpk_ci_flush_command pipe
                    DHPK_STRIPPED="${DHPK_STRIPPED}|&"
                    i=$((i + 2))
                else
                    _dhpk_ci_flush_command pipe
                    DHPK_STRIPPED="${DHPK_STRIPPED}|"
                    i=$((i + 1))
                fi
                continue
                ;;
            '$')
                _dhpk_ci_exec_context 1
                if _dhpk_ci_expand "$text" "$i" 0; then
                    _dhpk_ci_sub_word "$text" "$i" "$_dhpk_ci_end"
                    i="$_dhpk_ci_end"
                    continue
                fi
                _dhpk_ci_word_dyn=1
                if [ "$next" = '$' ]; then
                    # $$ is the PID parameter: the second $ cannot start a
                    # $'...' string, so a following quote is an ordinary one.
                    _dhpk_ci_word="${_dhpk_ci_word}\$\$"
                    _dhpk_ci_word_open=1
                    DHPK_STRIPPED="${DHPK_STRIPPED}\$\$"
                    _dhpk_ci_seg="${_dhpk_ci_seg}\$\$"
                    i=$((i + 2))
                    continue
                fi
                if [ "$next" = "'" ]; then
                    _dhpk_ci_ansi_end "$text" $((i + 2))
                    _dhpk_ci_ansi_decode "${text:$((i + 2)):$((_dhpk_ci_ansi_close - i - 2))}"
                    _dhpk_ci_word="${_dhpk_ci_word}${_dhpk_ci_ansi_out}"
                    _dhpk_ci_word_open=1
                    _dhpk_ci_word_q=1
                    DHPK_STRIPPED="${DHPK_STRIPPED}${text:$i:$((_dhpk_ci_ansi_close - i + 1))}"
                    _dhpk_ci_seg="${_dhpk_ci_seg}${text:$i:$((_dhpk_ci_ansi_close - i + 1))}"
                    i=$((_dhpk_ci_ansi_close + 1))
                    continue
                fi
                if [ "$next" = '"' ]; then
                    _dhpk_ci_mode="double"
                    _dhpk_ci_word_open=1
                    _dhpk_ci_word_q=1
                    DHPK_STRIPPED="${DHPK_STRIPPED}\$${next}"
                    _dhpk_ci_seg="${_dhpk_ci_seg}\$${next}"
                    i=$((i + 2))
                    continue
                fi
                ;;
            '`')
                _dhpk_ci_exec_context 1
                _dhpk_ci_expand "$text" "$i" 0
                _dhpk_ci_sub_word "$text" "$i" "$_dhpk_ci_end"
                i="$_dhpk_ci_end"
                continue
                ;;
            '~')
                if [ -z "$_dhpk_ci_word" ]; then
                    _dhpk_ci_word_dyn=1
                fi
                ;;
        esac
        _dhpk_ci_word="${_dhpk_ci_word}${ch}"
        _dhpk_ci_word_open=1
        DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
        _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
        i=$((i + 1))
    done
    _dhpk_ci_flush_command compound
    _dhpk_ci_end="$len"
    return 0
}

# dhpk_inspect_command <command> [start-cwd]
#   Fills DHPK_GIT_*, DHPK_WORDS, DHPK_CMD_*, DHPK_REDIRECT_TARGETS,
#   DHPK_STRIPPED and DHPK_UNSUPPORTED. start-cwd defaults to the process pwd.
dhpk_inspect_command() {
    local cmd="$1"
    local start="${2:-}"
    [ -n "$start" ] || start="$(pwd -P 2>/dev/null || pwd)"
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
    DHPK_START_CWD="$start"
    DHPK_REDIRECT_TARGETS=()
    DHPK_UNSUPPORTED=""
    # A process substitution or a FIFO can carry a cat heredoc into a shell.
    DHPK_HD_FORCE_EXEC=0
    case "$cmd" in
        *'>('*|*mkfifo*) DHPK_HD_FORCE_EXEC=1 ;;
    esac
    _dhpk_ci_cwd="$start"
    _dhpk_ci_cwd_state="literal"
    _dhpk_ci_exec_next=0
    _dhpk_ci_depth=0
    _dhpk_ci_list "$cmd" 0 top
    unset _dhpk_ci_cwd _dhpk_ci_cwd_state _dhpk_ci_end _dhpk_ci_head _dhpk_ci_exec_next _dhpk_ci_depth
    unset _dhpk_ci_hd_word _dhpk_ci_hd_quoted
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
