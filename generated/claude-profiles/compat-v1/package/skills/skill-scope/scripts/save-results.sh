#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$BASH_SOURCE")" && pwd)
exec node "$SCRIPT_DIR/stocktake-runtime.js" save "$@"
