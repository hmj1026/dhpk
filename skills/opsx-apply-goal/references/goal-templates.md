# opsx-apply-goal — verbatim `/goal` condition templates

Used by Step 6 and Step 6b of the `opsx-apply-goal` skill. These are the exact
literal strings that compose `GOAL_CONDITION`. SKILL.md owns the *rules* (which
Part 0 branch by `DISPATCH_ON`, the `<CODEX_STATEMENT>` substitution, which Part 3
gate lines to emit per detected flags, and the 4000-char full→compact→blocked
decision). This file owns the *text*. Copy it out verbatim — do not paraphrase;
placeholders (`<CHANGE_ID>`, `<CODEX_STATEMENT>`, `<TURN_BUDGET>`,
`<MAX_DURATION>`) are substituted as noted.

`GOAL_CONDITION` = Part 0 + Part 1 + Part 2 + Part 2b + Part 3 + Part 4, joined
with `,\n`.

---

## Part 0 (always, first — kickoff instruction)

This is what makes the single-paste design work — `/goal` acts on this text
immediately, so the first thing Claude reads must be the action to take, not just
the stop condition.

**`DISPATCH_ON=false`** (`orchestration_dispatch=off`) — byte-identical to
pre-change output, no dispatch clause:
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation. That instruction covers ordinary implementation
judgment calls only; it is never an explicit project hard-rule conflict bypass.
Continue until all of the following hold,
```

**`DISPATCH_ON=true`** (default) — the same kickoff with one dispatch directive
appended before the transition into the stop conditions:
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation. That instruction covers ordinary implementation
judgment calls only; it is never an explicit project hard-rule conflict bypass.
You are the orchestrator: dispatch implementation
per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §Implementation dispatch —
mechanical/multi-file clear-spec work to dhpk:fast-worker (including multi-file
same-semantic artifact/doc consistency corrections, ≥3 files), reasoning-heavy
work to dhpk:deep-reasoner, RED/E2E Playwright specs that must run against a live
server to dhpk:e2e-runner, RED PHPUnit unit/integration tests (test-first, run
against a live DB) to dhpk:tdd-guide; edit inline only for ≤2-file unambiguous diffs and your own
bookkeeping (tasks.md checkboxes, sentinels); when unsure, dispatch; never use
general-purpose. Before dispatching a write worker on a task resting on an
unverified behavioral premise (bug-repro condition, algorithm correctness,
data-shape/plan assumption), first verify the premise with the probe that can
actually run it — code/algorithm/data-shape premises with dhpk:deep-reasoner,
runtime/browser/environment behavior premises with dhpk:e2e-runner or a scratch
executable probe. Apply the Repository Discovery Gate before finalizing new DB,
SQL, query-builder, criteria, model-persistence, or repository-like code:
explicit project hard rules cannot be deferred because a prior design chose a cheaper implementation;
comply with the hard rule or stop for a human-approved
exception. <CODEX_STATEMENT>. After each worker returns, verify its
output per that section (re-surface the report, cross-check git diff, confirm
the sentinels). Continue until all of the following hold,
```

### CODEX_STATEMENT — full variant

Substitute `<CODEX_STATEMENT>` with the session's CODEX setting from Step 1 (state
it explicitly, never leave the orchestrator to infer it):

- `CODEX=on` → `CODEX is ON for this session: at a contradiction-arbitration point where two agents' conclusions directly conflict, run a cross-model (Codex) doubt cycle per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle rather than skipping it; and PROACTIVELY, before finalizing a high-stakes solo design edit or decision that has no inter-agent conflict to arbitrate — the goal-template generator itself, an SSOT policy file, the deferral of a spec'd requirement, first-seen query/repository patterns, framework-internal hacks or private-state resets, or explicit-rule deferrals — run a parallel dhpk:codex-bridge independent review per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §CODEX=on high-stakes parallel peer path, so the declared CODEX=on capability fires on the session's riskiest edits and not only at two-agent contradiction points; and as a wrap-up self-check, before declaring the goal complete, if dhpk:codex-bridge was dispatched 0 times this session, enumerate the session's high-risk decision points (first-seen query/repository patterns, framework-internal hacks or private-state resets, explicit-rule/SSOT deferrals) and either run one retrospective dhpk:codex-bridge peer review or record an explicit per-point why-not, so a declared CODEX=on capability that fired 0 times is reconciled rather than left silently unused`
- `CODEX=off` → `CODEX is OFF for this session: at a contradiction-arbitration point where two agents' conclusions directly conflict, announce "cross-model doubt skipped (CODEX=off)" per ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle rather than performing a cross-model pass`

This reuses the existing skip-announced policy at
`${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md` §In-flight doubt cycle rather
than introducing new wording there.

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

**Pre-existing-failure rule** (applies to every test-runner line above): a runner also satisfies its gate when the only remaining failures are **proven pre-existing** — they still fail after `git stash` of this change's edits (so they are not change-introduced) and are unrelated to the change — provided each such failure is named in the completion summary. A failure that **disappears** when the change is stashed is change-introduced and still blocks. This keeps the full-suite run (so regressions the change causes anywhere are still caught) without letting one unrelated pre-existing red block the goal forever. Do NOT narrow the gate to only the change's own spec — that would miss regressions elsewhere.

