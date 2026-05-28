#!/usr/bin/env bash
# pre-route.sh — deterministic natural-language → dhpk workflow matcher.
#
# The fast path of the /dhpk:do Smart Router: match a free-text request against
# the route-table.json SSOT and report the best workflow without spending a
# model turn on classification. Also the shared matcher behind the
# userpromptsubmit-skill-hint hook, so the route table stays the single source
# of truth for both surfaces.
#
# Usage:
#   pre-route.sh "<query text>"        # query as args
#   echo "<query>" | pre-route.sh      # or on stdin (when no args given)
#
# Output (exactly one line, tab-separated):
#   MATCH<TAB><skill><TAB><label>   a route-table pattern matched (first wins)
#   NO_MATCH                        nothing matched (caller should classify)
#   NO_QUERY                        no query text supplied
#
# Always exits 0. Degrades to NO_MATCH when the table or python3 is missing.
# Override the table path with DHPK_ROUTE_TABLE (used by tests).

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
ROUTE_TABLE="${DHPK_ROUTE_TABLE:-$PLUGIN_ROOT/scripts/lib/route-table.json}"

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
    skill = rule.get("skill")
    label = rule.get("label") or skill
    if not pat or not skill:
        continue
    try:
        if re.search(pat, q, re.IGNORECASE):
            print("MATCH\t" + skill + "\t" + label)
            sys.exit(0)
    except re.error:
        continue
print("NO_MATCH")
' 2>/dev/null || echo "NO_MATCH"

exit 0
