# opsx-apply-goal — verbatim `/goal` condition templates

Used by Steps 3 and 4 of the `dhpk-opsx-apply-goal` skill. These are the exact
literal strings that compose `GOAL_CONDITION`. SKILL.md owns the *rules* (which
Part 0 branch by `DISPATCH_ON`, which Part 3
gate lines to emit per detected flags, and the 4,000 UTF-8-byte length guard with its
should-never-fire hard stop). This file owns the *text*. Copy it out verbatim —
do not paraphrase; placeholders (`<CHANGE_ID>`,
`<FAST_WORKER_CLAUSE>`, `<TASK_DIGEST>`, `<E2E_ROSTER_CLAUSE>`,
`<TURN_BUDGET>`, `<MAX_DURATION>`) are substituted as noted.

`GOAL_CONDITION` = Part 0 + Part 1 + Part 2 + Part 2b + Part 3 + Part 4, joined
with `,\n`.

---

## Part 0 (always, first — kickoff instruction)

This is what makes the single-paste design work — `/goal` acts on this text
immediately, so the first thing Claude reads must be the action to take, not just
the stop condition.

Part 0 is a bounded kickoff: the orientation instruction (which also reads the
self-located execution-policy kernel, best-effort), the opsx:apply kickoff sentence with
the hard-rule carve-out and Unknown-skill fallback, and — when dispatch is on —
the one-line dispatch roster and the inline hard-rule guardrail. The behavioral
elaborations (dispatch-verify procedure, premise-verification routing, in-flight
doubt cycle, explicit second-opinion path and its session-end evidence) live
in the kernel and selected route reference and bind the session through the
orientation read;
they are NOT restated here. When the kernel or selected reference is unresolvable, the session
proceeds on this condition's own inline gates.

The orientation binds the project-owned orchestration decision policy, including
the planner and reasoner gates, through the execution-policy kernel and selected
route reference.

The generator resolves CLI backend choice through the policy selector and
substitutes a compact `<FAST_WORKER_CLAUSE>` that states the effective backend
and fallback order in every generated `DISPATCH_ON=true` goal. The clause — and
the whole `mechanical → <FAST_WORKER_CLAUSE>;` segment it sits in, including its
trailing separator — is always substituted and always present in that branch
(the `DISPATCH_ON=false` template carries no dispatch roster at all), regardless of what the
analyzer's footprint scan finds: whether the scan locates an eligible batch (a
conclusive `Mechanical: yes` task naming more than `MAX_INLINE_FILES` distinct
files), concludes no eligible batch exists, or is inconclusive, the clause and
segment are emitted unconditionally. This is deliberately NOT symmetric with
`<E2E_ROSTER_CLAUSE>`, which is still omitted when `HAS_E2E=false`: a new E2E
journey rarely appears mid-session, whereas mechanical work routinely does, and
dropping the segment left the goal stating the ≥3 files → one batch rule from
Part 0 without naming the agent to dispatch.

