#!/usr/bin/env bash
# deploy-list.sh — cross-project / cross-platform deploy file list generator (schema=v1)
#
# Supports arbitrary projects via ecosystem presets (php-yii, laravel, node,
# python, generic) and i18n labels (zh-TW, en). Custom presets per project
# live alongside the shipped ones — see references/presets.md.
#
# Usage:
#   deploy-list.sh --tag "[v1]" --description "..." [options]
#
# Options:
#   --date            YYYY/MM/DD           (default: today)
#   --author          NAME                 (default: ${DEFAULT_AUTHOR:-${USER:-user}})
#   --tag             "[tag]"              REQUIRED — pure metadata, shown in header, not used for grouping
#   --description     TEXT                 REQUIRED
#   --project         NAME                 (default: basename of git toplevel)
#   --base            REF                  (default: ${DEFAULT_BASE:-master})
#   --head            REF                  (default: HEAD)
#   --preset          NAME                 (default: ${DEFAULT_PRESET} or auto-detect)
#   --lang            CODE                 (default: ${DEFAULT_LANG:-en}) — currently zh-TW, en
#   --deploy-commits  SHA1,SHA2,...        (CSV) commits whose union diff is the main group
#                                          unset → entire base..head is one main group (no warn group)
#   --anchor          STRING               source-code inline anchor (e.g. "2026/02/09 paul [tag]desc")
#                                          → rg -l --fixed-strings finds matching source files as main group
#                                          mutually exclusive with --deploy-commits / --auto-detect-tag
#   --auto-detect-tag                      (off by default) try grep -i [tag] from commit messages
#
# Layout:
#   .claude/skills/deploy-list/
#   ├── config.sh                  optional project defaults (sourced first)
#   ├── presets/<name>.sh          category sort + filter + rollback per ecosystem
#   ├── i18n/<lang>.sh             structural labels (header / section names)
#   └── scripts/deploy-list.sh     (this file)
#
# Output contract — see SKILL.md §"Output Contract (schema=v1, immutable)".
# Modifying any byte in the header/section markers requires bumping schema version.

set -uo pipefail

# ─── 0. Bash version + tool sanity probe ─────────────────────────────────────
if [[ -z "${BASH_VERSINFO[0]:-}" || "${BASH_VERSINFO[0]}" -lt 3 ]]; then
    echo "ERROR: deploy-list requires bash 3.0+ (your version too old)" >&2; exit 1
fi
for _tool in git awk sort comm grep sed wc tr mktemp basename printf; do
    if ! command -v "$_tool" >/dev/null 2>&1; then
        echo "ERROR: required tool '$_tool' not found in PATH" >&2; exit 1
    fi
done
unset _tool

# Disable git path-quoting (macOS git wraps unicode paths in quotes which
# breaks awk path extraction). LC_ALL=C used throughout for stable byte sort.
GIT_BASE="git -c core.quotepath=false"

# Single-byte tab var (replaces bash-only $'\t' for BSD sort compatibility).
TAB=$(printf '\t')

# ─── 1. Locate skill dir + load config ───────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Project-level defaults (DEFAULT_PRESET, DEFAULT_BASE, DEFAULT_LANG, DEFAULT_AUTHOR).
# Optional — generic deploy-list still works without it.
if [[ -f "$SKILL_DIR/config.sh" ]]; then
    # shellcheck disable=SC1090
    . "$SKILL_DIR/config.sh"
fi

# ─── 2. Argument defaults + parsing ──────────────────────────────────────────
DATE=$(date '+%Y/%m/%d')
AUTHOR="${DEFAULT_AUTHOR:-${USER:-user}}"
TAG=""
DESCRIPTION=""
PROJECT=""
BASE="${DEFAULT_BASE:-master}"
HEAD_REF="HEAD"
PRESET="${DEFAULT_PRESET:-}"
LANG_CODE="${DEFAULT_LANG:-en}"
DEPLOY_COMMITS_CSV=""
AUTO_DETECT_TAG=0
ANCHOR=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --date)            DATE="$2";              shift 2 ;;
        --author)          AUTHOR="$2";            shift 2 ;;
        --tag)             TAG="$2";               shift 2 ;;
        --description)     DESCRIPTION="$2";       shift 2 ;;
        --project)         PROJECT="$2";           shift 2 ;;
        --base)            BASE="$2";              shift 2 ;;
        --head)            HEAD_REF="$2";          shift 2 ;;
        --preset)          PRESET="$2";            shift 2 ;;
        --lang)            LANG_CODE="$2";         shift 2 ;;
        --deploy-commits)  DEPLOY_COMMITS_CSV="$2"; shift 2 ;;
        --anchor)          ANCHOR="$2";            shift 2 ;;
        --auto-detect-tag) AUTO_DETECT_TAG=1;      shift ;;
        *)                 shift ;;
    esac
