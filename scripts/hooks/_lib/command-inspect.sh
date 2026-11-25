#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2154  # globals are shared with the sibling modules
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
#     is inspected as its own command list. A <<< word is stdin data. A
#     function whose body runs a shell, a pipe into a shell or `.`, and a
#     process substitution used as that script are judged when the text is
#     visible. A stdin device (/dev/stdin, /dev/fd/0, /proc/self/fd/0) is
#     that script. Text written into >(shell) or tee >(shell) is too.
#     Input whose text is not visible stays unresolved.
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
    _dhpk_ci_split=()
    _dhpk_ci_word=""
    _dhpk_ci_word_flat=""
    _dhpk_ci_word_dyn=0
    _dhpk_ci_word_split=0
    _dhpk_ci_word_q=0
    _dhpk_ci_hs_words=()
    _dhpk_ci_hs_dyn=()
    _dhpk_ci_hs_flat=()
    _dhpk_ci_ps_at=()
    _dhpk_ci_ps_body=()
    _dhpk_ci_ps_ok=()
    _dhpk_ci_ps_hold=0
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
            if [ "${_dhpk_ci_ps_hold:-0}" = "1" ]; then
                _dhpk_ci_ps_at+=("${#_dhpk_ci_words[@]}")
                _dhpk_ci_ps_body+=("${_dhpk_ci_ps_hold_text:-}")
                _dhpk_ci_ps_ok+=("${_dhpk_ci_ps_hold_known:-0}")
                _dhpk_ci_ps_hold=0
            fi
            _dhpk_ci_words+=("$_dhpk_ci_word")
            _dhpk_ci_dyn+=("$_dhpk_ci_word_dyn")
            _dhpk_ci_quoted+=("$_dhpk_ci_word_q")
            _dhpk_ci_words_flat+=("$_dhpk_ci_word_flat")
            _dhpk_ci_split+=("$_dhpk_ci_word_split")
        fi
    fi
    _dhpk_ci_word=""
    _dhpk_ci_word_flat=""
    _dhpk_ci_word_dyn=0
    _dhpk_ci_word_split=0
    _dhpk_ci_word_open=0
    _dhpk_ci_word_q=0
}

# (#1468) True when word $1 is a long option with its value attached (--message=VALUE) and the word has no
# expansion that can split (arg 2 is its split mark): the whole word is that option's one argument, never
# a separate flag. A split-capable word (--message="a "$1) is judged like any other dynamic word.
_dhpk_ci_attached_value_word() {
    [ "$2" = "1" ] && return 1
    case "$1" in
        --*=*) _dhpk_ci_option_consumes_next "${1%%=*}" ;;
        *) return 1 ;;
    esac
}

# (#1468) The value word of an option that takes one (word index $1, subcommand $2) is no flag, unless its
# expansion can split into several words: then the rest of the words are arguments. Such a word is judged
# like any other dynamic word. Sets _dhpk_ci_flag_hit.
_dhpk_ci_option_value_hit() {
    _dhpk_ci_flag_hit=""
    [ "${_dhpk_ci_u_dyn[$1]:-0}" = "1" ] && [ "${_dhpk_ci_u_split[$1]:-0}" = "1" ] || return 0
    _dhpk_ci_dyn_git_flag "${_dhpk_ci_u_words[$1]}" "$2" 1
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
        unbuffer|*/unbuffer|flock|*/flock|watch|*/watch) return 0 ;;
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

# True when an export/declare/typeset/local operand names a relocating Git
# variable. The operand may be NAME, NAME=value, or NAME+=value. The value
# is not read.
_dhpk_ci_word_sets_git_env() {
    local word="$1" name
    case "$word" in
        *=*)
            _dhpk_ci_is_git_env_var "$word" && return 0
            name="${word%%+=*}"
            [ "$name" != "$word" ] && _dhpk_ci_is_git_env_var "${name}=" && return 0
            ;;
        *)
            _dhpk_ci_is_git_env_var "${word}=" && return 0
            ;;
    esac
    return 1
}

# _dhpk_ci_apply_set_allexport <index>
#   Updates _dhpk_ci_allexport from a set command's operands. set -a, set -o
#   allexport, and a short-flag cluster that contains a turn it on. set +a
#   and set +o allexport turn it off. Turning it off does not clear
#   _dhpk_ci_git_env_sticky. Options end at -- or the first non-option word.
#   A trailing o in a cluster, or a word that is exactly -o or +o, takes the
#   next word as the option name. An o earlier in the cluster is only the
#   short flag, so set -oa still sees a.
_dhpk_ci_apply_set_allexport() {
    local k="$1" n="${#_dhpk_ci_u_words[@]}" w sign body oi olen ch
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            --) return 0 ;;
            [-+]*) ;;
            *) return 0 ;;
        esac
        sign=1
        [ "${w:0:1}" = "+" ] && sign=0
        body="${w:1}"
        [ -n "$body" ] || return 0
        oi=0
        olen="${#body}"
        while [ "$oi" -lt "$olen" ]; do
            ch="${body:$oi:1}"
            if [ "$ch" = "a" ]; then
                _dhpk_ci_allexport="$sign"
            elif [ "$ch" = "o" ] && [ $((oi + 1)) -eq "$olen" ]; then
                k=$((k + 1))
                if [ "${_dhpk_ci_u_words[$k]:-}" = "allexport" ]; then
                    _dhpk_ci_allexport="$sign"
                fi
                break
            fi
            oi=$((oi + 1))
        done
        k=$((k + 1))
    done
}

# A visibly assigned value that names git and is later used as a command word
# or a shell -c payload hides the git call from the text scan. Taint is kept
# per variable name over the whole command text, so use before the textual
# assignment (loops, functions) is covered. A value is provably read-only only
# when it is one simple git command with a listed read-only subcommand; any
# separator, substitution, second git word, --no-verify or mutation is risky.
# With a custom IFS in the text any git substring is risky (word splitting
# can rebuild the words). A bare git value (g=git) stays with the subcommand
# check at the use site.
_dhpk_ci_git_value_risky() {
    local raw="$1" val ifs="$2" i=1 n sub
    _dhpk_ci_lower "$1"
    val="$_dhpk_ci_lc"
    local -a ws_a
    # Folded: ${l,,}, ${l^^}, ${l~~} and ${l@L} can rebuild git from other case.
    if [ "$ifs" = "1" ]; then
        case "$val" in *git*) return 0 ;; esac
        return 1
    fi
    _dhpk_ci_word_mentions_git "$val" || return 1
    case "$val" in
        *--no-verify*|*';'*|*'&'*|*'|'*|*$'\n'*|*'$('*|*'`'*|*'('*|*'<'*|*'>'*) return 0 ;;
    esac
    # Words keep their case (-C is not -c); the folded text only decides
    # whether git is named and whether a mutation marker is present.
    read -r -a ws_a <<<"$raw"
    n="${#ws_a[@]}"
    case "${ws_a[0]:-}" in
        git|*/git) ;;
        *) return 0 ;;
    esac
    [ "$n" -gt 1 ] || return 1
    while [ "$i" -lt "$n" ]; do
        case "${ws_a[$i]}" in
            -C) i=$((i + 2)) ;;
            --no-pager|-P|--paginate|-p) i=$((i + 1)) ;;
            *) break ;;
        esac
    done
    [ "$i" -lt "$n" ] || return 0
    sub="${ws_a[$i]}"
    i=$((i + 1))
    case "$sub" in
        status|log|diff|show|rev-parse|ls-files|ls-tree|describe|blame|shortlog|cat-file|rev-list) ;;
        branch)
            while [ "$i" -lt "$n" ]; do
                case "${ws_a[$i]}" in
                    --show-current|-a|-r|-v|-vv|--list|-l|--all|--remotes) ;;
                    *) return 0 ;;
                esac
                i=$((i + 1))
            done
            return 1
            ;;
        stash|worktree)
            [ "${ws_a[$i]:-}" = "list" ] || return 0
            ;;
        *) return 0 ;;
    esac
    # A later word naming git (second git) is not provably read-only.
    while [ "$i" -lt "$n" ]; do
        _dhpk_ci_word_mentions_git "${ws_a[$i]}" && return 0
        i=$((i + 1))
    done
    return 1
}

_dhpk_ci_taint_add() {
    case "$_dhpk_ci_git_taint" in
        *" $1 "*) ;;
        *) _dhpk_ci_git_taint="${_dhpk_ci_git_taint}$1 " ;;
    esac
}

# Word-level view: one NAME=value word (prefix, export, declare, local).
_dhpk_ci_note_git_assign() {
    local w="$1" name val
    case "$w" in
        [A-Za-z_]*=*) ;;
        *) return 0 ;;
    esac
    name="${w%%=*}"
    name="${name%+}"
    name="${name%%\[*}"
    val="${w#*=}"
    val="${val#(}"
    val="${val%)}"
    if _dhpk_ci_git_value_risky "$val" "${_dhpk_ci_taint_ifs:-0}"; then
        _dhpk_ci_taint_add "$name"
    fi
}

# ASCII-only lowercase of $1 into _dhpk_ci_lc. Pure bash 3.2: no child process,
# no locale dependence and no failure path, so an unlowerable value can never
# read as empty and allow. A non-ASCII byte passes through unchanged.
_dhpk_ci_lower() {
    local s="$1"
    case "$s" in
        *[ABCDEFGHIJKLMNOPQRSTUVWXYZ]*)
            s="${s//A/a}"; s="${s//B/b}"; s="${s//C/c}"; s="${s//D/d}"; s="${s//E/e}"
            s="${s//F/f}"; s="${s//G/g}"; s="${s//H/h}"; s="${s//I/i}"; s="${s//J/j}"
            s="${s//K/k}"; s="${s//L/l}"; s="${s//M/m}"; s="${s//N/n}"; s="${s//O/o}"
            s="${s//P/p}"; s="${s//Q/q}"; s="${s//R/r}"; s="${s//S/s}"; s="${s//T/t}"
            s="${s//U/u}"; s="${s//V/v}"; s="${s//W/w}"; s="${s//X/x}"; s="${s//Y/y}"
            s="${s//Z/z}"
            ;;
    esac
    _dhpk_ci_lc="$s"
}

