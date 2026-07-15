#!/usr/bin/env bash
# run-agy.sh — thin wrapper around the agy (Antigravity) CLI for the
# agy-fast-worker agent.
#
# Usage: run-agy.sh <workdir> <prompt-file> <model>
#
# Runs agy non-interactively on the prompt read from <prompt-file>, against <workdir>,
# with the selected <model>. On success prints agy's response to stdout, exit 0. On
# failure prints the captured stderr tail and exits non-zero — never fabricates.
#
# Non-interactive combination verified against the installed agy 1.1.2 binary
# (`agy --help`, 2026-07-14):
#   - plan-confirmation `Y` piped on stdin (a SEPARATE gate that
#     --dangerously-skip-permissions does NOT clear);
#   - --dangerously-skip-permissions (auto-approves tool permission requests only);
#   - --add-dir <workdir> (repeatable; REQUIRED — print mode ignores the shell cwd);
#   - --model "<model>" (display string, e.g. "Gemini 3.5 Flash (High)");
#   - -p / --print with the prompt content;
#   - --print-timeout bounds the wait (CLI default 5m0s).
#
# The wrapper does NOT use --cwd: the official Antigravity CLI docs
# (antigravity.google/docs/cli/best-practices, retrieved 2026-07-14) recommend
# `-p ... --cwd $(pwd)`, but NO such flag exists in the installed 1.1.x binary.
# Installed `--help` output is the ground truth over the published docs; re-verify
# whenever the agy version changes.
#
# Exit codes: 0 ok; 2 bad usage / missing workdir or prompt; 124 wrapper-level timeout;
#             else passes through agy's non-zero exit (1 on empty output).
set -euo pipefail

# Wrapper-level hard timeout (seconds) — a backstop over agy's own --print-timeout so a
# hung invocation fails loudly rather than blocking the dispatching agent indefinitely.
PRINT_TIMEOUT="${AGY_PRINT_TIMEOUT:-300s}"
WRAP_TIMEOUT_SECS="${AGY_WRAP_TIMEOUT_SECS:-360}"

usage() {
  cat <<'EOF'
Usage:
  run-agy.sh <workdir> <prompt-file> <model>
  workdir      working root passed to agy --add-dir (must be an existing directory)
  prompt-file  file whose full contents become the agy prompt (-p)
  model        agy model display string, e.g. "Gemini 3.5 Flash (High)" (see `agy models`)
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
  printf 'Y\n' | "$TIMEOUT_BIN" "$WRAP_TIMEOUT_SECS" \
    agy --dangerously-skip-permissions \
        --add-dir "$WORKDIR_ABS" \
        --model "$MODEL" \
        --print-timeout "$PRINT_TIMEOUT" \
        -p "$PROMPT_CONTENT" \
    1> "$OUT_LOG" 2> "$ERR_LOG"
  CODE=$?
else
  printf 'Y\n' | agy --dangerously-skip-permissions \
        --add-dir "$WORKDIR_ABS" \
        --model "$MODEL" \
        --print-timeout "$PRINT_TIMEOUT" \
        -p "$PROMPT_CONTENT" \
    1> "$OUT_LOG" 2> "$ERR_LOG"
  CODE=$?
fi
set -e

if [ "$CODE" -eq 124 ]; then
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
