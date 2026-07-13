#!/bin/bash
# test-harness.sh — verify all harness hooks trigger correctly
# Usage: bash scripts/test-harness.sh [--dir .gemini]
# Exit 0 = all PASS; non-zero = at least one rule not triggered correctly.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
export CLAUDE_PROJECT_DIR="$ROOT"

HARNESS_DIR=""
# ── Argument Parsing ──────────────────────────────────────────────────────
# Since we use set -u, we check if $1 exists before using it
if [[ $# -gt 0 ]]; then
    while [[ "$#" -gt 0 ]]; do
        case $1 in
            --dir)
                if [[ -z "${2:-}" ]]; then echo "[error] --dir requires an argument." >&2; exit 1; fi
                HARNESS_DIR="$2"; shift ;;
        esac
        shift
    done
fi

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

MAIN_RULE=""
if [[ "$HARNESS_DIR" == ".gemini" ]]; then
    MAIN_RULE="GEMINI.md"
elif [[ "$HARNESS_DIR" == ".claude" ]]; then
    MAIN_RULE="CLAUDE.md"
elif [[ "$HARNESS_DIR" == ".codex" ]]; then
    MAIN_RULE=".codex/README.zh-TW.md"
fi

HOOKS="$ROOT/$HARNESS_DIR/hooks"
ARTIFACTS="$ROOT/$HARNESS_DIR/artifacts"
SENTINEL="$ARTIFACTS/sessions/.pending-review"

detect_memory_dir() {
    local harness_dir="$1"
    local slug
    slug=$(printf '%s' "$ROOT" | sed 's|/|-|g')

    case "$harness_dir" in
        .gemini)
            find "$HOME/.gemini/tmp" -maxdepth 2 -name "memory" -type d 2>/dev/null | head -n 1
            ;;
        .claude|.codex)
            local candidate="$HOME/$harness_dir/projects/$slug/memory"
            if [[ -d "$candidate" ]]; then
                printf '%s\n' "$candidate"
            fi
            ;;
    esac
}

MEMORY_DIR=$(detect_memory_dir "$HARNESS_DIR")

PASS=0
FAIL=0
FAILED_CASES=()

color_pass() { printf '\033[32m%s\033[0m' "$1"; }
color_fail() { printf '\033[31m%s\033[0m' "$1"; }

assert_eq() { # name expected actual [extra]
    local name="$1" exp="$2" act="$3" extra="${4:-}"
    if [[ "$exp" == "$act" ]]; then
        echo "  $(color_pass PASS) $name"
        PASS=$((PASS + 1))
    else
        echo "  $(color_fail FAIL) $name expected=[$exp] actual=[$act] $extra"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("$name")
    fi
}

assert_contains() { # name needle haystack
    local name="$1" needle="$2" haystack="$3"
    if printf '%s' "$haystack" | grep -qF "$needle"; then
        echo "  $(color_pass PASS) $name"
        PASS=$((PASS + 1))
    else
        echo "  $(color_fail FAIL) $name (missing: $needle)"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("$name")
    fi
}

assert_file_exists() { # name path
    local name="$1" path="$2"
    if [[ -e "$path" ]]; then
        echo "  $(color_pass PASS) $name"
        PASS=$((PASS + 1))
    else
        echo "  $(color_fail FAIL) $name (file missing: $path)"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("$name")
    fi
}

run_bash_guard() { # cmd -> "exit_code|stderr"
    local cmd="$1"
    local payload
    payload=$(jq -nc --arg c "$cmd" '{tool_input:{command:$c}}')
    local stderr_file
    stderr_file=$(mktemp)
    local rc=0
    printf '%s' "$payload" | bash "$HOOKS/pre-bash-guard.sh" 2>"$stderr_file" >/dev/null || rc=$?
    local err
    err=$(cat "$stderr_file")
    rm -f "$stderr_file"
    printf '%s|%s' "$rc" "$err"
}