# True when $1 holds a byte above 0x7F, or an ANSI-C escape that can produce one
# ($'\xHH', \u, \U, octal). A UTF-8 bash folds such bytes in ${l,,} (U+0130 to i),
# which the ASCII-only fold above cannot see.
_dhpk_ci_nonascii() {
    local LC_ALL=C
    case "$1" in
        *[!$'\001'-$'\177']*) return 0 ;;
        *\\[xuU0-7]*) return 0 ;;
    esac
    return 1
}

# True when a value holds a transform expansion of a variable that names git or is tainted.
_dhpk_ci_value_transforms_git() {
    local name re
    case "$1" in
        *'${'*) ;;
        *) return 1 ;;
    esac
    for name in ${_dhpk_ci_git_named:-} ${_dhpk_ci_git_taint:-} ${_dhpk_ci_nonascii_names:-}; do
        re='\$\{'$name'(\[[^]]*\])?[/#%:@^,~]'
        [[ "$1" =~ $re ]] && return 0
    done
    return 1
}

# True when a value expands one of the space-separated names in $2 (a copy of rebuilt git text).
_dhpk_ci_value_copies() {
    local name re
    for name in $2; do
        re='\$\{?'$name'([^A-Za-z0-9_]|$)'
        [[ "$1" =~ $re ]] && return 0
    done
    return 1
}

# (#1460) Flag variables: names whose assigned value holds a word that starts with a dash, kept
# with their value so an expansion in git commit or push argument position can be judged.
_dhpk_ci_flag_clear() {
    local name
    for name in ${_dhpk_ci_flag_names:-}; do
        unset "_dhpk_ci_fv_$name"
    done
    _dhpk_ci_flag_names=" "
    _dhpk_ci_pos_pool=""
    _dhpk_ci_pos_opaque=0
    _dhpk_ci_pos_segs=0
    _dhpk_ci_pos_words=0
    _dhpk_ci_cmd_text=""
    _dhpk_ci_bound_names=" "
    _dhpk_ci_fs_anyname=0
    _dhpk_ci_fs_overflow=0
    _dhpk_ci_taint_overflow=0
    _dhpk_ci_fn_overflow=0
    _dhpk_ci_copies_clear
}

# True when a value text mentions an already recorded flag variable name.
_dhpk_ci_flag_refs_known() {
    local name
    for name in ${_dhpk_ci_flag_names:-}; do
        case "$1" in *"$name"*) return 0 ;; esac
    done
    return 1
}

# Records a flag variable. A value that is appended to (arg 3 is 1), holds quotes or a backslash, or
# is copied from another flag variable cannot be compared literally and is stored as opaque.
_dhpk_ci_note_flag_var() {
    local opaque=0 val="$2"
    case "$val" in
        *' -'*) ;;
        *\\[0-9A-Za-z]*) ;;
        *'$'*) _dhpk_ci_flag_refs_known "$val" || return 0 ;;
        *) return 0 ;;
    esac
    case "$val" in
        *[\"\'\\]*) opaque=1 ;;
        *'$'*) _dhpk_ci_flag_refs_known "$val" && opaque=1 ;;
    esac
    [ "${3:-0}" = "1" ] && opaque=1
    [ "$opaque" = "1" ] && val="@opaque"
    case "$_dhpk_ci_flag_names" in
        *" $1 "*) return 0 ;;
    esac
    _dhpk_ci_flag_names="${_dhpk_ci_flag_names}$1 "
    printf -v "_dhpk_ci_fv_$1" '%s' "$val"
}

# True when a stored flag value holds --no-verify, or (commit only) a short cluster with n.
_dhpk_ci_flag_value_no_verify() {
    local fw
    local -a fv_a
    read -r -a fv_a <<<"$1"
    for fw in "${fv_a[@]}"; do
        case "$fw" in
            --no-verify|--no-verify=*|--no-veri|--no-verif|--no-veri=*|--no-verif=*) return 0 ;;
        esac
        [ "$2" = "commit" ] && _dhpk_ci_commit_short_no_verify "$fw" && return 0
    done
    return 1
}

# Judges a dynamic word in git commit or push argument position. Sets _dhpk_ci_flag_hit to
# no-verify (the expansion yields --no-verify), transformed (a transform of a flag variable
# can rebuild any flag), or empty. Arg 3 is 1 when the word has an expansion that can split into words.
_dhpk_ci_dyn_git_flag() {
    local name re var
    _dhpk_ci_flag_hit=""
    case "$2" in
        commit|push) ;;
        *) return 0 ;;
    esac
    case "$1" in
        *--no-verify*) _dhpk_ci_flag_hit="no-verify"; return 0 ;;
        *'$'*) _dhpk_ci_flag_prefix_hit "$1" && return 0 ;;
    esac
    _dhpk_ci_flag_word_dq_literal "$1" "${3:-0}" && return 0
    # (#1468) A text with too many sources to scan, the last argument ($_), a tilde that can name a
    # flag through HOME, PWD or OLDPWD, and a variable bound under a name this scan could not read
    # (a built name) cannot be judged.
    if [ "${_dhpk_ci_fs_overflow:-0}" = "1" ] || _dhpk_ci_flag_word_unjudged "$1"; then
        _dhpk_ci_flag_hit="transformed"
        return 0
    fi
    # (#1462) Default operators, positional parameters and indirect expansion are judged first.
    _dhpk_ci_flag_default_hit "$1" "$2" && return 0
    _dhpk_ci_flag_positional_hit "$1" "$2" && return 0
    # (#1468) Any other use of a positional parameter (a slice, a transform, $10) can rebuild a flag.
    re='\$(\{[#!]?)?[0-9@*]'
    if [[ "$1" =~ $re ]]; then
        _dhpk_ci_flag_hit="transformed"
        return 0
    fi
    _dhpk_ci_flag_indirect_hit "$1" "$2" && return 0
    for name in ${_dhpk_ci_flag_names:-}; do
        case "$1" in
            *"$name"*) ;;
            *) continue ;;
        esac
        re='\$\{'$name'(\[[^]]*\])?[/#%:@^,~]'
        if [[ "$1" =~ $re ]]; then
            _dhpk_ci_flag_hit="transformed"
            return 0
        fi
        re='\$\{?'$name'([^A-Za-z0-9_]|$)'
        [[ "$1" =~ $re ]] || continue
        var="_dhpk_ci_fv_$name"
        if [ "${!var}" = "@opaque" ] || _dhpk_ci_flag_word_extra "$1" "$name"; then
            _dhpk_ci_flag_hit="transformed"
            return 0
        fi
        if _dhpk_ci_flag_words_glob "${!var}" "$2"; then
            _dhpk_ci_flag_hit="transformed"
            return 0
        fi
        if _dhpk_ci_flag_value_no_verify "${!var}" "$2"; then
            _dhpk_ci_flag_hit="no-verify"
            return 0
        fi
    done
    _dhpk_ci_flag_bound_transform "$1" && _dhpk_ci_flag_hit="transformed"
    if [ -z "$_dhpk_ci_flag_hit" ] && _dhpk_ci_flag_word_list "$1" "${3:-0}"; then
        _dhpk_ci_flag_hit="transformed"
    fi
    return 0
}

# (#1468) True when word $1 expands to several words that no recorded variable explains: a word list
# ("$@" is judged earlier, "${a[@]}", "${!a[@]}", "${!p@}"), or key names of an array that can split
# (arg 2 is 1). The text that binds such an array is not read, so any of its words can be a flag.
_dhpk_ci_flag_word_list() {
    local re_list='\[@\]|@\}' re_keys='\$\{![A-Za-z_][A-Za-z0-9_]*\[\*\]'
    [[ "$1" =~ $re_list ]] && return 0
    [ "$2" = "1" ] && [[ "$1" =~ $re_keys ]]
}

