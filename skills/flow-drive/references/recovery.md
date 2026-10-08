# Flow Drive attempt recovery

Use this contract when a Host opts the public runner into failure recovery.
The default runner executes its existing attempt once. Recovery does not grant
Provider access, select a new Provider automatically, or waive acceptance.

Pass `recovery: { retryBudget, executionTimeoutMs?, controlTimeoutMs? }` to
`runFlowDrive`. `retryBudget` is a nonnegative integer shared by every node and
Provider for the whole invocation. Execution and control deadlines are positive
integer milliseconds; execution has no added deadline when omitted, and control
hooks default to 5000 milliseconds. A replacement consumes one retry immediately
before creating its fresh attempt identity. Rejected candidates consume none.

An executor may return `SUCCEEDED`, `FAILED`, or `INTERRUPTED`, with canonical
`failure_class` and `side_effects: "none" | "observed" | "unknown"`. Missing
effect evidence stays unknown; an actual changed assigned file records observed
effects. The runner creates immutable canonical dispatch receipts rather than
accepting arbitrary Host receipts. Execution evidence retains all actual attempt
identities, failure classes, observed targets, budget, and reconciliation ledgers.
Provider exceptions become bounded failure classifications without raw messages.

The optional `host.recover(task, context)` receives the actual `request`,
`resolution`, `receipt`, `failure_class`, `reconciliation`, and `remaining_budget`.
It returns `{ action: "substitute" | "repair" | "resume" | "stop", target }`.
The selected target has Provider, Target Agent, Model, and optional Effort fields.
The existing permission ledger and target policy remain binding. Only the actual
authorized candidate receives a scoped current-capability refresh, using the
same execution binding. The canonical resolver validates the candidate again.

CLI or authentication/model unavailability permits substitution only with
confirmed no effects and a non-strict target. Safety/user denial is terminal.
Quota stops the affected Provider's task without inferring exhaustion elsewhere.
Semantic failures use the same Provider's repair path after actual baseline/diff
and positive Host scope proof. Timeout/interruption uses the same Provider's
resume or repair path after the stronger stop and reconciliation evidence below.

For interruption, `host.stop(task, context)` must return
`{ status: "STOPPED", task_id, attempt_id }` matching the launched request.
`host.reconcile(task, context)` receives that request and its pre-execution
`baseline` and returns an attempt-bound proof:

```js
{
  status: 'PASSED', task_id, attempt_id, baseline_id,
  scope_contained: true, wip_preserved: true, diff_verified: true,
  attributable_changes: ['src/receipt.js'],
  unconfirmed: ['src/receipt.js'], remaining: [], out_of_scope: []
}
```

All lists are required, including the negative `out_of_scope` proof. The runner
independently compares bounded filesystem snapshots of the actual workspace,
including scratch and unrelated WIP, and requires exact attributable changed
files. Snapshots hash file bytes without reporting their content, omit `.git`,
and record unrelated links without following them. Assigned files and ancestors
must be physical paths within the workspace. Snapshot limits fail closed.

The global writer owner covers pre-inspection, execution, verification,
post-inspection, stop, reconciliation, and any replacement attempt. Missing,
negative, foreign, thrown, or nonreturning stop/reconciliation proof suspends
that owner. Queued and new writers receive `RECONCILIATION_REQUIRED` promptly;
independent readers can continue. A late completion cannot release a suspended
owner. Suspension persists in that process; returning a report does not clear it.

Stop and reconciliation safety also apply when retries are disabled or omitted.
A thrown executor error or malformed outcome leaves the launched lifecycle
unknown and follows the same ownership barrier while retaining its failure
classification. Ordinary writers capture a physical baseline when available;
an unavailable baseline cannot prove an interrupted or unknown writer safe to
release. Structured semantic failure remains distinct from unknown lifecycle.

Recovery scopes contain the completion ledger's unconfirmed and remaining files;
confirmed attributable changes are carried as context, never as acceptance.
Other successful graph nodes remain available, dependent nodes wait for their
actual prerequisite results. Dependent reuse requires independently validated
reused prerequisites; fresh prerequisite evidence invalidates downstream reuse
even when file effects are unknown. Final parent verification remains mandatory.
Provider exit, a successful retry, and a completion ledger each remain distinct
from acceptance `PASSED` with nonempty verification evidence.