# ============================================================
echo "[setup] root=$ROOT"
echo "[setup] backing up sentinel if any"
SENTINEL_BAK=""
ARTIFACTS_BAK=""

cleanup() {
    # Restore artifacts dir if T5 left a backup
    if [[ -n "${ARTIFACTS_BAK:-}" && -d "$ARTIFACTS_BAK" ]]; then
        rm -rf "$ARTIFACTS"
        mv "$ARTIFACTS_BAK" "$ARTIFACTS"
    fi
    # Restore sentinel
    rm -f "$SENTINEL"
    if [[ -n "${SENTINEL_BAK:-}" && -f "$SENTINEL_BAK" ]]; then
        mv "$SENTINEL_BAK" "$SENTINEL"
    fi
}
trap cleanup EXIT INT TERM

if [[ -f "$SENTINEL" ]]; then
    SENTINEL_BAK=$(mktemp)
    cp "$SENTINEL" "$SENTINEL_BAK"
fi
mkdir -p "$ARTIFACTS/sessions"

# ============================================================
# T1 pre-edit-guard.sh — PLUGIN-OWNED (dhpk >=0.10.0 hooks.json). Sensitive-path
# blocking moved off the project after the 2026-06-12 cutover; validated by dhpk's
# own contract tests, not re-tested here. See memory `harness-dhpk-hook-coexistence`.
echo ""
echo "=== T1 pre-edit-guard.sh (SKIP: plugin-owned, dhpk >=0.10.0) ==="

# ============================================================
# T2 pre-bash-guard.sh — gated on the project shipping this hook. The destructive
# pattern asserted (php-cs-fixer) is project-specific (zdpos forces cs-fixer v2 +
# opcache reset); the block cases run only when the guard actually targets it.
echo ""
if [[ -f "$HOOKS/pre-bash-guard.sh" ]]; then
    echo "=== T2 pre-bash-guard.sh ==="

    result=$(run_bash_guard "git status --short")
    rc="${result%%|*}"
    assert_eq "T2.1 git status passes" "0" "$rc"

    if grep -q "php-cs-fixer" "$HOOKS/pre-bash-guard.sh" 2>/dev/null; then
        result=$(run_bash_guard "vendor/bin/php-cs-fixer fix protected/")
        rc="${result%%|*}"; err="${result#*|}"
        assert_eq "T2.2 php-cs-fixer blocked" "2" "$rc"
        assert_contains "T2.2 stderr BLOCKED" "BLOCKED" "$err"

        result=$(run_bash_guard 'echo "ok" # see vendor/bin/php-cs-fixer')
        rc="${result%%|*}"
        assert_eq "T2.3a comment-stripped passes" "0" "$rc"

        # T2.3b: same path but as the actual command — must still block
        result=$(run_bash_guard 'vendor/bin/php-cs-fixer --version  # comment')
        rc="${result%%|*}"
        assert_eq "T2.3b active cmd with trailing comment blocked" "2" "$rc"

        result=$(run_bash_guard "./vendor/bin/php-cs-fixer fix")
        rc="${result%%|*}"
        assert_eq "T2.4 ./prefix blocked" "2" "$rc"
    fi
else
    echo "=== T2 pre-bash-guard.sh (SKIP: project ships no pre-bash-guard.sh) ==="
fi

# ============================================================
# T3 post-edit-remind.sh — PLUGIN-OWNED (dhpk >=0.10.0). Sentinel routing (which
# review slots a given edit triggers) is the plugin's responsibility post-cutover.
echo ""
echo "=== T3 post-edit-remind.sh (SKIP: plugin-owned, dhpk >=0.10.0) ==="

# ============================================================
echo ""
echo "=== T4 post-write-crlf-fix.sh (SKIP: plugin-owned, dhpk >=0.10.0) ==="
# CRLF normalization moved to the dhpk plugin's post-write hook after the cutover.

