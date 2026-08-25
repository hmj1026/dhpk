# Delivery Loop Gate

Load this reference after the adaptive workflow selects the `Feature Delivery`
or `Bug Investigation & Fix` branch. It is the shared delivery contract; the
branch reference owns requirements or investigation, while this gate owns the
test, review, freshness, and handoff loop.

## Gate 1 — Test the observable behavior

Use Arrange–Act–Assert structure, behavior-describing names, and assertions on
caller-visible output or side effects. Project-local test rules remain the
authority for directories, runners, fixtures, and coverage thresholds.

1. Feature work starts with an independent RED test for the acceptance
   behavior. A bug fix starts with a regression test that reproduces the
   reported failure. Use `dhpk-tdd-workflow` (and the `tdd-guide` specialist
   when a dispatched RED phase is required) for unit and integration behavior.
2. Run the project's verification command, normally `/verify`, after the RED →
   GREEN → REFACTOR loop. Record the exact command, tree or commit, and result.
3. Re-run verification after every implementation or review fix. Evidence from
   another tree, an earlier branch state, or a stale artifact is not current
   evidence.

## Gate 2 — Test adequacy and level routing

Run `dhpk-test-review` for code changes. The adequacy result is a separate gate:

- `PASS` means the changed behavior has sufficient unit/integration evidence
  for its risk and acceptance criteria.
- `BLOCKED` means the review found a gap that must be closed before handoff.
- `UNAVAILABLE` means the reviewer or required runtime could not run; it is not
  a passing substitute.

When the missing behavior belongs to a Playwright user journey, dispatch
`e2e-runner` to author and run the journey. If Playwright, the target runtime,
or the agent is unavailable, record `UNAVAILABLE`, preserve the gate, and do
not claim an E2E pass from static or unit evidence.

## Gate 3 — Freshness and change review

The test, adequacy, and review receipts must bind to the current worktree (or a
named immutable commit) and the scoped files. After any edit, invalidate the
affected receipt and repeat the relevant checks.

Run `dhpk-change-review` for the implementation wave. The review covers both
repository standards and the requested behavior, reports file:line evidence,
and ends with `READY` or `BLOCKED`. A degraded reviewer is reported explicitly;
it never becomes an implicit approval.

## Gate 4 — Bounded review loop and handoff

Apply fixes from one review wave as one batch, then re-run the affected tests,
adequacy check, and change review together. Follow the anti-loop ceiling in
`rules/execution-policy.md`; after the ceiling, stop and report the blocker
with the evidence and the next viable option.

Only after all applicable rows pass may the branch run `/precommit` and hand
off. Keep commit and push decisions with the caller. A branch is ready only
when its required artifacts, fresh verification, test adequacy, and change
review are all accounted for.

## Output contract

Report one status for each row and keep unavailable evidence distinct:

```text
Tests: PASS | BLOCKED | NOT_RUN | UNAVAILABLE
Test adequacy: PASS | BLOCKED | NOT_RUN | UNAVAILABLE
Freshness: PASS | BLOCKED | NOT_RUN
Change review: PASS | BLOCKED | NOT_RUN | UNAVAILABLE
Handoff: PASS | BLOCKED | NOT_RUN
```

`NOT_RUN` means the check was not attempted; `UNAVAILABLE` means it was
attempted but its provider or runtime was not available. Neither status is a
passing gate.
