---
name: dhpk-execution-policy
description: 'Execution-policy router for dhpk software-engineering work. Use when choosing a task flow or OpenSpec route at kickoff, checking post-edit reviewer obligations, recovering from an anti-loop stop, or shaping a blocked/completion reply. Not for: substantial-change classification (use adaptive-dev-workflow), an investigation already underway (use bug-investigation), pure code tracing, or mid-workflow execution. Output: one next route plus the required gates and completion shape.'
allowed-tools: 'Read, Grep, Glob, Bash, Skill, Agent'
---

# DHPK Execution Policy

This is the skill-form entry point to dhpk's canonical execution policy. Read the
project's `.claude/rules/execution-policy.md` first when it exists; otherwise
read `${CLAUDE_PLUGIN_ROOT}/rules/execution-policy.md`. That policy is the
single source of truth for classification, OpenSpec routing, implementation
dispatch, sentinels, anti-loop limits, git, and testing. This skill supplies
routing and load-on-demand pointers; it does not copy those normative tables.

The implementation posture is **decide → dispatch → verify** when orchestration
dispatch is enabled. Inline work is the policy's small, unambiguous exception,
not a reason to bypass its worker or review gates.

## When NOT to Use

- A substantial change needs workflow classification, required artifacts, or readiness gates → use `adaptive-dev-workflow`.
- A root-cause investigation is already underway → use `bug-investigation`.
- An OpenSpec change is apply-ready → use `/opsx:apply`.
- Pure code understanding or tracing has no workflow decision → use `code-explore` (or `code-investigate` for a dual-perspective pass).
- A specific skill's workflow is already in progress → follow that skill's steps instead of re-routing through this policy.

## Kickoff sequence

Use this sequence when the request is about choosing or confirming execution
policy. Complete each step before moving to the next.

1. **Name the phase** — kickoff, implementation, post-edit review, or blocked/retry.
   Done when the current phase is explicit.
2. **Resolve the route** — honor an explicit `/opsx:*` or skill invocation. For
   an unqualified substantial change, hand off classification to
   `adaptive-dev-workflow`; otherwise use the SSOT classification table.
   Done when exactly one next route is selected and its OpenSpec ask/override
   is known.
3. **Load narrowly** — read only the reference needed by that route, then
   follow the downstream skill's workflow. Done when the next action and its
   verification command or evidence requirement are known.
4. **Close the edit wave** — after an applicable Edit/Write wave, follow the
   SSOT post-implementation gate: triage false positives, dispatch surviving
   reviewers in parallel, merge/deduplicate findings, and run AI-judgment
   back-stops. Done when every applicable sentinel is dispatched or triaged
   with a reason and no unresolved sentinel remains; otherwise report the
   blocker.
5. **Wrap deliberately** — for a non-trivial Edit/Write turn, load
   `execution-checklist` before replying. Done when the output shape and every
   triggered conditional check are accounted for.

## Routing precedence

Use this as a compact router, not as a second policy table:

1. An explicit user-invoked command or skill wins.
2. Project-local skills override same-name plugin skills when the route is
   unqualified.
3. `adaptive-dev-workflow` owns substantial-change classification and its
   artifact/readiness gates.
4. `bug-investigation` owns unknown-root-cause work before implementation.
5. `architect` owns cross-module or DDD boundary design before implementation.
6. `tdd-guide` owns the RED phase for business-behavior features and bug fixes
   when the selected workflow requires tests first.
7. `/review-pending` and the sentinel-driven reviewer gate apply after edits;
   they do not replace the implementation workflow.

## Task modes

The exact six-mode mapping and OpenSpec ask behavior live in the SSOT section
`Change classification & OpenSpec routing (SSOT)`. Read
`./references/task-modes.md` for examples only when the mode is unclear; if the
request is substantial, hand off to `adaptive-dev-workflow` rather than
recreating its classification output here.

## Post-edit gate

The SSOT section `Mandatory post-steps` defines the sentinel table, reviewer
dispatch, and AI-judgment back-stops. Read
`./references/review-gate-mechanics.md` when wiring or clearing sentinels,
checking reviewer liveness, or invoking a back-stop reviewer. A clean reply
must not claim completion while an applicable review gate is still open.

## Anti-loop

Follow the SSOT section `Anti-loop & output`: stop at its first applicable
ceiling, report what was tried and why it failed, give at least two viable
alternatives, and recommend the next step. Read `./references/anti-loop.md`
when a retry may be the same approach in disguise.

## Output

At kickoff, report:

`Route → Why → Required gates → Next skill or command`

At wrap-up, report:

`Conclusion → Changed files → Verification → Risks/Open questions`

When blocked, use:

`Blocker → Tried → Next viable option`

This skill produces routing/closeout guidance, not a second copy of the
execution-policy document.

## Git pipeline

Follow the SSOT section `Git pipeline` for the repository's branch and review
flow. Do not auto-run `git add`, `commit`, `push`, or `stash`. Read
`./references/squash-merge-hygiene.md` before reviewing a squash-merged branch.

## Verification

- [ ] The project override or plugin SSOT was resolved before policy decisions.
- [ ] Exactly one next route was selected, with its OpenSpec behavior recorded when applicable.
- [ ] Only route-relevant references were loaded.
- [ ] Every applicable post-edit sentinel was dispatched, triaged with a reason, or reported as a blocker.
- [ ] Worker output, edited-file scope, and the required verification evidence were checked before completion.
- [ ] The reply follows the applicable output shape.

## References

- `./references/task-modes.md` — examples when the SSOT change mode is unclear.
- `./references/anti-loop.md` — retry classification and stop conditions when a loop is suspected.
- `./references/output-shape.md` — full reply format when writing a summary or blocked response.
- `./references/squash-merge-hygiene.md` — unrelated-change handling before reviewing a squash merge.
- `./references/implementation-dispatch.md` — decide → dispatch → verify, worker selection, premise gates, and worker-output checks during implementation dispatch.
- `./references/review-gate-mechanics.md` — sentinel clear contract, triage, reviewer liveness, and back-stop mechanics.
- `./references/deterministic-first.md` — collect → gate → judge and immutable tool output for audit, setup, inventory, or generation work.
- `./references/premise-verification.md` — independent doubt, behavioral-premise checks, and premise-overturning reframes.
- `./references/testing-policy.md` — dedicated test expectations for scripts, hooks, validators, runners, codegen, and shared helpers.
- `./references/component-addition-policy.md` — justification and residue cleanup when adding or removing agents, sentinel slots, or hooks.
