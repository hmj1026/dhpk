#!/usr/bin/env bash
# check-golden.sh — deploy-list golden regression
#
# Suite:
#   generic — synthetic git fixtures. Each fixture script
#             (evals/generic/fixtures/fixture-*.sh) is self-contained:
#             spins a tmp repo, runs deploy-list with a known preset, prints
#             output to stdout. We diff its stdout byte-identical against
#             evals/generic/expected/expected-<name>.txt.
#
# Projects that need SHA-bound goldens (asserting byte-identical output
# against frozen commits in their own history) can add a sibling suite under
# evals/<project-name>/ and extend this script. The shipped version stays
# project-agnostic.
#
# Usage:
#   check-golden.sh           # run all fixtures
#   check-golden.sh --update  # regenerate expected outputs
#
# Exit: 0 = all fixtures pass; 1 = any failure.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EVAL_DIR="$SKILL_DIR/evals"
DEPLOY_LIST="$SCRIPT_DIR/deploy-list.sh"

MODE="check"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --update)  MODE="update"; shift ;;
        *)         shift ;;
    esac
done

GEN_PASS=0; GEN_FAIL=0; GEN_RAN=0

run_generic_suite() {
    local gen_dir="$EVAL_DIR/generic"
    if [[ ! -d "$gen_dir" ]]; then
        echo "[skip] generic suite: $gen_dir not found" >&2
        return
    fi

    local fixtures_dir="$gen_dir/fixtures"
    local expected_dir="$gen_dir/expected"

    if [[ ! -d "$fixtures_dir" ]]; then
        echo "[FAIL] generic suite: fixtures dir missing — $fixtures_dir" >&2
        GEN_FAIL=$((GEN_FAIL+1))
        return
    fi
    mkdir -p "$expected_dir"

    local f
    for f in "$fixtures_dir"/fixture-*.sh; do
        [[ -f "$f" ]] || continue
        local name expected actual
        name=$(basename "$f" .sh)
        expected="$expected_dir/expected-${name}.txt"
        GEN_RAN=$((GEN_RAN+1))

        # Capture stdout only — fixture scripts use 2>/dev/null internally; the
        # extra 2>/dev/null here is a belt-and-braces.
        actual=$(bash "$f" 2>/dev/null)

        if [[ "$MODE" == "update" ]]; then
            printf '%s\n' "$actual" > "$expected"
            echo "[updated] generic:$name → $expected"
            continue
        fi

        if [[ ! -f "$expected" ]]; then
            echo "[FAIL] generic:$name — missing $expected (run with --update to create)"
            GEN_FAIL=$((GEN_FAIL+1))
            continue
        fi

        local expected_content
        expected_content=$(cat "$expected")
        if [[ "$actual" == "$expected_content" ]]; then
            echo "[PASS] generic:$name"
            GEN_PASS=$((GEN_PASS+1))
        else
            echo "[FAIL] generic:$name — diff:"
            diff <(printf '%s\n' "$expected_content") <(printf '%s\n' "$actual") | head -40
            GEN_FAIL=$((GEN_FAIL+1))
        fi
    done
}

run_generic_suite

echo ""
if [[ "$MODE" == "update" ]]; then
    echo "Goldens updated. Run check-golden.sh again to verify byte-identical."
    exit 0
fi

[[ "$GEN_RAN" -gt 0 ]] && echo "generic suite: $GEN_PASS pass, $GEN_FAIL fail"

[[ "$GEN_FAIL" -gt 0 ]] && exit 1 || exit 0
