#!/usr/bin/env bash
# run-codex.sh — thin wrapper around `codex exec` for the codex-bridge skill.
#
# Usage: run-codex.sh <read-only|workspace-write> <workdir> <prompt-file> [model] [effort]
#
# Runs codex non-interactively on the prompt read from <prompt-file>, in <workdir>, under
# the given sandbox mode. The optional 4th/5th args pin the model and reasoning effort:
# empty (or absent) → the flags are omitted and the model/effort are inherited from
# ~/.codex/config.toml (byte-identical to the original 3-arg wrapper, so codex-bridge is
# untouched). The codex-fast-worker agent passes the resolved userConfig values here.
# On success prints Codex's final message (the -o capture) to stdout, exit 0. On failure
# emits bounded, redacted diagnostics and exits non-zero; a verified wrapper timeout emits
# one stable timeout envelope before cleanup (or a safe no-payload fallback).
#
# Flags are verified against codex-cli 0.147.0 and the official openai/codex SDK
# (sdk/typescript/src/exec.ts), re-checked 2026-08-17: `codex exec` has NO
# --ask-for-approval flag; approval is set via `-c approval_policy="never"`; model via
# `-m`, effort via `-c model_reasoning_effort="..."`. The 0.147.0 catalog includes
# `model_reasoning_effort="ultra"`, but this wrapper intentionally leaves it unused.
# `--output-schema` is additive with `--output-last-message` and is passed only when
# the resolved role is `codex-fast-worker` (OpenAI-strict `report-schema.json`); other
# roles keep last-message capture without the worker report contract.
# Prompt is read from stdin.
#
# Wrapper-level hard timeout (seconds), mirroring run-agy.sh's backstop: a hung
# invocation fails loudly rather than blocking the dispatching agent indefinitely.
# Exit 124 is a wrapper timeout ONLY when `timeout`/`gtimeout` actually wrapped the
# call and this wrapper emitted its timeout evidence message on stderr — a
# backend-native 124 (no timeout binary on PATH) is never reclassified as one. When
# neither `timeout` nor `gtimeout` is available, this wrapper does NOT fail the run;
# it emits an availability note on stderr and runs unwrapped, same as run-agy.sh. A
# caller relying on timeout-recovery semantics (e.g. codex-fast-worker) treats an
# unavailable timeout mechanism as its own BLOCKED classification, not a fabricated
# wrapper failure — see agents/codex-fast-worker.md.
#
# Exit codes: 0 ok; 2 bad usage / missing workdir or prompt; 124 wrapper-level timeout
#             (only when a timeout binary was used); else passes through codex's
#             non-zero exit (1 on empty output).
set -euo pipefail

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[ "$SCRIPT_DIR" = "${BASH_SOURCE[0]}" ] && SCRIPT_DIR=.
TIMEOUT_ENVELOPE_HELPER="$SCRIPT_DIR/codex-timeout-envelope.js"

usage() {
  cat <<'EOF'
Usage:
  run-codex.sh <read-only|workspace-write> <workdir> <prompt-file> [model] [effort]
  mode         read-only (investigate/review) or workspace-write (edit files)
  workdir      working root passed to codex --cd (must be an existing directory)
  prompt-file  file whose full contents become the codex prompt (read via stdin)
  model        (optional) codex model, e.g. gpt-5.6-luna; empty → inherit config default
  effort       (optional) model_reasoning_effort, e.g. xhigh; empty → inherit config default
EOF
}

if [ "$#" -lt 3 ] || [ "$#" -gt 5 ]; then
  echo "run-codex.sh: expected 3-5 arguments, got $#" >&2
  usage >&2
  exit 2
fi
MODE="$1"; WORKDIR="$2"; PROMPT_FILE="$3"; MODEL="${4:-}"; EFFORT="${5:-}"

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

# Resolve the role-aware timeout through the same project/global configuration
# seam used by hooks. A missing marker is the legacy bridge shape; explicit role
# dispatches set DHPK_CODEX_ROLE before calling this wrapper. Keep this wiring
# environment-based so the existing 3-5 positional arguments remain stable. A
# dispatcher that already resolved the tuple marks it with
# DHPK_CODEX_TIMEOUT_RESOLVED; consume that tuple rather than silently replacing
# the caller's effective budget with a fresh default lookup.
CALLER_CODEX_ROLE="${DHPK_CODEX_ROLE:-}"
CALLER_CODEX_TIMEOUT="${DHPK_CODEX_TIMEOUT_SECS:-}"
CALLER_CODEX_SOURCE="${DHPK_CODEX_TIMEOUT_SOURCE:-caller}"
CALLER_CODEX_RESOLVED="${DHPK_CODEX_TIMEOUT_RESOLVED:-false}"
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd)" || {
  echo "run-codex.sh: cannot resolve plugin root for timeout configuration" >&2
  exit 78
}
export ROOT="$WORKDIR_ABS"
if [ ! -f "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh" ]; then
  echo "run-codex.sh: timeout configuration seam is unavailable" >&2
  exit 78
