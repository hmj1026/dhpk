#!/usr/bin/env bash
# userpromptsubmit-skill-hint.sh — UserPromptSubmit hook (advisory only)
#
# Reads the incoming user prompt and, when it strongly matches a known
# workflow pattern from `scripts/lib/route-table.json`, emits a one-line
# stderr hint suggesting the relevant dhpk command. Helps users discover
# workflows without memorising all 70 commands.
#
# Design:
# - First match wins (route table ordered specific → general).
# - Suggestion is advisory: hook always exits 0, never blocks the prompt.
# - Suppressed when:
#   * profile=minimal
#   * prompt starts with "/" (user already invoked a specific command)
#   * env DHPK_DISABLE_SKILL_HINT=1
# - python3 required to parse the JSON route table; fallback silently skips
#   the hint rather than printing noise.
#
# Trigger: UserPromptSubmit event (wired once in hooks/hooks.json).
# Cost: 1 JSON read + N regex matches (N ≈ 15), <100ms.

set -o pipefail

. "$(dirname "$0")/_lib/load-project-config.sh"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
ROUTE_TABLE="$PLUGIN_ROOT/scripts/lib/route-table.json"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

[ "$PROFILE" = "minimal" ] && exit 0
# Two opt-out paths: DHPK_DISABLE_SKILL_HINT=1 for one-shot, userConfig
# skill_hint_enabled=false (loaded as CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED).
[ "${DHPK_DISABLE_SKILL_HINT:-0}" = "1" ] && exit 0
[ "${CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED:-true}" = "false" ] && exit 0
[ -f "$ROUTE_TABLE" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

# Extract prompt text and run regex match in one python3 invocation so we
# avoid a shell-level regex engine (BRE/ERE differences trip up the patterns).
# Pattern matches dhpk's existing hooks: payload piped on stdin, script via -c.
# (heredoc-as-script collides with stdin redirection — sys.stdin gets the
# script body instead of the payload.)
HINT="$(printf '%s' "$PAYLOAD" | ROUTE_TABLE="$ROUTE_TABLE" python3 -c '
import json, os, re, sys

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

prompt = payload.get("prompt") or payload.get("user_prompt") or ""
if not prompt:
    msg = payload.get("message")
    if isinstance(msg, dict):
        prompt = msg.get("content") or ""

if not isinstance(prompt, str) or not prompt.strip():
    sys.exit(0)

stripped = prompt.strip()
if stripped.startswith("/"):
    sys.exit(0)

if len(stripped) < 8:
    sys.exit(0)

try:
    with open(os.environ["ROUTE_TABLE"], "r", encoding="utf-8") as f:
        table = json.load(f)
except Exception:
    sys.exit(0)

rules = table.get("rules", [])
if not isinstance(rules, list):
    sys.exit(0)

for rule in rules:
    pat = rule.get("pattern")
    skill = rule.get("skill")
    label = rule.get("label") or skill
    if not pat or not skill:
        continue
    try:
        if re.search(pat, prompt, re.IGNORECASE):
            print(skill + "\t" + label)
            break
    except re.error:
        continue
' 2>/dev/null)"

if [ -n "$HINT" ]; then
    skill="${HINT%%$'\t'*}"
    label="${HINT#*$'\t'}"
    echo >&2 "[skill-hint] this prompt looks like a $label task — consider running /$skill"
fi

exit 0
