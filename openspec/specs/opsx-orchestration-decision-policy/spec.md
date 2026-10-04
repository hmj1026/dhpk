# opsx-orchestration-decision-policy Specification

## Purpose

Provide one project-owned, observable orchestration contract for OpenSpec implementation and related multi-agent workflows.

## Requirements

### Requirement: Non-trivial implementation uncertainty routes through a read-only reasoner

When an implementation decision is non-trivial, the coordinator SHALL classify it as `REASONER_REQUIRED` and obtain a read-only reasoner conclusion before selecting a user decision or a write-capable worker. Non-trivial includes an unresolved root cause, algorithm or architecture choice, cross-file or data-shape change, behavior or runtime compatibility choice, or a decision that could alter a public contract. Static location, formatting, and already-settled task facts MAY remain `CLEAR` and be handled inline. A domain-boundary decision that requires architectural ownership SHALL consult `architect` first; that consultation does not replace the reasoner evidence gate when uncertainty remains.

#### Scenario: Unknown behavior blocks direct implementation

- **WHEN** an OpenSpec task has two plausible data-flow interpretations
- **THEN** the coordinator records `REASONER_REQUIRED`, dispatches a read-only reasoner, and does not dispatch a write worker until a conclusion is available

#### Scenario: Static task fact stays clear

- **WHEN** a task only renames an already-resolved documentation heading and its target is unambiguous
- **THEN** the coordinator records `CLEAR` and may use the documented small-scope inline path

### Requirement: Reasoner conclusions have an observable handoff contract

Every reasoner-gated decision SHALL preserve a compact result with `## Conclusion`, file-and-line evidence, and `## Next actions`. The conclusion SHALL be classified as `READY_FOR_DISPATCH`, `DECISION_FOR_USER`, or `BLOCKED`. `READY_FOR_DISPATCH` permits a bounded worker dispatch with the evidence and exact task scope; `DECISION_FOR_USER` pauses for the user decision; `BLOCKED` stops the workflow and reports the missing prerequisite. A coordinator SHALL NOT treat a missing, truncated, or evidence-free reasoner reply as approval.

#### Scenario: Reasoner resolves a worker-ready choice

- **WHEN** the reasoner returns `READY_FOR_DISPATCH` with file-and-line evidence and a narrow next action
- **THEN** the coordinator includes that conclusion in the worker task packet and dispatches only the bounded scope

#### Scenario: Reasoner requires user choice

- **WHEN** two valid public-behavior choices remain after investigation
- **THEN** the reasoner returns `DECISION_FOR_USER` and the coordinator presents the decision with evidence instead of writing either behavior

#### Scenario: Reasoner cannot establish a safe path

- **WHEN** the reasoner lacks the required runtime or repository evidence
- **THEN** the result is `BLOCKED`, no write dispatch occurs, and the user receives the blocker and next evidence request

### Requirement: Planning responds to missing outcomes and coordination needs

Before implementation, the coordinator SHALL assess whether current evidence establishes the requested scope, intended outcomes, relevant observations, ownership, dependencies, and remaining gaps. An adequate plan from any producer MAY be used as-is. The coordinator SHALL request only a missing outcome and SHALL NOT dispatch a planner solely because an OpenSpec task count is above a threshold. A planner consult is appropriate when an unresolved decision, dependency order, ownership boundary, cross-owner sequence, or named material risk leaves a planning outcome missing. An explicit supported planning-consult request SHALL still be honored regardless of task count or plan sufficiency. The planner remains read-only and cannot authorize writes outside the approved task scope. Bounded Consult option grammar and budgets remain owned by #815.

#### Scenario: Adequate plan is reused regardless of task count

- **WHEN** an OpenSpec apply has multiple unchecked tasks and its supplied plan already establishes scope, outcomes, dependencies, ownership, and remaining gaps
- **THEN** the coordinator reuses that plan without a duplicate planner dispatch and proceeds in its applicable dependency order

#### Scenario: Only a missing planning outcome is requested

- **WHEN** a supplied plan establishes the intended outcomes but leaves one dependency owner unresolved
- **THEN** the coordinator asks for or establishes that specific ownership outcome without repeating settled decisions or rebuilding the plan

#### Scenario: Explicit consult request remains effective

- **WHEN** a supported explicit planning-consult option is requested, even though existing planning evidence is adequate
- **THEN** the coordinator honors the consult under its existing parser, capability, and budget rules; task count alone neither requires nor prevents it

### Requirement: Each implementation wave has a review checkpoint and bounded fix loop

After each contiguous implementation wave, the coordinator SHALL run the applicable consolidated reviewer checkpoint before beginning the next wave. Findings SHALL be batched into one bounded fix specification and corrected. `BLOCK`, `CRITICAL`, or `HIGH` findings SHALL receive a dedicated confirm-only re-review; a LOW/WARNING-only set MAY close with the worker's scoped verification and a diff-scope recheck. A critical finding, unresolved gate, or exhausted retry budget SHALL leave the change `BLOCKED`. The workflow SHALL continue through all tasks or report the first explicit blocked state rather than claiming completion early.

#### Scenario: Review finds a cross-file defect

- **WHEN** a reviewer identifies a clear defect across three files in the current wave
- **THEN** the coordinator creates one fix packet, dispatches the suitable worker, and performs one confirm-only review before continuing

#### Scenario: Low-severity findings use the bounded economy path

- **WHEN** the consolidated reviewer reports only LOW or WARNING findings and the worker's scoped verification passes
- **THEN** the coordinator rechecks the diff scope and may continue without dispatching a dedicated confirm-only reviewer

#### Scenario: Review gate remains unresolved

- **WHEN** a reviewer artifact is missing, stale, or still reports a critical finding after the bounded retry
- **THEN** the coordinator records `BLOCKED` and does not start the next implementation wave

### Requirement: Delivery closes only after verification, archive, and live CI evidence

The project-owned lifecycle SHALL verify the complete change and required gates before archiving its OpenSpec artifacts, add a valid changelog fragment before PR creation, open a Draft PR against `develop`, and monitor the actual CI runs to a completed conclusion using notifications or `gh run watch`. Archive, PR creation, CI monitoring, and human merge remain separate boundaries; a green structural check or queued run alone is not completion. The external `/opsx:apply` command and external OpenSpec package SHALL remain unmodified.

#### Scenario: Verified change is archived before PR

- **WHEN** all task checkboxes, focused tests, review evidence, and strict OpenSpec validation pass
- **THEN** the coordinator archives or syncs the change, creates the changelog fragment, and only then opens the Draft PR

#### Scenario: CI is queued or a consumer is unavailable

- **WHEN** a PR check is queued, incomplete, or a required consumer surface is unavailable
- **THEN** the coordinator reports the exact non-terminal state and does not claim delivery complete or merge the PR
