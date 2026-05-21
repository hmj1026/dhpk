#!/usr/bin/env bash
# install.sh — interactive installer for the dhpk Claude Code plugin.
#
# Usage:
#   bash ~/projects/dhpk/scripts/install.sh           # interactive
#   bash ~/projects/dhpk/scripts/install.sh --dry-run # print resolved command, do not execute
#   bash ~/projects/dhpk/scripts/install.sh --print   # alias for --dry-run
#
# Walks the user through:
#   1. Prerequisite check
#   2. Quick preset OR custom flow
#   3. (Custom) stack multi-select → per-stack version → docker → review agents → hook profile
#   4. Dry-run summary, then runs `claude plugin install dhpk@dhpk --plugin-option ...`
#
# All knowledge of available modules lives in manifests/module-catalog.json (SSOT).
# Presets in manifests/install-profiles.json remain as fast paths.

set -u

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG="$PLUGIN_ROOT/manifests/module-catalog.json"
PROFILES="$PLUGIN_ROOT/manifests/install-profiles.json"
DOCKER_DOC="$PLUGIN_ROOT/docs/docker-setup.md"

# shellcheck source=lib/install-prompts.sh
source "$PLUGIN_ROOT/scripts/lib/install-prompts.sh"

DRY_RUN=0
case "${1:-}" in
  --dry-run|--print) DRY_RUN=1 ;;
  -h|--help)
    sed -n '1,18p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  "") ;;
  *)  echo "Unknown flag: $1 (try --help)" >&2; exit 64 ;;
esac

dhpk_prompts_init "$CATALOG" || exit 1

echo
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║          dhpk — Dev Harness Plugin Kit — Interactive Setup       ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo
echo "Plugin root: $PLUGIN_ROOT"
echo

# ──────────────────────────────────────────────────────────────────────
# 1. Prerequisite check
# ──────────────────────────────────────────────────────────────────────
echo "─── Prerequisites ───────────────────────────────────────"
check_cmd() {
  local name="$1" required="$2" reason="$3"
  if command -v "$name" >/dev/null 2>&1; then
    printf '  [✓] %-10s — found\n' "$name"
  else
    if [[ "$required" == "required" ]]; then
      printf '  [✗] %-10s — MISSING (%s) — install before proceeding\n' "$name" "$reason"
      MISSING_REQUIRED=1
    else
      printf '  [·] %-10s — optional (%s)\n' "$name" "$reason"
    fi
  fi
}
MISSING_REQUIRED=0
check_cmd bash    required "hook & helper scripts"
check_cmd git     required "sentinel / artifact path resolution"
check_cmd claude  required "Claude Code CLI — to invoke 'claude plugin install'"
check_cmd python3 optional "module.yaml parser (only if you enable modules)"
check_cmd jq      optional "faster JSON parsing (catalog falls back to python3)"
check_cmd docker  optional "only consulted if you enable docker_containers"
check_cmd gum     optional "nicer interactive UI; falls back to plain shell prompts"
echo
if [[ $MISSING_REQUIRED -ne 0 ]]; then
  echo "✗ Required tools missing — install them and re-run."
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────
# 2. Quick preset or custom?
# ──────────────────────────────────────────────────────────────────────
USE_PRESET=""
if [[ -f "$PROFILES" ]]; then
  if dhpk_yes_no "Use a curated preset from manifests/install-profiles.json?" n; then
    PROFILE_IDS=()
    if [[ $DHPK_PROMPTS_USE_JQ -eq 1 ]]; then
      while IFS= read -r p; do PROFILE_IDS+=("$p"); done < <(jq -r '.profiles | keys[]' "$PROFILES")
    else
      while IFS= read -r p; do PROFILE_IDS+=("$p"); done < <(python3 -c "import json,sys; print('\n'.join(json.load(open('$PROFILES'))['profiles'].keys()))")
    fi
    USE_PRESET="$(dhpk_single_select "Pick a preset:" "${PROFILE_IDS[@]}")"
  fi