# (#1468) True when dequoted word $1 is one argument git never reads as a flag: it starts with a literal
# non-dash, holds no quote, backslash, "$@", "${a[@]}" or "${!p@}" (those expand to several words), has
# no expansion outside double quotes (arg 2 is the word's split mark: "a "x$1" b" is not one quoted
# span), and every occurrence in the top-level text is written as one whole "WORD" with a blank before
# the opening quote and a blank or separator (; & | )) after the closing one.
# Words of a nested list (eval, bash -c, a heredoc or substitution body) re-read their quotes later.
_dhpk_ci_flag_word_dq_literal() {
    local w="$1" rest before k=0 re_lit='^[A-Za-z0-9_./:@+]' re_multi='\$\{?@|\[@\]|@\}'
    [ "${_dhpk_ci_depth:-0}" -le 1 ] || return 1
    [ "${2:-0}" = "1" ] && return 1
    [[ "$w" =~ $re_lit ]] || return 1
    case "$w" in *[\"\'\\]*) return 1 ;; esac
    [[ "$w" =~ $re_multi ]] && return 1
    rest=" ${_dhpk_ci_cmd_text:-} "
    [[ "$rest" == *"$w"* ]] || return 1
    while [[ "$rest" == *"$w"* ]]; do
        k=$((k + 1))
        [ "$k" -gt 64 ] && return 1
        before="${rest%%"$w"*}"
        rest="${rest#*"$w"}"
        [[ "$before" == *[[:space:]]\" ]] || return 1
        [[ "$rest" == \"[[:space:]\;\&\|\)]* ]] || return 1
    done
    return 0
}

# (#1468) True when word $1 is $_ , a leading tilde with HOME, PWD or OLDPWD in the text, or (after a
# variable bound under a built name) any variable reference.
_dhpk_ci_flag_word_unjudged() {
    local re_last='\$\{?_([^A-Za-z0-9_]|$)' re_home='(^|[^A-Za-z0-9_])(HOME|PWD|OLDPWD)([^A-Za-z0-9_]|$)'
    local re_any='\$\{?[!#]?[A-Za-z_]'
    [[ "$1" =~ $re_last ]] && return 0
    if [[ "$1" == '~'* ]] && [[ "${_dhpk_ci_cmd_text:-}" =~ $re_home ]]; then
        return 0
    fi
    [ "${_dhpk_ci_fs_anyname:-0}" = "1" ] && [[ "$1" =~ $re_any ]]
}

# (#1468) True when word $1 slices or transforms (${NAME:1}, ${NAME/a/b}, ${NAME%x}, ${NAME,,}) a
# variable that the text binds.
_dhpk_ci_flag_bound_transform() {
    local name re
    for name in ${_dhpk_ci_bound_names:-}; do
        case "$1" in *"$name"*) ;; *) continue ;; esac
        re='\$\{'$name'(\[[^]]*\])?([/#%^,~@]|:[^-=+?])'
        [[ "$1" =~ $re ]] && return 0
    done
    return 1
}

# (#1468) True when a word of the stored flag value $1 is a glob that can expand to a flag.
_dhpk_ci_flag_words_glob() {
    local gw
    local -a gw_a
    read -r -a gw_a <<<"$1"
    for gw in "${gw_a[@]}"; do
        _dhpk_ci_glob_may_flag "$gw" "$2" && return 0
    done
    return 1
}

# True (and sets transformed) when the literal text before the first dollar is a non-empty prefix of
# --no-verify, so the expansion can complete the flag.
_dhpk_ci_flag_prefix_hit() {
    local lit="${1%%\$*}"
    lit="${lit//\"/}"
    [ -n "$lit" ] || return 1
    [[ "--no-verify" == "$lit"* ]] || return 1
    _dhpk_ci_flag_hit="transformed"
}

# True when a word that references flag variable $2 holds anything beside that one reference.
_dhpk_ci_flag_word_extra() {
    local rest="${1//\$\{$2\}/}"
    rest="${rest//\$\{$2\[@\]\}/}"
    rest="${rest//\$\{$2\[\*\]\}/}"
    rest="${rest//\$$2/}"
    rest="${rest//\"/}"
    [ -n "$rest" ]
}

# (#1462) ${NAME<op>WORD} with a default operator in git commit or push argument position. NAME is a
# variable name, a positional digit, @ or *. A readable WORD is judged as a flag value; a recorded NAME
# (for a positional: the pooled words) also contributes its stored value, except for the alternative
# operators + and :+. Returns 0 when the word was handled (_dhpk_ci_flag_hit set).
_dhpk_ci_flag_default_hit() {
    local re='^\$\{([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[@*])(:?[-=+?])([^}]*)\}$'
    local w="${1//\"/}" name op word var stored="" recorded=0
    [[ "$w" =~ $re ]] || return 1
    name="${BASH_REMATCH[1]}"
    op="${BASH_REMATCH[2]}"
    word="${BASH_REMATCH[3]}"
    if [[ "$name" =~ ^[0-9@*] ]]; then
        if [ "${_dhpk_ci_pos_opaque:-0}" = "1" ]; then
            recorded=1
            stored="@opaque"
        elif [ -n "${_dhpk_ci_pos_pool:-}" ]; then
            recorded=1
            stored="$_dhpk_ci_pos_pool"
        fi
    else
        case "$_dhpk_ci_flag_names" in *" $name "*) recorded=1 ;; esac
        var="_dhpk_ci_fv_$name"
        [ "$recorded" = "1" ] && stored="${!var}"
    fi
    if ! _dhpk_ci_fs_value "$word"; then
        [ "$recorded" = "1" ] || return 1
        _dhpk_ci_flag_hit="transformed"
        return 0
    fi
    word="$_dhpk_ci_fs_uq"
    # (#1468) An escape whose result is not computed, or a glob that can expand to a flag, is judged first.
    if [ "$_dhpk_ci_fs_uncertain" = "1" ] || _dhpk_ci_glob_may_flag "$word" "$2"; then
        _dhpk_ci_flag_hit="transformed"
        return 0
    fi
    if _dhpk_ci_flag_value_no_verify " $word" "$2"; then
        _dhpk_ci_flag_hit="no-verify"
        return 0
    fi
    if _dhpk_ci_flag_abbrev " $word"; then
        _dhpk_ci_flag_hit="transformed"
        return 0
    fi
    [ "$recorded" = "1" ] || return 0
    if [[ ! "$name" =~ ^[0-9@*] ]]; then
        if [[ "$word" == *[\*\?\[]* ]] || ! _dhpk_ci_flag_trust_recorded "$name" "$stored"; then
            _dhpk_ci_flag_hit="transformed"
            return 0
        fi
    fi
    case "$op" in *+) return 0 ;; esac
    if [ "$stored" = "@opaque" ]; then
        _dhpk_ci_flag_hit="transformed"
    elif _dhpk_ci_flag_value_no_verify "$stored" "$2"; then
        _dhpk_ci_flag_hit="no-verify"
    fi
    return 0
}

# (#1468) True when pattern $1 holds a glob character and can expand to --no-verify (or its accepted
# abbreviations), or, for commit ($2), to a short flag cluster (a pattern that starts with one dash).
_dhpk_ci_glob_may_flag() {
    local pat="$1"
    case "$pat" in
        *[\*\?\[]*) ;;
        *) return 1 ;;
    esac
    # shellcheck disable=SC2053
    if [[ --no-verify == $pat || --no-verif == $pat || --no-veri == $pat ]]; then
        return 0
    fi
    [ "$2" = "commit" ] || return 1
    case "$pat" in
        --*) return 1 ;;
        -*) return 0 ;;
    esac
    return 1
}

# (#1462) True when a word of $1 is a proper prefix of --no-verify at least 3 characters long, which
# git accepts as an abbreviation.
_dhpk_ci_flag_abbrev() {
    local fw
    local -a fa_a
    read -r -a fa_a <<<"$1"
    for fw in "${fa_a[@]}"; do
        [ "${#fw}" -ge 3 ] && [ "$fw" != "--no-verify" ] && [[ "--no-verify" == "$fw"* ]] && return 0
    done
    return 1
}

# (#1462) True when the recorded value $2 of flag variable $1 can be trusted in a default expansion.
# The proof is structural, so no rebinding form has to be listed: the command text has no quote,
# backslash, backtick, $( , $' or $", none of the binding or evaluating builtins and no dot command,
# every dollar reference is to a recorded flag variable, the name is bound once (see
# _dhpk_ci_flag_bound_once), and the value holds no glob character or --no-verify abbreviation.
_dhpk_ci_flag_trust_recorded() {
    local text="${_dhpk_ci_cmd_text:-}" name text_nq re_ref k=0
    local re_kw='(^|[^A-Za-z0-9_])(declare|typeset|local|export|readonly|printf|read|readarray|mapfile|compgen|unset|eval|source|for|select|getopts|let|alias|trap|enable|builtin|command|exec|coproc|wait|ulimit|sh|bash|zsh|dash|ksh)([^A-Za-z0-9_]|$)'
    local re_dot=$'(^|[;&|({]|\n)[[:space:]]*\\.([[:space:]]|$)'
    local re_head=$'(^|[;&|({]|\n)[[:space:]]*(([A-Za-z_][A-Za-z0-9_]*(\\[[^]]*\\])?\\+?=[^[:space:];&|]*|!|\\{|then|do|else|if|elif|while|until|time)[[:space:]]+)*\\$'
    local re_ifs='(^|[^A-Za-z0-9_])IFS([^A-Za-z0-9_]|$)'
    local re_word='^[[:space:]]*[A-Za-z0-9=_.,:/+-]+[[:space:]]*$'
    # A lowercase name is never assigned by the shell itself (_, BASH_*, REPLY, OPTARG, ...).
    [[ "$1" =~ ^[a-z][a-z0-9_]*$ ]] || return 1
    # One plain word, so no IFS can split it; and the text must not touch IFS at all.
    [[ "$2" =~ $re_word ]] || return 1
    [ "${_dhpk_ci_taint_ifs:-0}" = "1" ] && return 1
    [[ "$text" =~ $re_ifs ]] && return 1
    # (#1468) A double quote alone proves nothing against the rebinding (it only groups a word), so the
    # proof reads the text without double quotes; a single quote, backslash, backtick, $( , $' , $" and $[
    # still fail it.
    case "$text" in
        *[\'\\\`]*|*'$('*|*"\$'"*|*'$"'*|*'$['*) return 1 ;;
    esac
    text_nq="${text//\"/}"
    case "$2" in *[\*\?\[]*) return 1 ;; esac
    _dhpk_ci_flag_abbrev "$2" && return 1
    [[ "$text_nq" =~ $re_kw ]] && return 1
    [[ "$text_nq" =~ $re_dot ]] && return 1
    # (#1468) A command word built by an expansion can be a binding builtin; look before names are stripped.
    [[ "$text_nq" =~ $re_head ]] && return 1
    # An assign-default (${NAME:= or ${NAME=) can bind the name at runtime; look before references are stripped.
    case "$text_nq" in *'${'"$1"':='*|*'${'"$1"'='*) return 1 ;; esac
    text="$text_nq"
    for name in ${_dhpk_ci_flag_names:-}; do
        text="${text//\$\{$name/}"
        text="${text//\$$name/}"
    done
    # (#1468) A plain reference to any other variable ($b, ${b}) cannot rebind this name; the loop is bounded.
    re_ref='\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)'
    while [[ "$text" =~ $re_ref ]]; do
        k=$((k + 1))
        [ "$k" -gt 64 ] && return 1
        text="${text//"${BASH_REMATCH[0]}"/}"
    done
    case "$text" in *'$'*) return 1 ;; esac
    _dhpk_ci_flag_bound_once "$1" "$text_nq"
}

# (#1462) True when flag variable $1 is provably bound once: after the $NAME and ${NAME references are
# removed, the first whole-word occurrence in the command text is a NAME=value assignment that starts
# a simple command, and no other whole-word occurrence follows (for, select, mapfile, declare, read,
# printf -v, a second assignment and so on). One match over the text per judged word.
_dhpk_ci_flag_bound_once() {
    local name="$1" text="${2:-${_dhpk_ci_cmd_text:-}}" before after
    local re='(^|[^A-Za-z0-9_-])'"$name"'([^A-Za-z0-9_].*|)$'
    local re_again='(^|[^A-Za-z0-9_-])'"$name"'([^A-Za-z0-9_]|$)'
    local re_ctl='(^|[^A-Za-z0-9_])(if|then|else|elif|fi|while|until|do|done|case|esac|in|function)([^A-Za-z0-9_]|$)'
    local re_stmt=$'^[^[:space:];&|()<>]*(;|\n)'
    text="${text//\$\{$name/}"
    text="${text//\$$name/}"
    [[ "$text" =~ $re ]] || return 1
    before="${text:0:$((${#text} - ${#BASH_REMATCH[0]}))}${BASH_REMATCH[1]}"
    after="${BASH_REMATCH[2]}"
    before="${before%"${before##*[![:space:]]}"}"
    # The assignment must be an unconditional top-level statement: it starts the text or follows ; or a
    # newline, nothing before it can skip it (no operator, group, brace or compound keyword), and it
    # ends with ; or a newline right after one word (so it is not a prefix assignment to a command).
    case "$before" in
        ''|*\;|*$'\n') ;;
        *) return 1 ;;
    esac
    case "$before" in
        *[\&\|\(\)\{\}]*) return 1 ;;
    esac
    [[ "$before" =~ $re_ctl ]] && return 1
    [[ "$after" == =* && "$after" != ==* ]] || return 1
    after="${after#=}"
    [[ "$after" =~ $re_stmt ]] || return 1
    [[ "$after" =~ $re_again ]] && return 1
    return 0
}