fi
. "$PLUGIN_ROOT/scripts/hooks/_lib/load-project-config.sh"
if [ "$CALLER_CODEX_RESOLVED" = 'true' ]; then
  CODEX_ROLE="$CALLER_CODEX_ROLE"
  if [ -z "$CODEX_ROLE" ]; then
    echo "run-codex.sh: refusing Codex dispatch because the propagated Codex role is empty" >&2
    exit 78
  fi
  if _dhpk_var_present CODEX_WRAP_TIMEOUT_SECS; then
    if ! dhpk_codex_timeout_export "$CODEX_ROLE"; then
      echo "run-codex.sh: refusing Codex dispatch because timeout configuration is invalid" >&2
      exit 78
    fi
  elif ! dhpk_codex_timeout_export_resolved "$CODEX_ROLE" "$CALLER_CODEX_TIMEOUT" "$CALLER_CODEX_SOURCE"; then
    echo "run-codex.sh: refusing Codex dispatch because the propagated timeout configuration is invalid" >&2
    exit 78
  fi
else
  CODEX_ROLE="${DHPK_CODEX_ROLE:-codex-bridge}"
  if ! dhpk_codex_timeout_export "$CODEX_ROLE"; then
    echo "run-codex.sh: refusing Codex dispatch because timeout configuration is invalid" >&2
    exit 78
  fi
fi
if [ -z "${DHPK_CODEX_TIMEOUT_SECS:-}" ]; then
  echo "run-codex.sh: refusing Codex dispatch because timeout configuration is invalid" >&2
  exit 78
fi
WRAP_TIMEOUT_SECS="$DHPK_CODEX_TIMEOUT_SECS"
if [ "$WRAP_TIMEOUT_SECS" != '360' ] || [ "$DHPK_CODEX_TIMEOUT_DISABLED" = 'true' ] || \
   [ "$DHPK_CODEX_OUTER_BUDGET_STATUS" != 'outer_budget=unknown' ]; then
  _codex_timeout_diag="run-codex.sh: codex role=$CODEX_ROLE timeout=$WRAP_TIMEOUT_SECS source=$DHPK_CODEX_TIMEOUT_SOURCE"
  [ "$DHPK_CODEX_TIMEOUT_DISABLED" = 'true' ] && _codex_timeout_diag="${_codex_timeout_diag} disabled=true"
  _codex_timeout_diag="${_codex_timeout_diag} $DHPK_CODEX_OUTER_BUDGET_STATUS"
  echo "$_codex_timeout_diag" >&2
  unset _codex_timeout_diag
fi

WORK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/run-codex.XXXXXX")"
trap 'rm -rf "$WORK_TMP"' EXIT
OUT_FILE="$WORK_TMP/last-message.txt"
ERR_LOG="$WORK_TMP/codex.stderr.log"
STDOUT_LOG="$WORK_TMP/codex.stdout.log"

emit_redacted_stderr_tail() {
  local redacted=""
  if command -v node >/dev/null 2>&1; then
    redacted="$(node "$TIMEOUT_ENVELOPE_HELPER" --diagnostic-text "$ERR_LOG" "$WORK_TMP" 2>/dev/null || true)"
  fi
  if [ -n "$redacted" ]; then
    printf '%s\n' "$redacted" >&2
  else
    echo "run-codex.sh: diagnostic tail omitted (timeout-envelope sanitizer unavailable)." >&2
  fi
}

emit_unavailable_timeout_envelope() {
  local budget="0"
  case "$WRAP_TIMEOUT_SECS" in
    ''|*[!0-9]*) ;;
    *) budget="$WRAP_TIMEOUT_SECS" ;;
  esac
  # Keep the timeout contract parseable even when Node is absent or the helper
  # fails. No captured bytes are included; callers must classify this as BLOCKED.
  printf '%s\n' "{\"schema\":\"dhpk.codex.timeout.v1\",\"status\":\"TIMEOUT\",\"verified_wrapper_timeout\":true,\"exit_code\":124,\"budget_secs\":${budget},\"elapsed_secs\":${ELAPSED},\"report_present\":false,\"report_encoding\":\"base64\",\"report_b64\":\"\",\"stderr_tail_encoding\":\"base64\",\"stderr_tail_b64\":\"\",\"stdout_tail_encoding\":\"base64\",\"stdout_tail_b64\":\"\",\"redaction\":\"unavailable\"}"
}

