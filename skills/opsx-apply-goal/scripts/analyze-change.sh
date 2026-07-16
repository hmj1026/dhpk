#!/usr/bin/env bash
# analyze-change.sh — deterministic pre-analysis for the opsx-apply-goal skill (schema=v1)
#
# Owns the mechanical, error-prone work the model would otherwise re-derive each
# run: argument normalization (incl. flag precedence), change-dir location,
# checkbox counting, turn-budget arithmetic, fast-worker selector resolution,
# bounded task-digest composition, and deterministic E2E-surface detection.
# Emits ONE stable schema=v1 KEY=VALUE block.
#
# Usage:
#   analyze-change.sh <change-id> [--turns N] [--max-duration <Nm|Nh>] \
#                     [--min-coverage N] [--codex] [--fast-worker=<backend>] \
#                     [--smoke|--no-smoke] [--dry-run]
#
# Output: a `# schema=v1` block on stdout (KEY=VALUE, one per line). On a fatal
# input problem it still prints STATUS=... plus a human-readable message and
# exits 0 (the skill relays STATUS and stops) — except missing change-id, which
# is a usage error (exit 2).

set -euo pipefail

# --- argument normalization -------------------------------------------------
CHANGE_ID=""
CUSTOM_TURNS=""
MAX_DURATION=""
MIN_COVERAGE=""
CODEX="off"
DRY_RUN="false"
FAST_WORKER_OVERRIDE=""
SAW_SMOKE="false"
SAW_NO_SMOKE="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --turns)        CUSTOM_TURNS="${2:-}"; shift 2 ;;
    --max-duration) MAX_DURATION="${2:-}"; shift 2 ;;
    --min-coverage) MIN_COVERAGE="${2:-}"; shift 2 ;;
    --codex)        CODEX="on";  shift ;;
    --fast-worker=*) FAST_WORKER_OVERRIDE="${1#--fast-worker=}"; shift ;;
    --smoke)        SAW_SMOKE="true";    shift ;;
    --no-smoke)     SAW_NO_SMOKE="true"; shift ;;
    --dry-run)      DRY_RUN="true";      shift ;;
    --*)            shift ;;                       # tolerate unknown flags
    *)              [ -z "$CHANGE_ID" ] && CHANGE_ID="$1"; shift ;;
  esac
done

# Flag precedence: --no-smoke > --smoke > auto
if [ "$SAW_NO_SMOKE" = "true" ]; then
  SMOKE_FLAG="off"
elif [ "$SAW_SMOKE" = "true" ]; then
  SMOKE_FLAG="on"
else
  SMOKE_FLAG="auto"
fi

if [ -z "$CHANGE_ID" ]; then
  echo "Usage: /dhpk:opsx-apply-goal <change-id> [--turns N] [--max-duration <Nm|Nh>] [--min-coverage N] [--codex] [--smoke|--no-smoke] [--dry-run]" >&2
  echo "Example: /dhpk:opsx-apply-goal fix-spec-select-empty-gplist-overflow" >&2
  exit 2
fi

# --- locate change dir ------------------------------------------------------
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
ACTIVE="$ROOT/openspec/changes/$CHANGE_ID"
ARCHIVE="$ROOT/openspec/changes/archive/$CHANGE_ID"

emit_head() {
  echo "# schema=v1"
  echo "CHANGE_ID=$CHANGE_ID"
  echo "STATUS=$1"
}

if [ -d "$ACTIVE" ]; then
  CHANGE_DIR="$ACTIVE"
  STATUS="active"
elif [ -d "$ARCHIVE" ]; then
  emit_head "archived"
  echo "CHANGE_DIR=$ARCHIVE"
  echo "MESSAGE=Change is already archived — it may be complete. Move it back to openspec/changes/ to re-implement."
  exit 0
else
  emit_head "missing"
  echo "MESSAGE=Change '$CHANGE_ID' not found."
  echo "AVAILABLE_CHANGES<<EOF"
  ls "$ROOT/openspec/changes/" 2>/dev/null | grep -v '^archive$' || true
  echo "EOF"
  exit 0
fi

# --- required artifacts -----------------------------------------------------
TASKS="$CHANGE_DIR/tasks.md"
PROPOSAL="$CHANGE_DIR/proposal.md"
if [ ! -f "$TASKS" ]; then
  emit_head "error"
  echo "CHANGE_DIR=$CHANGE_DIR"
  echo "MESSAGE=Required tasks.md missing at $TASKS"
  exit 0
fi
if [ ! -f "$PROPOSAL" ]; then
  emit_head "error"
  echo "CHANGE_DIR=$CHANGE_DIR"
  echo "MESSAGE=Required proposal.md missing at $PROPOSAL"
  exit 0
fi

# --- checkbox counts (grep -c; the LLM-miscount surface) --------------------
# grep -c prints the count (0 included) then exits 1 when it is 0; `|| true`
# keeps the printed 0 and swallows that exit so `set -e` does not trip.
TOTAL_TASKS=$(grep -c '^- \[' "$TASKS" 2>/dev/null || true)
OPEN_TASKS=$(grep -c '^- \[ \]' "$TASKS" 2>/dev/null || true)
DONE_TASKS=$(grep -c '^- \[x\]' "$TASKS" 2>/dev/null || true)

# --- turn budget: CUSTOM_TURNS || max(20, min(120, OPEN*4+20)) --------------
if [ -n "$CUSTOM_TURNS" ]; then
  TURN_BUDGET="$CUSTOM_TURNS"
else
  computed=$(( OPEN_TASKS * 4 + 20 ))
  [ "$computed" -gt 120 ] && computed=120
  [ "$computed" -lt 20 ]  && computed=20
  TURN_BUDGET="$computed"
fi

# --- emit schema=v1 block ---------------------------------------------------
emit_head "active"
echo "CHANGE_DIR=$CHANGE_DIR"
echo "HAS_DESIGN=$( [ -f "$CHANGE_DIR/design.md" ] && echo true || echo false )"
echo "TOTAL_TASKS=$TOTAL_TASKS"
echo "OPEN_TASKS=$OPEN_TASKS"
echo "DONE_TASKS=$DONE_TASKS"
echo "TURN_BUDGET=$TURN_BUDGET"
echo "TURN_BUDGET_SOURCE=$( [ -n "$CUSTOM_TURNS" ] && echo flag || echo formula )"
echo "SMOKE_FLAG=$SMOKE_FLAG"
echo "CODEX=$CODEX"
echo "DRY_RUN=$DRY_RUN"
echo "MAX_DURATION=${MAX_DURATION:-}"
echo "MIN_COVERAGE=${MIN_COVERAGE:-}"
node "${CLAUDE_PLUGIN_ROOT:-$ROOT}/skills/opsx-apply-goal/scripts/goal-context.js" \
  "--tasks=$TASKS" \
  "--proposal=$PROPOSAL" \
  "--fast-worker=$FAST_WORKER_OVERRIDE"