fi

SELECTED_MODULES=()
DOCKER_CONTAINERS=""
REVIEW_AGENTS=()
HOOK_PROFILE="standard"

if [[ -n "$USE_PRESET" ]]; then
  if [[ $DHPK_PROMPTS_USE_JQ -eq 1 ]]; then
    while IFS= read -r m; do SELECTED_MODULES+=("$m"); done < <(jq -r ".profiles.\"$USE_PRESET\".modules[]?" "$PROFILES")
  else
    while IFS= read -r m; do SELECTED_MODULES+=("$m"); done < <(python3 -c "import json; print('\n'.join(json.load(open('$PROFILES'))['profiles']['$USE_PRESET'].get('modules', [])))")
  fi
  echo
  echo "Preset '$USE_PRESET' selected. Modules: ${SELECTED_MODULES[*]:-<none>}"
else
  # ────────────────────────────────────────────────────────────────────
  # 3a. Stack multi-select
  # ────────────────────────────────────────────────────────────────────
  STACK_IDS=()
  while IFS= read -r s; do STACK_IDS+=("$s"); done < <(dhpk_catalog_query '.stacks[].id')

  STACK_LABELS=()
  for sid in "${STACK_IDS[@]}"; do
    name="$(dhpk_catalog_query ".stacks[] | select(.id==\"$sid\") | .name")"
    STACK_LABELS+=("$sid — $name")
  done

  echo
  echo "─── Step 1/4 · Select language / framework stacks ────────"
  SELECTED_LABELS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && SELECTED_LABELS+=("$line")
  done < <(dhpk_multi_select "Which stacks do you want to enable? (none = generic core only)" "${STACK_LABELS[@]}")

  SELECTED_STACKS=()
  for label in "${SELECTED_LABELS[@]}"; do
    SELECTED_STACKS+=("${label%% — *}")
  done

  # ────────────────────────────────────────────────────────────────────
  # 3b. Per-stack version
  # ────────────────────────────────────────────────────────────────────
  if [[ ${#SELECTED_STACKS[@]} -gt 0 ]]; then
    echo
    echo "─── Step 2/4 · Pick a version for each stack ─────────────"
    for sid in "${SELECTED_STACKS[@]}"; do
      VERSIONS=()
      while IFS= read -r v; do VERSIONS+=("$v"); done < <(dhpk_catalog_query ".stacks[] | select(.id==\"$sid\") | .versions[].id")
      chosen="$(dhpk_single_select "Version for $sid:" "${VERSIONS[@]}")"
      module="$(dhpk_catalog_query ".stacks[] | select(.id==\"$sid\") | .versions[] | select(.id==\"$chosen\") | .module")"
      SELECTED_MODULES+=("$module")
      # auto-include required module (e.g. yii-1.1 → php-5.6)
      required_module="$(dhpk_catalog_query ".stacks[] | select(.id==\"$sid\") | .versions[] | select(.id==\"$chosen\") | .requires_module // \"\"")"
      if [[ -n "$required_module" ]]; then
        already=0
        for m in "${SELECTED_MODULES[@]}"; do [[ "$m" == "$required_module" ]] && already=1; done
        if [[ $already -eq 0 ]]; then
          echo "  → $module requires $required_module — auto-included."
          SELECTED_MODULES+=("$required_module")
        fi
      fi
    done
  else
    echo
    echo "(No stacks selected — generic core only.)"
  fi

  # ────────────────────────────────────────────────────────────────────
  # 3c. Docker block
  # ────────────────────────────────────────────────────────────────────
  echo
  echo "─── Step 3/4 · Docker integration ────────────────────────"
  dhpk_box \
    "Docker prerequisites" \
    "" \
    "SessionStart uses 'docker ps' to verify containers are running." \
    "Before enabling, please ensure:" \
    "  1. Docker is installed (Docker Desktop or docker-ce)." \
    "  2. docker compose plugin is available ('docker compose version')." \
    "  3. You know your compose service names (the values you'll enter next)." \
    "  4. WSL: enable Docker Desktop's WSL integration. Note that files" \
    "     created in-container as root land on host as root-owned (git trap)." \
    "  5. First container exports as DHPK_PHP_CONTAINER; second as" \
    "     DHPK_MYSQL_CONTAINER (hooks rely on this order)." \
    "" \
    "Full guide: docs/docker-setup.md"

  if dhpk_yes_no "Enable docker container check at SessionStart?" n; then
    DOCKER_CONTAINERS="$(dhpk_input "Container names (comma-separated, e.g. 'php-fpm,mysql')" "")"
  fi

  # ────────────────────────────────────────────────────────────────────
  # 3d. Review agents + hook profile
  # ────────────────────────────────────────────────────────────────────
  echo
  echo "─── Step 4/4 · Review agents & hook profile ──────────────"
  if dhpk_yes_no "Override default review agent names (code/database/security)?" n; then
    code_agent="$(dhpk_input   "code reviewer agent name"     "code-reviewer")"
    db_agent="$(dhpk_input     "database reviewer agent name" "database-reviewer")"
    sec_agent="$(dhpk_input    "security reviewer agent name" "security-reviewer")"
    REVIEW_AGENTS=("$code_agent" "$db_agent" "$sec_agent")
  fi

  PROFILE_IDS=()
  while IFS= read -r p; do PROFILE_IDS+=("$p"); done < <(dhpk_catalog_query '.hook_profiles[].id')
  HOOK_PROFILE="$(dhpk_single_select "Hook profile:" "${PROFILE_IDS[@]}")"
fi

# ──────────────────────────────────────────────────────────────────────
# 4. Dry-run summary
# ──────────────────────────────────────────────────────────────────────
echo
echo "─── Resolved configuration ──────────────────────────────"
echo "  modules           : ${SELECTED_MODULES[*]:-<none>}"
echo "  docker_containers : ${DOCKER_CONTAINERS:-<none>}"
echo "  review_agents     : ${REVIEW_AGENTS[*]:-<defaults>}"
echo "  hook_profile      : $HOOK_PROFILE"
echo

CMD=(claude plugin install dhpk@dhpk)
if [[ ${#SELECTED_MODULES[@]} -gt 0 ]]; then
  IFS=','; CMD+=(--plugin-option "modules=${SELECTED_MODULES[*]}"); IFS=$' \t\n'
fi
if [[ -n "$DOCKER_CONTAINERS" ]]; then
  CMD+=(--plugin-option "docker_containers=$DOCKER_CONTAINERS")
fi
if [[ ${#REVIEW_AGENTS[@]} -gt 0 ]]; then
  IFS=','; CMD+=(--plugin-option "review_agents=${REVIEW_AGENTS[*]}"); IFS=$' \t\n'
fi
CMD+=(--plugin-option "hook_profile=$HOOK_PROFILE")

echo "Command to run:"
printf '  '
for arg in "${CMD[@]}"; do
  if [[ "$arg" == *[!a-zA-Z0-9@_./=:,-]* ]]; then
    printf "'%s' " "$arg"
  else
    printf '%s ' "$arg"
  fi
done
printf '\n\n'

if [[ $DRY_RUN -eq 1 ]]; then
  echo "(--dry-run set — not executing.)"
  exit 0
fi

if ! dhpk_yes_no "Run this now?" y; then
  echo "Aborted."
  exit 130
fi

echo
"${CMD[@]}"
rc=$?

echo
if [[ $rc -eq 0 ]]; then
  echo "✓ Installed. Next steps:"
  echo "    • Validate manifest : claude plugin validate $PLUGIN_ROOT --strict"
  echo "    • Reconfigure later : /dhpk:setup  (inside Claude Code)"
  if [[ -n "$DOCKER_CONTAINERS" ]]; then
    echo "    • Docker reference  : $DOCKER_DOC"
  fi
else
  echo "✗ 'claude plugin install' exited with status $rc."
fi
exit $rc
