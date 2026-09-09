#!/usr/bin/env bash
# test-hooks.sh — smoke tests for the lifecycle + anti-rationalization hooks.
#
# Covers userpromptsubmit-skill-hint / precompact-archive / postcompact-restore /
# subagent-stop-verify / pretool-git-gate (protected-branch slot). The Review
# Sentinel `.pending-*` mechanism this script used to also exercise (sentinel
# checkpoint/restore, subagent-stop-verify auto-clear, stop-failure-log.sh,
# pretool-git-gate's sentinel-commit slot, clear-sentinel.sh, stop-review-
# reminder.sh, post-edit-remind/dispatch.sh) was retired with the rest of
# Sentinel (#376/#377) — see docs/adr/0018-production-migration-observation-checkpoint.md.
#
# Each case runs the real hook against an isolated throwaway git repo created
# with `mktemp -d`, so nothing touches the developer's working tree. The repo's
# git toplevel (resolved via `git rev-parse`) is used for every path assertion
# so checks stay aligned with what the hook itself computes — symlinked /tmp
# (e.g. macOS /private/tmp) cannot cause false negatives.
#
# Pure bash + jq/python3 (no bats / jest). Output format mirrors
# validate-harness.sh: [OK]/[FAIL] lines + a final tally.
#
# Exit codes: 0 = all green, 1 = any FAIL.
set -o pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOOKS="$PLUGIN_ROOT/scripts/hooks"
export CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"

PASS=0
FAIL=0
TMP_DIRS=()

ok()   { echo "  [OK] $*"; PASS=$((PASS+1)); }
fail() { echo "  [FAIL] $*"; FAIL=$((FAIL+1)); }

cleanup() {
    for d in "${TMP_DIRS[@]}"; do
        [ -n "$d" ] && rm -rf "$d" 2>/dev/null || true
    done
}
trap cleanup EXIT

# make_repo — create an isolated git repo on branch `main`, echo its real
# toplevel path. Forces branch name via symbolic-ref (works on unborn HEAD,
# avoids git-version-dependent `init -b`).
make_repo() {
    local d
    d="$(mktemp -d)"
    git init -q "$d"
    git -C "$d" symbolic-ref HEAD refs/heads/main 2>/dev/null || true
    git -C "$d" -c user.email=t@t.test -c user.name=test commit -q --allow-empty -m init
    TMP_DIRS+=("$d")
    ( cd "$d" && git rev-parse --show-toplevel )
}

# run_hook <repo> <hook-basename> <stdin-payload> [ENV=val ...]
# Captures stdout to STDOUT_F, stderr to STDERR_F, exit code to RC.
# NOTE: advisory hooks emit user/model-facing text as JSON on STDOUT
# (systemMessage / additionalContext) — exit-0 stderr is inert per the hook
# contract — so content assertions grep STDOUT_F. exit-2 block paths still use
# stderr (checked via RC).
STDOUT_F=""
STDERR_F=""
RC=0
run_hook() {
    local repo="$1" hook="$2" payload="$3"
    shift 3
    STDOUT_F="$(mktemp)"
    STDERR_F="$(mktemp)"
    TMP_DIRS+=("$STDOUT_F" "$STDERR_F")
    (
        cd "$repo" || exit 99
        export CLAUDE_PROJECT_DIR="$repo"
        for kv in "$@"; do export "${kv?}"; done
        printf '%s' "$payload" | bash "$HOOKS/$hook"
    ) >"$STDOUT_F" 2>"$STDERR_F"
    RC=$?
}

sess_dir() { printf '%s/.claude/artifacts/sessions' "$1"; }

# ---------------------------------------------------------------------------
echo "== 1. userpromptsubmit-skill-hint.sh =="
repo="$(make_repo)"

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"please fix this bug for me"}'
if grep -q 'dhpk:flow-guide' "$STDOUT_F" && grep -q 'additionalContext' "$STDOUT_F"; then ok "english bug prompt → /dhpk:flow-guide additionalContext"; else fail "english bug prompt produced no flow-guide hint ($(cat "$STDOUT_F"))"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"幫我修一個 bug 好嗎"}'
if grep -q 'dhpk:flow-guide' "$STDOUT_F"; then ok "CJK bug prompt → /dhpk:flow-guide hint"; else fail "CJK bug prompt produced no hint ($(cat "$STDOUT_F"))"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"/dhpk:foo run something"}'
if [ ! -s "$STDOUT_F" ]; then ok "slash-prefixed prompt → no hint"; else fail "slash-prefixed prompt emitted output ($(cat "$STDOUT_F"))"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh ''
if [ "$RC" -eq 0 ] && [ ! -s "$STDOUT_F" ]; then ok "empty payload → exit 0, silent"; else fail "empty payload not handled (rc=$RC)"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"please fix this bug for me"}' DHPK_DISABLE_SKILL_HINT=1
if [ ! -s "$STDOUT_F" ]; then ok "DHPK_DISABLE_SKILL_HINT=1 → silent"; else fail "disable env did not silence hint ($(cat "$STDOUT_F"))"; fi

