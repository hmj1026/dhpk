#!/usr/bin/env bash
# payload.sh — shared helpers for dhpk plugin hooks.
# Source-only — never execute directly. No side effects on sourcing.
#
# Constants exported:
#   SENTINEL_NAMES   — fixed sentinel file basenames (matches stop-review-reminder lookup)
#   SENTINEL_LABELS  — short human labels per slot (used in stdout/stderr)
#   SENTINEL_AGENTS  — agent invocation names per slot, derived from
#                      CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS env var (Claude Code
#                      exports each userConfig key). Falls back to plugin defaults.
#
# Helpers exported:
#   extract_tool_input <field> "<payload>"
#       — Pulls tool_input.<field> from a Claude Code PreToolUse/PostToolUse
#         JSON payload. Prefers jq; falls back to python3 when jq is missing.
#         Returns empty string on any error (callers MUST handle empty).

# Review sentinel SSOT — slots in fixed order:
#   0 code → 1 db → 2 sec → 3 frontend → 4 doc → 5 polyfill → 6 migration
#
# SENTINEL LINE FORMAT (de-facto protocol — writers and readers MUST agree):
#   "<meta1> <meta2> <relative-path>"   → the path starts at whitespace FIELD 3.
#   Writers: post-edit-remind.sh emits "YYYY-MM-DD HH:MM:SS <path>" (date+time =
#   2 tokens); polyfill-sentinel emits "<epoch> <tool> <path>". Both keep exactly
#   two leading metadata tokens so the path lands on field 3.
#   Readers: pre-bash-guard.sh uses `cut -d' ' -f3-`; stop-review-reminder.sh uses
#   `awk 'NF>=3 {print $3}'`. A writer that changes the leading-token count breaks
#   both readers — keep new writers to two leading tokens.
#
# Adding/removing a slot means extending all four arrays together. Hooks that
# iterate SENTINEL_NAMES (clear-sentinel, reap-stale-sentinels, pre-bash-guard
# push-block, stop-review-reminder) extend automatically as long as the arrays
# stay aligned. SENTINEL_SHORT_NAMES carries compact per-slot labels for
# space-constrained consumers (statuslines etc.).
SENTINEL_NAMES=(".pending-review" ".pending-db-review" ".pending-security-review" ".pending-frontend-review" ".pending-doc-review" ".pending-polyfill-review" ".pending-migration-review")
SENTINEL_LABELS=("code-reviewer" "database-reviewer" "security-reviewer" "frontend-reviewer" "doc-reviewer" "polyfill-reviewer" "migration-reviewer")
SENTINEL_SHORT_NAMES=("code" "db" "sec" "fe" "doc" "poly" "mig")

# Provenance sidecar (D4.3): records "<sentinel-basename> TAB <rel-path> TAB
# <provenance>" per armed sentinel path, WITHOUT touching the field-3 line format
# above — so the clear-sentinel / stop-review-reminder / pre-bash-guard readers are
# unaffected. Its name does NOT match `.pending-*`, so it is invisible to the
# opsx `ls .pending-*` gate and to reap-stale-sentinels' stray scan.
SENTINEL_PROVENANCE_FILE=".sentinel-provenance"

# Default agent names — overridable via userConfig.review_agents (comma-joined).
_dhpk_default_agents=("code-reviewer" "database-reviewer" "security-reviewer" "frontend-reviewer" "doc-reviewer" "polyfill-reviewer" "migration-reviewer")
if [ -n "${CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS:-}" ]; then
    IFS=',' read -r -a SENTINEL_AGENTS <<< "${CLAUDE_PLUGIN_OPTION_REVIEW_AGENTS}"
else
    SENTINEL_AGENTS=("${_dhpk_default_agents[@]}")
fi

