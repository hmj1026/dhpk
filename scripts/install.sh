#!/usr/bin/env bash
# install.sh — interactive installer for the dhpk Claude Code plugin.
#
# Usage:
#   bash ~/projects/dhpk/scripts/install.sh           # interactive
#   bash ~/projects/dhpk/scripts/install.sh --dry-run # print resolved command, do not execute
#   bash ~/projects/dhpk/scripts/install.sh --print   # alias for --dry-run
#   bash ~/projects/dhpk/scripts/install.sh --dry-run --non-interactive
#                                  # no prompts: existing main Claude marketplace; hook profile defaults to standard
#   bash ~/projects/dhpk/scripts/install.sh --non-interactive --yes
#                                  # no prompts and auto-confirm "Run this now?"
#   --non-interactive   skip every prompt (no preset, stack, docker, or review-agent choice)
#   --yes               auto-confirm "Run this now?" only; required to install with --non-interactive
#   --hook-profile <id> hook profile: minimal | standard | strict (default: standard);
#                       also accepted as --hook-profile=<id>
#   -h, --help          show this help
#
# Walks the user through:
#   1. Prerequisite check
#   2. Quick preset OR custom flow
#   3. (Custom) stack multi-select → per-stack version → docker → review agents → hook profile
#   4. Dry-run summary, then installs the existing main `dhpk@dhpk` package with
#      any selected module configuration.
#
# All knowledge of available modules lives in manifests/module-catalog.json (SSOT).
# Language/module presets in manifests/install-profiles.json remain as fast paths;
# `common` is the main marketplace default rather than a selectable preset.

set -u

PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CATALOG="$PLUGIN_ROOT/manifests/module-catalog.json"
PROFILES="$PLUGIN_ROOT/manifests/install-profiles.json"

# shellcheck source=lib/install-prompts.sh
source "$PLUGIN_ROOT/scripts/lib/install-prompts.sh"

DRY_RUN=0
NON_INTERACTIVE=0
ASSUME_YES=0
HOOK_PROFILE_ARG=""
HOOK_PROFILE_SET=0
HIST_HELP=0
HIST_ACTION="install"
HIST_SCOPE="user"
HIST_VERDICT="BLOCKED"
HIST_REASON=""
HIST_BEFORE_VERSION=""
HIST_BEFORE_STATE="absent"
HIST_AFTER_VERSION=""
HIST_AFTER_STATE="absent"

dhpk_record_install_history() {
  local rc="$1"
  [ "$HIST_HELP" -eq 1 ] && return 0
  case "${DHPK_NO_INSTALL_HISTORY:-}" in 1|true|TRUE|True) return 0 ;; esac
  case "${DHPK_INSTALL_HISTORY_DELEGATED:-}" in 1|true|TRUE|True) return 0 ;; esac
  if command -v python3 >/dev/null 2>&1; then
    python3 -I -S - "$rc" "$HIST_ACTION" "$HIST_SCOPE" "$HIST_VERDICT" "$HIST_REASON" "$PLUGIN_ROOT" "$HIST_BEFORE_VERSION" "$HIST_BEFORE_STATE" "$HIST_AFTER_VERSION" "$HIST_AFTER_STATE" <<'PY' || true
import json
import os
import re
import sys
import time

try:
    import pwd
except Exception:
    pwd = None

def read_source_version(root):
    for rel, key in (('.claude-plugin/plugin.json', 'version'), ('package.json', 'version')):
        p = os.path.join(root, rel)
        try:
            if os.path.islink(p) or not os.path.isfile(p):
                continue
            with open(p, 'r', encoding='utf-8') as f:
                val = json.load(f).get(key)
            if isinstance(val, str) and val.strip():
                return val.strip()
        except Exception:
            pass
    return None