# (#1462) A whole-word $@, $*, $1 to $9 (or braced) reads the pool of words given to set -- or to a
# function defined in the text. Returns 0 when the word is such a reference.
_dhpk_ci_flag_positional_hit() {
    local w="${1//\"/}" re='^\$(\{([0-9]+|[@*])\}|[0-9@*])$'
    w="${w//\'/}"
    [[ "$w" =~ $re ]] || return 1
    if _dhpk_ci_flag_value_no_verify "${_dhpk_ci_pos_pool:-}" "$2"; then
        _dhpk_ci_flag_hit="no-verify"
    elif [ "${_dhpk_ci_pos_opaque:-0}" = "1" ]; then
        _dhpk_ci_flag_hit="transformed"
    fi
    return 0
}

# (#1468) Judges a readable word $1 as a flag value: an escape not computed here or a glob that can
# expand to a flag is transformed, --no-verify is no-verify. True when _dhpk_ci_flag_hit was set.
_dhpk_ci_flag_word_decide() {
    _dhpk_ci_fs_value "$1" || return 1
    if [ "$_dhpk_ci_fs_uncertain" = "1" ] || _dhpk_ci_glob_may_flag "$_dhpk_ci_fs_uq" "$2"; then
        _dhpk_ci_flag_hit="transformed"
        return 0
    fi
    if _dhpk_ci_flag_value_no_verify " $_dhpk_ci_fs_uq" "$2"; then
        _dhpk_ci_flag_hit="no-verify"
        return 0
    fi
    return 1
}

# (#1462) ${!NAME} reads a variable named by NAME's value, which this scan cannot resolve: any
# recorded flag variable holding --no-verify (or an unreadable value) may be the target.
_dhpk_ci_flag_indirect_hit() {
    local re='^\$\{!([A-Za-z_][A-Za-z0-9_]*)(.*)\}$' re_op='^:?[-=+?](.*)$'
    local w="${1//\"/}" name var opaque=0 rest
    [[ "$w" =~ $re ]] || return 1
    rest="${BASH_REMATCH[2]}"
    if [ -n "$rest" ]; then
        # (#1468) A default operator keeps its word in play; any other operator rebuilds the value.
        if [[ ! "$rest" =~ $re_op ]]; then
            _dhpk_ci_flag_hit="transformed"
            return 0
        fi
        _dhpk_ci_flag_word_decide "${BASH_REMATCH[1]}" "$2" && return 0
    fi
    for name in ${_dhpk_ci_flag_names:-}; do
        var="_dhpk_ci_fv_$name"
        if [ "${!var}" = "@opaque" ]; then
            opaque=1
        elif _dhpk_ci_flag_value_no_verify "${!var}" "$2"; then
            _dhpk_ci_flag_hit="no-verify"
            return 0
        fi
    done
    [ "$opaque" = "1" ] && _dhpk_ci_flag_hit="transformed"
    return 0
}

# Records flag variable $1 from value $2 (or "@opaque") regardless of an earlier record: a name that
# a second source writes cannot be ordered, so it becomes opaque. A benign unrecorded value is skipped.
_dhpk_ci_flag_force() {
    local re_id='^[A-Za-z_][A-Za-z0-9_]*$' val="$2"
    [[ "$1" =~ $re_id ]] || return 0
    case "$_dhpk_ci_bound_names" in *" $1 "*) ;; *) _dhpk_ci_bound_names="${_dhpk_ci_bound_names}$1 " ;; esac
    case "$_dhpk_ci_flag_names" in
        *" $1 "*) val="@opaque" ;;
        *)
            case "$val" in
                '@opaque'|*' -'*) ;;
                *) return 0 ;;
            esac
            _dhpk_ci_flag_names="${_dhpk_ci_flag_names}$1 "
            ;;
    esac
    printf -v "_dhpk_ci_fv_$1" '%s' "$val"
}

