#!/usr/bin/env bash
# userpromptsubmit-skill-hint.sh — UserPromptSubmit hook (advisory only)
#
# Reads the incoming user prompt and, when it strongly matches a known
# workflow pattern, injects a one-line additionalContext hint suggesting the
# relevant dhpk command (exit-0 stderr is inert — see _lib/json-out.sh). Helps
# Claude surface workflows without the user memorising all 70 commands.
#
# Matching is delegated to scripts/lib/pre-route.sh (the same matcher behind
# the /dhpk:do Smart Router), so route-table.json stays the single source of
# truth for both surfaces. This hook only owns the UserPromptSubmit-specific
# gating + the stderr formatting.
#
# PERFORMANCE CONTRACT (see docs/hook-extension.md "Hook performance convention"):
#   Cheap pure-bash gates (profile / opt-out, using the CLAUDE_PLUGIN_OPTION_*
#   env Claude Code injects plus the DHPK_* one-shot overrides) run FIRST, before
#   any subprocess. The stdin read is bounded (read -t) so a held-open stdin can't
#   consume the hooks.json timeout. The prompt-shape gates (slash-prefix, <8
#   chars) run in bash after a single jq-preferred extraction, ahead of any
#   python3. Only AFTER those gates — i.e. for a non-trivial, non-opted-out prompt
#   that is actually going to be matched — is load-project-config.sh sourced (it
#   forks python3 only when a project settings file exists) to apply project-level
#   pluginConfigs overrides; the opt-out checks are then re-evaluated against the
#   overlaid values. Net: a trivial or opted-out prompt forks zero python3; the
#   hinting path forks at most one (excluding pre-route.sh's own shared matcher).
#
# Suppressed when:
#   * profile=minimal (env CLAUDE_PLUGIN_OPTION_HOOK_PROFILE / one-shot DHPK_HOOK_PROFILE
#     / project settings.local.json hook_profile)
#   * env DHPK_DISABLE_SKILL_HINT=1
#   * userConfig.skill_hint_enabled=false (CLAUDE_PLUGIN_OPTION_SKILL_HINT_ENABLED,
#     global env or project settings overlay)
#   * prompt starts with "/" (user already invoked a specific command)
#   * prompt shorter than 8 chars (noise floor)
#   * neither jq nor python3 available (cannot parse the JSON payload)
#
# Trigger: UserPromptSubmit event (wired once in hooks/hooks.json, timeout 5s).
# Always exits 0; never blocks the prompt.

set -o pipefail

. "$(dirname "$0")/_lib/json-out.sh"
. "$(dirname "$0")/_lib/runtime-config.sh"

PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
PRE_ROUTE="$PLUGIN_ROOT/scripts/lib/pre-route.sh"

# ---- Pure-bash fast-exit gates (NO subprocess) ----
# DHPK_HOOK_PROFILE is the documented one-shot profile override (mirrors the
# pure-bash mapping load-project-config.sh applies); honour it here so an
# opted-down session exits before any fork.
PROFILE="$(dhpk_config_profile)"
[ "$PROFILE" = "minimal" ] && exit 0
[ "${DHPK_DISABLE_SKILL_HINT:-0}" = "1" ] && exit 0
[ "$(dhpk_config_bool skill_hint_enabled true)" = "false" ] && exit 0
[ -f "$PRE_ROUTE" ] || exit 0

# ---- Bounded stdin read (portable; degrades instead of hanging) ----
# read -d '' consumes all of stdin; -t 3 caps the wait well under the 5s
# hooks.json timeout so a stdin opened-but-not-closed exits here, not there.
# read returns non-zero at EOF (no NUL delimiter seen) — expected; ignore it.
PAYLOAD=""
IFS= read -r -d '' -t 3 PAYLOAD 2>/dev/null
[ -z "$PAYLOAD" ] && exit 0

# ---- Single-subprocess prompt extraction (jq preferred, python3 fallback) ----
# First TRUTHY value among prompt / user_prompt / message.content wins, then only
# if it is a string — mirroring the old python `d.get("prompt") or
# d.get("user_prompt") or message.content` chain followed by its isinstance(str)
# check (so a present-but-non-string .prompt yields no prompt, same as before).
PROMPT=""
if command -v jq >/dev/null 2>&1; then
    PROMPT="$(printf '%s' "$PAYLOAD" | jq -r '[.prompt, .user_prompt, (.message.content?)] | map(select(. != null and . != false and . != "" and . != 0)) | (.[0] // null) | if type == "string" then . else "" end' 2>/dev/null || true)"
elif command -v python3 >/dev/null 2>&1; then
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
if isinstance(p, str):
    sys.stdout.write(p)
' 2>/dev/null || true)"
else
    exit 0
fi
[ -z "$PROMPT" ] && exit 0

# ---- Bash-only prompt-shape gates (slash-prefix, <8 chars) ----
# Trim surrounding whitespace, then apply the same gates the python block used.
_s="${PROMPT#"${PROMPT%%[![:space:]]*}"}"   # ltrim
_s="${_s%"${_s##*[![:space:]]}"}"           # rtrim
[ -z "$_s" ] && exit 0
case "$_s" in /*) exit 0 ;; esac
# ${#_s} counts codepoints under a UTF-8 locale (the normal hook environment),
# matching the old python len(). Under a non-UTF-8 locale it counts bytes, which
# can only OVER-include a short multibyte prompt (never suppress one that should
# hint) — so behaviour parity's "no new false-skips" holds either way.
[ "${#_s}" -lt 8 ] && exit 0

# ---- Project-config overlay (only reached by a real, to-be-matched prompt) ----
# Applies project .claude/settings.local.json pluginConfigs (forks python3 only
# when such a file exists) + the DHPK_HOOK_PROFILE one-shot, then re-checks the
# opt-outs so a project that disabled the hint via settings is still honoured.
. "$(dirname "$0")/_lib/load-project-config.sh"
PROFILE="$(dhpk_config_profile)"
[ "$PROFILE" = "minimal" ] && exit 0
[ "$(dhpk_config_bool skill_hint_enabled true)" = "false" ] && exit 0

# ---- Delegate the actual pattern match to the shared router ----
HINT="$(CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" bash "$PRE_ROUTE" "$PROMPT" 2>/dev/null || true)"
case "$HINT" in
    MATCH$'\t'*)
        skill="$(printf '%s' "$HINT" | cut -f2)"
        label="$(printf '%s' "$HINT" | cut -f3)"
        [ -z "$label" ] && label="$skill"
        if [ -n "$skill" ]; then
            emit_additional_context "UserPromptSubmit" \
                "[skill-hint] This prompt looks like a $label task — the /$skill workflow may fit. Suggest it (or run it) if appropriate."
        fi
        ;;
esac

exit 0