done

# Anchor mode mutual exclusion + tool sanity
ANCHOR_MODE=0
if [[ -n "$ANCHOR" ]]; then
    ANCHOR_MODE=1
    [[ -n "$DEPLOY_COMMITS_CSV" ]] && { echo "ERROR: --anchor mutually exclusive with --deploy-commits" >&2; exit 1; }
    [[ "$AUTO_DETECT_TAG" -eq 1 ]] && { echo "ERROR: --anchor mutually exclusive with --auto-detect-tag" >&2; exit 1; }
    command -v rg >/dev/null 2>&1 || { echo "ERROR: --anchor requires ripgrep (rg) in PATH" >&2; exit 1; }
fi

[[ -z "$TAG" ]]         && { echo "ERROR: --tag required (e.g. --tag '[v1]')" >&2; exit 1; }
[[ -z "$DESCRIPTION" ]] && { echo "ERROR: --description required" >&2; exit 1; }
[[ "$TAG" =~ ^\[.+\]$ ]] || { echo "ERROR: --tag must be wrapped in [], got: $TAG" >&2; exit 1; }
[[ -z "$PROJECT" ]]     && PROJECT=$(basename "$(git rev-parse --show-toplevel 2>/dev/null || echo "$PWD")")

# ─── 3. Resolve preset (CLI > config > auto-detect > generic) ────────────────
auto_detect_preset() {
    # Probe order, first match wins. Returns preset name on stdout.
    # Projects with a custom DDD layering on top of Yii (e.g. domain/ +
    # infrastructure/) should copy presets/php-yii.sh, extend it, and pin
    # the result via config.sh's DEFAULT_PRESET. Auto-detect intentionally
    # stays at the framework level — it shouldn't guess at project-specific
    # layering.
    if [[ -f protected/yii.php || -f protected/config/main.php ]] && [[ -d protected/views ]]; then
        echo "php-yii"
        return
    fi
    if [[ -f artisan ]]; then echo "laravel"; return; fi
    if [[ -f package.json && ! -f composer.json ]]; then echo "node"; return; fi
    if [[ -f pyproject.toml || -f setup.py ]]; then echo "python"; return; fi
    echo "generic"
    echo "INFO: ecosystem auto-detect fell back to 'generic'; pass --preset explicitly to silence" >&2
}

if [[ -z "$PRESET" ]]; then
    PRESET=$(auto_detect_preset)
fi

PRESET_FILE="$SKILL_DIR/presets/$PRESET.sh"
if [[ ! -f "$PRESET_FILE" ]]; then
    echo "ERROR: preset '$PRESET' not found at $PRESET_FILE" >&2
    echo "  available presets: $(ls "$SKILL_DIR/presets/" 2>/dev/null | sed 's/\.sh$//' | tr '\n' ' ')" >&2
    exit 1
fi

I18N_FILE="$SKILL_DIR/i18n/$LANG_CODE.sh"
if [[ ! -f "$I18N_FILE" ]]; then
    echo "ERROR: lang '$LANG_CODE' not found at $I18N_FILE" >&2
    echo "  available langs: $(ls "$SKILL_DIR/i18n/" 2>/dev/null | sed 's/\.sh$//' | tr '\n' ' ')" >&2
    exit 1
fi

# ─── 4. Temp files (portable mktemp) ─────────────────────────────────────────
TF_MAIN=$(mktemp 2>/dev/null || mktemp -t deploy-list.XXXXXX)
TF_ALL=$(mktemp  2>/dev/null || mktemp -t deploy-list.XXXXXX)
TF_WARN=$(mktemp 2>/dev/null || mktemp -t deploy-list.XXXXXX)
trap 'rm -f "$TF_MAIN" "$TF_ALL" "$TF_WARN"' EXIT

# ─── 5. Helpers used by both main script and preset functions ────────────────
# Extract effective path from `git diff --name-status` output:
#   rename → new path (column 3); add/modify/delete → path (column 2)
extract_path() {
    awk '{if($1~/^R/)print $3; else print $2}'
}