echo ""
echo "== 2. precompact-archive.sh =="
repo="$(make_repo)"
run_hook "$repo" precompact-archive.sh '{"session_id":"testsess"}'
handoff="$repo/.claude/artifacts/checkpoints/handoff-latest.md"
if [ -e "$handoff" ]; then ok "work handoff doc created"; else fail "no handoff-latest.md written"; fi
if grep -q 'Work Handoff' "$handoff" 2>/dev/null; then ok "handoff doc has expected header"; else fail "handoff doc missing header"; fi

echo ""
echo "== 3. postcompact-restore.sh =="
# Reuse the repo + handoff doc from section 2 (same throwaway repo).
run_hook "$repo" postcompact-restore.sh '{}'
if grep -q 'work handoff' "$STDOUT_F" 2>/dev/null && grep -q 'additionalContext' "$STDOUT_F" 2>/dev/null; then
    ok "handoff doc re-injected via additionalContext"
else
    fail "handoff doc not re-injected ($(cat "$STDOUT_F"))"
fi

repo2="$(make_repo)"
run_hook "$repo2" postcompact-restore.sh '{}'
if [ "$RC" -eq 0 ] && [ ! -s "$STDOUT_F" ]; then ok "no handoff doc → silent no-op"; else fail "expected silent no-op with no handoff doc (rc=$RC, $(cat "$STDOUT_F"))"; fi

echo ""
echo "== 4. subagent-stop-verify.sh =="
repo="$(make_repo)"
s="$(sess_dir "$repo")"; mkdir -p "$s"
printf 'line\tdhpk:fast-worker\n' > "$s/.active-fast-worker"
run_hook "$repo" subagent-stop-verify.sh '{"agent_type":"dhpk:fast-worker"}'
if [ "$RC" -eq 0 ] && [ ! -f "$s/.active-fast-worker" ]; then ok "fast-worker stop clears its active-liveness marker"; else fail "active-fast-worker marker not cleared (rc=$RC)"; fi

run_hook "$repo" subagent-stop-verify.sh '{"agent_type":"dhpk:architect"}'
if [ "$RC" -eq 0 ] && [ ! -s "$STDOUT_F" ]; then ok "non-fast-worker agent → silent no-op"; else fail "non-fast-worker agent not silent (rc=$RC, $(cat "$STDOUT_F"))"; fi

echo ""
echo "== 7. pretool-git-gate.sh — protected-branch slot =="
repo="$(make_repo)"  # default branch = main (protected)
run_hook "$repo" pretool-git-gate.sh '{"tool_input":{"command":"git commit -m wip"}}'
if grep -q 'REMINDER' "$STDOUT_F"; then ok "commit on main → warn (systemMessage)"; else fail "no warn committing on main ($(cat "$STDOUT_F"))"; fi

run_hook "$repo" pretool-git-gate.sh '{"tool_input":{"command":"git commit -m wip"}}' DHPK_BRANCH_SAFETY=block
if [ "$RC" -eq 2 ] && grep -q 'BLOCKED' "$STDERR_F"; then ok "block mode on main → exit 2 + stderr"; else fail "block mode rc=$RC (expected 2)"; fi

git -C "$repo" checkout -q -b feature/x
run_hook "$repo" pretool-git-gate.sh '{"tool_input":{"command":"git commit -m wip"}}'
if [ ! -s "$STDOUT_F" ]; then ok "commit on feature/x → silent"; else fail "warned on unprotected branch ($(cat "$STDOUT_F"))"; fi