# Splits a segment into quote-aware words: _dhpk_ci_fs_raw as written, _dhpk_ci_fs_words with quotes
# and backslashes removed. After 64 words the rest stays one word, so the cost per segment is bounded.
_dhpk_ci_fs_split() {
    local rest="$1" w sq="'" n=0
    local re_w='^[[:space:]]*(("[^"]*"|'$sq'[^'$sq']*'$sq'|[^[:space:]"'$sq']+)+)(.*)$'
    _dhpk_ci_fs_raw=()
    _dhpk_ci_fs_words=()
    _dhpk_ci_fs_rest_len=0
    while [ "$n" -lt 64 ] && [[ "$rest" =~ $re_w ]]; do
        w="${BASH_REMATCH[1]}"
        rest="${BASH_REMATCH[3]}"
        _dhpk_ci_fs_raw+=("$w")
        w="${w//\$$sq/$sq}"
        _dhpk_ci_fs_words+=("${w//[\"$sq\\]/}")
        n=$((n + 1))
    done
    rest="${rest#"${rest%%[![:space:]]*}"}"
    [ -n "$rest" ] || return 0
    _dhpk_ci_fs_rest_len=${#rest}
    _dhpk_ci_fs_raw+=("$rest")
    _dhpk_ci_fs_words+=("$rest")
}

# Peels the first word off $1 into _dhpk_ci_fs_pw, leaving the rest in _dhpk_ci_fs_pr.
_dhpk_ci_fs_peel() {
    local sq="'"
    local re_w='^[[:space:]]*(("[^"]*"|'$sq'[^'$sq']*'$sq'|[^[:space:]"'$sq']+)+)(.*)$'
    [[ "$1" =~ $re_w ]] || return 1
    _dhpk_ci_fs_pw="${BASH_REMATCH[1]}"
    _dhpk_ci_fs_pr="${BASH_REMATCH[3]}"
}

# Reads the value of a raw word: quotes, backslashes and $'...' are removed into _dhpk_ci_fs_uq. Returns
# 1 when the word holds an expansion or a brace. _dhpk_ci_fs_uncertain is 1 when a backslash precedes a
# letter or digit (an escape such as \x2d or \n whose result is not computed here).
_dhpk_ci_fs_value() {
    local w="$1" sq="'"
    _dhpk_ci_fs_uncertain=0
    w="${w//\$$sq/$sq}"
    case "$w" in *[\$\`\{]*) return 1 ;; esac
    case "$1" in *\\[A-Za-z0-9]*) _dhpk_ci_fs_uncertain=1 ;; esac
    _dhpk_ci_fs_uq="${w//[\"$sq\\]/}"
}

# Sets _dhpk_ci_fs_sv to the flag value stored for the value read by _dhpk_ci_fs_value: opaque when
# it holds an escape whose result is not computed (_dhpk_ci_fs_uncertain), else the words.
_dhpk_ci_fs_stored() {
    _dhpk_ci_fs_sv=" $1"
    [ "$_dhpk_ci_fs_uncertain" = "1" ] && _dhpk_ci_fs_sv="@opaque"
    return 0
}

# Adds words from index $1 of the last split to the positional pool. A word with an expansion makes
# the pool opaque, except the value of an option that takes one (it is ignored, not pooled). The pool
# is capped at 16 contributing segments and 256 words; beyond that it is opaque.
_dhpk_ci_fs_pool_add() {
    local i="$1" n="${#_dhpk_ci_fs_words[@]}" prev="" raw
    _dhpk_ci_pos_segs=$((${_dhpk_ci_pos_segs:-0} + 1))
    _dhpk_ci_pos_words=$((${_dhpk_ci_pos_words:-0} + n - i + _dhpk_ci_fs_rest_len / 2))
    if [ "$_dhpk_ci_pos_segs" -gt 16 ] || [ "$_dhpk_ci_pos_words" -gt 256 ]; then
        _dhpk_ci_pos_opaque=1
        return 0
    fi
    while [ "$i" -lt "$n" ]; do
        raw="${_dhpk_ci_fs_raw[$i]}"
        if _dhpk_ci_fs_value "$raw"; then
            _dhpk_ci_fs_stored "$_dhpk_ci_fs_uq"
            if [ "$_dhpk_ci_fs_sv" = "@opaque" ]; then
                _dhpk_ci_pos_opaque=1
            else
                _dhpk_ci_pos_pool="$_dhpk_ci_pos_pool$_dhpk_ci_fs_sv"
            fi
        elif [ -n "$prev" ] && _dhpk_ci_option_consumes_next "$prev"; then
            :
        elif [[ "$raw" == -*=* && "${raw%%=*}" != *[\$\`\{]* ]]; then
            :
        else
            _dhpk_ci_pos_opaque=1
        fi
        prev="${_dhpk_ci_fs_words[$i]}"
        i=$((i + 1))
    done
}

# Marks flag variable $1 opaque when it is already recorded or when the unreadable source text $2
# mentions a recorded flag variable or holds a flagged literal. Otherwise the name stays unrecorded,
# like any variable with no visible source.
_dhpk_ci_fs_unreadable() {
    local recorded=0
    case "$_dhpk_ci_flag_names" in *" $1 "*) recorded=1 ;; esac
    if [ "$recorded" = "1" ] || _dhpk_ci_flag_refs_known "$2" || _dhpk_ci_flag_value_no_verify " $2" commit; then
        _dhpk_ci_flag_force "$1" "@opaque"
    fi
}

# True when read option cluster $1 ends in an option that takes a value, so the next word is that value
# (-pt keeps its value attached; -a takes an array name, which is a target).
_dhpk_ci_fs_read_opt() {
    local c="${1#-}" ch
    while [ -n "$c" ]; do
        ch="${c:0:1}"
        c="${c:1}"
        case "$ch" in
            [pdnNtui]) [ -z "$c" ]; return ;;
        esac
    done
    return 1
}

# read [opts] NAME... <<< WORD: a readable WORD is each name's value; any other source is unreadable.
_dhpk_ci_fs_read() {
    _dhpk_ci_fs_split "$1"
    local i=1 n="${#_dhpk_ci_fs_words[@]}" w raw name rawv="" here=0 value="" readable=0
    local re_op='^[0-9]*[<>]+$' re_redir='^[0-9]*[<>]'
    local -a rnames=()
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_fs_words[$i]}"
        raw="${_dhpk_ci_fs_raw[$i]}"
        case "$raw" in
            '<<<'*)
                here=1
                rawv="${raw#<<<}"
                if [ -z "$rawv" ]; then
                    i=$((i + 1))
                    rawv="${_dhpk_ci_fs_raw[$i]-}"
                fi
                ;;
            -*) _dhpk_ci_fs_read_opt "$w" && i=$((i + 1)) ;;
            *)
                if [[ "$w" =~ $re_op ]]; then
                    i=$((i + 1))
                elif ! [[ "$w" =~ $re_redir ]]; then
                    rnames+=("${w%%\[*}")
                fi
                ;;
        esac
        i=$((i + 1))
    done
    [ "${#rnames[@]}" -gt 0 ] || rnames=(REPLY)
    local cut=0 dq="${rawv//[^\"]/}"
    if [ "$here" = "1" ] && [ $((${#dq} % 2)) -eq 1 ]; then
        # An unbalanced double quote is a here-string cut at a substitution inside the quotes.
        cut=1
    elif [ "$here" = "1" ] && [ -z "$rawv" ]; then
        # A here-string with no word left is cut at an unquoted backtick or substitution.
        cut=1
    elif [ "$here" = "1" ] && _dhpk_ci_fs_value "$rawv"; then
        readable=1
        _dhpk_ci_fs_stored "$_dhpk_ci_fs_uq"
        value="$_dhpk_ci_fs_sv"
    fi
    if [ "$readable" != "1" ] && _dhpk_ci_fs_read_cut "$1"; then
        cut=1
    fi
    for name in "${rnames[@]}"; do
        if [[ "$name" == *[\$\`]* ]]; then
            _dhpk_ci_fs_anyname=1
        elif [ "$readable" = "1" ]; then
            _dhpk_ci_flag_force "$name" "$value"
        elif [ "$cut" = "1" ]; then
            _dhpk_ci_flag_force "$name" "@opaque"
        else
            _dhpk_ci_fs_unreadable "$name" "$rawv"
        fi
    done
}

# (#1468) True when the unreadable read segment $1 was cut by a substitution (it ends with <, $, "$ or
# <<<) or the command text is a pipeline, so the value comes from a command and not from the text.
_dhpk_ci_fs_read_cut() {
    local seg="${1%"${1##*[![:space:]]}"}" text="${_dhpk_ci_cmd_text:-}"
    local re_pipe='(^|[^|])\|([^|]|$)'
    case "$seg" in
        *'<'|*'$') return 0 ;; # also covers <<< and "$
    esac
    [[ "$text" =~ $re_pipe ]]
}

# (#1468) True when an unreadable printf -v source can rebuild a flag: the raw format $1 holds a
# backslash or a conversion other than %s and %%, or a raw argument (the rest) holds a backslash.
_dhpk_ci_printf_unreadable_force() {
    local re_conv='%[^s%]' a
    case "$1" in *\\*) return 0 ;; esac
    [[ "$1" =~ $re_conv ]] && return 0
    shift
    for a in "$@"; do
        case "$a" in *\\*) return 0 ;; esac
    done
    return 1
}

# printf -v NAME FORMAT ARGS: the format %s stores the arguments, a format without % or backslash
# stores itself, anything else is unreadable.
_dhpk_ci_fs_printf() {
    _dhpk_ci_fs_split "$1"
    local n="${#_dhpk_ci_fs_words[@]}" i=3 val="" opaque=0 fmt args="" name force=0
    [ "$n" -ge 3 ] && [ "${_dhpk_ci_fs_words[1]}" = "-v" ] || return 0
    [ "${_dhpk_ci_fs_words[3]-}" = "--" ] && i=4
    fmt="${_dhpk_ci_fs_words[$i]-}"
    name="${_dhpk_ci_fs_words[2]%%\[*}"
    if [[ "$name" == *[\$\`]* ]]; then
        _dhpk_ci_fs_anyname=1
        return 0
    fi
    if [ "$fmt" = "%s" ]; then
        for ((i = i + 1; i < n; i++)); do
            args="$args ${_dhpk_ci_fs_raw[$i]}"
            if _dhpk_ci_fs_value "${_dhpk_ci_fs_raw[$i]}"; then
                _dhpk_ci_fs_stored "$_dhpk_ci_fs_uq"
                [ "$_dhpk_ci_fs_sv" = "@opaque" ] && opaque=1
                val="$val ${_dhpk_ci_fs_uq}"
            else
                opaque=1
            fi
        done
    elif [[ "${_dhpk_ci_fs_raw[$i]-}" != *[%\\]* ]] && _dhpk_ci_fs_value "${_dhpk_ci_fs_raw[$i]-}"; then
        val=" $_dhpk_ci_fs_uq"
    else
        opaque=1
        _dhpk_ci_printf_unreadable_force "${_dhpk_ci_fs_raw[$i]-}" "${_dhpk_ci_fs_raw[@]:$((i + 1))}" && force=1
        for ((i = i + 1; i < n; i++)); do args="$args ${_dhpk_ci_fs_raw[$i]}"; done
    fi
    if [ "$force" = "1" ]; then
        _dhpk_ci_flag_force "$name" "@opaque"
        return 0
    fi
    if [ "$opaque" = "1" ]; then
        _dhpk_ci_fs_unreadable "$name" "$args"
        return 0
    fi
    _dhpk_ci_flag_force "$name" "$val"
}

# set [options] [--] ARGS: the words become positional parameters.
_dhpk_ci_fs_set() {
    _dhpk_ci_fs_split "$1"
    local i=1 n="${#_dhpk_ci_fs_words[@]}" w
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_fs_words[$i]}"
        case "$w" in
            --) i=$((i + 1)); break ;;
            -o|+o) i=$((i + 2)) ;;
            -*|+*) i=$((i + 1)) ;;
            *) break ;;
        esac
    done
    _dhpk_ci_fs_pool_add "$i"
}

# Strips what precedes the command word of segment $1 into _dhpk_ci_fs_seg: reserved words, prefix
# assignments, redirections and function definition prefixes (a name, then the () marker). With $2 = 1
# a defined function name is recorded (at most 16, then the pool is opaque).
_dhpk_ci_fs_strip() {
    local s="$1" w fn u=$'\001'
    local re_fn='^function[[:space:]]+([A-Za-z_][A-Za-z0-9_.-]*)([[:space:]]*'$u')?[[:space:]]*(.*)$'
    local re_paren='^([A-Za-z_][A-Za-z0-9_.-]*)[[:space:]]*'$u'[[:space:]]*(.*)$'
    local re_asg='^[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?\+?='
    local re_op='^[0-9&]*[<>]+$' re_redir='^[0-9&]*[<>]'
    while :; do
        s="${s#"${s%%[![:space:]]*}"}"
        # Fast path: a plain command word with no definition marker needs no regex.
        w="${s%%[[:space:]]*}"
        case "$s" in
            *"$u"*) ;;
            *)
                case "$w" in
                    *[=\<\>\"\'\\\&]*|'{'|'}'|'!'|then|do|else|elif|while|until|if|time|builtin|command|function) ;;
                    *) break ;;
                esac
                ;;
        esac
        if [[ "$s" =~ $re_fn ]]; then
            fn="${BASH_REMATCH[1]}"
            s="${BASH_REMATCH[3]}"
            [ "$2" = "1" ] && _dhpk_ci_fs_define "$fn"
            continue
        elif [[ "$s" =~ $re_paren ]]; then
            fn="${BASH_REMATCH[1]}"
            s="${BASH_REMATCH[2]}"
            [ "$2" = "1" ] && _dhpk_ci_fs_define "$fn"
            continue
        fi
        _dhpk_ci_fs_peel "$s" || break
        w="$_dhpk_ci_fs_pw"
        case "$w" in
            '{'|'}'|'!'|then|do|else|elif|while|until|if|time|builtin|command)
                s="$_dhpk_ci_fs_pr"
                continue
                ;;
        esac
        if [[ "$w" =~ $re_asg ]]; then
            s="$_dhpk_ci_fs_pr"
            continue
        fi
        if [[ "$w" =~ $re_op ]]; then
            _dhpk_ci_fs_peel "$_dhpk_ci_fs_pr" || { s=""; break; }
            s="$_dhpk_ci_fs_pr"
            continue
        fi
        if [[ "$w" =~ $re_redir ]]; then
            s="$_dhpk_ci_fs_pr"
            continue
        fi
        break
    done
    _dhpk_ci_fs_seg="$s"
}

_dhpk_ci_fs_define() {
    if [ "$_dhpk_ci_fs_nfn" -ge 16 ]; then
        _dhpk_ci_pos_opaque=1
        return 0
    fi
    _dhpk_ci_fs_funcs="$_dhpk_ci_fs_funcs$1 "
    _dhpk_ci_fs_nfn=$((_dhpk_ci_fs_nfn + 1))
}

# Dispatches one stripped segment of the second pass to its flag source handler. The head word is
# compared without quotes or backslashes. An opaque pool takes no more words.
_dhpk_ci_fs_apply() {
    local head="${1%%[[:space:]]*}"
    head="${head//[\"\'\\]/}"
    case "$head" in
        read) _dhpk_ci_fs_read "$1" ;;
        printf) _dhpk_ci_fs_printf "$1" ;;
        set)
            [ "${_dhpk_ci_pos_opaque:-0}" = "1" ] || _dhpk_ci_fs_set "$1"
            ;;
        for|select) _dhpk_ci_fs_for "$1" ;;
        mapfile|readarray) _dhpk_ci_fs_mapfile "$1" ;;
        compgen) _dhpk_ci_fs_compgen "$1" ;;
        declare|typeset|local|export|readonly) _dhpk_ci_fs_declare "$1" ;;
        *)
            # (#1468) A command word built by an expansion can be any builtin (declare, eval, read) and
            # bind any name with any value: every reference and positional parameter becomes unjudged.
            if _dhpk_ci_fs_dynamic_head "$1"; then
                _dhpk_ci_fs_anyname=1
                _dhpk_ci_pos_opaque=1
                return 0
            fi
            case "$_dhpk_ci_fs_funcs" in
                *" $head "*)
                    [ "${_dhpk_ci_pos_opaque:-0}" = "1" ] && return 0
                    _dhpk_ci_fs_split "$1"
                    _dhpk_ci_fs_pool_add 1
                    return 0
                    ;;
            esac
            _dhpk_ci_fs_indirect_call "$head" "$1"
            ;;
    esac
}

# (#1468) True when the command word of segment $1, after prefix assignments and the words !, {, then,
# do and time, holds an expansion or a backtick.
_dhpk_ci_fs_dynamic_head() {
    local s="$1" w k=0 re_asg='^[A-Za-z_][A-Za-z0-9_]*(\[[^]]*\])?\+?='
    while [ "$k" -lt 64 ] && _dhpk_ci_fs_peel "$s"; do
        k=$((k + 1))
        w="$_dhpk_ci_fs_pw"
        case "$w" in
            '!'|'{'|then|do|time) s="$_dhpk_ci_fs_pr"; continue ;;
        esac
        if [[ "$w" =~ $re_asg ]]; then
            s="$_dhpk_ci_fs_pr"
            continue
        fi
        [[ "$w" == *[\$\`]* ]]
        return
    done
    return 1
}

# (#1468) compgen -V NAME stores the completions in array NAME: a target built by an expansion can be
# any name; a plain target gets an opaque value.
_dhpk_ci_fs_compgen() {
    _dhpk_ci_fs_split "$1"
    local i=1 n="${#_dhpk_ci_fs_raw[@]}" raw target=""
    while [ "$i" -lt "$n" ]; do
        raw="${_dhpk_ci_fs_raw[$i]}"
        i=$((i + 1))
        case "$raw" in
            -*V) target="${_dhpk_ci_fs_raw[$i]-}" ;;
            -*V*) target="${raw#*V}" ;;
            *) continue ;;
        esac
        if [[ "$target" == *[\$\`]* ]]; then
            _dhpk_ci_fs_anyname=1
        elif [ -n "$target" ]; then
            target="${target//[\"\'\\]/}"
            _dhpk_ci_flag_force "${target%%\[*}" "@opaque"
        fi
    done
}

# (#1468) for|select NAME [in WORDS]: a loop without a list reads the positional parameters (opaque); a
# list of readable words, none of which is a glob that can expand to a flag, is NAME's value.
_dhpk_ci_fs_for() {
    _dhpk_ci_fs_split "$1"
    local n="${#_dhpk_ci_fs_words[@]}" name="${_dhpk_ci_fs_words[1]-}" i=3 list=""
    [ "${_dhpk_ci_fs_words[2]-}" = "in" ] || { _dhpk_ci_flag_force "$name" "@opaque"; return 0; }
    # An empty list is a segment cut at a substitution (`...` or $(...)): its words come from a command.
    [ "$n" -gt 3 ] || { _dhpk_ci_flag_force "$name" "@opaque"; return 0; }
    for ((; i < n; i++)); do
        if ! _dhpk_ci_fs_value "${_dhpk_ci_fs_raw[$i]}" || [ "$_dhpk_ci_fs_uncertain" = "1" ] \
            || _dhpk_ci_glob_may_flag "$_dhpk_ci_fs_uq" commit; then
            _dhpk_ci_flag_force "$name" "@opaque"
            return 0
        fi
        list="$list $_dhpk_ci_fs_uq"
    done
    _dhpk_ci_flag_force "$name" "$list"
}

# (#1468) mapfile|readarray [OPTIONS] [NAME]: the last non-option word is the array (default MAPFILE).
# A target built by an expansion can be any name; a plain target gets an opaque value.
_dhpk_ci_fs_mapfile() {
    _dhpk_ci_fs_split "$1"
    local i=1 n="${#_dhpk_ci_fs_words[@]}" w target="MAPFILE"
    local re_op='^[0-9]*[<>]+$' re_redir='^[0-9]*[<>]'
    while [ "$i" -lt "$n" ]; do
        w="${_dhpk_ci_fs_words[$i]}"
        case "${_dhpk_ci_fs_raw[$i]}" in
            -*) case "${w: -1}" in [unOsdCc]) i=$((i + 1)) ;; esac ;;
            *)
                if [[ "$w" =~ $re_op ]]; then
                    i=$((i + 1))
                elif ! [[ "$w" =~ $re_redir ]]; then
                    target="${_dhpk_ci_fs_raw[$i]}"
                fi
                ;;
        esac
        i=$((i + 1))
    done
    if [[ "$target" == *[\$\`]* ]]; then
        _dhpk_ci_fs_anyname=1
        return 0
    fi
    target="${target//[\"\'\\]/}"
    _dhpk_ci_flag_force "${target%%\[*}" "@opaque"
}

# (#1468) declare|typeset|local|export|readonly: a name written with quotes or a backslash, or a nameref
# (-n), is bound under a name the plain text scan does not see; a name built by an expansion can be any name.
_dhpk_ci_fs_declare() {
    _dhpk_ci_fs_split "$1"
    local i=1 n="${#_dhpk_ci_fs_words[@]}" raw nameref=0 name
    while [ "$i" -lt "$n" ]; do
        raw="${_dhpk_ci_fs_raw[$i]}"
        i=$((i + 1))
        case "$raw" in
            -*) [[ "$raw" == -*n* ]] && nameref=1; continue ;;
        esac
        name="${raw%%=*}"
        if [[ "$name" == *[\$\`]* ]]; then
            _dhpk_ci_fs_anyname=1
        elif [ "$nameref" = "1" ] || [[ "$name" == *[\"\'\\]* ]]; then
            name="${name//[\"\'\\]/}"
            _dhpk_ci_flag_force "${name%%\[*}" "@opaque"
        fi
    done
}

# (#1468) A command that runs its words as a command (trap, eval, xargs, a shell or wrapper) can call a
# function defined in the text with arguments this scan cannot read: the positional pool becomes opaque.
_dhpk_ci_fs_indirect_call() {
    [ "${_dhpk_ci_fs_nfn:-0}" -gt 0 ] || return 0
    case "$1" in
        trap|eval|xargs) ;;
        *)
            _dhpk_ci_is_shell_word "$1" || _dhpk_ci_is_wrapper_word "$1" || return 0
            ;;
    esac
    local seg="${2//[\"\'\\]/}" w
    local -a ic_a
    read -r -a ic_a <<<"$seg"
    for w in "${ic_a[@]}"; do
        case "$_dhpk_ci_fs_funcs" in
            *" $w "*) _dhpk_ci_pos_opaque=1; return 0 ;;
        esac
    done
}

# (#1462) Flag sources other than NAME=value, bounded and read from the text only: read here-strings,
# printf -v, set -- and the arguments of calls to functions defined in the text (one pooled positional
# string). The text is cut into segments at ; & | ( ) and backticks (the () of a definition is kept as a
# marker). Pass 1 collects the function names, pass 2 applies the sources. Runs only for commit or push.
_dhpk_ci_scan_flag_sources() {
    local text="$1" seg
    local -a segs=() stripped=()
    _dhpk_ci_cmd_text="$1"
    case "$text" in
        *commit*|*push*) ;;
        *) return 0 ;;
    esac
    _dhpk_ci_fs_funcs=" "
    _dhpk_ci_fs_nfn=0
    text="${text//\(\)/$'\001'}"
    text="${text//[;&|()\`]/$'\n'}"
    # (#1468) More than 1024 segments are not scanned: the pool and the default expansions fail closed.
    local nl="${text//[^$'\n']/}"
    if [ "${#nl}" -gt 1024 ]; then
        _dhpk_ci_pos_opaque=1
        _dhpk_ci_fs_overflow=1
        return 0
    fi
    while IFS= read -r seg; do
        segs+=("$seg")
    done <<<"$text"
    for seg in "${segs[@]}"; do
        _dhpk_ci_fs_strip "$seg" 1
        stripped+=("$_dhpk_ci_fs_seg")
    done
    # (#1468) The handler of an unknown command word runs with that command's words as arguments.
    case "$_dhpk_ci_fs_funcs" in
        *" command_not_found_handle "*) _dhpk_ci_pos_opaque=1 ;;
    esac
    for seg in "${stripped[@]}"; do
        _dhpk_ci_fs_apply "$seg"
    done
    _dhpk_ci_fs_default_assigns
}

# (#1468) ${NAME:=WORD} and ${NAME=WORD} bind NAME when it is unset: a readable WORD is NAME's value,
# any other WORD makes it opaque. Read from the whole text, so a quoted or nested form is seen too.
_dhpk_ci_fs_default_assigns() {
    local rest="${_dhpk_ci_cmd_text:-}" name k=0
    local re='\$\{([A-Za-z_][A-Za-z0-9_]*):?=([^}]*)\}'
    while [[ "$rest" =~ $re ]]; do
        # Past 256 forms the loop (a regex over the rest of the text each round) is cut and fails closed.
        k=$((k + 1))
        if [ "$k" -gt 256 ]; then
            _dhpk_ci_fs_overflow=1
            break
        fi
        name="${BASH_REMATCH[1]}"
        rest="${rest#*"${BASH_REMATCH[0]}"}"
        if _dhpk_ci_fs_value "${BASH_REMATCH[2]}" && [ "$_dhpk_ci_fs_uncertain" != "1" ]; then
            _dhpk_ci_flag_force "$name" " $_dhpk_ci_fs_uq"
        else
            _dhpk_ci_flag_force "$name" "@opaque"
        fi
    done
}

# Text-level view over the raw command: every NAME=value, NAME+=value,
# NAME[i]=value and NAME=(...) is gathered per name (order independent), then
# classified. printf -v targets are opaque builders (read/mapfile are modelled
# precisely elsewhere): they are
# tainted whenever the text names git.
_dhpk_ci_scan_git_taint() {
    local rest="$1" sq="'" name t v var names=" " seg w appended=" "
    local re_assign='(^|[^A-Za-z0-9_])([A-Za-z_][A-Za-z0-9_]*)(\[[^]]*\])?(\+?)=(.*)$'
    local re_sq='^\$?'$sq'([^'$sq']*)'$sq'(.*)$'
    local re_dq='^"([^"]*)"(.*)$'
    local re_par='^\(([^)]*)\)(.*)$'
    local re_bare='^([^[:space:];&|<>()]*)(.*)$'
    local re_more='^([^[:space:];&|<>()"'$sq']+)(.*)$' seg_n sub
    local re_build='(printf[[:space:]]+-v)[[:space:]]+([^;&|<]*)'
    local re_id='^[A-Za-z_][A-Za-z0-9_]*$'
    local -a ws_a
    _dhpk_ci_taint_ifs=0
    case "$rest" in
        *IFS=*|*IFS+=*) _dhpk_ci_taint_ifs=1 ;;
    esac
    _dhpk_ci_lower "$rest"
    case "$_dhpk_ci_lc" in
        *git*) ;;
        *) _dhpk_ci_nonascii "$rest" || return 0 ;;
    esac
    _dhpk_ci_taint_gitassign=0
    local n_asg=0
    while [[ "$rest" =~ $re_assign ]]; do
        # (#1468) Past 256 assignments the loop (a regex over the rest of the text each round) is cut and
        # every default expansion is judged as transformed.
        n_asg=$((n_asg + 1))
        if [ "$n_asg" -gt 256 ]; then
            _dhpk_ci_fs_overflow=1
            _dhpk_ci_taint_overflow=1
            _dhpk_ci_taint_gitassign=1
            break
        fi
        name="${BASH_REMATCH[2]}"
        t="${BASH_REMATCH[5]}"
        [ -n "${BASH_REMATCH[4]}" ] && appended="$appended$name "
        if [[ "$t" =~ $re_sq ]] || [[ "$t" =~ $re_dq ]] || [[ "$t" =~ $re_par ]] || [[ "$t" =~ $re_bare ]]; then
            v="${BASH_REMATCH[1]}"
            rest="${BASH_REMATCH[2]}"
        else
            v=""
            rest="$t"
        fi
        # (#1515) Adjacent quoted and bare segments are one value: 'gi'"t commit".
        seg_n=0
        while [ "$seg_n" -lt 16 ]; do
            seg_n=$((seg_n + 1))
            if [[ "$rest" =~ $re_sq ]] || [[ "$rest" =~ $re_dq ]] || [[ "$rest" =~ $re_more ]]; then
                v="$v${BASH_REMATCH[1]}"
                rest="${BASH_REMATCH[2]}"
            else
                break
            fi
        done
        # (#1515) The text of a substitution that feeds the value is followed for copies only.
        sub="_dhpk_ci_cx_$name"
        case "$v" in
            *'$') [ "${rest:0:1}" = "(" ] && printf -v "$sub" '%s %s' "${!sub:-}" "${rest%%)*}" ;;
            *'`'*) printf -v "$sub" '%s %s' "${!sub:-}" "${rest%%\`*}" ;;
        esac
        var="_dhpk_ci_tv_$name"
        printf -v "$var" '%s %s' "${!var:-}" "$v"
        _dhpk_ci_lower "$v"
        case "$_dhpk_ci_lc" in *git*) _dhpk_ci_taint_gitassign=1 ;; esac
        # A non-ASCII value may fold into git under a UTF-8 case conversion.
        if _dhpk_ci_nonascii "$v"; then
            _dhpk_ci_nonascii_names="${_dhpk_ci_nonascii_names}$name "
        fi
        case "$names" in *" $name "*) ;; *) names="$names$name " ;; esac
    done
    for name in $names; do
        var="_dhpk_ci_tv_$name"
        if _dhpk_ci_git_value_risky "${!var}" "$_dhpk_ci_taint_ifs"; then
            _dhpk_ci_taint_add "$name"
        else
            _dhpk_ci_lower "${!var}"
            if _dhpk_ci_word_mentions_git "$_dhpk_ci_lc"; then
                _dhpk_ci_git_named="${_dhpk_ci_git_named}$name "
            fi
        fi
        case "$appended" in
            *" $name "*) _dhpk_ci_note_flag_var "$name" "${!var}" 1 ;;
            *) _dhpk_ci_note_flag_var "$name" "${!var}" ;;
        esac
    done
    # (#1456) An assignment that stores a transformed expansion (x=${l/log/push}) of a git-named or
    # tainted variable holds rebuilt git text; it is judged after every name is classified.
    local rebuilt=" "
    for name in $names; do
        var="_dhpk_ci_tv_$name"
        if _dhpk_ci_value_transforms_git "${!var}" || _dhpk_ci_value_copies "${!var}" "$rebuilt"; then
            _dhpk_ci_taint_add "$name"
            rebuilt="$rebuilt$name "
        fi
    done
    _dhpk_ci_bound_names="${_dhpk_ci_bound_names}${names# } "
    # (#1515) A non-ASCII printf -v value may fold into git under a UTF-8 case conversion.
    rest="$1"
    while [[ "$rest" =~ $re_build ]]; do
        seg="${BASH_REMATCH[2]}"
        rest="${rest#*"${BASH_REMATCH[0]}"}"
        _dhpk_ci_nonascii "$seg" || continue
        read -r -a ws_a <<<"$seg"
        [[ "${ws_a[0]:-}" =~ $re_id ]] && _dhpk_ci_nonascii_names="${_dhpk_ci_nonascii_names}${ws_a[0]} "
    done
    _dhpk_ci_scan_namerefs "$1"
    _dhpk_ci_scan_flag_sources "$1"
    _dhpk_ci_scan_copies "$1" "$names"
    _dhpk_ci_scan_namerefs "$1"
    for name in $names; do
        unset "_dhpk_ci_tv_$name" "_dhpk_ci_cx_$name"
    done
    rest="$1"
    while [[ "$rest" =~ $re_build ]]; do
        seg="${BASH_REMATCH[2]}"
        rest="${rest#*"${BASH_REMATCH[0]}"}"
        _dhpk_ci_lower "$1"
        if [ "$_dhpk_ci_taint_ifs" = "1" ] || _dhpk_ci_word_mentions_git "$_dhpk_ci_lc"; then
            read -r -a ws_a <<<"$seg"
            for w in "${ws_a[@]}"; do
                [[ "$w" =~ $re_id ]] && _dhpk_ci_taint_add "$w"
            done
        fi
    done
    return 0
}

