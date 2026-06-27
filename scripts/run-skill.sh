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
# script (skill-health-check, risk-assess, project-audit, next-step, repo-intake,
# and create-skill which borrows skill-health-check's linter).
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

target="$ROOT/skills/$skill/scripts/$file"
if [ ! -f "$target" ]; then
  echo "run-skill: script not found: $target" >&2
  exit 2
fi

case "$file" in
  *.js) exec node "$target" "$@" ;;
  *.py) exec python3 "$target" "$@" ;;
  *.sh) exec bash "$target" "$@" ;;
  *)    echo "run-skill: unsupported script type: $file" >&2; exit 2 ;;
esac