def sanitize_text(val, max_len=200, redact_user=True):
    if val is None:
        return None
    text = str(val)
    text = re.sub(r'\b((?:https?|postgres(?:ql)?|mysql|mariadb|redis|mongodb(?:\+srv)?):\/\/)[^\s/@:]+:[^\s/@]+@', r'\1<redacted>@', text, flags=re.I)
    text = re.sub(r'\b(authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+[^\r\n,;]+', r'\1: <redacted>', text, flags=re.I)
    text = re.sub(r'\b(bearer|basic)\s+[^\s,;\r\n]+', r'\1 <redacted>', text, flags=re.I)
    text = re.sub(r'(["\']?)(authorization|proxy-authorization|token|access[_-]?token|refresh[_-]?token|oauth[_-]?token|id[_-]?token|session[_-]?token|password|secret|api[_-]?key|credential|(?:set-)?cookie)\1\s*[:=]\s*(?:"[^"\r\n]*"|\'[^\'\r\n]*\'|[^\s,;}\]]+)', r'\2: <redacted>', text, flags=re.I)
    text = re.sub(r'\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b', '<redacted-token>', text)
    for k in ('HOME', 'USERPROFILE'):
        h = os.environ.get(k, '').strip()
        if h and h != '/':
            for cand in (os.path.abspath(h), os.path.realpath(h)):
                text = text.replace(cand, '<home>')
    text = re.sub(r'(/(?:Users|home)/)[^/\s"\'`,;)}\]]+', r'\1<redacted>', text)
    text = re.sub(r'([A-Za-z]:[\\/]Users[\\/])[^\\/\s"\'`,;)}\]]+', r'\1<redacted>', text)
    if redact_user:
        users = set()
        for k in ('USER', 'LOGNAME', 'USERNAME'):
            u = os.environ.get(k, '').strip()
            if u:
                users.add(u)
        if pwd is not None:
            try:
                users.add(pwd.getpwuid(os.getuid()).pw_name)
            except Exception:
                pass
        safe = {'user', 'local', 'project', 'install', 'update', 'plan', 'claude', 'unknown'}
        for u in sorted(users, key=len, reverse=True):
            if len(u) >= 2 and u.lower() not in safe:
                text = re.sub(r'(?<![A-Za-z0-9])' + re.escape(u) + r'(?![A-Za-z0-9])', '<user>', text)
    return text[:max_len]

def resolve_history_file():
    override = os.environ.get('DHPK_INSTALL_HISTORY_FILE', '').strip()
    if override:
        return os.path.abspath(override)
    xdg = os.environ.get('XDG_STATE_HOME', '').strip()
    if xdg:
        return os.path.join(os.path.abspath(xdg), 'dhpk', 'install-history.jsonl')
    home = os.environ.get('HOME', '').strip() or os.environ.get('USERPROFILE', '').strip() or os.path.expanduser('~')
    return os.path.join(os.path.abspath(home), '.local', 'state', 'dhpk', 'install-history.jsonl')

try:
    exit_code = int(sys.argv[1])
    action = sys.argv[2] or 'install'
    scope = sys.argv[3] or 'user'
    verdict = sys.argv[4] or 'BLOCKED'
    reason = sys.argv[5].strip()
    plugin_root = sys.argv[6]
    before_ver = sys.argv[7].strip() or None
    before_state = sys.argv[8].strip() or ('present' if before_ver else 'absent')
    after_ver = sys.argv[9].strip() or None
    after_state = sys.argv[10].strip() or ('present' if after_ver else 'absent')
    src_ver = read_source_version(plugin_root)
    if exit_code == 0 and action in ('install', 'update') and after_ver is None:
        after_ver = src_ver
        after_state = 'current'
    record = {
        'schema': 'dhpk.install-history.v1',
        'timestamp': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'surface': 'claude',
        'action': action,
        'scope': scope,
        'sourceVersion': sanitize_text(src_ver, 64),
        'projectId': None,
        'exitCode': exit_code,
        'verdict': verdict,
        'reasonCodes': [sanitize_text(reason, 96)] if reason else [],
        'versions': {
            'before': {'version': sanitize_text(before_ver, 64), 'state': before_state},
            'after': {'version': sanitize_text(after_ver, 64), 'state': after_state},
        },
    }
    history_file = resolve_history_file()
    os.makedirs(os.path.dirname(history_file), mode=0o700, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(history_file, flags, 0o600)
    try:
        os.write(fd, (json.dumps(record, separators=(',', ':')) + '\n').encode('utf-8'))
    finally:
        os.close(fd)
except Exception as err:
    print('[install] warning: failed to append install history: {}'.format(sanitize_text(err, 200)), file=sys.stderr)
PY
  elif command -v node >/dev/null 2>&1; then
    DHPK_HIST_RC="$rc" DHPK_HIST_ACTION="$HIST_ACTION" DHPK_HIST_SCOPE="$HIST_SCOPE" DHPK_HIST_VERDICT="$HIST_VERDICT" DHPK_HIST_REASON="$HIST_REASON" DHPK_HIST_ROOT="$PLUGIN_ROOT" DHPK_HIST_BV="$HIST_BEFORE_VERSION" DHPK_HIST_BS="$HIST_BEFORE_STATE" DHPK_HIST_AV="$HIST_AFTER_VERSION" DHPK_HIST_AS="$HIST_AFTER_STATE" node -e '
      const path = require("node:path");
      const h = require(path.join(process.env.DHPK_HIST_ROOT, "scripts/lib/install-history"));
      const srcVer = h.readPackageSourceVersion(process.env.DHPK_HIST_ROOT);
      const rc = Number(process.env.DHPK_HIST_RC || 0);
      const action = process.env.DHPK_HIST_ACTION || "install";
      const av = process.env.DHPK_HIST_AV || (rc === 0 && (action === "install" || action === "update") ? srcVer : null);
      const as = process.env.DHPK_HIST_AS || (rc === 0 && (action === "install" || action === "update") ? "current" : "absent");
      h.appendInstallHistory({
        surface: "claude",
        action,
        scope: process.env.DHPK_HIST_SCOPE || "user",
        sourceVersion: srcVer,
        projectRoot: null,
        exitCode: rc,
        verdict: process.env.DHPK_HIST_VERDICT || "BLOCKED",
        reasonCodes: process.env.DHPK_HIST_REASON ? [process.env.DHPK_HIST_REASON] : [],
        beforeVersion: { version: process.env.DHPK_HIST_BV || null, state: process.env.DHPK_HIST_BS || "absent" },
        afterVersion: { version: av, state: as },
      });
    ' 2>/dev/null || true
  fi
}

