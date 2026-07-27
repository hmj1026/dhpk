#!/usr/bin/env bash
# extract-notes.sh <changelog-path> <version>
#
# Print the release-note body between "## <version> ..." and the next
# "## <digit...>" heading (or end of file). Fails loudly (non-zero exit) when
# the heading is missing or its body is empty/whitespace-only, so a release
# can never publish with empty notes. Shared by release preparation and
# .github/workflows/release.yml.
set -euo pipefail

if [ "$#" -ne 2 ]; then
    echo "usage: extract-notes.sh <changelog-path> <version>" >&2
    exit 2
fi

changelog="$1"
version="$2"

if [ ! -f "$changelog" ]; then
    echo "extract-notes: $changelog not found" >&2
    exit 2
fi

if ! grep -qE "^## ${version} " "$changelog"; then
    echo "extract-notes: heading '## ${version} ' not found in $changelog" >&2
    exit 1
fi

notes="$(awk "/^## ${version} /{found=1; next} found && /^## [0-9]/{exit} found{print}" "$changelog")"

if [ -z "$(printf '%s' "$notes" | tr -d '[:space:]')" ]; then
    echo "extract-notes: empty release notes for ${version}" >&2
    exit 1
fi

printf '%s\n' "$notes"
