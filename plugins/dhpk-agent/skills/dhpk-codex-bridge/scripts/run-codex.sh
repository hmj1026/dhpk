#!/bin/bash
# Compatibility adapter for the contained external-CLI transport.
#
# Usage: run-codex.sh <read-only|workspace-write> <workdir> <prompt-file> [model] [effort]
#
# The positional shape remains for callers, but an attested context file is now
# required in DHPK_CLI_TRANSPORT_CONTEXT. This adapter owns only Codex argv
# construction; the Python runner owns execution, timeout classification,
# redaction, scope observation, and contained receipts.
set -euo pipefail
PATH=/usr/bin:/bin
export PATH
SYSTEM_PYTHON3=/usr/bin/python3

SCRIPT_DIR="${BASH_SOURCE[0]%/*}"
[ "$SCRIPT_DIR" = "${BASH_SOURCE[0]}" ] && SCRIPT_DIR=.
PLUGIN_ROOT="$(cd "$SCRIPT_DIR/../../.." 2>/dev/null && pwd)" || exit 78
PREPARE="$PLUGIN_ROOT/skills/dhpk-cli-transport/scripts/prepare-cli-request.py"
RUNNER="$PLUGIN_ROOT/skills/dhpk-cli-transport/scripts/run-cli-transport.py"

usage() {
  cat <<'EOF'
Usage:
  run-codex.sh <read-only|workspace-write> <workdir> <prompt-file> [model] [effort]
  The caller must provide DHPK_CLI_TRANSPORT_CONTEXT pointing to its 0600
  dhpk.cli.context.v1 file. A legacy call without that attestation is BLOCKED.
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
WORKDIR_ABS="$(cd "$WORKDIR" 2>/dev/null && pwd)" || true
if [ -z "$WORKDIR_ABS" ]; then
  echo "run-codex.sh: workdir does not exist or is not a directory: $WORKDIR" >&2
  exit 2
fi
if [ ! -f "$PROMPT_FILE" ]; then
  echo "run-codex.sh: prompt file not found: $PROMPT_FILE" >&2
  exit 2
fi
if [ -z "${DHPK_CLI_TRANSPORT_CONTEXT:-}" ]; then
  echo "run-codex.sh: BLOCKED: attested DHPK_CLI_TRANSPORT_CONTEXT is required; legacy authority is never inferred." >&2
  exit 65
fi
if [ ! -x "$SYSTEM_PYTHON3" ]; then
  echo "run-codex.sh: BLOCKED: the Linux/WSL system python3 transport runtime is unavailable." >&2
  exit 65
fi
if [ ! -f "$PREPARE" ] || [ ! -f "$RUNNER" ]; then
  echo "run-codex.sh: BLOCKED: cli transport runtime is unavailable." >&2
  exit 65
fi

umask 077
REQUEST_FILE="$(mktemp "${TMPDIR:-/tmp}/dhpk-codex-request.XXXXXX")"
trap 'rm -f "$REQUEST_FILE"' EXIT

PREPARE_ARGS=(--context "$DHPK_CLI_TRANSPORT_CONTEXT" --provider codex --mode "$MODE"
  --workdir "$WORKDIR_ABS" --prompt-file "$PROMPT_FILE" --model "$MODEL" --effort "$EFFORT")
if ! "$SYSTEM_PYTHON3" -I "$PREPARE" --bootstrap-python "$SYSTEM_PYTHON3" "${PREPARE_ARGS[@]}" > "$REQUEST_FILE"; then
  exit 65
fi
exec "$SYSTEM_PYTHON3" -I "$RUNNER" --request "$REQUEST_FILE"
