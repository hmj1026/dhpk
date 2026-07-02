#!/usr/bin/env bash
# One-shot migration from legacy continuous-learning-v2 data directories
# (the original ~/.claude/homunculus tree, or the interim ecc-homunculus
# location) into the current dhpk-homunculus data directory.
set -euo pipefail

# shellcheck disable=SC1091
. "$(dirname "$0")/lib/homunculus-dir.sh"
NEW="$(_clv2_resolve_homunculus_dir)"

LEGACY_CANDIDATES=("${HOME}/.claude/homunculus")
if [ -n "${XDG_DATA_HOME:-}" ]; then
  case "$XDG_DATA_HOME" in
    /*) LEGACY_CANDIDATES+=("${XDG_DATA_HOME}/ecc-homunculus") ;;
  esac
fi
LEGACY_CANDIDATES+=("${HOME}/.local/share/ecc-homunculus")

OLD=""
for candidate in "${LEGACY_CANDIDATES[@]}"; do
  if [ "$candidate" != "$NEW" ] && [ -d "$candidate" ]; then
    OLD="$candidate"
    break
  fi
done

if [ -z "$OLD" ]; then
  echo "Nothing to migrate (checked: ${LEGACY_CANDIDATES[*]})."
  exit 0
fi

if command -v pgrep >/dev/null 2>&1; then
  if pgrep -f "${HOME}.*observer-loop\\.sh" >/dev/null 2>&1; then
    echo "Refusing to migrate: observer-loop.sh is running." >&2
    echo "Exit all Claude Code sessions, then re-run." >&2
    exit 1
  fi
else
  echo "Warning: pgrep not available; skipping running-observer check." >&2
fi

mkdir -p "$(dirname "$NEW")"

if [ ! -d "$NEW" ]; then
  mv "$OLD" "$NEW"
  echo "Moved $OLD -> $NEW"
elif [ -z "$(ls -A "$NEW" 2>/dev/null || true)" ]; then
  rmdir "$NEW"
  mv "$OLD" "$NEW"
  echo "Moved $OLD -> $NEW (replaced empty destination)"
else
  old_count="$(find "$OLD" -type f 2>/dev/null | wc -l | tr -d ' ')"
  new_count="$(find "$NEW" -type f 2>/dev/null | wc -l | tr -d ' ')"
  echo "Refusing to migrate: both paths exist with content." >&2
  echo "  Old: $OLD ($old_count files)" >&2
  echo "  New: $NEW ($new_count files)" >&2
  echo "Resolve manually, then re-run." >&2
  exit 1
fi

settings="${HOME}/.claude/settings.json"
if [ -f "$settings" ] && grep -q '"CLV2_CONFIG"' "$settings" 2>/dev/null; then
  if grep -qE '\.claude/homunculus|ecc-homunculus' "$settings" 2>/dev/null; then
    cat >&2 <<WARN

Advisory: ~/.claude/settings.json still sets CLV2_CONFIG under the old path.
Update it to: ${NEW}/config.json
(Not editing settings.json automatically.)

WARN
  fi
fi
