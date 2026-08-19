#!/usr/bin/env bash
# install-cursor-harness.sh — safely sync the plugin's cursor/ tree into a
# project's .cursor/ directory.
#
# Usage:
#   install-cursor-harness.sh                  symlink mode
#   install-cursor-harness.sh --copy           materialise regular files
#   install-cursor-harness.sh --update         reconcile an existing receipt
#   install-cursor-harness.sh --migrate        adopt exact legacy destinations
#   install-cursor-harness.sh --plan --json    report reconciliation evidence without writing
#                                              (adds warnings[] when ~/.cursor/plugins/cache
#                                              hash-cache plugin.json drifts from local SSOT)
#   install-cursor-harness.sh --adopt <path>@<destination-fingerprint>@<source-fingerprint> explicitly adopt one reported collision
#   install-cursor-harness.sh --uninstall       remove unchanged owned entries
#   install-cursor-harness.sh --force          bypass project-root heuristic
#
# Native Cursor hooks.json mapping is out of v1. This installer never writes
# .cursor/hooks.json. The receipt is schema-v3 at .cursor/.dhpk-installed.json.

set -euo pipefail

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            sed -n '2,18p' "$0"
            exit 0
            ;;
    esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export DHPK_HARNESS_KIND="${DHPK_HARNESS_KIND:-cursor}"
export DHPK_SRC_REL="${DHPK_SRC_REL:-cursor}"
export DHPK_DEST_REL="${DHPK_DEST_REL:-.cursor}"
export DHPK_SOURCE_KINDS="${DHPK_SOURCE_KINDS:-skills,agents,rules,commands}"
export DHPK_INSTALLER_NAME="${DHPK_INSTALLER_NAME:-install-cursor-harness}"
SHARED="$ROOT/scripts/hooks/install-codex-skills.sh"

plan=0
json=0
for arg in "$@"; do
    case "$arg" in
        --plan) plan=1 ;;
        --json) json=1 ;;
    esac
done

if [ "$plan" = 1 ] && [ "$json" = 1 ]; then
    tmp="$(mktemp)"
    set +e
    bash "$SHARED" "$@" >"$tmp"
    st=$?
    set -e
    if python3 -c 'import json,sys; json.load(open(sys.argv[1], encoding="utf-8"))' "$tmp" >/dev/null 2>&1; then
        python3 - "$tmp" <<'PY'
import glob
import json
import os
import sys

report_path = sys.argv[1]
with open(report_path, encoding='utf-8') as handle:
    report = json.load(handle)

home = os.environ.get('HOME') or ''
cache_root = os.path.join(home, '.cursor', 'plugins', 'cache', 'dhpk', 'dhpk')
local_manifests = [
    os.path.join(home, '.cursor', 'plugins', 'local', 'dhpk-agent', 'plugin.json'),
    os.path.join(home, '.cursor', 'plugins', 'local', 'dhpk-cursor', '.cursor-plugin', 'plugin.json'),
]


def read_version(path):
    try:
        with open(path, encoding='utf-8') as handle:
            version = json.load(handle).get('version')
        return version if isinstance(version, str) and version else None
    except (OSError, json.JSONDecodeError, AttributeError):
        return None

ssot = set()
plugin_version = report.get('plugin_version')
if isinstance(plugin_version, str) and plugin_version:
    ssot.add(plugin_version)
for manifest in local_manifests:
    version = read_version(manifest)
    if version:
        ssot.add(version)

warnings = [item for item in (report.get('warnings') or []) if isinstance(item, dict)]
if ssot and os.path.isdir(cache_root):
    for manifest in sorted(glob.glob(os.path.join(cache_root, '*', '.claude-plugin', 'plugin.json'))):
        cache_version = read_version(manifest)
        if cache_version and cache_version not in ssot:
            warnings.append({
                'code': 'cursor_marketplace_hash_cache_drift',
                'path': manifest,
                'cache_version': cache_version,
                'ssot_versions': sorted(ssot),
                'message': (
                    'Cursor marketplace hash cache is not SSOT; local packages '
                    'and the project-local receipt are. Disable/remove the '
                    'marketplace dhpk plugin in Cursor UI. Do not hand-delete '
                    'the hash cache unless Cursor has already uninstalled that '
                    'marketplace plugin.'
                ),
            })
report['warnings'] = warnings
print(json.dumps(report, indent=2, sort_keys=True))
PY
    else
        cat "$tmp"
    fi
    rm -f "$tmp"
    exit "$st"
fi

exec bash "$SHARED" "$@"
