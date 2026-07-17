# opsx-apply-goal — verbatim `/goal` condition templates

Used by Step 6 and Step 6b of the `opsx-apply-goal` skill. These are the exact
literal strings that compose `GOAL_CONDITION`. SKILL.md owns the *rules* (which
Part 0 branch by `DISPATCH_ON`, the `<CODEX_STATEMENT>` substitution, which Part 3
gate lines to emit per detected flags, and the 4,000 UTF-8-byte length guard with its
should-never-fire hard stop). This file owns the *text*. Copy it out verbatim —
do not paraphrase; placeholders (`<CHANGE_ID>`, `<CODEX_STATEMENT>`,
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
self-located execution-policy, best-effort), the opsx:apply kickoff sentence with
the hard-rule carve-out and Unknown-skill fallback, and — when dispatch is on —
the one-line dispatch roster and the inline hard-rule guardrail. The behavioral
elaborations (dispatch-verify procedure, premise-verification routing, in-flight
doubt cycle, CODEX=on high-stakes peer path and its session-end self-check) live
in `rules/execution-policy.md` and bind the session through the orientation read;
they are NOT restated here. When the policy file is unresolvable, the session
proceeds on this condition's own inline gates.

The generator resolves CLI backend choice through the policy selector and
substitutes a compact `<FAST_WORKER_CLAUSE>` that states the effective backend
and fallback order in every generated goal. The clause — and the whole
`mechanical → <FAST_WORKER_CLAUSE>;` segment it sits in, including its trailing
separator — is present only when the analyzer's footprint scan finds an eligible
batch (a conclusive `Mechanical: yes` task naming more than `MAX_INLINE_FILES`
distinct files) or the scan is inconclusive (fail-open). When the scan concludes
no eligible batch exists, `FAST_WORKER_CLAUSE` is empty and the composer omits
the entire `mechanical → <FAST_WORKER_CLAUSE>;` segment from the emitted text —
the ≤2-file inline rule already stated in Part 0 covers that case, mirroring how
`<E2E_ROSTER_CLAUSE>` is omitted when `HAS_E2E=false`.

**`DISPATCH_ON=false`** (`orchestration_dispatch=off`) — no dispatch clause:
```
First run ONE Bash orientation command — `p=${CLAUDE_PLUGIN_ROOT:-$(ls -dt
~/.claude/plugins/cache/dhpk/dhpk/* 2>/dev/null | head -1)}; cat
"$p/rules/execution-policy.md" 2>/dev/null || echo POLICY-UNRESOLVED` — reading
the dhpk execution-policy into context (on POLICY-UNRESOLVED proceed on this
goal string's own gates; never filesystem-scan) — then invoke the opsx:apply
skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation. Task digest: <TASK_DIGEST>. When more than one
repository is indexed, pass an explicit `repo="<project>"` parameter on
gitnexus MCP calls (impact, detect_changes, query). That instruction covers ordinary implementation
judgment calls only; it is never an explicit project hard-rule conflict bypass.
On "Unknown skill", retry once next turn; if it still fails, read
openspec/changes/<CHANGE_ID>/ (proposal.md, design.md, tasks.md) and implement
directly under the same gates. <CODEX_STATEMENT>. Continue until all of the
following hold,
```

**`DISPATCH_ON=true`** (default) — the same kickoff with the bounded dispatch
roster appended before the transition into the stop conditions:
```
First run ONE Bash orientation command — `p=${CLAUDE_PLUGIN_ROOT:-$(ls -dt
~/.claude/plugins/cache/dhpk/dhpk/* 2>/dev/null | head -1)}; cat
"$p/rules/execution-policy.md" 2>/dev/null || echo POLICY-UNRESOLVED` — read policy
(if unresolved use these gates; never filesystem-scan), invoke opsx:apply
<CHANGE_ID>, and continue unchecked tasks without confirmation. Tasks: <TASK_DIGEST>. gitnexus repo="<project>".
On "Unknown skill", retry once, then implement from proposal.md, design.md, tasks.md under
these gates. You are the orchestrator per §Implementation dispatch: mechanical →
<FAST_WORKER_CLAUSE>; reasoning → dhpk:deep-reasoner; RED PHPUnit → dhpk:tdd-guide;
<E2E_ROSTER_CLAUSE>never general-purpose. Inline ≤2-file whole-implement-step
plus bookkeeping; ≥3 files → one batch. Reviews run as ONE consolidated parallel batch per wave;
known-finding re-review confirm-only; codex-bridge only as explicit escalation, at most once per change.
Explicit project hard rules cannot be deferred because a prior design chose a cheaper implementation.
Never sleep-poll background work; wait on notifications/Monitor.
<CODEX_STATEMENT>. Continue until all of the following hold,
```

### CODEX_STATEMENT

Substitute `<CODEX_STATEMENT>` with the session's CODEX setting from Step 1 (state
it explicitly, never leave the orchestrator to infer it). One declarative line per
mode — the behavioral elaboration lives in the execution-policy sections the line
names and binds via the orientation read:

- `CODEX=on` → `CODEX is ON for this session: apply execution-policy §In-flight doubt cycle and §CODEX=on high-stakes parallel peer path (including its session-end zero-dispatch self-check)`
- `CODEX=off` → `CODEX is OFF for this session: at a contradiction-arbitration point where two agents' conclusions directly conflict, announce "cross-model doubt skipped (CODEX=off)" per execution-policy §In-flight doubt cycle rather than performing a cross-model pass`

---

## Part 1 (always)

```
All checkboxes in openspec/changes/<CHANGE_ID>/tasks.md are [x] (Claude confirmed in conversation)
```

## Part 2 (always — universal sentinel check)

```
Claude ran `ls .claude/artifacts/sessions/.pending-* 2>/dev/null || echo NONE`
and confirmed the output is NONE in conversation (all pending reviewer sentinels cleared)
```

## Part 2b (always — unresolved reviewer verdict sidecar check)

```
Claude ran `test ! -s .claude/artifacts/sessions/.unresolved-verdict && echo NONE || cat .claude/artifacts/sessions/.unresolved-verdict`
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
OR at turn <TURN_BUDGET>: stop after finishing the current tasks.md item, with
no half-edited file; write openspec/changes/<CHANGE_ID>/.resume-note.md (state,
next step, remaining tasks), end the session — hard checkpoint, not advice; a
fresh session resumes cheaper than this one continuing
OR stop after <MAX_DURATION> wall-clock elapsed: write the same
.resume-note.md (state, next step, remaining tasks), end the session
OR stop when every remaining unchecked task is blocked on a human-only action
(PR merge, credentials, deploy approval): annotate `[blocked: <reason>]` in
tasks.md, write .resume-note.md, then stop
OR stop immediately when an explicit project hard-rule conflict cannot be
resolved by strict compliance without human input; write
openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md with the rule,
conflicting decision with file:line evidence, and why compliance is blocked,
then end the turn without continuing or waiting
and list in conversation, then write the same three items into
.resume-note.md:
(1) unchecked task items
(2) output of ls .claude/artifacts/sessions/.pending-*
(3) a one-line next-focus hint
```
The `openspec/changes/<CHANGE_ID>/.resume-note.md` carry-forward lets a
follow-up session resume cleanly via `opsx-load-context` (which searches that
change-local path before all other context tiers).
