#!/usr/bin/env bash
# version-diff.sh — on-demand helper for the "deliberate pin-file update"
# check-plugin-version.sh asks for once it flags the running version as
# unverified. Turns the manual archaeology (re-read CHANGELOG.md, re-check
# every pluginConfigs key by hand) into one command.
#
# Not wired into any hook and not a slash command — invoke directly:
#   bash "$CLAUDE_PLUGIN_ROOT/scripts/version-diff.sh" [--project-root <path>]
#
# What it does (all read-only, exit code always 0):
#   1. Resolve the running plugin version + userConfig schema keys from
#      $CLAUDE_PLUGIN_ROOT/.claude-plugin/plugin.json.
#   2. Read <project>/.claude/dhpk-versions.json; if the running version is
#      already covered by a verified range, print OK and stop — nothing to do.
#   3. Otherwise:
#      a. Config schema diff — union the pluginConfigs["dhpk@dhpk"].options
#         keys from the project's settings.json + settings.local.json and
#         compare against the running plugin's userConfig keys. A configured
#         key absent from the current schema is flagged P1 (likely renamed
#         or removed upstream); a schema key the project hasn't configured
#         is listed for information only, with its one-line description.
#      b. CHANGELOG excerpt — print every "## <version>" section in
#         CHANGELOG.md strictly newer than the highest currently-verified
#         version, up to and including the running version.
#      c. A ready-to-paste verified-entry JSON snippet (date placeholder) —
#         printed only, never written. Marking a version verified stays a
#         deliberate human/AI decision, same design as check-plugin-version.sh.
#
# Exit code: always 0 (advisory tool, never blocks).

set -o pipefail

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
ROOT="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

while [ $# -gt 0 ]; do
    case "$1" in
        --project-root)
            ROOT="$2"
            shift 2
            ;;
        *)
            echo "usage: version-diff.sh [--project-root <path>]" >&2
            exit 0
            ;;
    esac
done

PLUGIN_JSON="$PLUGIN_ROOT/.claude-plugin/plugin.json"
CHANGELOG="$PLUGIN_ROOT/CHANGELOG.md"
PIN_JSON="$ROOT/.claude/dhpk-versions.json"
SETTINGS_JSON="$ROOT/.claude/settings.json"
SETTINGS_LOCAL_JSON="$ROOT/.claude/settings.local.json"

command -v python3 >/dev/null 2>&1 || { echo "[version-diff] python3 not found — skipping" >&2; exit 0; }
[ -f "$PLUGIN_JSON" ] || { echo "[version-diff] $PLUGIN_JSON not found — is CLAUDE_PLUGIN_ROOT set correctly?" >&2; exit 0; }
[ -f "$PIN_JSON" ] || { echo "[version-diff] no pin file at $PIN_JSON — nothing to diff against" >&2; exit 0; }

PLUGIN_JSON="$PLUGIN_JSON" CHANGELOG="$CHANGELOG" PIN_JSON="$PIN_JSON" \
SETTINGS_JSON="$SETTINGS_JSON" SETTINGS_LOCAL_JSON="$SETTINGS_LOCAL_JSON" \
python3 <<'PY'
import json
import os
import re
import sys
from datetime import date

