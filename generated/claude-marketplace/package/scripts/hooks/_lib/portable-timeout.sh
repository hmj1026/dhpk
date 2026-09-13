#!/usr/bin/env bash
# portable-timeout.sh — run a command with a wall-clock deadline, portably.
# Source-only; no side effects on sourcing. Exposes:
#   run_with_timeout <seconds> <cmd> [args...]
# Prefers coreutils `timeout` / `gtimeout`; falls back to a perl alarm (present
# on macOS/BSD by default) so hooks bound external calls even without coreutils.
# If none is available, runs the command unbounded (never worse than before).
# Timeout is signalled with exit code 124 (matches coreutils `timeout`).
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
            if (!defined $pid) { exec @ARGV or exit 127; }
            if ($pid == 0) { exec @ARGV or exit 127; }
            local $SIG{ALRM} = sub { kill "TERM", $pid; };
            alarm $s;
            waitpid($pid, 0);
            my $code = $?;
            alarm 0;
            if ($code == 15 || ($code & 127) == 15) { exit 124; }
            exit($code >> 8);
        ' "$_secs" "$@"
    else
        "$@"
    fi
}