# Optional model/effort flags. Empty args → omit entirely, preserving the original
# inherit-from-config behavior for codex-bridge (backwards-compatible; a dedicated test
# covers both arg-present and arg-absent shapes). Effort exactly `ultra` is omitted
# (never passed through); other efforts such as xhigh still pass.
MODEL_ARGS=()
[ -n "$MODEL" ] && MODEL_ARGS+=(-m "$MODEL")
if [ -n "$EFFORT" ] && [ "$EFFORT" != "ultra" ]; then
  MODEL_ARGS+=(-c "model_reasoning_effort=$EFFORT")
fi

# Opt-in isolation flags. Exact `1` only; unset/empty/other values add neither flag,
# and setting one env must not add the other.
ISOLATION_ARGS=()
[ "${DHPK_CODEX_EPHEMERAL:-}" = "1" ] && ISOLATION_ARGS+=(--ephemeral)
[ "${DHPK_CODEX_IGNORE_USER_CONFIG:-}" = "1" ] && ISOLATION_ARGS+=(--ignore-user-config)

# Fast-worker report contract only. --output-last-message stays on every role;
# --output-schema is gated on the resolved role (not argument count) because the
# schema is additionalProperties:false with required worker keys.
SCHEMA_ARGS=()
[ "$CODEX_ROLE" = "codex-fast-worker" ] && SCHEMA_ARGS+=(--output-schema "$SCRIPT_DIR/report-schema.json")

# Optional wrapper-level timeout backstop (GNU `timeout` / BSD `gtimeout`), mirroring
# run-agy.sh. Availability is reported but never fails the run — an unwrapped call can
# still return a backend-native 124 on its own, which must not be misclassified below.
TIMEOUT_BIN=""
if [ "$WRAP_TIMEOUT_SECS" != '0' ]; then
  if command -v timeout >/dev/null 2>&1; then
    TIMEOUT_BIN="timeout"
  elif command -v gtimeout >/dev/null 2>&1; then
    TIMEOUT_BIN="gtimeout"
  else
    echo "run-codex.sh: neither 'timeout' nor 'gtimeout' found on PATH — running without a wrapper-level timeout backstop; any 124 exit below is backend-native, not a wrapper timeout." >&2
  fi
else
  # GNU `timeout 0 ...` disables the kill entirely (0 means "no limit"), so a budget
  # below 1 can never produce a genuine timeout-kill regardless of which binary is on
  # PATH — treat it the same as "no timeout mechanism" rather than still invoking
  # `timeout` with a budget that can never fire.
  echo "run-codex.sh: WRAP_TIMEOUT_SECS=${WRAP_TIMEOUT_SECS} disables the wrapper-level timeout backstop (a GNU timeout budget below 1 never fires) — running without one; any 124 exit below is backend-native, not a wrapper timeout." >&2
fi

# Progress -> stderr (ERR_LOG, its own log). Final message captured cleanly via -o. Prompt
# via stdin (no prompt arg) to avoid long-arg / escaping problems. approval_policy=never is
# the exec-compatible equivalent of the (exec-invalid) --ask-for-approval flag.
# (workspace-write network stays off by default; add -c sandbox_workspace_write.network_access=true
#  only if an outsourced task genuinely needs the model to run networked commands.)
set +e
START_TS="$(date +%s)"
if [ -n "$TIMEOUT_BIN" ]; then
  "$TIMEOUT_BIN" "$WRAP_TIMEOUT_SECS" \
    codex exec \
      --skip-git-repo-check \
      --sandbox "$MODE" \
      -c approval_policy="never" \
      --cd "$WORKDIR_ABS" \
      ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
      ${ISOLATION_ARGS[@]+"${ISOLATION_ARGS[@]}"} \
      ${SCHEMA_ARGS[@]+"${SCHEMA_ARGS[@]}"} \
      --output-last-message "$OUT_FILE" \
      < "$PROMPT_FILE" \
      1> "$STDOUT_LOG" 2> "$ERR_LOG"
  CODE=$?
