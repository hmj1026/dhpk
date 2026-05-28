#!/usr/bin/env bash
# pretool-sentinel-gate.sh — PreToolUse (Bash) hook
#
# Companion to pre-bash-guard.sh. While pre-bash-guard hard-blocks `git push`
# when sentinel-listed paths are still uncommitted, this hook warns (or
# optionally blocks) on `git commit` / `git merge` / `git rebase` /
# `git cherry-pick` while reviewer sentinels exist. The asymmetry is
# intentional: commit is local and may legitimately precede review; push is
# already team-visible and warrants hard block.
#
# Modes (env DHPK_SENTINEL_COMMIT_GATE):
#   warn   — print stderr summary, exit 0 (default; safe, non-disruptive)
#   block  — print stderr summary, exit 2 (rejects the tool call)
#   off    — silent exit 0 (kill-switch)
#
# Trigger: PreToolUse Bash matcher.
# Cost: regex on $CMD + per-sentinel stat, <30ms.
#
# Why a separate hook (not merged into pre-bash-guard.sh):
# - Keeps pre-bash-guard's hard-block surface stable (rm -rf / curl|sh /
#   chmod 777 / git push). Adding a configurable warn-only path would mix
#   concerns. This file's sole job is the soft post-edit review nudge.

set -o pipefail

. "$(dirname "$0")/_lib/load-project-config.sh"
. "$(dirname "$0")/_lib/payload.sh"

# Mode resolution: env override (DHPK_*) wins for one-shot toggles; otherwise
# read from userConfig via load-project-config.sh-populated env. Default: warn.
MODE="${DHPK_SENTINEL_COMMIT_GATE:-${CLAUDE_PLUGIN_OPTION_SENTINEL_COMMIT_GATE:-warn}}"
[ "$MODE" = "off" ] && exit 0

PAYLOAD="$(cat 2>/dev/null || true)"
CMD="$(extract_tool_input command "$PAYLOAD")"
[ -z "$CMD" ] && exit 0

# Strip shell comments to avoid matching text after `#`.
CMD_STRIPPED="$(printf '%s' "$CMD" | sed 's/[[:space:]]*#.*//')"

# Match the four review-bypass git verbs. Exclude `--help` / `-h` / `--dry-run`
# / `--amend --no-edit` so meta-commands aren't gated.
if ! printf '%s' "$CMD_STRIPPED" | grep -Eq \
    '(^|[[:space:]])git[[:space:]]+(commit|merge|rebase|cherry-pick)([[:space:]]|$)'; then
    exit 0
fi
if printf '%s' "$CMD_STRIPPED" | grep -Eq \
    '(--help|[[:space:]]-h([[:space:]]|$)|--dry-run|--abort|--continue|--skip|--quit)'; then
    exit 0
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
SESS="$ROOT/.claude/artifacts/sessions"

active_names=()
active_agents=()
for i in "${!SENTINEL_NAMES[@]}"; do
    f="$SESS/${SENTINEL_NAMES[$i]}"
    if [ -f "$f" ]; then
        active_names+=("${SENTINEL_NAMES[$i]}")
        active_agents+=("${SENTINEL_AGENTS[$i]}")
    fi
done

# Nothing pending → silent exit.
[ "${#active_names[@]}" -eq 0 ] && exit 0

# Compose summary.
verb="$(printf '%s' "$CMD_STRIPPED" | grep -oE 'git[[:space:]]+(commit|merge|rebase|cherry-pick)' | head -1 | tr -s ' ' | sed 's/^git //')"
[ -z "$verb" ] && verb="git op"
names_csv="$(IFS=,; printf '%s' "${active_names[*]}")"
agents_csv="$(IFS=,; printf '%s' "${active_agents[*]}")"

echo >&2 ""
echo >&2 "-----------------------------------------------------------"
if [ "$MODE" = "block" ]; then
    echo >&2 "✗  BLOCKED: $verb attempted while reviewer chain is pending."
else
    echo >&2 "⚠  REMINDER: $verb attempted while reviewer chain is pending."
fi
echo >&2 "   Active sentinels: $names_csv"
echo >&2 "   Pending reviewers: $agents_csv"
echo >&2 "   Run each reviewer first, or bypass by setting DHPK_SENTINEL_COMMIT_GATE=off"
echo >&2 "-----------------------------------------------------------"

[ "$MODE" = "block" ] && exit 2
exit 0
