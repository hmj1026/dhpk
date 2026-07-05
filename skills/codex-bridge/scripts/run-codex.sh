#!/usr/bin/env bash
# run-codex.sh — thin wrapper around `codex exec` for the codex-bridge skill.
#
# Usage: run-codex.sh <read-only|workspace-write> <workdir> <prompt-file>
#
# Runs gpt-5.5 (per ~/.codex/config.toml) non-interactively on the prompt read from
# <prompt-file>, in <workdir>, under the given sandbox mode. On success prints Codex's
# final message (the -o capture) to stdout, exit 0. On failure prints the last 20 lines of
# the captured stderr log and exits non-zero — never fabricates.
#
# Flags are verified against codex-cli 0.142.5 and the official openai/codex SDK
# (sdk/typescript/src/exec.ts): `codex exec` has NO --ask-for-approval flag; approval is
# set via `-c approval_policy="never"`. Prompt is read from stdin.
#
# Exit codes: 0 ok; 2 bad usage / missing workdir or prompt; else passes through codex's
#             non-zero exit (1 on empty output).
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  run-codex.sh <read-only|workspace-write> <workdir> <prompt-file>
  mode         read-only (investigate/review) or workspace-write (edit files)
  workdir      working root passed to codex --cd (must be an existing directory)
  prompt-file  file whose full contents become the codex prompt (read via stdin)
EOF
}

if [ "$#" -ne 3 ]; then
  echo "run-codex.sh: expected 3 arguments, got $#" >&2
  usage >&2
  exit 2
fi
MODE="$1"; WORKDIR="$2"; PROMPT_FILE="$3"

case "$MODE" in
  read-only|workspace-write) ;;
  *) echo "run-codex.sh: invalid mode '$MODE' (expected read-only or workspace-write)" >&2; exit 2 ;;
esac

# Verify + absolutize the workdir (portable; no readlink -f).
WORKDIR_ABS="$(cd "$WORKDIR" 2>/dev/null && pwd)" || true
if [ -z "$WORKDIR_ABS" ]; then
  echo "run-codex.sh: workdir does not exist or is not a directory: $WORKDIR" >&2
  exit 2
fi
if [ ! -f "$PROMPT_FILE" ]; then
  echo "run-codex.sh: prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi

WORK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/run-codex.XXXXXX")"
trap 'rm -rf "$WORK_TMP"' EXIT
OUT_FILE="$WORK_TMP/last-message.txt"
ERR_LOG="$WORK_TMP/codex.stderr.log"
STDOUT_LOG="$WORK_TMP/codex.stdout.log"

# Progress -> stderr (ERR_LOG, its own log). Final message captured cleanly via -o. Prompt
# via stdin (no prompt arg) to avoid long-arg / escaping problems. approval_policy=never is
# the exec-compatible equivalent of the (exec-invalid) --ask-for-approval flag.
# (workspace-write network stays off by default; add -c sandbox_workspace_write.network_access=true
#  only if an outsourced task genuinely needs the model to run networked commands.)
set +e
codex exec \
  --skip-git-repo-check \
  --sandbox "$MODE" \
  -c approval_policy="never" \
  --cd "$WORKDIR_ABS" \
  --output-last-message "$OUT_FILE" \
  < "$PROMPT_FILE" \
  1> "$STDOUT_LOG" 2> "$ERR_LOG"
CODE=$?
set -e

# Report failures loudly. Treat a 401 in the stderr log as an auth error ONLY on an actual
# failure (non-zero exit or empty output) — never reclassify a successful, populated result
# just because Codex's progress noise happened to contain the digits "401".
if [ "$CODE" -ne 0 ]; then
  if grep -q '401' "$ERR_LOG" 2>/dev/null; then
    echo "run-codex.sh: codex authentication failed (401) — run 'codex login' first." >&2
  else
    echo "run-codex.sh: codex exited with code $CODE" >&2
  fi
  tail -n 20 "$ERR_LOG" >&2
  exit "$CODE"
fi
if [ ! -s "$OUT_FILE" ]; then
  if grep -q '401' "$ERR_LOG" 2>/dev/null; then
    echo "run-codex.sh: codex authentication failed (401) — run 'codex login' first." >&2
  else
    echo "run-codex.sh: codex produced no output (empty final message)" >&2
  fi
  tail -n 20 "$ERR_LOG" >&2
  exit 1
fi

cat "$OUT_FILE"
exit 0