# declare/local/typeset -n NAME[=TARGET]: a nameref to a tainted variable is
# tainted. A target that is not a plain visible name (or no target) cannot be
# resolved, so the nameref is tainted when the text names git. Two passes let
# a short chain of namerefs settle.
_dhpk_ci_scan_namerefs() {
    local rest="$1" name target
    local re_ref='(declare|local|typeset)[[:space:]]+-[A-Za-z]*n[A-Za-z]*[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)(=([^[:space:];&|<>()]*))?'
    local re_id='^[A-Za-z_][A-Za-z0-9_]*$'
    [[ "$rest" =~ $re_ref ]] || return 0
    for _ in 1 2; do
        rest="$1"
        while [[ "$rest" =~ $re_ref ]]; do
            name="${BASH_REMATCH[2]}"
            target="${BASH_REMATCH[4]}"
            target="${target#[\'\"]}"
            target="${target%[\'\"]}"
            rest="${rest#*"${BASH_REMATCH[0]}"}"
            if [[ "$target" =~ $re_id ]]; then
                case "$_dhpk_ci_git_taint" in
                    *" $target "*) _dhpk_ci_taint_add "$name" ;;
                esac
                case "$_dhpk_ci_nonascii_names" in
                    *" $target "*) _dhpk_ci_nonascii_names="${_dhpk_ci_nonascii_names}$name " ;;
                esac
            else
                _dhpk_ci_taint_add "$name"
            fi
        done
    done
}

