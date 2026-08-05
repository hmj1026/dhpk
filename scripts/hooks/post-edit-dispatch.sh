#!/usr/bin/env bash
# post-edit-dispatch.sh — PostToolUse (Edit|Write|MultiEdit) dispatcher.
#
# Runs only the core post-edit-remind.sh sentinel router. Module activation is
# consulted by that router for deterministic review routing; advisory lint,
# formatting, and transcript work are opt-in tooling and are not part of the
# default edit lifecycle.

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"

. "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh"
payload="$(dhpk_read_payload)"

# Core: synchronous (the sentinel-writing logic must complete before any
# later hook in the same event sees the artifacts/sessions/ state).
printf '%s' "$payload" | bash "$PLUGIN_ROOT/scripts/hooks/post-edit-remind.sh"
exit $?
