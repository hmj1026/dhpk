#!/usr/bin/env bash
# test-hooks.sh — smoke tests for the Phase 1 lifecycle + anti-rationalization hooks.
#
# Covers the 7 hooks added in 0.5.0:
#   userpromptsubmit-skill-hint / precompact-archive / postcompact-restore /
#   subagent-stop-verify / stop-failure-log / pretool-sentinel-gate /
#   pretool-branch-safety
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
# Captures stderr to global STDERR_F and exit code to global RC.
STDERR_F=""
RC=0
run_hook() {
    local repo="$1" hook="$2" payload="$3"
    shift 3
    STDERR_F="$(mktemp)"
    TMP_DIRS+=("$STDERR_F")
    (
        cd "$repo" || exit 99
        export CLAUDE_PROJECT_DIR="$repo"
        for kv in "$@"; do export "${kv?}"; done
        printf '%s' "$payload" | bash "$HOOKS/$hook"
    ) 2>"$STDERR_F"
    RC=$?
}

sess_dir() { printf '%s/.claude/artifacts/sessions' "$1"; }
mk_sentinel() {
    local repo="$1" name="$2" body="${3:-stub}"
    local s; s="$(sess_dir "$repo")"
    mkdir -p "$s"
    printf '%s' "$body" > "$s/$name"
}

# ---------------------------------------------------------------------------
echo "== 1. userpromptsubmit-skill-hint.sh =="
repo="$(make_repo)"

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"please fix this bug for me"}'
if grep -q 'dhpk:adaptive-dev-workflow' "$STDERR_F"; then ok "english bug prompt → /dhpk:adaptive-dev-workflow hint"; else fail "english bug prompt produced no adaptive hint ($(cat "$STDERR_F"))"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"幫我修一個 bug 好嗎"}'
if grep -q 'dhpk:adaptive-dev-workflow' "$STDERR_F"; then ok "CJK bug prompt → /dhpk:adaptive-dev-workflow hint"; else fail "CJK bug prompt produced no hint ($(cat "$STDERR_F"))"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"/dhpk:foo run something"}'
if [ ! -s "$STDERR_F" ]; then ok "slash-prefixed prompt → no hint"; else fail "slash-prefixed prompt emitted output ($(cat "$STDERR_F"))"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh ''
if [ "$RC" -eq 0 ] && [ ! -s "$STDERR_F" ]; then ok "empty payload → exit 0, silent"; else fail "empty payload not handled (rc=$RC)"; fi

run_hook "$repo" userpromptsubmit-skill-hint.sh '{"prompt":"please fix this bug for me"}' DHPK_DISABLE_SKILL_HINT=1
if [ ! -s "$STDERR_F" ]; then ok "DHPK_DISABLE_SKILL_HINT=1 → silent"; else fail "disable env did not silence hint ($(cat "$STDERR_F"))"; fi

echo ""
echo "== 2. precompact-archive.sh =="
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review" "path/to/file.php"
run_hook "$repo" precompact-archive.sh '{"session_id":"testsess"}'
ckpt="$repo/.claude/artifacts/checkpoints/latest.json"
if [ -e "$ckpt" ]; then ok "checkpoint latest.json created"; else fail "no latest.json checkpoint"; fi
if [ -e "$ckpt" ] && [ "$(jq -r '.sentinels | has(".pending-review")' "$ckpt" 2>/dev/null)" = "true" ]; then
    ok "checkpoint captured .pending-review sentinel"
else
    fail "checkpoint missing .pending-review sentinel"
fi
if [ -e "$ckpt" ] && [ "$(jq -r '.sentinels[".pending-review"]' "$ckpt" 2>/dev/null)" = "path/to/file.php" ]; then
    ok "checkpoint preserved sentinel body"
else
    fail "checkpoint body mismatch"
fi

