#!/usr/bin/env bash
# command-inspect.sh — bounded command segments and git argv for hook gates.
# Source-only. bash 3.2. Never executes the command under inspection.
#
# Support boundary:
#   Compound separators are unquoted ';', '&&', '||', '&', and newlines.
#   An unquoted '#' starts a comment through the end of that line. A '#'
#   inside quotes is data. Quoted words are single argv elements.
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
#   --work-tree, an unknown global option, a subshell, or 'cd' in the same
#   pipeline also leaves the repository unresolved. Unresolved does not fall
#   back to the session checkout.

# dhpk_norm_path <base> <rel>
#   Lexical join. Does not touch the filesystem.
dhpk_norm_path() {
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
    printf '%s' "$out"
    return 0
}

_dhpk_ci_reset_words() {
    _dhpk_ci_words=()
    _dhpk_ci_dyn=()
    _dhpk_ci_word=""
    _dhpk_ci_word_dyn=0
}

_dhpk_ci_flush_word() {
    if [ -n "$_dhpk_ci_word" ] || [ "$_dhpk_ci_word_open" -eq 1 ]; then
        if [ "$_dhpk_ci_redir" -eq 1 ]; then
            DHPK_REDIRECT_TARGETS+=("$_dhpk_ci_word")
            _dhpk_ci_redir=0
        else
            _dhpk_ci_words+=("$_dhpk_ci_word")
            _dhpk_ci_dyn+=("$_dhpk_ci_word_dyn")
        fi
    fi
    _dhpk_ci_word=""
    _dhpk_ci_word_dyn=0
    _dhpk_ci_word_open=0
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
    while [ "$i" -lt "$n" ]; do
        word="${_dhpk_ci_words[$i]}"
        case "$word" in
            *=*) i=$((i + 1)) ;;
            *) break ;;
        esac
    done
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
                    c_base="$(dhpk_norm_path "$c_base" "${_dhpk_ci_words[$i]}")"
                    c_path="$c_base"
                fi
                i=$((i + 1))
                ;;
            -C*)
                if [ "$dyn" = "1" ]; then
                    state="unresolved"
                else
                    [ -n "$c_base" ] || c_base="$_dhpk_ci_cwd"
                    c_base="$(dhpk_norm_path "$c_base" "${word#-C}")"
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
        repo="$(dhpk_norm_path "$_dhpk_ci_cwd" "$c_path")"
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

_dhpk_ci_flush_command() {
    local sep="$1"
    _dhpk_ci_flush_word
    _dhpk_ci_redir=0
    if [ "${#_dhpk_ci_words[@]}" -gt 0 ]; then
        local head="${_dhpk_ci_words[0]}"
        DHPK_CMD_START+=("${#DHPK_WORDS[@]}")
        DHPK_CMD_LEN+=("${#_dhpk_ci_words[@]}")
        DHPK_WORDS+=("${_dhpk_ci_words[@]}")
        _dhpk_ci_record_git
        if [ "$head" = "cd" ]; then
            if [ "$sep" = "pipe" ]; then
                _dhpk_ci_pipeline_cd=1
            elif [ "$_dhpk_ci_cwd_state" = "literal" ] && [ "${#_dhpk_ci_words[@]}" -eq 2 ] && [ "${_dhpk_ci_dyn[1]}" != "1" ]; then
                _dhpk_ci_cwd="$(dhpk_norm_path "$_dhpk_ci_cwd" "${_dhpk_ci_words[1]}")"
            else
                _dhpk_ci_cwd_state="unresolved"
                _dhpk_ci_cwd=""
            fi
        fi
    fi
    if [ "$sep" != "pipe" ]; then
        _dhpk_ci_pipeline_cd=0
        _dhpk_ci_seg=""
    fi
    _dhpk_ci_reset_words
}

# _dhpk_ci_ansi_escape <text> <index>
#   Decodes the $'...' escape whose letter is at <index> (just after the
#   backslash). Sets _dhpk_ci_esc_out to the decoded text and _dhpk_ci_esc_len
#   to the number of characters consumed from <index>. Unknown escapes and
#   non-ASCII \u / \U values keep their backslash form, as bash 3.2 does.
_dhpk_ci_ansi_escape() {
    local text="$1" at="$2" ch digits="" max=0 k d
    ch="${text:$at:1}"
    _dhpk_ci_esc_len=1
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
        [0-7]) max=3; k=$at ;;
        x) max=2; k=$((at + 1)) ;;
        u) max=4; k=$((at + 1)) ;;
        U) max=8; k=$((at + 1)) ;;
        *) _dhpk_ci_esc_out="\\$ch"; return 0 ;;
    esac
    while [ "${#digits}" -lt "$max" ]; do
        d="${text:$k:1}"
        case "$ch" in
            [0-7]) case "$d" in [0-7]) ;; *) break ;; esac ;;
            *) case "$d" in [0-9a-fA-F]) ;; *) break ;; esac ;;
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
        [0-7]) printf -v _dhpk_ci_esc_out '%b' "\\0$digits" ;;
        x) printf -v _dhpk_ci_esc_out '%b' "\\x$digits" ;;
        *)
            if [ $((16#$digits)) -lt 128 ]; then
                printf -v d '%x' $((16#$digits))
                printf -v _dhpk_ci_esc_out '%b' "\\x$d"
            else
                _dhpk_ci_esc_out="\\$ch$digits"
            fi
            ;;
    esac
    return 0
}

# _dhpk_ci_start_redirect
#   Called at an unquoted redirect operator. A pending all-digit word is the
#   fd number and is dropped; any other pending word is an argv word.
_dhpk_ci_start_redirect() {
    case "$_dhpk_ci_word" in
        ""|*[!0-9]*) _dhpk_ci_flush_word ;;
        *) _dhpk_ci_word=""; _dhpk_ci_word_dyn=0; _dhpk_ci_word_open=0 ;;
    esac
    _dhpk_ci_redir=1
}

# dhpk_inspect_command <command> [start-cwd]
#   Fills DHPK_GIT_* and DHPK_STRIPPED. start-cwd defaults to the process pwd.
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
    DHPK_REDIRECT_TARGETS=()
    _dhpk_ci_cwd="$start"
    _dhpk_ci_cwd_state="literal"
    _dhpk_ci_pipeline_cd=0
    _dhpk_ci_seg=""
    _dhpk_ci_mode="normal"
    _dhpk_ci_word_open=0
    _dhpk_ci_redir=0
    _dhpk_ci_reset_words

    local i=0 len="${#cmd}" ch next
    while [ "$i" -lt "$len" ]; do
        ch="${cmd:$i:1}"
        next=""
        if [ $((i + 1)) -lt "$len" ]; then
            next="${cmd:$((i + 1)):1}"
        fi
        if [ "$_dhpk_ci_mode" = "comment" ]; then
            if [ "$ch" = $'\n' ]; then
                _dhpk_ci_flush_command compound
                _dhpk_ci_mode="normal"
                DHPK_STRIPPED="${DHPK_STRIPPED}"$'\n'
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
        if [ "$_dhpk_ci_mode" = "ansi" ]; then
            if [ "$ch" = "\\" ] && [ -n "$next" ]; then
                _dhpk_ci_ansi_escape "$cmd" $((i + 1))
                _dhpk_ci_word="${_dhpk_ci_word}${_dhpk_ci_esc_out}"
                DHPK_STRIPPED="${DHPK_STRIPPED}${cmd:$i:$((_dhpk_ci_esc_len + 1))}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${cmd:$i:$((_dhpk_ci_esc_len + 1))}"
                i=$((i + 1 + _dhpk_ci_esc_len))
                continue
            fi
            DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
            _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
            if [ "$ch" = "'" ]; then
                _dhpk_ci_mode="normal"
            else
                _dhpk_ci_word="${_dhpk_ci_word}${ch}"
            fi
            i=$((i + 1))
            continue
        fi
        if [ "$_dhpk_ci_mode" = "double" ]; then
            DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
            _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
            if [ "$ch" = "\\" ] && [ -n "$next" ]; then
                _dhpk_ci_word="${_dhpk_ci_word}${next}"
                _dhpk_ci_word_open=1
                DHPK_STRIPPED="${DHPK_STRIPPED}${next}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${next}"
                i=$((i + 2))
                continue
            fi
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
                    DHPK_STRIPPED="${DHPK_STRIPPED}${next}"
                    _dhpk_ci_seg="${_dhpk_ci_seg}${next}"
                    i=$((i + 2))
                    continue
                fi
                ;;
            "'")
                _dhpk_ci_mode="single"
                _dhpk_ci_word_open=1
                DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                i=$((i + 1))
                continue
                ;;
            '"')
                _dhpk_ci_mode="double"
                _dhpk_ci_word_open=1
                DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                i=$((i + 1))
                continue
                ;;
            '#')
                if [ -z "$_dhpk_ci_word" ]; then
                    _dhpk_ci_mode="comment"
                    i=$((i + 1))
                    continue
                fi
                ;;
            ' '|$'\t'|$'\r')
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
                continue
                ;;
            ';')
                _dhpk_ci_flush_command compound
                DHPK_STRIPPED="${DHPK_STRIPPED};"
                i=$((i + 1))
                continue
                ;;
            '>')
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
                if [ "$next" = ">" ]; then
                    _dhpk_ci_start_redirect
                    DHPK_STRIPPED="${DHPK_STRIPPED}<>"
                    _dhpk_ci_seg="${_dhpk_ci_seg}<>"
                    i=$((i + 2))
                    continue
                fi
                ;;
            '&')
                if [ "$next" = ">" ]; then
                    _dhpk_ci_start_redirect
                    ch="&>"
                    [ "${cmd:$((i + 2)):1}" = ">" ] && ch="&>>"
                    DHPK_STRIPPED="${DHPK_STRIPPED}${ch}"
                    _dhpk_ci_seg="${_dhpk_ci_seg}${ch}"
                    i=$((i + ${#ch}))
                    continue
                fi
                if [ "$next" = "&" ]; then
                    _dhpk_ci_flush_command compound
                    DHPK_STRIPPED="${DHPK_STRIPPED}&&"
                    i=$((i + 2))
                else
                    _dhpk_ci_flush_command compound
                    DHPK_STRIPPED="${DHPK_STRIPPED}&"
                    i=$((i + 1))
                fi
                continue
                ;;
            '|')
                if [ "$next" = "|" ]; then
                    _dhpk_ci_flush_command compound
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
                _dhpk_ci_word_dyn=1
                if [ "$next" = "'" ] || [ "$next" = '"' ]; then
                    if [ "$next" = "'" ]; then
                        _dhpk_ci_mode="ansi"
                    else
                        _dhpk_ci_mode="double"
                    fi
                    _dhpk_ci_word_open=1
                    DHPK_STRIPPED="${DHPK_STRIPPED}\$${next}"
                    _dhpk_ci_seg="${_dhpk_ci_seg}\$${next}"
                    i=$((i + 2))
                    continue
                fi
                ;;
            '`')
                _dhpk_ci_word_dyn=1
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
    unset _dhpk_ci_cwd _dhpk_ci_cwd_state _dhpk_ci_pipeline_cd _dhpk_ci_seg _dhpk_ci_mode
    unset _dhpk_ci_word _dhpk_ci_word_dyn _dhpk_ci_word_open _dhpk_ci_words _dhpk_ci_dyn _dhpk_ci_redir
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