# Pad shorter override with defaults so downstream array indexing stays safe.
while [ ${#SENTINEL_AGENTS[@]} -lt ${#_dhpk_default_agents[@]} ]; do
    SENTINEL_AGENTS+=("${_dhpk_default_agents[${#SENTINEL_AGENTS[@]}]}")
done
unset _dhpk_default_agents

# Runtime drift guard: the four arrays MUST stay aligned (same slot count).
# payload.sh is sourced (often by Stop hooks that must never die mid-read), so
# fail soft: warn loudly and truncate to the shortest length instead of exiting.
_dhpk_min_len=${#SENTINEL_NAMES[@]}
[ ${#SENTINEL_LABELS[@]} -lt "$_dhpk_min_len" ] && _dhpk_min_len=${#SENTINEL_LABELS[@]}
[ ${#SENTINEL_AGENTS[@]} -lt "$_dhpk_min_len" ] && _dhpk_min_len=${#SENTINEL_AGENTS[@]}
[ ${#SENTINEL_SHORT_NAMES[@]} -lt "$_dhpk_min_len" ] && _dhpk_min_len=${#SENTINEL_SHORT_NAMES[@]}
if [ ${#SENTINEL_NAMES[@]} -ne "$_dhpk_min_len" ] || [ ${#SENTINEL_LABELS[@]} -ne "$_dhpk_min_len" ] || [ ${#SENTINEL_AGENTS[@]} -ne "$_dhpk_min_len" ] || [ ${#SENTINEL_SHORT_NAMES[@]} -ne "$_dhpk_min_len" ]; then
    echo "[payload] WARN: sentinel array length drift (names=${#SENTINEL_NAMES[@]} labels=${#SENTINEL_LABELS[@]} agents=${#SENTINEL_AGENTS[@]} short=${#SENTINEL_SHORT_NAMES[@]}) — truncating to $_dhpk_min_len. Fix _lib/payload.sh / review_agents override." >&2
    SENTINEL_NAMES=("${SENTINEL_NAMES[@]:0:$_dhpk_min_len}")
    SENTINEL_LABELS=("${SENTINEL_LABELS[@]:0:$_dhpk_min_len}")
    SENTINEL_AGENTS=("${SENTINEL_AGENTS[@]:0:$_dhpk_min_len}")
    SENTINEL_SHORT_NAMES=("${SENTINEL_SHORT_NAMES[@]:0:$_dhpk_min_len}")
fi
unset _dhpk_min_len

extract_tool_input() {
    local field="$1" payload="$2" out=""
    [ -z "$payload" ] && return 0
    # Both jq and python3 fallbacks tolerate errors — sourcing hooks may use
    # set -euo pipefail, so any non-zero must be swallowed here.
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r ".tool_input.${field} // empty" 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | FIELD="$field" python3 -c '
import sys, os, json
try:
    d = json.load(sys.stdin)
    print(d.get("tool_input", {}).get(os.environ.get("FIELD", ""), ""))
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    printf '%s' "$out"
    return 0
}

# extract_top_field <field> "<payload>"
#   Pulls a TOP-LEVEL <field> from a Claude Code hook JSON payload (e.g. the
#   Stop hook's stop_hook_active flag). Same error-swallowing contract as
#   extract_tool_input: returns empty string on any error (callers MUST handle
#   empty). Prefers jq; falls back to python3 when jq is missing.
#   NOTE: boolean false collapses to "" (same as absent/null), because both the
#         jq `// empty` operator and the python3 fallback treat false as empty.
#         Only use for fields where false and absent are equivalent (e.g.
#         stop_hook_active); do NOT use where false is a meaningful value.
extract_top_field() {
    local field="$1" payload="$2" out=""
    [ -z "$payload" ] && return 0
    if command -v jq >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | jq -r ".${field} // empty" 2>/dev/null || true)"
    fi
    if [ -z "$out" ] && command -v python3 >/dev/null 2>&1; then
        out="$(printf '%s' "$payload" | FIELD="$field" python3 -c '
import sys, os, json
try:
    d = json.load(sys.stdin)
    v = d.get(os.environ.get("FIELD", ""), "")
    print("true" if v is True else ("" if v is False or v is None else v))
except Exception:
    pass
' 2>/dev/null || true)"
    fi
    printf '%s' "$out"
    return 0
}
