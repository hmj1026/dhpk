#!/usr/bin/env bash
# run-agy.sh — thin wrapper around the agy (Antigravity) CLI for the
# agy-fast-worker agent.
#
# Usage: run-agy.sh <workdir> <prompt-file> <model>
#
# Runs agy non-interactively on the prompt read from <prompt-file>, against <workdir>,
# with the selected <model>. On success prints agy's raw stdout to stdout, exit 0 — when
# structured output is active (see below) that stdout is agy's JSON envelope, and the
# schema-conformant report lives at its `.structured_output` field, NOT the envelope's
# top level (the envelope's own `status` key is agy's run status, e.g. "SUCCESS" — a
# different field than the report schema's `status`). On failure prints the captured
# stderr tail and exits non-zero — never fabricates.
#
# Non-interactive combination verified against the installed agy 1.1.8 binary
# (`agy --help`, 2026-07-28):
#   - --dangerously-skip-permissions (auto-approves tool permission requests);
#   - --mode accept-edits (autonomy boundary flag — this wrapper only ever dispatches
#     write-enabled mechanical work, so `plan` mode is never selected here);
#   - --add-dir <workdir> (repeatable; REQUIRED — print mode ignores the shell cwd);
#   - --model "<model>" (display string, e.g. "Gemini 3.6 Flash (High)");
#   - -p / --print with the prompt content;
#   - --print-timeout bounds the wait (CLI default 5m0s);
#   - plan-confirmation `Y` piped on stdin regardless — empirically NOT required by the
#     installed 1.1.8 binary together with --dangerously-skip-permissions (re-verified
#     2026-07-28: an accept-edits run with stdin redirected from /dev/null still edited
#     the file). The prior version of this comment claimed a separate, unclearable
#     confirmation gate; that claim was itself stale 1.1.2-era text carried forward
#     without re-verification across the 1.1.2 -> 1.1.8 gap. Piping `Y` is kept anyway —
#     harmless when unread, and may still be required by an older binary on the degrade
#     path below the structured-output floor.
#
# On agy >= AGY_STRUCTURED_OUTPUT_FLOOR (below), the wrapper additionally passes
# `--output-format json` and `--json-schema <report-schema.json>` to force the report
# contract shape instead of relying on prompt text. `--json-schema` guarantees the SHAPE
# of agy's self-report, never its TRUTH — the dispatching agent still runs its own
# verification command and derives the edited-file list from the working tree regardless
# of what the report claims. Below the floor the wrapper degrades to the plain-text path
# and says so on stderr; it never drops the flag silently.
#
# The installed binary's `--help` describes --json-schema as "(for stream-json, only
# applicable to the final result)" — live-tested 2026-07-28 with --output-format json
# (NOT stream-json) and it works: the JSON envelope gains a populated, schema-validated
# `structured_output` field. Trust the installed binary's observed behavior over its own
# --help text where they disagree, same as the --cwd case below.
#
# The wrapper does NOT pass --effort: the model string already encodes the reasoning tier
# (e.g. "Gemini 3.6 Flash (High)" / "gemini-3.6-flash-high"), so a separate --effort flag
# is redundant and a source of semantic conflict.
#
# The wrapper does NOT use --cwd: the official Antigravity CLI docs
# (antigravity.google/docs/cli/best-practices, retrieved 2026-07-14) and agy's own
# auto-generated `agy_headless_models_guide.md` both suggest flag/argument forms absent
# from — or contradicted by — the installed binary. Installed `--help` / `agy models` /
# the CLI's own persisted `settings.json` are the ground truth over published OR
# auto-generated docs — this generalizes past --cwd: re-verify ALL of this wrapper's
# assumptions against the installed binary whenever the agy version changes, not just the
# flag surface a given past bug happened to touch.
#
# Exit codes: 0 ok; 2 bad usage / missing workdir or prompt; 124 wrapper-level timeout;
#             else passes through agy's non-zero exit (1 on empty output).
set -euo pipefail