run_hook "$repo" pretool-git-gate.sh '{"tool_input":{"command":"git commit -m wip"}}' DHPK_BRANCH_SAFETY=off
if [ "$RC" -eq 0 ] && [ ! -s "$STDOUT_F" ] && [ ! -s "$STDERR_F" ]; then ok "off mode → silent exit 0"; else fail "off mode not silent (rc=$RC)"; fi

echo ""
echo "== 8. learning-db.sh (Phase 2.1) =="
ljson_path() { printf '%s/.claude/artifacts/learning.jsonl' "$1"; }

# 8a. lib: record + aggregate + confidence ordering.
repo="$(make_repo)"
(
    cd "$repo" || exit 1
    export CLAUDE_PROJECT_DIR="$repo" DHPK_LEARNING_DB=1
    . "$HOOKS/_lib/learning-db.sh"
    ldb_record success "review:code-reviewer"
    ldb_record success "review:code-reviewer"
    ldb_record success "review:code-reviewer"
    ldb_record failure "agent:db-reviewer" "exit=1"
    ldb_top 5 1 > "$repo/_top.txt" 2>/dev/null
    ldb_graduation_candidates 60 3 > "$repo/_grad.txt" 2>/dev/null
)
lj="$(ljson_path "$repo")"
if [ -f "$lj" ] && [ "$(wc -l < "$lj")" -eq 4 ]; then ok "ldb_record appended 4 events"; else fail "expected 4 events, got $( [ -f "$lj" ] && wc -l < "$lj" || echo 0 )"; fi
if head -1 "$repo/_top.txt" | grep -q 'review:code-reviewer'; then ok "ldb_top ranks 3x success highest"; else fail "ldb_top ordering wrong ($(cat "$repo/_top.txt"))"; fi
if grep -q 'review:code-reviewer' "$repo/_grad.txt" && ! grep -q 'db-reviewer' "$repo/_grad.txt"; then ok "graduation filters by confidence+obs"; else fail "graduation filter wrong ($(cat "$repo/_grad.txt"))"; fi

# 8b/8c/8d: clear-sentinel.sh, subagent-stop-verify.sh's reviewer-failure
# logging, and stop-failure-log.sh were all learning-db producers keyed to
# Review Sentinel state and were retired with it (#376/#377). learning-db.sh
# itself (8a) and its SessionStart consumer (8f) are unaffected.

# 8f. SessionStart surfaces [learned-context] when enabled.
repo="$(make_repo)"
(
    cd "$repo" || exit 1
    export CLAUDE_PROJECT_DIR="$repo" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" DHPK_LEARNING_DB=1
    . "$HOOKS/_lib/learning-db.sh"
    ldb_record success "review:code-reviewer"
    ldb_record success "review:code-reviewer"
    printf '{"source":"startup"}' | bash "$HOOKS/session-start.sh" > "$repo/_ss.out" 2>/dev/null
)
if grep -q 'learned-context' "$repo/_ss.out"; then ok "SessionStart injects [learned-context]"; else fail "no learned-context block emitted"; fi
# Disabled → no block.
repo="$(make_repo)"
(
    cd "$repo" || exit 1
    export CLAUDE_PROJECT_DIR="$repo" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
    printf '{"source":"startup"}' | bash "$HOOKS/session-start.sh" > "$repo/_ss2.out" 2>/dev/null
)
if ! grep -q 'learned-context' "$repo/_ss2.out"; then ok "SessionStart silent when DB disabled"; else fail "learned-context emitted while disabled"; fi

echo ""
echo "== 9. stop-advisory-dispatch.sh (Phase 2.2) =="
# 9a. enabled: 3 clean citations of an existing entry → count=3, rule candidate.
repo="$(make_repo)"
gmem="$(mktemp -d)"; TMP_DIRS+=("$gmem")
gout="$(mktemp -d)"; TMP_DIRS+=("$gout")
gtx="$(mktemp)";     TMP_DIRS+=("$gtx")
printf '# trap example\n' > "$gmem/trap_foo_example.md"
printf 'see memory/trap_foo_example.md here\n' > "$gtx"
for _r in 1 2 3; do
    (
        cd "$repo" || exit 1
        export CLAUDE_PROJECT_DIR="$repo" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
               DHPK_GRADUATION_SCAN=1 CLAUDE_HOOK_TEST_MODE=1 CLAUDE_HOOK_TEST_OUTDIR="$gout" \
               CLAUDE_HOOK_MEMORY_DIR="$gmem" CLAUDE_HOOK_MIN_SPAN_HOURS=0 CLAUDE_HOOK_MIN_DISTINCT_DATES=1
        printf '{"transcript_path":"%s"}' "$gtx" | bash "$HOOKS/stop-advisory-dispatch.sh" >/dev/null 2>&1
    )
