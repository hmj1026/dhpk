#!/usr/bin/env bash
# pre-commit-swift-build.sh — xcode-tooling module PreToolUse Bash hook.
#
# Intercepts `git commit*`. When the staged diff includes .swift files, runs a
# build (and tests unless skipped) so a broken build can't be committed. Failure
# exits 2 (Claude Code rejects the command). Mirrors the same gate that should
# run in CI.
#
# Skip mechanisms (priority order):
#   1. Commit message includes `[skip-swift-build]` (emergency; needs justification).
#   2. No staged .swift files.
#   3. Neither xcodebuild nor swift available, or no buildable unit found
#      (fail-soft: warn + exit 0 — never break a machine without the toolchain).
#
# Destination handling: the *build* step uses a device-name-free
# `generic/platform=iOS Simulator`, so it never breaks when a named default
# simulator (e.g. "iPhone 16") is missing on a newer Xcode. The *test* step needs
# a real simulator; it uses the configured destination, and auto-falls back to the
# first available iOS simulator when that one isn't installed (warn + skip tests if
# none exist — the build already gated the commit).
#
# Config (overridable via userConfig / project settings.local.json):
#   CLAUDE_PLUGIN_OPTION_XCODE_SCHEME          ("")  empty → xcodebuild path skipped (no guessing)
#   CLAUDE_PLUGIN_OPTION_XCODE_DESTINATION     ("")  test destination; empty → auto-pick an available simulator
#   CLAUDE_PLUGIN_OPTION_SWIFT_BUILD_SKIP_TESTS ("false") build only, no tests
#   CLAUDE_PLUGIN_OPTION_SWIFT_BUILD_TIMEOUT_SECS ("360")  build phase ceiling (xcodebuild build / swift build)
#   CLAUDE_PLUGIN_OPTION_SWIFT_TEST_TIMEOUT_SECS  ("480")  test phase ceiling (xcodebuild test / swift test)

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

if echo "$cmd" | grep -Fq '[skip-swift-build]'; then
    echo "[pre-commit-swift] [skip-swift-build] sentinel found; bypassing build gate" >&2
    exit 0
fi

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

staged="$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
[ -z "$staged" ] && exit 0

has_swift=0
while IFS= read -r f; do
    case "$f" in *.swift) has_swift=1; break ;; esac
done <<< "$staged"
[ "$has_swift" -eq 1 ] || exit 0

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 0
. "$(dirname "$0")/../../../scripts/hooks/_lib/load-project-config.sh"

SCHEME="${CLAUDE_PLUGIN_OPTION_XCODE_SCHEME:-}"
DEST="${CLAUDE_PLUGIN_OPTION_XCODE_DESTINATION:-}"          # test destination (named sim); empty → auto-pick
BUILD_DEST="generic/platform=iOS Simulator"                 # build needs no booted device → never goes stale
SKIP_TESTS="${CLAUDE_PLUGIN_OPTION_SWIFT_BUILD_SKIP_TESTS:-false}"
BUILD_TIMEOUT_SECS="${CLAUDE_PLUGIN_OPTION_SWIFT_BUILD_TIMEOUT_SECS:-360}"
TEST_TIMEOUT_SECS="${CLAUDE_PLUGIN_OPTION_SWIFT_TEST_TIMEOUT_SECS:-480}"
BUILD_TIMEOUT_CMD=""
TEST_TIMEOUT_CMD=""
if command -v timeout >/dev/null 2>&1; then
    BUILD_TIMEOUT_CMD="timeout $BUILD_TIMEOUT_SECS"
    TEST_TIMEOUT_CMD="timeout $TEST_TIMEOUT_SECS"
fi

# Emit `platform=iOS Simulator,name=<first available iPhone sim>`, or nothing.
first_available_ios_sim() {
    local name
    name="$(xcrun simctl list devices available 2>/dev/null \
        | grep -E '^[[:space:]]+iPhone ' \
        | head -1 \
        | sed -E 's/^[[:space:]]+//; s/ \([0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}\).*$//')"
    [ -n "$name" ] && printf 'platform=iOS Simulator,name=%s' "$name"
}

# True when a `…,name=X` destination names an installed simulator.
destination_available() {
    case "$1" in
        *name=*) ;;
        *) return 1 ;;
    esac
    local want="${1##*name=}"; want="${want%%,*}"
    # Escape ERE metacharacters — device names contain parens, e.g. "iPhone SE (3rd generation)".
    local escaped; escaped="$(printf '%s' "$want" | sed 's/[][\.*^$(){}+?|]/\\&/g')"
    xcrun simctl list devices available 2>/dev/null \
        | grep -qE "^[[:space:]]+${escaped} \("
}

