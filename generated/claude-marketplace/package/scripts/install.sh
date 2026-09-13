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
#   4. Dry-run summary, then installs the materialized `minimal` profile for a
#      clean default (or the compatibility root for an explicit module flow).
#
# All knowledge of available modules lives in manifests/module-catalog.json (SSOT).
# Presets in manifests/install-profiles.json remain as fast paths.

set -u

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG="$PLUGIN_ROOT/manifests/module-catalog.json"
PROFILES="$PLUGIN_ROOT/manifests/install-profiles.json"
DOCKER_DOC="$PLUGIN_ROOT/docs/docker-setup.md"
PROFILE_GENERATOR="$PLUGIN_ROOT/scripts/ci/gen-claude-profile-bundles.js"
PROFILE_ID="minimal"
PROFILE_MARKETPLACE="dhpk-profile-minimal"
PROFILE_OUTPUT_ROOT="${DHPK_CLAUDE_PROFILE_OUT:-$PLUGIN_ROOT/generated/claude-profiles/$PROFILE_ID}"
PROFILE_PACKAGE_ROOT="$PROFILE_OUTPUT_ROOT/package"

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

# Keep installer diagnostics stable and free of user-controlled paths or JSON
# values. The details are useful while debugging, but copying a profile path or
# preset value into an error makes the jq-optional path noisy and brittle.
dhpk_install_error() {
  case "$1" in
    profile-extraction)
      echo "[install] ERROR profile-extraction: profile data is invalid; no installation started." >&2
      ;;
    preset-selection)
      echo "[install] ERROR preset-selection: the requested preset is unavailable; no installation started." >&2
      ;;
    module-extraction)
      echo "[install] ERROR module-extraction: preset modules are invalid or unavailable; no installation started." >&2
      ;;
    version-selection)
      echo "[install] ERROR version-selection: no stack version was selected; no installation started." >&2
      ;;
    hook-selection)
      echo "[install] ERROR hook-selection: no hook profile was selected; no installation started." >&2
      ;;
    *)
      echo "[install] ERROR installer-state: unable to resolve installation data; no installation started." >&2
      ;;
  esac
}

# Validate the profile document before presenting any preset prompt. This
# catches malformed JSON and missing/invalid profile/module arrays while there
# are still no install effects.
dhpk_validate_profiles() {
  local profiles_path="$1"
  if [[ $DHPK_PROMPTS_USE_JQ -eq 1 ]]; then
    jq -e '
      (.profiles | type == "object")
      and ((.profiles | length) > 0)
      and all(.profiles[];
        (type == "object")
        and (.modules | type == "array")
        and all(.modules[];
          (type == "string") and (length > 0)
        )
      )
    ' "$profiles_path" >/dev/null 2>&1
    return $?
  fi

  # Python receives the path as argv data. Do not interpolate it or a profile
  # value into Python source code.
  python3 - "$profiles_path" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as profile_file:
        profile_data = json.load(profile_file)
    profiles = profile_data.get("profiles")
    if not isinstance(profiles, dict) or not profiles:
        raise ValueError
    for profile in profiles.values():
        if not isinstance(profile, dict) or not isinstance(profile.get("modules"), list):
            raise ValueError
        for module in profile["modules"]:
            if not isinstance(module, str) or not module:
                raise ValueError
except (OSError, AttributeError, TypeError, ValueError, KeyError, json.JSONDecodeError):
    sys.exit(1)
PY
}

# Validate every module identifier against the catalog only after the profile
# JSON/shape gate has passed. This keeps malformed profiles and unknown modules
# on distinct, stable diagnostics.
dhpk_validate_profile_modules() {
  local profiles_path="$1" catalog_path="$2"
  if [[ $DHPK_PROMPTS_USE_JQ -eq 1 ]]; then
    jq -e --slurpfile catalog "$catalog_path" '
      all(.profiles[]?.modules[]?;
        . as $module
        | any($catalog[0].stacks[]?.versions[]?; .module == $module)
      )
    ' "$profiles_path" >/dev/null 2>&1
    return $?
  fi
  python3 - "$profiles_path" "$catalog_path" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as profile_file:
        profile_data = json.load(profile_file)
    with open(sys.argv[2], encoding="utf-8") as catalog_file:
        catalog_data = json.load(catalog_file)
    available_modules = {
        version.get("module")
        for stack in catalog_data["stacks"]
        for version in stack["versions"]
    }
    for profile in profile_data["profiles"].values():
        for module in profile["modules"]:
            if module not in available_modules:
                raise ValueError
except (OSError, AttributeError, TypeError, ValueError, KeyError, json.JSONDecodeError):
    sys.exit(1)
PY
}