echo ""
echo "== 3. postcompact-restore.sh =="
# Reuse the repo + checkpoint from section 2 (same throwaway repo).
rm -f "$(sess_dir "$repo")/.pending-review"
run_hook "$repo" postcompact-restore.sh '{}'
restored="$(sess_dir "$repo")/.pending-review"
if [ -f "$restored" ]; then ok "missing sentinel restored from checkpoint"; else fail "sentinel not restored"; fi
if [ -f "$restored" ] && [ "$(cat "$restored")" = "path/to/file.php" ]; then ok "restored body matches archived body"; else fail "restored body mismatch"; fi

# No-overwrite case: sentinel already present with live content.
printf '%s' "LIVE-EDIT" > "$restored"
run_hook "$repo" postcompact-restore.sh '{}'
if [ "$(cat "$restored")" = "LIVE-EDIT" ]; then ok "existing sentinel not overwritten"; else fail "live sentinel was clobbered ($(cat "$restored"))"; fi

echo ""
echo "== 4. subagent-stop-verify.sh =="
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review"
log="$repo/.claude/artifacts/agent-failures.log"
run_hook "$repo" subagent-stop-verify.sh '{"subagent_type":"code-reviewer","exit_status":1}'
if [ -f "$log" ] && grep -q 'exit=1' "$log"; then ok "failed reviewer logged (exit=1)"; else fail "failure not logged"; fi
if grep -q 'REMINDER\|FAILURE' "$STDERR_F" 2>/dev/null; then ok "failure surfaced on stderr"; else fail "no stderr summary on failure"; fi

# Success but uncleared sentinel.
run_hook "$repo" subagent-stop-verify.sh '{"subagent_type":"code-reviewer","exit_status":0}'
if grep -q 'uncleared' "$log"; then ok "success+uncleared sentinel logged"; else fail "uncleared sentinel not logged"; fi

# Non-reviewer agent → silent, no log growth.
before="$(wc -l < "$log" 2>/dev/null || echo 0)"
run_hook "$repo" subagent-stop-verify.sh '{"subagent_type":"Explore","exit_status":0}'
after="$(wc -l < "$log" 2>/dev/null || echo 0)"
if [ "$before" = "$after" ]; then ok "non-reviewer agent → no log entry"; else fail "non-reviewer agent logged unexpectedly"; fi

echo ""
echo "== 5. stop-failure-log.sh =="
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review"
run_hook "$repo" stop-failure-log.sh '{"reason":"test crash"}'
slog="$repo/.claude/artifacts/stop-failures.log"
if [ -f "$slog" ] && grep -q 'active_sentinels=.pending-review' "$slog"; then ok "active sentinel recorded"; else fail "stop-failures.log missing sentinel"; fi
if grep -q 'reason=test crash' "$slog"; then ok "reason captured from payload"; else fail "reason not captured"; fi

repo2="$(make_repo)"
run_hook "$repo2" stop-failure-log.sh '{}'
slog2="$repo2/.claude/artifacts/stop-failures.log"
if [ -f "$slog2" ] && grep -q 'active_sentinels=none' "$slog2"; then ok "no sentinels → active_sentinels=none"; else fail "empty-sentinel case wrong"; fi

echo ""
echo "== 6. pretool-sentinel-gate.sh =="
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review"
run_hook "$repo" pretool-sentinel-gate.sh '{"tool_input":{"command":"git commit -m wip"}}'
if grep -q 'REMINDER' "$STDERR_F"; then ok "commit with pending sentinel → warn"; else fail "no warn on pending commit ($(cat "$STDERR_F"))"; fi
if [ "$RC" -eq 0 ]; then ok "warn mode exits 0 (non-blocking)"; else fail "warn mode returned rc=$RC"; fi

run_hook "$repo" pretool-sentinel-gate.sh '{"tool_input":{"command":"git commit -m wip"}}' DHPK_SENTINEL_COMMIT_GATE=block
if [ "$RC" -eq 2 ]; then ok "block mode exits 2"; else fail "block mode rc=$RC (expected 2)"; fi

run_hook "$repo" pretool-sentinel-gate.sh '{"tool_input":{"command":"git commit -m wip"}}' DHPK_SENTINEL_COMMIT_GATE=off
if [ "$RC" -eq 0 ] && [ ! -s "$STDERR_F" ]; then ok "off mode → silent exit 0"; else fail "off mode not silent (rc=$RC)"; fi