# Universal filter base (all presets). Preset adds ecosystem-specific extras.
#   - Agent doc files (CLAUDE/AGENTS/GEMINI.md) anywhere in the tree
#   - Universal docs roots (docs/, openspec/, README, SECURITY, CHANGELOG, LICENSE)
#   - AI harness dirs (.claude/.codex/.gemini/.agents)
#   - CI root (.github)
#   - Universal git/IDE meta (.gitignore, .idea, .vscode)
FILTER_BASE='(^|.+/)CLAUDE\.md$|(^|.+/)AGENTS\.md$|(^|.+/)GEMINI\.md$'
FILTER_BASE="$FILTER_BASE|^docs/|^openspec/|^README"
FILTER_BASE="$FILTER_BASE|^SECURITY\.md\$|^CHANGELOG\.md\$|^LICENSE"
FILTER_BASE="$FILTER_BASE|^\.claude/|^\.codex/|^\.gemini/|^\.agents/|^\.github/"
FILTER_BASE="$FILTER_BASE|^\.gitignore\$|^\.idea/|^\.vscode/"

# Source preset (exports PRESET_CATEGORIES, PRESET_FILTER_EXTRA,
# PRESET_ROLLBACK_TRIGGER and defines preset_print_* functions)
# shellcheck disable=SC1090
. "$PRESET_FILE"

# Source i18n labels (exports LBL_*)
# shellcheck disable=SC1090
. "$I18N_FILE"

# Compose full filter
if [[ -n "${PRESET_FILTER_EXTRA:-}" ]]; then
    FILTER="$FILTER_BASE|$PRESET_FILTER_EXTRA"
else
    FILTER="$FILTER_BASE"
fi

# Filter + sort. `|| true` prevents pipefail from treating grep's exit-1
# (no match = empty stream) as error.
filter_and_sort() {
    { LC_ALL=C grep -vE "$FILTER" || true; } | LC_ALL=C sort
}

# Count raw diff lines matching a pattern (used by preset filtered_body
# functions). grep -cE prints 0 on no match; || true guards pipefail.
count_raw() {
    $GIT_BASE diff --name-status "$BASE...$HEAD_REF" | extract_path | { LC_ALL=C grep -cE "$1" || true; }
}

# ─── Shared state (both modes) ───────────────────────────────────────────────
WARN_SAME=""
DEPLOY_SHAS=()
REPLAY_WARNS=()
MAIN_COUNT=0
WARN_COUNT=0
ALL_DEPLOY_COUNT=0
RAW_TOTAL=0
FILTERED_OUT=0

if [[ "$ANCHOR_MODE" -eq 1 ]]; then
    # ─── A. Anchor mode: source-tree rg --fixed-strings ──────────────────────
    # Skips git-diff entirely. Excludes vcs/runtime/coverage/backup paths that
    # never deploy. Universal preset FILTER still applies via filter_and_sort.
    TF_RAW=$(mktemp 2>/dev/null || mktemp -t deploy-list.XXXXXX)
    trap 'rm -f "$TF_MAIN" "$TF_ALL" "$TF_WARN" "$TF_RAW"' EXIT
    rg -l --fixed-strings "$ANCHOR" \
        -g '!.git' -g '!node_modules' \
        -g '!protected/tests/coverage/html/**' \
        -g '!gemini/attachmets/**' \
        -g '!.claude/**' \
        2>/dev/null | LC_ALL=C sort > "$TF_RAW"
    filter_and_sort < "$TF_RAW" > "$TF_MAIN"
    cp "$TF_MAIN" "$TF_ALL"
    MAIN_COUNT=$(wc -l < "$TF_MAIN" | tr -d ' ')
    ALL_DEPLOY_COUNT="$MAIN_COUNT"
    RAW_TOTAL=$(wc -l < "$TF_RAW" | tr -d ' ')
    FILTERED_OUT=$(( RAW_TOTAL - MAIN_COUNT ))
    # Override count_raw to grep the raw anchor hits (not git diff) so the
    # preset's preset_print_filtered_body shows anchor-mode-correct counts.
    count_raw() {
        { LC_ALL=C grep -cE "$1" < "$TF_RAW" || true; }
    }
