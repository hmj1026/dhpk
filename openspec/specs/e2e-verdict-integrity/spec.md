# e2e-verdict-integrity Specification

## Purpose

Define truthful Playwright journey verdicts: require applicable static checks,
keep unavailable checks and runtime capabilities visible, and preserve the
evidence needed to distinguish a focused browser result from a package-only
or otherwise incomplete verification.

## Requirements

### Requirement: Applicable static checks precede a RED/GREEN verdict

Before the `e2e-runner` agent reports a RED/GREEN (or PASS/FAIL) verdict on a Playwright user-journey run, it SHALL run the project's configured typecheck or static checks when they are applicable to the changed scope. A verdict SHALL NOT be reported GREEN/PASS while an applicable check fails, even if the Playwright assertions themselves pass, since a failed check can mask a test that is silently exercising the wrong code path. When no such check is configured or applicable, the agent SHALL report that check as `NOT_RUN` with the reason and SHALL NOT invent a generic command or treat its absence as a pass.

#### Scenario: Applicable static checks pass before a GREEN verdict

- **WHEN** `e2e-runner` finishes a Playwright run whose assertions all pass
- **THEN** it runs the project's configured applicable static checks first and only reports GREEN/PASS if those checks also pass

#### Scenario: Failing applicable static check blocks a GREEN verdict

- **WHEN** an applicable project static check fails after a Playwright run whose assertions passed
- **THEN** `e2e-runner` does not report GREEN/PASS; it reports the check failure and treats the verdict as failed

#### Scenario: Missing applicable static check remains visible

- **WHEN** the project has no configured typecheck or static check applicable to the changed scope
- **THEN** `e2e-runner` reports that check as `NOT_RUN` with the reason and does not infer PASS from its absence

#### Scenario: Missing browser or runtime blocks journey evidence

- **WHEN** Playwright, the browser, the server, or another required runtime capability is unavailable
- **THEN** `e2e-runner` returns `Verdict: BLOCKED` with the missing capability and resume command, and does not claim the critical journey passed from static or package evidence

### Requirement: Playwright trap sheet loads unconditionally

The `e2e-runner` agent SHALL load `agent-traps/e2e-runner/playwright.md` on every dispatch (unconditional — not gated behind stack detection, since Playwright is the agent's sole testing stack) and apply its documented traps before authoring assertions or diagnosing anomalous measurements. The trap sheet SHALL document at minimum: (1) `boundingBox()` returns `{x, y, width, height}` with no `.top` property — `boundingBox()?.top` is always `undefined` and any `?? 0` fallback silently masks this; (2) coordinates of an element inside an iframe already include the frame's offset — adding the frame offset again double-counts it; (3) Playwright's click-actionability auto-scroll can move the page before a click executes, so a "before click" `scrollY` measurement taken without accounting for this auto-scroll is polluted.

#### Scenario: Trap sheet loads regardless of project stack

- **WHEN** `e2e-runner` is dispatched against any project, regardless of its business-logic stack (PHP, JS, Swift, Python, ...)
- **THEN** it loads `agent-traps/e2e-runner/playwright.md`, unlike stack-specific reviewers that detect and load only a matching sheet

#### Scenario: boundingBox().top pitfall is documented

- **WHEN** `e2e-runner` computes an element's top offset
- **THEN** the trap sheet's guidance prevents it from reading a nonexistent `.top` property off `boundingBox()`'s return value

#### Scenario: iframe coordinate double-offset pitfall is documented

- **WHEN** `e2e-runner` reasons about the coordinates of an element inside an iframe
- **THEN** the trap sheet's guidance prevents it from re-adding the frame offset that Playwright's coordinates already include

#### Scenario: Click auto-scroll pollution pitfall is documented

- **WHEN** `e2e-runner` measures `scrollY` immediately before a click action
- **THEN** the trap sheet's guidance flags that Playwright's own actionability auto-scroll may have already moved the page, and that this must be accounted for before treating the measurement as pre-click

### Requirement: Diagnostic ordering rules out test-harness self-effects first

When `e2e-runner` observes an anomalous measurement (an unexpected scroll position, timing, or coordinate value), it SHALL first check whether the anomaly is explained by the test harness's own effects — Playwright's auto-scroll, auto-wait, or retry behavior — before hypothesizing that the anomaly reflects browser-internal or application behavior.

#### Scenario: Self-effect explains the anomaly

- **WHEN** an anomalous scroll-position measurement is fully explained by Playwright's click-actionability auto-scroll
- **THEN** `e2e-runner` attributes it to the test harness and does not report it as an application/browser behavior finding

#### Scenario: Self-effects ruled out before an application-behavior claim

- **WHEN** `e2e-runner` reports an anomalous measurement as reflecting genuine application or browser behavior
- **THEN** it has first checked and ruled out auto-scroll, auto-wait, and retry as the explanation