# Decide build unit: prefer xcodebuild when an Xcode project/workspace + scheme
# exist; else SwiftPM when a Package.swift is present.
has_xcode_project=0
ls "$ROOT"/*.xcworkspace >/dev/null 2>&1 && has_xcode_project=1
ls "$ROOT"/*.xcodeproj  >/dev/null 2>&1 && has_xcode_project=1

if command -v xcodebuild >/dev/null 2>&1 && [ "$has_xcode_project" -eq 1 ]; then
    if [ -z "$SCHEME" ]; then
        echo "[pre-commit-swift] WARN: xcode project present but xcode_scheme unset; skipping build gate (set pluginConfigs.dhpk@dhpk.options.xcode_scheme to enable)" >&2
        exit 0
    fi
    echo "[pre-commit-swift] staged .swift detected; xcodebuild build (scheme=$SCHEME, dest=$BUILD_DEST)..." >&2
    $BUILD_TIMEOUT_CMD xcodebuild build -scheme "$SCHEME" -destination "$BUILD_DEST" -quiet >&2
    rc=$?
    if [ "$rc" -ne 0 ]; then
        if [ "$rc" -eq 124 ]; then
            echo "[pre-commit-swift] FAIL: xcodebuild build timed out after ${BUILD_TIMEOUT_SECS}s (possible hang — stuck code-signing prompt, corrupt DerivedData — or a genuinely large cold build; raise swift_build_timeout_secs if the latter). Investigate or add '[skip-swift-build]' to the commit msg." >&2
        else
            echo "[pre-commit-swift] FAIL: build failed. Fix or add '[skip-swift-build]' to the commit msg." >&2
        fi
        exit 2
    fi
    if [ "$SKIP_TESTS" != "true" ]; then
        test_dest="$DEST"
        if [ -z "$test_dest" ] || ! destination_available "$test_dest"; then
            fallback="$(first_available_ios_sim)"
            if [ -n "$fallback" ]; then
                [ -n "$test_dest" ] && echo "[pre-commit-swift] WARN: test destination '$test_dest' unavailable; falling back to '$fallback' (run 'xcrun simctl list devices available' to see installed sims)" >&2
                test_dest="$fallback"
            else
                echo "[pre-commit-swift] WARN: no iOS simulator available; skipping tests (build passed)" >&2
                test_dest=""
            fi
        fi
        if [ -n "$test_dest" ]; then
            echo "[pre-commit-swift] xcodebuild test (scheme=$SCHEME, dest=$test_dest)..." >&2
            $TEST_TIMEOUT_CMD xcodebuild test -scheme "$SCHEME" -destination "$test_dest" -quiet >&2
            rc=$?
            if [ "$rc" -ne 0 ]; then
                if [ "$rc" -eq 124 ]; then
                    echo "[pre-commit-swift] FAIL: xcodebuild test timed out after ${TEST_TIMEOUT_SECS}s (possible hang — simulator boot stall, deadlocked test — or a genuinely large cold test run; raise swift_test_timeout_secs if the latter). Investigate or add '[skip-swift-build]' to the commit msg." >&2
                else
                    echo "[pre-commit-swift] FAIL: tests failed. Fix or add '[skip-swift-build]' to the commit msg." >&2
                fi
                exit 2
            fi
        fi
    fi
    if [ "$SKIP_TESTS" = "true" ]; then echo "[pre-commit-swift] OK: build passed (tests skipped)" >&2; else echo "[pre-commit-swift] OK: build + tests passed" >&2; fi
    exit 0
fi

if command -v swift >/dev/null 2>&1 && [ -f "$ROOT/Package.swift" ]; then
    echo "[pre-commit-swift] staged .swift detected; swift build..." >&2
    $BUILD_TIMEOUT_CMD swift build >&2
    rc=$?
    if [ "$rc" -ne 0 ]; then
        if [ "$rc" -eq 124 ]; then
            echo "[pre-commit-swift] FAIL: swift build timed out after ${BUILD_TIMEOUT_SECS}s (possible hang or a genuinely large cold build; raise swift_build_timeout_secs if the latter). Investigate or add '[skip-swift-build]' to the commit msg." >&2
        else
            echo "[pre-commit-swift] FAIL: swift build failed. Fix or add '[skip-swift-build]' to the commit msg." >&2
        fi
        exit 2
    fi
    if [ "$SKIP_TESTS" != "true" ]; then
        echo "[pre-commit-swift] swift test..." >&2
        $TEST_TIMEOUT_CMD swift test >&2
        rc=$?
        if [ "$rc" -ne 0 ]; then
            if [ "$rc" -eq 124 ]; then
                echo "[pre-commit-swift] FAIL: swift test timed out after ${TEST_TIMEOUT_SECS}s (possible hang or a genuinely large test run; raise swift_test_timeout_secs if the latter). Investigate or add '[skip-swift-build]' to the commit msg." >&2
            else
                echo "[pre-commit-swift] FAIL: swift test failed. Fix or add '[skip-swift-build]' to the commit msg." >&2
            fi
            exit 2
        fi
    fi
    echo "[pre-commit-swift] OK: swift build/test passed" >&2
    exit 0
fi

echo "[pre-commit-swift] WARN: no xcodebuild+scheme or swift+Package.swift found; skipping build gate" >&2
exit 0