# ============================================================
# T5 session-start.sh — gated on the project shipping this hook. Asserts the
# universal contract (artifact dirs, [session-start] marker, latest.md branch +
# hook_profile); project-specific markers (e.g. zdpos pos_php) are asserted only
# when the hook emits them.
echo ""
if [[ -f "$HOOKS/session-start.sh" ]]; then
    echo "=== T5 session-start.sh ==="

    ARTIFACTS_BAK="$ROOT/$HARNESS_DIR/artifacts.test-bak.$$"
    mv "$ARTIFACTS" "$ARTIFACTS_BAK"
    # trap will restore on unexpected exit

    stdout=$(bash "$HOOKS/session-start.sh" 2>&1)
    for sub in reviews plans audits adr sessions; do
        assert_file_exists "T5.1 dir $sub" "$ARTIFACTS/$sub"
    done

    LATEST="$ARTIFACTS/sessions/latest.md"
    assert_file_exists "T5.2a latest.md exists" "$LATEST"
    if [[ -f "$LATEST" ]]; then
        content=$(cat "$LATEST")
        assert_contains "T5.2b latest.md branch" "branch:" "$content"
        assert_contains "T5.2d latest.md hook_profile" "hook_profile:" "$content"
        # Project-specific marker: only assert if this project's hook emits it.
        if grep -q "pos_php" "$HOOKS/session-start.sh" 2>/dev/null; then
            assert_contains "T5.2c latest.md pos_php" "pos_php:" "$content"
        fi
    fi
    assert_contains "T5.3 stdout marker" "[session-start]" "$stdout"

    # Strict profile WARN test (only meaningful if a container is stopped/absent and
    # the hook honors the profile env var). Both the dhpk-standard and the zdpos var
    # are set so either convention is exercised; otherwise this SKIPs cleanly.
    strict_out=$(ZDPOS_HOOK_PROFILE=strict CLAUDE_PLUGIN_OPTION_HOOK_PROFILE=strict bash "$HOOKS/session-start.sh" 2>&1)
    if printf '%s' "$strict_out" | grep -q "STOPPED\|docker cli missing"; then
        if printf '%s' "$strict_out" | grep -q "\[WARN\]"; then
            echo "  $(color_pass PASS) T5.4 strict profile WARN emitted"
            PASS=$((PASS + 1))
        else
            echo "  $(color_fail FAIL) T5.4 strict profile WARN missing"
            FAIL=$((FAIL + 1))
            FAILED_CASES+=("T5.4")
        fi
    else
        echo "  SKIP T5.4 strict profile (both containers running)"
    fi

    rm -rf "$ARTIFACTS"
    mv "$ARTIFACTS_BAK" "$ARTIFACTS"
    ARTIFACTS_BAK=""  # trap no longer needs to restore
else
    echo "=== T5 session-start.sh (SKIP: project ships no session-start.sh) ==="
fi

# ============================================================
# T6 stop-review-reminder.sh — PLUGIN-OWNED (dhpk >=0.10.0). The Stop-time review
# reminder and its profile gating are emitted by the plugin post-cutover; the
# project no longer ships this hook (hook_profile is advisory via pluginConfigs).
echo ""
echo "=== T6 stop-review-reminder.sh (SKIP: plugin-owned, dhpk >=0.10.0) ==="

# ============================================================
echo ""
if [[ -f "$HOOKS/clear-sentinel.sh" ]]; then
    echo "=== T7 clear-sentinel.sh ==="

    echo "x" > "$SENTINEL"
    out=$(bash "$HOOKS/clear-sentinel.sh" ".pending-review" "code-reviewer" 2>&1)
    if [[ -f "$SENTINEL" ]]; then
        echo "  $(color_fail FAIL) T7.1 sentinel still exists"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("T7.1")
    else
        echo "  $(color_pass PASS) T7.1 sentinel removed"
        PASS=$((PASS + 1))
    fi
    assert_contains "T7.2 cleared message" "sentinel cleared" "$out"

    out=$(bash "$HOOKS/clear-sentinel.sh" ".pending-review" "code-reviewer" 2>&1)
    assert_contains "T7.3 already-clean message" "sentinel already clean" "$out"