# No sentinel → silent even in warn mode.
rm -f "$(sess_dir "$repo")/.pending-review"
run_hook "$repo" pretool-sentinel-gate.sh '{"tool_input":{"command":"git commit -m wip"}}'
if [ ! -s "$STDERR_F" ]; then ok "no pending sentinel → silent"; else fail "warned with no sentinel present"; fi

# Non-git command → silent.
mk_sentinel "$repo" ".pending-review"
run_hook "$repo" pretool-sentinel-gate.sh '{"tool_input":{"command":"ls -la"}}'
if [ ! -s "$STDERR_F" ]; then ok "non-git command → silent"; else fail "warned on non-git command"; fi

echo ""
echo "== 7. pretool-branch-safety.sh =="
repo="$(make_repo)"  # default branch = main (protected)
run_hook "$repo" pretool-branch-safety.sh '{"tool_input":{"command":"git commit -m wip"}}'
if grep -q 'REMINDER' "$STDERR_F"; then ok "commit on main → warn"; else fail "no warn committing on main ($(cat "$STDERR_F"))"; fi

run_hook "$repo" pretool-branch-safety.sh '{"tool_input":{"command":"git commit -m wip"}}' DHPK_BRANCH_SAFETY=block
if [ "$RC" -eq 2 ]; then ok "block mode on main → exit 2"; else fail "block mode rc=$RC (expected 2)"; fi

git -C "$repo" checkout -q -b feature/x
run_hook "$repo" pretool-branch-safety.sh '{"tool_input":{"command":"git commit -m wip"}}'
if [ ! -s "$STDERR_F" ]; then ok "commit on feature/x → silent"; else fail "warned on unprotected branch ($(cat "$STDERR_F"))"; fi

run_hook "$repo" pretool-branch-safety.sh '{"tool_input":{"command":"git commit -m wip"}}' DHPK_BRANCH_SAFETY=off
if [ "$RC" -eq 0 ] && [ ! -s "$STDERR_F" ]; then ok "off mode → silent exit 0"; else fail "off mode not silent (rc=$RC)"; fi

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

# 8b. producer: clear-sentinel records a success event.
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review"
( cd "$repo"; export CLAUDE_PROJECT_DIR="$repo" DHPK_LEARNING_DB=1; bash "$HOOKS/clear-sentinel.sh" .pending-review code-reviewer >/dev/null 2>&1 )
lj="$(ljson_path "$repo")"
if [ -f "$lj" ] && grep -q '"sig":"review:.pending-review"' "$lj" && grep -q '"kind":"success"' "$lj"; then ok "clear-sentinel → success event"; else fail "clear-sentinel did not record success"; fi

# 8c. producer: subagent failure records a failure event.
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review"
run_hook "$repo" subagent-stop-verify.sh '{"subagent_type":"code-reviewer","exit_status":1}' DHPK_LEARNING_DB=1
lj="$(ljson_path "$repo")"
if [ -f "$lj" ] && grep -q '"sig":"agent:code-reviewer"' "$lj"; then ok "subagent failure → failure event"; else fail "subagent failure not recorded"; fi

# 8d. producer: stop-failure-log records an abnormal-stop event.
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review"
run_hook "$repo" stop-failure-log.sh '{"reason":"crash"}' DHPK_LEARNING_DB=1
lj="$(ljson_path "$repo")"
if [ -f "$lj" ] && grep -q '"sig":"abnormal-stop"' "$lj"; then ok "abnormal stop → failure event"; else fail "abnormal stop not recorded"; fi

# 8e. opt-in gate: default-off → no log written.
repo="$(make_repo)"
mk_sentinel "$repo" ".pending-review"
run_hook "$repo" subagent-stop-verify.sh '{"subagent_type":"code-reviewer","exit_status":1}'
lj="$(ljson_path "$repo")"
if [ ! -f "$lj" ]; then ok "learning DB default-off → no log written"; else fail "log written while DB disabled"; fi

