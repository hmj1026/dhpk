#!/usr/bin/env bash
# ShellCheck data-flow analysis does not finish on this file in CI time (the
# recursive body inspection added for trap, alias and arithmetic, #1448); the
# regular checks still run. Remove once the file is split (#1438-#1440).
# shellcheck extended-analysis=false
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
    _dhpk_ci_word=""
    _dhpk_ci_word_flat=""
    _dhpk_ci_word_dyn=0
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
    local raw="$1" val="${1,,}" ifs="$2" i=1 n sub
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

# True when a value holds a transform expansion of a variable that names git or is tainted.
_dhpk_ci_value_transforms_git() {
    local name re
    case "$1" in
        *'${'*) ;;
        *) return 1 ;;
    esac
    for name in ${_dhpk_ci_git_named:-} ${_dhpk_ci_git_taint:-}; do
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
            --no-verify|--no-verify=*) return 0 ;;
        esac
        [ "$2" = "commit" ] && _dhpk_ci_commit_short_no_verify "$fw" && return 0
    done
    return 1
}

# Judges a dynamic word in git commit or push argument position. Sets _dhpk_ci_flag_hit to
# no-verify (the expansion yields --no-verify), transformed (a transform of a flag variable
# can rebuild any flag), or empty.
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
        if _dhpk_ci_flag_value_no_verify "${!var}" "$2"; then
            _dhpk_ci_flag_hit="no-verify"
            return 0
        fi
    done
    return 0
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
    local re_build='(printf[[:space:]]+-v)[[:space:]]+([^;&|<]*)'
    local re_id='^[A-Za-z_][A-Za-z0-9_]*$'
    local -a ws_a
    _dhpk_ci_taint_ifs=0
    case "$rest" in
        *IFS=*|*IFS+=*) _dhpk_ci_taint_ifs=1 ;;
    esac
    case "${rest,,}" in
        *git*) ;;
        *) return 0 ;;
    esac
    _dhpk_ci_taint_gitassign=0
    while [[ "$rest" =~ $re_assign ]]; do
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
        var="_dhpk_ci_tv_$name"
        printf -v "$var" '%s %s' "${!var:-}" "$v"
        case "${v,,}" in *git*) _dhpk_ci_taint_gitassign=1 ;; esac
        case "$names" in *" $name "*) ;; *) names="$names$name " ;; esac
    done
    for name in $names; do
        var="_dhpk_ci_tv_$name"
        if _dhpk_ci_git_value_risky "${!var}" "$_dhpk_ci_taint_ifs"; then
            _dhpk_ci_taint_add "$name"
        elif _dhpk_ci_word_mentions_git "${!var,,}"; then
            _dhpk_ci_git_named="${_dhpk_ci_git_named}$name "
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
        unset "$var"
    done
    _dhpk_ci_scan_namerefs "$1"
    rest="$1"
    while [[ "$rest" =~ $re_build ]]; do
        seg="${BASH_REMATCH[2]}"
        rest="${rest#*"${BASH_REMATCH[0]}"}"
        if [ "$_dhpk_ci_taint_ifs" = "1" ] || _dhpk_ci_word_mentions_git "${1,,}"; then
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
            else
                _dhpk_ci_taint_add "$name"
            fi
        done
    done
}

