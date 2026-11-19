#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2154  # state arrays are declared by the sibling modules
# command-inspect-unwrap.sh - wrapper unwrap, git record, shell -c extraction, command flush.
# Source-only module of command-inspect.sh (#1501); sourced by it, not by hooks.
# bash 3.2. Never executes the command under inspection.

_dhpk_ci_unwrap_head() {
    local k=0 n="${#_dhpk_ci_words[@]}" h="$_dhpk_ci_head"
    local assign_re='^[A-Za-z_][A-Za-z0-9_]*='
    local w base tok opt oi olen och consumed allow_assign=0
    local si sn split_arg split_dyn split_tail
    local -a _dhpk_ci_es_words _dhpk_ci_es_quoted _tail_w _tail_d _tail_q _tail_f _tail_s
    local _dhpk_ci_es_dyn=0
    _dhpk_ci_u_words=()
    _dhpk_ci_u_dyn=()
    _dhpk_ci_u_quoted=()
    _dhpk_ci_u_flat=()
    _dhpk_ci_u_split=()
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
        _dhpk_ci_u_split+=("${_dhpk_ci_split[$k]:-0}")
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
                            _tail_s=()
                            while [ "$si" -lt "$sn" ]; do
                                _tail_w+=("${_dhpk_ci_es_words[$si]}")
                                _tail_d+=("$_dhpk_ci_es_dyn")
                                _tail_q+=(0)
                                _tail_f+=("${_dhpk_ci_es_words[$si]}")
                                _tail_s+=(1)
                                si=$((si + 1))
                            done
                            while [ "$k" -lt "$n" ]; do
                                _tail_w+=("${_dhpk_ci_u_words[$k]}")
                                _tail_d+=("${_dhpk_ci_u_dyn[$k]}")
                                _tail_q+=("${_dhpk_ci_u_quoted[$k]}")
                                _tail_f+=("${_dhpk_ci_u_flat[$k]}")
                                _tail_s+=("${_dhpk_ci_u_split[$k]:-0}")
                                k=$((k + 1))
                            done
                            _dhpk_ci_u_words=(${_tail_w[@]+"${_tail_w[@]}"})
                            _dhpk_ci_u_dyn=(${_tail_d[@]+"${_tail_d[@]}"})
                            _dhpk_ci_u_quoted=(${_tail_q[@]+"${_tail_q[@]}"})
                            _dhpk_ci_u_flat=(${_tail_f[@]+"${_tail_f[@]}"})
                            _dhpk_ci_u_split=(${_tail_s[@]+"${_tail_s[@]}"})
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

# (#1468) True when the git -c / --config-env value $1 (KEY=VALUE) names core.hooksPath, or a key built by
# an expansion (which can name it). The key is compared without case, as git does.
_dhpk_ci_git_cfg_hooks() {
    local key="${1%%=*}"
    case "$key" in *[\$\`]*) return 0 ;; esac
    _dhpk_ci_lower "$key"
    [ "$_dhpk_ci_lc" = "core.hookspath" ]
}

_dhpk_ci_record_git() {
    [ "$_dhpk_ci_u_query_only" -eq 0 ] || return 0
    local i="$_dhpk_ci_u_idx" n="${#_dhpk_ci_u_words[@]}" sub="" state="cwd"
    local repo="$_dhpk_ci_u_cwd" c_path="" c_base="" no_verify=0 exempt=0 hooks=0
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
            -c|--config-env)
                state="unresolved"
                i=$((i + 1))
                if [ "$i" -lt "$n" ]; then
                    _dhpk_ci_git_cfg_hooks "${_dhpk_ci_u_words[$i]}" && hooks=1
                    i=$((i + 1))
                fi
                ;;
            --git-dir|--work-tree|--exec-path|--namespace|--super-prefix|--list-cmds|--attr-source|--shallow-file)
                state="unresolved"
                i=$((i + 1))
                [ "$i" -lt "$n" ] && i=$((i + 1))
                ;;
            --config-env=*)
                state="unresolved"
                _dhpk_ci_git_cfg_hooks "${word#--config-env=}" && hooks=1
                i=$((i + 1))
                ;;
            -c*)
                state="unresolved"
                _dhpk_ci_git_cfg_hooks "${word#-c}" && hooks=1
                i=$((i + 1))
                ;;
            --git-dir=*|--work-tree=*|--exec-path=*|--namespace=*|--super-prefix=*|--list-cmds=*|--attr-source=*|--shallow-file=*)
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
            --no-verify|--no-verify=*|--no-veri|--no-verif|--no-veri=*|--no-verif=*) no_verify=1 ;;
            --help|-h|--dry-run|--abort|--continue|--skip|--quit) exempt=1 ;;
        esac
        if [ "$sub" = "commit" ] && _dhpk_ci_commit_short_no_verify "$word"; then
            no_verify=1
        fi
        if [ "${_dhpk_ci_u_dyn[$j]}" != "1" ] && _dhpk_ci_glob_may_flag "$word" "$sub"; then
            case "$sub" in commit|push) _dhpk_ci_unsupported "transformed git flag" ;; esac
        fi
        if [ "${_dhpk_ci_u_dyn[$j]}" = "1" ] && ! _dhpk_ci_attached_value_word "$word" "${_dhpk_ci_u_split[$j]:-0}"; then
            _dhpk_ci_dyn_git_flag "$word" "$sub" "${_dhpk_ci_u_split[$j]:-0}"
            case "$_dhpk_ci_flag_hit" in
                no-verify) no_verify=1 ;;
                transformed) _dhpk_ci_unsupported "transformed git flag" ;;
            esac
        fi
        if _dhpk_ci_option_consumes_next "$word"; then
            _dhpk_ci_option_value_hit "$((j + 1))" "$sub"
            case "$_dhpk_ci_flag_hit" in
                no-verify) no_verify=1 ;;
                transformed) _dhpk_ci_unsupported "transformed git flag" ;;
            esac
            j=$((j + 2))
        else
            j=$((j + 1))
        fi
    done
    if [ "$_dhpk_ci_u_via_xargs" -eq 1 ]; then
        case "$sub" in commit|push|merge|rebase|cherry-pick|am) no_verify=2; state="unresolved" ;; esac
    fi
    # (#1468) core.hooksPath set for this invocation skips the repository hooks like --no-verify.
    [ "$hooks" = 1 ] && [ "$no_verify" = 0 ] && no_verify=3
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
    local -a _dhpk_ci_u_words _dhpk_ci_u_dyn _dhpk_ci_u_quoted _dhpk_ci_u_flat _dhpk_ci_u_split
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
