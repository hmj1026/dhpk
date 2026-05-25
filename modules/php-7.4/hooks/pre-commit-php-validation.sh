#!/usr/bin/env bash
# pre-commit-php-validation.sh — PHP module PreToolUse Bash hook.
#
# Intercepts `git commit*` commands. When the staged diff includes any
# non-vendor `.php` file, runs (in order):
#
#   1. vendor/bin/php-cs-fixer fix --dry-run on the staged set
#   2. vendor/bin/phpstan analyse        (only if phpstan.neon[.dist] present)
#   3. vendor/bin/psalm                  (only if psalm.xml[.dist] present)
#
# Any failure exits 2 (Claude Code rejects the bash call). Each tool is
# silently skipped when its binary OR its config file is missing — never
# blocks a project that hasn't adopted that tier yet.
#
# Skip mechanisms (in priority order):
#   1. Commit message includes `[skip-php-lint]` — emergency hotfix bypass.
#   2. No staged .php files outside vendor/ — no gate, no delay.
#   3. No php-cs-fixer config AND no phpstan AND no psalm — nothing to run.
#
# Binary overrides:
#   CLAUDE_PLUGIN_OPTION_PHP_CS_FIXER_BIN  (default: vendor/bin/php-cs-fixer)
#   CLAUDE_PLUGIN_OPTION_PHPSTAN_BIN       (default: vendor/bin/phpstan)
#   CLAUDE_PLUGIN_OPTION_PSALM_BIN         (default: vendor/bin/psalm)

set -o pipefail

. "$(dirname "$0")/../../../scripts/hooks/_lib/payload.sh"

stdin_data="$(cat 2>/dev/null || true)"
[ -z "$stdin_data" ] && exit 0

cmd="$(extract_tool_input command "$stdin_data")"
[ -z "$cmd" ] && exit 0

# Only intercept real `git commit*`; skip plumbing `git commit-tree`.
case "$cmd" in
    *"git commit-tree"*) exit 0 ;;
    *"git commit"*) ;;
    *) exit 0 ;;
esac

if echo "$cmd" | grep -Fq '[skip-php-lint]'; then
    echo "[pre-commit-php] [skip-php-lint] sentinel found in command; bypassing" >&2
    exit 0
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    exit 0
fi

# Collect non-vendor staged .php files.
staged_php=()
while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
        *.php) ;;
        *) continue ;;
    esac
    case "$f" in vendor/*|*/vendor/*) continue ;; esac
    staged_php+=("$f")
done < <(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)

[ "${#staged_php[@]}" -eq 0 ] && exit 0

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root" || exit 0

# Resolve tool binaries (env override → vendor/bin → PATH).
resolve_bin() {
    local env_override="$1" vendor_path="$2" path_name="$3"
    if [ -n "$env_override" ]; then
        if [ -x "$env_override" ]; then printf '%s' "$env_override"; return 0; fi
        if command -v "$env_override" >/dev/null 2>&1; then command -v "$env_override"; return 0; fi
    fi
    if [ -x "$vendor_path" ]; then printf '%s' "$vendor_path"; return 0; fi
    if command -v "$path_name" >/dev/null 2>&1; then command -v "$path_name"; return 0; fi
    printf ''
}

cs_bin="$(resolve_bin "${CLAUDE_PLUGIN_OPTION_PHP_CS_FIXER_BIN:-}" "vendor/bin/php-cs-fixer" "php-cs-fixer")"
phpstan_bin="$(resolve_bin "${CLAUDE_PLUGIN_OPTION_PHPSTAN_BIN:-}" "vendor/bin/phpstan" "phpstan")"
psalm_bin="$(resolve_bin "${CLAUDE_PLUGIN_OPTION_PSALM_BIN:-}" "vendor/bin/psalm" "psalm")"

# Resolve config files (project must adopt a tool for that tool's gate to fire).
cs_cfg=""
for candidate in .php-cs-fixer.php .php-cs-fixer.dist.php; do
    [ -f "$candidate" ] && cs_cfg="$candidate" && break
done

phpstan_cfg=""
for candidate in phpstan.neon phpstan.neon.dist phpstan.dist.neon; do
    [ -f "$candidate" ] && phpstan_cfg="$candidate" && break
done

psalm_cfg=""
for candidate in psalm.xml psalm.xml.dist; do
    [ -f "$candidate" ] && psalm_cfg="$candidate" && break
done

# Nothing configured → silent exit.
if [ -z "$cs_cfg" ] && [ -z "$phpstan_cfg" ] && [ -z "$psalm_cfg" ]; then
    exit 0
fi

echo "[pre-commit-php] ${#staged_php[@]} staged .php file(s) detected; running checks..." >&2

# --- 1. php-cs-fixer (style) ---
if [ -n "$cs_cfg" ] && [ -n "$cs_bin" ]; then
    if ! "$cs_bin" fix --dry-run --using-cache=no --no-interaction \
            --path-mode=intersection "${staged_php[@]}" >&2; then
        echo "[pre-commit-php] FAIL: php-cs-fixer found style issues. Run 'php-cs-fixer fix' or add '[skip-php-lint]' to commit msg." >&2
        exit 2
    fi
elif [ -n "$cs_cfg" ]; then
    echo "[pre-commit-php] WARN: $cs_cfg present but php-cs-fixer binary missing (run 'composer install')" >&2
fi

# --- 2. phpstan (static analysis) ---
if [ -n "$phpstan_cfg" ] && [ -n "$phpstan_bin" ]; then
    if ! "$phpstan_bin" analyse --no-interaction --no-progress \
            -c "$phpstan_cfg" "${staged_php[@]}" >&2; then
        echo "[pre-commit-php] FAIL: phpstan analyse failed. Fix errors or add '[skip-php-lint]' to commit msg." >&2
        exit 2
    fi
elif [ -n "$phpstan_cfg" ]; then
    echo "[pre-commit-php] WARN: $phpstan_cfg present but phpstan binary missing (run 'composer install')" >&2
fi

# --- 3. psalm (static analysis) ---
# Psalm doesn't accept per-file paths cleanly with config; run on the full
# project. Cost is acceptable because psalm uses its own cache by default.
if [ -n "$psalm_cfg" ] && [ -n "$psalm_bin" ]; then
    if ! "$psalm_bin" --no-progress --config="$psalm_cfg" >&2; then
        echo "[pre-commit-php] FAIL: psalm failed. Fix errors or add '[skip-php-lint]' to commit msg." >&2
        exit 2
    fi
elif [ -n "$psalm_cfg" ]; then
    echo "[pre-commit-php] WARN: $psalm_cfg present but psalm binary missing (run 'composer install')" >&2
fi

echo "[pre-commit-php] OK: all configured checks passed" >&2
exit 0