# Print profile identifiers only after the document has passed validation.
dhpk_profile_ids() {
  local profiles_path="$1"
  if [[ $DHPK_PROMPTS_USE_JQ -eq 1 ]]; then
    jq -r '.profiles | keys[]' "$profiles_path"
    return $?
  fi
  python3 - "$profiles_path" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as profile_file:
        profiles = json.load(profile_file)["profiles"]
    for name in profiles:
        print(name)
except (OSError, AttributeError, TypeError, ValueError, KeyError, json.JSONDecodeError):
    sys.exit(1)
PY
}

# Extract one selected profile's modules. The preset name is passed as argv
# data, so shell/Python metacharacters remain opaque JSON values.
dhpk_profile_modules() {
  local profiles_path="$1" preset_name="$2"
  if [[ $DHPK_PROMPTS_USE_JQ -eq 1 ]]; then
    if ! jq -e --arg preset "$preset_name" '
      (.profiles | type == "object")
      and (.profiles[$preset] | type == "object")
      and (.profiles[$preset].modules | type == "array")
      and all(.profiles[$preset].modules[]; (type == "string") and (length > 0))
    ' "$profiles_path" >/dev/null 2>&1; then
      return 1
    fi
    jq -r --arg preset "$preset_name" '.profiles[$preset].modules[]' "$profiles_path"
    return $?
  fi
  python3 - "$profiles_path" "$preset_name" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as profile_file:
        profiles = json.load(profile_file)["profiles"]
    profile = profiles[sys.argv[2]]
    modules = profile["modules"]
    if not isinstance(profile, dict) or not isinstance(modules, list):
        raise ValueError
    if any(not isinstance(module, str) or not module for module in modules):
        raise ValueError
    for module in modules:
        print(module)
except (OSError, AttributeError, TypeError, ValueError, KeyError, json.JSONDecodeError):
    sys.exit(1)
PY
}

# The checked-in profile generator is required for the default materialized
# profile.  Explicit module/preset flows may still use the compatibility
# marketplace route, but a missing generator or Node runtime must never make a
# clean default silently broaden to the root compatibility package.
dhpk_profile_generator_available() {
  [[ -f "$PROFILE_GENERATOR" ]] && command -v node >/dev/null 2>&1
}

# Claude's plugin installer resolves profile packages through a marketplace.
# The profile generator deliberately emits only the physical package, so add a
# small local marketplace wrapper beside it before invoking the client.  The
# wrapper name matches the receipt's consumerPluginId
# (dhpk@dhpk-profile-minimal).
dhpk_write_profile_marketplace() {
  local output_root="$1"
  local marketplace_root="$output_root/.claude-plugin"
  if ! mkdir -p "$marketplace_root"; then
    return 1
  fi
  printf '%s\n' \
    '{' \
    '  "$schema": "https://json.schemastore.org/claude-code-plugin-marketplace.json",' \
    '  "name": "dhpk-profile-minimal",' \
    '  "description": "Materialized dhpk Claude minimal profile.",' \
    '  "owner": {' \
    '    "name": "hmj1026",' \
    '    "url": "https://github.com/hmj1026"' \
    '  },' \
    '  "plugins": [' \
    '    {' \
    '      "name": "dhpk",' \
    '      "source": "./package",' \
    '      "description": "Materialized dhpk Claude minimal profile package."' \
    '    }' \
    '  ]' \
    '}' > "$marketplace_root/marketplace.json"
}

