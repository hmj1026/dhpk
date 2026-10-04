# opsx-apply-goal — verbatim `/goal` condition templates

Used by Steps 3 and 4 of the `dhpk-opsx-apply-goal` skill. These are the exact
literal strings that compose `GOAL_CONDITION`. SKILL.md owns the *rules* (which
Part 0 branch by `DISPATCH_ON`, which Part 3
gate lines to emit per detected flags, and the 4,000 UTF-8-byte length guard with its
should-never-fire hard stop). This file owns the *text*. Copy it out verbatim —
do not paraphrase; placeholders (`<CHANGE_ID>`, `<CHANGE_DIR>`, `<SCHEMA_NAME>`,
`<TASKS_PATH>`, `<PROPOSAL_PATH>`, `<DESIGN_PATH>`,
`<FAST_WORKER_CLAUSE>`, `<TASK_DIGEST>`, `<E2E_ROSTER_CLAUSE>`, `<SKILL_ROOT_Q>`,
`<TURN_BUDGET>`, `<MAX_DURATION>`) are substituted as noted.

`GOAL_CONDITION` = Part 0 + Part 1 + Part 2 + Part 3 + Part 4, joined
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
they are NOT restated here. Unresolvable policy emits `POLICY-UNRESOLVED`,
records a handoff, and stops before apply.

The orientation binds the project-owned orchestration decision policy, including
outcome sufficiency, authority, and applicable planning and delegation guidance,
through the execution-policy kernel and selected route reference. A recommended
planner or worker route may be replaced, reordered, or skipped when existing
evidence supplies the required outcome; unresolved decisions, ownership,
coupling, or material risk still require resolution before dependent writes.

The generator resolves CLI backend choice through the policy selector and
substitutes a compact `<FAST_WORKER_CLAUSE>` that states the effective backend
and fallback order in every generated `DISPATCH_ON=true` goal. The clause — and
the whole `mechanical → <FAST_WORKER_CLAUSE>;` segment it sits in, including its
trailing separator — is always substituted and always present in that branch
(the `DISPATCH_ON=false` template carries no dispatch roster at all), regardless of what the
analyzer's footprint scan finds: whether the scan locates an eligible batch,
concludes no eligible batch exists, or is inconclusive, the clause and
segment are emitted unconditionally. This is deliberately NOT symmetric with
`<E2E_ROSTER_CLAUSE>`, which is still omitted when `HAS_E2E=false`: a new E2E
journey rarely appears mid-session, whereas mechanical work routinely does, and
dropping the segment left the goal without naming the applicable fast-worker
route when delegation becomes appropriate mid-session.

**`DISPATCH_ON=false`** (`orchestration_dispatch=off`) — no implementation
dispatch clause; outcome and authority gates remain active:
```
First run ONE Bash orientation command — `p=<SKILL_ROOT_Q>; q(){ cat "$p/$1" 2>/dev/null; }; q references/execution-bundle/rules/execution-policy-kernel.md||{ echo POLICY-UNRESOLVED;exit 1; }` — reads the
compact dhpk execution-policy kernel; never filesystem-scan — then invoke the Skill tool
with the canonical ID `openspec-apply-change` for change <CHANGE_ID> and
Resolved paths: `<CHANGE_DIR>`|`<SCHEMA_NAME>`|`<TASKS_PATH>`|`<PROPOSAL_PATH>`|`<DESIGN_PATH>`. Continue
implementing the resolved task artifact from its first unchecked item without
stopping for confirmation. Task digest: <TASK_DIGEST>.
When more than one repository is indexed, pass an explicit `repo="<project>"`
parameter on gitnexus MCP calls (impact, detect_changes, query). That
instruction covers ordinary implementation judgment calls only; it is never
an explicit project hard-rule conflict bypass. On "Unknown skill" (the
external OpenSpec plugin is not installed), retry once next turn; if it still
fails, read the resolved artifacts and implement under the same gates. Retired `CODEX=on`/`--codex` => `DEPRECATED_CODEX_FLAG`; never
selects peer/backend. Use `--worker=codex` for CLI work or named owner
`--second-opinion=codex-exec` for additive opinion. Continue
until all of the following hold,
```