else
    echo "=== T7 clear-sentinel.sh (SKIP: hook is plugin-owned, not project-local) ==="
fi

# ============================================================
echo ""
SETTINGS_JSON="$ROOT/$HARNESS_DIR/settings.json"
if [[ ! -f "$SETTINGS_JSON" ]]; then
    echo "=== T8 settings.json schema (SKIP: $HARNESS_DIR/settings.json absent, e.g. .codex uses config.toml) ==="
else
    echo "=== T8 settings.json schema ==="

    if jq -e . "$SETTINGS_JSON" >/dev/null 2>&1; then
        echo "  $(color_pass PASS) T8.1 settings.json valid JSON"
        PASS=$((PASS + 1))
    else
        echo "  $(color_fail FAIL) T8.1 settings.json invalid"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("T8.1")
    fi

    # settings.local.json is gitignored/personal — absent on a clean checkout. Treat
    # absence as SKIP (consistent with S6 in harness-scenarios.sh); only FAIL on a
    # present-but-malformed file.
    if [[ ! -f "$ROOT/$HARNESS_DIR/settings.local.json" ]]; then
        echo "  SKIP T8.2 settings.local.json (gitignored/personal, absent)"
    elif jq -e . "$ROOT/$HARNESS_DIR/settings.local.json" >/dev/null 2>&1; then
        echo "  $(color_pass PASS) T8.2 settings.local.json valid JSON"
        PASS=$((PASS + 1))
    else
        echo "  $(color_fail FAIL) T8.2 settings.local.json invalid"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("T8.2")
    fi

    # T8.3: every referenced .sh in settings.json must exist & be executable
    mapfile -t HOOK_CMDS < <(jq -r '.hooks // {} | .. | objects | .command? // empty' "$SETTINGS_JSON")
    SH_HOOK_COUNT=0
    for cmd in "${HOOK_CMDS[@]}"; do
        sh_path=$(printf '%s' "$cmd" | grep -oE '\${CLAUDE_PROJECT_DIR}/[^ ]+\.sh' | head -1 || true)
        [[ -z "$sh_path" ]] && continue
        SH_HOOK_COUNT=$((SH_HOOK_COUNT + 1))
        abs="${sh_path/\$\{CLAUDE_PROJECT_DIR\}/$ROOT}"
        if [[ -x "$abs" ]]; then
            echo "  $(color_pass PASS) T8.3 executable: ${sh_path#\$\{CLAUDE_PROJECT_DIR\}/}"
            PASS=$((PASS + 1))
        else
            echo "  $(color_fail FAIL) T8.3 missing/non-exec: $abs"
            FAIL=$((FAIL + 1))
            FAILED_CASES+=("T8.3:$abs")
        fi
    done

    # T8.3b: no cosmetic echo Stop hook (removed in harness-trim cleanup)
    ECHO_STOP_COUNT=$(jq '[.hooks.Stop[]?.hooks[]?.command | select(startswith("echo"))] | length' "$SETTINGS_JSON")
    assert_eq "T8.3b no cosmetic Stop echo hook" "0" "$ECHO_STOP_COUNT"

    # T8.3c: how many project-local *.sh hooks are wired in settings.json. Post-cutover
    # this count is project-dependent (most hooks are plugin-owned via dhpk hooks.json),
    # so it is reported as a NOTE rather than gated to a fixed floor.
    echo "  NOTE T8.3c project-local sh-hook count: $SH_HOOK_COUNT"

    # T8.4: deny list must contain destructive git operations
    DENY_LIST=$(jq -r '.permissions.deny[]? // empty' "$SETTINGS_JSON")
    for needle in 'git push --force' 'git push -f' 'git reset --hard' 'git clean -f' 'git rebase'; do
        if printf '%s' "$DENY_LIST" | grep -qF "$needle"; then
            echo "  $(color_pass PASS) T8.4 deny contains: $needle"
            PASS=$((PASS + 1))
        else
            echo "  $(color_fail FAIL) T8.4 deny missing: $needle"
            FAIL=$((FAIL + 1))
            FAILED_CASES+=("T8.4:$needle")
        fi
    done