# True when the word expands a variable that holds risky git text. $2 is 1 for a quoted command word.
_dhpk_ci_word_uses_taint() {
    local w="$1" name re
    [ "${_dhpk_ci_taint_overflow:-0}" = "1" ] && [[ "$w" == *'$'* ]] && return 0
    if [ "${_dhpk_ci_taint_gitassign:-0}" = "1" ]; then
        case "$w" in
            *'${!'[A-Za-z_]*) return 0 ;;
        esac
    fi
    # (#1515) A case conversion through an indirect name cannot be tied to one variable.
    re='\$\{![A-Za-z_][A-Za-z0-9_]*[,^~@]'
    [ "${_dhpk_ci_nonascii_names:- }" != " " ] && [[ "$w" =~ $re ]] && return 0
    _dhpk_ci_cp_pos_taint "$w" "${2:-0}" && return 0
    # (#1456) A transformed expansion (${l/log/push}, ${l%log}, ${l:0}, ${l@P}) of a variable whose
    # visible value names git can rebuild any git command, so it is risky even when the value is read-only.
    for name in ${_dhpk_ci_git_named:-} ${_dhpk_ci_nonascii_names:-}; do
        re='\$\{'$name'(\[[^]]*\])?[/#%:@^,~]'
        [[ "$w" =~ $re ]] && return 0
    done
    [ "${_dhpk_ci_git_taint:- }" != " " ] || return 1
    for name in $_dhpk_ci_git_taint; do
        re='\$\{?[!#]?'$name'([^A-Za-z0-9_]|$)'
        [[ "$w" =~ $re ]] && return 0
    done
    return 1
}

