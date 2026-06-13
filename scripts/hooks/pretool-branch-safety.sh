#!/usr/bin/env bash
# pretool-branch-safety.sh — PreToolUse (Bash) hook
#
# Warns (or optionally blocks) when a `git commit` runs on a protected branch
# (main / master / develop / release/*). The branch list is configurable via
# CLAUDE_PLUGIN_OPTION_PROTECTED_BRANCHES (comma-separated globs).
#
# Modes (env DHPK_BRANCH_SAFETY):
#   warn   — print stderr summary, exit 0 (default)
#   block  — print stderr summary, exit 2
#   off    — silent exit 0 (kill-switch)
#
# This is a "trust but verify" rail. Many projects use trunk-based dev and
# commit-to-main is legitimate. The default warn-only mode catches the
# typical "forgot to branch" mistake without locking out projects that do
# trunk-based dev intentionally — they can set DHPK_BRANCH_SAFETY=off.
#
# Trigger: PreToolUse Bash matcher.
# Cost: regex on $CMD + 1 `git branch --show-current`, <30ms.

set -o pipefail

. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

# Mode resolution: env override (DHPK_*) wins for one-shot toggles; otherwise
# read from userConfig via load-project-config.sh-populated env. Default: warn.
MODE="${DHPK_BRANCH_SAFETY:-${CLAUDE_PLUGIN_OPTION_BRANCH_SAFETY:-warn}}"
[ "$MODE" = "off" ] && exit 0

PAYLOAD="$(cat 2>/dev/null || true)"
CMD="$(extract_tool_input command "$PAYLOAD")"
[ -z "$CMD" ] && exit 0

CMD_STRIPPED="$(printf '%s' "$CMD" | sed 's/[[:space:]]*#.*//')"

# Only gate the verbs that mutate branch history.
if ! printf '%s' "$CMD_STRIPPED" | grep -Eq \
    '(^|[[:space:]])git[[:space:]]+(commit|merge|rebase|cherry-pick|reset|push)([[:space:]]|$)'; then
    exit 0
fi
if printf '%s' "$CMD_STRIPPED" | grep -Eq \
    '(--help|[[:space:]]-h([[:space:]]|$)|--dry-run|--abort|--continue|--skip|--quit)'; then
    exit 0
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
BRANCH="$(git -C "$ROOT" branch --show-current 2>/dev/null || echo '')"
[ -z "$BRANCH" ] && exit 0  # detached HEAD or git missing — skip

# Default protected list. Override via userConfig.protected_branches.
PROTECTED_RAW="${CLAUDE_PLUGIN_OPTION_PROTECTED_BRANCHES:-main,master,develop,release/*,hotfix/*}"

# Check membership with glob support.
matched=0
IFS=',' read -r -a _branches <<< "$PROTECTED_RAW"
for pat in "${_branches[@]}"; do
    pat="$(echo "$pat" | xargs)"
    [ -z "$pat" ] && continue
    # shellcheck disable=SC2053  # intentional glob match, not equality
    case "$BRANCH" in
        $pat) matched=1; break ;;
    esac
done
[ "$matched" -eq 0 ] && exit 0

verb="$(printf '%s' "$CMD_STRIPPED" | grep -oE 'git[[:space:]]+(commit|merge|rebase|cherry-pick|reset|push)' | head -1 | tr -s ' ' | sed 's/^git //')"

echo >&2 ""
echo >&2 "-----------------------------------------------------------"
if [ "$MODE" = "block" ]; then
    echo >&2 "✗  BLOCKED: $verb on protected branch '$BRANCH'."
else
    echo >&2 "[WARN] REMINDER: $verb on protected branch '$BRANCH'."
fi
echo >&2 "   Protected list: $PROTECTED_RAW"
echo >&2 "   Suggested: create a feature branch first (\`git checkout -b feat/...\`)"
echo >&2 "   Override: DHPK_BRANCH_SAFETY=off (one-off) or set userConfig.protected_branches"
echo >&2 "-----------------------------------------------------------"

[ "$MODE" = "block" ] && exit 2
exit 0