**Pre-existing-warnings rule** (harness validators, e.g. `scripts/validate/validate-harness.sh`): a validator result of **PASS-with-warnings** counts as green for this gate when every remaining warning is **proven pre-existing** — present and identical on a `git stash`-ed clean HEAD, unrelated to the change, and named in the completion summary. A warning that **disappears** when the change is stashed is change-introduced and still blocks (mirroring the pre-existing-failure rule above). `validate-harness.sh` currently exits non-zero (2) on warnings-only; the gate SHALL NOT treat that non-zero exit alone as a failure when the `PASS (with warnings)` line and the pre-existing proof are both present.

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
  its report's **first line is `Verdict: PASS`**, and the key observed value from
  that report was pasted into the conversation; OR
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
OR stop after <TURN_BUDGET> turns
OR stop after <MAX_DURATION> wall-clock elapsed
OR stop immediately when an explicit project hard-rule conflict cannot be
resolved by strict compliance without human input; write
openspec/changes/<CHANGE_ID>/.hard-rule-escalation.md with the rule,
conflicting decision with file:line evidence, and why compliance is blocked,
then end the turn without continuing or waiting
and list in conversation, then write the same three items into
openspec/changes/<CHANGE_ID>/.resume-note.md:
(1) unchecked task items
(2) output of ls .claude/artifacts/sessions/.pending-*
(3) a one-line next-focus hint
```
The `.resume-note.md` carry-forward lets a follow-up session resume cleanly via
`opsx-load-context` (which checks for it before all other context tiers).

---

## Compact variants (used only when the full `GOAL_CONDITION` exceeds 4000 chars)

Preserves every safety-relevant clause (hard-rule carve-out, dispatch-table
pointer + never-general-purpose, premise-verification-before-dispatch, the
Repository Discovery Gate, verify-worker-output-after) and drops illustrative
examples only. Parts 1, 2, 2b, 3, 4 are unchanged — their length scales with the
change itself, not with fixed prose, so there is nothing to compact there.

### Part 0 — compact variant

`DISPATCH_ON=false` compact — identical to the full text (already short,
nothing to compact):
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation. That instruction covers ordinary implementation
judgment calls only; it is never an explicit project hard-rule conflict bypass.
Continue until all of the following hold,
```

`DISPATCH_ON=true` compact:
```
Invoke the opsx:apply skill for change <CHANGE_ID> and continue implementing
openspec/changes/<CHANGE_ID>/tasks.md from the first unchecked item without
stopping for confirmation (ordinary implementation judgment calls only —
never an explicit project hard-rule conflict bypass). You are the
orchestrator: dispatch implementation per
${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §Implementation dispatch
(mechanical/clear-spec work to dhpk:fast-worker, reasoning-heavy work to
dhpk:deep-reasoner, RED/E2E Playwright specs to dhpk:e2e-runner, RED PHPUnit
tests to dhpk:tdd-guide; inline only for
≤2-file unambiguous diffs plus bookkeeping; when unsure, dispatch; never
general-purpose). Verify an unresolved behavioral premise with the matching
probe (dhpk:deep-reasoner for code/algorithm/data-shape,
dhpk:e2e-runner or a scratch probe for runtime/browser/environment) before
dispatching a write worker on it. Apply the Repository Discovery Gate before
finalizing new DB/query/repository-like code: explicit project hard rules
cannot be deferred because a prior design chose a cheaper implementation;
comply or stop for a human-approved exception. <CODEX_STATEMENT>. Verify
each worker's output (report, git diff, sentinels) before continuing.
Continue until all of the following hold,
```

### CODEX_STATEMENT — compact variant

- `CODEX=on` → `CODEX is ON for this session: run a cross-model (Codex)
  doubt cycle at a contradiction-arbitration point rather than skipping
  it, and PROACTIVELY run a parallel dhpk:codex-bridge independent review
  before finalizing a high-stakes solo design edit or decision with no
  inter-agent conflict to arbitrate (the goal-template generator, an SSOT
  policy file, a spec'd-requirement deferral, first-seen query/repository
  patterns, framework-internal hacks or private-state resets, or
  explicit-rule deferrals), per
  ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle
  and §CODEX=on high-stakes parallel peer path; and as a wrap-up self-check,
  if dhpk:codex-bridge was dispatched 0 times this session, enumerate the
  high-risk decision points and either run one retrospective dhpk:codex-bridge
  review or record a per-point why-not before declaring the goal complete`
- `CODEX=off` → identical to the full-text variant (already short):
  `CODEX is OFF for this session: at a contradiction-arbitration point
  where two agents' conclusions directly conflict, announce "cross-model
  doubt skipped (CODEX=off)" per
  ${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md §In-flight doubt cycle
  rather than performing a cross-model pass`