else
  codex exec \
    --skip-git-repo-check \
    --sandbox "$MODE" \
    -c approval_policy="never" \
    --cd "$WORKDIR_ABS" \
    ${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
    ${ISOLATION_ARGS[@]+"${ISOLATION_ARGS[@]}"} \
    ${SCHEMA_ARGS[@]+"${SCHEMA_ARGS[@]}"} \
    --output-last-message "$OUT_FILE" \
    < "$PROMPT_FILE" \
    1> "$STDOUT_LOG" 2> "$ERR_LOG"
  CODE=$?
fi
set -e
ELAPSED=$(( $(date +%s) - START_TS ))
# Half the configured budget, floored at 1s. Keep this as decimal-string math so
# a valid, very large integer cannot overflow bash's machine-sized arithmetic and
# silently turn into an unbounded invocation or a false timeout classification.
ELAPSED_THRESHOLD="$(_dhpk_codex_timeout_half "$WRAP_TIMEOUT_SECS")"
if [ "$ELAPSED_THRESHOLD" = '0' ]; then
  ELAPSED_THRESHOLD=1
fi
ELAPSED_COMPARISON="$(_dhpk_codex_timeout_compare "$ELAPSED" "$ELAPSED_THRESHOLD")"

# A 124 only means "wrapper backstop fired" when TIMEOUT_BIN actually wrapped the call AND
# the invocation ran for roughly the full timeout budget. GNU `timeout` passes through the
# wrapped command's OWN exit code unchanged whenever it exits before the deadline, so a
# backend that independently chooses exit code 124 for an unrelated reason — while still
# running under the wrapper — is otherwise indistinguishable from a genuine timeout kill by
# exit code alone (verified empirically: `timeout 5 bash -c "exit 124"` also returns 124).
# Elapsed wall-clock time at or above half the configured budget (floored at 1s) is the
# corroborating signal a real timeout requires; with neither `timeout` nor `gtimeout` on
# PATH, codex ran unwrapped and could return 124 on its own regardless of elapsed time —
# attributing either case to the backstop would be a fabricated cause (same guard as
# run-agy.sh).
if [ "$CODE" -eq 124 ] && [ -n "$TIMEOUT_BIN" ] && [ "$ELAPSED_COMPARISON" != '-1' ]; then
  echo "run-codex.sh: codex timed out after ${WRAP_TIMEOUT_SECS}s (wrapper backstop, observed ${ELAPSED}s elapsed) — check auth / model / prompt." >&2
  # Capture the report and bounded diagnostics before the EXIT trap removes the
  # temporary directory. The Node helper uses only core modules and emits one
  # versioned JSON object; no raw report/log bytes are written to stdout/stderr.
  if ! command -v node >/dev/null 2>&1; then
    echo "run-codex.sh: timeout-envelope sanitizer unavailable (node is missing); report salvage is BLOCKED." >&2
    emit_unavailable_timeout_envelope
  else
    TIMEOUT_ENVELOPE="$(node "$TIMEOUT_ENVELOPE_HELPER" \
      "$OUT_FILE" "$ERR_LOG" "$STDOUT_LOG" "$WRAP_TIMEOUT_SECS" "$ELAPSED" "$WORK_TMP" 2>/dev/null || true)"
    if [ -n "$TIMEOUT_ENVELOPE" ]; then
      printf '%s\n' "$TIMEOUT_ENVELOPE"
    else
      echo "run-codex.sh: timeout-envelope sanitizer failed; report salvage is BLOCKED." >&2
      emit_unavailable_timeout_envelope
    fi
  fi
  exit 124
fi

# Report failures loudly. Treat a 401 in the stderr log as an auth error ONLY on an actual
# failure (non-zero exit or empty output) — never reclassify a successful, populated result
# just because Codex's progress noise happened to contain the digits "401".
if [ "$CODE" -ne 0 ]; then
  if grep -q '401' "$ERR_LOG" 2>/dev/null; then
    echo "run-codex.sh: codex authentication failed (401) — run 'codex login' first." >&2
  else
    echo "run-codex.sh: codex exited with code $CODE" >&2
  fi
  emit_redacted_stderr_tail
  exit "$CODE"
fi
if [ ! -s "$OUT_FILE" ]; then
  if grep -q '401' "$ERR_LOG" 2>/dev/null; then
    echo "run-codex.sh: codex authentication failed (401) — run 'codex login' first." >&2
  else
    echo "run-codex.sh: codex produced no output (empty final message)" >&2
  fi
  emit_redacted_stderr_tail
  exit 1
fi

cat "$OUT_FILE"
exit 0