def load_json(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None

def ver_tuple(v):
    parts = re.findall(r"\d+", v)
    return tuple(int(p) for p in parts) if parts else (0,)

plugin = load_json(os.environ["PLUGIN_JSON"]) or {}
running = plugin.get("version", "")
if not running:
    print("[version-diff] running plugin.json has no 'version' field — aborting")
    sys.exit(0)

schema_keys = set((plugin.get("userConfig") or {}).keys())
schema_descs = {k: (v or {}).get("description", "") for k, v in (plugin.get("userConfig") or {}).items()}

pins = load_json(os.environ["PIN_JSON"]) or {}

def prefixes(entries):
    out = []
    for v in entries or []:
        r = (v.get("range") or "").strip().replace(".x", "").rstrip(".")
        if r:
            out.append(r)
    return out

verified_prefixes = prefixes(pins.get("verified"))
incompat_prefixes = prefixes(pins.get("incompatible"))

def matches(ver, plist):
    return any(ver == p or ver.startswith(p + ".") for p in plist)

if matches(running, incompat_prefixes):
    print(f"[version-diff] running {running} is marked INCOMPATIBLE in {os.environ['PIN_JSON']} — see the note there before doing anything else.")
    sys.exit(0)

if matches(running, verified_prefixes):
    print(f"[version-diff] OK — running {running} is already covered by a verified range. Nothing to do.")
    sys.exit(0)

print(f"[version-diff] running {running} is NOT covered by any verified range yet.")
print()

# --- 3a. Config schema diff -------------------------------------------------
def pluginconfig_options(path):
    data = load_json(path) or {}
    return set(
        (data.get("pluginConfigs") or {})
        .get("dhpk@dhpk", {})
        .get("options", {})
        .keys()
    )

configured_keys = pluginconfig_options(os.environ["SETTINGS_JSON"]) | pluginconfig_options(os.environ["SETTINGS_LOCAL_JSON"])

unknown = sorted(configured_keys - schema_keys)
unconfigured = sorted(schema_keys - configured_keys)

print("## Config schema diff (pluginConfigs.dhpk@dhpk.options vs running userConfig schema)")
if unknown:
    print(f"P1 — configured but not in the {running} schema (likely renamed/removed upstream):")
    for k in unknown:
        print(f"  - {k}")
else:
    print("P1 — none. Every configured key still exists in the running schema.")
if unconfigured:
    print("Info — schema keys not configured by this project (defaults apply):")
    for k in unconfigured:
        desc = schema_descs.get(k, "")
        short = (desc[:100] + "...") if len(desc) > 100 else desc
        print(f"  - {k}: {short}")
print()

# --- 3b. CHANGELOG excerpt ---------------------------------------------------
# verified_prefixes are ranges (e.g. "0.20" from "0.20.x"), possibly with gaps
# (older minors dropped once a newer one was verified). "Newer than last
# verified" is judged at the same major.minor granularity as the pin file,
# so 0.20.1 stays covered by a verified "0.20" range and pre-0.20 versions
# aren't re-surfaced just because they were never individually pinned.
last_verified = max(verified_prefixes, key=ver_tuple, default=None)
last_verified_tuple = ver_tuple(last_verified) if last_verified else None
print(f"## CHANGELOG.md sections newer than last verified ({last_verified or 'none'}) through {running}")
try:
    with open(os.environ["CHANGELOG"], "r", encoding="utf-8") as f:
        changelog = f.read()
except Exception:
    changelog = ""

sections = re.split(r"(?m)^(## .+)$", changelog)
# sections[0] is preamble; then alternating heading/body pairs
printed_any = False
for i in range(1, len(sections), 2):
    heading = sections[i].strip()
    body = sections[i + 1] if i + 1 < len(sections) else ""
    m = re.match(r"## ([0-9]+\.[0-9]+\.[0-9]+)", heading)
    if not m:
        continue
    v = m.group(1)
    vt = ver_tuple(v)
    if vt > ver_tuple(running):
        continue
    if matches(v, verified_prefixes):
        continue
    if last_verified_tuple and vt[: len(last_verified_tuple)] <= last_verified_tuple:
        continue
    print(heading)
    print(body.rstrip())
    print()
    printed_any = True
if not printed_any:
    print("(no matching CHANGELOG sections found — check version numbers by hand)")
print()

# --- 3c. Draft verified-entry snippet ---------------------------------------
today = os.environ.get("VERSION_DIFF_TODAY") or date.today().isoformat()
major_minor = ".".join(running.split(".")[:2])
print("## Draft verified-entry (paste into .claude/dhpk-versions.json after reviewing the above — not written automatically)")
print(json.dumps({"range": f"{major_minor}.x", "note": f"verified {today} — <what was checked>"}, ensure_ascii=False, indent=2))
PY
exit 0
