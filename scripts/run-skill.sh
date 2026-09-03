#!/usr/bin/env bash
#
# run-skill.sh — run a skill's bundled helper script by skill name.
#
# Usage:
#   run-skill.sh <skill-name> <script-file> [args...]
#
# Resolves to <repo>/skills/<skill-name>/scripts/<script-file> relative to this
# wrapper's own location (works regardless of CWD), then executes it with the
# matching interpreter. Documented invocation for skills that ship a helper
# script (`skill-scope`, `change-verdict`, `dhpk-project-audit`, `flow-guide`,
# `dhpk-repo-intake`, and `skill-forge`, which owns the authoring linter).
#
# Exit codes: passes through the target script; 2 = bad usage / script not found.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: run-skill.sh <skill-name> <script-file> [args...]" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

skill="$1"; shift
file="$1"; shift

# Reject path components — args are a skill name and a bare script filename, never paths.
for arg in "$skill" "$file"; do
  case "$arg" in
    */*|*..*) echo "run-skill: illegal path component in argument: $arg" >&2; exit 2 ;;
  esac
done

# Retired identities are kept in the inventory as migration evidence, not as
# compatibility aliases. Intercept them at this dhpk-owned seam so callers get
# stable successor guidance; unknown identifiers continue to use the historical
# script-not-found behavior below. Inventory errors fail closed: a stale or
# unavailable ledger must never allow a retained retired helper to execute.
if node - "$ROOT" "$skill" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');

const root = process.argv[2];
const identifier = process.argv[3];
try {
  const inventory = JSON.parse(fs.readFileSync(path.join(root, 'manifests', 'distribution-inventory.json'), 'utf8'));
  const api = require(path.join(root, 'scripts', 'lib', 'distribution-inventory.js'));
  const validation = api.validateDistributionInventoryV2({ inventory });
  const retirementValidation = api.validateSkillRetirements({ inventory });
  const errors = [
    ...(validation && Array.isArray(validation.errors) ? validation.errors : ['inventory validation did not return diagnostics']),
    ...(retirementValidation && Array.isArray(retirementValidation.errors) ? retirementValidation.errors : ['retirement validation did not return diagnostics']),
  ];
  if (errors.length > 0) {
    process.stderr.write(`run-skill: distribution inventory is malformed or unavailable; refusing to execute: ${errors.join('; ')}\n`);
    process.exit(3);
  }
  const resolution = api.resolveSkillIdentity({ inventory, identifier });
  if (resolution.state === 'retired') {
    process.stderr.write(`${api.formatSkillIdentityDiagnostic({ inventory, resolution })}\n`);
    process.exit(2);
  }
} catch (error) {
  process.stderr.write(`run-skill: distribution inventory is malformed or unavailable; refusing to execute: ${error.message}\n`);
  process.exit(3);
}
NODE
then
  :
else
  status=$?
  # Retirements and inventory failures both use the wrapper's bad-usage class;
  # keep the distinction in stderr while preserving the stable exit contract.
  exit 2
fi

skills_root="$(realpath -e -- "$ROOT/skills" 2>/dev/null)" || {
  echo "run-skill: canonical skills root is unavailable; refusing to execute" >&2
  exit 2
}
target="$skills_root/$skill/scripts/$file"
if [ ! -f "$target" ]; then
  echo "run-skill: script not found: $target" >&2
  exit 2
fi

canonical_target="$(realpath -e -- "$target" 2>/dev/null)" || {
  echo "run-skill: script target is unavailable or cannot be canonicalized: $target" >&2
  exit 2
}
case "$canonical_target" in
  "$skills_root"/*) ;;
  *) echo "run-skill: script target escapes the canonical skills root: $target" >&2; exit 2 ;;
esac
if [ "$canonical_target" != "$target" ]; then
  echo "run-skill: symlinked script targets are not executable: $target" >&2
  exit 2
fi

case "$file" in
  *.js) exec node "$target" "$@" ;;
  *.py) exec python3 "$target" "$@" ;;
  *.sh) exec bash "$target" "$@" ;;
  *)    echo "run-skill: unsupported script type: $file" >&2; exit 2 ;;
esac
