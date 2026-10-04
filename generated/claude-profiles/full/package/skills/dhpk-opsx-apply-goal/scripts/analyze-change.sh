#!/usr/bin/env bash
# analyze-change.sh — deterministic pre-analysis for the opsx-apply-goal skill (schema=v1)
#
# Owns the mechanical, error-prone work the model would otherwise re-derive each
# run: argument normalization (incl. flag precedence), OpenSpec CLI path
# resolution, checkbox counting, turn-budget arithmetic, fast-worker selector
# resolution, bounded task-digest composition, and deterministic E2E detection.
# Emits ONE stable schema=v1 KEY=VALUE block.
#
# Usage:
#   analyze-change.sh <change-id> [--turns N] [--max-duration <Nm|Nh>] \
#                     [--min-coverage N] [--worker=<backend>] \
#                     [--cross-provider] \
#                     [--smoke|--no-smoke] [--dry-run]
#
# Output: a `# schema=v1` block on stdout (KEY=VALUE, one per line). On a fatal
# input problem it still prints STATUS=... plus a human-readable message and
# exits 0 (the skill relays STATUS and stops) — except missing change-id, which
# is a usage error (exit 2).

set -euo pipefail

# Resolve the physical Skill boundary from this script before reading any
# consumer artifacts.  The caller's working directory remains the consumer
# project; only this helper's own directory is used for Skill resources.
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd -P)" || {
  echo "BLOCKED_RESOURCE_MISSING: unable to resolve the physical Skill directory" >&2
  exit 1
}
SKILL_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." 2>/dev/null && pwd -P)" || {
  echo "BLOCKED_RESOURCE_MISSING: unable to resolve the physical Skill root" >&2
  exit 1
}
if [ ! -f "$SKILL_ROOT/SKILL.md" ] || [ ! -f "$SCRIPT_DIR/goal-context.js" ]; then
  echo "BLOCKED_RESOURCE_MISSING: required local Skill resource is unavailable" >&2
  exit 1
fi
SKILL_ROOT_Q="$(printf '%q' "$SKILL_ROOT")"

# --- argument normalization -------------------------------------------------
CHANGE_ID=""
CUSTOM_TURNS=""
MAX_DURATION=""
MIN_COVERAGE=""
DEPRECATED_CODEX_FLAG="false"
DRY_RUN="false"
FAST_WORKER_OVERRIDE=""
CROSS_PROVIDER_OVERRIDE="false"
SAW_SMOKE="false"
SAW_NO_SMOKE="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --turns)        CUSTOM_TURNS="${2:-}"; shift 2 ;;
    --max-duration) MAX_DURATION="${2:-}"; shift 2 ;;
    --min-coverage) MIN_COVERAGE="${2:-}"; shift 2 ;;
    --codex)        DEPRECATED_CODEX_FLAG="true"; shift ;;
    --worker=*) FAST_WORKER_OVERRIDE="${1#--worker=}"; shift ;;
    --cross-provider) CROSS_PROVIDER_OVERRIDE="true"; shift ;;
    --smoke)        SAW_SMOKE="true";    shift ;;
    --no-smoke)     SAW_NO_SMOKE="true"; shift ;;
    --dry-run)      DRY_RUN="true";      shift ;;
    --*)            shift ;;                       # tolerate unknown flags
    *)              [ -z "$CHANGE_ID" ] && CHANGE_ID="$1"; shift ;;
  esac
done

if [ "$DEPRECATED_CODEX_FLAG" = "true" ]; then
  echo "# schema=v1"
  echo "STATUS=error"
  echo "DEPRECATED_CODEX_FLAG=true"
  echo "MESSAGE=--codex is retired and blocked; use --worker=codex for an explicit Codex CLI worker or a named owner's --second-opinion=codex-exec for an additive second opinion"
  exit 0
fi

# Flag precedence: --no-smoke > --smoke > auto
if [ "$SAW_NO_SMOKE" = "true" ]; then
  SMOKE_FLAG="off"
elif [ "$SAW_SMOKE" = "true" ]; then
  SMOKE_FLAG="on"
else
  SMOKE_FLAG="auto"
fi

if [ -z "$CHANGE_ID" ]; then
  echo "Usage: /dhpk:dhpk-opsx-apply-goal <change-id> [--turns N] [--max-duration <Nm|Nh>] [--min-coverage N] [--worker=<claude|codex|agy|auto>] [--cross-provider] [--smoke|--no-smoke] [--dry-run]" >&2
  echo "Example: /dhpk:dhpk-opsx-apply-goal fix-spec-select-empty-gplist-overflow" >&2
  exit 2
fi

# --- locate change and artifact paths through the OpenSpec CLI --------------
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

emit_head() {
  echo "# schema=v1"
  echo "CHANGE_ID=$CHANGE_ID"
  echo "STATUS=$1"
}

