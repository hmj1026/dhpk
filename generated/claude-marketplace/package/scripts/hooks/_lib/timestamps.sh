#!/usr/bin/env bash
# timestamps.sh — shared timestamp formats for dhpk hooks.
# Source-only — never execute directly. No side effects on sourcing.
#
# Centralizes the formats that were previously hand-rolled across hooks so the
# sentinel/log/checkpoint formats stay consistent:
#   ts_now   — "YYYY-MM-DD HH:MM:SS ZZZ"  (human/local; sentinel + log lines)
#   ts_iso   — "YYYY-MM-DDTHH:MM:SSZ"     (UTC ISO-8601; machine-readable)
#   ts_epoch — seconds since epoch        (age math)

ts_now()   { date +'%Y-%m-%d %H:%M:%S %Z'; }
ts_iso()   { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
ts_epoch() { date +%s; }