done
cj="$gout/memory-usage-counts.json"
if [ -f "$cj" ] && [ "$(jq -r '.entries.trap_foo_example.count' "$cj" 2>/dev/null)" = "3" ]; then ok "3 sessions → count=3"; else fail "count not accumulated ($( [ -f "$cj" ] && jq -c '.entries' "$cj" || echo no-file ))"; fi
if [ -f "$cj" ] && [ "$(jq -r '.entries.trap_foo_example.confidence' "$cj" 2>/dev/null)" = "0.8" ]; then ok "confidence rose to 0.8 (3 clean sessions)"; else fail "confidence wrong"; fi
if [ -f "$gout/graduation-candidates.md" ] && grep -q 'trap_foo_example' "$gout/graduation-candidates.md" && grep -q '| rule |' "$gout/graduation-candidates.md"; then ok "promoted to rule candidate + report bootstrapped from template"; else fail "candidate/report missing"; fi

# 9b. existence gate: citing an entry with no memory file → not counted.
repo="$(make_repo)"
gmem="$(mktemp -d)"; TMP_DIRS+=("$gmem")
gout="$(mktemp -d)"; TMP_DIRS+=("$gout")
gtx="$(mktemp)";     TMP_DIRS+=("$gtx")
printf 'see memory/ghost_entry_x.md (no such file)\n' > "$gtx"
(
    cd "$repo" || exit 1
    export CLAUDE_PROJECT_DIR="$repo" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
           DHPK_GRADUATION_SCAN=1 CLAUDE_HOOK_TEST_MODE=1 CLAUDE_HOOK_TEST_OUTDIR="$gout" \
           CLAUDE_HOOK_MEMORY_DIR="$gmem" CLAUDE_HOOK_MIN_SPAN_HOURS=0 CLAUDE_HOOK_MIN_DISTINCT_DATES=1
    printf '{"transcript_path":"%s"}' "$gtx" | bash "$HOOKS/stop-advisory-dispatch.sh" >/dev/null 2>&1
)
cj="$gout/memory-usage-counts.json"
if [ ! -f "$cj" ] || [ "$(jq -r '.entries.ghost_entry_x // "absent"' "$cj" 2>/dev/null)" = "absent" ]; then ok "existence gate: missing memory file not counted"; else fail "ghost entry was counted"; fi

# 9c. opt-in gate: disabled → no state written.
repo="$(make_repo)"
gout="$(mktemp -d)"; TMP_DIRS+=("$gout")
gtx="$(mktemp)";     TMP_DIRS+=("$gtx")
printf 'see memory/trap_foo_example.md\n' > "$gtx"
(
    cd "$repo" || exit 1
    export CLAUDE_PROJECT_DIR="$repo" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
           DHPK_GRADUATION_SCAN=0 CLAUDE_HOOK_TEST_MODE=1 CLAUDE_HOOK_TEST_OUTDIR="$gout"
    printf '{"transcript_path":"%s"}' "$gtx" | bash "$HOOKS/stop-advisory-dispatch.sh" >/dev/null 2>&1
)
if [ -z "$(ls -A "$gout" 2>/dev/null)" ]; then ok "graduation disabled → no state written"; else fail "wrote state while disabled"; fi

echo ""
echo "== 10. pre-route.sh (Phase 2.3 Smart Router) =="
PR="$PLUGIN_ROOT/skills/flow-guide/scripts/pre-route.sh"

out="$(bash "$PR" "please fix this login bug")"
if [ "$(printf '%s' "$out" | cut -f1)" = "MATCH" ] && [ "$(printf '%s' "$out" | cut -f2)" = "flow-guide" ]; then ok "english bug → MATCH flow-guide"; else fail "english bug route wrong ($out)"; fi

out="$(bash "$PR" "幫我修一個 bug")"
if [ "$(printf '%s' "$out" | cut -f2)" = "flow-guide" ]; then ok "CJK bug → MATCH flow-guide"; else fail "CJK bug route wrong ($out)"; fi

