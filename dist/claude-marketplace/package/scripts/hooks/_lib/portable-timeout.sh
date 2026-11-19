#!/usr/bin/env bash
# portable-timeout.sh — run a command with a wall-clock deadline, portably.
# Source-only; no side effects on sourcing. Exposes:
#   run_with_timeout <seconds> <cmd> [args...]
# Prefers coreutils `timeout` / `gtimeout`; falls back to a perl alarm (present
# on macOS/BSD by default). Exit 124 means the deadline fired. Exit 125 means
# no deadline mechanism was available and the command was not started. An
# empty command list returns 0.
#
# Each branch sends TERM at the deadline, then KILL one second later if that
# process is still running. A child that exits 0 after the deadline still
# returns 124. The managed process is the command and the process group it
# starts in. A descendant that leaves the group is not stopped. This is not
# complete process-tree isolation.
_DHPK_TIMEOUT_GRACE=1

_dhpk_timeout_status() {
    [ "$1" -eq 137 ] && return 124
    return "$1"
}

run_with_timeout() {
    local _secs="$1" _rc=0; shift
    [ "$#" -gt 0 ] || return 0
    if command -v timeout >/dev/null 2>&1; then
        timeout -k "$_DHPK_TIMEOUT_GRACE" "$_secs" "$@"
        _rc=$?
    elif command -v gtimeout >/dev/null 2>&1; then
        gtimeout -k "$_DHPK_TIMEOUT_GRACE" "$_secs" "$@"
        _rc=$?
    elif command -v perl >/dev/null 2>&1; then
        perl -e '
            my $s = shift;
            my $grace = shift;
            my $pid = fork();
            if (!defined $pid) { exit 125; }
            if ($pid == 0) {
                setpgrp(0, 0);
                exec @ARGV or exit 127;
            }
            my $timed_out = 0;
            my $phase = 0;
            local $SIG{ALRM} = sub {
                $timed_out = 1;
                if ($phase == 0) {
                    $phase = 1;
                    kill "TERM", -$pid;
                    kill "TERM", $pid;
                    alarm $grace;
                } else {
                    kill "KILL", -$pid;
                    kill "KILL", $pid;
                }
            };
            alarm $s;
            while ((my $got = waitpid($pid, 0)) != $pid) {
                last if $got < 0 && ! $!{EINTR};
            }
            alarm 0;
            exit 124 if $timed_out;
            my $code = $?;
            if ($code == 15 || ($code & 127) == 15) { exit 124; }
            exit($code >> 8);
        ' "$_secs" "$_DHPK_TIMEOUT_GRACE" "$@"
        _rc=$?
    else
        echo "[timeout] unavailable: no timeout, gtimeout, or perl; command was not started" >&2
        return 125
    fi
    _dhpk_timeout_status "$_rc"
}
