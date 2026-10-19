#!/usr/bin/env bash
# portable-timeout.sh — run a command with a wall-clock deadline, portably.
# Source-only; no side effects on sourcing. Exposes:
#   run_with_timeout <seconds> <cmd> [args...]
# Prefers coreutils `timeout` / `gtimeout`; falls back to a perl alarm (present
# on macOS/BSD by default). Exit 124 means the deadline fired (same as
# coreutils). Exit 125 means no deadline mechanism was available and the
# command was not started. An empty command list returns 0.
#
# The perl path puts the child in its own process group and signals that
# group. A descendant that leaves the group is not stopped. This is not
# complete process-tree isolation.
run_with_timeout() {
    local _secs="$1"; shift
    [ "$#" -gt 0 ] || return 0
    if command -v timeout >/dev/null 2>&1; then
        timeout "$_secs" "$@"
    elif command -v gtimeout >/dev/null 2>&1; then
        gtimeout "$_secs" "$@"
    elif command -v perl >/dev/null 2>&1; then
        perl -e '
            my $s = shift;
            my $pid = fork();
            if (!defined $pid) { exit 125; }
            if ($pid == 0) {
                setpgrp(0, 0);
                exec @ARGV or exit 127;
            }
            local $SIG{ALRM} = sub { kill "TERM", -$pid; kill "TERM", $pid; };
            alarm $s;
            waitpid($pid, 0);
            my $code = $?;
            alarm 0;
            if ($code == 15 || ($code & 127) == 15) { exit 124; }
            exit($code >> 8);
        ' "$_secs" "$@"
    else
        echo "[timeout] unavailable: no timeout, gtimeout, or perl; command was not started" >&2
        return 125
    fi
}
