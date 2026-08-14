#!/bin/bash
# Harness scenario battery — validates the PROJECT-LOCAL hook + settings surface
# after a harness trim/optimization pass. Exit code = FAIL count.
#
# Scope (post-2026-06-12 dhpk cutover): only project-owned assets are tested here.
# Sentinel routing (post-edit-remind), sensitive-path guard (pre-edit-guard),
# CRLF fix (post-write-crlf-fix) and stop reminder (stop-review-reminder) are now
# OWNED BY the dhpk plugin (>=0.10.0) hooks.json and validated by the plugin's own
# contract tests — re-testing them from here would assert plugin internals, so they
# are intentionally out of scope. See memory `harness-dhpk-hook-coexistence`.
#
# Usage: bash scripts/harness-scenarios.sh [--dir .gemini]
set -o pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 2

HARNESS_DIR=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --dir) HARNESS_DIR="$2"; shift ;;
    esac
    shift
done

if [[ -z "$HARNESS_DIR" ]]; then
    _found=()
    [[ -d ".claude" ]] && _found+=(".claude")
    [[ -d ".gemini" ]] && _found+=(".gemini")
    [[ -d ".codex"  ]] && _found+=(".codex")
    if [[ ${#_found[@]} -eq 0 ]]; then
        echo "[error] No harness directory found. Use --dir to specify." >&2; exit 1
    elif [[ ${#_found[@]} -gt 1 ]]; then
        echo "[error] Multiple harness dirs found (${_found[*]}). Use --dir to specify." >&2; exit 1
    fi
    HARNESS_DIR="${_found[0]}"
fi

SESS="$HARNESS_DIR/artifacts/sessions"
mkdir -p "$SESS"
fail=0; pass=0

# Project-local hooks are discovered, not hardcoded: every *.sh under
# $HARNESS_DIR/hooks. Plugin-owned hooks (dhpk hooks.json) live in the plugin,
# not here, so there is no fixed list to assert across projects.
LOCAL_HOOKS=()
while IFS= read -r _hp; do
  [[ -n "$_hp" ]] && LOCAL_HOOKS+=("$(basename "$_hp")")
done < <(find -L "$HARNESS_DIR/hooks" -maxdepth 1 -name '*.sh' -type f 2>/dev/null | sort)

probe_bash() {
  local cmd="$1" label="$2" want_rc="$3"
  local rc=0
  printf '%s' "$cmd" | jq -Rs '{tool_input:{command:.}}' | bash "$HARNESS_DIR/hooks/pre-bash-guard.sh" >/dev/null 2>&1 || rc=$?
  if [[ "$rc" == "$want_rc" ]]; then echo "  PASS $label (rc=$rc)"; pass=$((pass+1)); else echo "  FAIL $label (rc=$rc want=$want_rc)"; fail=$((fail+1)); fi
}

echo "[note] Plugin-owned scenarios (dhpk >=0.10.0, out of project scope):"
echo "       post-edit-remind (sentinel routing), pre-edit-guard (sensitive path),"
echo "       post-write-crlf-fix, stop-review-reminder — validated by dhpk's own tests."

echo ""
if [[ -f "$HARNESS_DIR/hooks/pre-bash-guard.sh" ]]; then
  echo "=== S1 pre-bash-guard (safe cmds allowed; project guard patterns) ==="
  probe_bash "git status" "git allowed" 0
  probe_bash "ls -la" "ls allowed" 0
  # Project-specific block assertions run only if the guard actually targets the
  # pattern (e.g. zdpos blocks php-cs-fixer to force cs-fixer v2 + opcache reset).
  # The path is built piecewise so this script does not self-trigger the guard.
  CSF=$(printf '%s' "vendor" "/" "bin" "/" "php-cs-fixer")
  if grep -q "php-cs-fixer" "$HARNESS_DIR/hooks/pre-bash-guard.sh" 2>/dev/null; then
    probe_bash "$CSF fix --dry-run" "block guarded cs-fixer" 2
    probe_bash "./$CSF fix" "block guarded cs-fixer with ./" 2
    probe_bash "# $CSF fix is an alternative" "comment-only allowed" 0
  fi
else
  echo "=== S1 pre-bash-guard (SKIP: project ships no pre-bash-guard.sh) ==="
fi

echo ""
if [[ -f "$HARNESS_DIR/hooks/clear-sentinel.sh" ]]; then
  echo "=== S2 clear-sentinel.sh lifecycle ==="
  rm -f "$SESS"/.pending-* 2>/dev/null
  echo x > "$SESS/.pending-review"
  out=$(bash "$HARNESS_DIR/hooks/clear-sentinel.sh" .pending-review code-reviewer 2>&1)
  [[ "$out" == *"sentinel cleared"* ]] && { echo "  PASS clear: cleared msg"; pass=$((pass+1)); } || { echo "  FAIL clear: $out"; fail=$((fail+1)); }
  out=$(bash "$HARNESS_DIR/hooks/clear-sentinel.sh" .pending-review code-reviewer 2>&1)
  [[ "$out" == *"already clean"* ]] && { echo "  PASS clear: idempotent msg"; pass=$((pass+1)); } || { echo "  FAIL clear: $out"; fail=$((fail+1)); }
  rc=0; bash "$HARNESS_DIR/hooks/clear-sentinel.sh" 2>/dev/null || rc=$?
  [[ "$rc" != "0" ]] && { echo "  PASS clear: missing-arg errors"; pass=$((pass+1)); } || { echo "  FAIL clear: missing arg didn't error"; fail=$((fail+1)); }
else
  echo "=== S2 clear-sentinel.sh lifecycle (SKIP: hook is plugin-owned, not project-local) ==="
fi

echo ""
echo "=== S3 $HARNESS_DIR/settings.json schema + permissions ==="
SETTINGS_FILE="$HARNESS_DIR/settings.json"
[[ "$HARNESS_DIR" == ".codex" ]] && SETTINGS_FILE="$HARNESS_DIR/config.toml"
if [[ ! -f "$SETTINGS_FILE" ]]; then
    echo "  SKIP $SETTINGS_FILE absent"
elif [[ "$SETTINGS_FILE" == *.json ]]; then
    if jq . "$SETTINGS_FILE" >/dev/null 2>&1; then echo "  PASS $SETTINGS_FILE valid"; pass=$((pass+1)); else echo "  FAIL $SETTINGS_FILE invalid"; fail=$((fail+1)); fi
    deny_count=$(jq '.permissions.deny // [] | length' "$SETTINGS_FILE" 2>/dev/null)
    if [[ "${deny_count:-0}" -ge 1 ]]; then echo "  PASS deny list non-empty ($deny_count)"; pass=$((pass+1)); else echo "  NOTE deny list empty (relying on plugin defaults?)"; fi
else
    echo "  SKIP $SETTINGS_FILE (TOML)"
fi

echo ""
echo "=== S4 cross-reference integrity (no dangling refs) ==="
exclude_self="harness-scenarios.sh|harness-inventory.sh"
dangling=$(grep -rln 'clear-review-sentinel.sh\|clear-db-review-sentinel.sh\|clear-security-review-sentinel.sh' "$HARNESS_DIR/" 2>/dev/null | grep -v "/artifacts/" | grep -vE "$exclude_self" | wc -l | tr -d ' ')
[[ "$dangling" == "0" ]] && { echo "  PASS no live refs to deleted clear-*-sentinel scripts"; pass=$((pass+1)); } || { echo "  FAIL $dangling live refs to deleted scripts"; fail=$((fail+1)); }

echo ""
echo "=== S5 local hook executable bits ==="
for h in "${LOCAL_HOOKS[@]}"; do
  if [[ -x "$HARNESS_DIR/hooks/$h" ]]; then echo "  PASS exec: $h"; pass=$((pass+1)); else echo "  FAIL non-exec: $h"; fail=$((fail+1)); fi
done

echo ""
echo "=== S6 dhpk plugin wiring smoke check (sentinel/guard/lint SSOT) ==="
# The cutover moved review routing to the dhpk plugin. Assert the project still
# declares the plugin as SSOT rather than re-testing the plugin's hooks.
if [[ ! -f "$HARNESS_DIR/dhpk-versions.json" ]]; then
  echo "  SKIP dhpk-versions.json absent (project may not pin a dhpk version)"
elif jq . "$HARNESS_DIR/dhpk-versions.json" >/dev/null 2>&1; then
  echo "  PASS dhpk-versions.json present + valid"; pass=$((pass+1))
else
  echo "  FAIL dhpk-versions.json present but invalid"; fail=$((fail+1))
fi
if [[ -f "$HARNESS_DIR/settings.local.json" ]] && jq -e '.pluginConfigs["dhpk@dhpk"]' "$HARNESS_DIR/settings.local.json" >/dev/null 2>&1; then
  echo "  PASS settings.local.json wires dhpk@dhpk pluginConfigs"; pass=$((pass+1))
else
  echo "  SKIP settings.local.json dhpk pluginConfigs (personal/gitignored config absent)"
fi

echo ""
echo "=================================="
echo "TOTAL: PASS=$pass  FAIL=$fail"
echo "=================================="
exit $fail