else
    # ─── 6. Base == Head detection + auto-switch ─────────────────────────────
    BASE_SHA=$($GIT_BASE rev-parse "$BASE" 2>/dev/null) \
        || { echo "ERROR: ref '$BASE' not found" >&2; exit 1; }
    HEAD_SHA=$($GIT_BASE rev-parse "$HEAD_REF" 2>/dev/null) \
        || { echo "ERROR: ref '$HEAD_REF' not found" >&2; exit 1; }

    if [[ "$BASE_SHA" == "$HEAD_SHA" ]]; then
        if $GIT_BASE rev-parse master >/dev/null 2>&1; then
            WARN_SAME=$(printf "$LBL_WARN_BASE_HEAD_SAME_TPL" "$BASE" "master" "$HEAD_REF")
            BASE="master"
        elif $GIT_BASE rev-parse main >/dev/null 2>&1; then
            WARN_SAME=$(printf "$LBL_WARN_BASE_HEAD_SAME_TPL" "$BASE" "main" "$HEAD_REF")
            BASE="main"
        else
            echo "ERROR: base == head and no master/main ref found" >&2; exit 1
        fi
    fi

    # ─── 7. (Optional) Auto-detect tag from commit messages ──────────────────
    if [[ "$AUTO_DETECT_TAG" -eq 1 && -z "$DEPLOY_COMMITS_CSV" ]]; then
        AUTO_SHAS=$($GIT_BASE log "$BASE..$HEAD_REF" --format="%H" -i -F --grep="$TAG" 2>/dev/null | tr '\n' ',' | sed 's/,$//')
        [[ -n "$AUTO_SHAS" ]] && DEPLOY_COMMITS_CSV="$AUTO_SHAS"
    fi

    # ─── 8. Resolve --deploy-commits CSV → DEPLOY_SHAS[] ─────────────────────
    if [[ -n "$DEPLOY_COMMITS_CSV" ]]; then
        IFS=',' read -ra _RAW <<<"$DEPLOY_COMMITS_CSV"
        for s in "${_RAW[@]}"; do
            s=$(printf '%s' "$s" | tr -d '[:space:]')
            [[ -z "$s" ]] && continue
            full=$($GIT_BASE rev-parse --verify "$s^{commit}" 2>/dev/null) \
                || { echo "ERROR: --deploy-commits contains invalid commit: $s" >&2; exit 1; }
            $GIT_BASE merge-base --is-ancestor "$full" "$HEAD_SHA" 2>/dev/null \
                || { echo "ERROR: commit $s is not an ancestor of $HEAD_REF (foreign-branch SHA rejected)" >&2; exit 1; }
            if $GIT_BASE merge-base --is-ancestor "$full" "$BASE_SHA" 2>/dev/null; then
                REPLAY_WARNS+=("$s")
            fi
            DEPLOY_SHAS+=("$full")
        done
    fi

    # ─── 9. Build main group (TF_MAIN) ───────────────────────────────────────
    if [[ "${#DEPLOY_SHAS[@]}" -eq 0 ]]; then
        $GIT_BASE diff --name-status "$BASE...$HEAD_REF" | extract_path | filter_and_sort > "$TF_MAIN"
    else
        for sha in "${DEPLOY_SHAS[@]}"; do
            $GIT_BASE diff-tree --no-commit-id -r --name-status "$sha" | extract_path
        done | LC_ALL=C sort -u | filter_and_sort > "$TF_MAIN"
    fi

    # ─── 10. Build warning group (TF_WARN) ──────────────────────────────────
    $GIT_BASE diff --name-status "$BASE...$HEAD_REF" | extract_path | filter_and_sort > "$TF_ALL"

    if [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]]; then
        LC_ALL=C comm -23 "$TF_ALL" "$TF_MAIN" > "$TF_WARN"
    fi

    MAIN_COUNT=$(wc -l < "$TF_MAIN" | tr -d ' ')
    WARN_COUNT=$(wc -l < "$TF_WARN" | tr -d ' ')
    ALL_DEPLOY_COUNT=$(wc -l < "$TF_ALL" | tr -d ' ')
    RAW_TOTAL=$($GIT_BASE diff --name-status "$BASE...$HEAD_REF" | extract_path | wc -l | tr -d ' ')
    FILTERED_OUT=$(( RAW_TOTAL - ALL_DEPLOY_COUNT ))
fi