# Wrapper-level hard timeout (seconds) — a backstop over agy's own --print-timeout so a
# hung invocation fails loudly rather than blocking the dispatching agent indefinitely.
PRINT_TIMEOUT="${AGY_PRINT_TIMEOUT:-300s}"
WRAP_TIMEOUT_SECS="${AGY_WRAP_TIMEOUT_SECS:-360}"

# Two SEPARATE constants that happen to coincide today. AGY_STRUCTURED_OUTPUT_FLOOR is
# the lowest agy version that PROVIDES --output-format/--json-schema/--mode. AGY_
# VERIFIED_BASELINE is the version this wrapper's flag combination was last actually
# re-verified against. They must never share one variable: refreshing the baseline after
# a future release would otherwise silently raise the floor too, and stop requesting
# structured output on versions that support it.
STRUCTURED_OUTPUT_FLOOR="${AGY_STRUCTURED_OUTPUT_FLOOR:-1.1.8}"
VERIFIED_BASELINE="${AGY_VERIFIED_BASELINE:-1.1.8}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORT_SCHEMA="$SCRIPT_DIR/report-schema.json"

usage() {
  cat <<'EOF'
Usage:
  run-agy.sh <workdir> <prompt-file> <model>
  workdir      working root passed to agy --add-dir (must be an existing directory)
  prompt-file  file whose full contents become the agy prompt (-p)
  model        agy model display string, e.g. "Gemini 3.6 Flash (High)" (see `agy models`)
EOF
}

if [ "$#" -ne 3 ]; then
  echo "run-agy.sh: expected 3 arguments, got $#" >&2
  usage >&2
  exit 2
fi
WORKDIR="$1"; PROMPT_FILE="$2"; MODEL="$3"

# Verify + absolutize the workdir (portable; no readlink -f).
WORKDIR_ABS="$(cd "$WORKDIR" 2>/dev/null && pwd)" || true
if [ -z "$WORKDIR_ABS" ]; then
  echo "run-agy.sh: workdir does not exist or is not a directory: $WORKDIR" >&2
  exit 2
fi
if [ ! -f "$PROMPT_FILE" ]; then
  echo "run-agy.sh: prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi
if [ -z "$MODEL" ]; then
  echo "run-agy.sh: model argument is required (see 'agy models')" >&2
  exit 2
fi

# Availability check — a missing binary is a loud, honest failure, never a silent skip.
if ! command -v agy >/dev/null 2>&1; then
  echo "run-agy.sh: agy CLI not found on PATH — install Antigravity CLI or dispatch a different worker." >&2
  exit 2
fi

