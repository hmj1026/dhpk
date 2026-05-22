#!/bin/bash
# harness-inventory.sh — deterministic snapshot of the project harness surface.
#
# Emits a single report (text or json via $1) covering:
#   - File counts and line counts under [HARNESS_DIR]/{rules,agents,hooks,skills,commands,scripts}
#   - Main rule file (CLAUDE.md / GEMINI.md) size; auto-loaded rule total
#   - settings.json: schema validity, hook count, deny count, env block, profile
#   - Hook executability matrix
#   - Cross-reference integrity (deleted-file refs, dangling skill mentions)
#
# Usage:
#   bash scripts/harness-inventory.sh [--dir .gemini] [--json]
set -o pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$ROOT" || exit 2

FORMAT="text"
HARNESS_DIR=""
MAIN_RULE=""

# ── Argument Parsing ──────────────────────────────────────────────────────
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --dir) HARNESS_DIR="$2"; shift ;;
        --json) FORMAT="json" ;;
    esac
    shift
done

# ── Auto-Detection ────────────────────────────────────────────────────────
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

if [[ "$HARNESS_DIR" == ".gemini" ]]; then
    MAIN_RULE="GEMINI.md"
elif [[ "$HARNESS_DIR" == ".claude" ]]; then
    MAIN_RULE="CLAUDE.md"
elif [[ "$HARNESS_DIR" == ".codex" ]]; then
    MAIN_RULE=".codex/README.zh-TW.md"
    # Codex might not have hooks/rules in the same structure
fi

# ── Collectors ────────────────────────────────────────────────────────────
count_lines() {
    local pattern="$1"
    local total=0
    while IFS= read -r f; do
        local n
        n=$(wc -l <"$f" 2>/dev/null | tr -d ' ')
        total=$((total + ${n:-0}))
    done < <(find "$pattern" -type f 2>/dev/null)
    echo "$total"
}

file_count() {
    find "$1" -type f 2>/dev/null | wc -l | tr -d ' '
}

# Always-on rule surface
AUTO_MAIN_RULE=$(wc -l <"$MAIN_RULE" 2>/dev/null | tr -d ' ')
AUTO_RULES=$(count_lines "$HARNESS_DIR/rules")
AUTO_MEMORY=0
if [[ -f "$HARNESS_DIR/memory.md" ]]; then
    AUTO_MEMORY=$(wc -l <"$HARNESS_DIR/memory.md" 2>/dev/null | tr -d ' ')
fi
AUTO_TOTAL=$((${AUTO_MAIN_RULE:-0} + ${AUTO_RULES:-0} + ${AUTO_MEMORY:-0}))