# ─── 11. Sort/group function (driven by PRESET_CATEGORIES) ───────────────────
# PRESET_CATEGORIES is newline-delim "<sort-key>|<awk-ERE>".
# Patterns checked in list order (first match wins for matching),
# output sorted by key (lexicographic — keep keys monotonic).
sort_groups() {
    awk -v categories="$PRESET_CATEGORIES" '
    BEGIN {
        cat_count = 0
        n = split(categories, lines, "\n")
        for (i=1; i<=n; i++) {
            line = lines[i]
            if (line == "") continue
            idx = index(line, "|")
            if (idx == 0) continue
            cat_count++
            cat_keys[cat_count] = substr(line, 1, idx-1)
            cat_pats[cat_count] = substr(line, idx+1)
        }
    }
    function grp(f,    i) {
        for (i=1; i<=cat_count; i++) {
            if (f ~ cat_pats[i]) return cat_keys[i]
        }
        return "99"
    }
    { print grp($0) "\t" $0 }
    ' | LC_ALL=C sort -t"$TAB" -k1,1 -k2,2 \
      | awk -F"$TAB" 'BEGIN{pg=""} { if(pg!=""&&$1!=pg) print ""; print $2; pg=$1 }'
}

# ─── 12. Rollback check (preset-controlled trigger) ──────────────────────────
SHOW_ROLLBACK=0
if [[ "$MAIN_COUNT" -gt 0 && -n "${PRESET_ROLLBACK_TRIGGER:-}" ]]; then
    awk -v pat="$PRESET_ROLLBACK_TRIGGER" '$0 ~ pat' "$TF_MAIN" | grep -q . 2>/dev/null && SHOW_ROLLBACK=1 || true
fi

# ─── 13. Output (schema=v1) ──────────────────────────────────────────────────
# Replay warnings → stderr (does not pollute schema contract).
if [[ "${#REPLAY_WARNS[@]}" -gt 0 ]]; then
    printf "$LBL_NOTE_REPLAY_TPL\n" "$BASE" "$(IFS=,; echo "${REPLAY_WARNS[*]}")" >&2
fi

echo "# deploy-list schema=v1"

[[ -n "$WARN_SAME" ]] && printf '%s\n' "$WARN_SAME"

# shellcheck disable=SC2059
printf "$LBL_UPDATE_TIME_LINE\n"    "$DATE"
# shellcheck disable=SC2059
printf "$LBL_UPDATE_TAG_LINE\n"     "$DATE" "$AUTHOR" "$TAG" "$DESCRIPTION"
# shellcheck disable=SC2059
printf "$LBL_UPDATE_PROJECT_LINE\n" "$PROJECT"

if [[ "$ANCHOR_MODE" -eq 1 ]]; then
    # shellcheck disable=SC2059
    printf "$LBL_UPDATE_FILES_ANCHOR_LINE\n" "$MAIN_COUNT"
elif [[ "${#DEPLOY_SHAS[@]}" -gt 0 ]]; then
    # shellcheck disable=SC2059
    printf "$LBL_UPDATE_FILES_PINNED_LINE\n" "${#DEPLOY_SHAS[@]}" "$MAIN_COUNT"
else
    # shellcheck disable=SC2059
    printf "$LBL_UPDATE_FILES_RANGE_LINE\n"  "$BASE" "$HEAD_REF" "$MAIN_COUNT"
fi

if [[ "$MAIN_COUNT" -gt 0 ]]; then
    printf '\n'
    sort_groups < "$TF_MAIN"
elif [[ "$ANCHOR_MODE" -eq 1 ]]; then
    printf '\n%s\n' "$LBL_NO_DEPLOY_FILES_ANCHOR"
else
    printf '\n%s\n' "$LBL_NO_DEPLOY_FILES"
fi

# Warning group only when --deploy-commits specified and base..head has extras
if [[ "$WARN_COUNT" -gt 0 ]]; then
    printf '\n---\n'
    printf "$LBL_OUT_OF_SCOPE_HEADER_TPL\n" "$BASE" "$HEAD_REF" "$WARN_COUNT"
    printf '%s\n\n' "$LBL_OUT_OF_SCOPE_NOTE"
    sort_groups < "$TF_WARN"
fi

# Statistics — section header from i18n, body from preset
echo ""
echo "---"
echo "$LBL_STATS_HEADER"
preset_print_stats_body

# Filtered-out — section header from i18n, body from preset
echo ""
echo "$LBL_FILTERED_HEADER"
preset_print_filtered_body

# Rollback — section header from i18n, body from preset (only if trigger fires)
if [[ "$SHOW_ROLLBACK" -eq 1 ]]; then
    echo ""
    echo "$LBL_ROLLBACK_HEADER"
    preset_print_rollback_body
fi

echo "# end deploy-list schema=v1"