# 8f. SessionStart surfaces [learned-context] when enabled.
repo="$(make_repo)"
(
    cd "$repo" || exit 1
    export CLAUDE_PROJECT_DIR="$repo" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" DHPK_LEARNING_DB=1
    . "$HOOKS/_lib/learning-db.sh"
    ldb_record success "review:code-reviewer"
    ldb_record success "review:code-reviewer"
    bash "$HOOKS/session-start.sh" > "$repo/_ss.out" 2>/dev/null
)
if grep -q 'learned-context' "$repo/_ss.out"; then ok "SessionStart injects [learned-context]"; else fail "no learned-context block emitted"; fi
# Disabled → no block.
repo="$(make_repo)"
(
    cd "$repo" || exit 1
    export CLAUDE_PROJECT_DIR="$repo" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT"
    bash "$HOOKS/session-start.sh" > "$repo/_ss2.out" 2>/dev/null
)
if ! grep -q 'learned-context' "$repo/_ss2.out"; then ok "SessionStart silent when DB disabled"; else fail "learned-context emitted while disabled"; fi

echo ""
echo "== 9. stop-graduation-scan.sh (Phase 2.2) =="
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
        printf '{"transcript_path":"%s"}' "$gtx" | bash "$HOOKS/stop-graduation-scan.sh" >/dev/null 2>&1
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
    printf '{"transcript_path":"%s"}' "$gtx" | bash "$HOOKS/stop-graduation-scan.sh" >/dev/null 2>&1
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
    printf '{"transcript_path":"%s"}' "$gtx" | bash "$HOOKS/stop-graduation-scan.sh" >/dev/null 2>&1
)
if [ -z "$(ls -A "$gout" 2>/dev/null)" ]; then ok "graduation disabled → no state written"; else fail "wrote state while disabled"; fi

echo ""
echo "== 10. pre-route.sh (Phase 2.3 Smart Router) =="
PR="$PLUGIN_ROOT/scripts/lib/pre-route.sh"

out="$(bash "$PR" "please fix this login bug")"
if [ "$(printf '%s' "$out" | cut -f1)" = "MATCH" ] && [ "$(printf '%s' "$out" | cut -f2)" = "dhpk:adaptive-dev-workflow" ]; then ok "english bug → MATCH dhpk:adaptive-dev-workflow"; else fail "english bug route wrong ($out)"; fi

out="$(bash "$PR" "幫我修一個 bug")"
if [ "$(printf '%s' "$out" | cut -f2)" = "dhpk:adaptive-dev-workflow" ]; then ok "CJK bug → MATCH dhpk:adaptive-dev-workflow"; else fail "CJK bug route wrong ($out)"; fi

out="$(bash "$PR" "review my diff please")"
if [ "$(printf '%s' "$out" | cut -f2)" = "dhpk:code-review" ]; then ok "review → MATCH dhpk:code-review"; else fail "review route wrong ($out)"; fi

out="$(bash "$PR" "run a security audit for owasp issues")"
if [ "$(printf '%s' "$out" | cut -f2)" = "dhpk:security-review" ]; then ok "security → MATCH dhpk:security-review (codex-free default)"; else fail "security route wrong ($out)"; fi

out="$(bash "$PR" "make me a sandwich")"
if [ "$out" = "NO_MATCH" ]; then ok "unmatched request → NO_MATCH"; else fail "expected NO_MATCH ($out)"; fi

out="$(bash "$PR" "")"
if [ "$out" = "NO_QUERY" ]; then ok "empty request → NO_QUERY"; else fail "expected NO_QUERY ($out)"; fi

out="$(printf 'add a new feature endpoint' | bash "$PR")"
if [ "$(printf '%s' "$out" | cut -f2)" = "dhpk:adaptive-dev-workflow" ]; then ok "stdin path → MATCH dhpk:adaptive-dev-workflow"; else fail "stdin route wrong ($out)"; fi

echo ""
echo "=========================================="
if [ "$FAIL" -gt 0 ]; then
    echo "FAIL: $FAIL 個失敗 / $PASS 個通過"
    exit 1
fi
echo "PASS: 全部通過（$PASS 個檢查）"
exit 0
