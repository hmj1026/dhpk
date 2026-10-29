---
name: tdd-workflow
description: 'Use for test-first feature or bug implementation, regression tests, test-generation scaffolds, and choosing public test seams or boundary mocks. Guides framework-agnostic RED-GREEN-REFACTOR on the current Host and Model. Not for Playwright journeys, post-hoc coverage audits, or documentation/formatting/rename-only work. Output: scoped tests or implementation with RED/GREEN evidence and honest verification status.'
metadata:
  dhpk-capability-id: dhpk.skill.tdd
  dhpk-name-style: portable-skill
  dhpk-invocation-class: implicit-eligible
  dhpk-next:
    PASS: none
    FAIL: none
    BLOCKED: none
    NOT_RUN: none
    UNAVAILABLE: none
---

# Test-Driven Development

## Select the work

Choose the mode from the requested outcome, rather than the agent's name:

- **Standard TDD**: own a feature or bug's test-first behavior change.
- **Test-generation**: produce tests or a scaffold for a named production seam;
  keep production code unchanged unless implementation is separately requested.
- **Worker handback**: perform a bounded GREEN or scaffold task using the settled
  owner's seam, target files, and verification command.

For Playwright journeys use `e2e-runner`; for a post-hoc coverage or acceptance
audit use `change-verdict`. Documentation, formatting, rename-only, and harness
configuration work without testable runtime behavior need no TDD loop.

Read [tests.md](references/tests.md) when choosing assertions and [mocking.md](references/mocking.md)
when introducing test doubles. Use the repository's existing test framework,
runner, and nearby conventions. Read `CONTEXT.md` and relevant ADRs when present
before choosing domain vocabulary or a new seam.

## Establish the seam and evidence

1. Identify the caller-visible behavior and its public API, command, event, or
   other boundary. Reuse the requested or approved seam and its existing test
   owner; ask only about a material missing behavior or constraint.
2. Find the smallest safe verification command. Keep tests isolated from shared
   services and data unless their use is explicitly authorized.
3. Check supplied RED/GREEN evidence against the current behavior, test, seam,
   and source revision. Reuse adequate evidence without repeating approvals;
   rerun the scoped command when the source or test has drifted, or the failure
   reason is missing. An old failure alone does not establish current RED.

Execute the method directly with the current Host and Model. Reuse settled
ownership and supplied evidence for a bounded handback. If a required runtime
or capability is unavailable, report `BLOCKED` and the action needed to resume.
The caller owns any delegation and downstream workflow decisions.

## Standard TDD

Work in one vertical slice at a time:

1. **RED**: write one small test for the observable behavior, then run it before
   changing production code. Capture the command and intended failing assertion.
2. Confirm the failure exposes the missing behavior. A missing dependency,
   syntax error, broken fixture, or unavailable service is a setup problem,
   not RED evidence; resolve it before dependent implementation.
3. **GREEN**: change only enough production code to satisfy that behavior, then
   rerun the same scoped command and capture the result.
4. **REFACTOR**: simplify only while tests stay green; rerun affected checks
   after refactoring. Skip refactoring when it adds no value.
5. Repeat for the next behavior. Run the applicable suite at phase exit, using
   the project's acceptance scope; keep unrun or blocked checks visible.

Test through the real public seam with minimal collaborators. Use independently
worked examples, specification values, or independently derived invariants for
expectations. A plausible wrong implementation should fail the test. The
quality and rejection rules live in [tests.md](references/tests.md); mock external or
otherwise unavoidable system boundaries as described in [mocking.md](references/mocking.md).

## Test-generation

Inspect the named production seam and existing conventions, then generate the
smallest behavior-focused tests or scaffold. `test-generation` replaces the
retired `/codex-test-gen` command; select a Codex backend only when explicitly
requested.

Run the scoped tests when the caller permits and the runtime is available.
If the caller requests files only, supply the exact command and mark execution
`NOT_RUN`. If execution is attempted but a prerequisite prevents it, report
`BLOCKED` with the observed cause. A generated scaffold is an artifact, not
proof of RED or GREEN. Distinguish expected failure from observed failure.

## Worker handback

For a bounded task supplied by a caller with a settled owner:

1. Preserve the dispatcher's target files, behavior, public seam, and command.
   Do not request another seam approval or start a separate test strategy.
2. Apply the specified GREEN or scaffold change after establishing adequate
   handback evidence as above. Escalate ambiguity without broadening scope.
3. Run the scoped command yourself. Report edited files and the exact result
   through the worker's canonical report, including the TDD evidence below.

## Report and verification

Use a concise report, or include these facts in the worker's canonical report:

```text
Mode: Standard TDD | Test-generation | Worker handback
Phase: RED | GREEN | REFACTOR | GREEN-HANDOFF | SCAFFOLD
Verdict: PASS | PARTIAL | FAIL | BLOCKED
RED evidence: <command and intended assertion failure | supplied evidence and scope | NOT_RUN with reason>
Scoped verification: <command> -> PASS | FAIL | NOT_RUN | BLOCKED
Suite verification: <command> -> PASS | FAIL | NOT_RUN | BLOCKED
Test files: <paths>
Implementation: <none | changed paths>
Coverage: <measured percentage and scope | unavailable>
Remaining: <missing check, prerequisite, handoff, or none>
```

`PASS` applies to the requested mode and verification scope. It never promotes
an unrun scaffold, setup failure, or local test into implementation, runtime,
browser, or release proof. Use `PARTIAL` for delivered work with required checks
still unrun, `FAIL` for a demonstrated unmet behavior, and `BLOCKED` for an
unavailable prerequisite. State the resume command or action for unfinished
work. Report coverage only if measured; apply a percentage target only when
project acceptance or runner configuration requires it.

Before reporting, check that the evidence establishes the intended failure
(or an adequate handback), the test observes the public behavior with an
independent oracle, and scoped/suite results match what actually ran.
Return the method evidence to the caller and stop; the caller owns subsequent
repository-wide verification or delivery workflows.