dhpk_install_on_exit() {
  local rc=$?
  dhpk_record_install_history "$rc" || true
  exit "$rc"
}
trap dhpk_install_on_exit EXIT

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run|--print) DRY_RUN=1; HIST_ACTION="plan"; shift ;;
    -h|--help)
      HIST_HELP=1
      sed -n '1,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    --non-interactive) NON_INTERACTIVE=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    --profile|--profile=*)
      echo "[install] --profile has been retired; fresh installs use the common collection" >&2
      HIST_REASON="RETIRED_PROFILE"
      exit 64
      ;;
    --hook-profile)
      if [[ $# -lt 2 || "$2" == --* || -z "$2" ]]; then
        echo "[install] ERROR hook-profile: --hook-profile requires a profile id (minimal|standard|strict); no installation started." >&2
        HIST_REASON="INVALID_ARGUMENT"
        exit 64
      fi
      HOOK_PROFILE_ARG="$2"; HOOK_PROFILE_SET=1; shift 2
      ;;
    --hook-profile=*)
      if [[ -z "${1#--hook-profile=}" || "${1#--hook-profile=}" == --* ]]; then
        echo "[install] ERROR hook-profile: --hook-profile requires a profile id (minimal|standard|strict); no installation started." >&2
        HIST_REASON="INVALID_ARGUMENT"
        exit 64
      fi
      HOOK_PROFILE_ARG="${1#--hook-profile=}"; HOOK_PROFILE_SET=1; shift
      ;;
    *)  echo "Unknown flag: $1 (try --help)" >&2; HIST_REASON="INVALID_ARGUMENT"; exit 64 ;;
  esac
done

dhpk_prompts_init "$CATALOG" || { HIST_REASON="CATALOG_UNAVAILABLE"; exit 1; }

# Validate --hook-profile against the catalog. The raw value is never echoed.
if [[ $HOOK_PROFILE_SET -eq 1 ]]; then
  if [[ "$HOOK_PROFILE_ARG" == *$'\n'* ]] \
    || ! dhpk_catalog_query '.hook_profiles[].id' | grep -Fxq -- "$HOOK_PROFILE_ARG"; then
    echo "[install] ERROR hook-profile: unknown hook profile id (expected one of the catalog hook_profiles); no installation started." >&2
    HIST_REASON="INVALID_HOOK_PROFILE"
    exit 64
  fi
fi

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
    jq -r '.profiles | keys[] | select(. != "common")' "$profiles_path"
    return $?
  fi
  python3 - "$profiles_path" <<'PY'
import json
import sys

