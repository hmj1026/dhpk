# cli-worker-timeout-recovery Specification

## Purpose
Define controlled retry decisions from contained CLI transport timeout receipts.
## Requirements
### Requirement: CLI runners expose a guarded timeout signal

Codex and AGY adapters SHALL delegate deadline enforcement to the portable
runner. Exit `124` enters recovery only with a contained `0600`
`dhpk.cli.receipt.v1` terminal `TIMEOUT` receipt selected by immutable caller
context; a native exit code or missing receipt is `BLOCKED`, not fabricated
timeout evidence. The restricted runtime never requires `timeout`, `gtimeout`,
or a Node envelope sanitizer.

#### Scenario: Codex runner timeout is verified

- **WHEN** the Codex CLI is terminated by the attested portable runner deadline
- **THEN** the runner returns `124` with a contained terminal receipt
- **AND** the worker may enter the mid-batch timeout state machine

#### Scenario: Native exit has no contained receipt

- **WHEN** a provider returns `124` without a terminal receipt
- **THEN** the worker does not classify it as a runner timeout

### Requirement: CLI worker records a path-scoped completion ledger

The Codex or agy worker SHALL derive a ledger limited to the exact assigned
product files after a verified timeout, and SHALL partition that list into
disjoint confirmed, unconfirmed, and remaining files before retrying or
reporting a result. Confirmed completion SHALL require both explicit backend
report evidence and path-scoped diff evidence attributable to the dispatch.

#### Scenario: First timeout leaves two files unconfirmed

- **WHEN** a ten-file assigned batch times out after eight files are confirmed
- **THEN** the ledger records eight confirmed files and the two unresolved files
  enter the recovery scope without using global status evidence

#### Scenario: Changed file lacks sufficient attribution

- **WHEN** an assigned file changed but the backend report or baseline evidence
  cannot prove completion ownership
- **THEN** the file is unconfirmed and is included in the one recovery scope

#### Scenario: Parallel sibling edits exist

- **WHEN** unrelated sibling workers modify files outside the assigned list
  while the backend times out
- **THEN** those files are out-of-scope observations and do not enter the ledger
  or cleanup path

### Requirement: First timeout retries only unresolved assigned scope

After the first verified runner timeout on a multi-file dispatch, the worker SHALL
make exactly one fresh invocation using the same selected backend,
model/effort, original intent, assigned scope, and path-scoped verification.
The retry SHALL target only `remaining` and `unconfirmed` files. The worker and
orchestrator SHALL NOT edit unresolved files inline, repeat confirmed files by
default, expand scope, or silently select another backend.

#### Scenario: Scoped recovery succeeds

- **WHEN** the first timeout confirms eight files and the recovery dispatch
  completes the two-file remainder
- **THEN** the worker runs final scoped verification and reports `RESULT: DONE`
  with both attempts and all ten files accounted for

#### Scenario: Recovery requires an unlisted file

- **WHEN** the backend reports that a file outside the assigned list is needed
  to continue
- **THEN** the worker reports `RESULT: BLOCKED` and names the required scope
  expansion without editing, reverting, or deleting that file

### Requirement: Second timeout is terminal and auditable

After a second verified runner timeout for the same batch, the worker SHALL
stop and report `RESULT: PARTIAL` if any assigned file is confirmed complete,
otherwise `RESULT: BLOCKED`. The report SHALL include both timeout
observations, selected backend, assigned, confirmed, remaining, unconfirmed,
marker state, and next action. A single-file timeout SHALL retain its existing
no-automatic-retry and no-backend-fallback semantics, while its caller MAY use
the issue #121 `TIMEOUT_SALVAGED` or `BLOCKED` reporting classification.

#### Scenario: Second timeout after partial completion

- **WHEN** the recovery dispatch also times out after confirming no additional
  files
- **THEN** the worker reports `RESULT: PARTIAL`, leaves remaining files
  untouched by fallback edits, writes the durable marker, and requests human or
  dispatcher follow-up

#### Scenario: Second timeout with no confirmed file

- **WHEN** the backend times out before any assigned file is proven complete on
  either attempt
- **THEN** the worker reports `RESULT: BLOCKED`, writes no PARTIAL marker, and
  does not claim the batch was applied

#### Scenario: Single-file timeout remains non-retrying

- **WHEN** a single-file Codex dispatch receives a verified runner timeout
- **THEN** it does not retry or select a fallback backend automatically
- **AND** it may report `TIMEOUT_SALVAGED` only when independent evidence supports
  that classification

### Requirement: PARTIAL state writes an authorized durable marker

When the worker reports `RESULT: PARTIAL`, it SHALL write a JSON marker before
returning the report at the dispatcher-declared control-plane path
`.claude/artifacts/sessions/.partial-cli-batch-<backend>-<session-id>-<dispatch-id>.json`.
The marker SHALL record backend, session/dispatch identity, assigned,
confirmed, remaining, unconfirmed, both timeout observations, and next action.
The marker SHALL NOT match `.pending-*`, SHALL NOT be counted as a product
edited-file result, and SHALL remain until a human or orchestrator explicitly
reconciles it.

#### Scenario: PARTIAL state is durable

- **WHEN** a worker reports `RESULT: PARTIAL` after a second timeout
- **THEN** the marker exists after the worker returns, remains visible across
  session boundaries, and is reported separately as a control-plane output

#### Scenario: Marker is not a reviewer sentinel

- **WHEN** the existing reviewer sentinel or push-time stray-sentinel sweep
  runs
- **THEN** it does not clear, approve, or reinterpret the PARTIAL marker

#### Scenario: BLOCKED with no confirmed file writes no partial marker

- **WHEN** the worker reports `RESULT: BLOCKED` with zero files confirmed
- **THEN** no PARTIAL marker is required because no partial edit exists to
  protect from silent commit

### Requirement: Timeout-prone batches have bounded dispatch guidance

Dispatch guidance SHALL recommend splitting an initial mechanical batch with
more than six assigned product files into smaller independently verifiable
batches unless the dispatcher records an override reason. The threshold SHALL
NOT authorize a worker to expand or rewrite its assigned scope and SHALL remain
a tunable starting guideline rather than a backend protocol setting.

#### Scenario: Large batch is dispatched without an override

- **WHEN** a mechanical task declares more than six assigned product files and
  no override reason
- **THEN** the dispatcher splits it before invoking the CLI-backed worker

#### Scenario: Explicit override is recorded

- **WHEN** a dispatcher keeps a batch larger than six files for a documented
  reason
- **THEN** the dispatch record and worker report include that reason and retain
  the same timeout recovery contract

### Requirement: Parallel and shared-state boundaries survive timeout recovery

Timeout recovery SHALL preserve the assigned-file write/diff/verification
boundary, prohibit destructive out-of-scope cleanup, and use only scoped or
no-write validators for shared state. After all workers and retries return, the
orchestrator SHALL perform exactly one sequential whole-tree shared-state
reconciliation before the implementation-wave review.

#### Scenario: Scope overlap is discovered during recovery

- **WHEN** the retry would write a file assigned to another worker or outside
  the original list
- **THEN** recovery stops with `RESULT: BLOCKED` and leaves the conflicting
  files untouched

#### Scenario: Shared reconciliation waits for all retries

- **WHEN** parallel workers have returned, including timeout retries and
  PARTIAL/BLOCKED reports
- **THEN** the orchestrator performs one whole-tree reconciliation and does not
  let an individual worker mutate shared state mid-batch