**`DISPATCH_ON=true`** (default) — the same kickoff with the bounded dispatch
roster appended before the transition into the stop conditions:
```
First run ONE Bash orientation command — `p=<SKILL_ROOT_Q>; q(){ cat "$p/$1" 2>/dev/null; }; q references/execution-bundle/rules/execution-policy-kernel.md||{ echo POLICY-UNRESOLVED;exit 1; }; q references/execution-bundle/skills/flow-guide/references/implementation-dispatch.md||{ echo POLICY-UNRESOLVED;exit 1; }` — never filesystem-scan.
Run openspec-apply-change <CHANGE_ID>. Resolved paths:
`<CHANGE_DIR>`|`<SCHEMA_NAME>`|`<TASKS_PATH>`|`<PROPOSAL_PATH>`|`<DESIGN_PATH>`. Tasks:<TASK_DIGEST>; continue.
On "Unknown skill": retry once; then use resolved artifacts under gates.
Set DHPK_ORCHESTRATION_DISPATCH=on; cwd resets—use absolute paths or git -C.
You are the orchestrator: mechanical→<FAST_WORKER_CLAUSE>; reasoning→dhpk:deep-reasoner;
RED PHPUnit→dhpk:tdd-guide; <E2E_ROSTER_CLAUSE>never general-purpose.
Explicit CLI packet via only `node <SKILL_ROOT_Q>/scripts/launch-cli-dispatch.js`:
dispatching_agent distinct from execution_provider; requested_role,mode,task_id,attempt_id, absolute
workdir, existing prompt/scope, ordered config. Keep runtime binding + execution-policy decision;
never infer authority. READY before adapter; never synthesize operational files.
Choose inline or one bounded worker batch from ownership, coupling, edit shape,
dependencies, and material risk; file count alone does not force dispatch.
recommended reviewers: ONE consolidated applicable batch per wave when current
evidence does not already cover the unchanged scope;
codex-bridge only as explicit escalation, at most once per change, and only
when the caller selected `--second-opinion=codex-exec`.
project hard rules cannot be deferred because a prior design chose a cheaper implementation.
No sleep-poll; await notifications/Monitor.
Retired `CODEX=on`/`--codex` => `DEPRECATED_CODEX_FLAG`; never selects
peer/backend; CLI work uses `--worker=codex`. Continue until:
```

---

## Part 1 (always)

```
All checkboxes in the resolved task artifact are [x]; Claude confirmed in conversation
```

## Part 2 (always — reviewer findings)

```
Claude confirmed in conversation that no CRITICAL reviewer finding for
`<CHANGE_ID>` remains unfixed
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
pre-existing** — each reproduces against an isolated, source-identifiable clean
baseline and is named in the completion summary. Preserve dirty WIP; do not use
`git stash`, reset, or cleanup as the proof. A failure that disappears on the
clean baseline is change-introduced and still blocks. Do NOT narrow the gate to
only the change's own spec — that would miss regressions elsewhere.

**Pre-existing-warnings rule** (the consumer project's `validate-harness.sh`
harness validator): a validator result of
**PASS-with-warnings** counts as green for this gate when every remaining warning
is **proven pre-existing** — it reproduces identically on an isolated,
source-identifiable clean baseline AND is named in the completion summary. A
warning that **disappears** on the clean baseline is change-introduced and still blocks (mirroring the
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
OR at turn <TURN_BUDGET>: finish the item, reconcile interrupted work; write
`.resume-note.md` in the resolved root (state,next,remaining); end
OR stop after <MAX_DURATION>: reconcile, write the same note; end
OR repair, review retry, and authorized backend fallback share one task/attempt
budget; backend switch does not reset it. Inspect work+diff before replacement.
OR when all unchecked tasks need human action (PR merge, credentials, deploy
approval): put `[blocked: <reason>]` in the resolved task artifact; write `.resume-note.md` in the resolved change root; stop
OR on a project hard-rule conflict unresolved by strict compliance without human
input: write `.hard-rule-escalation.md` in the resolved change root with the rule,
conflicting decision with file:line evidence, and why compliance is blocked; end
turn; do not continue/wait
List, then copy to `.resume-note.md` in the resolved change root:
(1) unchecked tasks
(2) any unfixed CRITICAL reviewer finding
(3) one-line next-focus hint
```
The resolved change root's `.resume-note.md` carry-forward lets a follow-up session resume
cleanly via `dhpk-opsx-load-context`; a later archive handoff must use the same
resolved change root and artifact paths and the owning external apply/archive
workflow. A blocked handoff is a stop state, not completion or archive evidence.
