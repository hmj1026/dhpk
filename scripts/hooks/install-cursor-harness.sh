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
#                                              hash-cache plugin.json drifts from local SSOT;
#                                              passes through excluded[] for unmet skill deps)
#   install-cursor-harness.sh --adopt <path>@<destination-fingerprint>@<source-fingerprint> explicitly adopt one reported collision
#   install-cursor-harness.sh --skill <stable-id> repeat an additive stable-ID overlay
#   install-cursor-harness.sh --uninstall       remove unchanged owned entries
#   install-cursor-harness.sh --recover         finish an interrupted or incomplete transaction, then stop
#   install-cursor-harness.sh --force          bypass project-root heuristic
#
# Native Cursor hooks.json mapping is out of v1. This installer never writes
# .cursor/hooks.json. The receipt is schema-v3 at .cursor/.dhpk-installed.json.
#
# This script selects the Cursor Host and hands every option to
# install-codex-skills.sh, which execs the JS installer (project lock,
# Projection Journal, hash-cache drift warnings). Node.js is required.

set -euo pipefail

for arg in "$@"; do
    case "$arg" in
        --help|-h)
            sed -n '2,/^$/{/^$/!p;}' "$0"
            exit 0
            ;;
    esac
done

export DHPK_HARNESS_KIND="${DHPK_HARNESS_KIND:-cursor}"
export DHPK_SRC_REL="${DHPK_SRC_REL:-cursor}"
export DHPK_DEST_REL="${DHPK_DEST_REL:-.cursor}"
export DHPK_SOURCE_KINDS="${DHPK_SOURCE_KINDS:-skills,agents,rules,commands}"
export DHPK_INSTALLER_NAME="${DHPK_INSTALLER_NAME:-install-cursor-harness}"
exec bash "$(cd "$(dirname "$0")" && pwd)/install-codex-skills.sh" "$@"
