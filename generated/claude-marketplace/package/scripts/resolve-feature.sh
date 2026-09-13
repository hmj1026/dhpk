#!/usr/bin/env bash
# resolve-feature.sh — bash wrapper over resolve-feature-cli.js.
# Runs the CLI relative to this script's own location, so it works from any cwd.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/resolve-feature-cli.js" "$@"
