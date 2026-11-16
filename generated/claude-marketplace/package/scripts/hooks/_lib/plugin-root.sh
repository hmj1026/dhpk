#!/usr/bin/env bash
# plugin-root.sh -- resolve the package root that owns a running hook script.
#
# Contract: docs/adr/0038-resolve-runtime-resources-from-the-owning-package.md
# (issue #1446). The root is the package holding the PHYSICAL hooks directory;
# CLAUDE_PLUGIN_ROOT never selects it.
#
# Usage (after the hook's inline symlink-safe bootstrap sets _dhpk_hooks_dir):
#   . "$_dhpk_hooks_dir/_lib/plugin-root.sh"
#   dhpk_plugin_root "$_dhpk_hooks_dir" || exit N
# Sets the global PLUGIN_ROOT (no stdout). On failure prints one stderr message
# and returns 1. Fail mode: guard hooks exit 2, advisory hooks exit 1.

# dhpk_plugin_root <physical-hooks-dir>   (<package>/scripts/hooks)
dhpk_plugin_root() {
    PLUGIN_ROOT="${1%/*/*}"
    if [ "$PLUGIN_ROOT" = "${1:-}" ] || [ ! -f "$PLUGIN_ROOT/scripts/hooks/_lib/session-env.sh" ]; then
        echo "dhpk_plugin_root: no dhpk package root for hooks dir '${1:-}'" >&2
        PLUGIN_ROOT=""
        return 1
    fi
}
