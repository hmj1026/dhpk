# opsx-goal-dispatch-discipline Specification

## Purpose

Define bounded dispatch and review guidance that routes applicable work without
duplicating planning, retry, or review effort.

## Requirements

### Requirement: Goal string carries applicable dispatch guidance

This capability strengthens — and inherits the `orchestration_dispatch=on` gating of — the existing Part 0 dispatch directive required by `implementation-dispatch` ("opsx-apply-goal emits the dispatch directive for unattended sessions"); it does not introduce a parallel mechanism. The goal string SHALL direct the session to assess ownership, coupling, edit shape, dependencies, and material risk for each implementation step, then choose inline work or one bounded fast-worker (or CLI-backed variant) batch. A file count alone SHALL NOT force dispatch; an explicitly requested worker remains binding. The added clauses SHALL stay compact enough for the 4,000-character hard stop.

#### Scenario: Bulk doc-consistency fix in an unattended session

- **WHEN** an unattended /goal session faces same-shaped edits with shared ownership and coupling
- **THEN** it may batch them into one fast-worker dispatch with a fix spec and verification command when that is the applicable route

#### Scenario: Goal string stays under the hard stop

- **WHEN** the goal generator emits a /goal string including the dispatch-discipline clauses
- **THEN** the measured total length remains under 4,000 characters

### Requirement: Goal string batches reviewer rounds

The goal string SHALL instruct the session to run one consolidated applicable-reviewer dispatch per implementation wave, where a wave is the contiguous batch of implementation edits completed before a review gate. It SHALL instruct the session to batch all known-finding fixes before one confirm-only re-review and SHALL reference the reviewer-wave contract for scope and no-op handling instead of embedding that policy in full.

#### Scenario: Single review round after a wave

- **WHEN** a session completes an implementation wave
- **THEN** it dispatches one applicable reviewer wave over the changed scope, unless sufficient unchanged review evidence already covers that scope

#### Scenario: Known findings are re-reviewed once

- **WHEN** a reviewer returns several findings and the session applies their fixes
- **THEN** it performs one confirm-only re-review naming those findings, not one full review per file or finding

#### Scenario: New substantive scope starts a new decision

- **WHEN** a fix adds a new behavior or new reviewer scope
- **THEN** the new scope is evaluated as a separate review decision

### Requirement: Goal string forbids sleep-based polling

The goal string SHALL forbid `sleep`-based polling for background work, directing the session to rely on task-completion notifications or Monitor-style until-loops instead.

#### Scenario: Waiting on a background worker

- **WHEN** the session has dispatched a background task and needs its result
- **THEN** it waits for the task notification (or uses the harness's until-loop mechanism) rather than running `sleep N` and re-checking

### Requirement: Goal roster routes mechanical work through the fast-worker backend selector

The goal template's dispatch roster SHALL route batched mechanical work to the fast-worker tier resolved by the `fast_worker_backend` selector (`claude` / `codex` / `agy` / `auto` with `fast_worker_backend_order` and `fast_worker_fallback`), instead of naming only the in-process `dhpk:fast-worker`. The emitted goal string SHALL state the resolved backend and fallback order explicitly so an unattended session dispatches without re-deriving the selection.

#### Scenario: Session configured for codex backend

- **WHEN** the effective backend resolution is `codex` (via flag or userConfig) and an applicable mechanical batch is dispatched in an unattended goal session
- **THEN** the batch is dispatched to `dhpk:codex-worker` per the backend clause carried in the goal string

#### Scenario: No CLI available under auto

- **WHEN** the resolution is `auto` and neither the codex nor the agy CLI is available
- **THEN** mechanical batches route to the in-process `dhpk:fast-worker` and the worker report states the selected backend

### Requirement: Post-review fix batches use applicable ownership and coupling

The goal string SHALL direct the orchestrator to apply reviewer findings that
constitute a clear fix-spec through a fast-worker dispatch when ownership,
coupling, dependencies, or material risk make delegation applicable. It SHALL
permit bounded inline fixes when those conditions do not apply.

#### Scenario: Review wave yields fixes across three files

- **WHEN** a review round returns a coupled fix-spec with delegated ownership
- **THEN** the orchestrator dispatches one batched fast-worker task with the findings as the fix-spec

### Requirement: Planning and delegation depend on outcomes and ownership

The goal SHALL treat planner and worker routes as recommendations. It SHALL
accept an adequate existing plan, diagnosis, or coordination result when its
scope, conclusion, observations, and gaps satisfy the needed outcome. A named
planner or file-count threshold SHALL NOT be a prerequisite by itself; unresolved
decisions, dependencies, ownership, coupling, or material risk remain blocking
until resolved. An explicitly requested consultation remains binding.

#### Scenario: Adequate external plan

- **WHEN** an existing plan identifies scope, dependencies, ownership, and open gaps
- **THEN** the goal reuses it and requests only missing outcomes instead of dispatching a duplicate planner

#### Scenario: File count alone is insufficient

- **WHEN** a change touches several files but ownership and coupling permit one coherent inline step
- **THEN** the goal does not force delegation solely because of the file count

### Requirement: Retry and fallback share one task budget

Repair attempts, review-driven retries, and authorized backend fallbacks SHALL
consume one shared task budget and preserve task and attempt identity. Switching
backend SHALL NOT reset the count or widen the task scope.

#### Scenario: Backend fallback preserves budget

- **WHEN** a worker backend fails and an authorized fallback is selected
- **THEN** the fallback uses the remaining task budget and the same task identity

### Requirement: Interrupted writers are reconciled before replacement

Before another writer replaces an interrupted writer, the goal SHALL require
inspection of existing work and diff, reconciliation of the prior result, and a
bounded recovery decision. Two writers SHALL NOT act on the same scope
concurrently.

#### Scenario: Interrupted writer leaves a partial edit

- **WHEN** a writer times out after changing part of its assigned scope
- **THEN** the next session inspects and reconciles the partial work before assigning replacement edits
