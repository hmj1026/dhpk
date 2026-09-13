#!/usr/bin/env bash
# check-plugin-version.sh — SessionStart advisory: compare the running dhpk
# version against the project's verified-version pin file. Advisory only —
# never blocks; silent no-op when the project has no pin file.
#
# Pin file: <project>/.claude/dhpk-versions.json (version-controlled; template
# ships at templates/dhpk-versions.json). Schema:
#   { "verified":     [ { "range": "0.10.x", "note": "..." } ],
#     "incompatible": [ { "range": "0.3",    "note": "..." } ] }
# Range matching is prefix-based: "0.10" / "0.10.x" match 0.10.0, 0.10.1, ...
# Major bumps therefore require a deliberate pin-file update.
#
# Version source: $CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json (the running
# install — exact regardless of install layout). Fallback: scan the marketplace
# cache directory names (covers mid-upgrade states where multiple versions are
# present; all detected versions are validated).
#
# Caller: scripts/hooks/session-start.sh (non-minimal profiles).
# Next step when flagged: scripts/version-diff.sh does the deliberate-update
# legwork (pluginConfigs schema diff + CHANGELOG excerpt since last verified)
# and prints a draft pin-file entry — still requires a human/AI decision to
# actually mark the version verified.
# Exit code: always 0.

set -o pipefail

. "$(dirname "$0")/_lib/session-env.sh"
ROOT="$(dhpk_root)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PIN_JSON="$ROOT/.claude/dhpk-versions.json"
DHPK_CACHE="$HOME/.claude/plugins/cache/dhpk/dhpk"

[ -f "$PIN_JSON" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

# Collect versions to validate: running version first, cache dirs as fallback.
VERSIONS=""
_running="$(python3 -c '
import json, sys
try:
    with open(sys.argv[1]) as f:
        print(json.load(f).get("version", ""))
except Exception:
    pass
' "$PLUGIN_ROOT/.claude-plugin/plugin.json" 2>/dev/null)"
if [ -n "$_running" ]; then
    VERSIONS="$_running"
elif [ -d "$DHPK_CACHE" ]; then
    # while-read instead of mapfile — stock macOS bash 3.2 has no mapfile.
    while IFS= read -r _v; do
        [ -n "$_v" ] && VERSIONS="$VERSIONS $_v"
    done < <(ls -1 "$DHPK_CACHE" 2>/dev/null | grep -E '^[0-9]+\.[0-9]+(\.[0-9]+)?$')
fi
VERSIONS="$(echo "$VERSIONS" | xargs)"
[ -z "$VERSIONS" ] && exit 0

result="$(PIN_JSON="$PIN_JSON" VERSIONS="$VERSIONS" python3 <<'PY'
import json, os, sys

try:
    with open(os.environ["PIN_JSON"], "r", encoding="utf-8") as f:
        pins = json.load(f)
except Exception:
    sys.exit(0)

versions = (os.environ.get("VERSIONS") or "").split()
if not versions:
    sys.exit(0)

def prefixes(entries):
    out = []
    for v in entries or []:
        r = (v.get("range") or "").strip().replace(".x", "").rstrip(".")
        if r:
            out.append(r)
    return out

verified = prefixes(pins.get("verified"))
incompat = prefixes(pins.get("incompatible"))

def matches(ver, plist):
    return any(ver == p or ver.startswith(p + ".") for p in plist)

flagged = []
for ver in versions:
    if matches(ver, incompat):
        flagged.append(f"{ver}(incompatible)")
    elif not matches(ver, verified):
        flagged.append(f"{ver}(unverified)")

if flagged:
    print(" ".join(flagged))
PY
)"

if [ -n "$result" ]; then
    echo "[session-start] dhpk version advisory: $result — review .claude/dhpk-versions.json (or run scripts/version-diff.sh for a config/CHANGELOG diff); if the pin file is a symlink, Write to its realpath (realpath .claude/dhpk-versions.json) — the Write tool refuses symlinks"
fi

exit 0