# True when the word expands a variable that holds risky git text.
_dhpk_ci_word_uses_taint() {
    local w="$1" name re
    if [ "${_dhpk_ci_taint_gitassign:-0}" = "1" ]; then
        case "$w" in
            *'${!'[A-Za-z_]*) return 0 ;;
        esac
    fi
    # (#1456) A transformed expansion (${l/log/push}, ${l%log}, ${l:0}, ${l@P}) of a variable whose
    # visible value names git can rebuild any git command, so it is risky even when the value is read-only.
    for name in ${_dhpk_ci_git_named:-}; do
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
    _dhpk_ci_shfn_name+=("$name")
    _dhpk_ci_shfn_body+=("$body")
}
_dhpk_ci_fn_restore_live() {
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
    _dhpk_ci_u_watch_opaque=0
    _dhpk_ci_u_su_c_payload=""
    _dhpk_ci_u_su_login=0
    _dhpk_ci_u_dyn_shell_c=0
    _dhpk_ci_u_unsupported=""

    k=0
    while [ "$k" -lt "$h" ]; do
        w="${_dhpk_ci_words[$k]}"
        case "$w" in
            CDPATH=*|CDPATH+=*) _dhpk_ci_u_cdpath=1 ;;
        esac
        _dhpk_ci_note_assign "$w"
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
                        _dhpk_ci_note_assign "$w"
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
                                        _dhpk_ci_note_assign "$tok"
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
                                        _dhpk_ci_note_assign "$tok"
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
            unbuffer)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        -p) k=$((k + 1)) ;;
                        -*) _dhpk_ci_u_stop_fail=1; break ;;
                        *) break ;;
                    esac
                done
                continue
                ;;
            flock)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        --shared|--exclusive|--nonblock|--nb|--close|--no-fork|--verbose)
                            k=$((k + 1)) ;;
                        --wait=*|--timeout=*|--conflict-exit-code=*)
                            k=$((k + 1)) ;;
                        --wait|--timeout|--conflict-exit-code)
                            k=$((k + 2)) ;;
                        --*) _dhpk_ci_u_stop_fail=1; break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            [ "$olen" -gt 0 ] || { _dhpk_ci_u_stop_fail=1; break; }
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    w|E)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    h|V) _dhpk_ci_u_query_only=1; k="$n"; consumed=2; break ;;
                                    s|x|e|n|o|F|v) ;;
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
                if [ "$_dhpk_ci_u_stop_fail" -eq 0 ] && [ "$_dhpk_ci_u_query_only" -eq 0 ] && [ "$k" -lt "$n" ]; then
                    k=$((k + 1))
                    if [ "$k" -lt "$n" ]; then
                        case "${_dhpk_ci_u_words[$k]}" in
                            -c|--command|--command=*) _dhpk_ci_u_stop_fail=1 ;;
                        esac
                    fi
                fi
                continue
                ;;
            watch)
                k=$((k + 1))
                while [ "$k" -lt "$n" ]; do
                    tok="${_dhpk_ci_u_words[$k]}"
                    case "$tok" in
                        --) k=$((k + 1)); break ;;
                        --help|--version) _dhpk_ci_u_query_only=1; k="$n"; break ;;
                        --beep|--color|--no-color|--errexit|--chgexit|--precise|--no-rerun|--no-title|--no-wrap|--exec)
                            k=$((k + 1)) ;;
                        --differences|--differences=*)
                            k=$((k + 1)) ;;
                        --interval=*|--equexit=*)
                            k=$((k + 1)) ;;
                        --interval|--equexit)
                            k=$((k + 2)) ;;
                        --*) _dhpk_ci_u_stop_fail=1; break ;;
                        -*)
                            opt="${tok#-}"
                            oi=0
                            olen="${#opt}"
                            consumed=0
                            [ "$olen" -gt 0 ] || { _dhpk_ci_u_stop_fail=1; break; }
                            while [ "$oi" -lt "$olen" ]; do
                                och="${opt:$oi:1}"
                                case "$och" in
                                    n|q)
                                        if [ $((oi + 1)) -lt "$olen" ]; then
                                            k=$((k + 1))
                                        else
                                            k=$((k + 2))
                                        fi
                                        consumed=1
                                        break
                                        ;;
                                    d)
                                        if [ $((oi + 1)) -lt "$olen" ] && [ "${opt:$((oi + 1)):1}" = "=" ]; then
                                            k=$((k + 1))
                                            consumed=1
                                            break
                                        fi
                                        ;;
                                    h|v) _dhpk_ci_u_query_only=1; k="$n"; consumed=2; break ;;
                                    b|c|C|e|g|p|r|t|w|x) ;;
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
                if [ "$_dhpk_ci_u_stop_fail" -eq 0 ] && [ "$_dhpk_ci_u_query_only" -eq 0 ]; then
                    local _wk="$k" _watch_meta=0
                    while [ "$_wk" -lt "$n" ]; do
                        case "${_dhpk_ci_u_words[$_wk]}" in
                            *[[:space:]\;\|\&\<\>\(\)\$\`\'\"\\]*)
                                _watch_meta=1
                                break
                                ;;
                        esac
                        _wk=$((_wk + 1))
                    done
                    if [ "$_watch_meta" -eq 1 ]; then
                        _dhpk_ci_u_watch_opaque=1
                        break
                    fi
                fi
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
            if [ "$_dhpk_ci_u_watch_opaque" -eq 1 ]; then
                while [ "$_scan_k" -lt "$n" ]; do
                    if _dhpk_ci_word_mentions_git "${_dhpk_ci_u_words[$_scan_k]}"; then
                        _dhpk_ci_u_unsupported="unmodelled wrapper before git"
                        break
                    fi
                    _scan_k=$((_scan_k + 1))
                done
            elif [ "$_dhpk_ci_u_stop_fail" -eq 1 ]; then
                _scan_reason="wrapper with unmodelled options before git"
                while [ "$_scan_k" -lt "$n" ]; do
                    if _dhpk_ci_word_mentions_git "${_dhpk_ci_u_words[$_scan_k]}"; then
                        _dhpk_ci_u_unsupported="$_scan_reason"
                        break
                    fi
                    _scan_k=$((_scan_k + 1))
                done
                _scan_reason=""
            elif [ "$k" -lt "$n" ] && [ "${_dhpk_ci_u_dyn[$k]}" = "1" ]; then
                if _dhpk_ci_dyn_shell_c_literal "$k"; then
                    :
                elif _dhpk_ci_word_uses_taint "${_dhpk_ci_u_words[$k]}"; then
                    _dhpk_ci_u_unsupported="dynamic command word"
                elif _dhpk_ci_word_default_git "${_dhpk_ci_u_words[$k]}"; then
                    _dhpk_ci_u_unsupported="dynamic command word"
                elif _dhpk_ci_dynamic_head_is_write "$k"; then
                    _dhpk_ci_u_unsupported="dynamic command word"
                elif _dhpk_ci_tail_has_wrapped_git_risk "$((k + 1))"; then
                    _scan_reason="dynamic command word before git"
                else
                    local _dk=$((k + 1))
                    while [ "$_dk" -lt "$n" ]; do
                        case "${_dhpk_ci_u_words[$_dk]}" in
                            git\ *|*/git\ *) _scan_reason="dynamic command word before git"; break ;;
                        esac
                        _dk=$((_dk + 1))
                    done
                fi
            else
                case "${_dhpk_ci_u_head##*/}" in
                    setsid|ionice|chrt|taskset|strace|ltrace|script|unshare|nsenter|chroot|runuser|parallel|numactl|fakeroot|busybox|systemd-run|xvfb-run|dbus-run-session|firejail|eatmydata|faketime|prlimit|pkexec)
                        _scan_reason="unmodelled wrapper before git" ;;
                    su)
                        if ! _dhpk_ci_parse_su_c "$k"; then
                            _scan_reason="unmodelled wrapper before git"
                        fi
                        ;;
                    find)
                        if _dhpk_ci_find_exec_has_git "$((k + 1))"; then
                            _dhpk_ci_u_unsupported="find -exec with git"
                        fi
                        ;;
                    ssh)
                        ;;
                    *)
                        if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head" \
                            && _dhpk_ci_tail_uses_taint "$((k + 1))"; then
                            _dhpk_ci_u_unsupported="dynamic command word"
                        fi
                        # An unlisted head is not proof the following git is
                        # data. ssh is a remote command, not a local wrapper.
                        # _dhpk_ci_operands_are_data skips utilities that never
                        # execute their operands; awk and sed are not among them.
                        if ! _dhpk_ci_operands_are_data "${_dhpk_ci_u_head##*/}"; then
                            if _dhpk_ci_tail_has_wrapped_git_risk "$((k + 1))"; then
                                _scan_reason="unmodelled wrapper before git"
                            fi
                        fi
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
            --git-dir|--work-tree|--exec-path|--namespace|--super-prefix|--config-env|--list-cmds|--attr-source|--shallow-file|-c)
                state="unresolved"
                i=$((i + 1))
                [ "$i" -lt "$n" ] && i=$((i + 1))
                ;;
            --git-dir=*|--work-tree=*|--exec-path=*|--namespace=*|--super-prefix=*|--config-env=*|--list-cmds=*|--attr-source=*|--shallow-file=*|-c*)
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
            _dhpk_ci_unsupported "dynamic git subcommand"
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
        if [ "${_dhpk_ci_u_dyn[$j]}" = "1" ]; then
            _dhpk_ci_dyn_git_flag "$word" "$sub"
            case "$_dhpk_ci_flag_hit" in
                no-verify) no_verify=1 ;;
                transformed) _dhpk_ci_unsupported "transformed git flag" ;;
            esac
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
    # A separate export/declare/typeset earlier in this inspection still
    # relocates git. Keep the same unresolved target as a prefix assignment.
    [ "${_dhpk_ci_git_env_sticky:-0}" -eq 1 ] && _dhpk_ci_u_git_env_unresolved=1
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
                '!'|'{'|if|then|else|elif|do|while|until) h=$((h + 1)); continue ;;
                coproc)
                    h=$((h + 1))
                    # coproc NAME { ... } — the name is not the command word.
                    case "${_dhpk_ci_words[$h]:-}" in
                        '{'|'('|if|while|until|for|case|'') ;;
                        *)
                            case "${_dhpk_ci_words[$((h + 1))]:-}" in
                                '{'|'('|if|while|until|for|case) h=$((h + 1)) ;;
                            esac
                            ;;
                    esac
                    continue
                    ;;
                time)
                    [ "${_dhpk_ci_words[$((h + 1))]:-}" = "-p" ] && h=$((h + 1))
                    [ "${_dhpk_ci_words[$((h + 1))]:-}" = "--" ] && h=$((h + 1))
                    h=$((h + 1))
                    continue
                    ;;
            esac
        fi
        case "${_dhpk_ci_words[$h]}" in
            # (#1460) A word that starts with an expansion (${l:=git commit}) is a command word, not a NAME=value assignment.
            '$'*) break ;;
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
    _dhpk_ci_grp_lastpipe[$_dhpk_ci_grp_depth]="${_dhpk_ci_lastpipe:-0}"
    _dhpk_ci_grp_kind[$_dhpk_ci_grp_depth]="$1"
    _dhpk_ci_grp_cmd0[$_dhpk_ci_grp_depth]="$2"
    _dhpk_ci_grp_pipe[$_dhpk_ci_grp_depth]="$3"
    # Paren pins live on the paren stack. Record that index before it increments.
    if [ "$1" = "paren" ]; then
        _dhpk_ci_grp_pidx[$_dhpk_ci_grp_depth]="${_dhpk_ci_paren:-0}"
    else
        _dhpk_ci_grp_pidx[$_dhpk_ci_grp_depth]=-1
    fi
    # `{`, if, while, for and case run in this shell and share the pipe.
    # Snapshot before echo replaces the buffer. `(` keeps its own pin.
    if [ "$1" != "paren" ] && [ "${_dhpk_ci_after_pipe:-0}" = "1" ]; then
        _dhpk_ci_gpin_text[$_dhpk_ci_grp_depth]="${_dhpk_ci_pipe_text:-}"
        _dhpk_ci_gpin_known[$_dhpk_ci_grp_depth]="${_dhpk_ci_pipe_known:-0}"
        _dhpk_ci_gpin_live[$_dhpk_ci_grp_depth]=1
        _dhpk_ci_after_pipe=0
    else
        _dhpk_ci_gpin_text[$_dhpk_ci_grp_depth]=""
        _dhpk_ci_gpin_known[$_dhpk_ci_grp_depth]=0
        _dhpk_ci_gpin_live[$_dhpk_ci_grp_depth]=0
    fi
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
    # Fourth arg 1: eval/source run here, so read bindings stay. A child
    # shell and a pipeline stage do not.
    _dhpk_ci_share_rf="${4:-0}"
    _dhpk_ci_list "$1" 0 body
    _dhpk_ci_share_rf=0
}

_dhpk_ci_extract_shell_c() {
    local k="$1" n="${#_dhpk_ci_u_words[@]}" saw_c=0 w opt oi olen skip_ops fallback=-1 sign arg j
    _dhpk_ci_shell_c_payload=""
    _dhpk_ci_shell_allexport=0
    _dhpk_ci_shell_lastpipe=0
    _dhpk_ci_shell_reads_stdin=0
    _dhpk_ci_shell_saw_s=0
    _dhpk_ci_shell_file_idx=-1
    _dhpk_ci_shell_keep_stdin=0
    while [ "$k" -lt "$n" ]; do
        w="${_dhpk_ci_u_words[$k]}"
        case "$w" in
            --|-) k=$((k + 1)); break ;;
            --rcfile|--init-file|--startup-cmd) k=$((k + 2)) ;;
            --*) k=$((k + 1)) ;;
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
                        s) [ "$sign" -eq 1 ] && _dhpk_ci_shell_saw_s=1 ;;
                        a) [ "$sign" -eq 1 ] && _dhpk_ci_shell_allexport=1 ;;
                        o|O)
                            if [ $((oi + 1)) -lt "$olen" ] && [ "$sign" -eq 1 ]; then
                                arg="${opt:$((oi + 1))}"
                                if [ "$arg" = "allexport" ]; then
                                    _dhpk_ci_shell_allexport=1
                                    oi=$olen
                                elif [ "$arg" = "lastpipe" ]; then
                                    _dhpk_ci_shell_lastpipe=1
                                    oi=$olen
                                else
                                    skip_ops=$((skip_ops + 1))
                                fi
                            else
                                skip_ops=$((skip_ops + 1))
                            fi
                            ;;
                    esac
                    oi=$((oi + 1))
                done
                j=1
                while [ "$j" -le "$skip_ops" ]; do
                    arg="${_dhpk_ci_u_words[$((k + j))]:-}"
                    if [ "$sign" -eq 1 ] && [ "$arg" = "allexport" ]; then
                        _dhpk_ci_shell_allexport=1
                    fi
                    if [ "$sign" -eq 1 ] && [ "$arg" = "lastpipe" ]; then
                        _dhpk_ci_shell_lastpipe=1
                    fi
                    j=$((j + 1))
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
    # 1: this shell reads its script from stdin. 2: an operand is dynamic,
    # so the script may be a file or stdin and neither is visible.
    # keep_stdin: the script source is already known, so a later dynamic
    # argument is not the script file.
    if [ -n "$_dhpk_ci_shell_c_payload" ]; then
        _dhpk_ci_shell_reads_stdin=0
    elif [ "$_dhpk_ci_shell_saw_s" -eq 1 ]; then
        _dhpk_ci_shell_reads_stdin=1
        _dhpk_ci_shell_keep_stdin=1
    elif [ "$k" -lt "$n" ]; then
        w="${_dhpk_ci_u_words[$k]}"
        _dhpk_ci_shell_file_idx=$k
        if _dhpk_ci_is_stdin_op "$w"; then
            _dhpk_ci_shell_reads_stdin=1
            _dhpk_ci_shell_keep_stdin=1
            _dhpk_ci_shell_file_idx=-1
        elif _dhpk_ci_ps_at_index $((h + k)); then
            _dhpk_ci_shell_reads_stdin=0
            _dhpk_ci_shell_keep_stdin=1
        elif [ "${_dhpk_ci_u_dyn[$k]:-0}" != "1" ] && _dhpk_ci_stdin_device "$w"; then
            _dhpk_ci_shell_reads_stdin=1
            _dhpk_ci_shell_keep_stdin=1
        else
            _dhpk_ci_shell_reads_stdin=0
        fi
    else
        _dhpk_ci_shell_reads_stdin=1
    fi
    if [ "$_dhpk_ci_shell_reads_stdin" -eq 0 ] && [ -z "$_dhpk_ci_shell_c_payload" ] && [ "$_dhpk_ci_shell_keep_stdin" -eq 0 ]; then
        j="$k"
        while [ "$j" -lt "$n" ]; do
            if [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ]; then
                _dhpk_ci_shell_reads_stdin=2
                break
            fi
            j=$((j + 1))
        done
    elif [ "$_dhpk_ci_shell_reads_stdin" -eq 1 ] && [ "$_dhpk_ci_shell_saw_s" -eq 0 ] && [ "$_dhpk_ci_shell_keep_stdin" -eq 0 ]; then
        j="$1"
        while [ "$j" -lt "$n" ]; do
            if [ "${_dhpk_ci_u_dyn[$j]:-0}" = "1" ]; then
                _dhpk_ci_shell_reads_stdin=2
                break
            fi
            j=$((j + 1))
        done
    fi
}

_dhpk_ci_flush_command() {
    local sep="$1" n h head k cond kwhead="" git_has_c forge_text cmd_idx="${#DHPK_CMD_START[@]}"
    local -a _dhpk_ci_u_words _dhpk_ci_u_dyn _dhpk_ci_u_quoted _dhpk_ci_u_flat
    local _dhpk_ci_u_idx=0 _dhpk_ci_u_head="" _dhpk_ci_u_cwd="$_dhpk_ci_cwd" _dhpk_ci_u_cwd_state="$_dhpk_ci_cwd_state"
    local _dhpk_ci_u_chdir_set=0 _dhpk_ci_u_query_only=0 _dhpk_ci_u_quoted_wrapper=0
    local _dhpk_ci_u_git_env_unresolved=0 _dhpk_ci_u_cdpath=0 _dhpk_ci_u_has_dyn_split=0 _dhpk_ci_u_stop_fail=0 _dhpk_ci_u_via_xargs=0 _dhpk_ci_u_xrep="" _dhpk_ci_u_watch_opaque=0 _dhpk_ci_u_su_c_payload="" _dhpk_ci_u_su_login=0 _dhpk_ci_u_dyn_shell_c=0 _dhpk_ci_u_unsupported=""
    local _dhpk_ci_shell_c_payload="" _eval_payload="" _eval_literal="" _hs_i=0 _git_before=0 _cd_i=0 _cd_opts=1 _cd_w="" _cd_is_dash=0
    local _dhpk_ci_child_sticky_saved=0 _dhpk_ci_child_allexport_saved=0
    local _dhpk_ci_fn_simple=0 _dhpk_ci_fn_simple_allexport=0 _dhpk_ci_fn_simple_sticky=0 _dhpk_ci_fn_simple_lastpipe=0
    local _dhpk_ci_shell_allexport=0 _dhpk_ci_shell_lastpipe=0 _dhpk_ci_u_shellopts_allexport=0 _dhpk_ci_u_bash_env=0 _dhpk_ci_u_bashopts_lastpipe=0
    local _dhpk_ci_child_bash_env_saved=0 _dhpk_ci_child_shellopts_saved=0 _dhpk_ci_child_lastpipe_saved=0
    local _dhpk_ci_in_stage=0 _dhpk_ci_saw_export_flag=0 _dhpk_ci_allexport_before=0
    local _dhpk_ci_cmd_lastpipe=0 _dhpk_ci_cmd_sticky=0 _dhpk_ci_cmd_allexport=0 _dhpk_ci_cmd_ifs=0 _dhpk_ci_cmd_ifs_set=0 _dhpk_ci_brace_pipe_pop=0 _dhpk_ci_ifs_at_body=-1 _dhpk_ci_ifs_stamp_at=0 _dhpk_ci_cmd_prev_sep="" _dhpk_ci_sep_held=""
    _dhpk_ci_flush_word
    _dhpk_ci_redir=0
    n="${#_dhpk_ci_words[@]}"
    head=""
    if [ "$n" -eq 0 ] && [ "${#_dhpk_ci_hs_flat[@]}" -gt 0 ]; then
        _dhpk_ci_all_hs_flat+=("${_dhpk_ci_hs_flat[@]}")
    fi
    if [ "$n" -gt 0 ]; then
        # Snapshot before this command's shopt or export. A `{` in this
        # command is pushed later, after those mutations.
        _dhpk_ci_cmd_lastpipe="${_dhpk_ci_lastpipe:-0}"
        _dhpk_ci_cmd_sticky="${_dhpk_ci_git_env_sticky:-0}"
        _dhpk_ci_cmd_allexport="${_dhpk_ci_allexport:-0}"
        _dhpk_ci_cmd_ifs="${_dhpk_ci_ifs_custom:-0}"
        _dhpk_ci_ifs_stamp_at="${_dhpk_ci_ifs_stamp:-0}"
        _dhpk_ci_cmd_prev_sep="${_dhpk_ci_prev_sep:-}"
        _dhpk_ci_cmd_intro_cond=0
        if [ "${_dhpk_ci_prev_sep:-}" = "and" ] || [ "${_dhpk_ci_prev_sep:-}" = "or" ] || [ "${_dhpk_ci_block:-0}" -gt 0 ] || [ "${_dhpk_ci_fn_depth:-0}" -gt 0 ] || [ "${_dhpk_ci_fn_cdepth:-0}" -gt 0 ]; then
            _dhpk_ci_cmd_intro_cond=1
        fi
        _dhpk_ci_fn_copened=0
        _dhpk_ci_note_intro_dead
        _dhpk_ci_cmd_ifs_set=1
        _dhpk_ci_rf_at="${#_dhpk_ci_rf_name[@]}"
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
        _dhpk_ci_apply_read_fed "$_dhpk_ci_u_head"
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
            # One pipeline stage, background command, or coproc body is one
            # subshell. A compound stage ({ } or ( )) shares that frame
            # across the simple commands inside it.
            if [ "$sep" = "pipe" ] || [ "$sep" = "bg" ] || [ "${_dhpk_ci_pipe_id:-0}" -gt 0 ]; then
                _dhpk_ci_in_stage=1
            else
                k=0
                while [ "$k" -lt "$h" ]; do
                    if [ "${_dhpk_ci_words[$k]}" = "coproc" ]; then
                        _dhpk_ci_in_stage=1
                        break
                    fi
                    k=$((k + 1))
                done
            fi
            if [ "$_dhpk_ci_in_stage" -eq 1 ] && [ "${_dhpk_ci_stage_open:-0}" -eq 0 ]; then
                _dhpk_ci_ss_push stage
                _dhpk_ci_stage_open=1
                # Decide keep-or-pop from the value at entry. A shopt inside
                # this stage must not change that choice.
                _dhpk_ci_stage_lastpipe="${_dhpk_ci_lastpipe:-0}"
            fi
            # Open or close a function body before this command's export or
            # `set -a` runs, so the saved caller state is the pre-body value.
            if [ "$head" = "function" ]; then
                _dhpk_ci_func=1
                _dhpk_ci_fn_pending=1
                _dhpk_ci_fn_pending_cond="${_dhpk_ci_cmd_intro_cond:-0}"
                _dhpk_ci_fn_pending_dead="${_dhpk_ci_cmd_intro_dead:-0}"
                _dhpk_ci_fn_pending_name=""
                if [ $((h + 1)) -lt "$n" ]; then
                    _dhpk_ci_fn_pending_name="${_dhpk_ci_words[$((h + 1))]}"
                fi
            fi
            k=0
            while [ "$k" -lt "$n" ]; do
                case "${_dhpk_ci_words[$k]}" in
                    '{')
                        if [ "$k" -lt "$h" ] || [ "$head" = "function" ]; then
                            _dhpk_ci_fn_see_open_brace
                        fi
                        ;;
                    '}')
                        if [ "$head" = "}" ] || [ "$k" -lt "$h" ]; then
                            _dhpk_ci_fn_see_close_brace
                        fi
                        ;;
                esac
                k=$((k + 1))
            done
            if [ "${_dhpk_ci_fn_pending:-0}" -eq 1 ] && _dhpk_ci_fn_is_compound_body; then
                _dhpk_ci_fn_compound_open
            elif [ "${_dhpk_ci_fn_pending:-0}" -eq 1 ] && [ "$head" != "function" ]; then
                _dhpk_ci_fn_simple_allexport="${_dhpk_ci_allexport:-0}"
                _dhpk_ci_fn_simple_sticky="${_dhpk_ci_git_env_sticky:-0}"
                _dhpk_ci_fn_simple_lastpipe="${_dhpk_ci_lastpipe:-0}"
                _dhpk_ci_fn_simple_name="${_dhpk_ci_fn_pending_name:-}"
                if [ "${_dhpk_ci_fn_pending_dead:-0}" = "1" ]; then
                    _dhpk_ci_fn_open_def "${_dhpk_ci_fn_pending_name:-}"
                else
                    _dhpk_ci_fn_pending=0
                fi
                _dhpk_ci_fn_simple=1
            fi
            case "$_dhpk_ci_u_head" in
                export|declare|typeset|local|readonly)
                    _dhpk_ci_saw_export_flag=0
                    [ "$_dhpk_ci_u_head" = "export" ] && _dhpk_ci_saw_export_flag=1
                    k=$((_dhpk_ci_u_idx + 1))
                    while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
                        case "${_dhpk_ci_u_words[$k]}" in
                            --) break ;;
                            -*[xX]*) _dhpk_ci_saw_export_flag=1 ;;
                        esac
                        k=$((k + 1))
                    done
                    k=$((_dhpk_ci_u_idx + 1))
                    while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
                        _dhpk_ci_note_git_assign "${_dhpk_ci_u_words[$k]}"
                        case "${_dhpk_ci_u_words[$k]}" in
                            CDPATH|CDPATH=*|CDPATH+=*) _dhpk_ci_saw_cdpath=1 ;;
                            SHELL|SHELL=*|SHELL+=*) _dhpk_ci_saw_shell_assign=1 ;;
                            IFS=*|IFS+=*) _dhpk_ci_note_assign "${_dhpk_ci_u_words[$k]}" ;;
                        esac
                        case "$_dhpk_ci_u_head" in
                            export|declare|typeset|local)
                                _dhpk_ci_word_sets_git_env "${_dhpk_ci_u_words[$k]}" && _dhpk_ci_git_env_sticky=1
                                if [ "$_dhpk_ci_saw_export_flag" -eq 1 ] || [ "${_dhpk_ci_allexport:-0}" -eq 1 ]; then
                                    _dhpk_ci_note_exported_shell_var "${_dhpk_ci_u_words[$k]}"
                                fi
                                ;;
                            readonly)
                                if [ "${_dhpk_ci_allexport:-0}" -eq 1 ]; then
                                    _dhpk_ci_word_sets_git_env "${_dhpk_ci_u_words[$k]}" && _dhpk_ci_git_env_sticky=1
                                    _dhpk_ci_note_exported_shell_var "${_dhpk_ci_u_words[$k]}"
                                fi
                                ;;
                        esac
                        k=$((k + 1))
                    done
                    ;;
            esac
            # set -a exports a later shell assignment. A command that is only
            # that assignment has no command word. A prefix on a real command
            # does not remain after it. set +a does not clear sticky.
            if [ -z "$_dhpk_ci_u_head" ] && [ "${_dhpk_ci_allexport:-0}" -eq 1 ]; then
                k=0
                while [ "$k" -lt "$h" ]; do
                    _dhpk_ci_word_sets_git_env "${_dhpk_ci_words[$k]}" && _dhpk_ci_git_env_sticky=1
                    _dhpk_ci_note_exported_shell_var "${_dhpk_ci_words[$k]}"
                    k=$((k + 1))
                done
            fi
            case "$_dhpk_ci_u_head" in
                set)
                    _dhpk_ci_allexport_before="${_dhpk_ci_allexport:-0}"
                    _dhpk_ci_apply_set_allexport $((_dhpk_ci_u_idx + 1))
                    # A set that may not run must not hide a relocation that
                    # is still exported. A following command in this shell may
                    # still turn allexport off.
                    if [ "$_dhpk_ci_block" -gt 0 ] || [ "$_dhpk_ci_prev_sep" = "and" ] || [ "$_dhpk_ci_prev_sep" = "or" ]; then
                        if [ "$_dhpk_ci_allexport_before" -eq 1 ] && [ "${_dhpk_ci_allexport:-0}" -eq 0 ]; then
                            _dhpk_ci_allexport=1
                        fi
                    fi
                    ;;
                printf) _dhpk_ci_allexport_printf ;;
                read) _dhpk_ci_note_read_fed; _dhpk_ci_allexport_read ;;
                shopt) _dhpk_ci_apply_shopt ;;
            esac
        fi
        _dhpk_ci_record_git
        _git_before="$DHPK_GIT_COUNT"
        if [ "$_dhpk_ci_u_query_only" -eq 0 ]; then
            _dhpk_ci_arith_collect_assignments
            case "$_dhpk_ci_u_head" in
                trap) _dhpk_ci_trap_action ;;
                alias) _dhpk_ci_alias_words ;;
                let|'[[') _dhpk_ci_arith_consumer_words ;;
                eval)
                    # The body sees this command's prefix IFS. A later
                    # restore drops that prefix unless the body assigns IFS.
                    _dhpk_ci_ifs_at_body="${_dhpk_ci_ifs_stamp:-0}"
                    _dhpk_ci_saw_eval=1
                    k=$((_dhpk_ci_u_idx + 1))
                    if [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ] && [ "${_dhpk_ci_u_words[$k]}" = "--" ]; then
                        k=$((k + 1))
                    fi
                    _eval_payload=""
                    _eval_literal=""
                    while [ "$k" -lt "${#_dhpk_ci_u_words[@]}" ]; do
                        _dhpk_ci_eval_piece=""
                        _dhpk_ci_eval_see_word "${_dhpk_ci_u_words[$k]}"
                        if [ -n "$_eval_payload" ]; then
                            _eval_payload+=" ${_dhpk_ci_u_words[$k]}"
                        else
                            _eval_payload="${_dhpk_ci_u_words[$k]}"
                        fi
                        # A printf/echo substitution contributes the text
                        # eval will run. The raw $(...) was already scanned
                        # as its own list, so it is not copied again.
                        _eval_add=""
                        if [ -n "${_dhpk_ci_eval_piece:-}" ]; then
                            _eval_add="$_dhpk_ci_eval_piece"
                        elif ! _dhpk_ci_eval_word_seen "${_dhpk_ci_u_words[$k]}"; then
                            _eval_add="${_dhpk_ci_u_words[$k]}"
                        fi
                        if [ -n "$_eval_add" ]; then
                            if [ -n "$_eval_literal" ]; then
                                _eval_literal+=" $_eval_add"
                            else
                                _eval_literal="$_eval_add"
                            fi
                        fi
                        k=$((k + 1))
                    done
                    if _dhpk_ci_eval_starts_unseen "$_eval_payload"; then
                        _dhpk_ci_unsupported "unresolved eval"
                    elif [ -n "$_eval_literal" ]; then
                        _dhpk_ci_inspect_body_cwd "$_eval_literal" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state" 1
                    fi
                    _hs_i=0
                    while [ "$_hs_i" -lt "${#_dhpk_ci_hs_flat[@]}" ]; do
                        if [ -n "${_dhpk_ci_hs_flat[$_hs_i]}" ]; then
                            _dhpk_ci_inspect_body_cwd "${_dhpk_ci_hs_flat[$_hs_i]}" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state" 1
                        fi
                        _hs_i=$((_hs_i + 1))
                    done
                    ;;
                source|'.')
                    _dhpk_ci_ifs_at_body="${_dhpk_ci_ifs_stamp:-0}"
                    _dhpk_ci_saw_source=1
                    _hs_i=0
                    while [ "$_hs_i" -lt "${#_dhpk_ci_hs_flat[@]}" ]; do
                        if [ -n "${_dhpk_ci_hs_flat[$_hs_i]}" ]; then
                            _dhpk_ci_inspect_body_cwd "${_dhpk_ci_hs_flat[$_hs_i]}" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state" 1
                        fi
                        _hs_i=$((_hs_i + 1))
                    done
                    ;;
                *)
                    if _dhpk_ci_is_shell_word "$_dhpk_ci_u_head"; then
                        # A new shell inherits exported Git variables but not
                        # set -a. Options and SHELLOPTS can turn allexport on
                        # for the child only. Restore afterwards so the child
                        # cannot clear or publish the caller's relocation state.
                        _dhpk_ci_extract_shell_c $((_dhpk_ci_u_idx + 1))
                        _dhpk_ci_child_shell_enter
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
                        if [ -n "$_dhpk_ci_shell_c_payload" ] && ! dhpk_command_is_trivial "$_dhpk_ci_shell_c_payload"; then
                            if [ "$_dhpk_ci_u_via_xargs" -eq 1 ]; then
                                _dhpk_ci_inspect_body_cwd "$_dhpk_ci_shell_c_payload" "" "unresolved"
                            else
                                _dhpk_ci_inspect_body_cwd "$_dhpk_ci_shell_c_payload" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                            fi
                        fi
                        _dhpk_ci_child_shell_leave
                    elif [ -n "$_dhpk_ci_u_su_c_payload" ]; then
                        _dhpk_ci_child_shell_enter
                        if ! dhpk_command_is_trivial "$_dhpk_ci_u_su_c_payload"; then
                            if [ "$_dhpk_ci_u_su_login" -eq 1 ]; then
                                _dhpk_ci_inspect_body_cwd "$_dhpk_ci_u_su_c_payload" "" "unresolved"
                            else
                                _dhpk_ci_inspect_body_cwd "$_dhpk_ci_u_su_c_payload" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                            fi
                        fi
                        _dhpk_ci_child_shell_leave
                    elif [ "$_dhpk_ci_u_dyn_shell_c" -eq 1 ]; then
                        _dhpk_ci_extract_shell_c $((_dhpk_ci_u_idx + 1))
                        _dhpk_ci_child_shell_enter
                        if [ -n "$_dhpk_ci_shell_c_payload" ] && ! dhpk_command_is_trivial "$_dhpk_ci_shell_c_payload"; then
                            _dhpk_ci_inspect_body_cwd "$_dhpk_ci_shell_c_payload" "$_dhpk_ci_u_cwd" "$_dhpk_ci_u_cwd_state"
                        fi
                        _dhpk_ci_child_shell_leave
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
                '{')
                    _dhpk_ci_grp_push brace "$cmd_idx" "$_dhpk_ci_pipe_id"
                    # Keep the value from before shopt/export in this command.
                    _dhpk_ci_grp_lastpipe[$((_dhpk_ci_grp_depth - 1))]="${_dhpk_ci_cmd_lastpipe:-0}"
                    _dhpk_ci_grp_sticky[$((_dhpk_ci_grp_depth - 1))]="${_dhpk_ci_cmd_sticky:-0}"
                    _dhpk_ci_grp_allexport[$((_dhpk_ci_grp_depth - 1))]="${_dhpk_ci_cmd_allexport:-0}"
                    _dhpk_ci_grp_ifs[$((_dhpk_ci_grp_depth - 1))]="${_dhpk_ci_cmd_ifs:-0}"
                    ;;
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
            '}')
                if _dhpk_ci_grp_pop brace && { [ "$sep" = "pipe" ] || [ "$sep" = "bg" ]; }; then
                    # Applied after the stage frame pops. A brace group on the
                    # left of a pipe, or run in the background, is a subshell.
                    # Its shopt and exports must not survive. A foreground
                    # brace group stays in this shell.
                    _dhpk_ci_brace_pipe_pop=1
                fi
                ;;
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
        # `function name if ...` keeps the opener after the head, so the
        # pre-head walk never counts it. Count it once before the frame closes.
        if [ "${_dhpk_ci_fn_copened:-0}" = "1" ]; then
            k=0
            while [ "$k" -lt "$n" ]; do
                case "${_dhpk_ci_words[$k]}" in
                    if|while|until|for|select|case)
                        if [ "$k" -ge "$h" ] && [ "$kwhead" != "${_dhpk_ci_words[$k]}" ]; then
                            _dhpk_ci_block=$((_dhpk_ci_block + 1))
                            case "${_dhpk_ci_words[$k]}" in
                                if) _dhpk_ci_grp_push if "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
                                case) _dhpk_ci_grp_push case "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
                                *) _dhpk_ci_grp_push loop "$cmd_idx" "$_dhpk_ci_pipe_id" ;;
                            esac
                        fi
                        break
                        ;;
                esac
                k=$((k + 1))
            done
        fi
        _dhpk_ci_fn_compound_close
        _dhpk_ci_finish_command_input
    fi
    # Heredocs opened by this command: the body is data for cat, tee, and
    # git (without -c/--config-env/--exec-path before the subcommand) unless
    # the command pipes into another one, its output can run as a command, or
    # the text writes into a process or a FIFO. Any other body is a script.
    if [ "$_dhpk_ci_hd_seen" -lt "${#_dhpk_ci_hd_d[@]}" ]; then
        git_has_c=0
        # gh and glab only store a standard-input body for their own issue,
        # pull request and release subcommands; any other word may name an
        # extension or alias that runs the text.
        forge_text=0
        case "$_dhpk_ci_u_head" in
            gh|*/gh) case "${_dhpk_ci_u_words[$((_dhpk_ci_u_idx + 1))]:-}" in issue|pr|release) forge_text=1 ;; esac ;;
            glab|*/glab) case "${_dhpk_ci_u_words[$((_dhpk_ci_u_idx + 1))]:-}" in issue|mr|release) forge_text=1 ;; esac ;;
        esac
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
                gh|*/gh|glab|*/glab)
                    if [ "$forge_text" -eq 0 ] || [ "$sep" = "pipe" ] || [ "$_dhpk_ci_xctx" -eq 1 ] || [ "$DHPK_HD_FORCE_EXEC" -eq 1 ]; then
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
        if [ "$n" -eq 0 ]; then
            # A compound group on the left of a pipe. Its stdout is not the
            # previous simple command's text.
            _dhpk_ci_pipe_text=""
            _dhpk_ci_pipe_known=0
        fi
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
            if [ "${_dhpk_ci_after_pipe:-0}" = "1" ] && [ "${_dhpk_ci_grp_depth:-0}" -eq 0 ]; then
                _dhpk_ci_subst_add "${_dhpk_ci_pipe_known:-1}" "${_dhpk_ci_pipe_text:-}"
                _dhpk_ci_pipe_text=""
                _dhpk_ci_pipe_known=1
            fi
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
    _dhpk_ci_fn_simple_leave
    # A prefix assignment is visible to this command only. An empty
    # assignment, a persisting builtin operand, and an eval/source body are
    # what remains afterwards. Stage and brace pops run after this and win:
    # a pipeline does not publish the prefix back to the caller.
    _dhpk_ci_ifs_during="${_dhpk_ci_ifs_custom:-0}"
    if [ "${_dhpk_ci_cmd_ifs_set:-0}" -eq 1 ]; then
        case "${_dhpk_ci_u_head:-}" in
            '') ;;
            export|declare|typeset|local|readonly)
                _dhpk_ci_ifs_custom="${_dhpk_ci_cmd_ifs:-0}"
                _dhpk_ci_ifs_stamp="${_dhpk_ci_ifs_stamp_at:-0}"
                # prev_sep is already this command's own separator. The
                # operand still depends on the separator that introduced it.
                _dhpk_ci_sep_held="${_dhpk_ci_prev_sep:-}"
                _dhpk_ci_prev_sep="${_dhpk_ci_cmd_prev_sep:-}"
                _dhpk_ci_ifs_apply_operands
                _dhpk_ci_prev_sep="$_dhpk_ci_sep_held"
                ;;
            eval|source|'.')
                # Body assignments bump the stamp. An unchanged stamp means
                # the prefix was the only IFS this command applied.
                if [ "${_dhpk_ci_ifs_stamp:-0}" = "${_dhpk_ci_ifs_at_body:-0}" ]; then
                    _dhpk_ci_ifs_custom="${_dhpk_ci_cmd_ifs:-0}"
                fi
                ;;
            *)
                _dhpk_ci_ifs_custom="${_dhpk_ci_cmd_ifs:-0}"
                _dhpk_ci_ifs_stamp="${_dhpk_ci_ifs_stamp_at:-0}"
                ;;
        esac
    fi
    if [ "${_dhpk_ci_stage_open:-0}" -eq 1 ] && [ "${_dhpk_ci_grp_depth:-0}" -eq 0 ]; then
        if [ "$_dhpk_ci_in_stage" -eq 1 ] && [ "$sep" != "pipe" ] && [ "$sep" != "bg" ] && [ "${_dhpk_ci_stage_lastpipe:-0}" -eq 1 ]; then
            # The last stage runs in this shell. Keep its exports.
            _dhpk_ci_ss_depth=$((${_dhpk_ci_ss_depth:-1} - 1))
            [ "$_dhpk_ci_ss_depth" -lt 0 ] && _dhpk_ci_ss_depth=0
        else
            _dhpk_ci_ss_pop
        fi
        _dhpk_ci_stage_open=0
    fi
    if [ "${_dhpk_ci_brace_pipe_pop:-0}" -eq 1 ]; then
        _dhpk_ci_lastpipe="${_dhpk_ci_grp_lastpipe[${_dhpk_ci_grp_depth}]:-0}"
        _dhpk_ci_git_env_sticky="${_dhpk_ci_grp_sticky[${_dhpk_ci_grp_depth}]:-0}"
        _dhpk_ci_allexport="${_dhpk_ci_grp_allexport[${_dhpk_ci_grp_depth}]:-0}"
        _dhpk_ci_ifs_custom="${_dhpk_ci_grp_ifs[${_dhpk_ci_grp_depth}]:-0}"
    fi
    # A read split with a different IFS than the one in force afterwards is
    # not a trustworthy argv.
    if [ "${_dhpk_ci_cmd_ifs_set:-0}" -eq 1 ] && [ "${_dhpk_ci_ifs_custom:-0}" = "1" ]; then
        if [ "${_dhpk_ci_cmd_ifs:-0}" = "0" ]; then
            # IFS is custom from here on, so earlier default-IFS reads are
            # not a finished argv.
            _dhpk_ci_rf_mark_since 0
        elif [ "${_dhpk_ci_ifs_during:-0}" = "0" ]; then
            _dhpk_ci_rf_mark_since "${_dhpk_ci_rf_at:-0}"
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
    unset _dhpk_ci_saw_eval _dhpk_ci_saw_source _dhpk_ci_saw_cd_dash _dhpk_ci_saw_cdpath _dhpk_ci_saw_shell_hs _dhpk_ci_saw_shell_feed _dhpk_ci_all_hs_flat _dhpk_ci_saw_shell_head _dhpk_ci_saw_shell_assign _dhpk_ci_git_taint _dhpk_ci_git_named _dhpk_ci_flag_names _dhpk_ci_flag_hit _dhpk_ci_taint_ifs _dhpk_ci_taint_gitassign _dhpk_ci_outps_depth _dhpk_ci_outps_acc _dhpk_ci_saw_arith_consumer _dhpk_ci_arith_texts
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