try:
    with open(sys.argv[1], encoding="utf-8") as profile_file:
        profiles = json.load(profile_file)["profiles"]
    for name in profiles:
        if name == "common":
            continue
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
check_cmd gum     optional "nicer interactive UI; falls back to plain shell prompts"
echo
if [[ $MISSING_REQUIRED -ne 0 ]]; then
  echo "✗ Required tools missing — install them and re-run."
  HIST_REASON="MISSING_PREREQUISITE"
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────
# 2. Quick preset or custom?
# ──────────────────────────────────────────────────────────────────────
USE_PRESET=""
if [[ -f "$PROFILES" ]]; then
  if ! dhpk_validate_profiles "$PROFILES"; then
    dhpk_install_error profile-extraction
    HIST_REASON="PROFILE_EXTRACTION_FAILED"
    exit 1
  fi
  if ! dhpk_validate_profile_modules "$PROFILES" "$CATALOG"; then
    dhpk_install_error module-extraction
    HIST_REASON="MODULE_EXTRACTION_FAILED"
    exit 1
  fi
  PROFILE_IDS=()
  if ! profile_ids_output="$(dhpk_profile_ids "$PROFILES")"; then
    dhpk_install_error profile-extraction
    HIST_REASON="PROFILE_EXTRACTION_FAILED"
    exit 1
  fi
  while IFS= read -r p; do
    [[ -n "$p" ]] && PROFILE_IDS+=("$p")
  done <<<"$profile_ids_output"
  if [[ ${#PROFILE_IDS[@]} -eq 0 ]]; then
    dhpk_install_error profile-extraction
    HIST_REASON="PROFILE_EXTRACTION_FAILED"
    exit 1
  fi
  if [[ $NON_INTERACTIVE -eq 0 ]] && dhpk_yes_no "Use a curated preset from manifests/install-profiles.json?" n; then
    if ! USE_PRESET="$(dhpk_single_select "Pick a preset:" "${PROFILE_IDS[@]}")"; then
      dhpk_install_error preset-selection
      HIST_REASON="PRESET_SELECTION_FAILED"
      exit 1
    fi
  fi
fi

SELECTED_MODULES=()
REVIEW_AGENTS=()
HOOK_PROFILE="standard"
[[ $HOOK_PROFILE_SET -eq 1 ]] && HOOK_PROFILE="$HOOK_PROFILE_ARG"

if [[ -n "$USE_PRESET" ]]; then
  if ! profile_modules_output="$(dhpk_profile_modules "$PROFILES" "$USE_PRESET")"; then
    dhpk_install_error module-extraction
    HIST_REASON="MODULE_EXTRACTION_FAILED"
    exit 1
  fi
  while IFS= read -r m; do
    [[ -n "$m" ]] && SELECTED_MODULES+=("$m")
  done <<<"$profile_modules_output"
  echo
  echo "Preset '$USE_PRESET' selected. Modules: ${SELECTED_MODULES[*]:-<none>}"
elif [[ $NON_INTERACTIVE -eq 1 ]]; then
  echo
  echo "(--non-interactive: no stacks, docker, or review-agent overrides.)"
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
  echo "─── Step 1/3 · Select language / framework stacks ────────"
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
    echo "─── Step 2/3 · Pick a version for each stack ─────────────"
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
          HIST_REASON="VERSION_SELECTION_FAILED"
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
  # 3c. Review agents + hook profile
  # ────────────────────────────────────────────────────────────────────
  echo
  echo "─── Step 3/3 · Review agents & hook profile ──────────────"
  if dhpk_yes_no "Override default review agent names (code/database/security/frontend/doc)?" n; then
    code_agent="$(dhpk_input "code reviewer agent name"     "code-reviewer")"
    db_agent="$(dhpk_input   "database reviewer agent name" "database-reviewer")"
    sec_agent="$(dhpk_input  "security reviewer agent name" "security-reviewer")"
    fe_agent="$(dhpk_input   "frontend reviewer agent name" "frontend-reviewer")"
    doc_agent="$(dhpk_input  "doc reviewer agent name"      "doc-reviewer")"
    REVIEW_AGENTS=("$code_agent" "$db_agent" "$sec_agent" "$fe_agent" "$doc_agent")
  fi

  if [[ $HOOK_PROFILE_SET -eq 0 ]]; then
    PROFILE_IDS=()
    while IFS= read -r p; do PROFILE_IDS+=("$p"); done < <(dhpk_catalog_query '.hook_profiles[].id')
    if ! HOOK_PROFILE="$(dhpk_single_select "Hook profile:" "${PROFILE_IDS[@]}")"; then
      dhpk_install_error hook-selection
      HIST_REASON="HOOK_SELECTION_FAILED"
      exit 1
    fi
  fi
fi

# ──────────────────────────────────────────────────────────────────────
# 4. Dry-run summary
# ──────────────────────────────────────────────────────────────────────
echo
echo "─── Resolved configuration ──────────────────────────────"
echo "  modules           : ${SELECTED_MODULES[*]:-<none>}"
echo "  review_agents     : ${REVIEW_AGENTS[*]:-<defaults>}"
echo "  hook_profile      : $HOOK_PROFILE"
echo "  claude_plugin     : dhpk@dhpk (main marketplace)"
echo

CMD=(claude plugin install dhpk@dhpk)
if [[ ${#SELECTED_MODULES[@]} -gt 0 ]]; then
  IFS=','; CMD+=(--config "modules=${SELECTED_MODULES[*]}"); IFS=$' \t\n'
fi
if [[ ${#REVIEW_AGENTS[@]} -gt 0 ]]; then
  IFS=','; CMD+=(--config "review_agents=${REVIEW_AGENTS[*]}"); IFS=$' \t\n'
fi
CMD+=(--config "hook_profile=$HOOK_PROFILE")

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
  HIST_VERDICT="NOT_RUN"
  exit 0
fi

if [[ $NON_INTERACTIVE -eq 1 && $ASSUME_YES -eq 0 ]]; then
  echo "[install] --non-interactive cannot confirm the install; re-run with --yes (or use --dry-run). No installation started." >&2
  HIST_REASON="CONFIRMATION_REQUIRED"
  exit 64
fi
if [[ $ASSUME_YES -eq 0 ]] && ! dhpk_yes_no "Run this now?" y; then
  echo "Aborted."
  HIST_VERDICT="NOT_RUN"
  HIST_REASON="USER_ABORTED"
  exit 130
fi

# `claude plugin install` exits 0 when dhpk@dhpk is already installed and does
# not upgrade it. Update only the scope that install would have used, and
# forward --config only when `claude plugin update` accepts it.
dhpk_help_accepts_option() {
  local help="$1" option="$2" re
  case "$option" in
    --scope) re='(^|[[:space:]])--scope([[:space:]]|$)' ;;
    --config) re='(^|[[:space:]])--config([[:space:]]|$)' ;;
    --yes) re='(^|[[:space:]])--yes([[:space:]]|,|$)' ;;
    -y) re='(^|[[:space:]])-y([[:space:]]|,|$)' ;;
    *) return 1 ;;
  esac
  [[ "$help" =~ $re ]]
}

dhpk_install_target_scope() {
  local i arg help flat scope_re
  for ((i = 0; i < ${#CMD[@]}; i++)); do
    arg="${CMD[$i]}"
    if [[ "$arg" == "--scope" || "$arg" == "-s" ]]; then
      printf '%s' "${CMD[i+1]:-}"
      return 0
    fi
    if [[ "$arg" == --scope=* ]]; then
      printf '%s' "${arg#--scope=}"
      return 0
    fi
  done
  help="$(claude plugin install --help 2>&1 || true)"
  flat="${help//$'\n'/ }"
  scope_re='--scope[^)]{0,220}\(default:[[:space:]]*"?(user|project|local|managed)"?\)'
  if [[ "$flat" =~ $scope_re ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  printf 'user'
}

dhpk_plugin_installed_for_scope() {
  local scope="$1" json
  [[ "$scope" == user || "$scope" == project || "$scope" == local || "$scope" == managed ]] || return 1
  json="$(claude plugin list --json 2>/dev/null || true)"
  [[ -n "${json//[[:space:]]/}" ]] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  python3 - "$scope" "$json" <<'PY'
import json
import sys

scope, raw = sys.argv[1], sys.argv[2]
target = "dhpk@dhpk"
try:
    data = json.loads(raw)
except (TypeError, ValueError):
    sys.exit(1)
if isinstance(data, dict):
    data = data.get("plugins") or data.get("items") or []
if not isinstance(data, list):
    sys.exit(1)
for item in data:
    if not isinstance(item, dict):
        continue
    identity = item.get("id") or item.get("name")
    if identity != target:
        continue
    item_scope = item.get("scope")
    if item_scope is None or item_scope == scope:
        sys.exit(0)
sys.exit(1)
PY
}

dhpk_output_says_already_installed() {
  local lower
  [[ "$1" == *"dhpk@dhpk"* ]] || return 1
  lower="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  [[ "$lower" == *"already installed"* ]]
}

dhpk_print_installed() {
  echo
  echo "✓ Installed. Next steps:"
  echo "    • Inspect install   : claude plugin list --json"
  echo "    • Reconfigure later : /dhpk:harness-setup  (inside Claude Code)"
}

dhpk_run_plugin_update() {
  local scope="$1" help i
  local -a update_cmd
  help="$(claude plugin update --help 2>&1 || true)"
  update_cmd=(claude plugin update dhpk@dhpk)
  if dhpk_help_accepts_option "$help" --scope \
    && [[ "$scope" == user || "$scope" == project || "$scope" == local || "$scope" == managed ]]; then
    update_cmd+=(--scope "$scope")
  fi
  if dhpk_help_accepts_option "$help" --config; then
    for ((i = 0; i < ${#CMD[@]}; i++)); do
      if [[ "${CMD[$i]}" == "--config" && $((i + 1)) -lt ${#CMD[@]} ]]; then
        update_cmd+=(--config "${CMD[i+1]}")
        i=$((i + 1))
      elif [[ "${CMD[$i]}" == --config=* ]]; then
        update_cmd+=("${CMD[$i]}")
      fi
    done
  fi
  if dhpk_help_accepts_option "$help" --yes || dhpk_help_accepts_option "$help" -y; then
    update_cmd+=(-y)
  fi
  echo "dhpk@dhpk is already installed; running update."
  "${update_cmd[@]}"
}

install_scope="$(dhpk_install_target_scope)"
HIST_SCOPE="$install_scope"
if command -v python3 >/dev/null 2>&1; then
  listed_json="$(claude plugin list --json 2>/dev/null || true)"
  if [[ -n "${listed_json//[[:space:]]/}" ]]; then
    installed_ver="$(python3 -I -S -c '
import json, sys
scope, raw = sys.argv[1], sys.argv[2]
try:
    data = json.loads(raw)
    if isinstance(data, dict):
        data = data.get("plugins") or data.get("items") or []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict) and (item.get("id") or item.get("name")) == "dhpk@dhpk":
                if item.get("scope") in (None, scope):
                    ver = item.get("version")
                    if isinstance(ver, str) and ver.strip():
                        print(ver.strip())
                    break
except Exception:
    pass
' "$install_scope" "$listed_json" 2>/dev/null || true)"
    if [[ -n "$installed_ver" ]]; then
      HIST_BEFORE_VERSION="$installed_ver"
      HIST_BEFORE_STATE="present"
      HIST_AFTER_VERSION="$installed_ver"
      HIST_AFTER_STATE="present"
    fi
  fi
fi
rc=0
ran_update=0
if dhpk_plugin_installed_for_scope "$install_scope"; then
  dhpk_run_plugin_update "$install_scope"
  rc=$?
  ran_update=1
else
  install_output="$("${CMD[@]}" 2>&1)"
  rc=$?
  if [[ -n "$install_output" ]]; then
    printf '%s\n' "$install_output"
  fi
  if [[ $rc -eq 0 ]] && dhpk_output_says_already_installed "$install_output"; then
    dhpk_run_plugin_update "$install_scope"
    rc=$?
    ran_update=1
  fi
fi

if [[ $ran_update -eq 1 ]]; then
  HIST_ACTION="update"
  if [[ $rc -eq 0 ]]; then
    HIST_VERDICT="INSTALL_PASS"
    HIST_AFTER_VERSION=""
    HIST_AFTER_STATE="current"
    dhpk_print_installed
  else
    HIST_VERDICT="BLOCKED"
    HIST_REASON="CLAUDE_PLUGIN_UPDATE_FAILED"
    echo
    echo "✗ 'claude plugin update' exited with status $rc."
  fi
  exit "$rc"
fi

if [[ $rc -eq 0 ]]; then
  HIST_VERDICT="INSTALL_PASS"
  HIST_AFTER_VERSION=""
  HIST_AFTER_STATE="current"
  dhpk_print_installed
else
  HIST_VERDICT="BLOCKED"
  HIST_REASON="CLAUDE_PLUGIN_INSTALL_FAILED"
  echo
  echo "✗ 'claude plugin install' exited with status $rc."
fi
exit "$rc"
