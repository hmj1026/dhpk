#!/usr/bin/env bash
# install-prompts.sh — shared interactive prompt helpers for dhpk installer.
#
# Source this file from another bash script:
#   source "$(dirname "$0")/lib/install-prompts.sh"
#   dhpk_prompts_init "/path/to/module-catalog.json"
#
# Public API:
#   dhpk_prompts_init <catalog-path>
#   dhpk_catalog_query <jq-expression>          # echoes value(s)
#   dhpk_multi_select  <title> <item>...        # echoes selected items, newline-separated
#   dhpk_single_select <title> <item>...        # echoes one selected item
#   dhpk_yes_no        <question> [default y|n] # returns 0 for yes, 1 for no
#   dhpk_input         <prompt>   [default]     # echoes typed value or default
#   dhpk_box           <line>...                # prints a boxed info block to stderr
#
# All user-facing prompts go to stderr; captured values go to stdout. This lets
# callers do `value=$(dhpk_input "..." "default")` cleanly.

set -u

DHPK_PROMPTS_CATALOG=""
DHPK_PROMPTS_USE_GUM=0
DHPK_PROMPTS_USE_JQ=0
DHPK_PROMPTS_USE_PY=0

dhpk_prompts_init() {
  DHPK_PROMPTS_CATALOG="${1:-}"
  if [[ -z "$DHPK_PROMPTS_CATALOG" || ! -f "$DHPK_PROMPTS_CATALOG" ]]; then
    echo "[install-prompts] FATAL: catalog file not found: $DHPK_PROMPTS_CATALOG" >&2
    return 1
  fi
  command -v gum    >/dev/null 2>&1 && DHPK_PROMPTS_USE_GUM=1
  command -v jq     >/dev/null 2>&1 && DHPK_PROMPTS_USE_JQ=1
  command -v python3 >/dev/null 2>&1 && DHPK_PROMPTS_USE_PY=1
  if [[ $DHPK_PROMPTS_USE_JQ -eq 0 && $DHPK_PROMPTS_USE_PY -eq 0 ]]; then
    echo "[install-prompts] FATAL: need jq or python3 to parse catalog JSON." >&2
    return 1
  fi
  return 0
}

# dhpk_catalog_query <jq-expr>
# Runs a jq expression against the catalog. Falls back to a tiny python3 jq-lite
# only for a known set of expressions (the ones install.sh uses). For anything
# beyond those, install jq.
dhpk_catalog_query() {
  local expr="$1"
  if [[ $DHPK_PROMPTS_USE_JQ -eq 1 ]]; then
    jq -r "$expr" "$DHPK_PROMPTS_CATALOG"
    return $?
  fi
  # python3 fallback — handles only the expressions install.sh uses.
  python3 - "$DHPK_PROMPTS_CATALOG" "$expr" <<'PY'
import json, sys
path = sys.argv[1]
expr = sys.argv[2]
with open(path) as f:
    data = json.load(f)

def stacks_ids():
    for s in data["stacks"]:
        print(s["id"])

def stack_name(sid):
    for s in data["stacks"]:
        if s["id"] == sid:
            print(s["name"])
            return

def stack_versions(sid):
    for s in data["stacks"]:
        if s["id"] == sid:
            for v in s["versions"]:
                print(v["id"])
            return

def version_module(sid, vid):
    for s in data["stacks"]:
        if s["id"] == sid:
            for v in s["versions"]:
                if v["id"] == vid:
                    print(v["module"])
                    return

def version_requires_module(sid, vid):
    for s in data["stacks"]:
        if s["id"] == sid:
            for v in s["versions"]:
                if v["id"] == vid:
                    print(v.get("requires_module", ""))
                    return

def hook_profiles():
    for p in data["hook_profiles"]:
        print(p["id"])

def review_slot_defaults():
    for s in data["review_slots"]:
        print(f'{s["id"]}={s["default_agent"]}')

# Tiny expression dispatcher. install.sh uses these forms only.
if expr == '.stacks[].id':
    stacks_ids()
elif expr.startswith('.stacks[] | select(.id=="') and expr.endswith('") | .name'):
    sid = expr.split('"')[1]
    stack_name(sid)
elif expr.startswith('.stacks[] | select(.id=="') and expr.endswith('") | .versions[].id'):
    sid = expr.split('"')[1]
    stack_versions(sid)
elif expr.startswith('.stacks[] | select(.id=="') and '") | .versions[] | select(.id=="' in expr and expr.endswith('") | .module'):
    parts = expr.split('"')
    sid, vid = parts[1], parts[3]
    version_module(sid, vid)
elif expr.startswith('.stacks[] | select(.id=="') and '") | .versions[] | select(.id=="' in expr and expr.endswith('") | .requires_module // ""'):
    parts = expr.split('"')
    sid, vid = parts[1], parts[3]
    version_requires_module(sid, vid)
elif expr == '.hook_profiles[].id':
    hook_profiles()
elif expr == '.review_slots[] | "\(.id)=\(.default_agent)"':
    review_slot_defaults()
else:
    print(f"[install-prompts] python3 fallback does not handle: {expr}", file=sys.stderr)
    sys.exit(2)
PY
}

