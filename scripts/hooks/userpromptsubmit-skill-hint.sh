#!/usr/bin/env bash
# userpromptsubmit-skill-hint.sh — UserPromptSubmit hook (advisory only)
#
# Reads the incoming user prompt and, when it strongly matches a known
# workflow pattern, emits a one-line stderr hint suggesting the relevant dhpk
# command. Helps users discover workflows without memorising all 70 commands.
#
# Matching is delegated to scripts/lib/pre-route.sh (the same matcher behind
# the /dhpk:do Smart Router), so route-table.json stays the single source of
# truth for both surfaces. This hook only owns the UserPromptSubmit-specific
# gating + the stderr formatting.
#
# Suppressed when:
#   * profile=minimal
#   * prompt starts with "/" (user already invoked a specific command)
#   * prompt shorter than 8 chars (noise floor)
#   * env DHPK_DISABLE_SKILL_HINT=1
#   * userConfig.skill_hint_enabled=false
# python3 required to parse the JSON payload; absent → silent skip.
#
# Trigger: UserPromptSubmit event (wired once in hooks/hooks.json).
# Always exits 0; never blocks the prompt.

set -o pipefail

. "$(dirname "$0")/_lib/load-project-config.sh"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PRE_ROUTE="$PLUGIN_ROOT/scripts/lib/pre-route.sh"
PROFILE="${CLAUDE_PLUGIN_OPTION_HOOK_PROFILE:-standard}"

[ "$PROFILE" = "minimal" ] && exit 0
# Two opt-out paths: DHPK_DISABLE_SKILL_HINT=1 for one-shot, userConfig
# skill_hint_enabled=false (loaded as CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED).
[ "${DHPK_DISABLE_SKILL_HINT:-0}" = "1" ] && exit 0
[ "${CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED:-true}" = "false" ] && exit 0
[ -f "$PRE_ROUTE" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

PAYLOAD="$(cat 2>/dev/null || true)"
[ -z "$PAYLOAD" ] && exit 0

# Extract the prompt and apply the noise gates (slash-prefix, <8 chars) in one
# python3 pass. len() counts unicode codepoints so CJK prompts aren't
# mis-measured by byte length. Prints the prompt on success, nothing otherwise.
PROMPT="$(printf '%s' "$PAYLOAD" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
p = d.get("prompt") or d.get("user_prompt") or ""
if not p:
    m = d.get("message")
    if isinstance(m, dict):
        p = m.get("content") or ""
if not isinstance(p, str):
    sys.exit(0)
s = p.strip()
if not s or s.startswith("/") or len(s) < 8:
    sys.exit(0)
print(p)
' 2>/dev/null)"
[ -z "$PROMPT" ] && exit 0

# Delegate the actual pattern match to the shared router.
HINT="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$PRE_ROUTE" "$PROMPT" 2>/dev/null || true)"
case "$HINT" in
    MATCH$'\t'*)
        skill="$(printf '%s' "$HINT" | cut -f2)"
        label="$(printf '%s' "$HINT" | cut -f3)"
        [ -z "$label" ] && label="$skill"
        if [ -n "$skill" ]; then
            echo >&2 "[skill-hint] this prompt looks like a $label task — consider running /$skill"
        fi
        ;;
esac

exit 0