# version_ge A B — true (exit 0) if dotted-numeric version A >= version B. Pure bash
# (no `sort -V`, a GNU extension absent from BSD/macOS `sort`, which this script already
# targets via the gtimeout fallback below) — compares dot-separated components as
# base-10 integers, left to right.
version_ge() {
  local IFS=.
  local -a a=($1) b=($2)
  local i n=${#a[@]}
  [ "${#b[@]}" -gt "$n" ] && n=${#b[@]}
  for ((i = 0; i < n; i++)); do
    local ai="${a[i]:-0}" bi="${b[i]:-0}"
    if ((10#$ai > 10#$bi)); then return 0; fi
    if ((10#$ai < 10#$bi)); then return 1; fi
  done
  return 0
}

# Captured once and sliced in pure bash (no `| head -n1 | tr -d ...` pipe) — under
# `pipefail`, a downstream reader closing early can SIGPIPE the writer, and piping the
# version probe risks silently forcing the degrade path on a fully capable binary.
RAW_INSTALLED_VERSION="$(agy --version 2>/dev/null)" || RAW_INSTALLED_VERSION=""
INSTALLED_VERSION="${RAW_INSTALLED_VERSION%%$'\n'*}"
INSTALLED_VERSION="${INSTALLED_VERSION//[[:space:]]/}"

if [ -n "$INSTALLED_VERSION" ] && [ "$INSTALLED_VERSION" != "$VERIFIED_BASELINE" ]; then
  echo "run-agy.sh: agy version drift — installed=$INSTALLED_VERSION verified-baseline=$VERIFIED_BASELINE. Re-verify this wrapper's flag combination against the installed binary's --help before trusting this run; do not just bump the recorded baseline number." >&2
fi

STRUCTURED_ARGS=()
if [ -n "$INSTALLED_VERSION" ] && version_ge "$INSTALLED_VERSION" "$STRUCTURED_OUTPUT_FLOOR"; then
  if [ -f "$REPORT_SCHEMA" ]; then
    STRUCTURED_ARGS=(--output-format json --json-schema "$REPORT_SCHEMA")
  else
    echo "run-agy.sh: report schema not found at $REPORT_SCHEMA — structured JSON reporting is NOT enabled this run." >&2
  fi
else
  echo "run-agy.sh: installed agy ${INSTALLED_VERSION:-unknown} predates the structured-output floor ($STRUCTURED_OUTPUT_FLOOR) — falling back to the plain-text report path; structured JSON reporting is NOT enabled." >&2
fi

WORK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/run-agy.XXXXXX")"
trap 'rm -rf "$WORK_TMP"' EXIT
ERR_LOG="$WORK_TMP/agy.stderr.log"
OUT_LOG="$WORK_TMP/agy.stdout.log"

PROMPT_CONTENT="$(cat "$PROMPT_FILE")"

# Optional wrapper-level timeout backstop (GNU `timeout` / BSD `gtimeout`). agy's own
# --print-timeout is the primary bound; this catches a hang that outlives it.
TIMEOUT_BIN=""
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
fi

set +e
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "$WRAP_TIMEOUT_SECS" \
    agy --dangerously-skip-permissions \
        --mode accept-edits \
        --add-dir "$WORKDIR_ABS" \
        --model "$MODEL" \
        --print-timeout "$PRINT_TIMEOUT" \
        ${STRUCTURED_ARGS[@]+"${STRUCTURED_ARGS[@]}"} \
        -p "$PROMPT_CONTENT" \
    1> "$OUT_LOG" 2> "$ERR_LOG" <<< 'Y'
  CODE=$?
else
  agy --dangerously-skip-permissions \
        --mode accept-edits \
        --add-dir "$WORKDIR_ABS" \
        --model "$MODEL" \
        --print-timeout "$PRINT_TIMEOUT" \
        ${STRUCTURED_ARGS[@]+"${STRUCTURED_ARGS[@]}"} \
        -p "$PROMPT_CONTENT" \
    1> "$OUT_LOG" 2> "$ERR_LOG" <<< 'Y'
  CODE=$?
fi
set -e

# A 124 only means "wrapper backstop fired" when TIMEOUT_BIN actually wrapped the call;
# with neither `timeout` nor `gtimeout` on PATH, agy ran unwrapped and could return 124
# on its own — attributing that to the backstop unconditionally would be a fabricated
# cause (see this file's own "never fabricates" contract above).
if [ "$CODE" -eq 124 ] && [ -n "$TIMEOUT_BIN" ]; then
  echo "run-agy.sh: agy timed out after ${WRAP_TIMEOUT_SECS}s (wrapper backstop) — check auth / model / prompt." >&2
  tail -n 20 "$ERR_LOG" >&2 2>/dev/null || true
  exit 124
fi
if [ "$CODE" -ne 0 ]; then
  echo "run-agy.sh: agy exited with code $CODE" >&2
  tail -n 20 "$ERR_LOG" >&2 2>/dev/null || true
  exit "$CODE"
fi
if [ ! -s "$OUT_LOG" ]; then
  echo "run-agy.sh: agy produced no output (empty response)" >&2
  tail -n 20 "$ERR_LOG" >&2 2>/dev/null || true
  exit 1
fi

cat "$OUT_LOG"
exit 0