# (#1460) True when the word is a default, assign, alternate or error expansion
# (${x:-git push}, ${l:=git commit}) whose fallback text names git: the fallback
# becomes the command word. The closing brace is not required (the word may be split).
_dhpk_ci_word_default_git() {
    case "$1" in
        *git*) ;;
        *) return 1 ;;
    esac
    local re='\$\{[A-Za-z_0-9@*]+(\[[^]]*\])?:?[-=+?]([^}]*)' d
    [[ "$1" =~ $re ]] || return 1
    d="${BASH_REMATCH[2]}"
    d="${d#[\'\"]}"
    _dhpk_ci_word_mentions_git "$d"
}

# A prefix or env assignment the child command can see. += is an assignment
# when the variable is unset. SHELLOPTS and BASH_ENV change how a child shell
# starts; the file named by BASH_ENV is not read.
_dhpk_ci_note_assign() {
    local w="$1" val
    _dhpk_ci_word_sets_git_env "$w" && _dhpk_ci_u_git_env_unresolved=1
    _dhpk_ci_note_git_assign "$w"
    case "$w" in
        IFS+=*)
            _dhpk_ci_ifs_custom=1
            _dhpk_ci_ifs_stamp=$((${_dhpk_ci_ifs_stamp:-0} + 1))
            ;;
        IFS=*)
            val="${w#IFS=}"
            if [ "$val" = $' \t\n' ]; then
                # A default assignment that may not run must not undo a
                # custom IFS that is still in effect.
                if [ "${_dhpk_ci_block:-0}" -eq 0 ] \
                    && [ "${_dhpk_ci_prev_sep:-}" != "and" ] \
                    && [ "${_dhpk_ci_prev_sep:-}" != "or" ] \
                    && [ "${_dhpk_ci_ss_depth:-0}" -eq 0 ]; then
                    _dhpk_ci_ifs_custom=0
                    _dhpk_ci_ifs_stamp=$((${_dhpk_ci_ifs_stamp:-0} + 1))
                fi
            else
                _dhpk_ci_ifs_custom=1
                _dhpk_ci_ifs_stamp=$((${_dhpk_ci_ifs_stamp:-0} + 1))
            fi
            ;;
    esac
    case "$w" in
        SHELLOPTS=*|SHELLOPTS+=*)
            val="${w#*=}"
            case ":${val}:" in
                *:allexport:*) _dhpk_ci_u_shellopts_allexport=1 ;;
            esac
            ;;
        BASH_ENV=*|BASH_ENV+=*) _dhpk_ci_u_bash_env=1 ;;
        BASHOPTS=*|BASHOPTS+=*)
            val="${w#*=}"
            case ":${val}:" in
                *:lastpipe:*) _dhpk_ci_u_bashopts_lastpipe=1 ;;
            esac
            ;;
        SHELL=*|SHELL+=*)
            _dhpk_ci_saw_shell_assign=1
            ;;
    esac
}

# A separate shell inherits exported Git variables (sticky) but not the
# caller's set -a. -a, -o allexport, and SHELLOPTS turn it on for that child.
# A prefix assignment, including BASH_ENV, is visible only to that child.
# The saved values are locals of the caller (_dhpk_ci_flush_command).
_dhpk_ci_child_shell_enter() {
    _dhpk_ci_child_sticky_saved="${_dhpk_ci_git_env_sticky:-0}"
    _dhpk_ci_child_allexport_saved="${_dhpk_ci_allexport:-0}"
    _dhpk_ci_child_bash_env_saved="${_dhpk_ci_bash_env_on:-0}"
    _dhpk_ci_child_shellopts_saved="${_dhpk_ci_shellopts_exported:-0}"
    _dhpk_ci_child_lastpipe_saved="${_dhpk_ci_lastpipe:-0}"
    if [ "${_dhpk_ci_shell_lastpipe:-0}" -eq 1 ] || [ "${_dhpk_ci_u_bashopts_lastpipe:-0}" -eq 1 ]; then
        _dhpk_ci_lastpipe=1
    fi
    _dhpk_ci_allexport=0
    if [ "${_dhpk_ci_shell_allexport:-0}" -eq 1 ] || [ "${_dhpk_ci_u_shellopts_allexport:-0}" -eq 1 ]; then
        _dhpk_ci_allexport=1
    elif [ "${_dhpk_ci_shellopts_exported:-0}" -eq 1 ] && [ "$_dhpk_ci_child_allexport_saved" -eq 1 ]; then
        # An exported SHELLOPTS picks up allexport and is passed to this child.
        _dhpk_ci_allexport=1
    fi
    if [ "${_dhpk_ci_u_shellopts_allexport:-0}" -eq 1 ]; then
        _dhpk_ci_shellopts_exported=1
    fi
    if [ "${_dhpk_ci_u_git_env_unresolved:-0}" -eq 1 ] || [ "${_dhpk_ci_u_bash_env:-0}" -eq 1 ] || [ "${_dhpk_ci_bash_env_on:-0}" -eq 1 ]; then
        _dhpk_ci_git_env_sticky=1
    fi
}

_dhpk_ci_child_shell_leave() {
    _dhpk_ci_git_env_sticky="${_dhpk_ci_child_sticky_saved:-0}"
    _dhpk_ci_allexport="${_dhpk_ci_child_allexport_saved:-0}"
    _dhpk_ci_bash_env_on="${_dhpk_ci_child_bash_env_saved:-0}"
    _dhpk_ci_shellopts_exported="${_dhpk_ci_child_shellopts_saved:-0}"
    _dhpk_ci_lastpipe="${_dhpk_ci_child_lastpipe_saved:-0}"
}

# export / allexport of BASH_ENV or SHELLOPTS. The BASH_ENV file is not read.
# A child shell inherits that variable; SHELLOPTS carries allexport when it is on.
_dhpk_ci_note_exported_shell_var() {
    case "$1" in
        BASH_ENV|BASH_ENV=*|BASH_ENV+=*) _dhpk_ci_bash_env_on=1 ;;
        SHELLOPTS|SHELLOPTS=*|SHELLOPTS+=*) _dhpk_ci_shellopts_exported=1 ;;
    esac
}

# shopt -s lastpipe makes the last pipeline stage run in the current shell
# when monitor mode is off. A non-interactive hook shell starts that way.
_dhpk_ci_apply_shopt() {
    local k=$((_dhpk_ci_u_idx + 1)) n="${#_dhpk_ci_u_words[@]}" w mode="" oi
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            --) k=$((k + 1)); continue ;;
            -s) mode=s ;;
            -u) mode=u ;;
            -[a-zA-Z]*)
                oi=1
                while [ "$oi" -lt "${#w}" ]; do
                    case "${w:$oi:1}" in
                        s) mode=s ;;
                        u) mode=u ;;
                    esac
                    oi=$((oi + 1))
                done
                ;;
            lastpipe)
                if [ "$mode" = "s" ]; then
                    _dhpk_ci_lastpipe=1
                elif [ "$mode" = "u" ]; then
                    # A conditional shopt may not run, so it must not hide lastpipe.
                    # A function body may turn it off for commands inside the body;
                    # the function exit merges fail-closed and restores a turn-off.
                    if [ "${_dhpk_ci_block:-0}" -eq 0 ] && [ "${_dhpk_ci_prev_sep:-}" != "and" ] && [ "${_dhpk_ci_prev_sep:-}" != "or" ]; then
                        _dhpk_ci_lastpipe=0
                    fi
                fi
                ;;
        esac
        k=$((k + 1))
    done
}

# The rest of the inspector lives in sibling modules (#1501), each under
# 256 KiB. They define functions only, so the load order does not matter.
_dhpk_ci_mod_dir="${BASH_SOURCE[0]%/*}"
case "${BASH_SOURCE[0]}" in */*) ;; *) _dhpk_ci_mod_dir=. ;; esac
# shellcheck disable=SC1090,SC1091
. "$_dhpk_ci_mod_dir/command-inspect-fn.sh"
# shellcheck disable=SC1090,SC1091
. "$_dhpk_ci_mod_dir/command-inspect-unwrap.sh"
# shellcheck disable=SC1090,SC1091
. "$_dhpk_ci_mod_dir/command-inspect-scan.sh"
# shellcheck disable=SC1090,SC1091
. "$_dhpk_ci_mod_dir/command-inspect-copies.sh"
# shellcheck disable=SC1090,SC1091
. "$_dhpk_ci_mod_dir/command-inspect-api.sh"
unset _dhpk_ci_mod_dir
