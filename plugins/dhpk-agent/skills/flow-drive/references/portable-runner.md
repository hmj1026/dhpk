# Portable runner API

Read this reference only when embedding or invoking the programmatic
`runFlowDrive(argv, { host, workdir, authorizationEvidence, recovery })` API.
For the user-facing `$flow-drive` entrypoint, follow the Host procedure in
[SKILL.md](../SKILL.md). Both interfaces use the same grammar and keep Provider
selection intent separate from current Host grants.

## Task contract and portability

The runner passes the first positional input unchanged to
`host.resolveTask(input, { workdir })`. The Host supplies a non-empty `goal`,
a non-empty `acceptance` array, and a plain-object `constraints` value. The
runner does not classify natural-language intent. The Host owns interpretation
and target coordination, while the existing dispatch resolver validates the
selected target. The runner clones and freezes the returned task contract
before coordination or dispatch.

The complete Skill directory can be installed or moved independently.
Required lookup uses its own `scripts/`,
`references/execution-bundle/`, `scripts/dispatch-runtime/`,
`scripts/adapters/`, and `scripts/transport/` resources.
Native execution, bound current capability evidence, coordination, and granted
cross-Provider selection use the same public runner after relocation. Peer
skills and a canonical checkout are optional; the injected Host and any
selected external tools remain environment dependencies. See
[portability](portability.md) for the copy boundary, optional evidence, missing
independence, and fixture versus runtime claims.

Task constraints default to `authority: "read-only"`. A
`"workspace-write"` task must include non-empty, safe relative
`assigned_files`. The Host supplies `constraints.prompt_evidence` pointing to
the actual input file together with its device, inode, and SHA-256; the runner
checks the file identity and content before dispatch. For raw task text, the
Host must materialize that text as a physical prompt file under its authorized
input-preparation scope before returning the write contract from
`resolveTask`. If the Host cannot provide that file and binding, the writer
remains blocked; the caller can supply a task file instead. Read-only task text
requires no physical prompt file. The runner does not create a prompt file or
grant the Host permission to write one.

## Provider authorization and capability

A canonical task `provider` constraint takes precedence over selection intent.
`--worker=provider/model:effort` is an exact Worker request, not a grant.
The Host must answer the selected target/role/authority scope before external
probe or launch. Exact target grants do not authorize another role, authority,
model, effort, or Provider. `--reasoner` intent does not change automatic
Worker candidates. Automatic Workers remain native unless this invocation
contains `--cross`; legacy cross environment/configuration is ignored.
The runner starts with external probing disabled. Cancellation, refusal,
partial/mismatched target answers, stale binding, or a missing question
callback creates no target grant; independent eligible native graph work
can continue. Existing root-owned provider-scope evidence remains usable only
within current Host policy and the invocation's candidate scope.

The Host may return a multi-provider selection, successive selections, or a
plain provider-list answer; each `ANSWERED` result must include a nonblank
`answer_id`. Provider names in unrelated or negative text do not grant access.
The runner keeps only a sanitized answer ID with each grant and does not retain
answer text. It does not ask for model choices. A trusted caller may supply
root-owned `authorizationEvidence`, for example
`{ source: "user-answer", answer_id: "consent-42", providers: ["openai"] }`.
Task files, resolver metadata, coordination decisions, and catalog entries
cannot grant provider permission. Host allowed-provider policy, task provider
and strict-target constraints, and current Host evidence remain binding after
any grant. After side-effect-free coordination, the runner refreshes only the
selected external Provider/Agent/Model/Effort/Role/authority tuples; it never
uses a provider-wide consent to probe every model from that Provider.

## Execution and acceptance

The runner executes each admitted item and then its acceptance verifier. Its
report keeps parser, execution, acceptance, and
requested/resolved/observed targets separate. Verification `PASSED` requires
successful execution and non-empty verification evidence; the runner's overall
status is `REPORTED`, never an automatic task `PASS`.

For `--plan`, the current Host declares its effective planner tuple in
`host_profile.role_defaults.planner`. No Claude settings or other Host defaults
are imported. Missing/invalid support blocks before coordination; omission
adds no planner dependency. The runner exposes no separate legacy
`planner_target` configuration adapter. The Host receives
`context.requested_roles`, including planner scope and exact role targets,
and returns matching read-only graph nodes before dependent writers.
Requested reasoners retain the existing verified conclusion gate.
`--architect` reports explicit `UNAVAILABLE` for the current Host contract.
`--no-architect` preserves required graph policy and dependencies.

An optional `recovery` contract enables bounded attempt recovery for solo and
coordinated tasks. The Host proposes a target through `recover`; shared
authorization, capability resolution, failure policy, and one
invocation-wide retry budget validate every replacement. Interrupted writers
retain exclusive ownership until matching stop evidence and actual scope/diff
reconciliation pass. See [recovery](recovery.md) for Host hooks, deadlines,
immutable attempt receipts, and the suspended-writer completion boundary.

## Bound runtime evidence and coordinated tasks

When the Host exposes current executable capability evidence, it may include a
`capability_evidence` record or per-node
`capability_evidence_records` with a `session_id` and `binding_id` supplied
by the runner's injected executor binding. The shared Dispatch Engine uses that
evidence to resolve a currently executable target even when the shipped model
catalog is stale. Static catalog or documentation declarations cannot create
this evidence; Provider, Target Agent, Model, Role, Effort, Route, and
authority remain separate, and unknown observed Model or Effort values stay
explicitly null. A current bound native Host tool may expose a fixed role or
default selector without an observable Model or Effort. Such a target needs
current Provider, role, authority, and binding proof; strict concrete selectors
and external CLI targets retain their concrete requirements. An `EXPOSED`
selector authorizes invocation without becoming observed identity. Even an
`OBSERVED_AVAILABLE` invocation keeps selector and identity separate;
explicit `observed_model`/`observed_effort` fields require actual observation,
and runtime `observed_target` reports only the executor outcome. Matching
fresh scoped evidence supersedes older matching observations, while
contradictory fresh batches and explicit Host refusals remain blocked. The runner
passes the same session and binding identifiers to the executor context so
evidence cannot be attached to an arbitrary task string.

The Host may return `mode: "coordinated"` with a dependency-ordered `nodes`
graph. Each node inherits the parent authority and write scope; unknown,
duplicate, cyclic, or widened dependencies block the graph before execution.
Independent read-only nodes may run in parallel, while all workspace writers,
including scratch proposals, use the shared Dispatch writer lease so solo and
coordinated calls never overlap. Every node must execute and pass its own
verification before the aggregate acceptance can pass. A reasoner conclusion
must carry attributable source, root-cause, repair, and verification evidence
before a dependent writer is eligible; confidence text or a role name alone is
insufficient. Required independent review needs a distinct observed executor
identity. Optional peer absence alone is not a blocker, but a missing review
gate cannot become PASS. The sanitized DEV QA fixtures in
`tests/fixtures/flow-drive/` exercise partial acceptance: an unknown cause
blocks its writer while a separate repaired item retains tests and independent
review evidence. Fixture success does not prove real DEV, database, Provider
runtime, deployment, or merge completion.