fi

# ============================================================
echo ""
echo "=== T9 rule cross-references ==="

# T9.1: every $HARNESS_DIR/rules/*.md mentioned in $MAIN_RULE exists. The pattern
# intentionally excludes `${...}`-prefixed refs (e.g. ${CLAUDE_PLUGIN_ROOT}/rules/…):
# those resolve into the installed plugin, not the project tree, so a local existence
# check would false-fail. Do NOT add `$`/`{`/`}` to the character class.
# Guard the silent-zero path: an absent main rule (e.g. a dhpk repo with no
# top-level CLAUDE.md), or one with no rules/*.md refs, must emit an explicit
# SKIP rather than running the loop zero times with no signal (matches T9.3).
if [[ ! -f "$ROOT/$MAIN_RULE" ]]; then
    echo "  SKIP T9.1 main rule absent ($MAIN_RULE)"
else
    T91_REFS=$(grep -oE '[a-zA-Z0-9._-]+/rules/[a-zA-Z/_.-]+\.md' "$ROOT/$MAIN_RULE" | sort -u)
    if [[ -z "$T91_REFS" ]]; then
        echo "  SKIP T9.1 no rules/*.md refs in $MAIN_RULE"
    else
        for ref in $T91_REFS; do
            if [[ -f "$ROOT/$ref" ]]; then
                echo "  $(color_pass PASS) T9.1 rule: $ref"
                PASS=$((PASS + 1))
            else
                echo "  $(color_fail FAIL) T9.1 missing: $ref"
                FAIL=$((FAIL + 1))
                FAILED_CASES+=("T9.1:$ref")
            fi
        done
    fi
fi

# T9.2: mandatory reviewer/role agents. Post-2026-06-12 cutover these are dhpk
# PLUGIN agents (no project-local agent file); the project's agents/INDEX.md is the
# chain-mapping SSOT and must reference each one. No grep escape hatch.
IDX="$ROOT/$HARNESS_DIR/agents/INDEX.md"
# Only assert the dhpk reviewer chain when the project actually adopts dhpk (pins a
# version or wires the plugin). A non-dhpk project may ship its own agents/INDEX.md
# with unrelated agents and must not false-fail on dhpk-namespaced names.
_dhpk_project=0
[[ -f "$ROOT/$HARNESS_DIR/dhpk-versions.json" ]] && _dhpk_project=1
[[ -f "$ROOT/$HARNESS_DIR/settings.local.json" ]] && jq -e '.pluginConfigs["dhpk@dhpk"]' "$ROOT/$HARNESS_DIR/settings.local.json" >/dev/null 2>&1 && _dhpk_project=1
if [[ ! -f "$IDX" ]]; then
    echo "  SKIP T9.2 agents/INDEX.md absent"
elif [[ "$_dhpk_project" -eq 0 ]]; then
    echo "  SKIP T9.2 not a dhpk-adopting project (no dhpk-versions.json / pluginConfigs)"
else
    for agent in dhpk:code-reviewer dhpk:database-reviewer dhpk:security-reviewer dhpk:tdd-guide dhpk:architect; do
        if grep -qF "$agent" "$IDX"; then
            echo "  $(color_pass PASS) T9.2 agent referenced: $agent"
            PASS=$((PASS + 1))
        else
            echo "  $(color_fail FAIL) T9.2 agent not in agents/INDEX.md: $agent"
            FAIL=$((FAIL + 1))
            FAILED_CASES+=("T9.2:$agent")
        fi
    done
fi

# T9.3: memory files referenced in MEMORY.md (backtick-quoted *.md tokens)
MEM_INDEX=""
if [[ -n "$MEMORY_DIR" ]]; then
    MEM_INDEX="$MEMORY_DIR/MEMORY.md"
