#!/bin/bash
# Compatibility adapter for the contained external-CLI transport.
#
# Usage: run-agy.sh <workdir> <prompt-file> <model>
#
# The positional invocation remains, but a caller-attested context is mandatory.
# This adapter keeps AGY's verified argv/version surface and deliberately sends
# only its plan confirmation on stdin; the shared runner owns timeout, receipt,
# redaction, and scope lifecycle.
set -euo pipefail
PATH=/usr/bin:/bin
export PATH
SYSTEM_PYTHON3=/usr/bin/python3

PRINT_TIMEOUT="300s"

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[ "$SCRIPT_DIR" = "${BASH_SOURCE[0]}" ] && SCRIPT_DIR=.
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd)" || exit 78
PREPARE="$PLUGIN_ROOT/skills/dhpk-cli-transport/scripts/prepare-cli-request.py"
RUNNER="$PLUGIN_ROOT/skills/dhpk-cli-transport/scripts/run-cli-transport.py"

usage() {
  cat <<'EOF'
Usage:
  run-agy.sh <workdir> <prompt-file> <model>
  The caller must provide DHPK_CLI_TRANSPORT_CONTEXT pointing to its 0600
  dhpk.cli.context.v1 file. A legacy call without that attestation is BLOCKED.
EOF
}

if [ "$#" -ne 3 ]; then
  echo "run-agy.sh: expected 3 arguments, got $#" >&2
  usage >&2
  exit 2
fi
WORKDIR="$1"; PROMPT_FILE="$2"; MODEL="$3"
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
if [ -z "${DHPK_CLI_TRANSPORT_CONTEXT:-}" ]; then
  echo "run-agy.sh: BLOCKED: attested DHPK_CLI_TRANSPORT_CONTEXT is required; legacy authority is never inferred." >&2
  exit 65
fi
if [ ! -x "$SYSTEM_PYTHON3" ]; then
  echo "run-agy.sh: BLOCKED: the Linux/WSL system python3 transport runtime is unavailable." >&2
  exit 65
fi
if [ ! -f "$PREPARE" ] || [ ! -f "$RUNNER" ]; then
  echo "run-agy.sh: BLOCKED: cli transport runtime is unavailable." >&2
  exit 65
fi

# Validate caller context before preparing a request. Provider discovery and
# execution happen only inside the contained transport; this legacy adapter
# must not probe AGY through the shell's ambient PATH.
if ! "$SYSTEM_PYTHON3" -I "$PREPARE" --bootstrap-python "$SYSTEM_PYTHON3" --context "$DHPK_CLI_TRANSPORT_CONTEXT" --provider agy --mode workspace-write \
    --workdir "$WORKDIR_ABS" --prompt-file "$PROMPT_FILE" --validate-context; then
  exit 65
fi

PREPARE_ARGS=(--context "$DHPK_CLI_TRANSPORT_CONTEXT" --provider agy --mode workspace-write
  --workdir "$WORKDIR_ABS" --prompt-file "$PROMPT_FILE" --model "$MODEL"
  --print-timeout "$PRINT_TIMEOUT")

umask 077
REQUEST_FILE="$(mktemp "${TMPDIR:-/tmp}/dhpk-agy-request.XXXXXX")"
trap 'rm -f "$REQUEST_FILE"' EXIT
if ! "$SYSTEM_PYTHON3" -I "$PREPARE" --bootstrap-python "$SYSTEM_PYTHON3" "${PREPARE_ARGS[@]}" > "$REQUEST_FILE"; then
  exit 65
fi
exec "$SYSTEM_PYTHON3" -I "$RUNNER" --request "$REQUEST_FILE"
