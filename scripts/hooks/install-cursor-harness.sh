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
            sed -n '2,16p' "$0"
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
exec bash "$ROOT/scripts/hooks/install-codex-skills.sh" "$@"
