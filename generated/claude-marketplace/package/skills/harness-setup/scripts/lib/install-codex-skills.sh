#!/usr/bin/env bash
# install-codex-skills.sh — safely sync the plugin's codex/ tree into a
# project's .codex/ directory.
#
# Usage:
#   install-codex-skills.sh                  symlink mode
#   install-codex-skills.sh --copy           materialise regular files
#   install-codex-skills.sh --update         reconcile an existing receipt
#   install-codex-skills.sh --migrate        adopt exact legacy destinations
#   install-codex-skills.sh --plan --json    report reconciliation evidence without writing
#   install-codex-skills.sh --adopt <path>@<destination-fingerprint>@<source-fingerprint> explicitly adopt one reported collision
#   install-codex-skills.sh --skill <stable-id> repeat an additive stable-ID overlay
#   install-codex-skills.sh --uninstall       remove unchanged owned entries
#   install-codex-skills.sh --recover         finish an interrupted or incomplete transaction, then stop
#   install-codex-skills.sh --force          bypass project-root heuristic
#
# This script only parses options and execs the JS installer under node:
# scripts/lib/install-adapters/codex-cli.js in a checkout, or the generated
# single-file bundle dhpk-installer.cjs beside this script in a packaged copy.
# The installer owns the project lock, the Projection Journal and the schema-v3
# receipt. Node.js is required. Exit status: 0 done, 1 reconciliation
# incomplete, 2 refused or failed, 64 retired option.

set -euo pipefail

NAME="${DHPK_INSTALLER_NAME:-install-codex-skills}"
die() { echo "[$NAME] $1" >&2; exit "${2:-2}"; }

MODE="symlink"; MODE_EXPLICIT=0; UPDATE=0; FORCE=0; MIGRATE=0; UNINSTALL=0
PLAN=0; RECOVER=0; JSON_OUTPUT=0; ADOPT_PATHS=""; SKILL_IDS=""
while [ "$#" -gt 0 ]; do
    arg="$1"
    case "$arg" in
        --profile|--profile=*) die "--profile has been retired; fresh installs use the common collection" 64 ;;
        --copy) MODE="copy"; MODE_EXPLICIT=1 ;;
        --update) UPDATE=1 ;;
        --migrate) MIGRATE=1 ;;
        --uninstall) UNINSTALL=1 ;;
        --plan) PLAN=1 ;;
        --recover) RECOVER=1 ;;
        --json) JSON_OUTPUT=1 ;;
        --skill)
            shift
            if [ "$#" -eq 0 ] || [[ "$1" == --* ]]; then die "--skill requires a stable ID"; fi
            SKILL_IDS="${SKILL_IDS}${1}"$'\n' ;;
        --skill=*)
            if [ -z "${arg#--skill=}" ]; then die "--skill requires a stable ID"; fi
            SKILL_IDS="${SKILL_IDS}${arg#--skill=}"$'\n' ;;
        --adopt)
            shift
            if [ "$#" -eq 0 ]; then die "--adopt requires a relative path"; fi
            ADOPT_PATHS="${ADOPT_PATHS}${1}"$'\n' ;;
        --adopt=*) ADOPT_PATHS="${ADOPT_PATHS}${arg#--adopt=}"$'\n' ;;
        --force) FORCE=1 ;;
        --help|-h)
            sed -n '2,/^$/{/^$/!p;}' "$0"
            exit 0 ;;
        *) die "unknown arg: $arg" ;;
    esac
    shift
done

if [ "$PLAN" -eq 1 ] && [ -n "$ADOPT_PATHS" ]; then die "ERROR: --plan cannot be combined with --adopt"; fi

SRC_REL="${DHPK_SRC_REL:-codex}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$HERE/../.." && pwd)}"
PROJECT_ROOT="$(pwd)"
if [ ! -d "$PLUGIN_ROOT/$SRC_REL" ]; then
    echo "[$NAME] ERROR: plugin $SRC_REL/ source not found" >&2
    echo "[$NAME] Codex and Cursor project-local sync require a repository checkout; an installed Claude plugin does not include this tree." >&2
    die "From a dhpk checkout, run: bash /path/to/dhpk/scripts/hooks/${NAME}.sh"
fi
if [ "$UNINSTALL" -ne 1 ] && [ "$PLAN" -ne 1 ] && ! command -v node >/dev/null 2>&1; then
    die "ERROR: node is required to materialize portable project skill metadata"
fi
if [ "$FORCE" -ne 1 ] && [ "$UNINSTALL" -ne 1 ]; then
    if [ ! -e "$PROJECT_ROOT/.git" ] && [ ! -e "$PROJECT_ROOT/.claude" ] && \
       [ ! -e "$PROJECT_ROOT/.codex" ] && [ ! -e "$PROJECT_ROOT/.cursor" ] && \
       [ ! -e "$PROJECT_ROOT/package.json" ] && [ ! -e "$PROJECT_ROOT/composer.json" ]; then
        echo "[$NAME] ERROR: '$PROJECT_ROOT' does not look like a project root." >&2
        die "Re-run with --force to bypass this check."
    fi
fi
if [ "${DHPK_HARNESS_KIND:-codex}" = "codex" ] && ! command -v codex >/dev/null 2>&1 && [ "$UNINSTALL" -ne 1 ]; then
    echo "[$NAME] note: 'codex' CLI not found on PATH; files can still be synced." >&2
fi

# A packaged copy runs the bundle beside it; a checkout runs the adapter.
if [ -f "$HERE/dhpk-installer.cjs" ]; then ENTRY="$HERE/dhpk-installer.cjs"
elif [ -f "$HERE/../lib/install-adapters/codex-cli.js" ]; then ENTRY="$HERE/../lib/install-adapters/codex-cli.js"
else die "ERROR: the JS installer is neither beside this script nor under scripts/lib/install-adapters"; fi
if ! command -v node >/dev/null 2>&1; then die "ERROR: node is required for the installer"; fi

export DHPK_HARNESS_KIND="${DHPK_HARNESS_KIND:-codex}" DHPK_SRC_REL="$SRC_REL"
export DHPK_DEST_REL="${DHPK_DEST_REL:-.codex}" DHPK_INSTALLER_NAME="$NAME"
export DHPK_SOURCE_KINDS="${DHPK_SOURCE_KINDS:-skills,agents}"
export DHPK_PLUGIN_ROOT="$PLUGIN_ROOT" DHPK_INSTALLER_ROOT="${DHPK_INSTALLER_ROOT:-$(cd "$HERE/../.." && pwd)}"
export DHPK_PROJECT_ROOT="$PROJECT_ROOT" DHPK_MODE="$MODE" DHPK_MODE_EXPLICIT="$MODE_EXPLICIT"
export DHPK_UPDATE="$UPDATE" DHPK_MIGRATE="$MIGRATE" DHPK_UNINSTALL="$UNINSTALL" DHPK_PLAN="$PLAN"
export DHPK_RECOVER="$RECOVER" DHPK_JSON_OUTPUT="$JSON_OUTPUT"
export DHPK_ADOPT_PATHS="$ADOPT_PATHS" DHPK_SKILL_IDS="$SKILL_IDS"
exec node "$ENTRY"