# Materialize and bind the default profile only after the user confirms an
# actual install.  Dry-run stays side-effect free while still showing the
# exact marketplace/install route that would be used.
dhpk_materialize_profile() {
  if ! dhpk_profile_generator_available; then
    return 2
  fi
  if ! node "$PROFILE_GENERATOR" --profile "$PROFILE_ID" --out "$PROFILE_OUTPUT_ROOT" >/dev/null 2>&1; then
    return 1
  fi
  if [[ ! -f "$PROFILE_PACKAGE_ROOT/plugin.json" || ! -f "$PROFILE_PACKAGE_ROOT/bundle-receipt.json" ]]; then
    return 1
  fi
  dhpk_write_profile_marketplace "$PROFILE_OUTPUT_ROOT"
}

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
  if ! dhpk_validate_profiles "$PROFILES"; then
    dhpk_install_error profile-extraction
    exit 1
  fi
  if ! dhpk_validate_profile_modules "$PROFILES" "$CATALOG"; then
    dhpk_install_error module-extraction
    exit 1
  fi
  PROFILE_IDS=()
  if ! profile_ids_output="$(dhpk_profile_ids "$PROFILES")"; then
    dhpk_install_error profile-extraction
    exit 1
  fi
  while IFS= read -r p; do
    [[ -n "$p" ]] && PROFILE_IDS+=("$p")
  done <<<"$profile_ids_output"
  if [[ ${#PROFILE_IDS[@]} -eq 0 ]]; then
    dhpk_install_error profile-extraction
    exit 1
  fi
  if dhpk_yes_no "Use a curated preset from manifests/install-profiles.json?" n; then
    if ! USE_PRESET="$(dhpk_single_select "Pick a preset:" "${PROFILE_IDS[@]}")"; then
      dhpk_install_error preset-selection
      exit 1
    fi
  fi
fi

SELECTED_MODULES=()
DOCKER_CONTAINERS=""
REVIEW_AGENTS=()
HOOK_PROFILE="standard"

if [[ -n "$USE_PRESET" ]]; then
  if ! profile_modules_output="$(dhpk_profile_modules "$PROFILES" "$USE_PRESET")"; then
    dhpk_install_error module-extraction
    exit 1
  fi
  while IFS= read -r m; do
    [[ -n "$m" ]] && SELECTED_MODULES+=("$m")
  done <<<"$profile_modules_output"
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
  # Bash 3.2 with `set -u` treats an explicitly empty array as unset when it
  # is expanded with [@]. Guard the loop so a blank selection remains valid.
  if [[ ${#SELECTED_LABELS[@]} -gt 0 ]]; then
    for label in "${SELECTED_LABELS[@]}"; do
      SELECTED_STACKS+=("${label%% — *}")
    done
  fi

  # ────────────────────────────────────────────────────────────────────
  # 3b. Per-stack version
  # ────────────────────────────────────────────────────────────────────
  if [[ ${#SELECTED_STACKS[@]} -gt 0 ]]; then
    echo
    echo "─── Step 2/4 · Pick a version for each stack ─────────────"
    for sid in "${SELECTED_STACKS[@]}"; do
      VERSIONS=()
      while IFS= read -r v; do VERSIONS+=("$v"); done < <(dhpk_catalog_query ".stacks[] | select(.id==\"$sid\") | .versions[].id")

      # Selection mode: `exclusive` (default — single-version pick) or `additive`
      # (library packages can stack multiple versions for cumulative guidance,
      # e.g. php-7.4 + future php-8.x).
      mode="$(dhpk_catalog_query ".stacks[] | select(.id==\"$sid\") | .selection // \"exclusive\"" 2>/dev/null)"
      [[ -z "$mode" ]] && mode="exclusive"

      CHOSEN_VERSIONS=()
      if [[ "$mode" == "additive" ]]; then
        while IFS= read -r v; do
          [[ -n "$v" ]] && CHOSEN_VERSIONS+=("$v")
        done < <(dhpk_multi_select "Version(s) for $sid (additive — pick one or more):" "${VERSIONS[@]}")
        if [[ ${#CHOSEN_VERSIONS[@]} -eq 0 ]]; then
          echo "  → ($sid: nothing selected; skipping)" >&2
          continue
        fi
        # Enforce per-version `exclusive: true`. An exclusive pick cannot combine
        # with siblings (e.g. php-5.6 forbids 7.0+ syntax; combining with php-7.4
        # would produce contradictory guidance). First exclusive wins; warn the user.
        for cv in "${CHOSEN_VERSIONS[@]}"; do
          excl="$(dhpk_catalog_query ".stacks[] | select(.id==\"$sid\") | .versions[] | select(.id==\"$cv\") | .exclusive // false" 2>/dev/null)"
          if [[ "$excl" == "true" ]] && [[ ${#CHOSEN_VERSIONS[@]} -gt 1 ]]; then
            echo "  → '$sid:$cv' is exclusive; dropping siblings in this stack." >&2
            CHOSEN_VERSIONS=("$cv")
            break
          fi
        done
      else
        if ! chosen="$(dhpk_single_select "Version for $sid:" "${VERSIONS[@]}")"; then
          dhpk_install_error version-selection
          exit 1
        fi
        CHOSEN_VERSIONS=("$chosen")
      fi

      for chosen in "${CHOSEN_VERSIONS[@]}"; do
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
  if dhpk_yes_no "Override default review agent names (code/database/security/frontend/doc)?" n; then
    code_agent="$(dhpk_input "code reviewer agent name"     "code-reviewer")"
    db_agent="$(dhpk_input   "database reviewer agent name" "database-reviewer")"
    sec_agent="$(dhpk_input  "security reviewer agent name" "security-reviewer")"
    fe_agent="$(dhpk_input   "frontend reviewer agent name" "frontend-reviewer")"
    doc_agent="$(dhpk_input  "doc reviewer agent name"      "doc-reviewer")"
    REVIEW_AGENTS=("$code_agent" "$db_agent" "$sec_agent" "$fe_agent" "$doc_agent")
  fi

  PROFILE_IDS=()
  while IFS= read -r p; do PROFILE_IDS+=("$p"); done < <(dhpk_catalog_query '.hook_profiles[].id')
  if ! HOOK_PROFILE="$(dhpk_single_select "Hook profile:" "${PROFILE_IDS[@]}")"; then
    dhpk_install_error hook-selection
    exit 1
  fi
fi

# An empty custom selection is the clean-install default and always targets the
# finite materialized bundle. Profiles with selected stack modules continue
# through the compatibility marketplace route because arbitrary module
# combinations are not profile artifacts. If Node is unavailable, the actual
# install fails closed after confirmation instead of broadening this route.
USE_MATERIALIZED_PROFILE=0
if [[ ${#SELECTED_MODULES[@]} -eq 0 \
  && ( -z "$USE_PRESET" || "$USE_PRESET" == "$PROFILE_ID" ) \
  && -f "$PROFILES" ]]; then
  USE_MATERIALIZED_PROFILE=1
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
if [[ $USE_MATERIALIZED_PROFILE -eq 1 ]]; then
  echo "  claude_profile    : $PROFILE_ID (materialized)"
  echo "  profile_artifact  : $PROFILE_PACKAGE_ROOT"
  echo "  profile_marketplace: $PROFILE_MARKETPLACE"
fi
echo

if [[ $USE_MATERIALIZED_PROFILE -eq 1 ]]; then
  CMD=(claude plugin install dhpk@"$PROFILE_MARKETPLACE")
else
  CMD=(claude plugin install dhpk@dhpk)
fi
if [[ ${#SELECTED_MODULES[@]} -gt 0 ]]; then
  IFS=','; CMD+=(--config "modules=${SELECTED_MODULES[*]}"); IFS=$' \t\n'
fi
if [[ -n "$DOCKER_CONTAINERS" ]]; then
  CMD+=(--config "docker_containers=$DOCKER_CONTAINERS")
fi
if [[ ${#REVIEW_AGENTS[@]} -gt 0 ]]; then
  IFS=','; CMD+=(--config "review_agents=${REVIEW_AGENTS[*]}"); IFS=$' \t\n'
fi
CMD+=(--config "hook_profile=$HOOK_PROFILE")

echo "Command to run:"
if [[ $USE_MATERIALIZED_PROFILE -eq 1 ]]; then
  echo "  claude plugin marketplace add $PROFILE_OUTPUT_ROOT --scope user"
fi
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
  if [[ $USE_MATERIALIZED_PROFILE -eq 1 ]]; then
    echo "(profile materialization deferred — dry-run is side-effect free.)"
  fi
  echo "(--dry-run set — not executing.)"
  exit 0
fi

if ! dhpk_yes_no "Run this now?" y; then
  echo "Aborted."
  exit 130
fi

echo
if [[ $USE_MATERIALIZED_PROFILE -eq 1 ]]; then
  if ! dhpk_profile_generator_available; then
    echo "[install] ERROR profile-materialization: Node.js and the bundled profile generator are required for the default minimal profile; no installation started." >&2
    exit 1
  fi
  if ! dhpk_materialize_profile; then
    echo "[install] ERROR profile-materialization: unable to materialize the default Claude profile; no installation started." >&2
    exit 1
  fi
  if ! claude plugin marketplace add "$PROFILE_OUTPUT_ROOT" --scope user; then
    echo "[install] ERROR profile-marketplace: unable to register the materialized Claude profile; no installation started." >&2
    exit 1
  fi
fi
"${CMD[@]}"
rc=$?

echo
if [[ $rc -eq 0 ]]; then
  echo "✓ Installed. Next steps:"
  echo "    • Inspect install   : claude plugin list --json"
  echo "    • Reconfigure later : /dhpk:setup  (inside Claude Code)"
  if [[ -n "$DOCKER_CONTAINERS" ]]; then
    echo "    • Docker reference  : $DOCKER_DOC"
  fi
else
  echo "✗ 'claude plugin install' exited with status $rc."
fi
exit $rc
