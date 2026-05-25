#!/usr/bin/env bash
# load-project-config.sh — overlay project pluginConfigs onto CLAUDE_PLUGIN_OPTION_* env.
# Source-only — never execute directly. No side effects on sourcing beyond env exports.
#
# Why this exists
# ---------------
# Claude Code injects userConfig into hooks via CLAUDE_PLUGIN_OPTION_* env vars,
# but only resolves the *global* `~/.claude/settings.json` pluginConfigs entry.
# Project-level `.claude/settings.local.json` pluginConfigs are NOT merged into
# the env vars hooks receive. The result is that a developer with multiple
# projects on the same machine (e.g. one Yii 1.1 + one Laravel library) sees
# whichever stack their global config names — even when the project explicitly
# overrides `pluginConfigs.dhpk@dhpk.options.modules`.
#
# This loader closes the gap. It reads the project settings file (local first,
# then non-local fallback) and overrides each CLAUDE_PLUGIN_OPTION_* env var
# that has a corresponding project pluginConfigs key. Keys absent from the
# project override are left alone, so the global value still wins for
# unspecified options (least-surprise: project overrides only what it states).
#
# Precedence — high to low:
#   project pluginConfigs > global pluginConfigs > userConfig defaults
#
# Usage:
#   . "$(dirname "$0")/_lib/load-project-config.sh"
# (Optionally export ROOT first; otherwise the loader uses `git rev-parse` /
# falls back to PWD.)

# Determine project root if not already set by caller.
if [ -z "${ROOT:-}" ]; then
    ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
fi

# Prefer settings.local.json (gitignored, per-developer) over settings.json.
_dhpk_settings=""
if [ -f "$ROOT/.claude/settings.local.json" ]; then
    _dhpk_settings="$ROOT/.claude/settings.local.json"
elif [ -f "$ROOT/.claude/settings.json" ]; then
    _dhpk_settings="$ROOT/.claude/settings.json"
fi

if [ -n "$_dhpk_settings" ] && command -v python3 >/dev/null 2>&1; then
    _dhpk_exports="$(python3 - "$_dhpk_settings" <<'PY' 2>/dev/null
import json, shlex, sys
try:
    with open(sys.argv[1]) as f:
        cfg = json.load(f)
except Exception:
    sys.exit(0)
opts = (
    cfg.get("pluginConfigs", {})
       .get("dhpk@dhpk", {})
       .get("options", {})
)
if not isinstance(opts, dict):
    sys.exit(0)
# Known userConfig keys (mirrors .claude-plugin/plugin.json userConfig).
# Unknown keys are still exported so plugin.json additions Just Work without
# requiring a loader update.
for key, val in opts.items():
    if not isinstance(key, str) or not key.replace("_", "").isalnum():
        continue
    if isinstance(val, list):
        val = ",".join(str(v) for v in val)
    elif isinstance(val, bool):
        val = "true" if val else "false"
    elif val is None:
        continue
    env = "CLAUDE_PLUGIN_OPTION_" + key.upper()
    print(f"export {env}={shlex.quote(str(val))}")
PY
    )"
    if [ -n "$_dhpk_exports" ]; then
        eval "$_dhpk_exports"
    fi
    unset _dhpk_exports
fi
unset _dhpk_settings