**`DISPATCH_ON=false`** (`orchestration_dispatch=off`) — no implementation
dispatch clause; the mandatory multi-task OpenSpec planner gate remains active:
```
First run ONE Bash orientation command — `p=${CLAUDE_PLUGIN_ROOT:-$(ls -dt ~/.claude/plugins/cache/dhpk/dhpk/* 2>/dev/null|head -1)}; q(){ cat "$p/$1" 2>/dev/null||{ test -r ./.claude-plugin/plugin.json&&cat "./$1";};}; q rules/execution-policy-kernel.md||echo POLICY-UNRESOLVED` — reads the
compact dhpk execution-policy kernel (including the mandatory planner gate that
remains active in off mode); never filesystem-scan; every reviewer dispatch (even
confirm-only) still gets a fresh .claude/artifacts/reviews/ artifact, never
reply-only — then invoke the Skill tool
with the canonical ID `openspec-apply-change` for change <CHANGE_ID> and
continue implementing openspec/changes/<CHANGE_ID>/tasks.md from the first
unchecked item without stopping for confirmation. Task digest: <TASK_DIGEST>.
When more than one repository is indexed, pass an explicit `repo="<project>"`
parameter on gitnexus MCP calls (impact, detect_changes, query). That
instruction covers ordinary implementation judgment calls only; it is never
an explicit project hard-rule conflict bypass. On "Unknown skill" (the
external OpenSpec plugin is not installed), retry once next turn; if it still
fails, read openspec/changes/<CHANGE_ID>/ (proposal.md, design.md, tasks.md)
and implement. Retired `CODEX=on`/`--codex` => `DEPRECATED_CODEX_FLAG`; never
selects peer/backend. Use `--worker=codex` for CLI work or named owner
`--second-opinion=codex-exec` for additive opinion. Continue
until all of the following hold,
```

**`DISPATCH_ON=true`** (default) — the same kickoff with the bounded dispatch
roster appended before the transition into the stop conditions:
```
First run ONE Bash orientation command — `p=${CLAUDE_PLUGIN_ROOT:-$(ls -dt ~/.claude/plugins/cache/dhpk/dhpk/* 2>/dev/null|head -1)}; q(){ cat "$p/$1" 2>/dev/null||{ test -r ./.claude-plugin/plugin.json&&cat "./$1";};}; q rules/execution-policy-kernel.md||echo POLICY-UNRESOLVED; q skills/dhpk-execution-policy/references/implementation-dispatch.md` — never filesystem-scan; every reviewer dispatch (even
confirm-only) still gets a fresh .claude/artifacts/reviews/ artifact, never
reply-only.
Run openspec-apply-change <CHANGE_ID>. Tasks:<TASK_DIGEST>. gitnexus repo="<project>"; continue.
On "Unknown skill": retry once; implement under gates.
Set DHPK_ORCHESTRATION_DISPATCH=on; cwd resets—use absolute paths or git -C.
You are the orchestrator: mechanical→<FAST_WORKER_CLAUSE>; reasoning→dhpk:deep-reasoner;
RED PHPUnit→dhpk:tdd-guide; <E2E_ROSTER_CLAUSE>never general-purpose.
Explicit CLI packet via only `node "$p/skills/dhpk-cli-dispatch-context/scripts/launch-cli-dispatch.js"`:
dispatching_agent distinct from execution_provider; requested_role,mode,task_id,attempt_id, absolute
workdir, existing prompt/scope, ordered config. Keep runtime binding + execution-policy decision;
never infer authority. READY before adapter; never synthesize operational files.
Inline ≤2-file whole-implement-step + bookkeeping; ≥3 files: one batch.
ONE consolidated parallel batch per wave; known findings: confirm-only;
codex-bridge only as explicit escalation, at most once per change, and only
when the caller selected `--second-opinion=codex-exec`.
project hard rules cannot be deferred because a prior design chose a cheaper implementation.
No sleep-poll; await notifications/Monitor.
Retired `CODEX=on`/`--codex` => `DEPRECATED_CODEX_FLAG`; never selects
peer/backend. Use `--worker=codex` for CLI work or named owner
`--second-opinion=codex-exec` for additive opinion. Continue until:
```

---

## Part 1 (always)

```
All openspec/changes/<CHANGE_ID>/tasks.md checkboxes [x]; Claude confirmed in conversation
```

## Part 2 (always — universal sentinel check)

```
Claude ran `ls .claude/artifacts/sessions/.pending-* 2>/dev/null||echo NONE`
and confirmed NONE in conversation (reviewer sentinels cleared)
```

## Part 2b (always — unresolved reviewer verdict sidecar check)

```
Claude ran `[ ! -s .claude/artifacts/sessions/.unresolved-verdict ]&&echo NONE||cat .claude/artifacts/sessions/.unresolved-verdict`
and confirmed the output is NONE in conversation (no unresolved reviewer verdict sidecar entries)
```

## Part 3 (verification gates)

Emit one line per detected gate; omit the whole part only if none of test / build
/ lint is detected AND `HAS_SMOKE=false`. A detected `HAS_SMOKE=true` keeps Part 3
(with only the smoke line) even when no test / build / lint gate is present.

Test runners (only if `HAS_TEST=true`):
- `HAS_PHPUNIT` → `phpunit output shows 0 errors, 0 failures`
- `HAS_JEST` → `jest output shows 0 failed`
- `HAS_PYTEST` → `pytest output shows 0 failed`
- `HAS_SWIFT_TEST` → `swift test output shows 0 failures`
- `HAS_OTHER_TEST` → use the specific command and "0 failures" phrasing from tasks.md

**Pre-existing-failure rule** (applies to every test-runner line above): a runner
also satisfies its gate when the only remaining failures are **proven
pre-existing** — each reproduces identically on a `git stash`-ed clean HEAD (so
it is not change-introduced) AND is named in the completion summary. A failure
that **disappears** when the change is stashed is change-introduced and still
blocks. This keeps the full-suite run (so regressions the change causes anywhere
are still caught) without letting one pre-existing red block the goal forever. Do
NOT narrow the gate to only the change's own spec — that would miss regressions
elsewhere.

**Pre-existing-warnings rule** (harness validators, e.g.
`scripts/validate/validate-harness.sh`): a validator result of
**PASS-with-warnings** counts as green for this gate when every remaining warning
is **proven pre-existing** — it reproduces identically on a `git stash`-ed clean
HEAD AND is named in the completion summary. A warning that **disappears** when
the change is stashed is change-introduced and still blocks (mirroring the
pre-existing-failure rule above). `validate-harness.sh` currently exits non-zero
(2) on warnings-only; the gate SHALL NOT treat that non-zero exit alone as a
failure when the `PASS (with warnings)` line and the pre-existing proof are both
present.

Coverage (emit when `HAS_TEST=true` AND (`HAS_COVERAGE=true` OR `MIN_COVERAGE` is
set) — see `references/detection.md`): emit the test line using the runner's
coverage invocation (`COVERAGE_CMD`) so the runner enforces the threshold, folded
into that one line. Threshold precedence: `MIN_COVERAGE` (operator flag) overrides
a detected `COVERAGE_THRESHOLD`. When the project has no native coverage config but
`MIN_COVERAGE` is set, derive `COVERAGE_CMD` from the detected runner (jest →
`jest --coverage`, phpunit → `phpunit --coverage-text`, pytest →
`pytest --cov --cov-fail-under=<N>`, swift → `swift test --enable-code-coverage`).
Examples: `jest --coverage output shows 0 failed AND coverage thresholds met`, or
`pytest --cov output shows 0 failed AND total coverage ≥ <threshold>%`. Keep it one
verifiable line (replaces the plain test line for that runner). Otherwise emit the
plain `0 failed` line and add no coverage condition. If `MIN_COVERAGE` is set but
`HAS_TEST=false`, ignore it and note in Block A (no runner to measure coverage).

Build / lint (only if detected — conditional, never forced):
- `HAS_BUILD` → `build output shows 0 errors`
- `HAS_LINT` → `lint output shows 0 errors`

Smoke gate (a **read-only live-runtime probe**, emitted ONLY when `HAS_SMOKE=true`
— omit this line entirely when `HAS_SMOKE=false`). Satisfied by exactly one of two
branches:
- (a) `dhpk:smoke-tester` was dispatched with one concrete scenario (the
  orchestrator sources the scenario from the change's claimed user-visible
  behavior in `proposal.md`/`tasks.md` — the agent never invents its own scope),
  its report's **first line is `Verdict: PASS`**, and that `Verdict:` line plus
  at least one observed output line from the report (the asserted log line, API
  response, or exit code) were pasted into the conversation; OR
- (b) a self-escaping hatch — a one-line note was pasted stating why the system
  could not be driven this session (launch command failed / no runtime available)
  together with the failing command's output.
A `Verdict: FAIL` report does NOT satisfy the gate. Branch (b) mirrors the
pre-existing-failure hatch above: a named, evidenced exception, never a silent
skip — a bare "couldn't run it" claim without the failing command's output does
not satisfy it. The hatch prevents a strong-signal detection from deadlocking an
unattended session when the runtime is genuinely unreachable this session.

## Part 4 (always — stop limits)

Emit the turn line always. Emit the wall-clock line **only if `MAX_DURATION` is
set** (when absent, omit that line — behavior unchanged):
```
OR at turn <TURN_BUDGET>: stop after finishing the current tasks.md item; no
half-edited file. Write openspec/changes/<CHANGE_ID>/.resume-note.md (state,next
step,remaining tasks); end session—hard checkpoint
OR stop after <MAX_DURATION> wall-clock elapsed: write the same
.resume-note.md (state, next step, remaining tasks), end the session
OR when all unchecked tasks need human action (PR merge, credentials, deploy
approval): put `[blocked: <reason>]` in tasks.md; write .resume-note.md; stop
OR on a project hard-rule conflict unresolved by strict compliance without human
input: write openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md with the rule,
conflicting decision with file:line evidence, and why compliance is blocked; end
turn; do not continue/wait
List, then copy to .resume-note.md:
(1) unchecked tasks
(2) output of ls .claude/artifacts/sessions/.pending-*
(3) one-line next-focus hint
```
The `openspec/changes/<CHANGE_ID>/.resume-note.md` carry-forward lets a
follow-up session resume cleanly via `dhpk-opsx-load-context` (which searches that
change-local path before all other context tiers).