STATUS_FIELDS="$(node - "$ROOT" "$CHANGE_ID" <<'NODE'
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [root, changeId] = process.argv.slice(2);
const fail = (message) => {
  process.stderr.write(`[opsx-goal] ${message}\n`);
  process.exit(1);
};
const result = spawnSync('openspec', ['status', '--change', changeId, '--json'], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
if (result.error || result.status !== 0) {
  const detail = result.error ? result.error.message : `exit ${result.status}: ${result.stderr.trim()}`;
  fail(`BLOCKED_RESOURCE_MISSING: OpenSpec status could not resolve the requested change (${detail})`);
}

let status;
try {
  status = JSON.parse(result.stdout);
} catch (_) {
  fail('BLOCKED_POLICY_UNRESOLVED: OpenSpec status returned malformed JSON');
}
if (!status || typeof status !== 'object' || Array.isArray(status)) {
  fail('BLOCKED_POLICY_UNRESOLVED: OpenSpec status did not return an object');
}

const changeRoot = status.changeRoot;
const schemaName = status.schemaName;
if (typeof changeRoot !== 'string' || !path.isAbsolute(changeRoot)
  || !fs.existsSync(changeRoot) || !fs.statSync(changeRoot).isDirectory()) {
  fail('BLOCKED_POLICY_UNRESOLVED: OpenSpec status did not return an existing absolute changeRoot');
}
if (typeof schemaName !== 'string' || !schemaName.trim()) {
  fail('BLOCKED_POLICY_UNRESOLVED: OpenSpec status did not identify the selected schema');
}
if ([changeRoot, schemaName].some((value) => /[\r\n]/.test(value))) {
  fail('BLOCKED_POLICY_UNRESOLVED: OpenSpec status returned a value unsupported by the analyzer output format');
}

function resolveArtifact(id, required) {
  const paths = status.artifactPaths;
  const artifact = paths && typeof paths === 'object' ? paths[id] : null;
  if (artifact == null) {
    if (required) fail(`BLOCKED_RESOURCE_MISSING: OpenSpec status has no '${id}' artifact mapping`);
    return '';
  }
  if (typeof artifact !== 'object' || Array.isArray(artifact)) {
    fail(`BLOCKED_POLICY_UNRESOLVED: OpenSpec status returned an unsupported '${id}' artifact mapping`);
  }

  const isFile = (candidate) => {
    if (typeof candidate !== 'string' || !path.isAbsolute(candidate) || /[\r\n]/.test(candidate)) return false;
    try { return fs.statSync(candidate).isFile(); } catch (_) { return false; }
  };
  if (isFile(artifact.resolvedOutputPath)) return artifact.resolvedOutputPath;

  const concretePaths = [];
  if (typeof artifact.outputPath === 'string') concretePaths.push(artifact.outputPath);
  if (Array.isArray(artifact.existingOutputPaths)) concretePaths.push(...artifact.existingOutputPaths);
  const existing = [...new Set(concretePaths.filter(isFile))];
  if (existing.length === 1) return existing[0];
  if (existing.length > 1) {
    fail(`BLOCKED_POLICY_UNRESOLVED: OpenSpec status returned ambiguous '${id}' artifact paths`);
  }
  if (required) fail(`BLOCKED_RESOURCE_MISSING: OpenSpec status has no existing '${id}' artifact file`);
  return '';
}

const tasksPath = resolveArtifact('tasks', true);
const proposalPath = resolveArtifact('proposal', true);
const designPath = resolveArtifact('design', false);
const state = status.state === 'archived' ? 'archived' : 'active';
const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
const fields = {
  CHANGE_DIR: changeRoot,
  SCHEMA_NAME: schemaName,
  TASKS_PATH: tasksPath,
  PROPOSAL_PATH: proposalPath,
  DESIGN_PATH: designPath,
  OPEN_SPEC_STATE: state,
};
for (const [key, value] of Object.entries(fields)) process.stdout.write(`${key}=${shellQuote(value)}\n`);
NODE
)" || {
  emit_head "error"
  echo "MESSAGE=OpenSpec status did not provide unambiguous change and artifact paths; default paths were not used."
  exit 0
}
# The embedded resolver emits shell-quoted assignments for these fixed keys;
# values from the OpenSpec CLI remain data and cannot add assignments or commands.
eval "$STATUS_FIELDS"

if [ "$OPEN_SPEC_STATE" = "archived" ]; then
  emit_head "archived"
  echo "CHANGE_DIR=$CHANGE_DIR"
  echo "SCHEMA_NAME=$SCHEMA_NAME"
  echo "MESSAGE=Change is already archived — it may be complete."
  exit 0
fi
STATUS="active"

# --- required artifacts -----------------------------------------------------
TASKS="$TASKS_PATH"
PROPOSAL="$PROPOSAL_PATH"
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
if [ -n "$DESIGN_PATH" ] && [ ! -f "$DESIGN_PATH" ]; then
  emit_head "error"
  echo "CHANGE_DIR=$CHANGE_DIR"
  echo "MESSAGE=Resolved design artifact is missing at $DESIGN_PATH"
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
echo "SCHEMA_NAME=$SCHEMA_NAME"
echo "TASKS_PATH=$TASKS_PATH"
echo "PROPOSAL_PATH=$PROPOSAL_PATH"
echo "DESIGN_PATH=$DESIGN_PATH"
echo "HAS_DESIGN=$( [ -n "$DESIGN_PATH" ] && [ -f "$DESIGN_PATH" ] && echo true || echo false )"
echo "TOTAL_TASKS=$TOTAL_TASKS"
echo "OPEN_TASKS=$OPEN_TASKS"
echo "DONE_TASKS=$DONE_TASKS"
echo "TURN_BUDGET=$TURN_BUDGET"
echo "TURN_BUDGET_SOURCE=$( [ -n "$CUSTOM_TURNS" ] && echo flag || echo formula )"
echo "SMOKE_FLAG=$SMOKE_FLAG"
echo "DRY_RUN=$DRY_RUN"
echo "MAX_DURATION=${MAX_DURATION:-}"
echo "MIN_COVERAGE=${MIN_COVERAGE:-}"
echo "SKILL_ROOT_Q=$SKILL_ROOT_Q"
node "$SCRIPT_DIR/goal-context.js" \
  "--tasks=$TASKS" \
  "--proposal=$PROPOSAL" \
  "--worker=$FAST_WORKER_OVERRIDE" \
  "--cross-provider=$CROSS_PROVIDER_OVERRIDE"