fi
if [[ -f "$MEM_INDEX" ]]; then
    for ref in $(grep -oE '`[a-zA-Z][a-zA-Z0-9_/.-]+\.md`' "$MEM_INDEX" | tr -d '`' | sort -u); do
        # Skip path-prefixed rules entries (validated by T9.1) and home-prefixed.
        # Memory files are bare names or live under the real `archive/` subdir; any
        # other slash-containing token is a repo path embedded in prose (e.g.
        # `prompts/projects/.../CLAUDE.md`), not a memory file — skip those too.
        case "$ref" in
            "$HARNESS_DIR"/*|~/*) continue ;;
            archive/*) : ;;
            */*) continue ;;
        esac
        # Skip if the ref actually points to a project rule file (T9.1 covers it)
        if [[ -f "$ROOT/$HARNESS_DIR/rules/$ref" ]] || [[ -f "$ROOT/$HARNESS_DIR/rules/php/$ref" ]]; then
            continue
        fi
        if [[ -f "$MEMORY_DIR/$ref" ]]; then
            echo "  $(color_pass PASS) T9.3 memory: $ref"
            PASS=$((PASS + 1))
        else
            echo "  $(color_fail FAIL) T9.3 memory missing: $ref"
            FAIL=$((FAIL + 1))
            FAILED_CASES+=("T9.3:$ref")
        fi
    done
else
    echo "  SKIP T9.3 memory index not found"
fi

# ============================================================
echo ""
echo "=== T10 dhpk plugin wiring (review routing SSOT) ==="
# The full edit→review lifecycle (guard → sentinel → reminder) is plugin-owned end
# to end post-cutover. Rather than re-test plugin internals, assert the project still
# declares dhpk as the routing SSOT, then verify the project-local half of the
# lifecycle — that clear-sentinel.sh functions (the tool the runtime auto-clear hook
# and the orchestrator's stale-sentinel back-stop both use to clear a sentinel).
rm -f "$ARTIFACTS/sessions"/.pending-* 2>/dev/null
if [[ ! -f "$ROOT/$HARNESS_DIR/dhpk-versions.json" ]]; then
    echo "  SKIP T10.1 dhpk-versions.json absent (project may not pin a dhpk version)"
elif jq -e . "$ROOT/$HARNESS_DIR/dhpk-versions.json" >/dev/null 2>&1; then
    echo "  $(color_pass PASS) T10.1 dhpk-versions.json present + valid"
    PASS=$((PASS + 1))
else
    echo "  $(color_fail FAIL) T10.1 dhpk-versions.json present but invalid"
    FAIL=$((FAIL + 1))
    FAILED_CASES+=("T10.1")
fi

if [[ -f "$HOOKS/clear-sentinel.sh" ]]; then
    echo "x" > "$SENTINEL"
    bash "$HOOKS/clear-sentinel.sh" ".pending-review" "code-reviewer" >/dev/null 2>&1
    if [[ ! -f "$SENTINEL" ]]; then
        echo "  $(color_pass PASS) T10.2 local sentinel clear lifecycle"
        PASS=$((PASS + 1))
    else
        echo "  $(color_fail FAIL) T10.2 sentinel not cleared"
        FAIL=$((FAIL + 1))
        FAILED_CASES+=("T10.2")
    fi
else
    echo "  SKIP T10.2 clear-sentinel.sh (plugin-owned, not project-local)"
fi

# ============================================================
# trap handles sentinel + artifacts restore on exit

TOTAL=$((PASS + FAIL))
echo ""
echo "========================="
echo "Harness Test Report"
echo "PASS: $PASS / $TOTAL"
if [[ "$FAIL" -gt 0 ]]; then
    echo "FAIL: $FAIL"
    for c in "${FAILED_CASES[@]}"; do
        echo "  - $c"
    done
    echo "========================="
    exit 1
fi
echo "========================="
exit 0
