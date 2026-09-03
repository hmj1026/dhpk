#!/usr/bin/env bash
# pre-route.sh — skill-local v2 matcher for flow-drive.
#
# Match a free-text request against references/route-table.json (v2 typed
# targets) and report the first hit. Always exits 0.
#
# Usage:
#   pre-route.sh "<query text>"        # query as args
#   echo "<query>" | pre-route.sh      # or on stdin (when no args given)
#
# Output (exactly one line, tab-separated):
#   MATCH<TAB><id><TAB><label>   a route-table pattern matched (first wins)
#   NO_MATCH                     nothing matched (caller should classify)
#   NO_QUERY                     no query text supplied
#
# Override the table path with DHPK_ROUTE_TABLE (used by tests).

set -o pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
ROUTE_TABLE="${DHPK_ROUTE_TABLE:-$PLUGIN_ROOT/skills/flow-drive/references/route-table.json}"

# Query: prefer positional args; fall back to stdin so callers can pipe.
QUERY="$*"
if [ -z "${QUERY//[[:space:]]/}" ]; then
    if [ ! -t 0 ]; then
        QUERY="$(cat 2>/dev/null || true)"
    fi
fi
if [ -z "${QUERY//[[:space:]]/}" ]; then
    echo "NO_QUERY"
    exit 0
fi

if [ ! -f "$ROUTE_TABLE" ] || ! command -v python3 >/dev/null 2>&1; then
    echo "NO_MATCH"
    exit 0
fi

QUERY="$QUERY" ROUTE_TABLE="$ROUTE_TABLE" python3 -c '
import json, os, re, sys

q = os.environ.get("QUERY", "")
try:
    with open(os.environ["ROUTE_TABLE"], encoding="utf-8") as f:
        table = json.load(f)
except Exception:
    print("NO_MATCH")
    sys.exit(0)

for rule in table.get("rules", []):
    pat = rule.get("pattern")
    target = rule.get("target") if isinstance(rule.get("target"), dict) else {}
    ident = target.get("id")
    kind = target.get("kind")
    label = rule.get("label") or ident
    if not pat or not ident:
        continue
    _ = kind
    try:
        if re.search(pat, q, re.IGNORECASE):
            print("MATCH\t" + ident + "\t" + label)
            sys.exit(0)
    except re.error:
        continue
print("NO_MATCH")
' 2>/dev/null || echo "NO_MATCH"

exit 0