out="$(bash "$PR" "review my diff please")"
if [ "$(printf '%s' "$out" | cut -f2)" = "review-pending" ]; then ok "review → MATCH review-pending"; else fail "review route wrong ($out)"; fi

out="$(bash "$PR" "run a security audit for owasp issues")"
if [ "$(printf '%s' "$out" | cut -f2)" = "change-verdict" ]; then ok "security → MATCH change-verdict (codex-free default)"; else fail "security route wrong ($out)"; fi

out="$(bash "$PR" "make me a sandwich")"
if [ "$out" = "NO_MATCH" ]; then ok "unmatched request → NO_MATCH"; else fail "expected NO_MATCH ($out)"; fi

out="$(bash "$PR" "")"
if [ "$out" = "NO_QUERY" ]; then ok "empty request → NO_QUERY"; else fail "expected NO_QUERY ($out)"; fi

out="$(printf 'add a new feature endpoint' | bash "$PR")"
if [ "$(printf '%s' "$out" | cut -f2)" = "flow-guide" ]; then ok "stdin path → MATCH flow-guide"; else fail "stdin route wrong ($out)"; fi

echo ""
echo "== 11. (retired) stop-review-reminder.sh =="
echo "  retired with Review Sentinel (#376/#377) — nothing to remind about without .pending-* files"

echo ""
echo "== 12. _lib/json-out.sh (advisory output contract) =="
(
    . "$HOOKS/_lib/json-out.sh"
    emit_system_message $'已完成 "x"\nline2' > "$PLUGIN_ROOT/_jo1.txt" 2>/dev/null
    emit_additional_context "UserPromptSubmit" 'hint /dhpk:foo' > "$PLUGIN_ROOT/_jo2.txt" 2>/dev/null
    emit_system_message "" > "$PLUGIN_ROOT/_jo3.txt" 2>/dev/null
)
if [ -n "$(command -v jq python3 2>/dev/null)" ] || command -v python3 >/dev/null 2>&1; then
    if python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["systemMessage"].startswith("已完成")' "$PLUGIN_ROOT/_jo1.txt" 2>/dev/null; then ok "emit_system_message → valid JSON, CJK+quote+newline safe"; else fail "system_message JSON invalid"; fi
    if python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); assert d["hookSpecificOutput"]["additionalContext"]=="hint /dhpk:foo"' "$PLUGIN_ROOT/_jo2.txt" 2>/dev/null; then ok "emit_additional_context → valid JSON"; else fail "additional_context JSON invalid"; fi
fi
if [ ! -s "$PLUGIN_ROOT/_jo3.txt" ]; then ok "emit_system_message '' → no-op (empty)"; else fail "empty message emitted output"; fi
rm -f "$PLUGIN_ROOT/_jo1.txt" "$PLUGIN_ROOT/_jo2.txt" "$PLUGIN_ROOT/_jo3.txt"

echo ""
echo "== 13. session-start.sh source branching (P1-3) =="
repo="$(make_repo)"
run_hook "$repo" session-start.sh '{"source":"startup"}' CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS=ghost
if grep -q 'docker=' "$STDOUT_F" && ! grep -q 'skipped on' "$STDOUT_F"; then ok "startup → docker probed (FULL_INIT)"; else fail "startup did not probe docker ($(cat "$STDOUT_F"))"; fi
run_hook "$repo" session-start.sh '{"source":"compact"}' CLAUDE_PLUGIN_OPTION_DOCKER_CONTAINERS=ghost
if grep -q 'skipped on compact' "$STDOUT_F"; then ok "compact → docker probe skipped"; else fail "compact did not skip docker ($(cat "$STDOUT_F"))"; fi

echo ""
echo "== 14. session-end.sh (P1-2) =="
repo="$(make_repo)"
run_hook "$repo" session-end.sh '{"reason":"clear"}'
if [ "$RC" -eq 0 ]; then ok "session-end exits 0"; else fail "session-end rc=$RC"; fi

echo ""
echo "== 15. (retired) module findings flow via post-edit-dispatch.sh =="
echo "  post-edit-remind.sh/post-edit-dispatch.sh (the sentinel router) were"
echo "  retired with Review Sentinel (#376/#377); .module-findings had no"
echo "  producer independent of that router even before retirement"

echo ""
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
    echo "FAIL: $FAIL 個失敗 / $PASS 個通過"
    exit 1
fi
echo "PASS: 全部通過（$PASS 個檢查）"
exit 0
