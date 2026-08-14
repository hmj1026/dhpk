# opsx-goal-dispatch-discipline Specification

## Purpose
TBD - created by archiving change dhpk-usage-audit-and-cli-fast-workers. Update Purpose after archive.
## Requirements
### Requirement: Goal string carries a mechanical-batch dispatch mandate
This capability strengthens — and inherits the `orchestration_dispatch=on` gating of — the existing Part 0 dispatch directive required by `implementation-dispatch` ("opsx-apply-goal emits the dispatch directive for unattended sessions"); it does not introduce a parallel mechanism. The goal string emitted by opsx-apply-goal SHALL include a clause requiring the unattended session to dispatch any mechanical batch — edits touching ≥3 files, or a run of same-shaped edits whose combined footprint exceeds the ≤2-file inline bound — as a single batched `fast-worker` (or CLI-backed variant) dispatch, stating that inline main-context editing is the narrow exception per the execution-policy Implementation dispatch section (referenced, not restated). The added clauses of this capability SHALL total ≤300 characters so the emitted goal string stays within the 4,000-character hard stop.

#### Scenario: Bulk doc-consistency fix in an unattended session
- **WHEN** an unattended /goal session faces 6 same-shaped edits across 5 files
- **THEN** it batches them into one fast-worker dispatch with a fix spec and verification command, instead of hand-typing the edits inline

#### Scenario: Goal string stays under the hard stop
- **WHEN** the goal generator emits a /goal string including the dispatch-discipline clauses
- **THEN** the measured total length remains under 4,000 characters

### Requirement: Goal string batches reviewer rounds
The goal string SHALL instruct the session to run one consolidated applicable-reviewer dispatch per implementation wave, where a wave is the contiguous batch of implementation edits completed before a review gate. It SHALL instruct the session to batch all known-finding fixes before one confirm-only re-review and SHALL reference the reviewer-wave contract for scope and no-op handling instead of embedding that policy in full.

#### Scenario: Single review round after a wave
- **WHEN** a session completes a wave touching docs and hooks
- **THEN** it dispatches the applicable reviewers once over the full changed-file scope

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
- **WHEN** the effective backend resolution is `codex` (via flag or userConfig) and a ≥3-file mechanical batch is dispatched in an unattended goal session
- **THEN** the batch is dispatched to `dhpk:codex-fast-worker` per the backend clause carried in the goal string

#### Scenario: No CLI available under auto
- **WHEN** the resolution is `auto` and neither the codex nor the agy CLI is available
- **THEN** mechanical batches route to the in-process `dhpk:fast-worker` and the worker report states the selected backend

### Requirement: Post-review fix batches route to fast-worker
The goal string SHALL direct the orchestrator to apply reviewer findings that constitute a clear fix-spec via a fast-worker dispatch whenever the whole fix batch exceeds the ≤2-file inline bound, instead of editing production files inline on the main context.

#### Scenario: Review wave yields fixes across three files
- **WHEN** a review round returns findings requiring edits to three or more files
- **THEN** the orchestrator dispatches one batched fast-worker task with the findings as the fix-spec, rather than applying the edits inline