AGENTS_FILES=$(file_count "$HARNESS_DIR/agents")
AGENTS_LINES=$(count_lines "$HARNESS_DIR/agents")
HOOKS_FILES=$(file_count "$HARNESS_DIR/hooks")
HOOKS_LINES=$(count_lines "$HARNESS_DIR/hooks")
SKILLS_DIRS=$(find "$HARNESS_DIR/skills" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
COMMANDS_FILES=$(file_count "$HARNESS_DIR/commands")
SCRIPTS_FILES=$(file_count "$HARNESS_DIR/scripts")

# settings.json / config.toml checks
SETTINGS_FILE="$HARNESS_DIR/settings.json"
[[ "$HARNESS_DIR" == ".codex" ]] && SETTINGS_FILE="$HARNESS_DIR/config.toml"

SETTINGS_VALID="no"
if [[ "$SETTINGS_FILE" == *.json ]]; then
    jq . "$SETTINGS_FILE" >/dev/null 2>&1 && SETTINGS_VALID="yes"
    ALLOW_COUNT=$(jq '.permissions.allow | length' "$SETTINGS_FILE" 2>/dev/null)
    DENY_COUNT=$(jq '.permissions.deny | length' "$SETTINGS_FILE" 2>/dev/null)
    HOOK_COUNT=$(jq '[.hooks | to_entries[] | .value[] | .hooks[]?] | length' "$SETTINGS_FILE" 2>/dev/null)
    # dhpk reads hook profile via CLAUDE_PLUGIN_OPTION_HOOK_PROFILE
    # (Claude Code exports each plugin userConfig key with that prefix).
    ENV_PROFILE=$(jq -r '.env.CLAUDE_PLUGIN_OPTION_HOOK_PROFILE // "(missing)"' "$SETTINGS_FILE" 2>/dev/null)
    STOP_ECHO_COUNT=$(jq '[.hooks.Stop[]?.hooks[]?.command | select(startswith("echo"))] | length' "$SETTINGS_FILE" 2>/dev/null)
else
    # TOML basic validation (just check if exists for now)
    [[ -f "$SETTINGS_FILE" ]] && SETTINGS_VALID="yes"
    # Placeholder for TOML parsing if needed
    ALLOW_COUNT="N/A"
    DENY_COUNT="N/A"
    HOOK_COUNT="N/A"
    ENV_PROFILE="N/A"
    STOP_ECHO_COUNT="N/A"
fi

# Hook executability
HOOK_EXEC_LIST=""
EXPECTED_HOOKS=(clear-sentinel.sh post-edit-remind.sh pre-edit-guard.sh pre-bash-guard.sh post-write-crlf-fix.sh session-start.sh stop-review-reminder.sh)
HOOK_EXEC_OK=0
for h in "${EXPECTED_HOOKS[@]}"; do
    if [[ -x "$HARNESS_DIR/hooks/$h" ]]; then
        HOOK_EXEC_LIST+="$h:1 "; HOOK_EXEC_OK=$((HOOK_EXEC_OK+1))
    else
        HOOK_EXEC_LIST+="$h:0 "
    fi
done

# Cross-reference integrity
DELETED_REFS=$(grep -rln 'clear-review-sentinel.sh\|clear-db-review-sentinel.sh\|clear-security-review-sentinel.sh\|rules/skill-policy.md' "$HARNESS_DIR/" "$MAIN_RULE" 2>/dev/null \
    | grep -v "/artifacts/" \
    | grep -v "harness-scenarios.sh" \
    | grep -v "harness-inventory.sh" \
    | wc -l | tr -d ' ')

DANGLING_SKILLS=0
while read -r skill_name; do
    [[ -z "$skill_name" ]] && continue
    [[ -d "$HARNESS_DIR/skills/$skill_name" ]] || DANGLING_SKILLS=$((DANGLING_SKILLS+1))
done < <(grep -rohE 'skill `[a-z][a-z0-9-]+`' "$HARNESS_DIR/rules/" 2>/dev/null | sed -E 's/^skill `//; s/`$//' | sort -u)

# ── Render ────────────────────────────────────────────────────────────────
if [[ "$FORMAT" == "json" ]]; then
    jq -nc \
        --arg harness_dir "$HARNESS_DIR" \
        --arg main_rule "$MAIN_RULE" \
        --argjson auto_total "$AUTO_TOTAL" \
        --argjson auto_main_rule "$AUTO_MAIN_RULE" \
        --argjson auto_rules "$AUTO_RULES" \
        --argjson auto_memory "$AUTO_MEMORY" \
        --argjson agents_files "$AGENTS_FILES" \
        --argjson agents_lines "$AGENTS_LINES" \
        --argjson hooks_files "$HOOKS_FILES" \
        --argjson hooks_lines "$HOOKS_LINES" \
        --argjson skills_dirs "$SKILLS_DIRS" \
        --argjson commands_files "$COMMANDS_FILES" \
        --argjson scripts_files "$SCRIPTS_FILES" \
        --arg settings_valid "$SETTINGS_VALID" \
        --argjson allow_count "${ALLOW_COUNT:-0}" \
        --argjson deny_count "${DENY_COUNT:-0}" \
        --argjson hook_count "${HOOK_COUNT:-0}" \
        --arg env_profile "$ENV_PROFILE" \
        --argjson stop_echo_count "${STOP_ECHO_COUNT:-0}" \
        --argjson hook_exec_ok "$HOOK_EXEC_OK" \
        --argjson hook_exec_total "${#EXPECTED_HOOKS[@]}" \
        --argjson deleted_refs "$DELETED_REFS" \
        --argjson dangling_skills "$DANGLING_SKILLS" \
        '{
          harness: { dir: $harness_dir, main_rule: $main_rule },
          always_on: { total: $auto_total, main_rule: $auto_main_rule, rules: $auto_rules, memory: $auto_memory },
          counts: { agents: $agents_files, agent_lines: $agents_lines, hooks: $hooks_files, hook_lines: $hooks_lines, skills: $skills_dirs, commands: $commands_files, scripts: $scripts_files },
          settings: { valid: $settings_valid, allow: $allow_count, deny: $deny_count, hooks: $hook_count, profile: $env_profile, stop_echo: $stop_echo_count },
          hook_exec: { ok: $hook_exec_ok, total: $hook_exec_total },
          cross_ref: { deleted_refs: $deleted_refs, dangling_skills: $dangling_skills }
        }'
    exit 0
fi

# Text render
cat <<EOF
=== Harness Inventory ($HARNESS_DIR) ===
$(date +'%Y-%m-%d %H:%M:%S %Z')   root=$ROOT

Always-on context (auto-loaded each session):
  $MAIN_RULE          : $AUTO_MAIN_RULE lines
  $HARNESS_DIR/rules/**    : $AUTO_RULES lines
  $HARNESS_DIR/memory.md   : $AUTO_MEMORY lines
  TOTAL               : $AUTO_TOTAL lines

Surface counts:
  agents              : $AGENTS_FILES files / $AGENTS_LINES lines
  hooks               : $HOOKS_FILES files / $HOOKS_LINES lines
  skills              : $SKILLS_DIRS dirs
  commands            : $COMMANDS_FILES files
  scripts             : $SCRIPTS_FILES files

$SETTINGS_FILE:
  valid               : $SETTINGS_VALID
  permissions.allow   : ${ALLOW_COUNT:-?}
  permissions.deny    : ${DENY_COUNT:-?}
  registered hooks    : ${HOOK_COUNT:-?}
  env profile         : $ENV_PROFILE
  cosmetic Stop echos : ${STOP_ECHO_COUNT:-?}  (target: 0)

Hook executability  : $HOOK_EXEC_OK / ${#EXPECTED_HOOKS[@]}
  $HOOK_EXEC_LIST

Cross-reference integrity:
  refs to deleted files : $DELETED_REFS  (target: 0)
  dangling skill mentions: $DANGLING_SKILLS  (target: 0)
EOF
