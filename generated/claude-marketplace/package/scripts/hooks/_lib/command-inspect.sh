#!/usr/bin/env bash
# command-inspect.sh — bounded command segments and git argv for hook gates.
# Source-only. bash 3.2. Never executes the command under inspection.
#
# Support boundary:
#   Compound separators are unquoted ';', '&&', '||', '&', and newlines.
#   An unquoted '#' starts a comment through the end of that line. A '#'
#   inside quotes is data. Quoted words are single argv elements.
#   A git command is an argv whose first word is git, 'command git', or a
#   path whose basename is git, after leading VAR=value assignments.
#   Literal 'cd <path>' and 'git -C <path>' select the repository. A path
#   containing '$', a backtick, '~', or a glob is unresolved. --git-dir,
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
        _dhpk_ci_words+=("$_dhpk_ci_word")
        _dhpk_ci_dyn+=("$_dhpk_ci_word_dyn")
    fi
    _dhpk_ci_word=""
    _dhpk_ci_word_dyn=0
    _dhpk_ci_word_open=0
}

_dhpk_ci_record_git() {
    local i=0 n="${#_dhpk_ci_words[@]}" sub="" state="cwd" repo="$_dhpk_ci_cwd" c_path="" no_verify=0 exempt=0
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
                    c_path="${_dhpk_ci_words[$i]}"
                fi
                i=$((i + 1))
                ;;
            -C*)
                c_path="${word#-C}"
                [ "$dyn" = "1" ] && state="unresolved"
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
        j=$((j + 1))
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
    if [ "${#_dhpk_ci_words[@]}" -gt 0 ]; then
        local head="${_dhpk_ci_words[0]}"
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
    DHPK_GIT_NO_VERIFY=()
    DHPK_GIT_EXEMPT=()
    DHPK_GIT_SEGMENT=()
    DHPK_STRIPPED=""
    _dhpk_ci_cwd="$start"
    _dhpk_ci_cwd_state="literal"
    _dhpk_ci_pipeline_cd=0
    _dhpk_ci_seg=""
    _dhpk_ci_mode="normal"
    _dhpk_ci_word_open=0
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
            '&')
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
            '$'|'`')
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
    unset _dhpk_ci_word _dhpk_ci_word_dyn _dhpk_ci_word_open _dhpk_ci_words _dhpk_ci_dyn
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