# dhpk_box <line>...
# Prints a boxed info block to stderr.
dhpk_box() {
  local width=68
  local bar
  bar="$(printf '─%.0s' $(seq 1 "$width"))"
  printf '\n┌%s┐\n' "$bar" >&2
  local line
  for line in "$@"; do
    printf '│ %-*s │\n' $((width - 2)) "$line" >&2
  done
  printf '└%s┘\n\n' "$bar" >&2
}

# dhpk_yes_no <question> [default y|n]
# Returns 0 (yes) or 1 (no).
dhpk_yes_no() {
  local question="$1"
  local default="${2:-n}"
  local hint
  if [[ "$default" == "y" ]]; then hint="[Y/n]"; else hint="[y/N]"; fi
  local reply
  printf '%s %s ' "$question" "$hint" >&2
  read -r reply || reply=""
  reply="${reply:-$default}"
  case "${reply,,}" in
    y|yes) return 0 ;;
    *)     return 1 ;;
  esac
}

# dhpk_input <prompt> [default]
# Echoes user input (or default if empty).
dhpk_input() {
  local prompt="$1"
  local default="${2:-}"
  local reply
  if [[ -n "$default" ]]; then
    printf '%s [%s]: ' "$prompt" "$default" >&2
  else
    printf '%s: ' "$prompt" >&2
  fi
  read -r reply || reply=""
  printf '%s' "${reply:-$default}"
}

# dhpk_single_select <title> <item>...
# Echoes the chosen item.
dhpk_single_select() {
  local title="$1"; shift
  local items=("$@")
  if [[ ${#items[@]} -eq 0 ]]; then return 1; fi
  if [[ ${#items[@]} -eq 1 ]]; then
    printf '%s\n  → %s (only option)\n' "$title" "${items[0]}" >&2
    printf '%s' "${items[0]}"
    return 0
  fi
  if [[ $DHPK_PROMPTS_USE_GUM -eq 1 ]]; then
    printf '%s\n' "$title" >&2
    gum choose "${items[@]}"
    return $?
  fi
  printf '\n%s\n' "$title" >&2
  local i
  for i in "${!items[@]}"; do
    printf '  %d) %s\n' $((i+1)) "${items[$i]}" >&2
  done
  while true; do
    local pick
    printf 'Pick a number [1-%d]: ' "${#items[@]}" >&2
    read -r pick || pick=""
    if [[ "$pick" =~ ^[0-9]+$ ]] && (( pick >= 1 && pick <= ${#items[@]} )); then
      printf '%s' "${items[$((pick-1))]}"
      return 0
    fi
    printf 'Invalid selection.\n' >&2
  done
}

# dhpk_multi_select <title> <item>...
# Echoes selected items, one per line. Empty selection is allowed.
dhpk_multi_select() {
  local title="$1"; shift
  local items=("$@")
  if [[ ${#items[@]} -eq 0 ]]; then return 0; fi
  if [[ $DHPK_PROMPTS_USE_GUM -eq 1 ]]; then
    printf '%s (space to toggle, enter to confirm)\n' "$title" >&2
    gum choose --no-limit "${items[@]}"
    return $?
  fi
  printf '\n%s\n' "$title" >&2
  local i
  for i in "${!items[@]}"; do
    printf '  %d) %s\n' $((i+1)) "${items[$i]}" >&2
  done
  printf 'Enter space-separated numbers (e.g. "1 3"), or blank for none: ' >&2
  local raw
  read -r raw || raw=""
  if [[ -z "$raw" ]]; then return 0; fi
  local n
  for n in $raw; do
    if [[ "$n" =~ ^[0-9]+$ ]] && (( n >= 1 && n <= ${#items[@]} )); then
      printf '%s\n' "${items[$((n-1))]}"
    else
      printf '[install-prompts] ignored invalid selection: %s\n' "$n" >&2
    fi
  done
}
